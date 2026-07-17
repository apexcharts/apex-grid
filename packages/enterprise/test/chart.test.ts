import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  ApexGridEnterprise,
  buildValueAxes,
  type ChartModel,
  chartModelToApexOptions,
  enterpriseModules,
  formatToApexOptions,
  linearForecast,
  linearForecastBand,
  linearTrend,
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

  it('gives bars/columns a zero stroke, leaves lines/areas alone', () => {
    // Column/bar: flat, no outline.
    expect(chartModelToApexOptions(MODEL, { type: 'column' }).stroke?.width).to.equal(0);
    expect(chartModelToApexOptions(MODEL, { type: 'bar' }).stroke?.width).to.equal(0);
    // Line/area: no forced width (ApexCharts default stroke).
    expect(chartModelToApexOptions(MODEL, { type: 'line' }).stroke).to.equal(undefined);
    expect(chartModelToApexOptions(MODEL, { type: 'area' }).stroke).to.equal(undefined);
  });

  it('combo strokes only the line-like series (width 0 for bar/column)', () => {
    // Default combo: series 0 = column (→ 0), series 1 = line (→ 2).
    const opts = chartModelToApexOptions(MODEL, { type: 'combo' });
    expect(opts.stroke?.width).to.eql([0, 2]);
  });

  it('lets a caller override the default stroke (e.g. dashArray for overlays)', () => {
    const opts = chartModelToApexOptions(MODEL, {
      type: 'combo',
      apexOptions: { stroke: { dashArray: [0, 5] } },
    });
    // Our computed width survives alongside the caller's dashArray.
    expect(opts.stroke?.width).to.eql([0, 2]);
    expect(opts.stroke?.dashArray).to.eql([0, 5]);
  });

  it('passes a per-series color through the combo mapping', () => {
    const model = {
      categories: ['A', 'B'],
      series: [
        { name: 'Sales', data: [1, 2] },
        { name: 'Forecast', data: [3, 4], color: '#f59e0b' },
      ],
    } as unknown as ChartModel;
    const opts = chartModelToApexOptions(model, { type: 'combo' });
    const series = opts.series as { name: string; color?: string }[];
    expect(series[1].color).to.equal('#f59e0b');
    expect(series[0].color).to.equal(undefined);
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

describe('integrated charts — formatToApexOptions (pure)', () => {
  it('emits nothing for an empty format (non-destructive default)', () => {
    expect(formatToApexOptions({})).to.eql({});
  });

  it('maps the simple toggles', () => {
    expect(formatToApexOptions({ legend: false })).to.eql({ legend: { show: false } });
    expect(formatToApexOptions({ gridlines: false })).to.eql({ grid: { show: false } });
    expect(formatToApexOptions({ dataLabels: true })).to.eql({ dataLabels: { enabled: true } });
    expect(formatToApexOptions({ colors: ['#f00', '#0f0'] })).to.eql({ colors: ['#f00', '#0f0'] });
  });

  it('applies a currency formatter to data labels + tooltip + the value axis for cartesian types', () => {
    const out = formatToApexOptions({ numberFormat: 'currency' }, 'column') as {
      dataLabels: { formatter: (v: number) => string };
      tooltip: { y: { formatter: (v: number) => string } };
      yaxis: { labels: { formatter: (v: number) => string } };
    };
    expect(out.dataLabels.formatter(1234.6)).to.equal('$1,235');
    expect(out.tooltip.y.formatter(1000)).to.equal('$1,000');
    // Number format also drives the value axis (yaxis for a column chart) so the change is visible.
    expect(out.yaxis.labels.formatter(1000)).to.equal('$1,000');
  });

  it('formats the x value-axis (not y) for a horizontal bar', () => {
    const out = formatToApexOptions({ numberFormat: 'currency' }, 'bar') as {
      xaxis: { labels: { formatter: (v: number) => string } };
      yaxis?: unknown;
    };
    expect(out.xaxis.labels.formatter(1000)).to.equal('$1,000');
    expect(out.yaxis).to.equal(undefined);
  });

  it('leaves circular charts (pie/donut) their percentage labels', () => {
    const out = formatToApexOptions({ numberFormat: 'currency' }, 'pie');
    expect(out.dataLabels).to.equal(undefined);
    expect(out.tooltip).to.equal(undefined);
  });

  it('draws a reference line on the value axis (yaxis for column, xaxis for bar)', () => {
    const col = formatToApexOptions({ referenceLine: 100 }, 'column') as {
      annotations: { yaxis: { y: number }[] };
    };
    expect(col.annotations.yaxis[0].y).to.equal(100);
    const bar = formatToApexOptions({ referenceLine: 100 }, 'bar') as {
      annotations: { xaxis: { x: number }[] };
    };
    expect(bar.annotations.xaxis[0].x).to.equal(100);
    // No value axis on a pie → no annotation.
    expect(formatToApexOptions({ referenceLine: 100 }, 'pie').annotations).to.equal(undefined);
  });

  it('shades a reference band on the value axis (y for column, x for bar)', () => {
    const col = formatToApexOptions({ referenceBand: { from: 20, to: 80 } }, 'column') as {
      annotations: { yaxis: { y: number; y2: number }[] };
    };
    expect(col.annotations.yaxis[0].y).to.equal(20);
    expect(col.annotations.yaxis[0].y2).to.equal(80);
    const bar = formatToApexOptions({ referenceBand: { from: 20, to: 80 } }, 'bar') as {
      annotations: { xaxis: { x: number; x2: number }[] };
    };
    expect(bar.annotations.xaxis[0].x).to.equal(20);
    expect(bar.annotations.xaxis[0].x2).to.equal(80);
    expect(formatToApexOptions({ referenceBand: { from: 1, to: 2 } }, 'pie').annotations).to.equal(
      undefined
    );
  });

  it('collects a reference line AND band into one axis array', () => {
    const out = formatToApexOptions(
      { referenceLine: 50, referenceBand: { from: 20, to: 80 } },
      'column'
    ) as { annotations: { yaxis: unknown[] } };
    expect(out.annotations.yaxis).to.have.lengthOf(2);
  });

  it('emits axis titles only for the sides set (cartesian only)', () => {
    expect(formatToApexOptions({ axisTitles: { x: 'Month' } }, 'column')).to.eql({
      xaxis: { title: { text: 'Month' } },
    });
    expect(formatToApexOptions({ axisTitles: { y: 'Revenue' } }, 'column')).to.eql({
      yaxis: { title: { text: 'Revenue' } },
    });
    // Circular charts have no axes → no titles emitted.
    expect(formatToApexOptions({ axisTitles: { x: 'Month', y: 'Revenue' } }, 'pie')).to.eql({});
  });
});

describe('integrated charts — buildValueAxes (pure)', () => {
  it('returns [] when nothing is on the secondary axis (single-axis path)', () => {
    expect(buildValueAxes(['Revenue', 'Deals'], [])).to.eql([]);
    expect(buildValueAxes(['Revenue'], ['Missing'])).to.eql([]); // no matching series
  });

  it('splits series across a primary and an opposite secondary axis, bound by name', () => {
    const axes = buildValueAxes(['Revenue', 'Deals'], ['Deals']) as Array<{
      seriesName?: string[];
      opposite?: boolean;
    }>;
    expect(axes).to.have.lengthOf(2);
    expect(axes[0].seriesName).to.eql(['Revenue']);
    expect(axes[0].opposite).to.equal(undefined);
    expect(axes[1].seriesName).to.eql(['Deals']);
    expect(axes[1].opposite).to.equal(true);
  });

  it('carries the number formatter onto both axes and the primary title', () => {
    const axes = buildValueAxes(['Revenue', 'Deals'], ['Deals'], {
      numberFormat: 'thousands',
      primaryTitle: 'Revenue',
    }) as Array<{ labels: { formatter: (v: number) => string }; title?: { text: string } }>;
    expect(axes[0].labels.formatter(1000)).to.equal('1,000');
    expect(axes[1].labels.formatter(1000)).to.equal('1,000');
    expect(axes[0].title?.text).to.equal('Revenue');
  });

  it('drops seriesName binding when every series is on one side (nothing to disambiguate)', () => {
    // All three on the secondary side → primary has no series; secondary spans all, so no binding.
    const axes = buildValueAxes(['A', 'B'], ['A', 'B']) as Array<{ seriesName?: string[] }>;
    expect(axes[1].seriesName).to.equal(undefined);
  });
});

describe('integrated charts — linearTrend (pure)', () => {
  it('fits a straight line through the points (least squares)', () => {
    expect(linearTrend([2, 4, 6, 8])).to.eql([2, 4, 6, 8]); // already linear
    expect(linearTrend([])).to.eql([]);
    expect(linearTrend([5, 5, 5])).to.eql([5, 5, 5]); // flat
    // Noisy but upward: endpoints of the fit bracket the data trend.
    const fit = linearTrend([1, 3, 2, 5, 4, 7]);
    expect(fit[0]).to.be.lessThan(fit[fit.length - 1]);
  });

  it('projects future periods along the fit', () => {
    // Perfectly linear 2,4,6 (slope 2) → next two are 8, 10.
    expect(linearForecast([2, 4, 6], 2)).to.eql([8, 10]);
    expect(linearForecast([2, 4, 6], 0)).to.eql([]);
    expect(linearForecast([], 3)).to.eql([]);
  });

  it('brackets the forecast with a widening prediction band', () => {
    // Perfectly linear data → zero residual → band collapses onto the point forecast.
    const tight = linearForecastBand([2, 4, 6], 2);
    expect(tight.upper).to.eql([8, 10]);
    expect(tight.lower).to.eql([8, 10]);
    // Noisy data → a real band that straddles the forecast and widens further out.
    const noisy = linearForecastBand([1, 3, 2, 5, 4, 7], 3);
    const point = linearForecast([1, 3, 2, 5, 4, 7], 3);
    for (let k = 0; k < 3; k += 1) {
      expect(noisy.upper[k]).to.be.greaterThan(point[k]);
      expect(noisy.lower[k]).to.be.lessThan(point[k]);
    }
    const width = (k: number) => noisy.upper[k] - noisy.lower[k];
    expect(width(2)).to.be.greaterThan(width(0));
    // Empty / no-period guards.
    expect(linearForecastBand([], 3)).to.eql({ upper: [], lower: [] });
    expect(linearForecastBand([1, 2, 3], 0)).to.eql({ upper: [], lower: [] });
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

  it('charts the flat view when neither grouping nor pivot is active', async () => {
    const grid = await mount({});
    const model = grid.getChartModel();
    // First non-numeric column (region) is the category axis, summed over the whole view;
    // amount is the sole numeric series. (product is non-numeric but not the category.)
    expect(model.categories).to.eql(['EMEA', 'AMER']);
    expect(model.series.length).to.equal(1);
    expect(model.series[0].name).to.equal('amount');
    expect(model.series[0].data).to.eql([30, 70]); // EMEA 10+20, AMER 30+40
  });

  it('flat view reflects a filter (fewer rows → different category totals)', async () => {
    const grid = await mount({});
    grid.filter({ key: 'region', searchTerm: 'AMER' });
    await grid.updateComplete;
    await nextFrame();
    const model = grid.getViewChartModel();
    expect(model.categories).to.eql(['AMER']);
    expect(model.series[0].data).to.eql([70]);
  });

  it('fires apex-view-changed on sort (row count unchanged)', async () => {
    const grid = await mount({});
    let fired = 0;
    grid.addEventListener('apex-view-changed', () => {
      fired += 1;
    });
    grid.sort({ key: 'amount', direction: 'descending' });
    await grid.updateComplete;
    await nextFrame();
    expect(fired).to.be.greaterThan(0);
  });

  it('fires apex-view-changed on a same-shape data swap, updating totals', async () => {
    const grid = await mount({});
    let fired = 0;
    grid.addEventListener('apex-view-changed', () => {
      fired += 1;
    });
    // Same rows/columns, different values → structural signature unchanged; the data epoch moves it.
    grid.data = [
      { region: 'EMEA', product: 'A', amount: 100 },
      { region: 'EMEA', product: 'B', amount: 100 },
      { region: 'AMER', product: 'A', amount: 5 },
      { region: 'AMER', product: 'A', amount: 5 },
    ];
    await grid.updateComplete;
    await nextFrame();
    expect(fired).to.be.greaterThan(0);
    expect(grid.getViewChartModel().series[0].data).to.eql([200, 10]);
  });

  it('aggregates the flat view per the definition (avg / count / min / max / median)', async () => {
    const grid = await mount({});
    // EMEA amounts 10,20 · AMER amounts 30,40.
    const data = (fn: string) =>
      grid.getViewChartModel({ aggregation: fn as never }).series[0].data;
    expect(grid.getViewChartModel().series[0].data).to.eql([30, 70]); // default sum
    expect(data('avg')).to.eql([15, 35]);
    expect(data('count')).to.eql([2, 2]);
    expect(data('min')).to.eql([10, 30]);
    expect(data('max')).to.eql([20, 40]);
    expect(data('median')).to.eql([15, 35]);
  });

  it('honors an explicit category column in the definition', async () => {
    const grid = await mount({});
    const model = grid.getViewChartModel({ category: 'product' });
    // product A rows: amount 10+30+40; product B: 20.
    expect(model.categories).to.eql(['A', 'B']);
    expect(model.series.length).to.equal(1);
    expect(model.series[0].name).to.equal('amount');
    expect(model.series[0].data).to.eql([80, 20]);
  });

  it('supports a per-measure aggregation map', async () => {
    const grid = await fixture<
      ApexGridEnterprise<Record<string, unknown>>
    >(html`<apex-grid-enterprise
      .data=${[
        { team: 'Red', a: 10, b: 100 },
        { team: 'Red', a: 20, b: 200 },
        { team: 'Blue', a: 30, b: 300 },
      ]}
      .columns=${[{ key: 'team' }, { key: 'a', type: 'number' }, { key: 'b', type: 'number' }]}
    ></apex-grid-enterprise>`);
    await grid.updateComplete;
    await nextFrame();
    const model = grid.getViewChartModel({ aggregation: { a: 'sum', b: 'avg' } });
    expect(model.categories).to.eql(['Red', 'Blue']);
    expect(model.series.find((s) => s.name === 'a')!.data).to.eql([30, 30]); // Red 10+20, Blue 30
    expect(model.series.find((s) => s.name === 'b')!.data).to.eql([150, 300]); // Red avg(100,200), Blue 300
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

  it('getChartFields reports key/label/numeric for the flat view', async () => {
    const grid = await mount({});
    const fields = grid.getChartFields();
    expect(fields.map((f) => f.key)).to.eql(['region', 'product', 'amount']);
    // region/product are strings, amount is numeric → a measure candidate.
    expect(fields.map((f) => f.numeric)).to.eql([false, false, true]);
    expect(fields.find((f) => f.key === 'amount')?.label).to.be.a('string');
  });

  it('getChartFields is empty while grouping is active (view carries its own aggregation)', async () => {
    const grid = await mount({ groupBy: ['region'], aggregations: { amount: ['sum'] } });
    expect(grid.getChartFields()).to.eql([]);
  });
});

interface CompRow {
  department: string;
  salary: number;
  bonus: number;
}
describe('ApexGridEnterprise integrated charts — calculated-field series', () => {
  async function mountComp() {
    const grid = await fixture<ApexGridEnterprise<CompRow>>(html`<apex-grid-enterprise
      .data=${
        [
          { department: 'Engineering', salary: 100000, bonus: 20000 },
          { department: 'Engineering', salary: 60000, bonus: 6000 },
          { department: 'Sales', salary: 80000, bonus: 12000 },
        ] as CompRow[]
      }
      .columns=${
        [
          { key: 'department', type: 'string' },
          { key: 'salary', type: 'number' },
          { key: 'bonus', type: 'number' },
        ] as ColumnConfiguration<CompRow>[]
      }
    ></apex-grid-enterprise>`);
    await grid.updateComplete;
    await nextFrame();
    return grid;
  }

  it('appends a calculated series computed over the AGGREGATES (ratio of totals)', async () => {
    const grid = await mountComp();
    // A1 = salary (first numeric col), B1 = bonus. "Bonus %" = bonus / salary * 100.
    const model = grid.getViewChartModel({
      category: 'department',
      measures: ['salary'],
      calculatedFields: [{ name: 'Bonus %', formula: 'B1 / A1 * 100' }],
    });
    expect(model.categories).to.eql(['Engineering', 'Sales']);
    // Base measure series (labelled by key, no headerText) + the calculated series.
    expect(model.series.map((s) => s.name)).to.eql(['salary', 'Bonus %']);
    const calc = model.series.find((s) => s.name === 'Bonus %')!;
    // Engineering: sum(bonus)=26000 / sum(salary)=160000 * 100 = 16.25 (ratio of totals),
    // NOT avg(20%, 10%) = 15 (average of ratios) — proves aggregate-then-evaluate.
    expect(calc.data[0]).to.be.closeTo(16.25, 1e-9);
    expect(calc.data[1]).to.be.closeTo(15, 1e-9); // Sales: 12000/80000*100
  });

  it('drops a calculated field with an invalid formula (no phantom series)', async () => {
    const grid = await mountComp();
    const model = grid.getViewChartModel({
      category: 'department',
      measures: ['salary'],
      calculatedFields: [{ name: 'Broken', formula: 'A1 /' }],
    });
    expect(model.series.map((s) => s.name)).to.eql(['salary']);
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
