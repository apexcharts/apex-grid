import { registerComponent } from '../internal/register.js';
import { GRID_CELL_CHART_TAG } from '../internal/tags.js';
import type { ChartColumnOptions } from '../internal/types.js';

/** The part of an ApexCharts instance a `type: 'chart'` cell calls. */
export interface ApexChartsInstanceLike {
  render(): Promise<unknown>;
  updateSeries(series: unknown[], animate?: boolean): unknown;
  updateOptions(options: object, redrawPaths?: boolean, animate?: boolean): unknown;
  destroy(): void;
}

/**
 * The ApexCharts constructor, as `type: 'chart'` columns use it. Typed by
 * shape so this package does not depend on the apexcharts types.
 */
export type ApexChartsConstructor = new (
  element: HTMLElement,
  options: object
) => ApexChartsInstanceLike;

/** What a chart cell draws: set as one object so a re-bind is one update. */
export interface ChartCellState {
  /** The ApexCharts `series`. */
  series: unknown[];
  /**
   * The ApexCharts options, without `series`. Keep the same object while the
   * options do not change: a new one is a full `updateOptions` or a rebuild.
   */
  options: ChartColumnOptions;
  /** The cell's accessible name. */
  label: string;
}

let registered: ApexChartsConstructor | undefined;
let warned = false;
let awaitingLoad = false;
/** Cells that rendered before ApexCharts was available, built once it is. */
const waiting = new Set<ApexGridCellChart>();

/**
 * Gives `type: 'chart'` columns the ApexCharts constructor to draw with.
 *
 * @remarks
 * Call it once, before or after the grid renders: cells already on the page
 * build their charts when it is called. Without it, a chart column uses a
 * global `window.ApexCharts` from a script tag, including an `async` or
 * `defer` one that runs after the grid renders: the cells waiting for it build
 * on the page's `load` event. A script added after that needs this call. With
 * neither, the cells stay empty and the grid warns once.
 *
 * Chart columns need ApexCharts 8.4.1 or later, the release that renders
 * inside a shadow root.
 *
 * ```ts
 * import ApexCharts from 'apexcharts';
 * import { setApexCharts } from 'apex-grid';
 *
 * setApexCharts(ApexCharts);
 * ```
 */
export function setApexCharts(ApexCharts: ApexChartsConstructor): void {
  registered = ApexCharts;
  buildWaiting();
}

function buildWaiting(): void {
  const pending = [...waiting];
  waiting.clear();
  for (const cell of pending) cell.build();
}

function resolveApexCharts(): ApexChartsConstructor | undefined {
  if (registered) return registered;
  const global = (globalThis as { ApexCharts?: unknown }).ApexCharts;
  return typeof global === 'function' ? (global as ApexChartsConstructor) : undefined;
}

/**
 * Called when a cell finds no ApexCharts. While the page is still loading, a
 * script tag can yet define the global, so look again on `load` and warn only
 * if it is still missing then.
 */
function whenMissing(): void {
  if (awaitingLoad) return;
  if (document.readyState === 'complete') {
    warnMissing();
    return;
  }
  awaitingLoad = true;
  window.addEventListener(
    'load',
    () => {
      awaitingLoad = false;
      if (resolveApexCharts()) buildWaiting();
      else if (waiting.size) warnMissing();
    },
    { once: true }
  );
}

function warnMissing(): void {
  if (warned) return;
  warned = true;
  // biome-ignore lint/suspicious/noConsole: intentional one-shot misconfiguration diagnostic
  console.warn(
    "[apex-grid] A `type: 'chart'` column needs ApexCharts 8.4.1 or later. Call " +
      "setApexCharts(ApexCharts) from 'apex-grid', or load apexcharts with a script tag " +
      'that runs before the page finishes loading. The cells stay empty until then.'
  );
}

/**
 * Whether `next` sets every key `previous` set, at every depth of plain
 * objects. ApexCharts merges an `updateOptions` payload into the chart's
 * config and keeps any key the payload leaves out, so when `next` drops one
 * (a per-row target line on one record and not the next, or a new column
 * object without it) only a fresh chart draws `next` alone. Arrays and other
 * values are replaced whole by the merge, so their contents need no check.
 * A `null` counts as left out, because ApexCharts drops it from the payload.
 */
function setsEveryKeyOf(next: Record<string, unknown>, previous: Record<string, unknown>): boolean {
  for (const key of Object.keys(previous)) {
    const was = previous[key];
    if (was == null) continue;
    const now = next[key];
    // ApexCharts drops a `null` option before merging, so it clears nothing.
    if (now == null) return false;
    if (isPlainObject(was) && isPlainObject(now) && !setsEveryKeyOf(now, was)) return false;
  }
  return true;
}

