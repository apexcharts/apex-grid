import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  ApexGridChart,
  ApexGridEnterprise,
  type ChartModel,
  type ChartRangeHost,
  ChartRangeManager,
  enterpriseModules,
} from '../src/index.js';

type Rec = Record<string, unknown>;

// No render animation: its async callbacks can outlive a removed chart.
(window as unknown as { Apex?: unknown }).Apex = { chart: { animations: { enabled: false } } };

function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '500px';
  return node;
}

async function mount(data: Rec[], columns: ColumnConfiguration<Rec>[], extra: Rec = {}) {
  const grid = await fixture<ApexGridEnterprise<Rec>>(
    html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`,
    { parentNode: sizedParent() }
  );
  Object.assign(grid, extra);
  await grid.updateComplete;
  await nextFrame();
  await grid.updateComplete;
  return grid;
}

async function until(check: () => boolean, frames = 60) {
  for (let i = 0; i < frames && !check(); i += 1) await nextFrame();
  return check();
}

describe('chart model', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridChart.register();
  });
  afterEach(() => fixtureCleanup());

  describe('charted range overlay', () => {
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
        localize: (_k, params, fallback) =>
          `${fallback ?? 'label'}${params ? JSON.stringify(params) : ''}`,
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
    const fakeChart = () =>
      ({ staticModel: null as ChartModel | null }) as unknown as ApexGridChart;
    const outline = () =>
      document.body.querySelector('[part="chart-range-outline"]') as HTMLElement;
    const handle = () => document.body.querySelector('[part="chart-range-handle"]') as HTMLElement;

    afterEach(() => {
      document.documentElement.removeAttribute('dir');
      // A failed grid test must not leave its chart (and handle) for the next one.
      for (const chart of document.querySelectorAll<ApexGridChart>('apex-grid-chart')) {
        chart.close?.();
        chart.remove();
      }
    });

    it('hides the outline when the range is scrolled out of the grid sideways (ent-chart-model-6)', () => {
      const host = fakeHost({ boundsClientRect: () => new DOMRectReadOnly(450, 20, 120, 60) });
      const mgr = new ChartRangeManager(host);
      mgr.link(fakeChart(), { top: 0, bottom: 1, left: 0, right: 1 });
      expect(outline().style.display).to.equal('none');
      expect(handle().style.display).to.equal('none');
      mgr.destroy();
      host.gridElement.remove();
    });

    it('clips the outline to the grid box on both sides (ent-chart-model-6)', () => {
      const host = fakeHost({ boundsClientRect: () => new DOMRectReadOnly(-50, 20, 500, 60) });
      const mgr = new ChartRangeManager(host);
      mgr.link(fakeChart(), { top: 0, bottom: 1, left: 0, right: 1 });
      expect(outline().style.display).to.equal('block');
      expect(outline().style.left).to.equal('0px');
      expect(outline().style.width).to.equal('400px');
      // The trailing corner (x = 450) is outside the grid: no handle.
      expect(handle().style.display).to.equal('none');
      mgr.destroy();
      host.gridElement.remove();
    });

    it('reads the direction the CSS uses, not the nearest dir attribute (sweep-drift-duplication-7)', () => {
      document.documentElement.setAttribute('dir', 'ltr');
      const host = fakeHost();
      host.gridElement.style.direction = 'rtl';
      const mgr = new ChartRangeManager(host);
      mgr.link(fakeChart(), { top: 0, bottom: 1, left: 0, right: 1 });
      // Trailing (bottom-left under RTL) corner of the rect (20,20,120,60).
      expect(handle().style.left).to.equal(`${20 - 6}px`);
      mgr.destroy();
      host.gridElement.remove();
    });

    it('resizes the range from the keyboard and announces it (ent-chart-model-11)', () => {
      const announced: string[] = [];
      const host = fakeHost({ announce: (message: string) => announced.push(message) });
      const mgr = new ChartRangeManager(host);
      const chart = fakeChart();
      mgr.link(chart, { top: 0, bottom: 1, left: 0, right: 1 });
      const press = (key: string) =>
        handle().dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
        );
      press('ArrowDown');
      expect(chart.staticModel?.series[0].name).to.equal('2x3');
      press('ArrowRight');
      expect(chart.staticModel?.series[0].name).to.equal('3x3');
      press('ArrowLeft');
      press('ArrowUp');
      press('ArrowUp');
      expect(chart.staticModel?.series[0].name).to.equal('2x1');
      // Never smaller than one cell.
      press('ArrowUp');
      press('ArrowLeft');
      press('ArrowLeft');
      expect(chart.staticModel?.series[0].name).to.equal('1x1');
      expect(announced.length).to.be.greaterThan(0);
      expect(announced.at(-1)).to.include('"rows":1').and.include('"cols":1');
      mgr.destroy();
      host.gridElement.remove();
    });

    it('moves only the edge the arrow key names, even past the view (ent-chart-model-11)', () => {
      const host = fakeHost({ extent: () => ({ rows: 3, cols: 5 }) });
      const mgr = new ChartRangeManager(host);
      const chart = fakeChart();
      // A range taller than the view (rows a filter hides).
      mgr.link(chart, { top: 0, bottom: 4, left: 0, right: 1 });
      const press = (key: string) =>
        handle().dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
        );
      press('ArrowRight');
      expect(chart.staticModel?.series[0].name).to.equal('3x5');
      // Growing down past the view does nothing: it never shrinks the range.
      press('ArrowDown');
      expect(chart.staticModel?.series[0].name).to.equal('3x5');
      press('ArrowUp');
      expect(chart.staticModel?.series[0].name).to.equal('3x4');
      mgr.destroy();
      host.gridElement.remove();
    });

    it('keeps the rows a filter hides when the range is resized sideways (ent-chart-model-11)', async () => {
      const grid = await mount(
        ['A', 'B', 'C', 'D', 'E'].map((region, i) => ({ region, q1: (i + 1) * 10, q2: i })),
        [{ key: 'region' }, { key: 'q1', type: 'number' }, { key: 'q2', type: 'number' }]
      );
      grid.selectRange({ row: 0, column: 'region' }, { row: 4, column: 'q1' });
      grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', altKey: true, bubbles: true }));
      const chart = document.querySelector('apex-grid-chart') as ApexGridChart;
      grid.filter({ key: 'q1', condition: 'greaterThan', searchTerm: 25 });
      await grid.updateComplete;
      expect(await until(() => chart.staticModel?.categories.length === 3, 10)).to.equal(true);
      handle().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
      );
      expect(chart.staticModel?.series.map((s) => s.name)).to.eql(['q1', 'q2']);
      grid.clearFilter();
      await grid.updateComplete;
      await until(() => chart.staticModel?.categories.length === 5, 10);
      expect(chart.staticModel?.categories).to.eql(['A', 'B', 'C', 'D', 'E']);
      chart.close?.();
      chart.remove();
    });

    it('mirrors the arrow keys under RTL (ent-chart-model-11)', () => {
      const host = fakeHost();
      host.gridElement.style.direction = 'rtl';
      const mgr = new ChartRangeManager(host);
      const chart = fakeChart();
      mgr.link(chart, { top: 0, bottom: 0, left: 0, right: 0 });
      handle().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      expect(chart.staticModel?.series[0].name).to.equal('2x1');
      mgr.destroy();
      host.gridElement.remove();
    });

    it('re-drives a linked chart from its range when the view is sorted (ent-chart-model-7)', async () => {
      const grid = await mount(
        [
          { region: 'North', q1: 10 },
          { region: 'South', q1: 20 },
          { region: 'East', q1: 30 },
        ],
        [{ key: 'region' }, { key: 'q1', type: 'number' }]
      );
      grid.selectRange({ row: 0, column: 'region' }, { row: 1, column: 'q1' });
      grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', altKey: true, bubbles: true }));
      const chart = document.querySelector('apex-grid-chart') as ApexGridChart;
      expect(chart.staticModel?.categories).to.eql(['North', 'South']);
      grid.sort({ key: 'q1', direction: 'descending' });
      await grid.updateComplete;
      await until(() => chart.staticModel?.categories[0] === 'East', 10);
      expect(chart.staticModel?.categories).to.eql(['East', 'South']);
      chart.close?.();
      chart.remove();
    });
  });
});
