import { type GridLocaleKey, localize } from 'apex-grid';
import { registerComponent } from 'apex-grid/internal';
import type ApexCharts from 'apexcharts';
import { html, LitElement, nothing, svg } from 'lit';
import { property, state } from 'lit/decorators.js';
import {
  buildValueAxes,
  type CalculatedField,
  type ChartAggregation,
  type ChartDefinition,
  type ChartField,
  type ChartFormat,
  type ChartModel,
  type ChartType,
  chartModelToApexOptions,
  formatToApexOptions,
  linearForecast,
  linearForecastBand,
  linearTrend,
  type RenderChartOptions,
  recommendChartType,
  renderApexChart,
} from './features/chart.js';
import { isValidChartFormula } from './features/chart-calc.js';
import { RANGE_CHANGED_EVENT } from './features/range-selection.js';
import { type ApexGridEnterprise, VIEW_CHANGED_EVENT } from './grid-enterprise.js';

export const CHART_TAG = 'apex-grid-chart';

/** Where the chart panel pulls its model from. */
export type ChartSource = 'auto' | 'selection' | 'view';

/**
 * A serializable snapshot of a chart's configuration, returned by {@link ApexGridChart.toJSON} and
 * consumed by {@link ApexGridChart.restore}. Plain JSON (no functions), so an app can persist it
 * anywhere (localStorage, a server, a saved view) and rebuild the chart later. Excludes
 * `apexOptions`, which is author code (may hold functions) and is reapplied by the app, not restored.
 */
export interface ChartConfig {
  readonly type?: ChartType | 'auto';
  readonly source?: ChartSource;
  readonly definition?: ChartDefinition;
  readonly format?: ChartFormat;
  readonly heading?: string;
  readonly crossFilter?: boolean;
  /** A frozen model, present for snapshot charts (see {@link ApexGridChart.staticModel}). */
  readonly staticModel?: ChartModel | null;
}

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

/** Fallback labels by type (used when a locale key is missing). */
const TYPE_LABELS = Object.fromEntries(TYPE_GALLERY.map((e) => [e.type, e.label])) as Record<
  ChartType | 'auto',
  string
>;

/**
 * The gallery grouped by family, so related types sit together (cartesian, then circular, then the
 * statistical/other set). `'auto'` is pulled out as a "Suggested" badge rather than a peer button.
 */
