import type { ApexOptions } from 'apexcharts';

/** A single chart series (one bar/line group). */
export interface ChartSeries {
  readonly name: string;
  readonly data: number[];
}

/** Chart-ready model derived from the grid's range / group / pivot aggregates. */
export interface ChartModel {
  readonly categories: string[];
  readonly series: ChartSeries[];
}

/** How the rows within one category are collapsed into a single series value. */
export type ChartAggregation = 'sum' | 'avg' | 'count' | 'min' | 'max' | 'median';

/**
 * How a category/measure chart is mapped out of a labeled grid, shared by the range and view-bound
 * model builders. Every field is optional: an empty definition reproduces the automatic default
 * (first non-numeric column = category, every numeric column = a series, summed per category), so a
 * mapping UI can seed itself from the default and only override what the user changes.
 */
export interface ChartDefinition {
  /** Column key for the category (X) axis. Defaults to the first non-numeric column. */
  readonly category?: string;
  /** Column keys to plot as series (Y). Defaults to every numeric column except the category. */
  readonly measures?: readonly string[];
  /**
   * Aggregation applied to the rows in each category. One function for all series, or a per-measure
   * map keyed by column key (unlisted measures fall back to `sum`). Defaults to `sum`.
   */
  readonly aggregation?: ChartAggregation | Readonly<Record<string, ChartAggregation>>;
  /**
   * Measure keys (a subset of {@link measures}) to plot against a **secondary** value axis (drawn on
   * the opposite side). Use when measures live on different scales, e.g. revenue vs. headcount.
   * Empty/unset keeps every series on one axis.
   */
  readonly secondaryMeasures?: readonly string[];
  /**
   * Extra series computed from a formula over the other fields (see {@link CalculatedField}), e.g.
   * a "Bonus %" of `bonus / salary * 100`. Evaluated per category over the **aggregated** values
   * (ratio of totals), appended after the measure series.
   */
  readonly calculatedFields?: readonly CalculatedField[];
}

/**
 * A chart series computed from a formula rather than a column. The formula uses **A1** references
 * where the letters map to the numeric columns in display order (`A1` = first numeric column, `B1` =
 * second, …; row is always 1 — one aggregated value per column per category). Evaluated once per
 * category over the aggregated values. See {@link ChartDefinition.calculatedFields}.
 */
export interface CalculatedField {
  /** Series name (shown in the legend). */
  readonly name: string;
  /** Formula, e.g. `bonus / salary * 100` written as `B1 / A1 * 100`. A leading `=` is optional. */
  readonly formula: string;
}

/** A chartable grid column, surfaced by `getChartFields()` to drive a mapping UI. */
export interface ChartField {
  /** Column key (matches {@link ChartDefinition} category/measures). */
  readonly key: string;
  /** Human label (the column header), also the series name for a measure. */
  readonly label: string;
  /** Whether the column holds numeric data (a candidate measure). */
  readonly numeric: boolean;
}

/** The handful of chart-formatting options users change most often (see {@link formatToApexOptions}). */
export interface ChartFormat {
  /** Series colors, in series order. */
  readonly colors?: readonly string[];
  /** Show the legend. */
  readonly legend?: boolean;
  /** Show value labels on points/bars. */
  readonly dataLabels?: boolean;
  /** Show the background gridlines. */
  readonly gridlines?: boolean;
  /** Number format applied to value labels + tooltips. `'none'` (default) leaves ApexCharts' own. */
  readonly numberFormat?: 'none' | 'currency' | 'percent' | 'thousands';
  /** Draw a dashed target/threshold line at this value on the measure axis. */
  readonly referenceLine?: number;
  /** Shade a target/tolerance region between two values on the measure axis. */
  readonly referenceBand?: { readonly from: number; readonly to: number };
  /** Overlay a linear (least-squares) trend line for the first series. */
  readonly trendline?: boolean;
  /** Project this many future periods for the first series, drawn as a forecast continuation. */
  readonly forecast?: number;
  /** With a forecast, also draw upper/lower prediction bounds (see {@link linearForecastBand}). */
  readonly forecastBand?: boolean;
  /** Axis titles. Only the sides you set are drawn (cartesian charts only). */
  readonly axisTitles?: { readonly x?: string; readonly y?: string };
}

/** Least-squares fit of `values` against index (0, 1, 2, …): `{ slope, intercept, n }`. */
function linearFit(values: readonly number[]): { slope: number; intercept: number; n: number } {
  const n = values.length;
  if (n === 0) return { slope: 0, intercept: 0, n: 0 };
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += i;
    sumY += values[i];
    sumXX += i * i;
    sumXY += i * values[i];
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  return { slope, intercept: (sumY - slope * sumX) / n, n };
}

