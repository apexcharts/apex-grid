import type { default as ApexCharts, ApexOptions } from 'apexcharts';

/** A single chart series (one bar/line group). */
export interface ChartSeries {
  readonly name: string;
  /**
   * One value per category. `null` is a gap: a calculated field whose formula errors or is not
   * finite for that category yields `null` there, and the chart leaves the point out.
   */
  readonly data: readonly (number | null)[];
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
 * A chart series computed from a formula rather than a column. The formula uses **A1** references,
 * one letter per column (row is always 1: one aggregated value per column per category). Evaluated
 * once per category over the aggregated values. See {@link ChartDefinition.calculatedFields}.
 */
export interface CalculatedField {
  /** Series name (shown in the legend). */
  readonly name: string;
  /** Formula, e.g. `bonus / salary * 100` written as `B1 / A1 * 100`. A leading `=` is optional. */
  readonly formula: string;
  /**
   * The column key each letter reads, e.g. `{ A: 'salary', B: 'bonus' }`, so the field keeps its
   * meaning when the chart's source columns change (another selection, a hidden or moved column).
   * A letter whose column the source does not hold reads blank. `<apex-grid-chart>` records the
   * letters its legend showed when the field is added. Without `refs` the letters map to the
   * source's numeric non-category columns in display order (`A1` = the first, `B1` = the second, …),
   * the frame the legend shows.
   */
  readonly refs?: Readonly<Record<string, string>>;
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
  /**
   * ISO 4217 code for the `'currency'` number format (e.g. `'EUR'`). Defaults to USD;
   * `<apex-grid-chart>` defaults it to the first measure column's `currency`.
   */
  readonly currency?: string;
  /**
   * BCP 47 locale for the number formats (e.g. `'de-DE'`). Defaults to the runtime locale;
   * `<apex-grid-chart>` defaults it to the first measure column's `locale`.
   */
  readonly locale?: string;
  /** Draw a dashed target/threshold line at this value on the measure axis. */
  readonly referenceLine?: number;
  /** Shade a target/tolerance region between two values on the measure axis. */
  readonly referenceBand?: { readonly from: number; readonly to: number };
  /**
   * Overlay a linear (least-squares) trend line for the first series. Column, line and area charts
   * only: a no-op for a horizontal bar, which cannot render as a combo.
   */
  readonly trendline?: boolean;
  /**
   * Project this many future periods for the first series, drawn as a forecast continuation. Read as
   * whole periods (floored, at least 0, at most 1000); the same chart types as {@link trendline}.
   */
  readonly forecast?: number;
  /** With a forecast, also draw upper/lower prediction bounds (see {@link linearForecastBand}). */
  readonly forecastBand?: boolean;
  /** Axis titles. Only the sides you set are drawn (cartesian charts only). */
  readonly axisTitles?: { readonly x?: string; readonly y?: string };
}

/**
 * Least-squares fit of `values` against index (0, 1, 2, ...), skipping `null` gaps so a missing point
 * neither counts nor pulls the line toward 0. `n` is the number of points fitted; `meanX` and `sxx`
 * (the spread of their indices) feed the prediction band.
 */
function linearFit(values: readonly (number | null)[]): {
  slope: number;
  intercept: number;
  n: number;
  meanX: number;
  sxx: number;
} {
  let n = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (let i = 0; i < values.length; i += 1) {
    const y = values[i];
    if (y == null) continue;
    n += 1;
    sumX += i;
    sumY += y;
    sumXX += i * i;
    sumXY += i * y;
  }
  if (n === 0) return { slope: 0, intercept: 0, n: 0, meanX: 0, sxx: 0 };
  const meanX = sumX / n;
  const sxx = sumXX - sumX * meanX;
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, n, meanX, sxx };
  const slope = (n * sumXY - sumX * sumY) / denom;
  return { slope, intercept: (sumY - slope * sumX) / n, n, meanX, sxx };
}

/**
 * Least-squares linear fit of `values` against their index (0, 1, 2, ...), returned as the predicted
 * y for each index, i.e. the straight trend line through the series. `null` gaps are left out of the
 * fit but still get a trend value at their index. A flat line (mean) when the x-variance is zero;
 * empty in, empty out; all gaps give a flat line at 0.
 */
export function linearTrend(values: readonly (number | null)[]): number[] {
  const { slope, intercept } = linearFit(values);
  return values.map((_, i) => intercept + slope * i);
}

/**
 * Project `periods` future values by extending the least-squares fit of `values` past its end
 * (indices n, n+1, ..., where n is the series length, gaps included). `null` gaps are left out of
 * the fit. Empty when `periods <= 0` or `values` is empty. Pairs with {@link linearTrend} to draw a
 * forecast continuation.
 */
export function linearForecast(values: readonly (number | null)[], periods: number): number[] {
  if (periods <= 0 || values.length === 0) return [];
  const { slope, intercept } = linearFit(values);
  const start = values.length;
  return Array.from({ length: periods }, (_, k) => intercept + slope * (start + k));
}

