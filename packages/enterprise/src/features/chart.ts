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
        }))
      : model.series.map((s) => ({ name: s.name, data: s.data }));

  const xaxis = { categories: model.categories, ...userApex.xaxis };
  // 'column' is the default (vertical); 'bar' flips to horizontal. Deep-merge so a caller's
  // `plotOptions` (e.g. bar.borderRadius) does not drop the horizontal flag.
  const plotOptions =
    type === 'bar'
      ? { ...userApex.plotOptions, bar: { horizontal: true, ...userApex.plotOptions?.bar } }
      : userApex.plotOptions;
  const apexOptions: ApexOptions = {
    series,
    ...title,
    ...userApex,
    ...(plotOptions ? { plotOptions } : {}),
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
