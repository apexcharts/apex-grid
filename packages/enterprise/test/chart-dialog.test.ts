import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { ApexGridChart, ApexGridEnterprise, enterpriseModules } from '../src/index.js';

interface Row {
  name: string;
  region: string;
  q1: number;
}
const data: Row[] = [
  { name: 'A', region: 'North', q1: 10 },
  { name: 'B', region: 'South', q1: 20 },
  { name: 'C', region: 'North', q1: 30 },
];
const columns: ColumnConfiguration<Row>[] = [
  { key: 'name', type: 'string', headerText: 'Name' },
  { key: 'region', type: 'string', headerText: 'Region' },
  { key: 'q1', type: 'number', headerText: 'Q1' },
];

// No render animation: its async callbacks can outlive a removed chart.
(window as unknown as { Apex?: unknown }).Apex = { chart: { animations: { enabled: false } } };

function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '500px';
  return node;
}

async function mountGrid(rows: Row[] = data) {
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise .data=${rows.map((r) => ({ ...r }))} .columns=${columns}></apex-grid-enterprise>`,
    { parentNode: sizedParent() }
  );
  await grid.updateComplete;
  await nextFrame();
  return grid;
}

async function settle(panel: ApexGridChart, frames = 6) {
  for (let i = 0; i < frames; i += 1) {
    await nextFrame();
    await panel.updateComplete;
  }
}

async function until(check: () => boolean, frames = 60) {
  for (let i = 0; i < frames && !check(); i += 1) await nextFrame();
  return check();
}

const part = (panel: ApexGridChart, name: string) =>
  panel.querySelector<HTMLElement>(`[part="${name}"]`)!;

const key = (target: Element, init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

describe('chart dialog', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridChart.register();
  });
  afterEach(() => {
    for (const el of document.querySelectorAll('apex-grid-chart')) el.remove();
    fixtureCleanup();
  });

  describe('Escape inside a popover', () => {
    async function openDialog() {
      const grid = await mountGrid();
      const panel = await fixture<ApexGridChart>(
        html`<apex-grid-chart .grid=${grid as never}></apex-grid-chart>`
      );
      panel.show();
      await settle(panel);
      return panel;
    }

    for (const name of ['export', 'format', 'data'] as const) {
      it(`closes only the ${name} popover and focuses its toggle`, async () => {
        const panel = await openDialog();
        let closed = 0;
        panel.addEventListener('apex-chart-closed', () => {
          closed += 1;
        });
        part(panel, `${name}-button`).click();
        await panel.updateComplete;
        const menu = part(panel, `${name}-menu`);
        expect(menu.hidden, 'popover open').to.equal(false);
        const control = menu.querySelector<HTMLElement>('button, input')!;
        control.focus();
        key(control, { key: 'Escape' });
        await panel.updateComplete;
        expect(menu.hidden, 'popover closed').to.equal(true);
        expect(panel.open, 'dialog still open').to.equal(true);
        expect(closed).to.equal(0);
        expect(document.activeElement).to.equal(part(panel, `${name}-button`));

        key(part(panel, `${name}-button`), { key: 'Escape' });
        expect(panel.open, 'a second Escape closes the dialog').to.equal(false);
      });
    }

    it('keeps a grid-opened dialog chart in the document', async () => {
      const grid = await mountGrid();
      grid.selectRange({ row: 0, column: 'name' }, { row: 2, column: 'q1' });
      key(grid, { key: 'F1', altKey: true });
      const panel = document.querySelector('apex-grid-chart') as ApexGridChart;
      await settle(panel);
      part(panel, 'format-button').click();
      await panel.updateComplete;
      key(part(panel, 'format-text'), { key: 'Escape' });
      await nextFrame();
      expect(panel.isConnected).to.equal(true);
      expect(panel.open).to.equal(true);
    });

    it('closes a popover of an inline panel too', async () => {
      const grid = await mountGrid();
      const panel = await fixture<ApexGridChart>(
        html`<apex-grid-chart mode="inline" .grid=${grid as never}></apex-grid-chart>`
      );
      await settle(panel);
      part(panel, 'format-button').click();
      await panel.updateComplete;
      key(part(panel, 'format-text'), { key: 'Escape' });
      await panel.updateComplete;
      expect(part(panel, 'format-menu').hidden).to.equal(true);
    });
  });

  it('gives the Format and Data popovers a group role and a name', async () => {
    const grid = await mountGrid();
    const panel = await fixture<ApexGridChart>(
      html`<apex-grid-chart mode="inline" .grid=${grid as never}></apex-grid-chart>`
    );
    await settle(panel);
    part(panel, 'format-button').click();
    part(panel, 'data-button').click();
    await panel.updateComplete;
    for (const [name, label] of [
      ['format', 'Format'],
      ['data', 'Data'],
    ]) {
      const menu = part(panel, `${name}-menu`);
      expect(menu.getAttribute('role'), name).to.equal('group');
      expect(menu.getAttribute('aria-label'), name).to.equal(label);
      expect(part(panel, `${name}-button`).hasAttribute('aria-haspopup'), name).to.equal(false);
      await expect(menu).to.be.accessible();
    }
    expect(part(panel, 'export-button').getAttribute('aria-haspopup')).to.equal('menu');
  });

  describe('heading rename', () => {
    async function openNamed(heading?: string) {
      const grid = await mountGrid();
      const panel = await fixture<ApexGridChart>(
        html`<apex-grid-chart .grid=${grid as never} heading=${heading ?? 'Chart'}></apex-grid-chart>`
      );
      panel.show();
      await settle(panel);
      return { grid, panel };
    }

    it('leaving the auto title unchanged keeps it automatic', async () => {
      const { panel } = await openNamed();
      expect(
        await until(() => part(panel, 'heading').textContent?.trim() === 'Q1 by Name')
      ).to.equal(true);
      part(panel, 'heading').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await panel.updateComplete;
      part(panel, 'heading-input').dispatchEvent(new Event('blur'));
      await panel.updateComplete;
      expect(panel.heading).to.equal('Chart');
      panel.definition = { category: 'region' };
      expect(
        await until(() => part(panel, 'heading')?.textContent?.trim() === 'Q1 by Region')
      ).to.equal(true);
    });

    it('Escape cancels the rename and returns focus to the heading', async () => {
      const { panel } = await openNamed('Original');
      part(panel, 'heading').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await settle(panel, 1);
      const input = part(panel, 'heading-input') as HTMLInputElement;
      expect(document.activeElement).to.equal(input);
      input.value = 'Typed';
      key(input, { key: 'Escape' });
      await settle(panel, 1);
      expect(panel.heading).to.equal('Original');
      expect(panel.open, 'Escape in the rename leaves the dialog open').to.equal(true);
      expect(document.activeElement).to.equal(part(panel, 'heading'));
    });

    it('Enter commits the rename', async () => {
      const { panel } = await openNamed('Original');
      part(panel, 'heading').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await settle(panel, 1);
      const input = part(panel, 'heading-input') as HTMLInputElement;
      input.value = 'Renamed';
      key(input, { key: 'Enter' });
      await settle(panel, 1);
      expect(panel.heading).to.equal('Renamed');
      expect(document.activeElement).to.equal(part(panel, 'heading'));
    });

    for (const k of ['Enter', ' ', 'F2']) {
      it(`the heading is focusable and ${k === ' ' ? 'Space' : k} starts the rename`, async () => {
        const { panel } = await openNamed('Original');
        const heading = part(panel, 'heading');
        expect(heading.tabIndex).to.equal(0);
        expect(heading.getAttribute('role')).to.equal('button');
        heading.focus();
        expect(key(heading, { key: k }).defaultPrevented).to.equal(true);
        await settle(panel, 1);
        expect(document.activeElement).to.equal(part(panel, 'heading-input'));
      });
    }

    it('Shift+Tab from the rename input stays in the dialog', async () => {
      const { panel } = await openNamed('Original');
      part(panel, 'heading').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await settle(panel, 1);
      const input = part(panel, 'heading-input');
      expect(document.activeElement).to.equal(input);
      const event = key(input, { key: 'Tab', shiftKey: true });
      expect(event.defaultPrevented, 'the focus trap handled Shift+Tab').to.equal(true);
      expect(panel.contains(document.activeElement)).to.equal(true);
    });
  });
});