/**
 * Least-squares linear fit of `values` against their index (0, 1, 2, …), returned as the predicted
 * y for each index — i.e. the straight trend line through the series. A flat line (mean) when the
 * x-variance is zero; empty in, empty out.
 */
export function linearTrend(values: readonly number[]): number[] {
  const { slope, intercept } = linearFit(values);
  return values.map((_, i) => intercept + slope * i);
}

/**
 * Project `periods` future values by extending the least-squares fit of `values` past its end
 * (indices n, n+1, …). Empty when `periods <= 0` or there is nothing to fit. Pairs with
 * {@link linearTrend} to draw a forecast continuation.
 */
export function linearForecast(values: readonly number[], periods: number): number[] {
  if (periods <= 0 || values.length === 0) return [];
  const { slope, intercept, n } = linearFit(values);
  return Array.from({ length: periods }, (_, k) => intercept + slope * (n + k));
}

/**
 * Prediction band around {@link linearForecast}: `{ upper, lower }`, one entry per future period.
 * The half-width is a ~95% prediction interval derived from the fit's residual standard error,
 * widening the further out the period is. Collapses to the point forecast (zero width) when there
 * are too few points to estimate spread. Empty in, empty out.
 */
export function linearForecastBand(
  values: readonly number[],
  periods: number
): { upper: number[]; lower: number[] } {
  const forecast = linearForecast(values, periods);
  if (forecast.length === 0) return { upper: [], lower: [] };
  const { slope, intercept, n } = linearFit(values);
  // Residual standard error (n - 2 dof for a line fit); undefined below 3 points → no band.
  let sse = 0;
  for (let i = 0; i < n; i += 1) sse += (values[i] - (intercept + slope * i)) ** 2;
  const se = n > 2 ? Math.sqrt(sse / (n - 2)) : 0;
  const z = 1.96;
  const halfWidth = (k: number) => z * se * Math.sqrt(1 + (k + 1) / n);
  return {
    upper: forecast.map((v, k) => v + halfWidth(k)),
    lower: forecast.map((v, k) => v - halfWidth(k)),
  };
}

const CIRCULAR_TYPES: ReadonlySet<ChartType | 'auto'> = new Set(['pie', 'donut']);

/** Build a value formatter for a {@link ChartFormat.numberFormat}, or `null` for `'none'`/unset. */
function makeNumberFormatter(
  kind: ChartFormat['numberFormat']
): ((value: number) => string) | null {
  switch (kind) {
    case 'currency':
      return (v) => `$${Math.round(Number(v)).toLocaleString('en-US')}`;
    case 'percent':
      return (v) => `${Number(v).toLocaleString('en-US')}%`;
    case 'thousands':
      return (v) => Number(v).toLocaleString('en-US');
    default:
      return null;
  }
}

/**
 * Translate a {@link ChartFormat} into a partial {@link ApexOptions} overlay. Only the fields the
 * caller actually set are emitted, so an empty format is a no-op and merging it never clobbers the
 * author's own options. Number formatting is applied to **data labels and tooltips** (not axes), so
 * it can't collide with a caller's multi-axis `yaxis` array. Circular charts (pie/donut) keep their
 * percentage labels. `type` decides only the circular-vs-cartesian branch.
 */
export function formatToApexOptions(
  format: ChartFormat,
  type: ChartType | 'auto' = 'column'
): Partial<ApexOptions> {
  const out: Record<string, unknown> = {};
  if (format.colors && format.colors.length > 0) out.colors = [...format.colors];
  if (format.legend !== undefined) out.legend = { show: format.legend };
  if (format.gridlines !== undefined) out.grid = { show: format.gridlines };

  const formatter = makeNumberFormatter(format.numberFormat);
  const cartesian = !CIRCULAR_TYPES.has(type);
  if (format.dataLabels !== undefined || (formatter && cartesian)) {
    const dataLabels: Record<string, unknown> = {};
    if (format.dataLabels !== undefined) dataLabels.enabled = format.dataLabels;
    if (formatter && cartesian) dataLabels.formatter = formatter;
    out.dataLabels = dataLabels;
  }
  if (formatter && cartesian) out.tooltip = { y: { formatter } };

  // Value-axis annotations: a dashed reference LINE and/or a shaded reference BAND. Both live on the
  // measure axis (yaxis for column/line, xaxis for a horizontal bar), so collect them into one array
  // per axis. Skipped for circular charts, which have no value axis.
  if (cartesian) {
    const along: Record<string, unknown>[] = [];
    if (typeof format.referenceLine === 'number') {
      const label = {
        text: String(format.referenceLine),
        style: { background: '#e11d48', color: '#fff' },
      };
      const key = type === 'bar' ? 'x' : 'y';
      along.push({
        [key]: format.referenceLine,
        borderColor: '#e11d48',
        strokeDashArray: 4,
        label,
      });
    }
    const { from, to } = format.referenceBand ?? {};
    if (Number.isFinite(from) && Number.isFinite(to)) {
      const band = { fillColor: '#e11d48', opacity: 0.12, borderColor: 'transparent' };
      along.push(type === 'bar' ? { x: from, x2: to, ...band } : { y: from, y2: to, ...band });
    }
    if (along.length > 0) out.annotations = type === 'bar' ? { xaxis: along } : { yaxis: along };
  }

  // Axis overlays (cartesian): number format drives the VALUE-axis labels (yaxis for column/line,
  // xaxis for a horizontal bar) so the change is visible where the big numbers live, plus any axis
  // titles. Each axis stays a plain object — the caller merges it onto a multi-axis array.
  if (cartesian) {
    const xaxis: Record<string, unknown> = {};
    const yaxis: Record<string, unknown> = {};
    const valueAxis = type === 'bar' ? xaxis : yaxis;
    if (formatter) valueAxis.labels = { formatter };
    if (format.axisTitles?.x) xaxis.title = { text: format.axisTitles.x };
    if (format.axisTitles?.y) yaxis.title = { text: format.axisTitles.y };
    if (Object.keys(xaxis).length > 0) out.xaxis = xaxis;
    if (Object.keys(yaxis).length > 0) out.yaxis = yaxis;
  }
  return out as Partial<ApexOptions>;
}

