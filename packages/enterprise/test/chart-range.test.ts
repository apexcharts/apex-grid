import { expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import type { ApexGridChart } from '../src/chart-panel.js';
import type { ChartModel } from '../src/features/chart.js';
import {
  ApexGridEnterprise,
  type ChartRangeHost,
  ChartRangeManager,
  enterpriseModules,
  type RangeBounds,
} from '../src/index.js';
import { settle } from './settle.js';

interface Row {
  region: string;
  q1: number;
  q2: number;
  q3: number;
}

const data: Row[] = [
  { region: 'North', q1: 10, q2: 20, q3: 30 },
  { region: 'South', q1: 15, q2: 25, q3: 35 },
  { region: 'East', q1: 12, q2: 22, q3: 32 },
  { region: 'West', q1: 18, q2: 28, q3: 38 },
];
const columns: ColumnConfiguration<Row>[] = [
  { key: 'region', type: 'string', headerText: 'Region' },
  { key: 'q1', type: 'number', headerText: 'Q1' },
  { key: 'q2', type: 'number', headerText: 'Q2' },
  { key: 'q3', type: 'number', headerText: 'Q3' },
];

function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '600px';
  return node;
}

async function mount() {
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise .data=${data.map((r) => ({ ...r }))} .columns=${columns}></apex-grid-enterprise>`,
    { parentNode: sizedParent() }
  );
  await settle(grid);
  return grid;
}

function rangeController(grid: ApexGridEnterprise<Row>) {
  return (
    grid as unknown as {
      stateController: {
        module(id: string): {
          selectRange(
            from: { row: number; column: string },
            to: { row: number; column: string }
          ): void;
          getSelectionBounds(): RangeBounds | null;
          getActiveGrid(): { columns: ColumnConfiguration<Row>[]; rows: unknown[][] } | null;
          gridForBounds(b: RangeBounds): { columns: ColumnConfiguration<Row>[]; rows: unknown[][] };
          boundsClientRect(b: RangeBounds): DOMRectReadOnly | null;
          cellAtPoint(x: number, y: number): { row: number; col: number } | null;
        };
      };
    }
  ).stateController.module('range-selection');
}

describe('in-grid chart range handle', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  describe('range-controller geometry helpers', () => {
    it('gridForBounds matches getActiveGrid for the active bounds', async () => {
      const grid = await mount();
      const rc = rangeController(grid);
      rc.selectRange({ row: 0, column: 'region' }, { row: 2, column: 'q2' });
      const bounds = rc.getSelectionBounds()!;
      expect(bounds).to.eql({ top: 0, bottom: 2, left: 0, right: 2 });

      const active = rc.getActiveGrid()!;
      const forBounds = rc.gridForBounds(bounds);
      expect(forBounds.columns.map((c) => String(c.key))).to.eql(
        active.columns.map((c) => String(c.key))
      );
      expect(forBounds.rows).to.eql(active.rows);
    });

    it('boundsClientRect returns a non-empty rect for a rendered range', async () => {
      const grid = await mount();
      const rc = rangeController(grid);
      rc.selectRange({ row: 0, column: 'region' }, { row: 1, column: 'q1' });
      const rect = rc.boundsClientRect(rc.getSelectionBounds()!);
      expect(rect, 'a rect is produced').to.not.be.null;
      expect(rect!.width).to.be.greaterThan(0);
      expect(rect!.height).to.be.greaterThan(0);
    });

    it('cellAtPoint round-trips a cell from its own center', async () => {
      const grid = await mount();
      const rc = rangeController(grid);
      // Center of the (row 2, q2) cell should map back to that view coordinate.
      const cellEl = grid.rows
        .find((r) => r.index === 2)!
        .cells.find((c) => String(c.column.key) === 'q2')!;
      const box = cellEl.getBoundingClientRect();
      const hit = rc.cellAtPoint(box.left + box.width / 2, box.top + box.height / 2);
      // Visible columns are [region, q1, q2, q3] ⇒ q2 is col index 2.
      expect(hit).to.eql({ row: 2, col: 2 });
    });
  });

  describe('getRangeChartModel(definition, bounds)', () => {
    it('matches the selection model when bounds equal the selection', async () => {
      const grid = await mount();
      const rc = rangeController(grid);
      rc.selectRange({ row: 0, column: 'region' }, { row: 3, column: 'q1' });
      const fromSelection = grid.getRangeChartModel();
      const fromBounds = grid.getRangeChartModel(undefined, rc.getSelectionBounds()!);
      expect(fromBounds).to.eql(fromSelection);
      // region (category) + q1 (series): 4 categories, 1 series.
      expect(fromBounds.categories).to.eql(['North', 'South', 'East', 'West']);
      expect(fromBounds.series).to.have.length(1);
    });

    it('a wider column range yields more series', async () => {
      const grid = await mount();
      const narrow = grid.getRangeChartModel(undefined, { top: 0, bottom: 3, left: 0, right: 1 });
      const wide = grid.getRangeChartModel(undefined, { top: 0, bottom: 3, left: 0, right: 3 });
      expect(narrow.series).to.have.length(1); // q1
      expect(wide.series).to.have.length(3); // q1, q2, q3
    });
  });

  describe('ChartRangeManager', () => {
    /** A controllable host so the manager can be driven without a live chart render. */
    function fakeHost(overrides: Partial<ChartRangeHost> = {}): ChartRangeHost {
      const gridElement = document.createElement('div');
      document.body.appendChild(gridElement);
      Object.assign(gridElement.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '400px',
        height: '300px',
      });
      return {
        gridElement,
        localize: (_k, _p, fallback) => fallback ?? 'label',
        boundsClientRect: () => new DOMRectReadOnly(20, 20, 120, 60),
        cellAtPoint: () => ({ row: 3, col: 3 }),
        modelForBounds: (bounds) => ({
          categories: [],
          series: [
            {
              name: `${bounds.right - bounds.left + 1}x${bounds.bottom - bounds.top + 1}`,
              data: [],
            },
          ],
        }),
        ...overrides,
      };
    }

    function fakeChart(): ApexGridChart {
      return { staticModel: null as ChartModel | null } as unknown as ApexGridChart;
    }

    it('link draws an outline + handle on the body and positions them', () => {
      const host = fakeHost();
      const mgr = new ChartRangeManager(host);
      const chart = fakeChart();
      mgr.link(chart, { top: 0, bottom: 1, left: 0, right: 1 });

      const outline = document.body.querySelector('[part="chart-range-outline"]') as HTMLElement;
      const handle = document.body.querySelector('[part="chart-range-handle"]') as HTMLElement;
      expect(outline, 'outline present').to.exist;
      expect(handle, 'handle present').to.exist;
      expect(mgr.has(chart)).to.be.true;
      // Positioned from boundsClientRect (20,20,120,60) → right/bottom corner at 140,80.
      expect(handle.style.display).to.equal('block');
      expect(handle.style.left).to.equal(`${140 - 6}px`);
      expect(handle.style.top).to.equal(`${80 - 6}px`);

      mgr.destroy();
    });

    it('dragging the handle resizes the range and re-drives the linked chart', () => {
      const host = fakeHost();
      const mgr = new ChartRangeManager(host);
      const chart = fakeChart();
      mgr.link(chart, { top: 0, bottom: 0, left: 0, right: 0 });
      const handle = document.body.querySelector('[part="chart-range-handle"]') as HTMLElement;

      handle.dispatchEvent(
        new PointerEvent('pointerdown', { button: 0, pointerId: 1, bubbles: true })
      );
      handle.dispatchEvent(
        new PointerEvent('pointermove', { pointerId: 1, clientX: 300, clientY: 250, bubbles: true })
      );
      handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));

      // cellAtPoint returns {row:3,col:3} ⇒ bounds grew to 4x4 ⇒ model recomputed for it.
      expect(chart.staticModel, 'chart model was reassigned').to.not.be.null;
      expect(chart.staticModel!.series[0].name).to.equal('4x4');

      mgr.destroy();
    });

    it('unlink and destroy remove the overlays', () => {
      const host = fakeHost();
      const mgr = new ChartRangeManager(host);
      const a = fakeChart();
      const b = fakeChart();
      mgr.link(a, { top: 0, bottom: 0, left: 0, right: 0 });
      mgr.link(b, { top: 1, bottom: 1, left: 0, right: 0 });
      expect(document.body.querySelectorAll('[part="chart-range-outline"]')).to.have.length(2);

      mgr.unlink(a);
      expect(mgr.has(a)).to.be.false;
      expect(document.body.querySelectorAll('[part="chart-range-outline"]')).to.have.length(1);

      mgr.destroy();
      expect(document.body.querySelectorAll('[part="chart-range-outline"]')).to.have.length(0);
    });

    it('hides the overlay when the range scrolls out of view (null rect)', () => {
      const host = fakeHost({ boundsClientRect: () => null });
      const mgr = new ChartRangeManager(host);
      const chart = fakeChart();
      mgr.link(chart, { top: 0, bottom: 0, left: 0, right: 0 });
      const outline = document.body.querySelector('[part="chart-range-outline"]') as HTMLElement;
      expect(outline.style.display).to.equal('none');
      mgr.destroy();
    });
  });
});
