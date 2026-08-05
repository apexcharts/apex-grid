import { LicenseManager } from 'apex-commons';
import type {
  ApexCellContext,
  ColumnConfiguration,
  ColumnGroupConfiguration,
  CSVExportOptions,
  DataPipelineConfiguration,
  DataPipelineHook,
  DataType,
  ExportCellValue,
  GetStateOptions,
  GridLocaleKey,
  GridSchema,
  GridState,
  SetStateOptions,
  SetStateResult,
} from 'apex-grid';
import {
  ApexGrid,
  downloadBlob,
  type ExportFormat,
  type ExportOptions,
  type GridFeatureModule,
  getColumnLabel,
  getDisplayColumns,
  PIPELINE,
  type RowRef,
  registerComponent,
  resolveExportColumns,
  resolveExportRows,
  resolveExportValue,
  resolveRowRefs,
  StateController,
  serializeRowRefs,
  type ToolbarAction,
} from 'apex-grid/internal';
import { html, nothing, type PropertyValues } from 'lit';
import { property } from 'lit/decorators.js';
import type { ApexGridAI } from './ai-panel.js';
import type { ApexGridChart, ChartSource } from './chart-panel.js';
import { type AdvancedFilterModel, filterRows } from './features/advanced-filter.js';
import {
  AGGREGATION_MODULE_ID,
  type AggregationConfig,
  type AggregationController,
  type AggregationFn,
  type AggregationResults,
} from './features/aggregation.js';
// The AI layer is imported for TYPES ONLY here; its runtime values are pulled in via a
// dynamic `import()` inside `#ensureAIEngine`, on the first `runPrompt` / `previewPrompt`.
// Two payoffs: (1) an `<apex-grid-enterprise>` consumer who never uses AI links zero AI
// code (the whole layer becomes an on-demand chunk); (2) the barrel is still avoided, so
// createClaudeReasoner's lazy `import('@anthropic-ai/sdk')` never reaches the browser
// `define` bundle. The Claude reasoner stays reachable only through the package entry.
import type { AIEngine, AIResult, RunPromptOptions } from './features/ai/engine.js';
import type { Reasoner } from './features/ai/reasoner.js';
import type { Plan } from './features/ai/types.js';
import {
  type ChartAggregation,
  type ChartDefinition,
  type ChartField,
  type ChartModel,
  type ChartSeries,
  type ChartType,
  type RenderChartOptions,
  renderApexChart,
} from './features/chart.js';
import { computeCalculatedSeries } from './features/chart-calc.js';
import {
  CONTEXT_MENU_MODULE_ID,
  type ContextMenuConfig,
  type ContextMenuController,
  type ContextMenuItem,
  type ContextMenuTarget,
} from './features/context-menu.js';
import {
  FORMULA_MODULE_ID,
  type FormulaController,
  type FormulaFn,
  formulaEditorTemplate,
} from './features/formula/index.js';
import {
  GROUPING_MODULE_ID,
  type GroupingController,
  type GroupRowMeta,
} from './features/grouping.js';
import {
  type InfiniteHost,
  type InfiniteRowModelConfig,
  InfiniteRowModelManager,
} from './features/infinite-row-model.js';
import { type MasterDetailConfig, MasterDetailManager } from './features/master-detail.js';
import { PIVOT_MODULE_ID, type PivotController, type PivotOptions } from './features/pivot.js';
import {
  RANGE_CHANGED_EVENT,
  RANGE_SELECTION_MODULE_ID,
  type RangeBounds,
  type RangeSelectionController,
  type RangeStats,
} from './features/range-selection.js';
import {
  type ServerSideHost,
  type ServerSideRowModelConfig,
  ServerSideRowModelManager,
} from './features/server-side-row-model.js';
import { buildXLSX, type XLSXExportOptions } from './features/xlsx.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Aggregation functions advertised by {@link ApexGridEnterprise.getSchema}. */
const AGGREGATION_FUNCS: AggregationFn[] = ['sum', 'avg', 'min', 'max', 'count'];

/** Coerce a cell value to a finite number, or `null` if it is not numeric. */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Collapse the values collected for one category into a single number, per {@link ChartAggregation}. */
function aggregateValues(values: ReadonlyArray<number>, fn: ChartAggregation): number {
  const n = values.length;
  if (n === 0) return 0;
  switch (fn) {
    case 'count':
      return n;
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / n;
    case 'min':
      return values.reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);
    case 'max':
      return values.reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY);
    case 'median': {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(n / 2);
      return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
    default:
      return values.reduce((a, b) => a + b, 0); // sum
  }
}

/**
 * Build a category/series {@link ChartModel} from a labeled grid: `columns` (in display order) and
 * `rows` of row-major cell values. By default the first non-numeric column is the **category axis**
 * and every numeric column becomes a **series** (named by its header); a {@link ChartDefinition}
 * overrides the category, the measure set, and the aggregation. A column is numeric if declared
 * `type: 'number'` or every non-blank cell parses to a finite number.
 *
 * Rows are grouped by category label (first-seen order) and each measure is aggregated per category
 * — `sum` by default, or `avg`/`count`/`min`/`max`/`median` (one function for all series or a
 * per-measure map). With already-distinct labels each group holds one row, so the default reproduces
 * the row-for-row chart. An all-numeric grid uses row positions (1, 2, 3, …) as categories. Returns
 * an empty model when there is no series to plot.
 *
 * Shared by {@link ApexGridEnterprise.getRangeChartModel} (cell-range selection) and the flat-grid
 * branch of {@link ApexGridEnterprise.getViewChartModel} (the view-bound companion chart).
 */
/**
 * Per-column numeric test used to orient a chart: a column is numeric when it is declared
 * `type: 'number'`, or every non-blank value in `rows` parses as a number (and at least one value
 * was seen). Column index aligns with `rows`' inner arrays.
 */
function detectNumericColumns<T extends object>(
  columns: ReadonlyArray<ColumnConfiguration<T>>,
  rows: ReadonlyArray<ReadonlyArray<unknown>>
): boolean[] {
  return columns.map((column, c) => {
    if (column.type === 'number') return true;
    let sawValue = false;
    for (const row of rows) {
      const value = row[c];
      if (value === null || value === undefined || value === '') continue;
      sawValue = true;
      if (toNumber(value) === null) return false;
    }
    return sawValue;
  });
}

function buildCategoryModel<T extends object>(
  columns: ReadonlyArray<ColumnConfiguration<T>>,
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  definition: ChartDefinition = {}
): ChartModel {
  const numeric = detectNumericColumns(columns, rows);

  // Category: an explicit `definition.category` (by column key) wins; otherwise the first
  // non-numeric column. -1 means "no category" → chart row-for-row with positional labels.
  let catIndex = -1;
  if (definition.category != null) {
    catIndex = columns.findIndex((column) => String(column.key) === definition.category);
  }
  if (catIndex < 0 && definition.category == null) {
    catIndex = numeric.findIndex((isNumeric) => !isNumeric);
  }
  const labels =
    catIndex >= 0
      ? rows.map((row) => String(row[catIndex] ?? ''))
      : rows.map((_, i) => String(i + 1));

  // Measures: an explicit list (by key, minus the category) or every numeric non-category column.
  const measureIndices =
    definition.measures && definition.measures.length > 0
      ? definition.measures
          .map((key) => columns.findIndex((column) => String(column.key) === key))
          .filter((c) => c >= 0 && c !== catIndex)
      : columns.map((_, c) => c).filter((c) => c !== catIndex && numeric[c]);
  if (measureIndices.length === 0) return { categories: [], series: [] };

  const aggregationFor = (key: string): ChartAggregation => {
    const agg = definition.aggregation;
    if (agg == null) return 'sum';
    return typeof agg === 'string' ? agg : (agg[key] ?? 'sum');
  };

  // Group rows by category label (first-seen order), collecting each measure's values per category.
  const categories: string[] = [];
  const slotOf = new Map<string, number>();
  const buckets: number[][][] = measureIndices.map(() => []);
  labels.forEach((label, r) => {
    let slot = slotOf.get(label);
    if (slot === undefined) {
      slot = categories.length;
      slotOf.set(label, slot);
      categories.push(label);
      for (const bucket of buckets) bucket[slot] = [];
    }
    measureIndices.forEach((c, m) => {
      buckets[m][slot as number].push(toNumber(rows[r][c]) ?? 0);
    });
  });

  const series: ChartSeries[] = measureIndices.map((c, m) => {
    const fn = aggregationFor(String(columns[c].key));
    return {
      name: getColumnLabel(columns[c]),
      data: buckets[m].map((values) => aggregateValues(values, fn)),
    };
  });

  // Calculated-field series: aggregate EVERY numeric non-category column per category (letters A, B,
  // … in column order — the reference frame the formulas + the popover legend share), then evaluate
  // each formula once per category over those aggregates (aggregate-then-evaluate). Appended after
  // the measure series. Guarded so a chart without calculated fields pays nothing.
  if (!definition.calculatedFields || definition.calculatedFields.length === 0) {
    return { categories, series };
  }
  const numericCols = columns.map((_, c) => c).filter((c) => numeric[c] && c !== catIndex);
  const refBuckets: number[][][] = numericCols.map(() => categories.map(() => []));
  labels.forEach((label, r) => {
    const slot = slotOf.get(label);
    if (slot === undefined) return;
    numericCols.forEach((c, letterIndex) => {
      refBuckets[letterIndex][slot].push(toNumber(rows[r][c]) ?? 0);
    });
  });
  const refAggregates = numericCols.map((c, letterIndex) =>
    refBuckets[letterIndex].map((values) =>
      aggregateValues(values, aggregationFor(String(columns[c].key)))
    )
  );
  // A calculated series may carry nulls (a category where the formula errored / was non-finite);
  // ApexCharts renders those as gaps. ChartSeries types data as number[], so cast (matching how the
  // panel's trend/forecast overlays already introduce null gaps).
  const calculated = computeCalculatedSeries(
    definition.calculatedFields,
    refAggregates,
    categories.length
  ) as ChartSeries[];
  return { categories, series: [...series, ...calculated] };
}

