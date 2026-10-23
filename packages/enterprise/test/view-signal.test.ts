import { expect, fixture, fixtureCleanup, html, nextFrame, waitUntil } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  RANGE_SELECTION_MODULE_ID,
  type RangeSelectionController,
} from '../src/features/range-selection.js';
import {
  ApexGridChart,
  ApexGridEnterprise,
  enterpriseModules,
  VIEW_CHANGED_EVENT,
} from '../src/index.js';

// The apex-view-changed signal: one per update cycle however many cells a
// bulk write touches, a signature that covers what a view-bound chart plots,
// and scroll handling that never materialises the selected range.

(window as unknown as { Apex?: unknown }).Apex = { chart: { animations: { enabled: false } } };

interface Row {
  id: number;
  region: string;
  name: string;
  q1: number;
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number' },
  { key: 'region', type: 'string' },
  { key: 'name', type: 'string', editable: true },
  { key: 'q1', type: 'number', editable: true },
];

function makeData(length: number): Row[] {
  return Array.from({ length }, (_, i) => ({
    id: i,
    region: i % 2 ? 'EMEA' : 'AMER',
    name: `N${i}`,
    q1: i,
  }));
}

function sizedParent(): HTMLElement {
  const node = document.createElement('div');
  node.style.height = '400px';
  return node;
}

async function settle(grid: ApexGridEnterprise<Row>): Promise<void> {
  await grid.updateComplete;
  await nextFrame();
  await nextFrame();
  await grid.updateComplete;
}

