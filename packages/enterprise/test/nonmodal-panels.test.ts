import { expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
import { sendKeys } from '@web/test-runner-commands';
import 'axe-core';
import { type ColumnConfiguration, esLocale } from 'apex-grid';
import { ApexGridAI, ApexGridChart, ApexGridEnterprise, enterpriseModules } from '../src/index.js';
import { settle } from './settle.js';

// The floating chart and Ask AI panels sit next to the live grid with no
// backdrop, so they are non-modal dialogs: no aria-modal, no Tab wrap. Escape
// still closes a panel and puts focus back. F6 moves between the grid and the
// open panels (newest first), and a "Back to grid" button in each header does
// what F6 does from a panel.

interface Row {
  name: string;
  value: number;
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'name', type: 'string', headerText: 'Name' },
  { key: 'value', type: 'number', headerText: 'Value' },
];

const DATA: Row[] = [
  { name: 'A', value: 10 },
  { name: 'B', value: 20 },
  { name: 'C', value: 30 },
];

type Grid = ApexGridEnterprise<Row>;
type Panel = ApexGridChart | ApexGridAI;
type Cell = HTMLElement & { column: { key: unknown }; row: HTMLElement & { index: number } };

interface AxeResult {
  violations: { id: string; nodes: { target: string[]; failureSummary: string }[] }[];
}
const axe = (window as any).axe as { run(context: Element): Promise<AxeResult> };

async function axeViolations(el: Element): Promise<string[]> {
  const { violations } = await axe.run(el);
  return violations.flatMap(({ id, nodes }) =>
    nodes.map((node) => `${id}: ${node.target.join(' ')}: ${node.failureSummary}`)
  );
}

// No render animation: a late frame after teardown would throw inside ApexCharts.
(window as unknown as { Apex?: unknown }).Apex = { chart: { animations: { enabled: false } } };

async function mount(): Promise<Grid> {
  const parent = document.createElement('div');
  parent.style.height = '300px';
  const grid = await fixture<Grid>(
    html`<apex-grid-enterprise .data=${DATA.map((r) => ({ ...r }))} .columns=${columns}></apex-grid-enterprise>`,
    { parentNode: parent }
  );
  await settle(grid);
  return grid;
}

function deepActive(): Element | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

const root = (panel: Panel): ParentNode => panel.shadowRoot ?? panel;
const part = <E extends HTMLElement = HTMLElement>(panel: Panel, name: string) =>
  root(panel).querySelector<E>(`[part="${name}"]`);
const container = (panel: Panel) => part(panel, 'panel')!;
const inside = (panel: Panel) => {
  const active = deepActive();
  return !!active && (panel.contains(active) || !!panel.shadowRoot?.contains(active));
};

/** Click a body cell so it becomes the active cell and takes focus. */
async function activate(grid: Grid, index = 1): Promise<Cell> {
  const row = grid.rows.find((r) => r.index === index)!;
  const cell = row.cells.find((c) => String(c.column.key) === 'name') as unknown as Cell;
  cell.click();
  await settle(grid);
  expect(deepActive(), 'the clicked cell has focus').to.equal(cell);
  return cell;
}

function expectOnActiveCell(grid: Grid, index = 1): void {
  const focused = deepActive() as Cell | null;
  expect(focused?.localName, 'focus is on a body cell').to.equal('apex-grid-cell');
  expect(grid.rows.includes(focused!.row as never), "the grid's own cell").to.equal(true);
  expect(focused!.row.index).to.equal(index);
  expect(focused!.column.key).to.equal('name');
}

/** Poll animation frames until `predicate` holds (focus hand-offs and chart draws are async). */
async function untilFrame(predicate: () => boolean, tries = 20): Promise<void> {
  for (let i = 0; i < tries && !predicate(); i += 1) {
    await new Promise(requestAnimationFrame);
  }
}

async function openChart(grid: Grid): Promise<ApexGridChart> {
  grid.toolbarActions.find((a) => a.id === 'create-chart')!.run();
  const charts = document.body.querySelectorAll<ApexGridChart>('apex-grid-chart');
  const chart = charts[charts.length - 1];
  await chart.updateComplete;
  await untilFrame(() => inside(chart));
  // The toolbar shows once the first draw has a model: wait, so the tab order is final.
  await untilFrame(() => part(chart, 'toolbar')?.hidden === false, 120);
  expect(part(chart, 'toolbar')?.hidden, 'the chart drew').to.equal(false);
  return chart;
}

