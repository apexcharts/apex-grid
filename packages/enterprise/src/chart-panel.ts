import { registerComponent } from 'apex-grid/internal';
import type ApexCharts from 'apexcharts';
import { html, LitElement, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import {
  type ChartModel,
  type ChartType,
  chartModelToApexOptions,
  type RenderChartOptions,
  renderApexChart,
} from './features/chart.js';
import { RANGE_CHANGED_EVENT } from './features/range-selection.js';
import { type ApexGridEnterprise, VIEW_CHANGED_EVENT } from './grid-enterprise.js';

export const CHART_TAG = 'apex-grid-chart';

/** Where the chart panel pulls its model from. */
export type ChartSource = 'auto' | 'selection' | 'view';

/** The type gallery shown in the panel toolbar (label + friendly type). */
const TYPE_GALLERY: ReadonlyArray<{ type: ChartType | 'auto'; label: string }> = [
  { type: 'column', label: 'Column' },
  { type: 'bar', label: 'Bar' },
  { type: 'line', label: 'Line' },
  { type: 'area', label: 'Area' },
  { type: 'pie', label: 'Pie' },
  { type: 'donut', label: 'Donut' },
  { type: 'scatter', label: 'Scatter' },
  { type: 'radar', label: 'Radar' },
  { type: 'combo', label: 'Combo' },
  { type: 'auto', label: 'Auto' },
];

// Brand + semantic accent tokens, in palette order, read off the grid for theme="grid".
const PALETTE_TOKENS = [
  '--ag-brand',
  '--ag-brand-strong',
  '--ag-good-text',
  '--ag-watch-text',
  '--ag-risk-text',
  '--ag-gold-text',
];

/** Coarse light/dark decision from a CSS color string (rgb/rgba or hex). */
function isDark(color: string): boolean {
  const rgb = color.match(/\d+(\.\d+)?/g);
  if (!rgb || rgb.length < 3) return false;
  const [r, g, b] = rgb.map(Number);
  // Rec. 601 luma; < 0.5 of 255 reads as a dark surface.
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

/**
 * Built-in chart panel for `<apex-grid-enterprise>`. Mount it beside (or below) a grid and set its
 * `grid` property: it renders the grid's current chart model (cell selection, or grouping/pivot
 * view) with ApexCharts, switches chart type from a gallery, and **live-redraws** as the selection
 * or view changes.
 *
 * Two container modes via `mode`: `'inline'` renders in place; `'dialog'` (default) renders a
 * floating, draggable panel — append it to `document.body` and call {@link show}. ApexCharts is
 * dynamically imported, so registering the element costs nothing until a chart is drawn.
 *
 * Unlike the other companion elements, this one renders in **light DOM**: ApexCharts injects global
 * styles and measures layout and cannot render inside a shadow root.
 *
 * @element apex-grid-chart
 *
 * @fires apex-chart-created - After a chart renders: `{ chart, type }`.
 * @fires apex-chart-type-changed - When the gallery changes type: `{ type }`.
 * @fires apex-chart-closed - When a dialog panel is dismissed.
 *
 * @csspart panel - The panel container.
 * @csspart header - Dialog header (drag handle + title + close).
 * @csspart toolbar - The type gallery / theme switcher row.
 * @csspart type-button - A chart-type button in the gallery.
 * @csspart canvas - The light-DOM element ApexCharts renders into.
 * @csspart placeholder - Shown when there is nothing to chart.
 */
export class ApexGridChart extends LitElement {
  public static get tagName(): string {
    return CHART_TAG;
  }

  public static register(): void {
    registerComponent(ApexGridChart);
  }

  // Light DOM: ApexCharts cannot render inside a shadow root.
  protected override createRenderRoot(): this {
    return this;
  }

  /** The enterprise grid to chart. Setting it (re)binds the live listeners. */
  @property({ attribute: false })
  public grid: ApexGridEnterprise<Record<string, unknown>> | null = null;

  /** `'inline'` renders in place; `'dialog'` (default) is a floating, draggable panel. */
  @property({ reflect: true })
  public mode: 'inline' | 'dialog' = 'dialog';

  /** Active chart type, or `'auto'` (the recommended-type heuristic). */
  @property()
  public type: ChartType | 'auto' = 'auto';

  /** Which model to chart: selection if present else view (`'auto'`), or force one. */
  @property()
  public source: ChartSource = 'auto';

  /** Palette: `'grid'` derives colors from the grid's theme tokens; `'light'`/`'dark'` force a mode. */
  @property()
  public theme: 'grid' | 'light' | 'dark' = 'grid';

  /** Dialog open state (no-op for `mode="inline"`). */
  @property({ type: Boolean, reflect: true })
  public open = false;

  /** Panel heading (dialog mode). */
  @property()
  public heading = 'Chart';

  @property({ type: Number })
  public height = 320;

  /**
   * Cross-filter mode: clicking a category filters the grid to it (and toggles off on re-click).
   * The chart reads the grid's full, unfiltered data, so it keeps all categories rather than
   * collapsing to the filtered subset.
   */
  @property({ type: Boolean, reflect: true, attribute: 'cross-filter' })
  public crossFilter = false;

  /** Extra ApexCharts options, merged last (escape hatch — the thin-Format story). */
  @property({ attribute: false })
  public apexOptions: RenderChartOptions['apexOptions'] = {};

  @state()
  private hasModel = false;

  #chart: ApexCharts | null = null;
  #boundGrid: HTMLElement | null = null;
  /** Cross-filter: the column key being filtered, and the active category value (or null). */
  #crossFilterKey: string | null = null;
  #activeCategory: string | null = null;
  #rafHandle = 0;
  #drag: { pointerId: number; offsetX: number; offsetY: number } | null = null;

  public override disconnectedCallback(): void {
    this.#detach();
    this.#clearCrossFilter();
    this.#destroyChart();
    if (this.#rafHandle) cancelAnimationFrame(this.#rafHandle);
    this.#rafHandle = 0;
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('grid')) this.#attach();
  }

  protected override updated(changed: Map<PropertyKey, unknown>): void {
    // Turning cross-filter off drops any filter it applied.
    if (changed.has('crossFilter') && !this.crossFilter) this.#clearCrossFilter();
    // Type / source / theme / cross-filter changes (and a fresh grid) all force a redraw.
    if (
      changed.has('type') ||
      changed.has('source') ||
      changed.has('theme') ||
      changed.has('grid') ||
      changed.has('crossFilter')
    ) {
      this.#scheduleRefresh();
    }
  }

  // --- public API ----------------------------------------------------------

  /** Open the dialog panel. */
  public show(): void {
    this.open = true;
    this.#scheduleRefresh();
  }

  /** Close the dialog panel and notify (e.g. so a launcher can remove it). */
  public close(): void {
    this.open = false;
    this.dispatchEvent(new CustomEvent('apex-chart-closed', { bubbles: true, composed: true }));
  }

  /** The live ApexCharts instance, or `null`. */
  public getChart(): ApexCharts | null {
    return this.#chart;
  }

  /** Re-read the model and redraw (called automatically on live signals). */
  public async refresh(): Promise<void> {
    const model = this.#resolveModel();
    const next = model.series.length > 0;
    if (next !== this.hasModel) {
      this.hasModel = next;
      await this.updateComplete;
    }
    const canvas = this.renderRoot.querySelector<HTMLElement>('[part="canvas"]');
    if (!next || !canvas) {
      this.#destroyChart();
      return;
    }
    const options = chartModelToApexOptions(model, this.#options());
    if (this.#chart) {
      await this.#chart.updateOptions(options, false, false);
    } else {
      this.#chart = await renderApexChart(canvas, model, this.#options());
    }
    this.dispatchEvent(
      new CustomEvent('apex-chart-created', {
        detail: { chart: this.#chart, type: this.type },
        bubbles: true,
        composed: true,
      })
    );
  }

  // --- internals -----------------------------------------------------------

  #attach(): void {
    this.#detach();
    const grid = this.grid as unknown as HTMLElement | null;
    if (!grid) return;
    grid.addEventListener(RANGE_CHANGED_EVENT, this.#onGridSignal);
    grid.addEventListener(VIEW_CHANGED_EVENT, this.#onGridSignal);
    this.#boundGrid = grid;
    this.#scheduleRefresh();
  }

  #detach(): void {
    this.#boundGrid?.removeEventListener(RANGE_CHANGED_EVENT, this.#onGridSignal);
    this.#boundGrid?.removeEventListener(VIEW_CHANGED_EVENT, this.#onGridSignal);
    this.#boundGrid = null;
  }

  #onGridSignal = (): void => this.#scheduleRefresh();

  /** Coalesce rapid signals (e.g. drag-select) to one redraw per frame. */
  #scheduleRefresh(): void {
    if (this.#rafHandle) return;
    this.#rafHandle = requestAnimationFrame(() => {
      this.#rafHandle = 0;
      void this.refresh();
    });
  }

  #resolveModel(): ChartModel {
    const grid = this.grid;
    if (!grid) return { categories: [], series: [] };
    if (this.crossFilter) {
      const { categoryKey, model } = grid.getCrossFilterModel();
      this.#crossFilterKey = categoryKey;
      return model;
    }
    if (this.source === 'selection') return grid.getRangeChartModel();
    if (this.source === 'view') return grid.getViewChartModel();
    return grid.getChartModel();
  }

  #options(): RenderChartOptions {
    const theme = this.#themeOptions();
    const user = this.apexOptions ?? {};
    // Cross-filter wires ApexCharts' point-selection event to the grid filter.
    const events = this.crossFilter
      ? {
          chart: {
            events: {
              dataPointSelection: (
                _event: unknown,
                _ctx: unknown,
                config: { dataPointIndex?: number }
              ) => this.selectCategory(config?.dataPointIndex ?? -1),
            },
          },
        }
      : {};
    return {
      type: this.type,
      height: this.height,
      // Deep-merge the `chart` key so theme + events + caller overrides all survive.
      apexOptions: {
        ...theme,
        ...events,
        ...user,
        chart: {
          ...(theme as { chart?: object }).chart,
          ...(events as { chart?: object }).chart,
          ...(user as { chart?: object }).chart,
        },
      },
    };
  }

  /**
   * Toggle the cross-filter on the category at `index` (the programmatic form of clicking a chart
   * segment): filters the grid to that category, or clears it if it was already active. Reads the
   * grid's full data so it is independent of the current filter.
   */
  public selectCategory(index: number): void {
    const grid = this.grid;
    if (!grid) return;
    const { categoryKey, model } = grid.getCrossFilterModel();
    const value = model.categories[index];
    if (categoryKey == null || value === undefined) return;
    this.#crossFilterKey = categoryKey;
    if (this.#activeCategory === value) {
      this.#clearCrossFilter();
    } else {
      this.#activeCategory = value;
      grid.filter({ key: categoryKey, condition: 'equals', searchTerm: value } as never);
    }
  }

  /** Drop any filter this panel applied via cross-filter. */
  #clearCrossFilter(): void {
    if (this.grid && this.#crossFilterKey != null && this.#activeCategory != null) {
      this.grid.clearFilter(this.#crossFilterKey as never);
    }
    this.#activeCategory = null;
  }

  /** Derive ApexCharts theme options from the grid's tokens (or a forced light/dark mode). */
  #themeOptions(): Partial<NonNullable<RenderChartOptions['apexOptions']>> {
    if (this.theme !== 'grid') return { theme: { mode: this.theme } };
    const grid = this.grid as unknown as HTMLElement | null;
    if (!grid) return {};
    const cs = getComputedStyle(grid);
    const read = (name: string) => cs.getPropertyValue(name).trim();
    const colors = PALETTE_TOKENS.map(read).filter(Boolean);
    const foreColor = read('--ag-text-body');
    return {
      ...(colors.length ? { colors } : {}),
      theme: { mode: isDark(read('--ag-surface')) ? 'dark' : 'light' },
      chart: { background: 'transparent', ...(foreColor ? { foreColor } : {}) },
    };
  }

  #destroyChart(): void {
    this.#chart?.destroy();
    this.#chart = null;
  }

  #selectType(type: ChartType | 'auto'): void {
    if (type === this.type) return;
    this.type = type;
    this.dispatchEvent(
      new CustomEvent('apex-chart-type-changed', {
        detail: { type },
        bubbles: true,
        composed: true,
      })
    );
  }

  // --- dialog drag ---------------------------------------------------------

  #onHeaderPointerDown = (event: PointerEvent): void => {
    if (this.mode !== 'dialog') return;
    const panel = this.renderRoot.querySelector<HTMLElement>('[part="panel"]');
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    this.#drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  #onHeaderPointerMove = (event: PointerEvent): void => {
    if (!this.#drag || event.pointerId !== this.#drag.pointerId) return;
    const panel = this.renderRoot.querySelector<HTMLElement>('[part="panel"]');
    if (!panel) return;
    panel.style.left = `${event.clientX - this.#drag.offsetX}px`;
    panel.style.top = `${event.clientY - this.#drag.offsetY}px`;
  };

  #onHeaderPointerUp = (event: PointerEvent): void => {
    if (this.#drag?.pointerId === event.pointerId) this.#drag = null;
  };

  // --- render --------------------------------------------------------------

  #renderStyle() {
    // Light-DOM component: scope every rule under the tag so it does not leak.
    return html`<style>
      apex-grid-chart {
        display: block;
        font: 0.8rem/1.4 system-ui, sans-serif;
        color: #1f2328;
      }
      apex-grid-chart[mode='dialog'] {
        position: fixed;
        inset: auto 24px 24px auto;
        z-index: 11000;
      }
      apex-grid-chart[mode='dialog']:not([open]) {
        display: none;
      }
      apex-grid-chart [part='panel'] {
        box-sizing: border-box;
        background: #fff;
        border: 1px solid #d8dade;
        border-radius: 8px;
      }
      apex-grid-chart[mode='dialog'] [part='panel'] {
        position: fixed;
        inset: auto 24px 24px auto;
        inline-size: 460px;
        max-inline-size: 92vw;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
        resize: both;
        overflow: auto;
      }
      apex-grid-chart [part='header'] {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 12px;
        border-block-end: 1px solid #eef0f4;
        cursor: move;
        font-weight: 600;
      }
      apex-grid-chart [part='close'] {
        cursor: pointer;
        border: none;
        background: none;
        font-size: 16px;
        line-height: 1;
        color: #6b7280;
      }
      apex-grid-chart [part='toolbar'] {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        border-block-end: 1px solid #eef0f4;
      }
      apex-grid-chart [part='type-button'] {
        font: inherit;
        font-size: 0.75rem;
        padding: 3px 9px;
        border: 1px solid #d0d5dd;
        background: #fff;
        border-radius: 4px;
        cursor: pointer;
      }
      apex-grid-chart [part='type-button'][aria-pressed='true'] {
        background: #1f2328;
        color: #fff;
        border-color: #1f2328;
      }
      apex-grid-chart .agc-theme {
        margin-inline-start: auto;
      }
      apex-grid-chart [part='placeholder'] {
        padding: 24px 12px;
        color: #888;
        font-style: italic;
      }
      apex-grid-chart [part='canvas'] {
        padding: 4px;
      }
    </style>`;
  }

  protected override render() {
    const empty = !this.hasModel;
    return html`${this.#renderStyle()}
      <div part="panel">
        ${
          this.mode === 'dialog'
            ? html`<div
                part="header"
                @pointerdown=${this.#onHeaderPointerDown}
                @pointermove=${this.#onHeaderPointerMove}
                @pointerup=${this.#onHeaderPointerUp}
              >
                <span>${this.heading}</span>
                <button part="close" type="button" aria-label="Close" @click=${() => this.close()}>
                  ✕
                </button>
              </div>`
            : nothing
        }
        <div part="toolbar" ?hidden=${empty}>
          ${TYPE_GALLERY.map(
            (entry) => html`<button
              part="type-button"
              type="button"
              aria-pressed=${this.type === entry.type ? 'true' : 'false'}
              @click=${() => this.#selectType(entry.type)}
            >
              ${entry.label}
            </button>`
          )}
          <label class="agc-theme">
            <select
              aria-label="Chart theme"
              .value=${this.theme}
              @change=${(event: Event) => {
                this.theme = (event.target as HTMLSelectElement).value as typeof this.theme;
              }}
            >
              <option value="grid">Grid theme</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
        <div part="placeholder" ?hidden=${!empty}>
          Select cells, or group/pivot the grid, to chart it.
        </div>
        <div part="canvas" ?hidden=${empty}></div>
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [CHART_TAG]: ApexGridChart;
  }
}