/**
 * Build a **dual value-axis** `yaxis` config: series named in `secondaryNames` bind to a second axis
 * drawn on the opposite side, the rest share the primary axis. Both axes carry the number formatter
 * (so labels match) and their optional titles. Returns `[]` when nothing is on the secondary axis —
 * the caller then keeps its single-axis path. ApexCharts binds a whole group of series to one axis
 * via an array `seriesName`, so primary series share one scale and secondary series share another
 * (rather than each auto-scaling on its own axis).
 */
export function buildValueAxes(
  seriesNames: readonly string[],
  secondaryNames: readonly string[],
  opts: {
    numberFormat?: ChartFormat['numberFormat'];
    primaryTitle?: string;
    secondaryTitle?: string;
  } = {}
): Record<string, unknown>[] {
  const secondarySet = new Set(secondaryNames);
  const primary = seriesNames.filter((name) => !secondarySet.has(name));
  const secondary = seriesNames.filter((name) => secondarySet.has(name));
  if (secondary.length === 0) return [];
  const formatter = makeNumberFormatter(opts.numberFormat);
  const labels = formatter ? { labels: { formatter } } : {};
  const axis = (names: string[], title: string | undefined, opposite: boolean) => ({
    // Only bind by name when there is a subset to bind; an empty array would orphan the axis.
    ...(names.length > 0 && names.length < seriesNames.length ? { seriesName: names } : {}),
    ...(opposite ? { opposite: true } : {}),
    ...(title ? { title: { text: title } } : {}),
    ...labels,
  });
  return [axis(primary, opts.primaryTitle, false), axis(secondary, opts.secondaryTitle, true)];
}

/**
 * Friendly chart types. Mapped to ApexCharts shapes internally (see
 * {@link chartModelToApexOptions}); `'column'`/`'bar'` distinguish vertical vs horizontal,
 * `'combo'` mixes per-series types.
 */
export type ChartType =
  | 'column'
  | 'bar'
  | 'line'
  | 'area'
  | 'pie'
  | 'donut'
  | 'scatter'
  | 'radar'
  | 'combo';

/** Circular types take ApexCharts' `{ series: number[], labels }` shape, not the cartesian one. */
const CIRCULAR: ReadonlySet<ChartType> = new Set(['pie', 'donut']);

/** Options for {@link renderApexChart} / {@link chartModelToApexOptions}. */
export interface RenderChartOptions {
  /** Friendly chart type, or `'auto'` for the recommended-type heuristic. Defaults to `'column'`. */
  readonly type?: ChartType | 'auto';
  readonly title?: string;
  /** Pixel height, or a CSS length like `'100%'` to fill the container. */
  readonly height?: number | string;
  /**
   * Per-series type overrides for `type: 'combo'`, aligned by series index. Defaults to series 0 =
   * column, the rest = line.
   */
  readonly comboTypes?: ChartType[];
  /** Extra ApexCharts options, deep-merged last (escape hatch). */
  readonly apexOptions?: Partial<ApexOptions>;
}

/** Map a friendly {@link ChartType} to the ApexCharts `chart.type` string. */
function toApexType(type: ChartType): NonNullable<ApexOptions['chart']>['type'] {
  switch (type) {
    case 'column':
    case 'bar':
      return 'bar';
    case 'combo':
      // Mixed charts use a base of 'line'; each series carries its own type.
      return 'line';
    default:
      return type;
  }
}

