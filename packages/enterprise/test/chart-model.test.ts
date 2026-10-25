import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  ApexGridChart,
  ApexGridEnterprise,
  type ChartModel,
  type ChartRangeHost,
  ChartRangeManager,
  computeCalculatedSeries,
  enterpriseModules,
  formatToApexOptions,
  linearForecast,
  linearForecastBand,
  recommendChartType,
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

  describe('blank measure cells (ent-chart-model-1, ent-grid-helpers-1)', () => {
    const data = () => [
      { region: 'East', bonus: 100 },
      { region: 'East', bonus: null },
      { region: 'East', bonus: 200 },
      { region: 'East', bonus: '' },
    ];
    const columns: ColumnConfiguration<Rec>[] = [
      { key: 'region', headerText: 'Region' },
      { key: 'bonus', type: 'number', headerText: 'Bonus' },
    ];

    it('skips blanks in every aggregation, as the grid grouping does', async () => {
      const grouped = await mount(data(), columns, {
        groupBy: ['region'],
        aggregations: { bonus: ['avg', 'min', 'count'] },
      });
      const byName = Object.fromEntries(
        grouped.getViewChartModel().series.map((s) => [s.name, s.data[0]])
      );
      const flat = await mount(data(), columns);
      const value = (aggregation: 'avg' | 'min' | 'count' | 'median' | 'max' | 'sum') =>
        flat.getViewChartModel({ aggregation }).series[0].data[0];
      expect([byName['bonus avg'], byName['bonus min'], byName['bonus count']]).to.eql([
        150, 100, 2,
      ]);
      expect(value('avg'), 'avg').to.equal(150);
      expect(value('min'), 'min').to.equal(100);
      expect(value('count'), 'count').to.equal(2);
      expect(value('median'), 'median').to.equal(150);
      expect(value('max'), 'max').to.equal(200);
      expect(value('sum'), 'sum').to.equal(300);
    });

    it('skips blanks in the aggregates a calculated field reads', async () => {
      const grid = await mount(data(), columns);
      const model = grid.getViewChartModel({
        aggregation: 'avg',
        calculatedFields: [{ name: 'Avg', formula: 'A1' }],
      });
      expect(model.series.at(-1)?.data).to.eql([150]);
    });

    it('charts an all-blank category as 0', async () => {
      const grid = await mount(
        [
          { region: 'East', bonus: 10 },
          { region: 'West', bonus: null },
        ],
        columns
      );
      expect(grid.getViewChartModel({ aggregation: 'avg' }).series[0].data).to.eql([10, 0]);
    });

    it('sums under an aggregation it does not know, as before', async () => {
      const grid = await mount(data(), columns);
      const sum = (aggregation: unknown) =>
        grid.getViewChartModel({ aggregation } as never).series[0].data;
      expect(sum('total')).to.eql([300]);
      expect(sum({ bonus: 'nope' })).to.eql([300]);
      expect(sum({ bonus: 'max' })).to.eql([200]);
    });
  });

  describe('calculated-field letters (ent-chart-model-4, ent-grid-helpers-4, ent-chart-panel-b-5)', () => {
    const wide = () => [
      { id: 1, region: 'N', revenue: 100, cost: 10 },
      { id: 2, region: 'S', revenue: 200, cost: 20 },
    ];
    const wideCols: ColumnConfiguration<Rec>[] = [
      { key: 'id', type: 'number', headerText: 'Id' },
      { key: 'region', type: 'string', headerText: 'Region' },
      { key: 'revenue', type: 'number', headerText: 'Revenue' },
      { key: 'cost', type: 'number', headerText: 'Cost' },
    ];

    it('letters the legend over the same columns the chart evaluates', async () => {
      const grid = await mount(wide(), wideCols);
      grid.selectRange({ row: 0, column: 'region' }, { row: 1, column: 'cost' });
      const panel = await fixture<ApexGridChart>(
        html`<apex-grid-chart mode="inline" type="line" .grid=${grid as never}></apex-grid-chart>`
      );
      await until(() => panel.getChart() != null);
      panel.querySelector<HTMLButtonElement>('[part="data-button"]')!.click();
      await panel.updateComplete;
      const chips = [...panel.querySelectorAll('[part="calc-chip"]')].map((c) =>
        c.textContent?.trim()
      );
      expect(chips).to.eql(['A1=Revenue', 'B1=Cost']);
      const model = grid.getChartModel({ calculatedFields: [{ name: 'X', formula: 'B1' }] });
      expect(model.series.at(-1)?.data).to.eql([10, 20]);
    });

    it('lists the selection fields for a selection or auto source', async () => {
      const grid = await mount(wide(), wideCols);
      grid.selectRange({ row: 0, column: 'region' }, { row: 1, column: 'revenue' });
      const keys = (fields: { key: string }[]) => fields.map((f) => f.key);
      expect(keys(grid.getChartFields('selection'))).to.eql(['region', 'revenue']);
      expect(keys(grid.getChartFields('auto'))).to.eql(['region', 'revenue']);
      expect(keys(grid.getChartFields('view'))).to.eql(['id', 'region', 'revenue', 'cost']);
      expect(keys(grid.getChartFields())).to.eql(['id', 'region', 'revenue', 'cost']);
    });

    it('records the column each letter meant when the field is added', async () => {
      const grid = await mount(wide(), wideCols);
      grid.selectRange({ row: 0, column: 'region' }, { row: 1, column: 'cost' });
      const panel = await fixture<ApexGridChart>(
        html`<apex-grid-chart mode="inline" type="line" .grid=${grid as never}></apex-grid-chart>`
      );
      await until(() => panel.getChart() != null);
      panel.querySelector<HTMLButtonElement>('[part="data-button"]')!.click();
      await panel.updateComplete;
      const name = panel.querySelector<HTMLInputElement>('[part="calc-name"]')!;
      const formula = panel.querySelector<HTMLInputElement>('[part="calc-formula"]')!;
      name.value = 'Margin';
      name.dispatchEvent(new Event('input'));
      formula.value = 'B1 / A1';
      formula.dispatchEvent(new Event('input'));
      await panel.updateComplete;
      panel.querySelector<HTMLButtonElement>('[part="calc-add"]')!.click();
      await panel.updateComplete;
      expect(panel.definition.calculatedFields).to.eql([
        { name: 'Margin', formula: 'B1 / A1', refs: { A: 'revenue', B: 'cost' } },
      ]);
    });

    it('keeps a field positional when no column was lettered', async () => {
      const grid = await mount(wide(), wideCols);
      // A selection with no numeric column: the legend is empty.
      grid.selectRange({ row: 0, column: 'region' }, { row: 1, column: 'region' });
      const panel = await fixture<ApexGridChart>(
        html`<apex-grid-chart mode="inline" type="line" source="selection" .grid=${grid as never}></apex-grid-chart>`
      );
      await until(() => panel.querySelector('[part="data-button"]') != null);
      panel.querySelector<HTMLButtonElement>('[part="data-button"]')!.click();
      await panel.updateComplete;
      expect(panel.querySelectorAll('[part="calc-chip"]').length).to.equal(0);
      const name = panel.querySelector<HTMLInputElement>('[part="calc-name"]')!;
      const formula = panel.querySelector<HTMLInputElement>('[part="calc-formula"]')!;
      name.value = 'Double';
      name.dispatchEvent(new Event('input'));
      formula.value = 'A1 * 2';
      formula.dispatchEvent(new Event('input'));
      await panel.updateComplete;
      panel.querySelector<HTMLButtonElement>('[part="calc-add"]')!.click();
      await panel.updateComplete;
      expect(panel.definition.calculatedFields).to.eql([{ name: 'Double', formula: 'A1 * 2' }]);
      grid.selectRange({ row: 0, column: 'region' }, { row: 1, column: 'cost' });
      expect(grid.getRangeChartModel(panel.definition).series.at(-1)?.data).to.eql([200, 400]);
    });

    it('reads a field with refs by column key, whatever the source frame', async () => {
      const grid = await mount(wide(), wideCols);
      const field = { name: 'X', formula: 'B1 / A1', refs: { A: 'revenue', B: 'cost' } };
      // Positionally the view would read A1 = id, B1 = revenue.
      expect(grid.getViewChartModel({ calculatedFields: [field] }).series.at(-1)?.data).to.eql([
        0.1, 0.1,
      ]);
      grid.selectRange({ row: 0, column: 'region' }, { row: 1, column: 'cost' });
      expect(grid.getRangeChartModel({ calculatedFields: [field] }).series.at(-1)?.data).to.eql([
        0.1, 0.1,
      ]);
      // A key the source does not hold reads blank, never another column.
      const gone = { name: 'Y', formula: 'A1', refs: { A: 'missing' } };
      expect(grid.getViewChartModel({ calculatedFields: [gone] }).series.at(-1)?.data).to.eql([
        0, 0,
      ]);
      // A saved field without refs keeps its positional letters.
      const legacy = { name: 'Z', formula: 'A1' };
      expect(grid.getViewChartModel({ calculatedFields: [legacy] }).series.at(-1)?.data).to.eql([
        1, 2,
      ]);
    });
  });

  describe('calculated-field ranges (ent-chart-model-5)', () => {
    it('reads only the cells that can hold a value', () => {
      const start = performance.now();
      const out = computeCalculatedSeries(
        [{ name: 'Total', formula: 'SUM(A1:A3000000)' }],
        [
          [10, 20, 30],
          [5, 0, 1],
        ],
        3
      );
      const elapsed = performance.now() - start;
      expect(out[0].data).to.eql([10, 20, 30]);
      expect(elapsed, `${elapsed}ms`).to.be.below(100);
      const both = computeCalculatedSeries(
        [{ name: 'Both', formula: 'SUM(A1:XFD1048576)' }],
        [
          [10, 20, 30],
          [5, 0, 1],
        ],
        3
      );
      expect(both[0].data).to.eql([15, 20, 31]);
    });
  });

  describe('numeric columns and category labels (ent-grid-helpers-2, ent-grid-helpers-3)', () => {
    it('keeps a declared date column as the category even with epoch values', async () => {
      const grid = await mount(
        [
          { day: new Date(2024, 2, 1).getTime(), revenue: 5 },
          { day: new Date(2024, 2, 2).getTime(), revenue: 7 },
        ],
        [
          { key: 'day', type: 'date' },
          { key: 'revenue', type: 'number' },
        ]
      );
      const model = grid.getViewChartModel();
      expect(model.series.map((s) => s.name)).to.eql(['revenue']);
      const medium = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
      expect(model.categories).to.eql([
        medium.format(new Date(2024, 2, 1)),
        medium.format(new Date(2024, 2, 2)),
      ]);
      expect(grid.getChartFields().map((f) => f.numeric)).to.eql([false, true]);
    });

    it('labels categories with the text the grid shows', async () => {
      const grid = await mount(
        [
          { status: 1, revenue: 5 },
          { status: 2, revenue: 7 },
          { status: null, revenue: 9 },
        ],
        [
          {
            key: 'status',
            type: 'select',
            options: [
              { value: 1, label: 'Open' },
              { value: 2, label: 'Closed' },
            ],
          },
          { key: 'revenue', type: 'number' },
        ] as ColumnConfiguration<Rec>[]
      );
      const model = grid.getViewChartModel();
      expect(model.series.map((s) => s.name)).to.eql(['revenue']);
      expect(model.categories).to.eql(['Open', 'Closed', grid.localize('grouping.blank')]);
    });

    it('formats a Date category with the column date style', async () => {
      const grid = await mount(
        [
          { day: new Date(2024, 2, 1), revenue: 5 },
          { day: new Date(2024, 2, 2), revenue: 7 },
        ],
        [
          { key: 'day', type: 'date', format: 'long' } as ColumnConfiguration<Rec>,
          {
            key: 'revenue',
            type: 'number',
          },
        ]
      );
      const long = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' });
      expect(grid.getViewChartModel().categories).to.eql([
        long.format(new Date(2024, 2, 1)),
        long.format(new Date(2024, 2, 2)),
      ]);
    });
  });

  describe('forecast band (ent-chart-model-2)', () => {
    it('is a 95% prediction interval: Student-t and the leverage of each period', () => {
      const values = [1, 3, 2, 5, 4, 7];
      const n = values.length;
      const { upper, lower } = linearForecastBand(values, 3);
      const forecast = linearForecast(values, 3);
      // Textbook interval: t(0.975, n - 2) * se * sqrt(1 + 1/n + (x0 - xbar)^2 / Sxx).
      const xbar = (n - 1) / 2;
      const sxx = (n * (n * n - 1)) / 12;
      const trend = values.map((_, i) => forecast[0] + (i - n) * (forecast[1] - forecast[0]));
      const se = Math.sqrt(values.reduce((acc, v, i) => acc + (v - trend[i]) ** 2, 0) / (n - 2));
      const t4 = 2.776;
      forecast.forEach((point, k) => {
        const half = t4 * se * Math.sqrt(1 + 1 / n + (n + k - xbar) ** 2 / sxx);
        expect(upper[k] - point, `upper ${k}`).to.be.closeTo(half, 0.01);
        expect(point - lower[k], `lower ${k}`).to.be.closeTo(half, 0.01);
      });
      expect(upper[0] - forecast[0]).to.be.closeTo(4.16, 0.01);
    });

    it('uses a quantile near 1.96 for a long series', () => {
      const values = Array.from({ length: 200 }, (_, i) => i + (i % 2 ? 1 : -1));
      const [point] = linearForecast(values, 1);
      const [upper] = linearForecastBand(values, 1).upper;
      // Residuals are +-1, so se is about 1 and the leverage term about 1.
      expect(upper - point).to.be.within(1.95, 2.05);
    });
  });

  describe("the 'auto' chart type (ent-chart-model-3, ent-chart-model-9)", () => {
    it("never formats 'auto' as a cartesian chart", () => {
      const out = formatToApexOptions({ numberFormat: 'currency', dataLabels: true }, 'auto');
      expect(out.dataLabels).to.eql({ enabled: true });
      expect(out.tooltip).to.equal(undefined);
      expect(out.yaxis).to.equal(undefined);
    });

    it('keeps the percentage labels of an auto chart that resolves to a pie', async () => {
      const grid = await mount(
        [
          { region: 'N', sales: 25.3333 },
          { region: 'S', sales: 74.6667 },
        ],
        [{ key: 'region' }, { key: 'sales', type: 'number' }]
      );
      const panel = await fixture<ApexGridChart>(
        html`<apex-grid-chart mode="inline" source="view" .grid=${grid as never} .format=${{
          numberFormat: 'currency',
          dataLabels: true,
        }}></apex-grid-chart>`
      );
      await until(() => panel.getChart() != null);
      const config = (panel.getChart() as unknown as { w: { config: Rec } }).w.config as {
        chart: { type: string };
        dataLabels: { formatter: (v: number, o?: unknown) => string };
      };
      expect(config.chart.type).to.equal('pie');
      expect(
        config.dataLabels.formatter(25.3333, { seriesIndex: 0, w: { config: {} } })
      ).to.not.equal('$25');
    });

    it('recommends a pie only for non-negative values with a positive sum', () => {
      const one = (data: number[]): ChartModel => ({
        categories: data.map((_, i) => `c${i}`),
        series: [{ name: 'Profit', data }],
      });
      expect(recommendChartType(one([120, 40, 80]))).to.equal('pie');
      expect(recommendChartType(one([120, -40, 80]))).to.equal('column');
      expect(recommendChartType(one([0, 0, 0]))).to.equal('column');
      expect(recommendChartType(one([1, Number.NaN]))).to.equal('column');
    });
  });

  describe('number formats (ent-chart-model-8)', () => {
    type Formatted = { dataLabels: { formatter: (v: number) => string } };
    it('formats currency with the given currency and locale', () => {
      const out = formatToApexOptions(
        { numberFormat: 'currency', currency: 'EUR', locale: 'de-DE' },
        'column'
      ) as unknown as Formatted;
      const expected = new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(1234.5);
      expect(out.dataLabels.formatter(1234.5)).to.equal(expected);
    });

    it('groups thousands in the given locale', () => {
      const out = formatToApexOptions(
        { numberFormat: 'thousands', locale: 'de-DE' },
        'column'
      ) as unknown as Formatted;
      expect(out.dataLabels.formatter(1234.5)).to.equal('1.234,5');
    });

    it('falls back instead of throwing on a malformed currency or locale', () => {
      const out = formatToApexOptions(
        { numberFormat: 'currency', currency: 'not a code', locale: '???' },
        'column'
      ) as unknown as Formatted;
      expect(out.dataLabels.formatter(10)).to.be.a('string').and.include('10');
      // A bad currency alone keeps the locale.
      const badCurrency = formatToApexOptions(
        { numberFormat: 'currency', currency: 'XX!', locale: 'de-DE' },
        'column'
      ) as unknown as Formatted;
      const usdInGerman = new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(1234.5);
      expect(badCurrency.dataLabels.formatter(1234.5)).to.equal(usdInGerman);
    });

    it("defaults the chart's currency to the first measure column's", async () => {
      const grid = await mount(
        [
          { region: 'N', price: 1000 },
          { region: 'S', price: 2000 },
          { region: 'E', price: 3000 },
        ],
        [
          { key: 'region' },
          { key: 'price', type: 'currency', currency: 'EUR', locale: 'de-DE' },
        ] as ColumnConfiguration<Rec>[]
      );
      const panel = await fixture<ApexGridChart>(
        html`<apex-grid-chart mode="inline" source="view" type="column" .grid=${grid as never} .format=${{
          numberFormat: 'currency',
        }}></apex-grid-chart>`
      );
      await until(() => panel.getChart() != null);
      const config = (panel.getChart() as unknown as { w: { config: Rec } }).w.config as {
        tooltip: { y: { formatter: (v: number) => string } };
      };
      expect(config.tooltip.y.formatter(1000)).to.include('€');
    });
  });

  describe('chart dialog header drag', () => {
    it('ends the drag on pointercancel and stops touch panning', async () => {
      const grid = await mount(
        [{ region: 'N', q1: 1 }],
        [
          { key: 'region' },
          {
            key: 'q1',
            type: 'number',
          },
        ]
      );
      const panel = document.createElement('apex-grid-chart') as ApexGridChart;
      panel.grid = grid as never;
      document.body.appendChild(panel);
      panel.show();
      await panel.updateComplete;
      const header = panel.querySelector<HTMLElement>('[part="header"]')!;
      // Synthetic pointers have no capture to take.
      header.setPointerCapture = () => {};
      const box = panel.querySelector<HTMLElement>('[part="panel"]')!;
      expect(getComputedStyle(header).touchAction).to.equal('none');
      const rect = box.getBoundingClientRect();
      const at = (type: string, x: number, y: number) =>
        header.dispatchEvent(
          new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, bubbles: true })
        );
      at('pointerdown', rect.left + 10, rect.top + 10);
      at('pointercancel', rect.left + 10, rect.top + 10);
      at('pointermove', rect.left + 110, rect.top + 60);
      expect(box.getBoundingClientRect().left).to.be.closeTo(rect.left, 1);
      at('pointerdown', rect.left + 10, rect.top + 10);
      header.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 7, bubbles: true }));
      at('pointermove', rect.left + 110, rect.top + 60);
      expect(box.getBoundingClientRect().left).to.be.closeTo(rect.left, 1);
      panel.remove();
    });
  });
});