/**
 * Enterprise view state captured under `modules.enterprise` in a grid snapshot
 * (see {@link ApexGridEnterprise.getState} / {@link ApexGridEnterprise.setState}).
 */
interface EnterpriseStateBlob {
  groupBy?: string[];
  aggregations?: AggregationConfig;
  pivotOn?: string | string[];
  pivotRows?: string[];
  pivotValues?: AggregationConfig;
  /** Per-group collapse overrides (group key → expanded). */
  groupExpand?: Record<string, boolean>;
  /** Range-selection rectangles (view coordinates; round-trip within a session). */
  ranges?: RangeBounds[];
  /** Stored cell formulas (durable across reload when `rowId` is set, else positional). */
  formulas?: FormulaStateEntry[];
}

/** A persisted cell formula: a durable row reference, the column key, and the source. */
interface FormulaStateEntry {
  row: RowRef;
  column: string;
  src: string;
}

/** Custom-element tag for the enterprise grid. */
export const ENTERPRISE_TAG = 'apex-grid-enterprise';

/**
 * Fired on the grid (bubbles, composed) after its render pipeline settles and the
 * rendered view (columns / row count / grouping / pivot) has changed. The signal
 * `<apex-grid-chart>` listens to for live redraws on group/pivot/data changes.
 */
export const VIEW_CHANGED_EVENT = 'apex-view-changed';

// Repeating diagonal watermark shown when no valid license is set. Rendered in
// the grid's shadow DOM as a non-interactive overlay (absolute + inset:0 covers
// the full scroll area without disturbing the grid layout).
const WATERMARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">' +
  '<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" ' +
  'font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif" ' +
  'font-size="16" font-weight="600" fill="rgba(134,134,134,0.16)" ' +
  'transform="rotate(-35,160,100)">apex-grid-enterprise</text></svg>';
const WATERMARK_STYLE = [
  'position:absolute',
  'inset:0',
  'pointer-events:none',
  'user-select:none',
  'z-index:10000',
  `background-image:url("data:image/svg+xml,${encodeURIComponent(WATERMARK_SVG)}")`,
  'background-repeat:repeat',
].join(';');

/** Tags a `cellTemplate` injected by `showFormulas`, so the toggle can revert it. */
const FORMULA_DISPLAY = Symbol('apex-formula-display');

/** Whether a `cellTemplate` is the one `showFormulas` injected (vs. a user's own). */
function isFormulaDisplay(template: unknown): boolean {
  return (
    typeof template === 'function' &&
    (template as { [FORMULA_DISPLAY]?: boolean })[FORMULA_DISPLAY] === true
  );
}

/**
 * A display `cellTemplate` showing a cell's formula source, or its value when it
 * has none. The source is left-aligned (formulas read left-to-right) even in
 * right-aligned numeric/currency columns; cells without a formula render their
 * value unchanged.
 */
function formulaDisplayTemplate<T extends object>(
  controller: FormulaController<T>
): (ctx: ApexCellContext<T>) => unknown {
  const template = (ctx: ApexCellContext<T>): unknown => {
    const src = controller.getFormula(ctx.row.data, ctx.column.key as keyof T & string);
    return src === undefined
      ? ctx.value
      : html`<span part="formula-source" style="display:block;width:100%;text-align:left">${src}</span>`;
  };
  (template as { [FORMULA_DISPLAY]?: boolean })[FORMULA_DISPLAY] = true;
  return template;
}

/** Enterprise export option: emit each formula cell's `=...` source instead of its value. */
export interface FormulaExportOptions {
  /** When true, cells holding a formula export their source; others export normally. */
  formulas?: boolean;
}

/**
 * Pro-licensed grid. Extends the community {@link ApexGrid} and registers as
 * `<apex-grid-enterprise>`, reusing the full grid template/DOM and layering in
 * enterprise-only feature modules through `createStateController()`.
 *
 * Licensing follows the non-hostile, offline model: without a valid key set via
 * {@link ApexGridEnterprise.setLicense} the grid keeps working but renders a
 * watermark and logs a console notice.
 *
 * @element apex-grid-enterprise
 *
 * @remarks
 * Inherits all properties, attributes, methods, and events of {@link ApexGrid}
 * (see its docs for the full `@fires` list and `--ag-*` theming hooks), and adds
 * column aggregations, row grouping, pivoting, integrated charts, cell range
 * selection, XLSX export, and licensing on top.
 *
 * @csspart license-watermark - Non-interactive diagonal watermark overlay shown when no valid license is set.
 */
export class ApexGridEnterprise<T extends object> extends ApexGrid<T> {
  /** Live instances, so {@link setLicense} can refresh watermarks on the fly. */
  static #instances = new Set<ApexGridEnterprise<any>>();

  /**
   * Feature modules opted into via {@link use}, keyed by module id so re-adding
   * the same module is a no-op. Read once per instance by
   * {@link createStateController}, so register modules before constructing any
   * grid. Empty by default: importing the grid wires in **no** features, so each
   * one is tree-shaken unless you opt into it (the bundle a non-charting,
   * non-pivoting app ships stays minimal). The batteries-included
   * `apex-grid-enterprise/define` entry calls {@link use} with every built-in
   * module for you.
   */
  static #modules = new Map<string, GridFeatureModule>();

  /**
   * Opt feature modules into every enterprise grid (idempotent per module id).
   * Returns the class so calls can chain. Call before constructing any
   * `<apex-grid-enterprise>` (and before {@link register}).
   *
   * @example
   * ```ts
   * import { ApexGridEnterprise, pivotModule } from 'apex-grid-enterprise';
   * ApexGridEnterprise.use(pivotModule); // only pivoting is bundled + wired
   * ApexGridEnterprise.register();
   * ```
   */
  public static use(...modules: ReadonlyArray<GridFeatureModule>): typeof ApexGridEnterprise {
    for (const module of modules) {
      if (!ApexGridEnterprise.#modules.has(module.id)) {
        ApexGridEnterprise.#modules.set(module.id, module);
      }
    }
    return ApexGridEnterprise;
  }

  /**
   * Per-column aggregation request (sum/avg/min/max/count). Read on demand by
   * {@link getAggregations}, and computed per group when {@link groupBy} is set.
   * Reactive: changing it re-runs grouping so group aggregates update.
   */
  @property({ attribute: false })
  public aggregations: AggregationConfig = {};

  /**
   * Ordered column keys to group rows by (derived row grouping, distinct from
   * declared `tree` data). Empty disables grouping. Each group renders an
   * expandable, full-width header row with its value, leaf count, and the
   * configured {@link aggregations}.
   */
  @property({ attribute: false })
  public groupBy: string[] = [];

  /** Tuning for row grouping (e.g. default group expansion). */
  @property({ attribute: false })
  public groupingOptions: { defaultExpanded?: boolean | number } = {};

  /**
   * Column-dimension field(s) for pivoting: their distinct value combinations
   * become columns. Accepts a single field or an ordered list (the first field
   * heads the spanning column-header group). Empty disables pivoting. Requires
   * {@link pivotRows} and {@link pivotValues}. Pivoting and {@link groupBy} are
   * mutually exclusive (pivot wins).
   */
  @property({ attribute: false })
  public pivotOn: string | string[] = '';

  /** Row-dimension field(s) for pivoting (one leading column each). */
  @property({ attribute: false })
  public pivotRows: string[] = [];

  /** Measures aggregated into each pivot cell, e.g. `{ salary: ['sum'] }`. */
  @property({ attribute: false })
  public pivotValues: AggregationConfig = {};

  /** Grand-total / subtotal options for the pivot view. */
  @property({ attribute: false })
  public pivotOptions: PivotOptions = {};

  /**
   * Spreadsheet-style cell range selection (click-drag / shift-click). Enabled
   * by default; set `range-selection="false"` (or the property) to turn it off.
   * Pairs with `<apex-grid-status-bar>` for live selection aggregates and with
   * {@link copySelection} for clipboard export.
   */
  @property({ type: Boolean, attribute: 'range-selection' })
  public rangeSelection = true;

  /**
   * Show the stored formula source in `allowFormula` cells instead of their
   * computed values (a spreadsheet "show formulas" view). Toggle with the
   * `show-formulas` attribute or the property; the computed values are
   * untouched, so turning it off restores the normal display. A user-provided
   * `cellTemplate` is respected (never overridden).
   */
  @property({ type: Boolean, attribute: 'show-formulas' })
  public showFormulas = false;

