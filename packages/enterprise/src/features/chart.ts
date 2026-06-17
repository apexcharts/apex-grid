import type { ApexOptions } from 'apexcharts';

/** A single chart series (one bar/line group). */
export interface ChartSeries {
  readonly name: string;
  readonly data: number[];
}

/** Chart-ready model derived from the grid's group/pivot aggregates. */
export interface ChartModel {
  readonly categories: string[];
  readonly series: ChartSeries[];
}

/** Options for {@link renderApexChart}. */
export interface RenderChartOptions {
  /** ApexCharts chart type. Defaults to `'bar'`. */
  readonly type?: NonNullable<ApexOptions['chart']>['type'];
  readonly title?: string;
  readonly height?: number;
  /** Extra ApexCharts options, deep-merged last (escape hatch). */
  readonly apexOptions?: Partial<ApexOptions>;
}

/**
 * Render a {@link ChartModel} into `container` using ApexCharts and return the
 * instance (so the caller can `updateOptions`/`destroy`).
 *
 * ApexCharts is **dynamically imported** so it only loads when a chart is
 * actually drawn — the base enterprise bundle stays lean. Render into a
 * light-DOM container (not the grid's shadow root): ApexCharts injects global
 * styles and measures layout, which is unreliable inside shadow DOM.
 */
export async function renderApexChart(
  container: HTMLElement,
  model: ChartModel,
  options: RenderChartOptions = {}
) {
  const { default: ApexCharts } = await import('apexcharts');
  const apexOptions: ApexOptions = {
    chart: { type: options.type ?? 'bar', height: options.height ?? 320 },
    series: model.series.map((series) => ({ name: series.name, data: series.data })),
    xaxis: { categories: model.categories },
    ...(options.title ? { title: { text: options.title } } : {}),
    ...options.apexOptions,
  };
  const chart = new ApexCharts(container, apexOptions);
  await chart.render();
  return chart;
}