async function mount(
  data: Row[],
  extra: { pagination?: object; groupBy?: string[]; aggregations?: object } = {}
): Promise<ApexGridEnterprise<Row>> {
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise
      .data=${data}
      .columns=${columns}
      .editing=${{ enabled: true, history: { enabled: true } }}
      .pagination=${extra.pagination ?? { enabled: false }}
      .groupBy=${extra.groupBy ?? []}
      .aggregations=${extra.aggregations ?? {}}
    ></apex-grid-enterprise>`,
    { parentNode: sizedParent() }
  );
  await settle(grid);
  return grid;
}

/** Count apex-view-changed from now on. */
function countSignals(grid: ApexGridEnterprise<Row>): { readonly count: number } {
  const counter = { count: 0 };
  (grid as EventTarget).addEventListener(VIEW_CHANGED_EVENT, () => {
    counter.count += 1;
  });
  return counter;
}

/** Dock a view-bound chart and count the model reads its redraws make. */
async function dockChart(grid: ApexGridEnterprise<Row>): Promise<{ readonly reads: number }> {
  const panel = await fixture<ApexGridChart>(
    html`<apex-grid-chart mode="inline" source="view" .grid=${grid as never}></apex-grid-chart>`
  );
  await nextFrame();
  await panel.updateComplete;
  await settle(grid);
  const probe = { reads: 0 };
  const original = grid.getViewChartModel.bind(grid);
  grid.getViewChartModel = (...args) => {
    probe.reads += 1;
    return original(...args);
  };
  return probe;
}

describe('apex-view-changed signal', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridChart.register();
  });
  afterEach(() => fixtureCleanup());

  describe('bulk writes signal once (sweep-data-at-scale-1)', () => {
    it('a 1,000-cell applyEdits with a docked chart signals and scans once', async () => {
      const grid = await mount(makeData(2000));
      const chart = await dockChart(grid);
      let fieldScans = 0;
      const original = grid.getChartFields.bind(grid);
      grid.getChartFields = () => {
        fieldScans += 1;
        return original();
      };
      const signals = countSignals(grid);
      const tally = grid.applyEdits(
        Array.from({ length: 1000 }, (_, i) => ({
          rowIndex: i,
          column: 'q1' as const,
          value: -i - 1,
        }))
      );
      expect(tally.applied).to.equal(1000);
      await settle(grid);
      expect(signals.count, 'apex-view-changed per batch').to.equal(1);
      expect(fieldScans, 'getChartFields per batch').to.be.at.most(1);
      await waitUntil(() => chart.reads > 0, 'the chart redrew');
    });

    it('a single edit signals exactly once, by the end of the update it requests', async () => {
      const grid = await mount(makeData(20));
      const chart = await dockChart(grid);
      const signals = countSignals(grid);
      grid.applyEdits([{ rowIndex: 3, column: 'q1', value: 999 }]);
      await grid.updateComplete;
      expect(signals.count, 'signalled after the update').to.equal(1);
      await settle(grid);
      expect(signals.count, 'and only once').to.equal(1);
      await waitUntil(() => chart.reads > 0, 'the chart redrew');
    });

    it('a range paste signals once and redraws the chart', async () => {
      const grid = await mount(makeData(50));
      const chart = await dockChart(grid);
      grid.selectRange({ row: 0, column: 'name' });
      await settle(grid);
      const signals = countSignals(grid);
      const reads = chart.reads;
      grid.pasteText(Array.from({ length: 20 }, (_, i) => `P${i}\t${i * 10}`).join('\n'));
      await settle(grid);
      expect(grid.data[19].q1).to.equal(190);
      expect(signals.count, 'apex-view-changed per paste').to.equal(1);
      await waitUntil(() => chart.reads > reads, 'the chart redrew');
    });

    it('a fill drag signals once', async () => {
      const grid = await mount(makeData(50));
      grid.selectRange({ row: 0, column: 'q1' });
      await settle(grid);
      const signals = countSignals(grid);
      grid.fillTo({ row: 30, column: 'q1' });
      await settle(grid);
      expect(signals.count, 'apex-view-changed per fill').to.equal(1);
    });

    it('undo and redo of a batch each signal once and redraw the chart', async () => {
      const grid = await mount(makeData(500));
      const chart = await dockChart(grid);
      grid.applyEdits(
        Array.from({ length: 300 }, (_, i) => ({ rowIndex: i, column: 'q1' as const, value: -1 }))
      );
      await settle(grid);
      const signals = countSignals(grid);
      const reads = chart.reads;
      grid.undo();
      await settle(grid);
      expect(grid.data[5].q1).to.equal(5);
      expect(signals.count, 'apex-view-changed per undo').to.equal(1);
      await waitUntil(() => chart.reads > reads, 'the chart redrew after undo');
      grid.redo();
      await settle(grid);
      expect(grid.data[5].q1).to.equal(-1);
      expect(signals.count, 'apex-view-changed per redo').to.equal(2);
    });
  });

  describe('the signature follows what a view chart plots (ent-grid-sync-4)', () => {
    it('a page change with the same page size signals once', async () => {
      const grid = await mount(makeData(10), { pagination: { enabled: true, pageSize: 3 } });
      const signals = countSignals(grid);
      grid.page = 1;
      await settle(grid);
      expect(signals.count).to.equal(1);
    });

    it('hiding and showing a column each signal once', async () => {
      const grid = await mount(makeData(10));
      const signals = countSignals(grid);
      grid.columns = grid.columns.map((c) => (c.key === 'q1' ? { ...c, hidden: true } : c));
      await settle(grid);
      expect(signals.count, 'hide').to.equal(1);
      grid.columns = grid.columns.map((c) => (c.key === 'q1' ? { ...c, hidden: false } : c));
      await settle(grid);
      expect(signals.count, 'show').to.equal(2);
    });

    it('reordering the columns signals once', async () => {
      const grid = await mount(makeData(10));
      const signals = countSignals(grid);
      grid.columns = [...grid.columns].reverse();
      await settle(grid);
      expect(signals.count).to.equal(1);
    });

    it('an aggregation change while grouped signals once', async () => {
      const grid = await mount(makeData(10), {
        groupBy: ['region'],
        aggregations: { q1: ['sum'] },
      });
      const signals = countSignals(grid);
      grid.aggregations = { q1: ['avg'] };
      await settle(grid);
      expect(signals.count).to.equal(1);
    });

    it('an unchanged view does not signal', async () => {
      const grid = await mount(makeData(10), { pagination: { enabled: true, pageSize: 3 } });
      const signals = countSignals(grid);
      grid.requestUpdate();
      await settle(grid);
      grid.columns = grid.columns.map((c) => ({ ...c }));
      await settle(grid);
      // Aggregations are not plotted by a flat view.
      grid.aggregations = { q1: ['avg'] };
      await settle(grid);
      expect(signals.count).to.equal(0);
    });
  });

  describe('chart affordance on scroll (ent-grid-core-4)', () => {
    it('does not read the range matrix, and runs at most once per frame', async () => {
      const grid = await mount(makeData(5000));
      const range = (
        grid as unknown as {
          stateController: { module(id: string): RangeSelectionController<Row> | undefined };
        }
      ).stateController.module(RANGE_SELECTION_MODULE_ID)!;
      grid.selectRange({ row: 0, column: 'id' }, { row: 4999, column: 'q1' });
      await settle(grid);

      let matrixReads = 0;
      const activeGrid = range.getActiveGrid.bind(range);
      let checks = 0;
      range.getActiveGrid = () => {
        matrixReads += 1;
        checks += 1;
        return activeGrid();
      };
      const forBounds = range.gridForBounds.bind(range);
      range.gridForBounds = (bounds) => {
        matrixReads += 1;
        return forBounds(bounds);
      };
      const bounds = range.getSelectionBounds.bind(range);
      range.getSelectionBounds = () => {
        checks += 1;
        return bounds();
      };

      for (let i = 0; i < 5; i += 1) grid.dispatchEvent(new Event('scroll'));
      expect(checks, 'nothing runs inside the scroll event').to.equal(0);
      await nextFrame();
      expect(checks, 'one check for the frame').to.equal(1);

      grid.scrollTop = 600;
      await nextFrame();
      await nextFrame();
      expect(matrixReads, 'the selected range was never materialised').to.equal(0);
      const button = [...document.body.querySelectorAll<HTMLButtonElement>(':scope > button')].find(
        (b) => b.style.position === 'fixed'
      );
      expect(button?.style.display, 'the affordance still shows').to.equal('block');
    });

    it('hides the affordance when the range covers no data row', async () => {
      const grid = await mount(makeData(10), { groupBy: ['region'] });
      // Row 0 is the first group header.
      grid.selectRange({ row: 0, column: 'id' });
      await settle(grid);
      grid.dispatchEvent(new Event('scroll'));
      await nextFrame();
      const button = [...document.body.querySelectorAll<HTMLButtonElement>(':scope > button')].find(
        (b) => b.style.position === 'fixed'
      );
      expect(button?.style.display ?? 'none').to.equal('none');
    });
  });
});