/** Two-sided 95% Student-t quantiles for 1 to 9 degrees of freedom. */
const T_975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262];

/**
 * Prediction band around {@link linearForecast}: `{ upper, lower }`, one entry per future period.
 * Each is the 95% prediction interval of the least-squares line at that period:
 * `t * se * sqrt(1 + 1/n + (x0 - mean x)^2 / Sxx)`, where `se` is the residual standard error and
 * `t` the two-sided 97.5% Student-t quantile for `n - 2` degrees of freedom (a table below 10, the
 * Cornish-Fisher series from 10 on, within 0.003). The band widens the further out the period is.
 * Collapses to the point forecast (zero width) below 3 points, where spread cannot be estimated.
 * `null` gaps are left out: `n`, `mean x` and `Sxx` cover the points present. Empty in, empty out.
 */
export function linearForecastBand(
  values: readonly (number | null)[],
  periods: number
): { upper: number[]; lower: number[] } {
  const forecast = linearForecast(values, periods);
  if (forecast.length === 0) return { upper: [], lower: [] };
  const { slope, intercept, n, meanX, sxx } = linearFit(values);
  // Residual standard error needs n - 2 > 0 dof: below 3 points there is no spread, so no band.
  if (n < 3) return { upper: [...forecast], lower: [...forecast] };
  let sse = 0;
  for (let i = 0; i < values.length; i += 1) {
    const y = values[i];
    if (y != null) sse += (y - (intercept + slope * i)) ** 2;
  }
  const dof = n - 2;
  const se = Math.sqrt(sse / dof);
  const z = 1.96;
  const t =
    T_975[dof - 1] ??
    z + (z ** 3 + z) / (4 * dof) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * dof * dof);
  const start = values.length;
  const halfWidth = (k: number) => t * se * Math.sqrt(1 + 1 / n + (start + k - meanX) ** 2 / sxx);
  return {
    upper: forecast.map((v, k) => v + halfWidth(k)),
    lower: forecast.map((v, k) => v - halfWidth(k)),
  };
}

/**
 * Build a value formatter for a {@link ChartFormat.numberFormat}, or `null` for `'none'`/unset.
 * Currency is whole units of `currency` (USD by default); every format groups digits for `locale`
 * (the runtime locale by default). A malformed currency falls back to USD and a malformed locale
 * to the runtime one, each keeping the other, instead of throwing on every label.
 */
function makeNumberFormatter({
  numberFormat,
  currency = 'USD',
  locale,
}: ChartFormat): ((value: number) => string) | null {
  if (!numberFormat || numberFormat === 'none') return null;
  const make = (tag: string | undefined, code: string): Intl.NumberFormat | null => {
    try {
      return new Intl.NumberFormat(
        tag,
        numberFormat === 'currency'
          ? {
              style: 'currency',
              currency: code,
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            }
          : {}
      );
    } catch {
      return null;
    }
  };
  const format = (make(locale, currency) ??
    make(locale, 'USD') ??
    make(undefined, currency) ??
    make(undefined, 'USD')) as Intl.NumberFormat;
  const suffix = numberFormat === 'percent' ? '%' : '';
  return (v) => `${format.format(Number(v))}${suffix}`;
}

/**
 * Translate a {@link ChartFormat} into a partial {@link ApexOptions} overlay. Only the fields the
 * caller actually set are emitted, so an empty format is a no-op and merging it never clobbers the
 * author's own options. Number formatting is applied to **data labels and tooltips** (not axes), so
 * it can't collide with a caller's multi-axis `yaxis` array. Circular charts (pie/donut) keep their
 * percentage labels. `type` decides only the circular-vs-cartesian branch: pass the resolved type
 * (see {@link recommendChartType}), since `'auto'` may draw a pie and is never treated as cartesian.
 */
