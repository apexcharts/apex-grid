import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  ApexGridChart,
  ApexGridEnterprise,
  type ChartModel,
  enterpriseModules,
} from '../src/index.js';

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

/** A panel that is never connected: selectCategory runs without an ApexCharts render. */
function detachedPanel(grid: ApexGridEnterprise<Row>) {
  const panel = document.createElement('apex-grid-chart') as ApexGridChart;
  panel.grid = grid as never;
  return panel;
}

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

  describe('cross-filter', () => {
    const nameExpressions = (grid: ApexGridEnterprise<Row>) =>
      grid.filterExpressions.filter((f) => f.key === 'name');

    it('clicking another category switches the filter', async () => {
      const grid = await mountGrid();
      grid.selectRange({ row: 0, column: 'name' }, { row: 2, column: 'q1' });
      const panel = detachedPanel(grid);
      panel.selectCategory(0);
      await grid.updateComplete;
      expect(grid.dataView.map((r) => r.name)).to.eql(['A']);
      panel.selectCategory(1);
      await grid.updateComplete;
      expect(nameExpressions(grid).length).to.equal(1);
      expect(grid.dataView.map((r) => r.name)).to.eql(['B']);
      panel.selectCategory(1); // re-click clears
      await grid.updateComplete;
      expect(nameExpressions(grid).length).to.equal(0);
      expect(grid.dataView.length).to.equal(3);
    });

    it('clearing the cross-filter keeps a user filter on the same column', async () => {
      const grid = await mountGrid();
      grid.selectRange({ row: 0, column: 'name' }, { row: 2, column: 'q1' });
      grid.filter({ key: 'name', condition: 'contains', searchTerm: 'A' } as never);
      const panel = detachedPanel(grid);
      panel.selectCategory(0);
      expect(nameExpressions(grid).length).to.equal(2);
      panel.selectCategory(0);
      await grid.updateComplete;
      const left = nameExpressions(grid);
      expect(left.length).to.equal(1);
      expect(left[0].searchTerm).to.equal('A');
    });

    it('re-clicking a category filters again after the grid filter was cleared', async () => {
      const grid = await mountGrid();
      grid.selectRange({ row: 0, column: 'name' }, { row: 2, column: 'q1' });
      const panel = detachedPanel(grid);
      panel.selectCategory(0);
      await grid.updateComplete;
      grid.clearFilter();
      await grid.updateComplete;
      expect(grid.dataView.length).to.equal(3);
      panel.selectCategory(0);
      await grid.updateComplete;
      expect(grid.dataView.map((r) => r.name)).to.eql(['A']);
    });

    it('clears the filter it installed after the range moves off the category', async () => {
      const grid = await mountGrid();
      grid.selectRange({ row: 0, column: 'region' }, { row: 2, column: 'q1' });
      const panel = detachedPanel(grid);
      panel.crossFilter = true;
      panel.mode = 'inline';
      panel.selectCategory(0);
      expect(grid.filterExpressions.some((f) => f.key === 'region')).to.equal(true);
      // The user clicks a numeric cell: the range has no category column any more.
      grid.selectRange({ row: 0, column: 'q1' }, { row: 0, column: 'q1' });
      document.body.appendChild(panel);
      await settle(panel);
      panel.remove();
      expect(grid.filterExpressions.some((f) => f.key === 'region')).to.equal(false);
    });

    it('rebinding the grid clears the filter on the old grid only', async () => {
      const gridA = await mountGrid();
      const gridB = await mountGrid();
      const empty: ChartModel = { categories: [], series: [] };
      for (const g of [gridA, gridB]) {
        g.selectRange({ row: 0, column: 'name' }, { row: 1, column: 'q1' });
        g.getChartModel = () => empty;
      }
      const panel = await fixture<ApexGridChart>(
        html`<apex-grid-chart mode="inline" .grid=${gridA as never}></apex-grid-chart>`
      );
      await nextFrame();
      panel.selectCategory(0);
      expect(nameExpressions(gridA).length).to.equal(1);
      panel.grid = gridB as never;
      await panel.updateComplete;
      expect(nameExpressions(gridA).length, 'old grid released').to.equal(0);
      gridB.filter({ key: 'name', condition: 'contains', searchTerm: 'B' } as never);
      panel.remove();
      expect(nameExpressions(gridB).length, 'user filter on the new grid kept').to.equal(1);
    });
  });

  describe('lifecycle', () => {
    it('a panel moved in the DOM rebinds and renders again', async () => {
      const grid = await mountGrid();
      const panel = await fixture<ApexGridChart>(
        html`<apex-grid-chart mode="inline" source="view" type="column" .grid=${grid as never}></apex-grid-chart>`
      );
      expect(await until(() => panel.getChart() != null)).to.equal(true);
      const other = document.createElement('div');
      document.body.appendChild(other);
      try {
        other.appendChild(panel);
        expect(await until(() => panel.getChart() != null), 'chart rebuilt').to.equal(true);
        let reads = 0;
        const original = grid.getViewChartModel.bind(grid);
        grid.getViewChartModel = (definition) => {
          reads += 1;
          return original(definition);
        };
        grid.dispatchEvent(new CustomEvent('apex-view-changed'));
        expect(await until(() => reads > 0), 'live signal still redraws').to.equal(true);
      } finally {
        other.remove();
      }
    });

    it('a panel removed mid-render stops cleanly', async () => {
      const grid = await mountGrid();
      const panel = document.createElement('apex-grid-chart') as ApexGridChart;
      panel.mode = 'inline';
      panel.source = 'view';
      panel.grid = grid as never;
      document.body.appendChild(panel);
      await panel.updateComplete;
      const pending = panel.refresh();
      panel.remove();
      let error: unknown = null;
      await pending.catch((e) => {
        error = e;
      });
      for (let i = 0; i < 5; i += 1) await nextFrame();
      expect(String(error)).to.equal('null');
      expect(panel.getChart()).to.equal(null);
    });
  });

  describe('grid signals', () => {
    it('a snapshot dialog chart ignores range changes', async () => {
      const grid = await mountGrid();
      grid.selectRange({ row: 0, column: 'name' }, { row: 1, column: 'q1' });
      key(grid, { key: 'F1', altKey: true });
      const panel = document.querySelector('apex-grid-chart') as ApexGridChart;
      expect(panel.staticModel).to.not.equal(null);
      expect(await until(() => panel.getChart() != null)).to.equal(true);
      await settle(panel);
      let fields = 0;
      let renders = 0;
      const original = grid.getChartFields.bind(grid);
      grid.getChartFields = () => {
        fields += 1;
        return original();
      };
      panel.addEventListener('apex-chart-created', () => {
        renders += 1;
      });
      for (let r = 0; r < 3; r += 1) {
        grid.selectRange({ row: 0, column: 'name' }, { row: r, column: 'q1' });
      }
      grid.dispatchEvent(new CustomEvent('apex-view-changed'));
      await settle(panel);
      expect(fields).to.equal(0);
      expect(renders).to.equal(0);
    });

    it('reassigning a snapshot model (the range handle) reads no fields', async () => {
      const grid = await mountGrid();
      grid.selectRange({ row: 0, column: 'name' }, { row: 1, column: 'q1' });
      key(grid, { key: 'F1', altKey: true });
      const panel = document.querySelector('apex-grid-chart') as ApexGridChart;
      expect(await until(() => panel.getChart() != null)).to.equal(true);
      await settle(panel);
      let fields = 0;
      const original = grid.getChartFields.bind(grid);
      grid.getChartFields = () => {
        fields += 1;
        return original();
      };
      for (let r = 0; r < 3; r += 1) {
        panel.staticModel = { ...(panel.staticModel as ChartModel) };
        await settle(panel, 2);
      }
      expect(fields).to.equal(0);
    });

    it('a live view chart skips range changes and reads fields once per frame', async () => {
      const grid = await mountGrid();
      const panel = await fixture<ApexGridChart>(
        html`<apex-grid-chart mode="inline" source="view" .grid=${grid as never}></apex-grid-chart>`
      );
      expect(await until(() => panel.getChart() != null)).to.equal(true);
      await settle(panel);
      let fields = 0;
      let models = 0;
      const originalFields = grid.getChartFields.bind(grid);
      grid.getChartFields = () => {
        fields += 1;
        return originalFields();
      };
      const originalModel = grid.getViewChartModel.bind(grid);
      grid.getViewChartModel = (definition) => {
        models += 1;
        return originalModel(definition);
      };
      for (let r = 0; r < 3; r += 1) {
        grid.selectRange({ row: 0, column: 'name' }, { row: r, column: 'q1' });
      }
      await settle(panel);
      expect(fields, 'range changes read no fields').to.equal(0);
      expect(models, 'range changes leave a view chart alone').to.equal(0);

      for (let i = 0; i < 5; i += 1) grid.dispatchEvent(new CustomEvent('apex-view-changed'));
      expect(fields, 'not read synchronously').to.equal(0);
      await settle(panel);
      expect(fields, 'one read for the burst').to.equal(1);
      expect(models).to.equal(1);
    });

    it('a snapshot panel turned live again re-reads the fields', async () => {
      const grid = await mountGrid();
      const panel = await fixture<ApexGridChart>(
        html`<apex-grid-chart mode="inline" .grid=${grid as never}></apex-grid-chart>`
      );
      panel.staticModel = grid.getChartModel() as ChartModel;
      await settle(panel);
      grid.columns = [...columns, { key: 'q2', type: 'number', headerText: 'Q2' }] as never;
      await grid.updateComplete;
      await settle(panel);
      const fields = () => (panel as unknown as { dataFields: { key: string }[] }).dataFields;
      expect(fields().some((f) => f.key === 'q2')).to.equal(false);
      panel.staticModel = null;
      expect(
        await until(() => fields().some((f) => f.key === 'q2')),
        'q2 added while a snapshot is listed once live'
      ).to.equal(true);
    });

    it('a selection chart still follows range changes', async () => {
      const grid = await mountGrid();
      const panel = await fixture<ApexGridChart>(
        html`<apex-grid-chart mode="inline" .grid=${grid as never}></apex-grid-chart>`
      );
      await settle(panel);
      let models = 0;
      const original = grid.getChartModel.bind(grid);
      grid.getChartModel = (definition) => {
        models += 1;
        return original(definition);
      };
      grid.selectRange({ row: 0, column: 'name' }, { row: 1, column: 'q1' });
      expect(await until(() => models > 0)).to.equal(true);
    });
  });
});