  /**
   * Right-click context menu on cells and headers (sort / pin / hide / copy, plus "Chart range").
   * Enabled by default; set `context-menu="false"` to turn it off, or assign a
   * {@link ContextMenuConfig} (via property) to replace the items.
   */
  @property({ type: Boolean, attribute: 'context-menu' })
  public contextMenu: boolean | ContextMenuConfig<T> = true;

  /**
   * Declarative master/detail: each expanded master row renders a nested grid
   * of related rows. Setting this configures the grid's {@link expansion}
   * automatically (creating, caching, and populating the child grids), so you
   * don't hand-write a `detailTemplate`. Overrides any manual `expansion`.
   */
  @property({ attribute: false })
  public masterDetail: MasterDetailConfig<T> | null = null;

  #masterDetailManager: MasterDetailManager<T> | null = null;

  /**
   * Infinite (server-side) row model: lazily fetch fixed-size blocks from a
   * datasource as the user scrolls, pushing sort/filter/quick-filter to the
   * server. Setting this disables client-side sort/filter (the server owns
   * ordering) — keep pagination off. See {@link InfiniteRowModelConfig}.
   */
  @property({ attribute: false })
  public infiniteRowModel: InfiniteRowModelConfig<T> | null = null;

  /**
   * Server-side row model with **grouping + aggregation**: the grid asks a
   * {@link ServerSideDataSource} for one group level at a time and lazily fetches
   * a group's children when it is expanded, with server-computed aggregates on
   * the group rows. Setting this disables client-side sort/filter and is mutually
   * exclusive with {@link infiniteRowModel} and client {@link groupBy}/{@link pivotOn}.
   * See {@link ServerSideRowModelConfig}.
   */
  @property({ attribute: false })
  public serverSideRowModel: ServerSideRowModelConfig<T> | null = null;

  /**
   * An optional escalation {@link Reasoner} the AI layer consults when the built-in
   * deterministic rule engine is not confident (e.g. `createClaudeReasoner(...)` for
   * Anthropic/Claude). Unset (the default), {@link runPrompt} is handled entirely by
   * the rule engine: no LLM, no key, no network. The AI Toolkit is an enterprise feature.
   */
  public aiReasoner: Reasoner | null = null;

  /**
   * Advanced: a fully custom {@link AIEngine} (custom tools, memory, or routing
   * policy) used instead of the lazily-built default. When set, it overrides
   * {@link aiReasoner}.
   */
  public aiEngine: AIEngine<T> | null = null;

  #aiEngine: AIEngine<T> | null = null;
  #aiEngineReasoner: Reasoner | null = null;

  #infiniteManager: InfiniteRowModelManager<T> | null = null;
  #infiniteNeedsStart = false;

  #ssrmManager: ServerSideRowModelManager<T> | null = null;
  #ssrmNeedsStart = false;

  /** Columns saved before pivoting activated, restored when it deactivates. */
  #savedColumns: ColumnConfiguration<T>[] | null = null;
  /** Column groups saved before pivoting activated, restored when it deactivates. */
  #savedColumnGroups: ColumnGroupConfiguration[] | undefined;
  #pivotActive = false;

  public static override get tagName(): string {
    return ENTERPRISE_TAG;
  }

  /** Whether a pivot view is currently active. */
  public get isPivoting(): boolean {
    return this.#pivotActive;
  }

  /** The spanning column groups generated for the active pivot view (empty if none). */
  public getPivotColumnGroups(): ColumnGroupConfiguration[] {
    return this.#pivotActive ? (this.#pivotController()?.computeColumnGroups() ?? []) : [];
  }

  #advancedFilterModel: AdvancedFilterModel | null = null;
  #advancedFilterHook: DataPipelineHook<T> | null = null;
  /** The app's own filter hook (if any), saved so {@link clearAdvancedFilter} restores it. */
  #savedFilterHook: DataPipelineHook<T> | undefined;

  /** The active advanced filter model, or `null` when none is applied. */
  public get advancedFilterModel(): AdvancedFilterModel | null {
    return this.#advancedFilterModel;
  }

  /**
   * Apply a nested AND/OR advanced filter. It evaluates client-side through the
   * `dataPipelineConfiguration.filter` hook and, while active, owns column
   * filtering (it replaces the built-in filter). Composes with sort / pagination
   * / grouping. Call {@link clearAdvancedFilter} to remove it.
   */
  public applyAdvancedFilter(model: AdvancedFilterModel): void {
    if (!this.#advancedFilterHook) {
      // Remember any app-provided filter hook so clearing restores it.
      this.#savedFilterHook = this.dataPipelineConfiguration?.filter;
    }
    this.#advancedFilterModel = model;
    const hook: DataPipelineHook<T> = (params) => filterRows(params.data, model, this.columns);
    this.#advancedFilterHook = hook;
    this.dataPipelineConfiguration = { ...(this.dataPipelineConfiguration ?? {}), filter: hook };
    this.requestUpdate(PIPELINE);
  }