const TYPE_GROUPS: ReadonlyArray<ReadonlyArray<ChartType>> = [
  ['column', 'bar', 'line', 'area'],
  ['pie', 'donut'],
  ['scatter', 'radar', 'combo'],
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

/** The deepest focused element across shadow boundaries (so focus restore lands where it was). */
function deepActiveElement(): HTMLElement | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el instanceof HTMLElement ? el : null;
}

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

  /** Resolve a locale key against the bound grid's overrides (English when unbound). */
  #t = (key: GridLocaleKey, fallback?: string): string =>
    localize(this.grid?.localeText, key, undefined, fallback);

  /** `'inline'` renders in place; `'dialog'` (default) is a floating, draggable panel. */
  @property({ reflect: true })
  public mode: 'inline' | 'dialog' = 'dialog';

  /** Active chart type, or `'auto'` (the recommended-type heuristic). */
  @property()
  public type: ChartType | 'auto' = 'auto';

  /** Which model to chart: selection if present else view (`'auto'`), or force one. */
  @property()
  public source: ChartSource = 'auto';

  /**
   * How the grid data is mapped to the chart: category column, measure columns, and per-series
   * aggregation (see {@link ChartDefinition}). An empty definition (the default) keeps the automatic
   * mapping — first non-numeric column is the category, every numeric column a series, summed per
   * category. Applies to the selection and flat-view models (not grouping/pivot, which carry their
   * own aggregation).
   */
  @property({ attribute: false })
  public definition: ChartDefinition = {};

  /**
   * A frozen model to chart instead of reading the live grid. When set, the panel ignores
   * `source`/`definition`/cross-filter and always renders this snapshot — how several independent
   * charts coexist (each captures a different slice at creation). `null` (default) keeps the panel
   * live-bound to the grid.
   */
  @property({ attribute: false })
  public staticModel: ChartModel | null = null;

  /**
   * The handful of frequently-changed formatting options (colors, legend, data labels, gridlines,
   * number format) surfaced by the Format popover. Only fields you set are applied, layered over
   * `apexOptions`, so it never clobbers author options you didn't touch. See {@link ChartFormat}.
   */
  @property({ attribute: false })
  public format: ChartFormat = {};

  /**
   * Palette. Defaults to `'grid'`: the chart follows the grid's theme, deriving its colors and
   * light/dark mode from the grid's tokens. Set `'light'`/`'dark'` to force a mode (programmatic
   * escape hatch — there is no built-in theme picker).
   */
  @property()
  public theme: 'grid' | 'light' | 'dark' = 'grid';

  /** Dialog open state (no-op for `mode="inline"`). */
  @property({ type: Boolean, reflect: true })
  public open = false;

  /** Panel heading (dialog mode). */
  @property()
  public heading = 'Chart';

  /** Chart height in px. Applies to `mode="inline"`; a dialog chart fills its (resizable) panel. */
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

  /** Whether the Export dropdown in the toolbar is open. */
  @state()
  private exportOpen = false;

  /** Whether the Format popover in the toolbar is open. */
  @state()
  private formatOpen = false;

  /** Whether the Data (mapping) popover in the toolbar is open. */
  @state()
  private dataOpen = false;

  /** Whether the dialog heading is in inline-rename mode. */
  @state()
  private headingEditing = false;

  /** Draft name/formula for the Data popover's "add calculated field" form. */
  @state()
  private calcName = '';

  @state()
  private calcFormula = '';

  /** Chartable columns from the grid (key/label/numeric), for the Data popover + secondary-axis map. */
  @state()
  private dataFields: ChartField[] = [];

  /** Series names from the last rendered model, so the Format popover can offer a swatch per series. */
  @state()
  private seriesNames: string[] = [];

  #chart: ApexCharts | null = null;
  /** Concrete chart type last rendered (after resolving `'auto'`), so a type switch rebuilds. */
  #renderedType: ChartType | null = null;
  /** Re-entrancy guard for {@link refresh} + a trailing-rerun flag (see the method). */
  #refreshing = false;
  #refreshPending = false;
  /** Set when {@link format} changes: the next render tears down and rebuilds (see {@link updated}). */
  #formatDirty = false;
  /** Refits the chart when its container resizes (dialog resize handle / flex layout changes). */
  #resizeObserver: ResizeObserver | null = null;
  #lastWidth = 0;
  #lastHeight = 0;
  #boundGrid: HTMLElement | null = null;
  /** Cross-filter: the column key being filtered, and the active category value (or null). */
  #crossFilterKey: string | null = null;
  #activeCategory: string | null = null;
  #rafHandle = 0;
  #drag: { pointerId: number; offsetX: number; offsetY: number } | null = null;
  /** What had focus before {@link show}, so a dialog close can put focus back. */
  #restoreFocus: HTMLElement | null = null;

  public override disconnectedCallback(): void {
    this.#detach();
    this.#clearCrossFilter();
    this.#destroyChart();
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
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
    // A format OR mapping change forces a full rebuild rather than an in-place updateOptions:
    // ApexCharts does not repaint value-axis label formatters or a changed yaxis (e.g. adding a
    // secondary axis) on a second updateOptions, so it would keep the previous config. These edits
    // are rare and interactive, so the rebuild is imperceptible; live data / sort / filter (which
    // arrive via the grid signal, not a property change) keep the smooth updateOptions path.
    if (changed.has('format') || changed.has('definition')) this.#formatDirty = true;
    // Type / source / theme / cross-filter changes (and a fresh grid) all force a redraw.
    if (
      changed.has('type') ||
      changed.has('source') ||
      changed.has('theme') ||
      changed.has('grid') ||
      changed.has('crossFilter') ||
      changed.has('definition') ||
      changed.has('staticModel') ||
      changed.has('format')
    ) {
      this.#scheduleRefresh();
    }
  }

  // --- public API ----------------------------------------------------------

  /** Open the dialog panel (and move focus into it so Escape / tabbing work). */
  public show(): void {
    this.open = true;
    // Remember where focus came from so close() can put it back (dialog a11y).
    this.#restoreFocus = deepActiveElement();
    this.#scheduleRefresh();
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLElement>('[part="close"]')?.focus();
    });
  }

  /** Close the dialog panel and notify (e.g. so a launcher can remove it). */
  public close(): void {
    this.open = false;
    this.dispatchEvent(new CustomEvent('apex-chart-closed', { bubbles: true, composed: true }));
    const previous = this.#restoreFocus;
    this.#restoreFocus = null;
    if (this.mode === 'dialog' && previous?.isConnected && typeof previous.focus === 'function') {
      previous.focus();
    }
  }

  /** Escape dismisses an open dialog panel; Tab cycles focus within it. */
  #onKeydown = (event: KeyboardEvent): void => {
    if (this.mode !== 'dialog' || !this.open) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.close();
    } else if (event.key === 'Tab') {
      this.#trapFocus(event);
    }
  };

  /** Keep Tab / Shift+Tab cycling inside the dialog (wrap last to first, first to last). */
  #trapFocus(event: KeyboardEvent): void {
    const focusables = [
      ...this.renderRoot.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ),
    ].filter(
      (el) =>
        !el.hasAttribute('disabled') && (el.offsetParent !== null || el.getClientRects().length > 0)
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = deepActiveElement();
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /** The live ApexCharts instance, or `null`. */
  public getChart(): ApexCharts | null {
    return this.#chart;
  }

  /**
   * A serializable {@link ChartConfig} capturing this chart's configuration (type, source, mapping,
   * format, heading, cross-filter, and any frozen snapshot). Named `toJSON` so `JSON.stringify(panel)`
   * just works. `apexOptions` is deliberately excluded — it is author code and may hold functions.
   */
  public toJSON(): ChartConfig {
    return {
      type: this.type,
      source: this.source,
      definition: this.definition,
      format: this.format,
      heading: this.heading,
      crossFilter: this.crossFilter,
      staticModel: this.staticModel,
    };
  }

  /**
   * Apply a {@link ChartConfig} (from a previous {@link toJSON}) to this chart, then redraw. Only the
   * fields present in `config` are set, so a partial config patches the current state. Bind `grid`
   * separately (a config is data, not a grid reference).
   */
  public restore(config: ChartConfig): void {
    if (config.type !== undefined) this.type = config.type;
    if (config.source !== undefined) this.source = config.source;
    if (config.definition !== undefined) this.definition = config.definition;
    if (config.format !== undefined) this.format = config.format;
    if (config.heading !== undefined) this.heading = config.heading;
    if (config.crossFilter !== undefined) this.crossFilter = config.crossFilter;
    if (config.staticModel !== undefined) this.staticModel = config.staticModel;
  }

  /**
   * Download the current chart as a raster **PNG** (`'png'`, default) or a scalable **SVG**
   * (`'svg'`). Resolves `false` when there is no chart yet or the browser can't produce the file.
   * PNG goes through ApexCharts' own `dataURI()` (so it captures exactly what's drawn); SVG
   * serializes the rendered `<svg>` directly.
   */
  public async exportImage(format: 'png' | 'svg' = 'png'): Promise<boolean> {
    if (format === 'svg') {
      const svg = this.renderRoot.querySelector<SVGElement>('[part="canvas"] svg');
      if (!svg) return false;
      const source = new XMLSerializer().serializeToString(svg);
      const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
      this.#triggerDownload(url, 'chart.svg');
      URL.revokeObjectURL(url);
      return true;
    }
    const chart = this.#chart;
    if (!chart) return false;
    const result = await chart.dataURI();
    const objectUrl = 'blob' in result ? URL.createObjectURL(result.blob) : null;
    const href = objectUrl ?? (result as { imgURI: string }).imgURI;
    this.#triggerDownload(href, 'chart.png');
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    return true;
  }

  /**
   * Copy the current chart to the clipboard as a PNG image. Resolves `false` when there is no chart,
   * the Clipboard `write` API / `ClipboardItem` is unavailable, or the write is blocked.
   */
  public async copyImage(): Promise<boolean> {
    const chart = this.#chart;
    if (!chart || typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false;
    try {
      const result = await chart.dataURI();
      const blob =
        'blob' in result
          ? result.blob
          : await (await fetch((result as { imgURI: string }).imgURI)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      this.grid?.announce(this.#t('chart.imageCopied'));
      return true;
    } catch {
      return false;
    }
  }

  /** Fire an anchor download for a data/object URL, then clean up the anchor. */
  #triggerDownload(href: string, filename: string): void {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  /** Run an export action from the toolbar menu, then close the menu. */
  #runExport(action: () => Promise<boolean>): void {
    this.exportOpen = false;
    void action();
  }

  #toggleExportMenu = (): void => {
    this.exportOpen = !this.exportOpen;
  };

  /** Close the export menu when focus leaves it (blur to outside the panel). */
  #onExportBlur = (event: FocusEvent): void => {
    const next = event.relatedTarget as Node | null;
    const menu = this.renderRoot.querySelector<HTMLElement>('[part="export"]');
    if (!menu || !next || !menu.contains(next)) this.exportOpen = false;
  };

  #toggleFormatMenu = (): void => {
    this.formatOpen = !this.formatOpen;
  };

  #toggleDataMenu = (): void => {
    this.dataOpen = !this.dataOpen;
    if (this.dataOpen) this.#refreshFields();
  };

  /** Merge a patch into {@link format} (reassigns so Lit sees the change and redraws). */
  #patchFormat(patch: Partial<ChartFormat>): void {
    this.format = { ...this.format, ...patch };
  }

  /** Merge a patch into {@link definition} (reassigns so Lit sees the change and redraws). */
  #patchDefinition(patch: Partial<ChartDefinition>): void {
    this.definition = { ...this.definition, ...patch };
  }

  /** The effective category key: an explicit choice, else the first non-numeric column. */
  #categoryKey(): string {
    if (this.definition.category != null) return this.definition.category;
    return this.dataFields.find((field) => !field.numeric)?.key ?? '';
  }

  /** The effective measure keys: an explicit list, else every numeric column bar the category. */
  #measureKeys(): string[] {
    const explicit = this.definition.measures;
    if (explicit && explicit.length > 0) return [...explicit];
    const category = this.#categoryKey();
    return this.dataFields.filter((f) => f.numeric && f.key !== category).map((f) => f.key);
  }

  /**
   * Secondary-axis entries mapped to their series names, for {@link buildValueAxes}. An entry is a
   * measure column key (→ its label) or, for a calculated field, its name (→ itself, since a calc
   * field's series name IS its name).
   */
  #secondaryNames(): string[] {
    const ids = this.definition.secondaryMeasures;
    if (!ids || ids.length === 0) return [];
    const labelOf = new Map(this.dataFields.map((f) => [f.key, f.label]));
    return ids.map((id) => labelOf.get(id) ?? id);
  }

  #setCategory(key: string): void {
    this.#patchDefinition({ category: key || undefined });
  }

  #setAggregation(fn: ChartAggregation): void {
    this.#patchDefinition({ aggregation: fn });
  }

  /** Toggle a measure (Y series) on/off, keeping column order and dropping it from the 2nd axis. */
  #toggleMeasure(key: string): void {
    const active = new Set(this.#measureKeys());
    if (active.has(key)) active.delete(key);
    else active.add(key);
    const measures = this.dataFields.filter((f) => active.has(f.key)).map((f) => f.key);
    const secondary = (this.definition.secondaryMeasures ?? []).filter((k) => active.has(k));
    this.#patchDefinition({
      measures,
      secondaryMeasures: secondary.length ? secondary : undefined,
    });
  }

  /**
   * Toggle whether a series is drawn against the secondary (opposite) value axis. `id` is a measure
   * column key or a calculated field's name (both are valid series identifiers).
   */
  #toggleSecondary(id: string): void {
    const set = new Set(this.definition.secondaryMeasures ?? []);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.#patchDefinition({ secondaryMeasures: set.size ? [...set] : undefined });
  }

  /** The numeric columns available to a calculated-field formula, each with its A1 letter (A, B, …). */
  #calcColumns(): { letter: string; label: string }[] {
    const category = this.#categoryKey();
    return this.dataFields
      .filter((f) => f.numeric && f.key !== category)
      .map((f, i) => ({ letter: `${String.fromCharCode(65 + i)}1`, label: f.label }));
  }

  /** Add the draft calculated field (name + formula) to the definition, then clear the form. */
  #addCalculatedField(): void {
    const name = this.calcName.trim();
    if (name === '' || !isValidChartFormula(this.calcFormula)) return;
    const next: CalculatedField[] = [
      ...(this.definition.calculatedFields ?? []),
      { name, formula: this.calcFormula.trim() },
    ];
    this.#patchDefinition({ calculatedFields: next });
    this.calcName = '';
    this.calcFormula = '';
  }

  #removeCalculatedField(index: number): void {
    const next = (this.definition.calculatedFields ?? []).filter((_, i) => i !== index);
    this.#patchDefinition({ calculatedFields: next.length ? next : undefined });
  }

  /** Insert an A1 letter (from a legend chip) at the end of the draft formula. */
  #insertCalcRef(letter: string): void {
    this.calcFormula = `${this.calcFormula}${letter}`;
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLInputElement>('[part="calc-formula"]')?.focus();
    });
  }

  /**
   * Update one edge of the reference band. The partial edge is kept (so a user can fill `from` then
   * `to`); `formatToApexOptions` only draws the band once both edges are finite. Clears the band
   * entirely once both edges are blank so an emptied band draws nothing.
   */
  #patchBand(edge: 'from' | 'to', raw: string): void {
    const current = this.format.referenceBand ?? { from: Number.NaN, to: Number.NaN };
    const next = { ...current, [edge]: raw === '' ? Number.NaN : Number(raw) };
    const bothBlank = !Number.isFinite(next.from) && !Number.isFinite(next.to);
    this.#patchFormat({ referenceBand: bothBlank ? undefined : next });
  }

  /** Update one axis title, dropping the whole `axisTitles` object when both sides are blank. */
  #patchAxisTitle(axis: 'x' | 'y', value: string): void {
    const next = { ...this.format.axisTitles, [axis]: value || undefined };
    const empty = !next.x && !next.y;
    this.#patchFormat({ axisTitles: empty ? undefined : next });
  }

  /** Update one series color (by index) within {@link format.colors}. */
  #setSeriesColor(index: number, color: string): void {
    const colors = [...(this.format.colors ?? this.seriesNames.map(() => ''))];
    colors[index] = color;
    this.#patchFormat({ colors });
  }

  /**
   * Re-read the model and redraw (called automatically on live signals).
   *
   * Serialized: creating/updating an ApexCharts instance is async, so without a guard two
   * overlapping refreshes (rapid drag-select plus a view signal) could both observe `#chart === null`
   * and render twice into the same canvas — the flicker / "sometimes it doesn't render" failure mode.
   * One render runs at a time; any calls that arrive mid-render collapse into a single trailing rerun
   * that picks up the latest model.
   */
  public async refresh(): Promise<void> {
    if (this.#refreshing) {
      this.#refreshPending = true;
      return;
    }
    this.#refreshing = true;
    try {
      do {
        this.#refreshPending = false;
        await this.#renderOnce();
      } while (this.#refreshPending);
    } finally {
      this.#refreshing = false;
    }
  }

  /** One pass of model resolution + ApexCharts render. Never call directly — go through {@link refresh}. */
  async #renderOnce(): Promise<void> {
    const model = this.#resolveModel();
    const next = model.series.length > 0;
    // Remember series names so the Format popover can offer a color swatch per series.
    const names = model.series.map((series) => series.name);
    if (
      names.length !== this.seriesNames.length ||
      names.some((n, i) => n !== this.seriesNames[i])
    ) {
      this.seriesNames = names;
    }
    if (next !== this.hasModel) {
      this.hasModel = next;
      await this.updateComplete;
    }
    const canvas = this.renderRoot.querySelector<HTMLElement>('[part="canvas"]');
    if (!next || !canvas) {
      this.#destroyChart();
      return;
    }
    // Trend/forecast overlays augment the series set + force combo rendering, so fold them in first.
    const { model: renderModel, options } = this.#withOverlays(model, this.#options());
    // Resolve the concrete type so switching type (including `'auto'` and any cartesian↔circular
    // move) tears down and rebuilds rather than mutating in place — ApexCharts' updateOptions is
    // unreliable across those transitions, another source of the "sometimes blank" chart.
    const resolvedType =
      options.type === 'auto' || options.type == null
        ? recommendChartType(renderModel)
        : options.type;
    // A type switch OR a format edit rebuilds from scratch (see updated() for why format does).
    if (this.#chart && (resolvedType !== this.#renderedType || this.#formatDirty))
      this.#destroyChart();
    this.#formatDirty = false;
    if (this.#chart) {
      await this.#chart.updateOptions(chartModelToApexOptions(renderModel, options), false, false);
    } else {
      this.#chart = await renderApexChart(canvas, renderModel, options);
    }
    this.#renderedType = resolvedType;
    this.#ensureResizeObserver();
    this.dispatchEvent(
      new CustomEvent('apex-chart-created', {
        detail: { chart: this.#chart, type: this.type },
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Observe the panel so the chart refits when its container changes size — the dialog's resize
   * handle, or a flex/grid layout shift. (ApexCharts already handles window resizes itself.) The
   * chart fills the panel, so re-rendering doesn't change the panel's size and can't feed back into
   * another resize; a >1px threshold guards against sub-pixel churn either way.
   */
  #ensureResizeObserver(): void {
    if (this.#resizeObserver || typeof ResizeObserver === 'undefined') return;
    const panel = this.renderRoot.querySelector<HTMLElement>('[part="panel"]');
    if (!panel) return;
    this.#lastWidth = panel.clientWidth;
    this.#lastHeight = panel.clientHeight;
    this.#resizeObserver = new ResizeObserver((entries) => {
      const { width = 0, height = 0 } = entries[0]?.contentRect ?? {};
      if (Math.abs(width - this.#lastWidth) < 1 && Math.abs(height - this.#lastHeight) < 1) return;
      this.#lastWidth = width;
      this.#lastHeight = height;
      if (this.#chart) this.#scheduleRefresh();
    });
    this.#resizeObserver.observe(panel);
  }

  // --- internals -----------------------------------------------------------

  #attach(): void {
    this.#detach();
    const grid = this.grid as unknown as HTMLElement | null;
    if (!grid) return;
    grid.addEventListener(RANGE_CHANGED_EVENT, this.#onGridSignal);
    grid.addEventListener(VIEW_CHANGED_EVENT, this.#onGridSignal);
    this.#boundGrid = grid;
    this.#refreshFields();
    this.#scheduleRefresh();
  }

  #detach(): void {
    this.#boundGrid?.removeEventListener(RANGE_CHANGED_EVENT, this.#onGridSignal);
    this.#boundGrid?.removeEventListener(VIEW_CHANGED_EVENT, this.#onGridSignal);
    this.#boundGrid = null;
  }

  #onGridSignal = (): void => {
    this.#refreshFields();
    this.#scheduleRefresh();
  };

  /** Re-read the grid's chartable columns (drives the Data popover + the secondary-axis mapping). */
  #refreshFields(): void {
    const next = this.grid?.getChartFields() ?? [];
    const changed =
      next.length !== this.dataFields.length ||
      next.some(
        (f, i) => f.key !== this.dataFields[i]?.key || f.numeric !== this.dataFields[i]?.numeric
      );
    if (changed) this.dataFields = next;
  }

  /** Coalesce rapid signals (e.g. drag-select) to one redraw per frame. */
  #scheduleRefresh(): void {
    if (this.#rafHandle) return;
    this.#rafHandle = requestAnimationFrame(() => {
      this.#rafHandle = 0;
      void this.refresh();
    });
  }

  #resolveModel(): ChartModel {
    // A frozen snapshot wins over any live source (independent multi-chart).
    if (this.staticModel) return this.staticModel;
    const grid = this.grid;
    if (!grid) return { categories: [], series: [] };
    if (this.crossFilter) {
      const { categoryKey, model } = grid.getCrossFilterModel();
      this.#crossFilterKey = categoryKey;
      return model;
    }
    if (this.source === 'selection') return grid.getRangeChartModel(this.definition);
    if (this.source === 'view') return grid.getViewChartModel(this.definition);
    return grid.getChartModel(this.definition);
  }

  /** Chart types the trend/forecast overlays make sense for (a straight line over the series). */
  static #TRENDABLE: ReadonlySet<ChartType | 'auto'> = new Set(['column', 'bar', 'line', 'area']);

  /**
   * Fold the analytical overlays into the render. A **trend line** (`format.trendline`) appends a
   * least-squares series over the first series' history; a **forecast** (`format.forecast > 0`)
   * extends the category axis with future periods and adds a projected continuation. Either overlay
   * switches to a combo render so the base series keep their type while overlays draw as lines. A
   * no-op for empty models or types the overlays don't suit (pie/donut/scatter/radar/combo).
   */
  #withOverlays(
    model: ChartModel,
    options: RenderChartOptions
  ): { model: ChartModel; options: RenderChartOptions } {
    const base =
      options.type === 'auto' || options.type == null ? recommendChartType(model) : options.type;
    const periods = this.format.forecast ?? 0;
    const wants = this.format.trendline || periods > 0;
    if (!wants || model.series.length === 0 || !ApexGridChart.#TRENDABLE.has(base)) {
      return { model, options };
    }
    const primary = model.series[0].data;
    const n = primary.length;
    // With a forecast the category axis grows; every series is padded to the full length with
    // trailing nulls so ApexCharts keeps the string categories (a length mismatch makes it fall
    // back to 1, 2, 3 …). Without a forecast, total === n and nothing is padded.
    const total = n + periods;
    const pad = (data: readonly (number | null)[]): (number | null)[] =>
      data.length >= total ? [...data] : [...data, ...new Array(total - data.length).fill(null)];

    const categories =
      periods > 0
        ? [...model.categories, ...Array.from({ length: periods }, (_, k) => `+${k + 1}`)]
        : model.categories;

    type OverlaySeries = { name: string; data: (number | null)[]; color?: string };
    const series: OverlaySeries[] = model.series.map((s) => ({ name: s.name, data: pad(s.data) }));
    const comboTypes: ChartType[] = model.series.map(() => base as ChartType);
    // Base series draw solid (dash 0); each analytical overlay draws dashed in a distinct color so a
    // projection is never mistaken for real data. Aligned to the final series order.
    const dashArray: number[] = model.series.map(() => 0);
    const pushOverlay = (
      name: string,
      data: (number | null)[],
      color: string,
      dash: number
    ): void => {
      series.push({ name, data, color });
      comboTypes.push('line');
      dashArray.push(dash);
    };

    const FORECAST_COLOR = '#f59e0b'; // amber — clearly not a data-series blue
    if (this.format.trendline) pushOverlay('Trend', pad(linearTrend(primary)), '#64748b', 6);
    if (periods > 0) {
      // Null across history, seeded at the last actual point so the line connects, then the future.
      const project = (future: number[]): (number | null)[] => {
        const data: (number | null)[] = new Array(total).fill(null);
        if (n > 0) data[n - 1] = primary[n - 1];
        for (let k = 0; k < periods; k += 1) data[n + k] = future[k];
        return data;
      };
      pushOverlay('Forecast', project(linearForecast(primary, periods)), FORECAST_COLOR, 5);
      if (this.format.forecastBand) {
        const { upper, lower } = linearForecastBand(primary, periods);
        pushOverlay('Upper', project(upper), FORECAST_COLOR, 2);
        pushOverlay('Lower', project(lower), FORECAST_COLOR, 2);
      }
    }

    const augmented = { categories, series } as unknown as ChartModel; // series may carry nulls (gaps)
    const apexOptions: RenderChartOptions['apexOptions'] = {
      ...options.apexOptions,
      // Dash the overlay lines (0 = solid for the base series); chartModelToApexOptions supplies the
      // matching per-series stroke WIDTH from the combo types, so the two compose into one `stroke`.
      stroke: { dashArray, ...options.apexOptions?.stroke },
      // Null-padded combo series make ApexCharts fall back to numeric x-labels; pin the axis to
      // 'category' when forecasting so the (string) category names — history plus the future
      // markers — are kept.
      ...(periods > 0
        ? { xaxis: { type: 'category' as const, ...options.apexOptions?.xaxis } }
        : {}),
    };
    return { model: augmented, options: { ...options, type: 'combo', comboTypes, apexOptions } };
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
    // Format popover overlay, layered last so the user's interactive choices win over author
    // `apexOptions` — but only for the keys they actually set (see formatToApexOptions).
    const overlay = formatToApexOptions(this.format, this.type) as Record<string, unknown>;
    const userRec = user as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...theme, ...events, ...user, ...overlay };
    merged.chart = {
      // ApexCharts' own floating toolbar is off by default: the panel provides a single,
      // consistent Export control in its toolbar row. A caller can turn it back on via
      // `apexOptions.chart.toolbar`.
      toolbar: { show: false },
      ...(theme as { chart?: object }).chart,
      ...(events as { chart?: object }).chart,
      ...(userRec.chart as object),
    };
    // Shallow-merge the nested keys the overlay touches so a caller's other sub-keys survive
    // (these are all plain objects — never the multi-axis `yaxis` array the overlay stays off).
    for (const key of ['legend', 'grid', 'dataLabels', 'tooltip', 'xaxis']) {
      if (userRec[key] || overlay[key]) {
        merged[key] = { ...(userRec[key] as object), ...(overlay[key] as object) };
      }
    }
    // yaxis title: apply the overlay's title to the primary axis WITHOUT collapsing a caller's
    // multi-axis array into a numeric-keyed object.
    if (overlay.yaxis) {
      if (Array.isArray(userRec.yaxis)) {
        const axes = [...(userRec.yaxis as object[])];
        axes[0] = { ...(axes[0] as object), ...(overlay.yaxis as object) };
        merged.yaxis = axes;
      } else {
        merged.yaxis = { ...(userRec.yaxis as object), ...(overlay.yaxis as object) };
      }
    } else if (userRec.yaxis) {
      merged.yaxis = userRec.yaxis;
    }
    // Secondary axis: when the mapping puts some measures on the opposite axis, replace yaxis with
    // the dual-axis array (built from the current series names). Wins over the single-object yaxis
    // above; the number format + primary title ride along so both axes stay consistent.
    const secondaryNames = this.#secondaryNames();
    if (secondaryNames.length > 0 && this.seriesNames.length > 0) {
      merged.yaxis = buildValueAxes(this.seriesNames, secondaryNames, {
        numberFormat: this.format.numberFormat,
        primaryTitle: this.format.axisTitles?.y,
      });
    }
    // Data labels default OFF and the popover toggle is authoritative: ApexCharts turns labels ON
    // for bars by default, which otherwise leaves the (unchecked) checkbox out of sync with a chart
    // that is already showing labels. Force the flag to match the toggle either way.
    merged.dataLabels = {
      ...(merged.dataLabels as object | undefined),
      enabled: this.format.dataLabels ?? false,
    };
    return {
      type: this.type,
      height: this.#resolveHeight(),
      apexOptions: merged,
    };
  }

  /**
   * Height to hand ApexCharts. Inline uses the fixed `height` prop. A dialog chart fills its
   * (resizable) panel, so we measure the canvas box and pass that pixel height rather than
   * ApexCharts' `'100%'`, which reads the wrong ancestor here and overshoots (chart clipped). Falls
   * back to `height` before the panel has laid out (canvas not yet measurable).
   */
  #resolveHeight(): number {
    if (this.mode !== 'dialog') return this.height;
    const canvas = this.renderRoot.querySelector<HTMLElement>('[part="canvas"]');
    const measured = canvas?.clientHeight ?? 0;
    return measured > 0 ? measured : this.height;
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
      // A self-contained equality operation (not an operand-name string) so it works regardless of
      // the category column's declared type.
      grid.filter({
        key: categoryKey,
        searchTerm: value,
        condition: {
          name: 'crossFilterEquals',
          unary: false,
          logic: (target: unknown) => String(target ?? '') === value,
        },
      } as never);
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
    this.#renderedType = null;
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
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
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
        /* Each new dialog cascades down-left by its index (--chart-cascade) so stacked charts
           don't land exactly on top of one another. */
        inset: auto calc(24px + var(--chart-cascade, 0) * 28px)
          calc(24px + var(--chart-cascade, 0) * 28px) auto;
        display: flex;
        flex-direction: column;
        inline-size: 460px;
        max-inline-size: 92vw;
        max-block-size: 92vh;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
        resize: both;
        /* Clip, don't scroll: ApexCharts can render a hair larger than its box
           (esp. pie/donut), which under overflow:auto produced spurious H+V
           scrollbars. The resize handle still works with overflow:hidden. */
        overflow: hidden;
      }
      /* Give the panel a definite height only while a chart is showing, so the
         canvas can fill it — the chart tracks the panel on resize instead of
         leaving empty space below a fixed-height chart. The empty/placeholder
         state keeps auto height and shrinks to its text. */
      apex-grid-chart[mode='dialog']
        [part='panel']:has([part='canvas']:not([hidden])) {
        block-size: 440px;
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
      apex-grid-chart [part='heading'] {
        border-radius: 4px;
        padding: 1px 4px;
        margin-inline-start: -4px;
        cursor: text;
      }
      apex-grid-chart [part='heading']:hover {
        background: #f1f3f9;
      }
      apex-grid-chart [part='heading-input'] {
        font: inherit;
        font-weight: 600;
        flex: 1 1 auto;
        min-inline-size: 0;
        padding: 1px 4px;
        border: 1px solid #9aa4b2;
        border-radius: 4px;
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
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font: inherit;
        font-size: 0.75rem;
        padding: 3px 8px;
        border: 1px solid #d0d5dd;
        background: #fff;
        border-radius: 4px;
        cursor: pointer;
        color: #1f2328;
      }
      apex-grid-chart [part='type-button'] svg {
        color: #5b6472;
      }
      apex-grid-chart [part='type-button'][aria-pressed='true'] {
        background: #1f2328;
        color: #fff;
        border-color: #1f2328;
      }
      apex-grid-chart [part='type-button'][aria-pressed='true'] svg {
        color: #fff;
      }
      apex-grid-chart [part='type-divider'] {
        inline-size: 1px;
        align-self: stretch;
        min-block-size: 18px;
        background: #e3e6eb;
        margin-inline: 2px;
      }
      apex-grid-chart [part='suggest-button'] {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font: inherit;
        font-size: 0.75rem;
        padding: 3px 8px;
        border: 1px dashed #c0c6d0;
        background: #fff;
        border-radius: 4px;
        cursor: pointer;
        color: #5b6472;
      }
      apex-grid-chart [part='suggest-button'][aria-pressed='true'] {
        border-style: solid;
        border-color: #1f2328;
        color: #1f2328;
      }
      apex-grid-chart [part='export'] {
        position: relative;
        margin-inline-start: auto;
      }
      apex-grid-chart [part='export-button'] {
        font: inherit;
        font-size: 0.75rem;
        padding: 3px 9px;
        border: 1px solid #d0d5dd;
        background: #fff;
        border-radius: 4px;
        cursor: pointer;
      }
      apex-grid-chart [part='export-button']:hover {
        background: #f7f9fc;
      }
      apex-grid-chart [part='export-menu'] {
        position: absolute;
        inset-inline-end: 0;
        inset-block-start: calc(100% + 4px);
        z-index: 5;
        display: flex;
        flex-direction: column;
        min-inline-size: 150px;
        background: #fff;
        border: 1px solid #d8dade;
        border-radius: 6px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
        padding: 4px;
      }
      apex-grid-chart [part='export-menu'][hidden] {
        display: none;
      }
      apex-grid-chart [part='export-item'] {
        font: inherit;
        font-size: 0.8rem;
        text-align: start;
        padding: 6px 10px;
        border: none;
        background: none;
        border-radius: 4px;
        cursor: pointer;
        color: #1f2328;
      }
      apex-grid-chart [part='export-item']:hover {
        background: #f1f3f9;
      }
      apex-grid-chart [part='format'] {
        position: relative;
      }
      apex-grid-chart [part='format-button'] {
        font: inherit;
        font-size: 0.75rem;
        padding: 3px 9px;
        border: 1px solid #d0d5dd;
        background: #fff;
        border-radius: 4px;
        cursor: pointer;
      }
      apex-grid-chart [part='format-button']:hover {
        background: #f7f9fc;
      }
      apex-grid-chart [part='format-menu'] {
        position: absolute;
        inset-inline-end: 0;
        inset-block-start: calc(100% + 4px);
        z-index: 6;
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-inline-size: 200px;
        background: #fff;
        border: 1px solid #d8dade;
        border-radius: 6px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
        padding: 10px 12px;
      }
      apex-grid-chart [part='format-menu'][hidden] {
        display: none;
      }
      apex-grid-chart [part='format-heading'] {
        display: block;
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #6b7280;
        margin-block-end: 4px;
      }
      apex-grid-chart [part='format-group'] {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding-block-end: 8px;
        border-block-end: 1px solid #eef0f4;
      }
      apex-grid-chart [part='format-swatch'] {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.8rem;
      }
      apex-grid-chart [part='format-swatch'] input[type='color'] {
        inline-size: 26px;
        block-size: 20px;
        padding: 0;
        border: 1px solid #d0d5dd;
        border-radius: 4px;
        cursor: pointer;
      }
      apex-grid-chart [part='format-row'] {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.82rem;
        justify-content: space-between;
      }
      apex-grid-chart [part='format-row'] input[type='checkbox'] {
        margin: 0;
      }
      apex-grid-chart [part='format-row'] select,
      apex-grid-chart [part='format-number'],
      apex-grid-chart [part='format-text'] {
        font: inherit;
        font-size: 0.8rem;
        padding: 2px 6px;
        border: 1px solid #d0d5dd;
        border-radius: 4px;
        background: #fff;
      }
      apex-grid-chart [part='format-number'] {
        inline-size: 90px;
      }
      apex-grid-chart [part='format-text'] {
        inline-size: 120px;
      }
      apex-grid-chart [part='format-band'] {
        display: flex;
        gap: 6px;
      }
      apex-grid-chart [part='format-band'] [part='format-number'] {
        inline-size: 60px;
      }
      apex-grid-chart [part='data'] {
        position: relative;
      }
      apex-grid-chart [part='data-button'] {
        font: inherit;
        font-size: 0.75rem;
        padding: 3px 9px;
        border: 1px solid #d0d5dd;
        background: #fff;
        border-radius: 4px;
        cursor: pointer;
      }
      apex-grid-chart [part='data-button']:hover {
        background: #f7f9fc;
      }
      apex-grid-chart [part='data-menu'] {
        position: absolute;
        inset-inline-start: 0;
        inset-block-start: calc(100% + 4px);
        z-index: 6;
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-inline-size: 220px;
        background: #fff;
        border: 1px solid #d8dade;
        border-radius: 6px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
        padding: 10px 12px;
      }
      apex-grid-chart [part='data-menu'][hidden] {
        display: none;
      }
      apex-grid-chart [part='data-group'] {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding-block: 4px 8px;
        border-block: 1px solid #eef0f4;
      }
      apex-grid-chart [part='data-measure'] {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        font-size: 0.82rem;
      }
      apex-grid-chart [part='data-measure-name'] {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      apex-grid-chart [part='data-axis'] {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 0.7rem;
        color: #6b7280;
      }
      apex-grid-chart [part='data-axis'][hidden] {
        display: none;
      }
      apex-grid-chart [part='data-menu'] select {
        font: inherit;
        font-size: 0.8rem;
        padding: 2px 6px;
        border: 1px solid #d0d5dd;
        border-radius: 4px;
        background: #fff;
      }
      apex-grid-chart [part='calc-group'] {
        display: flex;
        flex-direction: column;
        gap: 5px;
        padding-block-start: 8px;
        border-block-start: 1px solid #eef0f4;
      }
      apex-grid-chart [part='calc-item'] {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.8rem;
      }
      apex-grid-chart [part='calc-item-name'] {
        font-weight: 600;
      }
      apex-grid-chart [part='calc-item-formula'] {
        flex: 1 1 auto;
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 0.72rem;
        color: #6b7280;
        background: #f1f3f9;
        padding: 0 4px;
        border-radius: 3px;
      }
      apex-grid-chart [part='calc-remove'] {
        border: none;
        background: none;
        cursor: pointer;
        color: #9aa4b2;
        font-size: 0.8rem;
        line-height: 1;
        padding: 2px;
      }
      apex-grid-chart [part='calc-name'],
      apex-grid-chart [part='calc-formula'] {
        font: inherit;
        font-size: 0.8rem;
        padding: 3px 6px;
        border: 1px solid #d0d5dd;
        border-radius: 4px;
        background: #fff;
      }
      apex-grid-chart [part='calc-formula'] {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.75rem;
      }
      apex-grid-chart [part='calc-formula'][aria-invalid='true'] {
        border-color: #e11d48;
      }
      apex-grid-chart [part='calc-legend'] {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      apex-grid-chart [part='calc-chip'] {
        font: inherit;
        font-size: 0.68rem;
        padding: 1px 6px;
        border: 1px solid #d0d5dd;
        border-radius: 10px;
        background: #f7f9fc;
        cursor: pointer;
        color: #4b5563;
      }
      apex-grid-chart [part='calc-chip']:hover {
        background: #eef2f8;
      }
      apex-grid-chart [part='calc-add'] {
        font: inherit;
        font-size: 0.75rem;
        padding: 3px 9px;
        border: 1px solid #1f2328;
        background: #1f2328;
        color: #fff;
        border-radius: 4px;
        cursor: pointer;
        align-self: flex-start;
      }
      apex-grid-chart [part='calc-add']:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      apex-grid-chart [part='placeholder'] {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 28px 16px;
        color: #6b7280;
        text-align: center;
      }
      /* The display:flex above outranks the [hidden] attribute's UA display:none, so restore it. */
      apex-grid-chart [part='placeholder'][hidden] {
        display: none;
      }
      apex-grid-chart [part='empty-icon'] {
        color: #c0c6d0;
      }
      apex-grid-chart [part='empty-title'] {
        font-weight: 600;
        color: #4b5563;
      }
      apex-grid-chart [part='empty-paths'] {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 3px;
        font-size: 0.8rem;
      }
      apex-grid-chart [part='canvas'] {
        padding: 4px;
      }
      apex-grid-chart[mode='dialog'] [part='canvas'] {
        flex: 1 1 auto;
        /* ApexCharts sets an inline min-height on its container equal to the chart height; left
           alone it pins the canvas to the tallest chart ever drawn, so shrinking the panel clips
           instead of refitting. Force 0 (over the inline style) so the flex item tracks the panel;
           the chart's real height comes from the measured box (see #resolveHeight). */
        min-height: 0 !important;
        /* No padding: the chart fills the measured canvas box exactly. */
        padding: 0;
        overflow: hidden;
      }
    </style>`;
  }

  /** Current single aggregation for the popover select (a per-measure map shows as its `sum` base). */
  #currentAggregation(): ChartAggregation {
    const agg = this.definition.aggregation;
    return typeof agg === 'string' ? agg : 'sum';
  }

  /** A small monochrome glyph for a chart type (inherits `currentColor`, so it themes). */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a flat glyph lookup table.
  #typeIcon(type: ChartType | 'auto') {
    switch (type) {
      case 'bar':
        return svg`<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="2" width="9" height="3"/><rect x="1" y="6.5" width="14" height="3"/><rect x="1" y="11" width="6" height="3"/></svg>`;
      case 'line':
        return svg`<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1,12 5.5,6 9,9 15,2"/></svg>`;
      case 'area':
        return svg`<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 12 L5.5 6 L9 9 L15 2 L15 15 L1 15 Z" fill="currentColor" opacity="0.3"/><polyline points="1,12 5.5,6 9,9 15,2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
      case 'pie':
        return svg`<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="8" cy="8" r="7" opacity="0.35"/><path d="M8 8 L8 1 A7 7 0 0 1 15 8 Z"/></svg>`;
      case 'donut':
        return svg`<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="3.4" aria-hidden="true"><circle cx="8" cy="8" r="5.4"/></svg>`;
      case 'scatter':
        return svg`<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="11.5" r="1.6"/><circle cx="7" cy="6" r="1.6"/><circle cx="11" cy="9" r="1.6"/><circle cx="13.5" cy="3.5" r="1.6"/></svg>`;
      case 'radar':
        return svg`<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" fill-opacity="0.4" stroke="currentColor" stroke-width="1" stroke-linejoin="round" aria-hidden="true"><polygon points="8,1 15,6 12,15 4,15 1,6"/></svg>`;
      case 'combo':
        return svg`<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="8" width="3.5" height="7" fill="currentColor"/><rect x="6.5" y="5" width="3.5" height="10" fill="currentColor" opacity="0.55"/><polyline points="1.5,7 6.5,4 11,6 15,2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      case 'auto':
        return svg`<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1 L9.4 5.8 L14.4 6.3 L10.4 9.4 L11.8 14.4 L8 11.4 L4.2 14.4 L5.6 9.4 L1.6 6.3 L6.6 5.8 Z"/></svg>`;
      default: // column
        return svg`<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="7" width="3.4" height="8"/><rect x="6.3" y="3" width="3.4" height="12"/><rect x="11.6" y="9" width="3.4" height="6"/></svg>`;
    }
  }

  /** A single chart-type button (icon + label) for the gallery. */
  #renderTypeButton(type: ChartType | 'auto') {
    const label = this.#t(`chart.type.${type}` as GridLocaleKey, TYPE_LABELS[type]);
    return html`<button
      part="type-button"
      type="button"
      aria-pressed=${this.type === type ? 'true' : 'false'}
      aria-label=${label}
      title=${label}
      @click=${() => this.#selectType(type)}
    >
      ${this.#typeIcon(type)}<span part="type-label">${label}</span>
    </button>`;
  }

  /** Auto-derived title from the mapping (e.g. "Revenue by Region"); series names when no category. */
  #autoHeading(): string {
    const names = this.seriesNames;
    if (names.length === 0) return this.heading || 'Chart';
    const series = names.join(', ');
    // A snapshot chart's category isn't recoverable from the frozen model, so don't guess one.
    if (this.staticModel) return series;
    const categoryLabel = this.dataFields.find((f) => f.key === this.#categoryKey())?.label;
    return categoryLabel ? `${series} ${this.#t('chart.by')} ${categoryLabel}` : series;
  }

  /** The heading to show: an explicit (user-set) heading, else the auto-title from the mapping. */
  #effectiveHeading(): string {
    return this.heading && this.heading !== 'Chart' ? this.heading : this.#autoHeading();
  }

  #startRenameHeading = (): void => {
    this.headingEditing = true;
    void this.updateComplete.then(() => {
      const input = this.renderRoot.querySelector<HTMLInputElement>('[part="heading-input"]');
      input?.focus();
      input?.select();
    });
  };

  /** Commit the inline rename: a blank value reverts to the auto-title (heading = default 'Chart'). */
  #commitHeading = (event: Event): void => {
    const value = (event.target as HTMLInputElement).value.trim();
    this.heading = value || 'Chart';
    this.headingEditing = false;
  };

  #onHeadingKeydown = (event: KeyboardEvent): void => {
    event.stopPropagation(); // don't let Escape bubble to the dialog's close handler
    if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
    else if (event.key === 'Escape') this.headingEditing = false;
  };

  /**
   * The Data (mapping) popover: category (X), measures (Y) with a per-series secondary-axis toggle,
   * and the aggregation. Hidden for snapshot charts (`staticModel` bakes the mapping) and when the
   * grid exposes no fields (grouping/pivot views, which carry their own aggregation).
   */
  #renderDataMenu() {
    if (this.staticModel || this.dataFields.length === 0) return nothing;
    const category = this.#categoryKey();
    const measures = this.#measureKeys();
    const secondary = this.definition.secondaryMeasures ?? [];
    const aggregations: ChartAggregation[] = ['sum', 'avg', 'count', 'min', 'max', 'median'];
    return html`<div part="data">
      <button
        part="data-button"
        type="button"
        aria-haspopup="menu"
        aria-expanded=${this.dataOpen ? 'true' : 'false'}
        @click=${this.#toggleDataMenu}
      >
        ${this.#t('chart.data')} ▾
      </button>
      <div part="data-menu" role="menu" ?hidden=${!this.dataOpen}>
        <label part="format-row">
          <span>${this.#t('chart.mapCategory')}</span>
          <select @change=${(e: Event) => this.#setCategory((e.target as HTMLSelectElement).value)}>
            ${this.dataFields.map(
              (f) =>
                html`<option value=${f.key} ?selected=${category === f.key}>${f.label}</option>`
            )}
          </select>
        </label>
        <div part="data-group">
          <span part="format-heading">${this.#t('chart.mapSeries')}</span>
          ${this.dataFields
            .filter((f) => f.numeric && f.key !== category)
            .map((f) => {
              const on = measures.includes(f.key);
              return html`<div part="data-measure">
                <label part="data-measure-name">
                  <input
                    type="checkbox"
                    .checked=${on}
                    @change=${() => this.#toggleMeasure(f.key)}
                  />
                  <span>${f.label}</span>
                </label>
                <label part="data-axis" ?hidden=${!on} title=${this.#t('chart.secondaryAxis')}>
                  <input
                    type="checkbox"
                    .checked=${secondary.includes(f.key)}
                    @change=${() => this.#toggleSecondary(f.key)}
                  />
                  <span>${this.#t('chart.secondaryAxisShort')}</span>
                </label>
              </div>`;
            })}
        </div>
        <label part="format-row">
          <span>${this.#t('chart.mapAggregation')}</span>
          <select
            @change=${(e: Event) =>
              this.#setAggregation((e.target as HTMLSelectElement).value as ChartAggregation)}
          >
            ${aggregations.map(
              (fn) => html`<option value=${fn} ?selected=${this.#currentAggregation() === fn}>
                ${this.#t(`chart.agg.${fn}` as GridLocaleKey)}
              </option>`
            )}
          </select>
        </label>
        ${
          this.type === 'column' || this.type === 'bar'
            ? html`<label part="format-row" title=${this.#t('chart.swapAxesHint')}>
                <input
                  type="checkbox"
                  .checked=${this.type === 'bar'}
                  @change=${(e: Event) =>
                    this.#selectType((e.target as HTMLInputElement).checked ? 'bar' : 'column')}
                />
                <span>${this.#t('chart.swapAxes')}</span>
              </label>`
            : nothing
        }
        ${this.#renderCalculatedFields()}
      </div>
    </div>`;
  }

  /** The "Calculated fields" block inside the Data popover: existing fields + an add form + legend. */
  #renderCalculatedFields() {
    const fields = this.definition.calculatedFields ?? [];
    const columns = this.#calcColumns();
    const formulaValid = this.calcFormula === '' || isValidChartFormula(this.calcFormula);
    const canAdd = this.calcName.trim() !== '' && isValidChartFormula(this.calcFormula);
    return html`<div part="calc-group">
      <span part="format-heading">${this.#t('chart.calcFields')}</span>
      ${fields.map(
        (field, i) => html`<div part="calc-item">
          <span part="calc-item-name">${field.name}</span>
          <code part="calc-item-formula">${field.formula}</code>
          <label part="data-axis" title=${this.#t('chart.secondaryAxis')}>
            <input
              type="checkbox"
              .checked=${(this.definition.secondaryMeasures ?? []).includes(field.name)}
              @change=${() => this.#toggleSecondary(field.name)}
            />
            <span>${this.#t('chart.secondaryAxisShort')}</span>
          </label>
          <button
            part="calc-remove"
            type="button"
            aria-label=${this.#t('chart.calcRemove')}
            @click=${() => this.#removeCalculatedField(i)}
          >
            ✕
          </button>
        </div>`
      )}
      <input
        part="calc-name"
        type="text"
        placeholder=${this.#t('chart.calcName')}
        aria-label=${this.#t('chart.calcName')}
        .value=${this.calcName}
        @input=${(e: Event) => {
          this.calcName = (e.target as HTMLInputElement).value;
        }}
      />
      <input
        part="calc-formula"
        type="text"
        placeholder=${this.#t('chart.calcFormula')}
        aria-label=${this.#t('chart.calcFormula')}
        aria-invalid=${formulaValid ? 'false' : 'true'}
        .value=${this.calcFormula}
        @input=${(e: Event) => {
          this.calcFormula = (e.target as HTMLInputElement).value;
        }}
      />
      ${
        columns.length > 0
          ? html`<div part="calc-legend">
              ${columns.map(
                (c) => html`<button
                  part="calc-chip"
                  type="button"
                  title=${c.label}
                  @click=${() => this.#insertCalcRef(c.letter)}
                >
                  ${c.letter}=${c.label}
                </button>`
              )}
            </div>`
          : nothing
      }
      <button part="calc-add" type="button" ?disabled=${!canAdd} @click=${() => this.#addCalculatedField()}>
        ${this.#t('chart.calcAdd')}
      </button>
    </div>`;
  }

  protected override render() {
    const empty = !this.hasModel;
    return html`${this.#renderStyle()}
      <div
        part="panel"
        role=${this.mode === 'dialog' ? 'dialog' : nothing}
        aria-modal=${this.mode === 'dialog' ? 'true' : nothing}
        aria-label=${this.mode === 'dialog' ? this.#effectiveHeading() : nothing}
        @keydown=${this.#onKeydown}
      >
        ${
          this.mode === 'dialog'
            ? html`<div
                part="header"
                @pointerdown=${this.#onHeaderPointerDown}
                @pointermove=${this.#onHeaderPointerMove}
                @pointerup=${this.#onHeaderPointerUp}
              >
                ${
                  this.headingEditing
                    ? html`<input
                        part="heading-input"
                        .value=${this.#effectiveHeading()}
                        @keydown=${this.#onHeadingKeydown}
                        @blur=${this.#commitHeading}
                        @pointerdown=${(e: Event) => e.stopPropagation()}
                      />`
                    : html`<span
                        part="heading"
                        title=${this.#t('chart.renameHint')}
                        @dblclick=${this.#startRenameHeading}
                        >${this.#effectiveHeading()}</span
                      >`
                }
                <button
                  part="close"
                  type="button"
                  aria-label=${this.#t('chart.close')}
                  @click=${() => this.close()}
                >
                  ✕
                </button>
              </div>`
            : nothing
        }
        <div part="toolbar" ?hidden=${empty}>
          ${TYPE_GROUPS.map(
            (group, i) =>
              html`${i > 0 ? html`<span part="type-divider" aria-hidden="true"></span>` : nothing}${group.map(
                (type) => this.#renderTypeButton(type)
              )}`
          )}
          <span part="type-divider" aria-hidden="true"></span>
          <button
            part="suggest-button"
            type="button"
            aria-pressed=${this.type === 'auto' ? 'true' : 'false'}
            title=${this.#t('chart.suggestedHint')}
            @click=${() => this.#selectType('auto')}
          >
            ${this.#typeIcon('auto')}<span>${this.#t('chart.suggested')}</span>
          </button>
          ${this.#renderDataMenu()}
          <div part="export" @focusout=${this.#onExportBlur}>
            <button
              part="export-button"
              type="button"
              aria-haspopup="menu"
              aria-expanded=${this.exportOpen ? 'true' : 'false'}
              @click=${this.#toggleExportMenu}
            >
              ${this.#t('chart.export')} ▾
            </button>
            <div part="export-menu" role="menu" ?hidden=${!this.exportOpen}>
              <button
                part="export-item"
                type="button"
                role="menuitem"
                @click=${() => this.#runExport(() => this.exportImage('png'))}
              >
                ${this.#t('chart.exportPng')}
              </button>
              <button
                part="export-item"
                type="button"
                role="menuitem"
                @click=${() => this.#runExport(() => this.exportImage('svg'))}
              >
                ${this.#t('chart.exportSvg')}
              </button>
              <button
                part="export-item"
                type="button"
                role="menuitem"
                @click=${() => this.#runExport(() => this.copyImage())}
              >
                ${this.#t('chart.copyImage')}
              </button>
            </div>
          </div>
          <div part="format">
            <button
              part="format-button"
              type="button"
              aria-haspopup="menu"
              aria-expanded=${this.formatOpen ? 'true' : 'false'}
              @click=${this.#toggleFormatMenu}
            >
              ${this.#t('chart.format')} ▾
            </button>
            <div part="format-menu" role="menu" ?hidden=${!this.formatOpen}>
              ${
                this.seriesNames.length > 0
                  ? html`<div part="format-group">
                      <span part="format-heading">${this.#t('chart.seriesColors')}</span>
                      ${this.seriesNames.map(
                        (name, i) => html`<label part="format-swatch">
                          <input
                            type="color"
                            .value=${this.format.colors?.[i] ?? '#888888'}
                            @input=${(e: Event) =>
                              this.#setSeriesColor(i, (e.target as HTMLInputElement).value)}
                          />
                          <span>${name}</span>
                        </label>`
                      )}
                    </div>`
                  : nothing
              }
              <label part="format-row">
                <input
                  type="checkbox"
                  .checked=${this.format.legend ?? true}
                  @change=${(e: Event) =>
                    this.#patchFormat({ legend: (e.target as HTMLInputElement).checked })}
                />
                <span>${this.#t('chart.legend')}</span>
              </label>
              <label part="format-row">
                <input
                  type="checkbox"
                  .checked=${this.format.dataLabels ?? false}
                  @change=${(e: Event) =>
                    this.#patchFormat({ dataLabels: (e.target as HTMLInputElement).checked })}
                />
                <span>${this.#t('chart.dataLabels')}</span>
              </label>
              <label part="format-row">
                <input
                  type="checkbox"
                  .checked=${this.format.gridlines ?? true}
                  @change=${(e: Event) =>
                    this.#patchFormat({ gridlines: (e.target as HTMLInputElement).checked })}
                />
                <span>${this.#t('chart.gridlines')}</span>
              </label>
              <label part="format-row">
                <span>${this.#t('chart.numberFormat')}</span>
                <select
                  @change=${(e: Event) =>
                    this.#patchFormat({
                      numberFormat: (e.target as HTMLSelectElement)
                        .value as ChartFormat['numberFormat'],
                    })}
                >
                  ${(['none', 'currency', 'percent', 'thousands'] as const).map(
                    (value) => html`<option
                      value=${value}
                      ?selected=${(this.format.numberFormat ?? 'none') === value}
                    >
                      ${this.#t(`chart.format.${value}` as GridLocaleKey)}
                    </option>`
                  )}
                </select>
              </label>
              <label part="format-row">
                <input
                  type="checkbox"
                  .checked=${this.format.trendline ?? false}
                  @change=${(e: Event) =>
                    this.#patchFormat({ trendline: (e.target as HTMLInputElement).checked })}
                />
                <span>${this.#t('chart.trendline')}</span>
              </label>
              <label part="format-row">
                <span>${this.#t('chart.referenceLine')}</span>
                <input
                  part="format-number"
                  type="number"
                  .value=${this.format.referenceLine == null ? '' : String(this.format.referenceLine)}
                  @change=${(e: Event) => {
                    const raw = (e.target as HTMLInputElement).value;
                    this.#patchFormat({ referenceLine: raw === '' ? undefined : Number(raw) });
                  }}
                />
              </label>
              <div part="format-row">
                <span>${this.#t('chart.referenceBand')}</span>
                <span part="format-band">
                  <input
                    part="format-number"
                    type="number"
                    aria-label=${this.#t('chart.bandFrom')}
                    placeholder=${this.#t('chart.bandFrom')}
                    .value=${this.format.referenceBand ? String(this.format.referenceBand.from) : ''}
                    @change=${(e: Event) => this.#patchBand('from', (e.target as HTMLInputElement).value)}
                  />
                  <input
                    part="format-number"
                    type="number"
                    aria-label=${this.#t('chart.bandTo')}
                    placeholder=${this.#t('chart.bandTo')}
                    .value=${this.format.referenceBand ? String(this.format.referenceBand.to) : ''}
                    @change=${(e: Event) => this.#patchBand('to', (e.target as HTMLInputElement).value)}
                  />
                </span>
              </div>
              <label part="format-row">
                <span>${this.#t('chart.forecast')}</span>
                <input
                  part="format-number"
                  type="number"
                  min="0"
                  .value=${this.format.forecast ? String(this.format.forecast) : ''}
                  @change=${(e: Event) => {
                    const raw = (e.target as HTMLInputElement).value;
                    this.#patchFormat({
                      forecast: raw === '' ? undefined : Math.max(0, Number(raw)),
                    });
                  }}
                />
              </label>
              <label part="format-row">
                <input
                  type="checkbox"
                  .checked=${this.format.forecastBand ?? false}
                  @change=${(e: Event) =>
                    this.#patchFormat({ forecastBand: (e.target as HTMLInputElement).checked })}
                />
                <span>${this.#t('chart.forecastBand')}</span>
              </label>
              <label part="format-row">
                <span>${this.#t('chart.axisTitleX')}</span>
                <input
                  part="format-text"
                  type="text"
                  .value=${this.format.axisTitles?.x ?? ''}
                  @change=${(e: Event) => this.#patchAxisTitle('x', (e.target as HTMLInputElement).value)}
                />
              </label>
              <label part="format-row">
                <span>${this.#t('chart.axisTitleY')}</span>
                <input
                  part="format-text"
                  type="text"
                  .value=${this.format.axisTitles?.y ?? ''}
                  @change=${(e: Event) => this.#patchAxisTitle('y', (e.target as HTMLInputElement).value)}
                />
              </label>
            </div>
          </div>
        </div>
        <div part="placeholder" ?hidden=${!empty}>
          <svg part="empty-icon" width="40" height="40" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M1.5 1.5 V14.5 H14.5" />
            <rect x="3.5" y="9" width="2.2" height="4" fill="currentColor" stroke="none" />
            <rect x="7" y="6" width="2.2" height="7" fill="currentColor" stroke="none" />
            <rect x="10.5" y="3.5" width="2.2" height="9.5" fill="currentColor" stroke="none" />
          </svg>
          <div part="empty-title">${this.#t('chart.emptyTitle')}</div>
          <ul part="empty-paths">
            <li>${this.#t('chart.emptyRange')}</li>
            <li>${this.#t('chart.emptyView')}</li>
          </ul>
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