export function formatToApexOptions(
  format: ChartFormat,
  type: ChartType | 'auto' = 'column'
): Partial<ApexOptions> {
  const out: Record<string, unknown> = {};
  if (format.colors && format.colors.length > 0) out.colors = [...format.colors];
  if (format.legend !== undefined) out.legend = { show: format.legend };
  if (format.gridlines !== undefined) out.grid = { show: format.gridlines };

  const formatter = makeNumberFormatter(format);
  const cartesian = type !== 'auto' && !CIRCULAR.has(type);
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
  opts: Pick<ChartFormat, 'numberFormat' | 'currency' | 'locale'> & {
    primaryTitle?: string;
    secondaryTitle?: string;
  } = {}
): Record<string, unknown>[] {
  const secondarySet = new Set(secondaryNames);
  const primary = seriesNames.filter((name) => !secondarySet.has(name));
  const secondary = seriesNames.filter((name) => secondarySet.has(name));
  if (secondary.length === 0) return [];
  const formatter = makeNumberFormatter(opts);
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
 * One series of parts of a whole (no negative value, a positive total) over a handful of categories
 * reads best as a pie; a long category axis as a line; otherwise a column chart.
 */
export function recommendChartType(model: ChartModel): ChartType {
  const data = model.series[0]?.data ?? [];
  if (
    model.series.length === 1 &&
    model.categories.length <= 6 &&
    data.every((v) => v == null || v >= 0) &&
    data.reduce<number>((a, b) => a + (b ?? 0), 0) > 0
  ) {
    return 'pie';
  }
  if (model.categories.length > 12) return 'line';
  return 'column';
}

/**
 * ApexCharts writes the legend text and the tooltip title and series label with innerHTML, so cell
 * text used as a category or series name would be parsed as markup there (an `<img onerror>` would
 * run). In element content only a `<` followed by an ASCII letter, `!`, `/` or `?` opens markup; any
 * other `<` is kept as a literal character. Escaping just that `<` keeps markup literal while a label
 * such as "<18", "a < b" or "R&D" renders, and is announced (the legend also copies this text into
 * its aria-label), exactly as before. The axes draw SVG text, which is never parsed, so the model's
 * categories and series names stay raw.
 */
const escapeLabel = (value: unknown): string => String(value).replace(/<(?=[A-Za-z!/?])/g, '&lt;');

/** One `tooltip.y` entry (ApexCharts also accepts an array of these, one per series). */
type TooltipY = Exclude<NonNullable<NonNullable<ApexOptions['tooltip']>['y']>, unknown[]>;

/**
 * Escaping formatters for those HTML sinks, layered under the caller's own `legend` / `tooltip`
 * options (a caller formatter still wins). The tooltip title first runs through the formatter
 * ApexCharts itself would use (its x labels formatter, or the first y labels formatter on a
 * horizontal bar), so a line chart still maps its point index back to the category name and a
 * numeric x axis keeps its number formatting. That path also covers a numeric x axis over string
 * categories, where ApexCharts hands the raw cell text to the title. Skipped only on a datetime x
 * axis, where ApexCharts formats a parsed date (non-date text throws before any sink is reached).
 */
function escapedLabelOptions(user: ApexOptions, model: ChartModel): ApexOptions {
  const tooltip = user.tooltip ?? {};
  const { y } = tooltip;
  // `opts.w` is ApexCharts' untyped chart context.
  const xTitle = (value: unknown, opts?: any) => {
    const w = opts?.w;
    const format = w?.globals?.isBarHorizontal
      ? w.formatters?.yLabelFormatters?.[0]
      : w?.formatters?.xLabelFormatter;
    return escapeLabel(format ? format(value, opts) : value);
  };
  const yTitle = (name: string) => (name ? `${escapeLabel(name)}: ` : '');
  const withTitle = (entry?: TooltipY) => ({
    ...entry,
    title: { formatter: yTitle, ...entry?.title },
  });
  return {
    legend: { formatter: escapeLabel, ...user.legend },
    tooltip: {
      ...tooltip,
      x: { ...(user.xaxis?.type === 'datetime' ? {} : { formatter: xTitle }), ...tooltip.x },
      // A per-series array (one entry per series, for per-series units; a pie indexes it by slice)
      // gets the same title escape. ApexCharts falls back to the raw name for a series past the end
      // of the array or on a hole (which map skips), so pad and fill it to cover every series.
      y: Array.isArray(y)
        ? Array.from(
            { length: Math.max(y.length, model.series.length, model.categories.length) },
            (_, i) => withTitle(y[i])
          )
        : withTitle(y),
    },
  };
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
  const escaped = escapedLabelOptions(userApex, model);

  if (CIRCULAR.has(type)) {
    // Pie/donut chart the first measure across categories; extra series are ignored.
    const apexOptions: ApexOptions = {
      // ApexCharts types a pie series as number[]; a null gap is passed through unchanged.
      series: (model.series[0]?.data ?? []) as number[],
      labels: model.categories,
      ...title,
      ...userApex,
      ...escaped,
      chart,
    };
    return apexOptions;
  }

  const series =
    type === 'combo'
      ? model.series.map((s, i) => ({
          name: s.name,
          data: s.data as (number | null)[],
          type: toApexType(options.comboTypes?.[i] ?? (i === 0 ? 'column' : 'line')),
          // Per-series color: overlays (trend/forecast) carry their own so they read as distinct
          // from the data series (see the panel's #withOverlays).
          ...((s as { color?: string }).color ? { color: (s as { color?: string }).color } : {}),
        }))
      : model.series.map((s) => ({ name: s.name, data: s.data as (number | null)[] }));

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
    ...escaped,
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
  // A literal specifier inside try: bundlers still include apexcharts when it is installed, and a
  // build without it (it is an optional peer) defers the failure to here instead of failing.
  let apexcharts: { default: typeof ApexCharts };
  try {
    apexcharts = await import('apexcharts');
  } catch (cause) {
    throw new Error('apex-grid-enterprise: charts need the "apexcharts" package; install it.', {
      cause,
    });
  }
  const chart = new apexcharts.default(container, chartModelToApexOptions(model, options));
  await chart.render();
  return chart;
}