/** The `chart.type` an options object sets. */
function chartTypeOf(options: Record<string, unknown>): unknown {
  return isPlainObject(options.chart) ? options.chart.type : undefined;
}

/**
 * Whether a chart drawn with `previous` can be moved to `next` with
 * `updateOptions` and draw what a fresh chart would.
 *
 * @remarks
 * Not when `next` leaves out a key `previous` set ({@link setsEveryKeyOf}).
 * Not when either sets `yaxis`: ApexCharts (8.8.1) refills an updated y axis
 * from its plain defaults, which shows the axis a sparkline hides. Not when the
 * chart type changes: an update hands over only some of the old type's
 * defaults. Other changes (colours, fills, strokes, markers, annotations, the
 * x axis) update in place.
 */
function canUpdateInPlace(
  next: Record<string, unknown>,
  previous: Record<string, unknown>
): boolean {
  if (next.yaxis != null || previous.yaxis != null) return false;
  if (chartTypeOf(next) !== chartTypeOf(previous)) return false;
  return setsEveryKeyOf(next, previous);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * `HTMLElement` in a browser, and an empty class where there is no DOM, so
 * importing the grid during server rendering does not throw. The element is
 * only defined and created in a browser.
 */
const ElementBase = (globalThis.HTMLElement ?? class {}) as typeof HTMLElement;

/**
 * One ApexCharts chart in a grid cell, kept for the element's whole life.
 *
 * @remarks
 * Rows are recycled, so the grid hands this element another record on a sort,
 * a filter or a scroll step. It re-points the chart it already has rather than
 * building a new one, and destroys it only once it has really left the page:
 * the row virtualizer moves rows far more often than it removes them, and a
 * move disconnects and reconnects the element.
 *
 * The chart stays out of the accessibility tree; the element is `role="img"`
 * with a label naming what it shows.
 *
 * @element apex-grid-cell-chart
 */
export default class ApexGridCellChart extends ElementBase {
  public static readonly tagName = GRID_CELL_CHART_TAG;

  public static register(): void {
    registerComponent(ApexGridCellChart);
  }

  #state?: ChartCellState;
  #chart?: ApexChartsInstanceLike;
  /** The options object the chart was built with or last updated to. */
  #options?: ChartColumnOptions;

  /** What to draw. Assigned by the column type on every render. */
  public set state(next: ChartCellState) {
    this.#state = next;
    if (next.label) this.setAttribute('aria-label', next.label);
    else this.removeAttribute('aria-label');

    if (!next.series.length) {
      this.#teardown();
      return;
    }
    if (!this.#chart) {
      this.build();
      return;
    }
    if (next.options !== this.#options) {
      if (
        !this.#options ||
        !canUpdateInPlace(
          next.options as Record<string, unknown>,
          this.#options as Record<string, unknown>
        )
      ) {
        this.#teardown();
        this.build();
        return;
      }
      this.#options = next.options;
      this.#chart.updateOptions({ ...next.options, series: next.series }, false, false);
    } else {
      this.#chart.updateSeries(next.series, false);
    }
  }

  public get state(): ChartCellState | undefined {
    return this.#state;
  }

  /** The chart this cell draws with, once built. */
  public get chart(): ApexChartsInstanceLike | undefined {
    return this.#chart;
  }

  public connectedCallback(): void {
    this.setAttribute('role', 'img');
    // A move reconnects an element that already has its chart.
    if (!this.#chart) this.build();
  }

  public disconnectedCallback(): void {
    // A move is a disconnect followed by a connect in the same task, so check
    // once it has finished.
    queueMicrotask(() => {
      if (!this.isConnected) this.#teardown();
    });
  }

  /** @internal Builds the chart when there is data, a page and ApexCharts. */
  public build(): void {
    const state = this.#state;
    if (this.#chart || !state || !state.series.length || !this.isConnected) return;
    const ApexCharts = resolveApexCharts();
    if (!ApexCharts) {
      waiting.add(this);
      whenMissing();
      return;
    }
    waiting.delete(this);
    this.#options = state.options;
    this.#chart = new ApexCharts(this, { ...state.options, series: state.series });
    void this.#chart.render();
  }

  #teardown(): void {
    waiting.delete(this);
    this.#chart?.destroy();
    this.#chart = undefined;
    this.#options = undefined;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [ApexGridCellChart.tagName]: ApexGridCellChart;
  }
}
