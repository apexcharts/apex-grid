import { expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
import { resetMouse, sendKeys, sendMouse } from '@web/test-runner-commands';
import 'axe-core';
import { type ColumnConfiguration, esLocale, type GridLocaleText } from 'apex-grid';
import { ApexGridAI, ApexGridChart, ApexGridEnterprise, enterpriseModules } from '../src/index.js';
import { settle } from './settle.js';

// The floating chart and Ask AI panels move and resize from the keyboard: a
// "Move panel" control in the header and a "Resize panel" grip in the
// inline-end bottom corner take the arrow keys (10px, Shift for 50px), keep the
// panel inside the viewport and above its minimum size, follow the visual
// direction in RTL, and announce where the panel ended up. Pointer drags on the
// header and on the grip keep working.

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

const STEP = 10;
const BIG = 50;
/** The smallest box the helper lets a key or grip drag shrink a panel to. */
const MIN_WIDTH = 240;
const MIN_HEIGHT = 120;

async function mount(localeText?: GridLocaleText): Promise<Grid> {
  const parent = document.createElement('div');
  parent.style.height = '300px';
  const grid = await fixture<Grid>(
    html`<apex-grid-enterprise
      .data=${DATA.map((r) => ({ ...r }))}
      .columns=${columns}
      .localeText=${localeText}
    ></apex-grid-enterprise>`,
    { parentNode: parent }
  );
  await settle(grid);
  return grid;
}

const root = (panel: Panel): ParentNode => panel.shadowRoot ?? panel;
const part = <E extends HTMLElement = HTMLElement>(panel: Panel, name: string) =>
  root(panel).querySelector<E>(`[part="${name}"]`);
const box = (panel: Panel) => part(panel, 'panel')!;
const rectOf = (panel: Panel) => box(panel).getBoundingClientRect();
const moveHandle = (panel: Panel) => part<HTMLButtonElement>(panel, 'move-handle')!;
const resizeHandle = (panel: Panel) => part<HTMLButtonElement>(panel, 'resize-handle')!;
const viewport = () => ({
  width: document.documentElement.clientWidth,
  height: document.documentElement.clientHeight,
});

async function untilFrame(predicate: () => boolean, tries = 20): Promise<void> {
  for (let i = 0; i < tries && !predicate(); i += 1) {
    await new Promise(requestAnimationFrame);
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function openChart(grid: Grid): Promise<ApexGridChart> {
  grid.toolbarActions.find((a) => a.id === 'create-chart')!.run();
  const charts = document.body.querySelectorAll<ApexGridChart>('apex-grid-chart');
  const chart = charts[charts.length - 1];
  await chart.updateComplete;
  await untilFrame(() => part(chart, 'toolbar')?.hidden === false, 120);
  expect(part(chart, 'toolbar')?.hidden, 'the chart drew').to.equal(false);
  return chart;
}

async function openAI(grid: Grid): Promise<ApexGridAI> {
  grid.toolbarActions.find((a) => a.id === 'ask-ai')!.run();
  const ai = document.body.querySelector<ApexGridAI>('apex-grid-ai')!;
  await ai.updateComplete;
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

/** Press `key` on `target` `times` times (synthetic: quick, for the clamping loops). */
function press(target: Element, key: string, times: number, shiftKey = false): void {
  for (let i = 0; i < times; i += 1) keydown(target, key, { shiftKey });
}

const center = (el: Element): [number, number] => {
  const r = el.getBoundingClientRect();
  return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];
};

/** A real pointer drag from the centre of `el` by (dx, dy). */
async function drag(el: Element, dx: number, dy: number): Promise<void> {
  const [x, y] = center(el);
  await sendMouse({ type: 'move', position: [x, y] });
  await sendMouse({ type: 'down' });
  await sendMouse({ type: 'move', position: [x + dx, y + dy] });
  await sendMouse({ type: 'up' });
}

describe('Floating panels move and resize from the keyboard', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridChart.register();
    ApexGridAI.register();
  });
  afterEach(async () => {
    document.documentElement.removeAttribute('dir');
    for (const el of document.body.querySelectorAll('apex-grid-chart, apex-grid-ai')) el.remove();
    fixtureCleanup();
    await resetMouse();
  });

  const openers = [
    { name: 'chart panel', open: openChart },
    { name: 'AI panel', open: openAI },
  ] as const;

  for (const { name, open } of openers) {
    describe(name, () => {
      it('has a named Move panel control in the header and a Resize panel grip', async () => {
        const grid = await mount();
        const panel = await open(grid);
        const move = moveHandle(panel);
        expect(move, 'move control').to.exist;
        expect(move.localName).to.equal('button');
        expect(move.getAttribute('aria-label')).to.equal('Move panel');
        expect(move.getAttribute('aria-description')).to.equal(
          'Use the arrow keys to move the panel. Hold Shift for larger steps.'
        );
        expect(part(panel, 'header')!.contains(move), 'in the header').to.equal(true);
        const grip = resizeHandle(panel);
        expect(grip, 'resize grip').to.exist;
        expect(grip.localName).to.equal('button');
        expect(grip.getAttribute('aria-label')).to.equal('Resize panel');
        expect(grip.getAttribute('aria-description')).to.equal(
          'Use the arrow keys to resize the panel. Hold Shift for larger steps.'
        );
        expect(box(panel).contains(grip), 'inside the panel').to.equal(true);
        // The grip sits in the bottom-right (inline-end) corner.
        const r = rectOf(panel);
        const g = grip.getBoundingClientRect();
        expect(g.right).to.be.closeTo(r.right, 4);
        expect(g.bottom).to.be.closeTo(r.bottom, 4);
        // The native corner is gone: the grip replaces it, so there is one handle, not two.
        expect(getComputedStyle(box(panel)).resize).to.equal('none');
      });

      it('Arrow keys move the panel by 10px, Shift+Arrow by 50px', async () => {
        const grid = await mount();
        const panel = await open(grid);
        const start = rectOf(panel);
        moveHandle(panel).focus();
        await sendKeys({ press: 'ArrowLeft' });
        expect(rectOf(panel).left).to.be.closeTo(start.left - STEP, 0.5);
        expect(rectOf(panel).top).to.be.closeTo(start.top, 0.5);
        await sendKeys({ press: 'Shift+ArrowUp' });
        expect(rectOf(panel).top).to.be.closeTo(start.top - BIG, 0.5);
        await sendKeys({ press: 'ArrowDown' });
        expect(rectOf(panel).top).to.be.closeTo(start.top - BIG + STEP, 0.5);
        await sendKeys({ press: 'Shift+ArrowLeft' });
        await sendKeys({ press: 'ArrowRight' });
        expect(rectOf(panel).left).to.be.closeTo(start.left - BIG, 0.5);
        // Moving keeps the size.
        expect(rectOf(panel).width).to.be.closeTo(start.width, 0.5);
        expect(rectOf(panel).height).to.be.closeTo(start.height, 0.5);
        // The page does not scroll, and other keys are left alone.
        expect(keydown(moveHandle(panel), 'ArrowLeft').defaultPrevented).to.equal(true);
        expect(keydown(moveHandle(panel), 'a').defaultPrevented).to.equal(false);
        expect(
          keydown(moveHandle(panel), 'ArrowLeft', { ctrlKey: true }).defaultPrevented
        ).to.equal(false);
      });

      it('keeps the panel inside the viewport', async () => {
        const grid = await mount();
        const panel = await open(grid);
        const move = moveHandle(panel);
        const { width, height } = rectOf(panel);
        press(move, 'ArrowUp', 40, true);
        press(move, 'ArrowLeft', 40, true);
        expect(rectOf(panel).top).to.equal(0);
        expect(rectOf(panel).left).to.equal(0);
        press(move, 'ArrowDown', 40, true);
        press(move, 'ArrowRight', 40, true);
        const vp = viewport();
        expect(rectOf(panel).bottom).to.be.closeTo(vp.height, 0.5);
        expect(rectOf(panel).right).to.be.closeTo(vp.width, 0.5);
        expect(rectOf(panel).width).to.be.closeTo(width, 0.5);
        expect(rectOf(panel).height).to.be.closeTo(height, 0.5);
      });

      it('Arrow keys on the grip resize by 10px, Shift by 50px, top-left fixed', async () => {
        const grid = await mount();
        const panel = await open(grid);
        const start = rectOf(panel);
        resizeHandle(panel).focus();
        await sendKeys({ press: 'ArrowLeft' });
        expect(rectOf(panel).width).to.be.closeTo(start.width - STEP, 0.5);
        await sendKeys({ press: 'Shift+ArrowUp' });
        expect(rectOf(panel).height).to.be.closeTo(start.height - BIG, 0.5);
        await sendKeys({ press: 'ArrowDown' });
        expect(rectOf(panel).height).to.be.closeTo(start.height - BIG + STEP, 0.5);
        await sendKeys({ press: 'ArrowRight' });
        expect(rectOf(panel).width).to.be.closeTo(start.width, 0.5);
        expect(rectOf(panel).left).to.be.closeTo(start.left, 0.5);
        expect(rectOf(panel).top).to.be.closeTo(start.top, 0.5);
        expect(keydown(resizeHandle(panel), 'Enter').defaultPrevented).to.equal(false);
      });

      it('clamps a resize at the minimum size and at the viewport edge', async () => {
        const grid = await mount();
        const panel = await open(grid);
        const grip = resizeHandle(panel);
        press(grip, 'ArrowLeft', 40, true);
        press(grip, 'ArrowUp', 40, true);
        expect(rectOf(panel).width).to.be.closeTo(MIN_WIDTH, 0.5);
        expect(rectOf(panel).height).to.be.closeTo(MIN_HEIGHT, 0.5);
        press(grip, 'ArrowRight', 40, true);
        press(grip, 'ArrowDown', 40, true);
        const vp = viewport();
        const r = rectOf(panel);
        expect(r.right).to.be.at.most(vp.width + 0.5);
        expect(r.bottom).to.be.at.most(vp.height + 0.5);
        // Against the edge, or at the panel's CSS max size, whichever comes first.
        const css = getComputedStyle(box(panel));
        const maxWidth = Number.parseFloat(css.maxWidth) || Number.POSITIVE_INFINITY;
        expect(Math.min(vp.width - r.left, maxWidth)).to.be.closeTo(r.width, 0.5);
      });

      it('in RTL, Left and Right follow the screen and the grip sits bottom-left', async () => {
        document.documentElement.dir = 'rtl';
        const grid = await mount();
        const panel = await open(grid);
        const start = rectOf(panel);
        const grip = resizeHandle(panel);
        const g = grip.getBoundingClientRect();
        expect(g.left).to.be.closeTo(start.left, 4);
        expect(g.bottom).to.be.closeTo(start.bottom, 4);
        moveHandle(panel).focus();
        await sendKeys({ press: 'ArrowLeft' });
        expect(rectOf(panel).left).to.be.closeTo(start.left - STEP, 0.5);
        await sendKeys({ press: 'ArrowRight' });
        expect(rectOf(panel).left).to.be.closeTo(start.left, 0.5);
        // The grip on the left grows the panel leftward: its right edge stays put.
        grip.focus();
        await sendKeys({ press: 'ArrowLeft' });
        expect(rectOf(panel).width).to.be.closeTo(start.width + STEP, 0.5);
        expect(rectOf(panel).right).to.be.closeTo(start.right, 0.5);
        await sendKeys({ press: 'Shift+ArrowRight' });
        expect(rectOf(panel).width).to.be.closeTo(start.width + STEP - BIG, 0.5);
        expect(rectOf(panel).right).to.be.closeTo(start.right, 0.5);
        // A pointer drag on the grip grows it leftward too.
        await drag(grip, -30, 0);
        expect(rectOf(panel).width).to.be.closeTo(start.width + STEP - BIG + 30, 1);
        expect(rectOf(panel).right).to.be.closeTo(start.right, 0.5);
      });

      it('announces the new position and size once the keys stop', async () => {
        const grid = await mount();
        const panel = await open(grid);
        const said: string[] = [];
        grid.announce = (message: string) => {
          said.push(message);
        };
        const move = moveHandle(panel);
        press(move, 'ArrowLeft', 3);
        expect(said, 'not on every key').to.eql([]);
        await wait(700);
        const r = rectOf(panel);
        expect(said).to.eql([`Panel moved to ${Math.round(r.left)}, ${Math.round(r.top)}`]);
        press(resizeHandle(panel), 'ArrowLeft', 2);
        await wait(700);
        const s = rectOf(panel);
        expect(said[1]).to.equal(
          `Panel resized to ${Math.round(s.width)} by ${Math.round(s.height)}`
        );
        expect(said.length).to.equal(2);
      });

      it('a pointer drag on the header still moves it, and the grip resizes it', async () => {
        const grid = await mount();
        const panel = await open(grid);
        const start = rectOf(panel);
        await drag(moveHandle(panel), -40, -30);
        expect(rectOf(panel).left).to.be.closeTo(start.left - 40, 1);
        expect(rectOf(panel).top).to.be.closeTo(start.top - 30, 1);
        const moved = rectOf(panel);
        await drag(resizeHandle(panel), -50, -20);
        expect(rectOf(panel).width).to.be.closeTo(moved.width - 50, 1);
        expect(rectOf(panel).height).to.be.closeTo(moved.height - 20, 1);
        expect(rectOf(panel).left).to.be.closeTo(moved.left, 1);
        // Dragged far past the corner, the panel stays on screen.
        await drag(moveHandle(panel), -2000, -2000);
        expect(rectOf(panel).left).to.equal(0);
        expect(rectOf(panel).top).to.equal(0);
      });

      it('a right-button drag on the header or the grip does nothing', async () => {
        const grid = await mount();
        const panel = await open(grid);
        const start = rectOf(panel);
        for (const target of [part(panel, 'header')!, resizeHandle(panel)]) {
          // Synthetic pointers have no capture to take.
          target.setPointerCapture = () => {};
          const [x, y] = center(target);
          const at = (type: string, dx: number, dy: number) =>
            target.dispatchEvent(
              new PointerEvent(type, {
                pointerId: 3,
                button: type === 'pointermove' ? -1 : 2,
                clientX: x + dx,
                clientY: y + dy,
                bubbles: true,
              })
            );
          at('pointerdown', 0, 0);
          at('pointermove', -60, -40);
          at('pointerup', -60, -40);
        }
        const r = rectOf(panel);
        expect([r.left, r.top, r.width, r.height]).to.eql([
          start.left,
          start.top,
          start.width,
          start.height,
        ]);
      });

      it('switching to inline drops the moved position and size', async () => {
        const grid = await mount();
        const panel = await open(grid);
        press(moveHandle(panel), 'ArrowLeft', 2);
        press(resizeHandle(panel), 'ArrowUp', 1);
        expect(box(panel).style.width).to.not.equal('');
        panel.mode = 'inline';
        await panel.updateComplete;
        const style = box(panel).style;
        for (const prop of ['left', 'top', 'right', 'bottom', 'width', 'height']) {
          expect(style.getPropertyValue(prop), prop).to.equal('');
        }
      });

      it('passes axe with the move and resize controls present', async () => {
        const grid = await mount();
        const panel = await open(grid);
        expect(moveHandle(panel)).to.exist;
        expect(await axeViolations(panel)).to.eql([]);
      });

      it('localizes the controls', async () => {
        const grid = await mount(esLocale);
        const panel = await open(grid);
        expect(moveHandle(panel).getAttribute('aria-label')).to.equal('Mover panel');
        expect(resizeHandle(panel).getAttribute('aria-label')).to.equal('Cambiar tamaño del panel');
      });
    });
  }

  it('the chart refits when the grip resizes the panel', async () => {
    const grid = await mount();
    const chart = await openChart(grid);
    const canvas = part(chart, 'canvas')!;
    const before = canvas.getBoundingClientRect().height;
    press(resizeHandle(chart), 'ArrowUp', 1, true);
    await untilFrame(() => canvas.getBoundingClientRect().height < before - BIG + 1);
    expect(canvas.getBoundingClientRect().height).to.be.closeTo(before - BIG, 1);
  });

  it('a panel without a grid announces through its own live region', async () => {
    const ai = document.createElement('apex-grid-ai') as ApexGridAI;
    document.body.appendChild(ai);
    ai.show();
    await ai.updateComplete;
    press(moveHandle(ai), 'ArrowUp', 1);
    await wait(700);
    await ai.updateComplete;
    const region = ai.shadowRoot!.querySelector('[data-panel-announcer]')!;
    expect(region.getAttribute('aria-live')).to.equal('polite');
    const r = rectOf(ai);
    expect(region.textContent?.trim()).to.equal(
      `Panel moved to ${Math.round(r.left)}, ${Math.round(r.top)}`
    );
  });

  for (const tag of ['apex-grid-ai', 'apex-grid-chart'] as const) {
    it(`${tag}: closing an app-owned dialog drops a pending announcement`, async () => {
      const grid = await mount();
      const said: string[] = [];
      grid.announce = (message: string) => {
        said.push(message);
      };
      const panel = document.createElement(tag) as Panel;
      panel.mode = 'dialog';
      panel.grid = grid as never;
      document.body.appendChild(panel);
      panel.show();
      await panel.updateComplete;
      keydown(moveHandle(panel), 'ArrowLeft');
      keydown(moveHandle(panel), 'Escape');
      expect(panel.open).to.equal(false);
      expect(panel.isConnected, 'an app-owned panel stays in the page').to.equal(true);
      await wait(700);
      expect(said).to.eql([]);
    });
  }

  it('a percentage max size is a share of the viewport, not pixels', async () => {
    const sheet = document.createElement('style');
    sheet.textContent = 'apex-grid-ai::part(panel) { max-inline-size: 60%; max-block-size: 80%; }';
    document.head.appendChild(sheet);
    try {
      const grid = await mount();
      const ai = await openAI(grid);
      const start = rectOf(ai);
      press(resizeHandle(ai), 'ArrowLeft', 1);
      expect(rectOf(ai).width).to.be.closeTo(start.width - STEP, 0.5);
      expect(rectOf(ai).height).to.be.closeTo(start.height, 0.5);
      // From the left edge there is room for the whole 60% of the viewport, and no more.
      press(moveHandle(ai), 'ArrowLeft', 40, true);
      press(resizeHandle(ai), 'ArrowRight', 40, true);
      expect(rectOf(ai).width).to.be.closeTo(viewport().width * 0.6, 0.5);
    } finally {
      sheet.remove();
    }
  });

  it('inline panels have no move or resize controls', async () => {
    const ai = await fixture<ApexGridAI>(html`<apex-grid-ai mode="inline"></apex-grid-ai>`);
    expect(moveHandle(ai)).to.equal(null);
    expect(resizeHandle(ai)).to.equal(null);
    const chart = await fixture<ApexGridChart>(
      html`<apex-grid-chart mode="inline"></apex-grid-chart>`
    );
    expect(moveHandle(chart)).to.equal(null);
    expect(resizeHandle(chart)).to.equal(null);
  });
});