  /** Remove the advanced filter, restoring any app-provided filter hook. */
  public clearAdvancedFilter(): void {
    if (!this.#advancedFilterHook) return;
    this.#advancedFilterModel = null;
    this.#advancedFilterHook = null;
    const config: DataPipelineConfiguration<T> = { ...(this.dataPipelineConfiguration ?? {}) };
    if (this.#savedFilterHook) config.filter = this.#savedFilterHook;
    else delete config.filter;
    this.#savedFilterHook = undefined;
    this.dataPipelineConfiguration = config;
    this.requestUpdate(PIPELINE);
  }

  /**
   * Registers `<apex-grid-enterprise>` and the grid's internal dependencies.
   * Idempotent. Reuses {@link ApexGrid.register} for the shared sub-components,
   * then defines the enterprise element.
   */
  public static override register(): void {
    ApexGrid.register();
    registerComponent(ApexGridEnterprise);
  }

  /**
   * Sets the global ApexCharts license key. Without a valid key the grid renders
   * with a watermark. Validation is offline (no network).
   */
  public static setLicense(key: string): void {
    LicenseManager.setLicense(key);
    for (const grid of ApexGridEnterprise.#instances) {
      grid.requestUpdate();
    }
  }

  public override connectedCallback(): void {
    super.connectedCallback();
    ApexGridEnterprise.#instances.add(this);
    // A cell edit changes a value without changing the view's shape, so the structural view
    // signature would not move. Bump the data epoch and re-signal so a view-bound chart redraws.
    this.addEventListener('cellValueChanged', this.#onCellValueChanged);
    // On-selection charting: a floating affordance appears over a non-empty range, and Alt+F1
    // charts the selection from the keyboard (Excel-style). RANGE_CHANGED is a custom event not in
    // the grid's typed event map, so listen via the EventTarget interface.
    (this as EventTarget).addEventListener(RANGE_CHANGED_EVENT, this.#updateChartAffordance);
    this.addEventListener('keydown', this.#onChartShortcut);
    window.addEventListener('scroll', this.#updateChartAffordance, true);
    window.addEventListener('resize', this.#updateChartAffordance);
  }

  #onCellValueChanged = (): void => {
    this.#dataEpoch += 1;
    this.#emitViewChanged();
  };

  public override disconnectedCallback(): void {
    ApexGridEnterprise.#instances.delete(this);
    this.#infiniteManager?.stop();
    this.#ssrmManager?.stop();
    this.removeEventListener('cellValueChanged', this.#onCellValueChanged);
    (this as EventTarget).removeEventListener(RANGE_CHANGED_EVENT, this.#updateChartAffordance);
    this.removeEventListener('keydown', this.#onChartShortcut);
    window.removeEventListener('scroll', this.#updateChartAffordance, true);
    window.removeEventListener('resize', this.#updateChartAffordance);
    this.#chartAffordance?.remove();
    this.#chartAffordance = null;
    // Floating chart dialogs live on document.body, not under the grid, so tear them down here.
    for (const chart of this.#chartDialogs) chart.remove();
    this.#chartDialogs.clear();
    super.disconnectedCallback();
  }

  /** The floating "Chart" button shown over a non-empty range selection (lazily created). */
  #chartAffordance: HTMLButtonElement | null = null;

  /** True when the range-selection module has a non-empty active range to chart. */
  #hasRangeSelection(): boolean {
    const active = this.#rangeController()?.getActiveGrid();
    return !!active && active.rows.length > 0;
  }

  /** Alt+F1 charts the current selection (a no-op without one). */
  #onChartShortcut = (event: KeyboardEvent): void => {
    if (event.altKey && event.key === 'F1' && this.#hasRangeSelection()) {
      event.preventDefault();
      this.#openChartDialog({ source: 'selection' });
    }
  };

  /**
   * Show (and position) a floating "Chart" button over the grid's lower-right corner while a range
   * is selected; hide it otherwise. Anchored to the grid's viewport rect, so it follows scroll and
   * resize. Lives on `document.body` (like the chart dialogs) so it is never clipped by the grid.
   */
  #updateChartAffordance = (): void => {
    // Hidden while a cell/row editor is open: the floating button would sit over
    // grid cells and swallow clicks the editor needs (e.g. the formula editor's
    // click-to-insert-reference).
    const editing = this.editingCell !== null || this.editingRow !== null;
    if (!this.#hasRangeSelection() || editing) {
      if (this.#chartAffordance) this.#chartAffordance.style.display = 'none';
      return;
    }
    let button = this.#chartAffordance;
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      const hint = this.localize('chart.selectionHint', undefined, 'Chart the selection (Alt+F1)');
      button.title = hint;
      button.setAttribute('aria-label', hint);
      Object.assign(button.style, {
        position: 'fixed',
        zIndex: '10900',
        font: '600 12px system-ui, sans-serif',
        padding: '5px 11px',
        border: '1px solid #1f2328',
        background: '#1f2328',
        color: '#fff',
        borderRadius: '6px',
        cursor: 'pointer',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.22)',
      });
      button.addEventListener('click', () => this.#openChartDialog({ source: 'selection' }));
      document.body.appendChild(button);
      this.#chartAffordance = button;
    }
    button.textContent = `\u{1F4CA} ${this.localize('toolbar.createChart')}`;
    button.style.display = 'block';
    const rect = this.getBoundingClientRect();
    button.style.top = `${Math.max(8, rect.bottom - button.offsetHeight - 14)}px`;
    button.style.left = `${Math.max(8, rect.right - button.offsetWidth - 16)}px`;
  };

  /** Computes the configured {@link aggregations} over the grid's data. */
  public getAggregations(): AggregationResults {
    const controller = this.stateController.module<AggregationController<T>>(AGGREGATION_MODULE_ID);
    return controller ? controller.compute(this.data, this.aggregations) : {};
  }

  /**
   * Extends the core {@link ApexGrid.getState} snapshot with the enterprise view
   * state (row grouping, aggregations, and pivoting), stored under
   * `modules.enterprise`.
   *
   * @remarks
   * These live as reactive properties on the enterprise grid (the controllers
   * are synced from them), so they are captured here rather than through the
   * per-module {@link SerializableModule} seam.
   */
  public override getState(options?: GetStateOptions<T>): GridState {
    const base = super.getState(options);
    const enterprise: EnterpriseStateBlob = {
      groupBy: [...this.groupBy],
      aggregations: { ...this.aggregations },
      pivotOn: this.pivotOn,
      pivotRows: [...this.pivotRows],
      pivotValues: { ...this.pivotValues },
      groupExpand: this.#groupingController()?.getExpandOverrides() ?? {},
      ranges: this.#rangeController()?.getRanges() ?? [],
      formulas: this.#serializeFormulas(),
    };
    return { ...base, modules: { ...base.modules, enterprise } };
  }

  /** Serialize stored formulas with a durable row reference (rowId when set). */
  #serializeFormulas(): FormulaStateEntry[] {
    const controller = this.#formulaController();
    if (!controller) {
      return [];
    }
    const entries: FormulaStateEntry[] = [];
    for (const { row, columnKey, src } of controller.listFormulas()) {
      const [ref] = serializeRowRefs([row], this.data, this.rowId);
      if (ref) {
        entries.push({ row: ref, column: columnKey, src });
      }
    }
    return entries;
  }

  /**
   * Extends the core {@link ApexGrid.getSchema} descriptor with enterprise
   * capabilities: marks every column groupable / pivotable, numeric columns
   * aggregatable (with the supported aggregation functions), and advertises
   * grouping / pivot / aggregation at the grid level.
   */
  public override getSchema(): GridSchema {
    const base = super.getSchema();
    const numeric = (type: DataType): boolean => type === 'number' || type === 'currency';
    const formulaColumns = new Set(
      this.columns.filter((column) => column.allowFormula).map((column) => String(column.key))
    );
    return {
      ...base,
      columns: base.columns.map((column) => ({
        ...column,
        groupable: true,
        pivotable: true,
        aggregatable: numeric(column.dataType),
        aggFuncs: numeric(column.dataType) ? [...AGGREGATION_FUNCS] : undefined,
        allowFormula: formulaColumns.has(column.key) || undefined,
      })),
      capabilities: {
        ...base.capabilities,
        grouping: true,
        pivot: true,
        aggregation: { funcs: [...AGGREGATION_FUNCS] },
      },
    };
  }

  /**
   * Restores the enterprise view state from `modules.enterprise` (if present),
   * then applies the core slices via {@link ApexGrid.setState}. Enterprise
   * structure (grouping / pivot) is set first so the transformed view is in
   * place before the core pass resolves row-referencing slices.
   */
  public override setState(
    state: Partial<GridState>,
    options?: SetStateOptions<T>
  ): SetStateResult {
    const enterprise = state.modules?.enterprise as EnterpriseStateBlob | undefined;
    if (enterprise) {
      if (enterprise.groupBy !== undefined) this.groupBy = [...enterprise.groupBy];
      if (enterprise.aggregations !== undefined) this.aggregations = { ...enterprise.aggregations };
      if (enterprise.pivotOn !== undefined) this.pivotOn = enterprise.pivotOn;
      if (enterprise.pivotRows !== undefined) this.pivotRows = [...enterprise.pivotRows];
      if (enterprise.pivotValues !== undefined) this.pivotValues = { ...enterprise.pivotValues };
      // Group-collapse overrides before the core pass: they must be in place when
      // the pipeline rebuilds the (restored) group structure.
      if (enterprise.groupExpand !== undefined) {
        this.#groupingController()?.restoreExpandOverrides(enterprise.groupExpand);
      }
    }

    const result = super.setState(state, options);

    // Ranges last: their bounds are view coordinates into the freshly-restored
    // columns / rows, so resolve them against the post-restore view.
    if (enterprise?.ranges !== undefined) {
      this.#rangeController()?.restoreRanges(enterprise.ranges);
    }

    // Formulas resolve their durable row references against the current data and
    // recompute on restore.
    if (enterprise?.formulas !== undefined) {
      this.#restoreFormulas(enterprise.formulas);
    }

    return result;
  }

  /** Resolve persisted formula row references against `data` and restore them. */
  #restoreFormulas(formulas: ReadonlyArray<FormulaStateEntry>): void {
    const controller = this.#formulaController();
    if (!controller) {
      return;
    }
    const entries: Array<{ row: T; columnKey: string; src: string }> = [];
    for (const entry of formulas) {
      const [row] = resolveRowRefs([entry.row], this.data, this.rowId);
      if (row) {
        entries.push({ row, columnKey: entry.column, src: entry.src });
      }
    }
    controller.restoreFormulas(entries);
  }

  /**
   * Run a natural-language `prompt` against the grid.
   *
   * Works out of the box via the built-in deterministic rule engine (no LLM, no
   * key, no network). Set {@link aiReasoner} to add an LLM escalation path for
   * requests the rule engine cannot map.
   *
   * - **`'control'` (default):** the planned tool calls are validated and applied
   *   via {@link setState}; the result carries an `undo()` that restores the prior
   *   snapshot.
   * - **`'ask'`:** a read-only answer about the current view / data; no mutation.
   *
   * AI Toolkit is an enterprise feature.
   *
   * @example
   * ```ts
   * const result = await grid.runPrompt('sort by price, highest first');
   * if (result.mode === 'control') result.undo(); // one-click revert
   * ```
   */
  public async runPrompt(prompt: string, options?: RunPromptOptions): Promise<AIResult> {
    return (await this.#ensureAIEngine()).runPrompt(prompt, options);
  }

  /**
   * Dry-run a prompt: return the {@link Plan} the reasoner would execute, without
   * applying it. The natural primitive for a confirm-before-apply UI.
   */
  public async previewPrompt(prompt: string, options?: RunPromptOptions): Promise<Plan> {
    return (await this.#ensureAIEngine()).previewPrompt(prompt, options);
  }

  /**
   * The AI engine to drive: an explicitly assigned {@link aiEngine}, otherwise a
   * cached default engine, rebuilt when {@link aiReasoner} changes so a set reasoner
   * takes effect while preserving conversation memory across calls otherwise.
   *
   * The engine's runtime is loaded on demand (dynamic `import`) so a grid that never
   * runs a prompt never bundles the AI layer.
   */
  async #ensureAIEngine(): Promise<AIEngine<T>> {
    if (this.aiEngine) return this.aiEngine;
    if (!this.#aiEngine || this.#aiEngineReasoner !== this.aiReasoner) {
      const [{ createAIEngine }, { gridApiFor }, { createRuleBasedReasoner }] = await Promise.all([
        import('./features/ai/engine.js'),
        import('./features/ai/grid-api.js'),
        import('./features/ai/reasoner.js'),
      ]);
      const reasoners = this.aiReasoner
        ? [createRuleBasedReasoner(), this.aiReasoner]
        : [createRuleBasedReasoner()];
      this.#aiEngine = createAIEngine<T>(gridApiFor(this), { reasoners });
      this.#aiEngineReasoner = this.aiReasoner;
    }
    return this.#aiEngine;
  }

  protected override willUpdate(changed: PropertyValues): void {
    // Sync feature config to the controllers *before* super.willUpdate runs the
    // `@watch('data')` handler, so the initial dataState reflects the config on
    // first paint. Pivot runs first since it disables grouping when active.
    this.#syncPivot(changed);
    this.#syncGrouping(changed);
    this.#syncRange(changed);
    this.#syncContextMenu(changed);
    this.#syncMasterDetail(changed);
    this.#syncInfiniteRowModel(changed);
    this.#syncServerSideRowModel(changed);
    this.#injectFormulaEditors(changed);
    this.#syncFormulaCoordinates(changed);
    this.#injectFormulaDisplays(changed);
    // A new `data` array is a content change the value-blind structural view signature would miss;
    // bump the epoch so a view-bound chart redraws on it. In-place cell edits are covered by the
    // `cellValueChanged` listener wired in connectedCallback.
    if (changed.has('data')) this.#dataEpoch += 1;
    super.willUpdate(changed);
  }

  /** Mirror the `contextMenu` toggle/config onto the controller. */
  #syncContextMenu(changed: PropertyValues): void {
    if (!changed.has('contextMenu')) return;
    const controller =
      this.stateController.module<ContextMenuController<T>>(CONTEXT_MENU_MODULE_ID);
    if (!controller) return;
    const config = this.contextMenu;
    controller.enabled = config !== false;
    const userItems = config && typeof config === 'object' ? config.items : undefined;
    // Default items, shared by the right-click menu and the header kebab button:
    // the controller's built-ins (sort / pin / hide), the grouping actions when
    // the grouping module is present, and a "Chart range" submenu.
    controller.items =
      userItems ??
      ((target) => [
        ...controller.defaultItems(target),
        ...this.#groupingMenuItems(target),
        this.#chartRangeItem(),
      ]);
  }

  /**
   * Column-grouping entries for the shared column menu (header targets only,
   * and only when the grouping module is registered): group by the column,
   * un-group everything, and expand / collapse all groups once grouped.
   */
  #groupingMenuItems(target: ContextMenuTarget<T>): ContextMenuItem<T>[] {
    const grouping = this.#groupingController();
    if (!grouping || target.kind !== 'header') {
      return [];
    }
    const key = String(target.column.key);
    const items: ContextMenuItem<T>[] = [
      {
        id: 'group-by',
        label: this.localize(
          'contextMenu.groupBy' as GridLocaleKey,
          undefined,
          'Group by this column'
        ),
        separatorBefore: true,
        disabled: this.groupBy.includes(key),
        run: () => {
          if (!this.groupBy.includes(key)) {
            this.groupBy = [...this.groupBy, key];
          }
        },
      },
    ];
    if (this.groupBy.length) {
      items.push(
        {
          id: 'ungroup-all',
          label: this.localize(
            'contextMenu.ungroupAll' as GridLocaleKey,
            undefined,
            'Un-group all'
          ),
          run: () => {
            this.groupBy = [];
          },
        },
        {
          id: 'expand-groups',
          label: this.localize(
            'contextMenu.expandGroups' as GridLocaleKey,
            undefined,
            'Expand all groups'
          ),
          run: () => grouping.expandAllGroups(),
        },
        {
          id: 'collapse-groups',
          label: this.localize(
            'contextMenu.collapseGroups' as GridLocaleKey,
            undefined,
            'Collapse all groups'
          ),
          run: () => grouping.collapseAllGroups(),
        }
      );
    }
    return items;
  }

  /**
   * The "Chart ▸ [type]" submenu entry. While grouping/pivot is active it charts the **view**
   * (labelled "Chart this view" — a first-class entry point for a pivot/group chart); otherwise it
   * charts the current cell-range **selection** ("Chart range").
   */
  #chartRangeItem(): ContextMenuItem<T> {
    const types: ReadonlyArray<{ type: ChartType | 'auto'; label: string }> = [
      { type: 'column', label: 'Column' },
      { type: 'bar', label: 'Bar' },
      { type: 'line', label: 'Line' },
      { type: 'area', label: 'Area' },
      { type: 'pie', label: 'Pie' },
      { type: 'donut', label: 'Donut' },
      { type: 'combo', label: 'Combo' },
      { type: 'auto', label: 'Auto' },
    ];
    const viewMode = this.groupBy.length > 0 || this.#pivotActive;
    // View charts read the group/pivot model (leave source at its default); range charts snapshot
    // the active selection.
    const source: ChartSource | undefined = viewMode ? undefined : 'selection';
    return {
      id: 'chart-range',
      label: viewMode
        ? this.localize('chart.chartView', undefined, 'Chart this view')
        : this.localize('chart.chartRange'),
      separatorBefore: true,
      submenu: types.map(({ type, label }) => ({
        id: `chart-${type}`,
        label: this.localize(`chart.type.${type}` as GridLocaleKey, undefined, label),
        run: () => this.#openChartDialog({ source, type }),
      })),
    };
  }

  /** Create/tear down the infinite row-model manager when the config changes. */
  #syncInfiniteRowModel(changed: PropertyValues): void {
    if (!changed.has('infiniteRowModel')) return;
    this.#infiniteManager?.stop();
    if (this.infiniteRowModel) {
      this.#infiniteManager = new InfiniteRowModelManager<T>(
        this.infiniteRowModel,
        this as unknown as InfiniteHost<T>
      );
      // Start after render so the body virtualizer exists to attach to.
      this.#infiniteNeedsStart = true;
    } else {
      this.#infiniteManager = null;
    }
  }

  /** Create/tear down the server-side (grouping) row-model manager on config change. */
  #syncServerSideRowModel(changed: PropertyValues): void {
    if (!changed.has('serverSideRowModel')) return;
    this.#ssrmManager?.stop();
    if (this.serverSideRowModel) {
      // Server owns shaping — client grouping / pivot must be off.
      this.groupBy = [];
      this.pivotOn = '';
      this.#ssrmManager = new ServerSideRowModelManager<T>(
        this.serverSideRowModel,
        this as unknown as ServerSideHost<T>
      );
      this.#ssrmNeedsStart = true;
    } else {
      this.#ssrmManager = null;
    }
  }

  /** Last editing state seen by `updated`, to sync the chart affordance on change. */
  #wasEditing = false;

  protected override updated(): void {
    super.updated();
    if (this.#infiniteManager && this.#infiniteNeedsStart) {
      this.#infiniteNeedsStart = false;
      this.#infiniteManager.start();
    }
    if (this.#ssrmManager && this.#ssrmNeedsStart) {
      this.#ssrmNeedsStart = false;
      this.#ssrmManager.start();
    }
    // Idempotent — binds the virtualizer's rangeChanged once it's rendered.
    this.#infiniteManager?.attach();
    // SSRM only attaches a range listener when intra-group pagination is on.
    this.#ssrmManager?.attach();
    this.#emitViewChanged();
    // Entering/leaving edit mode re-renders the grid but fires no range event,
    // so sync the selection-chart affordance here (it hides while editing).
    const editing = this.editingCell !== null || this.editingRow !== null;
    if (editing !== this.#wasEditing) {
      this.#wasEditing = editing;
      this.#updateChartAffordance();
    }
  }

  /**
   * Fire {@link VIEW_CHANGED_EVENT} when the rendered view actually changed
   * (columns, row count, grouping, pivot, sort, or filter), so `<apex-grid-chart>`
   * (and future dashboards) can live-redraw. A view-bound chart must track sort and
   * filter too: sorting keeps the row count identical, and a filter can preserve it,
   * so the signature folds in a compact sort/filter/quick-filter fingerprint rather
   * than relying on row count alone. Gated on the signature so it does not fire on
   * every render.
   */
  #viewSignature = '';
  /** Bumped on a `data` array swap or a cell edit, so a value change (invisible to the structural
   * signature) still moves it and re-signals view-bound charts. */
  #dataEpoch = 0;

  #emitViewChanged(): void {
    const sortSig = this.sortExpressions
      .map((expression) => `${String(expression.key)}:${expression.direction}`)
      .join(',');
    const filterSig = this.filterExpressions
      .map((expression) => {
        const condition = expression.condition as { name?: string } | string | undefined;
        const operand = typeof condition === 'string' ? condition : (condition?.name ?? '');
        const criteria =
          expression.criteria === undefined ? '' : JSON.stringify(expression.criteria);
        return `${String(expression.key)}:${operand}:${String(expression.searchTerm ?? '')}:${criteria}`;
      })
      .join(';');
    const signature = [
      this.columns.length,
      this.pageItems.length,
      this.groupBy.join(','),
      this.pivotOn,
      this.#pivotActive ? '1' : '0',
      sortSig,
      filterSig,
      this.quickFilter ?? '',
      this.#dataEpoch,
    ].join('|');
    if (signature === this.#viewSignature) return;
    this.#viewSignature = signature;
    this.dispatchEvent(new CustomEvent(VIEW_CHANGED_EVENT, { bubbles: true, composed: true }));
  }

  /** Whether a row is an unloaded placeholder (infinite row model or paginated SSRM group). */
  public isRowLoading(row: T): boolean {
    return (
      (this.#infiniteManager?.isPlaceholder(row) ?? false) ||
      (this.#ssrmManager?.isPlaceholder(row) ?? false)
    );
  }

  /** Discard the infinite-model cache and refetch from the top. */
  public refreshRows(): void {
    this.#infiniteManager?.refresh();
  }

  /** Whether the server-side (grouping) row model is active. */
  public get isServerSideRowModel(): boolean {
    return this.#ssrmManager !== null;
  }

  /** Discard the server-side tree and reload from the top level. */
  public refreshServerSide(): void {
    this.#ssrmManager?.refresh();
  }

  /** Expand a server-side group by its value path (lazily loads its children). */
  public expandServerGroup(path: string[]): void {
    this.#ssrmManager?.expand(path);
  }

  /** Collapse a server-side group by its value path. */
  public collapseServerGroup(path: string[]): void {
    this.#ssrmManager?.collapse(path);
  }

  /** Wire the declarative master/detail config onto the grid's expansion. */
  #syncMasterDetail(changed: PropertyValues): void {
    if (!changed.has('masterDetail')) return;
    if (this.masterDetail) {
      this.#masterDetailManager = new MasterDetailManager<T>(this.masterDetail, () =>
        this.requestUpdate()
      );
      this.expansion = this.#masterDetailManager.buildExpansion();
    } else {
      this.#masterDetailManager = null;
    }
  }

  /** Drop a master row's cached detail grid so it rebuilds on next expand. */
  public refreshDetail(row: T): void {
    this.#masterDetailManager?.invalidate(row);
    this.requestUpdate();
  }

  /** Mirror the `rangeSelection` toggle onto the controller; clear when off. */
  #syncRange(changed: PropertyValues): void {
    if (!changed.has('rangeSelection')) return;
    const range = this.#rangeController();
    if (!range) return;
    range.enabled = this.rangeSelection;
    if (!this.rangeSelection) range.clearSelection();
  }

