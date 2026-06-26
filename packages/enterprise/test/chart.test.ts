import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  ApexGridEnterprise,
  type ChartModel,
  chartModelToApexOptions,
  enterpriseModules,
  recommendChartType,
} from '../src/index.js';

interface Row {
  region: string;
  product: string;
  amount: number;
}

function makeData(): Row[] {
  return [
    { region: 'EMEA', product: 'A', amount: 10 },
    { region: 'EMEA', product: 'B', amount: 20 },
    { region: 'AMER', product: 'A', amount: 30 },
    { region: 'AMER', product: 'A', amount: 40 },
  ];
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'region' },
  { key: 'product' },
  { key: 'amount' },
];

async function mount(extra: Record<string, unknown>) {
  const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
    .data=${makeData()}
    .columns=${columns}
    .aggregations=${extra.aggregations ?? {}}
    .groupBy=${extra.groupBy ?? []}
    .pivotOn=${extra.pivotOn ?? ''}
    .pivotRows=${extra.pivotRows ?? []}
    .pivotValues=${extra.pivotValues ?? {}}
  ></apex-grid-enterprise>`);
  await grid.updateComplete;
  await nextFrame();
  return grid;
}

const MODEL: ChartModel = {
  categories: ['A', 'B', 'C'],
  series: [
    { name: 'Sales', data: [10, 20, 30] },
    { name: 'Cost', data: [5, 8, 9] },
  ],
};

describe('integrated charts — chartModelToApexOptions (pure transform)', () => {
  it('builds the cartesian shape for column (series + xaxis.categories, no horizontal)', () => {
    const opts = chartModelToApexOptions(MODEL, { type: 'column' });
    expect(opts.chart?.type).to.equal('bar');
    expect(opts.plotOptions?.bar?.horizontal).to.equal(undefined);
    expect(opts.xaxis?.categories).to.eql(['A', 'B', 'C']);
    expect((opts.series as { name: string }[]).map((s) => s.name)).to.eql(['Sales', 'Cost']);
  });

  it('flips bar to horizontal', () => {
    const opts = chartModelToApexOptions(MODEL, { type: 'bar' });
    expect(opts.chart?.type).to.equal('bar');
    expect(opts.plotOptions?.bar?.horizontal).to.equal(true);
  });

  it('builds the circular shape for pie (series: number[] + labels, first series only)', () => {
    const opts = chartModelToApexOptions(MODEL, { type: 'pie' });
    expect(opts.chart?.type).to.equal('pie');
    expect(opts.series).to.eql([10, 20, 30]); // first measure
    expect(opts.labels).to.eql(['A', 'B', 'C']);
    expect(opts.xaxis).to.equal(undefined);
  });

  it('donut maps to the donut type with the circular shape', () => {
    const opts = chartModelToApexOptions(MODEL, { type: 'donut' });
    expect(opts.chart?.type).to.equal('donut');
    expect(opts.series).to.eql([10, 20, 30]);
  });

  it('combo gives each series its own type (default: first column, rest line)', () => {
    const opts = chartModelToApexOptions(MODEL, { type: 'combo' });
    expect(opts.chart?.type).to.equal('line');
    const series = opts.series as { name: string; type: string }[];
    expect(series.map((s) => s.type)).to.eql(['bar', 'line']);
  });

  it('combo honors comboTypes overrides by series index', () => {
    const opts = chartModelToApexOptions(MODEL, { type: 'combo', comboTypes: ['line', 'column'] });
    const series = opts.series as { type: string }[];
    expect(series.map((s) => s.type)).to.eql(['line', 'bar']);
  });

  it('deep-merges apexOptions last so the caller can override', () => {
    const opts = chartModelToApexOptions(MODEL, {
      type: 'line',
      apexOptions: { chart: { type: 'area', height: 500 } },
    });
    expect(opts.chart?.type).to.equal('area');
    expect(opts.chart?.height).to.equal(500);
  });

  it('keeps the computed type when the caller only sets other chart.* options', () => {
    const opts = chartModelToApexOptions(MODEL, {
      type: 'column',
      apexOptions: { chart: { toolbar: { show: false } } },
    });
    // A shallow merge would drop chart.type and fall back to a line.
    expect(opts.chart?.type).to.equal('bar');
    expect(opts.chart?.toolbar?.show).to.equal(false);
  });

  it('keeps xaxis.categories when the caller sets a value-axis xaxis formatter (horizontal bar)', () => {
    const formatter = (v: number) => `$${v}`;
    const opts = chartModelToApexOptions(MODEL, {
      type: 'bar',
      apexOptions: { xaxis: { labels: { formatter } } },
    });
    // Categories must survive so the bar's category axis shows labels, not 1, 2, 3.
    expect(opts.xaxis?.categories).to.eql(['A', 'B', 'C']);
    expect(opts.xaxis?.labels?.formatter).to.equal(formatter);
  });

  it('keeps bar.horizontal when the caller sets other plotOptions.bar options', () => {
    const opts = chartModelToApexOptions(MODEL, {
      type: 'bar',
      apexOptions: { plotOptions: { bar: { borderRadius: 6 } } },
    });
    expect(opts.plotOptions?.bar?.horizontal).to.equal(true);
    expect(opts.plotOptions?.bar?.borderRadius).to.equal(6);
  });

  it("resolves type: 'auto' via the recommend heuristic", () => {
    // 1 series, 3 categories → pie
    const single: ChartModel = { categories: ['A', 'B', 'C'], series: [MODEL.series[0]] };
    expect(chartModelToApexOptions(single, { type: 'auto' }).chart?.type).to.equal('pie');
  });
});

describe('integrated charts — recommendChartType', () => {
  it('single series over few categories → pie', () => {
    expect(recommendChartType({ categories: ['A', 'B'], series: [MODEL.series[0]] })).to.equal(
      'pie'
    );
  });

  it('many categories → line', () => {
    const cats = Array.from({ length: 20 }, (_, i) => String(i));
    expect(recommendChartType({ categories: cats, series: MODEL.series })).to.equal('line');
  });

  it('otherwise → column', () => {
    expect(recommendChartType(MODEL)).to.equal('column');
  });
});

describe('ApexGridEnterprise integrated charts — getChartModel', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  it('returns an empty model when neither grouping nor pivot is active', async () => {
    const grid = await mount({});
    const model = grid.getChartModel();
    expect(model.categories).to.eql([]);
    expect(model.series).to.eql([]);
  });

  it('charts group aggregates: categories = group labels, series = measure×fn', async () => {
    const grid = await mount({ groupBy: ['region'], aggregations: { amount: ['sum'] } });
    const model = grid.getChartModel();

    expect(model.categories).to.eql(['EMEA', 'AMER']);
    expect(model.series.length).to.equal(1);
    expect(model.series[0].name).to.equal('amount sum');
    expect(model.series[0].data).to.eql([30, 70]); // EMEA 10+20, AMER 30+40
  });

  it('charts a pivot: categories = row labels, one series per pivot column', async () => {
    const grid = await mount({
      pivotOn: 'product',
      pivotRows: ['region'],
      pivotValues: { amount: ['sum'] },
    });
    const model = grid.getChartModel();

    expect(model.categories).to.eql(['EMEA', 'AMER']);
    expect(model.series.map((s) => s.name)).to.eql(['A', 'B']);
    expect(model.series.find((s) => s.name === 'A')!.data).to.eql([10, 70]);
    expect(model.series.find((s) => s.name === 'B')!.data).to.eql([20, 0]);
  });
});

interface RangeRow {
  name: string;
  q1: number;
  q2: number;
}
const rangeData: RangeRow[] = [
  { name: 'A', q1: 10, q2: 5 },
  { name: 'B', q1: 20, q2: 8 },
  { name: 'C', q1: 30, q2: 9 },
];
const rangeColumns: ColumnConfiguration<RangeRow>[] = [
  { key: 'name', type: 'string', headerText: 'Name' },
  { key: 'q1', type: 'number', headerText: 'Q1' },
  { key: 'q2', type: 'number', headerText: 'Q2' },
];

async function mountRange() {
  const grid = await fixture<ApexGridEnterprise<RangeRow>>(html`<apex-grid-enterprise
    .data=${rangeData.map((row) => ({ ...row }))}
    .columns=${rangeColumns}
  ></apex-grid-enterprise>`);
  await grid.updateComplete;
  await nextFrame();
  return grid;
}

describe('ApexGridEnterprise integrated charts — getRangeChartModel', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  it('label + numeric columns → categories from the label, a series per numeric column', async () => {
    const grid = await mountRange();
    grid.selectRange({ row: 0, column: 'name' }, { row: 2, column: 'q2' });
    const model = grid.getRangeChartModel();
    expect(model.categories).to.eql(['A', 'B', 'C']);
    expect(model.series.map((s) => s.name)).to.eql(['Q1', 'Q2']);
    expect(model.series[0].data).to.eql([10, 20, 30]);
    expect(model.series[1].data).to.eql([5, 8, 9]);
  });

  it('single numeric column → row-position categories, one series', async () => {
    const grid = await mountRange();
    grid.selectRange({ row: 0, column: 'q1' }, { row: 2, column: 'q1' });
    const model = grid.getRangeChartModel();
    expect(model.categories).to.eql(['1', '2', '3']);
    expect(model.series.length).to.equal(1);
    expect(model.series[0].data).to.eql([10, 20, 30]);
  });

  it('all-numeric multi-column → row-position categories, every column a series', async () => {
    const grid = await mountRange();
    grid.selectRange({ row: 0, column: 'q1' }, { row: 2, column: 'q2' });
    const model = grid.getRangeChartModel();
    expect(model.categories).to.eql(['1', '2', '3']);
    expect(model.series.map((s) => s.name)).to.eql(['Q1', 'Q2']);
  });

  it('label-only selection → empty model', async () => {
    const grid = await mountRange();
    grid.selectRange({ row: 0, column: 'name' }, { row: 2, column: 'name' });
    expect(grid.getRangeChartModel()).to.eql({ categories: [], series: [] });
  });

  it('no selection → empty model', async () => {
    const grid = await mountRange();
    expect(grid.getRangeChartModel()).to.eql({ categories: [], series: [] });
  });

  it('getChartModel dispatches to the range model when a numeric range is selected', async () => {
    const grid = await mountRange();
    grid.selectRange({ row: 0, column: 'name' }, { row: 2, column: 'q1' });
    const model = grid.getChartModel();
    expect(model.categories).to.eql(['A', 'B', 'C']);
    expect(model.series.map((s) => s.name)).to.eql(['Q1']);
  });

  it('sums each numeric series per category when category labels repeat', async () => {
    interface DeptRow {
      dept: string;
      salary: number;
      bonus: number;
    }
    const grid = await fixture<ApexGridEnterprise<DeptRow>>(html`<apex-grid-enterprise
      .data=${[
        { dept: 'Eng', salary: 100, bonus: 10 },
        { dept: 'Sales', salary: 70, bonus: 7 },
        { dept: 'Eng', salary: 90, bonus: 9 },
        { dept: 'Sales', salary: 80, bonus: 8 },
      ]}
      .columns=${
        [
          { key: 'dept', type: 'string', headerText: 'Dept' },
          { key: 'salary', type: 'number', headerText: 'Salary' },
          { key: 'bonus', type: 'number', headerText: 'Bonus' },
        ] as ColumnConfiguration<DeptRow>[]
      }
    ></apex-grid-enterprise>`);
    await grid.updateComplete;
    await nextFrame();
    grid.selectRange({ row: 0, column: 'dept' }, { row: 3, column: 'bonus' });
    const model = grid.getRangeChartModel();
    // One bar per distinct department (first-seen order), each series summed.
    expect(model.categories).to.eql(['Eng', 'Sales']);
    expect(model.series.map((s) => s.name)).to.eql(['Salary', 'Bonus']);
    expect(model.series[0].data).to.eql([190, 150]);
    expect(model.series[1].data).to.eql([19, 15]);
  });
});