async function openAI(grid: Grid): Promise<ApexGridAI> {
  grid.toolbarActions.find((a) => a.id === 'ask-ai')!.run();
  const ai = document.body.querySelector<ApexGridAI>('apex-grid-ai')!;
  await ai.updateComplete;
  await untilFrame(() => inside(ai));
  return ai;
}

function keydown(target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    composed: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

/** The focusable controls of a panel, in tab order (document order here). */
function focusables(panel: Panel): HTMLElement[] {
  return [
    ...root(panel).querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    ),
  ].filter((el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0);
}

describe('Floating chart and AI panels are non-modal dialogs', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridChart.register();
    ApexGridAI.register();
  });
  afterEach(() => {
    for (const el of document.body.querySelectorAll('apex-grid-chart, apex-grid-ai')) el.remove();
    fixtureCleanup();
  });

  const openers = [
    { name: 'chart panel', open: openChart },
    { name: 'AI panel', open: openAI },
  ] as const;

  for (const { name, open } of openers) {
    describe(name, () => {
      it('is a labelled dialog without aria-modal that announces F6', async () => {
        const grid = await mount();
        const panel = await open(grid);
        const dialog = container(panel);
        expect(dialog.getAttribute('role')).to.equal('dialog');
        expect(dialog.hasAttribute('aria-modal'), 'no aria-modal').to.equal(false);
        expect(dialog.getAttribute('aria-label')).to.be.a('string').and.not.equal('');
        expect(dialog.getAttribute('aria-description')).to.equal(
          'Press F6 to move between the grid and this panel'
        );
      });

      it('has a visible Back to grid button in its header', async () => {
        const grid = await mount();
        const panel = await open(grid);
        const back = part<HTMLButtonElement>(panel, 'back-to-grid');
        expect(back, 'back-to-grid button').to.exist;
        expect(back!.localName).to.equal('button');
        expect(back!.textContent?.trim()).to.equal('Back to grid');
        expect(part(panel, 'header')!.contains(back), 'in the header').to.equal(true);
        expect(back!.getClientRects().length, 'rendered').to.be.greaterThan(0);
        expect(focusables(panel), 'in the tab order').to.include(back);
      });

      it('passes axe', async () => {
        const grid = await mount();
        const panel = await open(grid);
        expect(await axeViolations(panel)).to.eql([]);
      });

      it('does not wrap Tab or Shift+Tab', async () => {
        const grid = await mount();
        const panel = await open(grid);
        const controls = focusables(panel);
        const last = controls[controls.length - 1];
        last.focus();
        expect(keydown(last, 'Tab').defaultPrevented, 'Tab from the last control').to.equal(false);
        const first = controls[0];
        first.focus();
        expect(
          keydown(first, 'Tab', { shiftKey: true }).defaultPrevented,
          'Shift+Tab from the first control'
        ).to.equal(false);
      });

      it('a real Tab moves on out of the panel in document order', async () => {
        const grid = await mount();
        const panel = await open(grid);
        // The panel is the last thing on the page: a control after it is the next tab stop (a
        // text field, which WebKit tabs to by default, unlike a button).
        const after = document.createElement('input');
        after.setAttribute('aria-label', 'after');
        document.body.appendChild(after);
        try {
          // Tab through the panel from its first control (a wrap would never leave it).
          focusables(panel)[0].focus();
          for (let i = 0; i < 60 && inside(panel); i += 1) await sendKeys({ press: 'Tab' });
          expect(document.activeElement, 'focus left the panel').to.equal(after);
          expect(panel.open, 'the panel stays open').to.equal(true);
        } finally {
          after.remove();
        }
      });

      it('Back to grid returns focus to the active cell and keeps the panel open', async () => {
        const grid = await mount();
        await activate(grid);
        const panel = await open(grid);
        part<HTMLButtonElement>(panel, 'back-to-grid')!.click();
        await untilFrame(() => deepActive()?.localName === 'apex-grid-cell');
        expectOnActiveCell(grid);
        expect(panel.open).to.equal(true);
      });

      it('F6 in the panel returns to the active cell; F6 in the grid comes back', async () => {
        const grid = await mount();
        await activate(grid);
        const panel = await open(grid);
        await sendKeys({ press: 'F6' });
        await untilFrame(() => deepActive()?.localName === 'apex-grid-cell');
        expectOnActiveCell(grid);
        await sendKeys({ press: 'F6' });
        await untilFrame(() => inside(panel));
        expect(deepActive(), 'focus is on the dialog').to.equal(container(panel));
      });

      it('Escape after an F6 round trip closes the panel and returns focus', async () => {
        const grid = await mount();
        await activate(grid);
        const panel = await open(grid);
        await sendKeys({ press: 'F6' });
        await untilFrame(() => deepActive()?.localName === 'apex-grid-cell');
        await sendKeys({ press: 'F6' });
        await untilFrame(() => inside(panel));
        await sendKeys({ press: 'Escape' });
        await untilFrame(() => deepActive()?.localName === 'apex-grid-cell');
        expect(panel.open).to.equal(false);
        expectOnActiveCell(grid);
      });

      it('F6 with the grid hidden leaves the key alone and focus in the panel', async () => {
        const grid = await mount();
        await activate(grid);
        const panel = await open(grid);
        grid.style.display = 'none';
        const from = deepActive()!;
        expect(inside(panel), 'focus starts in the panel').to.equal(true);
        expect(keydown(from, 'F6').defaultPrevented, 'F6 not swallowed').to.equal(false);
        expect(deepActive(), 'focus stays put').to.equal(from);
        part<HTMLButtonElement>(panel, 'back-to-grid')!.click();
        expect(inside(panel), 'Back to grid: focus stays in the panel').to.equal(true);
      });

      it('takes Spanish strings from the grid locale', async () => {
        const grid = await mount();
        grid.localeText = esLocale;
        await grid.updateComplete;
        const panel = await open(grid);
        expect(part(panel, 'back-to-grid')!.textContent?.trim()).to.equal('Volver a la tabla');
        expect(container(panel).getAttribute('aria-description')).to.equal(
          'Pulse F6 para moverse entre la tabla y este panel'
        );
      });
    });
  }

  it('F6 cycles from the grid through the open panels, newest first, and back', async () => {
    const grid = await mount();
    await activate(grid);
    const chart = await openChart(grid);
    const ai = await openAI(grid);
    expect(inside(ai), 'the AI panel took focus').to.equal(true);

    await sendKeys({ press: 'F6' });
    await untilFrame(() => inside(chart));
    expect(deepActive(), 'AI panel -> chart panel').to.equal(container(chart));

    await sendKeys({ press: 'F6' });
    await untilFrame(() => deepActive()?.localName === 'apex-grid-cell');
    expectOnActiveCell(grid);

    await sendKeys({ press: 'F6' });
    await untilFrame(() => inside(ai));
    expect(deepActive(), 'grid -> newest panel').to.equal(container(ai));

    await sendKeys({ press: 'Shift+F6' });
    await untilFrame(() => deepActive()?.localName === 'apex-grid-cell');
    expectOnActiveCell(grid);

    await sendKeys({ press: 'Shift+F6' });
    await untilFrame(() => inside(chart));
    expect(deepActive(), 'Shift+F6: grid -> oldest panel').to.equal(container(chart));
  });

  it('F6 in the grid with no panel open leaves the key alone', async () => {
    const grid = await mount();
    const cell = await activate(grid);
    expect(keydown(cell, 'F6').defaultPrevented).to.equal(false);
    expect(deepActive()).to.equal(cell);
  });

  it('a dialog panel the app mounts itself: F6 and Back to grid reach its grid', async () => {
    const grid = await mount();
    await activate(grid);
    const chart = document.createElement('apex-grid-chart') as ApexGridChart;
    chart.mode = 'dialog';
    chart.grid = grid as never;
    document.body.appendChild(chart);
    chart.show();
    await chart.updateComplete;
    await untilFrame(() => inside(chart));
    await sendKeys({ press: 'F6' });
    await untilFrame(() => deepActive()?.localName === 'apex-grid-cell');
    expectOnActiveCell(grid);
  });

  it('inline panels keep no dialog chrome', async () => {
    const grid = await mount();
    const chart = await fixture<ApexGridChart>(
      html`<apex-grid-chart mode="inline" .grid=${grid as never}></apex-grid-chart>`
    );
    const ai = await fixture<ApexGridAI>(
      html`<apex-grid-ai mode="inline" .grid=${grid as never}></apex-grid-ai>`
    );
    for (const panel of [chart, ai] as Panel[]) {
      await panel.updateComplete;
      const dialog = container(panel);
      expect(dialog.hasAttribute('role')).to.equal(false);
      expect(dialog.hasAttribute('aria-description')).to.equal(false);
      expect(part(panel, 'back-to-grid')).to.equal(null);
    }
  });
});