  /**
   * Activate/deactivate pivoting. On activate it saves the current columns, swaps
   * in the generated pivot columns, disables grouping, and re-runs the pipeline;
   * on deactivate it restores the saved columns. Recomputes columns when the data
   * changes while pivoting (distinct column-dimension values may differ).
   */
  #syncPivot(changed: PropertyValues): void {
    const configChanged =
      changed.has('pivotOn') ||
      changed.has('pivotRows') ||
      changed.has('pivotValues') ||
      changed.has('pivotOptions');
    if (!configChanged && !(changed.has('data') && this.#pivotActive)) return;

    const pivot = this.#pivotController();
    if (!pivot) return;

    const on = Array.isArray(this.pivotOn)
      ? this.pivotOn.filter(Boolean)
      : this.pivotOn
        ? [this.pivotOn]
        : [];
    const shouldActivate =
      on.length > 0 && this.pivotRows.length > 0 && Object.keys(this.pivotValues).length > 0;

    if (shouldActivate) {
      pivot.rows = this.pivotRows;
      pivot.on = on;
      pivot.values = this.pivotValues;
      pivot.options = this.pivotOptions ?? {};
      if (!this.#pivotActive) {
        this.#savedColumns = this.columns;
        this.#savedColumnGroups = this.columnGroups;
        this.#pivotActive = true;
      }
      // Pivot and row grouping are mutually exclusive — pivot wins.
      const grouping = this.#groupingController();
      if (grouping) grouping.groupBy = [];
      this.groupBy = [];
      // Carry width / pin state across a re-pivot for keys that survive.
      this.columns = pivot.computeColumns(this.data, this.#pivotActive ? this.columns : undefined);
      this.columnGroups = pivot.computeColumnGroups();
      this.requestUpdate(PIPELINE);
    } else if (this.#pivotActive) {
      this.#deactivatePivot();
    }
  }

  /** Turn pivoting off and restore the pre-pivot columns + column groups. */
  #deactivatePivot(): void {
    const pivot = this.#pivotController();
    if (pivot) pivot.on = [];
    this.#pivotActive = false;
    if (this.#savedColumns) this.columns = this.#savedColumns;
    this.columnGroups = this.#savedColumnGroups;
    this.#savedColumns = null;
    this.#savedColumnGroups = undefined;
    this.requestUpdate(PIPELINE);
  }

  #syncGrouping(changed: PropertyValues): void {
    if (!(changed.has('groupBy') || changed.has('groupingOptions') || changed.has('aggregations')))
      return;
    // Requesting a grouping switches off any active pivot (mutually exclusive).
    if (this.groupBy.length > 0 && this.#pivotActive) {
      this.#deactivatePivot();
      this.pivotOn = '';
    }
    const grouping = this.#groupingController();
    if (!grouping) return;
    grouping.groupBy = this.groupBy;
    grouping.aggregations = this.aggregations;
    if (this.groupingOptions?.defaultExpanded !== undefined) {
      grouping.defaultExpanded = this.groupingOptions.defaultExpanded;
    }
    this.requestUpdate(PIPELINE);
  }

  /**
   * Set a spreadsheet formula on a cell (enterprise formula module). The source
   * may start with `=`; the computed result becomes the cell value and any
   * dependent cells recompute. No-op if the formula module is not enabled or the
   * row is not in {@link ApexGrid.data}.
   *
   * @example
   * ```ts
   * grid.setFormula(grid.data[0], 'total', '=B1*C1');
   * ```
   */
  public setFormula(row: T, columnKey: keyof T & string, formula: string): void {
    this.#formulaController()?.setFormula(row, columnKey, formula);
  }

  /** The formula source stored on a cell, or `undefined` if it holds a literal. */
  public getFormula(row: T, columnKey: keyof T & string): string | undefined {
    return this.#formulaController()?.getFormula(row, columnKey);
  }

  /** Remove a cell's formula; its dependents recompute against the literal left behind. */
  public clearFormula(row: T, columnKey: keyof T & string): void {
    this.#formulaController()?.clearFormula(row, columnKey);
  }

  /** Recompute every stored formula (e.g. after mutating data in place). */
  public recalculateFormulas(): void {
    this.#formulaController()?.recalculate();
  }

  /**
   * Register a custom formula function (upper-cased) for this grid, callable from
   * formulas as `NAME(args)`.
   *
   * @example
   * ```ts
   * grid.registerFormulaFunction('TAX', (args) =>
   *   typeof args[0] === 'number' ? args[0] * 0.2 : 0
   * );
   * ```
   */
  public registerFormulaFunction(name: string, fn: FormulaFn): void {
    this.#formulaController()?.registerFormulaFunction(name, fn);
  }

  #groupingController(): GroupingController<T> | undefined {
    return this.stateController.module<GroupingController<T>>(GROUPING_MODULE_ID);
  }