/**
 * Excel-style "Recommended Charts" lite: pick a sensible default type from the model shape.
 * One series over a handful of categories reads best as a pie; a long category axis as a line;
 * otherwise a column chart.
 */
export function recommendChartType(model: ChartModel): ChartType {
  if (model.series.length === 1 && model.categories.length <= 6) return 'pie';
  if (model.categories.length > 12) return 'line';
  return 'column';
}

/**
 * Pure transform: a {@link ChartModel} + options into an ApexCharts options object. No ApexCharts
 * import, so it is unit-tested directly. Handles the cartesian vs circular (pie/donut) data shapes
 * and combo per-series types, resolves `type: 'auto'`, and deep-merges `apexOptions` last so the
 * caller can override anything.
 */
export function chartModelToApexOptions(
  model: ChartModel,
  options: RenderChartOptions = {}
): ApexOptions {
  const requested = options.type ?? 'column';
  const type: ChartType = requested === 'auto' ? recommendChartType(model) : requested;
  const height = options.height ?? 320;
  const title = options.title ? { title: { text: options.title } } : {};
  const userApex = options.apexOptions ?? {};
  // Deep-merge `chart` and `xaxis` (per-key, caller wins) and place them LAST in the returned
  // object. A shallow `...apexOptions` spread would replace the whole `chart` / `xaxis` object and
  // silently drop what we computed whenever a caller passes a nested option: a `chart.*` option
  // (animations, toolbar) would lose the resolved `type` and collapse every chart to ApexCharts'
  // default line, and an `xaxis.labels` formatter (e.g. money on the value axis of a horizontal bar)
  // would lose `categories` and fall the category axis back to 1, 2, 3. Merging keeps our keys
  // unless the caller overrides them outright.
  const chart = { type: toApexType(type), height, ...userApex.chart };

  if (CIRCULAR.has(type)) {
    // Pie/donut chart the first measure across categories; extra series are ignored.
    const apexOptions: ApexOptions = {
      series: model.series[0]?.data ?? [],
      labels: model.categories,
      ...title,
      ...userApex,
      chart,
    };
    return apexOptions;
  }

  const series =
    type === 'combo'
      ? model.series.map((s, i) => ({
          name: s.name,
          data: s.data,
          type: toApexType(options.comboTypes?.[i] ?? (i === 0 ? 'column' : 'line')),
          // Per-series color: overlays (trend/forecast) carry their own so they read as distinct
          // from the data series (see the panel's #withOverlays).
          ...((s as { color?: string }).color ? { color: (s as { color?: string }).color } : {}),
        }))
      : model.series.map((s) => ({ name: s.name, data: s.data }));

  const xaxis = { categories: model.categories, ...userApex.xaxis };
  // 'column' is the default (vertical); 'bar' flips to horizontal. Deep-merge so a caller's
  // `plotOptions` (e.g. bar.borderRadius) does not drop the horizontal flag.
  const plotOptions =
    type === 'bar'
      ? { ...userApex.plotOptions, bar: { horizontal: true, ...userApex.plotOptions?.bar } }
      : userApex.plotOptions;
  // Stroke: bars/columns carry NO outline (width 0) so they read clean; line/area draw a stroke.
  // A combo sets the width per series by its resolved type, so only the line-like series get a
  // stroke and the bar/column series stay flat. Deep-merged so a caller's `stroke` (an explicit
  // width, or the dashArray the panel adds for overlays) still wins.
  const strokeWidth =
    type === 'combo'
      ? (series as { type?: string }[]).map((s) => (s.type === 'bar' ? 0 : 2))
      : type === 'bar' || type === 'column'
        ? 0
        : undefined;
  const stroke =
    strokeWidth === undefined ? {} : { stroke: { width: strokeWidth, ...userApex.stroke } };
  const apexOptions: ApexOptions = {
    series,
    ...title,
    ...userApex,
    ...(plotOptions ? { plotOptions } : {}),
    ...stroke,
    chart,
    xaxis,
  };
  return apexOptions;
}

/**
 * Render a {@link ChartModel} into `container` using ApexCharts and return the instance (so the
 * caller can `updateOptions`/`destroy`).
 *
 * ApexCharts is **dynamically imported** so it only loads when a chart is actually drawn (the base
 * enterprise bundle stays lean). Render into a light-DOM container (not the grid's shadow root):
 * ApexCharts injects global styles and measures layout, which is unreliable inside shadow DOM.
 */
export async function renderApexChart(
  container: HTMLElement,
  model: ChartModel,
  options: RenderChartOptions = {}
) {
  const { default: ApexCharts } = await import('apexcharts');
  const chart = new ApexCharts(container, chartModelToApexOptions(model, options));
  await chart.render();
  return chart;
}