  #pivotController(): PivotController<T> | undefined {
    return this.stateController.module<PivotController<T>>(PIVOT_MODULE_ID);
  }

  #rangeController(): RangeSelectionController<T> | undefined {
    return this.stateController.module<RangeSelectionController<T>>(RANGE_SELECTION_MODULE_ID);
  }

  #formulaController(): FormulaController<T> | undefined {
    return this.stateController.module<FormulaController<T>>(FORMULA_MODULE_ID);
  }

  /**
   * Give every `allowFormula` + `editable` column the formula cell editor,
   * unless the user supplied their own `editorTemplate`. Idempotent: once a
   * column has an `editorTemplate` it is left alone, so re-running over the
   * rewritten columns is a no-op and never loops.
   */
  #injectFormulaEditors(changed: PropertyValues): void {
    if (!changed.has('columns')) {
      return;
    }
    const controller = this.#formulaController();
    if (!controller) {
      return;
    }
    let injected = false;
    const next = this.columns.map((column) => {
      if (column.allowFormula && column.editable && !column.editorTemplate) {
        injected = true;
        return { ...column, editorTemplate: formulaEditorTemplate(controller) };
      }
      return column;
    });
    if (injected) {
      this.columns = next;
    }
  }

  /** One-time guard so the formula-coordinate default is applied only once. */
  #formulaCoordsApplied = false;

  /**
   * When the grid has `allowFormula` columns, show spreadsheet coordinates (the
   * row-number gutter + the column-letter header chips) by DEFAULT. Reserving
   * the gutter up front means entering a formula never shifts the layout (the
   * gutter would otherwise pop in on the first edit, nudging every column). Done
   * once, the first time formula columns are present; an explicit
   * `coordinateHints` the app sets afterwards is left untouched.
   */
  #syncFormulaCoordinates(changed: PropertyValues): void {
    if (this.#formulaCoordsApplied || !changed.has('columns')) {
      return;
    }
    if (this.columns.some((column) => column.allowFormula)) {
      this.#formulaCoordsApplied = true;
      this.coordinateHints = true;
    }
  }

  /**
   * Reflect {@link showFormulas} into the `allowFormula` columns: when on, give
   * each a display `cellTemplate` that renders the stored formula source (or the
   * value when a cell has none); when off, strip the template we injected. The
   * injected template is tagged so toggling is reversible and a user-supplied
   * `cellTemplate` is never touched.
   */
  #injectFormulaDisplays(changed: PropertyValues): void {
    if (!changed.has('showFormulas') && !changed.has('columns')) {
      return;
    }
    const controller = this.#formulaController();
    if (!controller) {
      return;
    }
    let mutated = false;
    const next = this.columns.map((column) => {
      const injected = isFormulaDisplay(column.cellTemplate);
      if (this.showFormulas && column.allowFormula && (!column.cellTemplate || injected)) {
        if (injected) {
          return column; // already showing formulas
        }
        mutated = true;
        return { ...column, cellTemplate: formulaDisplayTemplate(controller) };
      }
      if (injected) {
        mutated = true;
        const { cellTemplate, ...rest } = column;
        return rest as typeof column;
      }
      return column;
    });
    if (mutated) {
      this.columns = next;
    }
  }

  /**
   * Programmatically select a rectangular cell range by row index + column key
   * (anchor → focus). `to` defaults to `from`. Useful for restoring state or
   * driving the selection from app code.
   */
  public selectRange(
    from: { row: number; column: string },
    to?: { row: number; column: string }
  ): void {
    this.#rangeController()?.selectRange(from, to);
  }

  /** Bounds of the active cell range selection (view coordinates), or `null`. */
  public getSelectionBounds(): RangeBounds | null {
    return this.#rangeController()?.getSelectionBounds() ?? null;
  }

  /** Every selected rectangle (Ctrl-click ranges + the active one). */
  public getSelectionRanges(): RangeBounds[] {
    return this.#rangeController()?.getRanges() ?? [];
  }

  /**
   * Fill from the active range toward the given cell (row + column key) — the
   * programmatic form of dragging the fill handle. Numeric source lines
   * extrapolate a series; everything else tiles the source.
   */
  public fillTo(to: { row: number; column: string }): void {
    this.#rangeController()?.fillTo(to);
  }

  /**
   * Paste a TSV block into the grid starting at the active range's top-left,
   * expanding the selection to cover it (values coerced to column type).
   */
  public pasteText(text: string): void {
    this.#rangeController()?.pasteText(text);
  }

  /** Aggregate statistics (count/sum/avg/min/max) over the selected range. */
  public getSelectionStats(): RangeStats {
    return (
      this.#rangeController()?.getSelectionStats() ?? {
        count: 0,
        numericCount: 0,
        sum: 0,
        average: 0,
        min: 0,
        max: 0,
      }
    );
  }

  /** The selected range serialized as TSV (tab-separated, Excel-pasteable). */
  public getSelectionTSV(): string {
    return this.#rangeController()?.getSelectionTSV() ?? '';
  }

  /** Copy the selected range to the clipboard as TSV. */
  public copySelection(): Promise<boolean> {
    return this.#rangeController()?.copySelection() ?? Promise.resolve(false);
  }

  /**
   * Clear the current cell range selection. Named distinctly from the inherited
   * {@link ApexGrid.clearSelection} (which clears selected rows).
   */
  public clearRangeSelection(): void {
    this.#rangeController()?.clearSelection();
  }

  /** Expand a single group by its key (see {@link GroupRowMeta.key}). */
  public expandGroup(key: string): void {
    this.#groupingController()?.expandGroup(key);
  }

  /** Collapse a single group by its key. */
  public collapseGroup(key: string): void {
    this.#groupingController()?.collapseGroup(key);
  }

  /** Toggle a single group's expansion by its key. */
  public toggleGroup(key: string): void {
    this.#groupingController()?.toggleGroup(key);
  }

  /** Expand every group. */
  public expandAllGroups(): void {
    this.#groupingController()?.expandAllGroups();
  }

  /** Collapse every group. */
  public collapseAllGroups(): void {
    this.#groupingController()?.collapseAllGroups();
  }

  /** The group headers (with counts + aggregates) from the latest pipeline pass. */
  public getGroups(): GroupRowMeta<T>[] {
    return this.#groupingController()?.getGroups() ?? [];
  }

  /**
   * Build a chart-ready model from the current view. Dispatches by intent:
   * - **Cell range selected (non-empty):** the range model (see {@link getRangeChartModel}) wins.
   * - **Grouping active:** categories = top-level group labels; one series per
   *   `aggregations` measure×fn.
   * - **Pivot active:** categories = pivot row labels; one series per generated
   *   pivot value column.
   * - **None of the above:** empty model.
   *
   * An optional {@link ChartDefinition} steers the range and flat-view paths (category, measures,
   * per-series aggregation); the grouping/pivot paths use their own configured aggregations.
   */
  public getChartModel(definition?: ChartDefinition): ChartModel {
    const range = this.getRangeChartModel(definition);
    if (range.series.length > 0) return range;
    return this.getViewChartModel(definition);
  }

  /**
   * Build a chart-ready model from the **grouping or pivot view** (ignoring any cell range
   * selection). The selection-independent half of {@link getChartModel}; `<apex-grid-chart>` uses
   * it for `source="view"`.
   * - **Grouping active:** categories = top-level group labels; one series per `aggregations`
   *   measure×fn.
   * - **Pivot active:** categories = pivot row labels; one series per generated pivot value column.
   * - **Flat grid:** the whole current view (all `pageItems`, in view order) charted via
   *   {@link buildCategoryModel} — first non-numeric visible column is the category axis, every
   *   numeric column a series, repeated categories summed. This is what makes a docked
   *   `source="view"` chart a live companion: sorting, filtering, and edits flow straight through.
   *   An optional {@link ChartDefinition} overrides the category, measures, and aggregation here.
   * - **No rows:** empty model.
   */
  public getViewChartModel(definition?: ChartDefinition): ChartModel {
    if (this.groupBy.length > 0) {
      const groups = (this.#groupingController()?.getGroups() ?? []).filter((g) => g.depth === 0);
      const categories = groups.map((group) => group.label);
      const series: ChartSeries[] = [];
      for (const [measure, fns] of Object.entries(this.aggregations)) {
        for (const fn of fns) {
          series.push({
            name: `${measure} ${fn}`,
            data: groups.map((group) => group.aggregates[measure]?.[fn] ?? 0),
          });
        }
      }
      return { categories, series };
    }

    if (this.#pivotActive) {
      const rows = this.pageItems as ReadonlyArray<Record<string, unknown>>;
      const categories = rows.map((row) =>
        this.pivotRows.map((field) => String(row[field])).join(' / ')
      );
      const valueCols = this.columns.filter((column) => String(column.key).startsWith('pivot::'));
      const series: ChartSeries[] = valueCols.map((column) => ({
        name: column.headerText ?? String(column.key),
        data: rows.map((row) => Number(row[String(column.key)]) || 0),
      }));
      return { categories, series };
    }

    // Flat grid: chart the full current view. Visible columns in display order, values read from
    // the (sorted/filtered) pageItems, so every grid operation is reflected on the next redraw.
    const columns = getDisplayColumns(this.columns).filter((column) => !column.hidden);
    const items = this.pageItems as ReadonlyArray<Record<string, unknown>>;
    if (columns.length === 0 || items.length === 0) return { categories: [], series: [] };
    const rows = items.map((record) => columns.map((column) => record[String(column.key)]));
    return buildCategoryModel(columns, rows, definition);
  }

  /**
   * The chartable columns of the current flat view — key, label, and whether the column is numeric —
   * for driving a mapping UI (`<apex-grid-chart>`'s Data popover). Category candidates are all
   * columns; measure candidates are the numeric ones. Reflects the visible columns and the current
   * (sorted/filtered) rows; empty while grouping/pivot is active (those views carry their own
   * aggregation and ignore a {@link ChartDefinition}).
   */
  public getChartFields(): ChartField[] {
    if (this.groupBy.length > 0 || this.#pivotActive) return [];
    const columns = getDisplayColumns(this.columns).filter((column) => !column.hidden);
    const items = this.pageItems as ReadonlyArray<Record<string, unknown>>;
    const rows = items.map((record) => columns.map((column) => record[String(column.key)]));
    const numeric = detectNumericColumns(columns, rows);
    return columns.map((column, c) => ({
      key: String(column.key),
      label: getColumnLabel(column),
      numeric: numeric[c],
    }));
  }

  /**
   * Build a chart-ready model from the **active cell range selection** (the Excel-style
   * "select cells → chart" path). Orientation: the first non-numeric column in the range is the
   * category axis; every numeric column becomes a series (named by its header). When the range is
   * all-numeric, row positions (1, 2, 3, …) are the categories and every column is a series.
   *
   * When the category column has **repeated values** (e.g. a `department` column with several rows
   * per department) the rows are grouped by category and each series is aggregated per category
   * (summed by default), so the chart shows one bar/point per distinct category instead of one per
   * row. A category axis of already-distinct values (or all-numeric row positions) is charted
   * row-for-row. An optional {@link ChartDefinition} overrides the category, measures, and
   * aggregation.
   *
   * Returns an empty model when there is no selection or no numeric series. Uses the active
   * (primary) range under a multi-range selection.
   */
  public getRangeChartModel(definition?: ChartDefinition): ChartModel {
    const active = this.#rangeController()?.getActiveGrid();
    if (!active || active.rows.length === 0) return { categories: [], series: [] };
    return buildCategoryModel(active.columns, active.rows, definition);
  }

  /**
   * Build a **cross-filter** chart model: the category column from the active selection (first
   * non-numeric column), aggregated over the grid's **full, unfiltered** `data`, summing the first
   * numeric column (or counting rows). Reading the full data keeps every category present, so a
   * chart-driven filter highlights a category instead of collapsing the chart. Returns the
   * `categoryKey` so the caller knows which column to filter. Empty when no category column.
   */
  public getCrossFilterModel(): { categoryKey: string | null; model: ChartModel } {
    const active = this.#rangeController()?.getActiveGrid();
    const empty = { categoryKey: null, model: { categories: [], series: [] } };
    if (!active) return empty;
    const categoryCol = active.columns.find((column) => column.type !== 'number');
    const valueCol = active.columns.find((column) => column.type === 'number');
    if (!categoryCol) return empty;

    const categoryKey = String(categoryCol.key);
    const valueKey = valueCol ? String(valueCol.key) : null;
    const totals = new Map<string, number>();
    for (const row of this.data as ReadonlyArray<Record<string, unknown>>) {
      const category = String(row[categoryKey] ?? '');
      const amount = valueKey ? (toNumber(row[valueKey]) ?? 0) : 1;
      totals.set(category, (totals.get(category) ?? 0) + amount);
    }
    const categories = [...totals.keys()];
    const series: ChartSeries[] = [
      {
        name: valueCol ? getColumnLabel(valueCol) : this.localize('chart.countSeries'),
        data: categories.map((c) => totals.get(c) ?? 0),
      },
    ];
    return { categoryKey, model: { categories, series } };
  }

  /**
   * Render the current {@link getChartModel} into a (light-DOM) container using
   * ApexCharts and return the instance. ApexCharts is dynamically imported.
   */
  public renderChart(container: HTMLElement, options?: RenderChartOptions) {
    return renderApexChart(container, this.getChartModel(), options);
  }

  /**
   * Render the active cell range ({@link getRangeChartModel}) into a (light-DOM) container using
   * ApexCharts and return the instance. ApexCharts is dynamically imported.
   */
  public createRangeChart(container: HTMLElement, options?: RenderChartOptions) {
    return renderApexChart(container, this.getRangeChartModel(), options);
  }

  /** Every open floating chart dialog. A collection (not a singleton) so charts are independent. */
  #chartDialogs = new Set<ApexGridChart>();

  /**
   * Adds a "Create chart" button to the toolbar (on top of the community grid's none). Clicking it
   * opens a floating `<apex-grid-chart mode="dialog">` bound to this grid. Requires
   * `<apex-grid-chart>` to be registered (the `/define` entry does so).
   */
  public override get toolbarActions(): ReadonlyArray<ToolbarAction> {
    return [
      ...super.toolbarActions,
      {
        id: 'create-chart',
        label: this.localize('toolbar.createChart'),
        run: () => this.#openChartDialog(),
      },
      {
        id: 'ask-ai',
        label: this.localize('toolbar.askAI'),
        run: () => this.#openAIDialog(),
      },
    ];
  }

  #aiDialog: ApexGridAI | null = null;

  /**
   * Adds an "Ask AI" button to the toolbar. Clicking it opens a floating
   * `<apex-grid-ai mode="dialog">` bound to this grid, which drives
   * {@link runPrompt} (the built-in rule engine, plus any {@link aiReasoner}).
   * Requires `<apex-grid-ai>` to be registered (the `/define` entry does so).
   */
  #openAIDialog(): void {
    if (!this.#aiDialog) {
      // createElement by tag (not an import) keeps the grid free of a runtime
      // dependency on the element, so it tree-shakes when a consumer never asks.
      const ai = document.createElement('apex-grid-ai') as ApexGridAI;
      ai.mode = 'dialog';
      ai.grid = this as unknown as ApexGridEnterprise<Record<string, unknown>>;
      ai.addEventListener('apex-ai-closed', () => {
        ai.remove();
        this.#aiDialog = null;
      });
      document.body.appendChild(ai);
      this.#aiDialog = ai;
    }
    this.#aiDialog.show();
  }

  /**
   * Open a new floating `<apex-grid-chart mode="dialog">`. Each call mints an **independent** chart
   * (the dialogs are a collection, not a singleton) and cascades it so it doesn't cover the last.
   * The chart is a **snapshot** of the current model at creation — the selected range for
   * `source: 'selection'`, otherwise the auto model — so several charts of different slices can
   * coexist without one mutating the others. Requires `<apex-grid-chart>` to be registered (the
   * `/define` entry does so).
   */
  #openChartDialog(options: { source?: ChartSource; type?: ChartType | 'auto' } = {}): void {
    // createElement by tag (not an import) keeps the grid free of a runtime dependency on the
    // chart element, so it tree-shakes when a consumer never charts.
    const chart = document.createElement('apex-grid-chart') as ApexGridChart;
    chart.mode = 'dialog';
    chart.grid = this as unknown as ApexGridEnterprise<Record<string, unknown>>;
    // Cascade each new dialog by its position in the open set.
    chart.style.setProperty('--chart-cascade', String(this.#chartDialogs.size));
    if (options.type) chart.type = options.type;
    if (options.source) chart.source = options.source;
    // Freeze the current model so this chart is independent of later selection / data changes.
    chart.staticModel =
      options.source === 'selection' ? this.getRangeChartModel() : this.getChartModel();
    chart.addEventListener('apex-chart-closed', () => {
      chart.remove();
      this.#chartDialogs.delete(chart);
    });
    document.body.appendChild(chart);
    this.#chartDialogs.add(chart);
    chart.show();
  }

  /**
   * Adds XLSX (Excel) export to the community grid's CSV-only menu. Excel
   * export is an enterprise feature; CSV stays in the community package.
   */
  public override get exportFormats(): ReadonlyArray<ExportFormat> {
    return [...super.exportFormats, { id: 'xlsx', label: this.localize('toolbar.exportXlsx') }];
  }

  public override exportAs(formatId: string, options: ExportOptions<T> = {}): void {
    if (formatId === 'xlsx') {
      this.exportToXLSX(options as XLSXExportOptions<T>);
      return;
    }
    super.exportAs(formatId, options);
  }

  /**
   * CSV export with the enterprise `formulas` option: when set, `allowFormula`
   * cells export their formula source (`=A1*B1`) rather than the computed value.
   * Otherwise identical to the community {@link ApexGrid.exportToCSV}.
   */
  public override exportToCSV(options: CSVExportOptions<T> & FormulaExportOptions = {}): string {
    return super.exportToCSV(this.#withFormulaFormatter(options));
  }

  /**
   * When `options.formulas` is set, return a copy of the options whose
   * `formatter` emits each formula cell's source; cells without a formula fall
   * back to the user's formatter or the default formatting (via
   * {@link resolveExportValue} over the original options). A no-op when the
   * option is off or no formula module is registered.
   */
  #withFormulaFormatter<O extends ExportOptions<T>>(options: O & FormulaExportOptions): O {
    const controller = this.#formulaController();
    if (!options.formulas || !controller) {
      return options;
    }
    const base = options; // keeps any user-supplied formatter for non-formula cells
    const formatter = (
      column: ColumnConfiguration<T>,
      _value: unknown,
      row: T
    ): ExportCellValue => {
      if (column.allowFormula) {
        const src = controller.getFormula(row, column.key as keyof T & string);
        if (src !== undefined) {
          return src;
        }
      }
      return resolveExportValue(column, row, base);
    };
    return { ...options, formatter } as O;
  }

  /**
   * Exports the current grid contents as an `.xlsx` workbook and (in a browser
   * context) triggers a download.
   *
   * @remarks
   * Produces a single-sheet workbook with a bold header row. Numbers, booleans
   * and `Date` values keep their native cell type in Excel; everything else is
   * written as inline strings. Shares the same `source` / `columns` /
   * `formatter` options as the community grid's `exportToCSV`, plus an optional
   * `sheetName`. Pass `filename: ''` to skip the download and only receive the
   * bytes back.
   *
   * @example
   * ```ts
   * grid.exportToXLSX();
   * grid.exportToXLSX({ filename: 'users', sheetName: 'Users' });
   * ```
   */
  public exportToXLSX(options: XLSXExportOptions<T> & FormulaExportOptions = {}): Uint8Array {
    const opts = this.#withFormulaFormatter(options);
    const columns = resolveExportColumns(this, opts);
    const rows = resolveExportRows(this, opts.source);
    const includeHeader = opts.includeHeader ?? true;
    const bytes = buildXLSX({
      name: opts.sheetName ?? 'Sheet1',
      headers: includeHeader ? columns.map((column) => getColumnLabel(column)) : [],
      rows: rows.map((row) => columns.map((column) => resolveExportValue(column, row, opts))),
    });
    const filename = opts.filename;
    if (filename) {
      downloadBlob(`${filename}.xlsx`, bytes, XLSX_MIME);
    } else if (filename === undefined) {
      downloadBlob('data.xlsx', bytes, XLSX_MIME);
    }
    return bytes;
  }

  protected override createStateController(): StateController<T> {
    const modules = [...ApexGridEnterprise.#modules.values()] as ReadonlyArray<
      GridFeatureModule<T>
    >;
    return new StateController<T>(this, modules);
  }

  protected override render() {
    return html`${super.render()}${this.#renderWatermark()}`;
  }

  #renderWatermark() {
    if (LicenseManager.isLicenseValid()) {
      return nothing;
    }
    return html`<div part="license-watermark" aria-hidden="true" style=${WATERMARK_STYLE}></div>`;
  }
}
