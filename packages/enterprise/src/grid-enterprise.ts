import { LicenseManager, Watermark } from 'apex-commons';
import type {
  ApexCellContext,
  ColumnConfiguration,
  ColumnGroupConfiguration,
  CSVExportOptions,
  DataPipelineConfiguration,
  ExportCellValue,
  GetStateOptions,
  GridExpansionConfiguration,
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
  formatDisplayText,
  type GridFeatureModule,
  getColumnLabel,
  getColumnTypeRenderer,
  getDisplayColumns,
  PIPELINE,
  type RowRef,
  registerComponent,
  resolveExportColumns,
  resolveExportRows,
  resolveExportValue,
  resolveRowRefs,
  StateController,
  type ToolbarAction,
} from 'apex-grid/internal';
import { html, type PropertyValues } from 'lit';
import { property } from 'lit/decorators.js';
import type { ApexGridAI } from './ai-panel.js';
import type { ApexGridChart, ChartSource } from './chart-panel.js';
import {
  type AdvancedFilterModel,
  copyAdvancedFilter,
  filterRows,
  isNumericType,
} from './features/advanced-filter.js';
import {
  AGGREGATION_MODULE_ID,
  type AggregationConfig,
  type AggregationController,
  type AggregationFn,
  type AggregationResults,
  aggregateNumbers,
  toFiniteNumber,
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
import { carryGridTheme } from './features/carry-theme.js';
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
import { ChartRangeManager } from './features/chart-range.js';
import {
  CONTEXT_MENU_MODULE_ID,
  type ContextMenuConfig,
  type ContextMenuController,
  type ContextMenuItem,
  type ContextMenuTarget,
} from './features/context-menu.js';
import type { FormulaFn } from './features/formula/functions.js';
import { columnLetterToIndex } from './features/formula/refs.js';
// The store, not the formula barrel: only the module id is a value here, so
// the formula engine and its cell editor ship only with formulaModule.
import {
  FORMULA_MODULE_ID,
  type FormulaController,
  type FormulaRestoreEntry,
} from './features/formula/store.js';
import {
  GROUPING_MODULE_ID,
  type GroupingController,
  type GroupRowMeta,
  readGroupExpansion,
} from './features/grouping.js';
import {
  type InfiniteHost,
  type InfiniteRowModelConfig,
  InfiniteRowModelManager,
  serverQueryKey,
} from './features/infinite-row-model.js';
import { type MasterDetailConfig, MasterDetailManager } from './features/master-detail.js';
import {
  getPivotMeta,
  PIVOT_GROUP_KEY,
  PIVOT_MODULE_ID,
  type PivotController,
  type PivotOptions,
} from './features/pivot.js';
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
import {
  TOTAL_ROW_MODULE_ID,
  type TotalRowConfig,
  type TotalRowController,
} from './features/total-row.js';
import { buildXLSX, type XLSXCell, type XLSXExportOptions } from './features/xlsx.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The panel elements the toolbar opens, named by tag so the grid does not import them. */
const CHART_PANEL = 'apex-grid-chart';
const AI_PANEL = 'apex-grid-ai';

/** Whether a panel element is registered; the toolbar offers only those that are. */
const panelDefined = (tag: string): boolean =>
  typeof customElements !== 'undefined' && !!customElements.get(tag);

/**
 * Attribute converter for the features that are on by default: the literal
 * `"false"` turns them off, where a plain boolean attribute would read it as
 * on. Any other value turns them on, and removing the attribute turns them
 * off, as with a boolean attribute.
 */
const ON_UNLESS_FALSE = {
  fromAttribute: (value: string | null) => value !== null && value !== 'false',
};

/** Aggregation functions advertised by {@link ApexGridEnterprise.getSchema}. */
const AGGREGATION_FUNCS: AggregationFn[] = ['sum', 'avg', 'min', 'max', 'count'];

/**
 * Per-column numeric test used to orient a chart: a column declared with a numeric type (`number`,
 * `currency`, `rating`, `progress`) is numeric and one declared with any other type but `string`
 * (the default every untyped column gets) is not. A `string` column is numeric when every non-blank
 * value in `rows` parses as a number (and at least one value was seen), so a date column of epoch
 * timestamps or a select of numeric option values stays a category. Column index aligns with `rows`.
 */
function detectNumericColumns<T extends object>(
  columns: ReadonlyArray<ColumnConfiguration<T>>,
  rows: ReadonlyArray<ReadonlyArray<unknown>>
): boolean[] {
  return columns.map((column, c) => {
    if (isNumericType(column.type)) return true;
    if (column.type && column.type !== 'string') return false;
    let sawValue = false;
    for (const row of rows) {
      const value = row[c];
      if (value === null || value === undefined || value === '') continue;
      sawValue = true;
      if (toFiniteNumber(value) === null) return false;
    }
    return sawValue;
  });
}

/**
 * Build a category/series {@link ChartModel} from a labeled grid: `columns` (in display order) and
 * `rows` of row-major cell values. By default the first non-numeric column is the **category axis**
 * and every numeric column becomes a **series** (named by its header); a {@link ChartDefinition}
 * overrides the category, the measure set, and the aggregation. Numeric columns are told apart by
 * {@link detectNumericColumns}.
 *
 * Category labels are the text the grid shows for the cell (CSV export's text: a date in the
 * column's style, a select option's label), and `blank` for an empty cell. Rows are grouped by
 * label (first-seen order) and each measure is aggregated per category: `sum` by default, or
 * `avg`/`count`/`min`/`max`/`median` (one function for all series or a per-measure map). Cells that
 * are not finite numbers are skipped, as the grid's own group aggregates skip them. With
 * already-distinct labels each group holds one row, so the default reproduces the row-for-row
 * chart. An all-numeric grid uses row positions (1, 2, 3, ...) as categories. Returns an empty model
 * when there is no series to plot.
 *
 * Shared by {@link ApexGridEnterprise.getRangeChartModel} (cell-range selection) and the flat-grid
 * branch of {@link ApexGridEnterprise.getViewChartModel} (the view-bound companion chart).
 */
function buildCategoryModel<T extends object>(
  columns: ReadonlyArray<ColumnConfiguration<T>>,
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  definition: ChartDefinition = {},
  blank = ''
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
  const labels = rows.map((row, i) => {
    if (catIndex < 0) return String(i + 1);
    const value = row[catIndex];
    return value === null || value === undefined || value === ''
      ? blank
      : formatDisplayText(columns[catIndex], value);
  });

  // Measures: an explicit list (by key, minus the category) or every numeric non-category column.
  const measureIndices =
    definition.measures && definition.measures.length > 0
      ? definition.measures
          .map((key) => columns.findIndex((column) => String(column.key) === key))
          .filter((c) => c >= 0 && c !== catIndex)
      : columns.map((_, c) => c).filter((c) => c !== catIndex && numeric[c]);
  if (measureIndices.length === 0) return { categories: [], series: [] };

  // Anything but a known function (a saved or untyped definition) sums, as it always has.
  const aggregationFor = (key: string): ChartAggregation => {
    const agg = definition.aggregation;
    const fn = typeof agg === 'string' ? agg : agg?.[key];
    return fn === 'median' || AGGREGATION_FUNCS.includes(fn as AggregationFn)
      ? (fn as ChartAggregation)
      : 'sum';
  };

  // Group rows by category label (first-seen order).
  const categories: string[] = [];
  const slotOf = new Map<string, number>();
  const slots = labels.map((label) => {
    let slot = slotOf.get(label);
    if (slot === undefined) {
      slot = categories.push(label) - 1;
      slotOf.set(label, slot);
    }
    return slot;
  });

  // One column aggregated per category, computed once and shared by the measure series and the
  // calculated fields that read it.
  const aggregated = new Map<number, number[]>();
  const aggregate = (c: number): number[] => {
    let values = aggregated.get(c);
    if (!values) {
      const buckets: number[][] = categories.map(() => []);
      rows.forEach((row, r) => {
        const value = toFiniteNumber(row[c]);
        if (value !== null) buckets[slots[r]].push(value);
      });
      const fn = aggregationFor(String(columns[c].key));
      values = buckets.map((bucket) => aggregateNumbers(bucket, fn));
      aggregated.set(c, values);
    }
    return values;
  };

  const series: ChartSeries[] = measureIndices.map((c) => ({
    name: getColumnLabel(columns[c]),
    data: aggregate(c),
  }));

  // Calculated-field series, appended after the measure series and evaluated once per category
  // over the aggregates (aggregate-then-evaluate). A field authored in the chart panel carries
  // `refs`, the column key each letter meant then, and reads those columns by key (blank when the
  // source no longer holds one). A field without `refs` letters the numeric non-category columns of
  // this source in order (A, B, ...), the frame the panel's legend shows.
  const fields = definition.calculatedFields ?? [];
  const positional = columns.map((_, c) => c).filter((c) => numeric[c] && c !== catIndex);
  const calculated = fields.flatMap((field) => {
    let frame: number[][];
    if (field.refs && typeof field.refs === 'object') {
      frame = [];
      for (const [letter, key] of Object.entries(field.refs)) {
        const c = columns.findIndex((column) => String(column.key) === key);
        if (/^[A-Z]+$/.test(letter) && c >= 0) frame[columnLetterToIndex(letter)] = aggregate(c);
      }
    } else {
      frame = positional.map(aggregate);
    }
    // A calculated series may carry nulls (a category where the formula errored / was
    // non-finite); ApexCharts renders those as gaps. ChartSeries types data as number[], so cast
    // (matching how the panel's trend/forecast overlays already introduce null gaps).
    return computeCalculatedSeries([field], frame, categories.length) as ChartSeries[];
  });
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
  /**
   * Expansion for groups without an override: `true` (all), `false` (none, as
   * after collapse all), or a depth threshold. Absent in older snapshots, which
   * leave the current default in place.
   */
  groupDefaultExpanded?: boolean | number;
  /**
   * {@link ApexGridEnterprise.pivotOptions}. A `maxValueColumns` of `null`
   * stands for `Infinity` (no cap), which JSON cannot hold.
   */
  pivotOptions?: Omit<PivotOptions, 'maxValueColumns'> & { maxValueColumns?: number | null };
  /** Per-node expand overrides of the expandable pivot tree (node key → expanded). */
  pivotExpand?: Record<string, boolean>;
  /** Range-selection rectangles (view coordinates; round-trip within a session). */
  ranges?: RangeBounds[];
  /** Stored cell formulas (durable across reload when `rowId` is set, else positional). */
  formulas?: FormulaStateEntry[];
  /**
   * The applied advanced filter ({@link ApexGridEnterprise.applyAdvancedFilter}),
   * or `null` when none is. Restored through the same path, so it reaches a
   * server row model as well.
   */
  advancedFilter?: AdvancedFilterModel | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isKeyList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((key) => typeof key === 'string');

const isAggregationConfig = (value: unknown): boolean =>
  isRecord(value) && Object.values(value).every(isKeyList);

/** A group or condition shaped as {@link AdvancedFilterNode} (a condition's value is optional). */
function isFilterNode(node: unknown): boolean {
  if (!isRecord(node)) return false;
  return node.kind === 'condition'
    ? typeof node.column === 'string' &&
        typeof node.operator === 'string' &&
        ['undefined', 'string', 'number', 'boolean'].includes(typeof node.value)
    : node.kind === 'group' &&
        (node.join === 'and' || node.join === 'or') &&
        Array.isArray(node.children) &&
        node.children.every(isFilterNode);
}

/**
 * The shape check of each enterprise snapshot field. `groupExpand` /
 * `groupDefaultExpanded` go through {@link readGroupExpansion}; formula entries
 * are checked one by one. Pivot options only need to be an object: the pivot
 * reads each option defensively, as it does an app's own assignment.
 */
const BLOB_FIELDS: Record<string, (value: unknown) => boolean> = {
  groupBy: isKeyList,
  aggregations: isAggregationConfig,
  pivotOn: (value) => typeof value === 'string' || isKeyList(value),
  pivotRows: isKeyList,
  pivotValues: isAggregationConfig,
  pivotOptions: isRecord,
  // Single-sourced with groupExpand: only a valid record comes back as overrides.
  pivotExpand: (value) => !!readGroupExpansion(undefined, value, () => {}).overrides,
  ranges: Array.isArray,
  formulas: Array.isArray,
  advancedFilter: (value) =>
    value === null || (isRecord(value) && value.kind === 'group' && isFilterNode(value)),
};

/** A persisted cell formula: a durable row reference, the column key, and the source. */
interface FormulaStateEntry {
  row: RowRef;
  column: string;
  src: string;
  /**
   * The data index the formula was saved at, written with an `id` row reference.
   * When the row comes back at another index, its relative references shift by
   * the move, so the formula keeps reading its own row.
   */
  origin?: number;
}

/** Custom-element tag for the enterprise grid. */
export const ENTERPRISE_TAG = 'apex-grid-enterprise';

/**
 * Fired on the grid (bubbles, composed) after its render pipeline settles and the
 * rendered view (columns / row count / grouping / pivot) has changed. The signal
 * `<apex-grid-chart>` listens to for live redraws on group/pivot/data changes.
 */
export const VIEW_CHANGED_EVENT = 'apex-view-changed';

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
 * has none. The source reads left to right (left-aligned, with an `ltr` base
 * direction so an RTL grid does not move the leading `=`) even in right-aligned
 * numeric/currency columns; cells without a formula render as the column type
 * would render them.
 */
function formulaDisplayTemplate<T extends object>(
  controller: FormulaController<T>
): (ctx: ApexCellContext<T>) => unknown {
  const template = (ctx: ApexCellContext<T>): unknown => {
    const src = controller.getFormula(ctx.row.data, ctx.column.key as keyof T & string);
    return src === undefined
      ? (getColumnTypeRenderer<T>(ctx.column.type)?.display?.(ctx as never) ?? ctx.value)
      : html`<span part="formula-source" dir="ltr" style="display:block;width:100%;text-align:left">${src}</span>`;
  };
  (template as { [FORMULA_DISPLAY]?: boolean })[FORMULA_DISPLAY] = true;
  return template;
}

/** Enterprise export option: emit each formula cell's `=...` source instead of its value. */
export interface FormulaExportOptions {
  /**
   * When true, cells holding a formula export it as a spreadsheet reads it,
   * with references pointing at the cells' places in the file (below the
   * header row, in the exported row and column order). XLSX writes them as
   * formula cells that keep the computed value. A formula reading a cell the
   * file leaves out or reorders, or calling a custom function, exports its
   * value. Other cells export normally.
   */
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
 * @fires apex-rows-loaded - Infinite row model: a block arrived, with `{ rowCount, exact, loadedBlocks, blockSize }`.
 * @fires apex-rows-load-failed - Infinite row model: `getRows` rejected, with `{ startRow, endRow, error, retrying }` (`RowsLoadFailedDetail`).
 * @fires apex-server-rows-loaded - Server-side row model: the flattened tree changed, with `{ rows, loadedGroups }`.
 * @fires apex-server-rows-load-failed - Server-side row model: `getRows` rejected, with `{ groupKeys, startRow?, endRow?, error, retrying }` (`ServerRowsLoadFailedDetail`).
 *
 * @csspart license-watermark - Non-interactive diagonal watermark overlay shown when no valid license is set. Painted by `apex-commons`' shared `Watermark`, so it matches the other Apex products; this part stays on the node for styling.
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
   * A **grand-total row** over the whole view: one synthesized row showing the
   * configured aggregations across every data row the view holds, including rows
   * on other pages and inside collapsed groups.
   *
   * Distinct from the per-group aggregates {@link groupBy} renders, which total a
   * group's own leaves. This totals the view, so it answers "what is the sum of
   * this column" without grouping anything, and it follows filtering: a filtered
   * grid totals what it shows. Group-header rows are excluded so their aggregates
   * are not counted twice. `null` (the default) renders nothing.
   *
   * Pivot supplies its own grand total, so this covers the flat and grouped views.
   * The row is not added while a pivot, the server-side row model or the infinite
   * row model is active.
   *
   * @example
   * ```ts
   * grid.totalRow = { aggregations: { salary: ['sum', 'avg'] } };
   * ```
   */
  @property({ attribute: false })
  public totalRow: TotalRowConfig | null = null;

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
  public get groupingOptions(): { defaultExpanded?: boolean | number } {
    return this.#groupingOptions;
  }

  public set groupingOptions(value: { defaultExpanded?: boolean | number }) {
    // Applied on assignment, so the later of this and setState wins. An equal
    // value in a new object (an inline literal passed on every render) leaves
    // expand all and collapse all alone. Lit skips the update when the same
    // object is re-assigned, so a pushed change requests one itself.
    this.#groupingOptions = value;
    if (this.#applyDefaultExpanded()) this.requestUpdate(PIPELINE);
  }

  #groupingOptions: { defaultExpanded?: boolean | number } = {};

  /**
   * The groupingOptions.defaultExpanded last pushed to the controller. Kept as
   * a primitive, not read back from the stored object, so a value changed in
   * place on that object still counts as a change.
   */
  #appliedDefaultExpanded?: boolean | number;

  /** Pushes a changed defaultExpanded to the controller; true when it did. */
  #applyDefaultExpanded(): boolean {
    const next = this.#groupingOptions?.defaultExpanded;
    const grouping = this.#groupingController();
    if (!grouping || next === undefined || next === this.#appliedDefaultExpanded) return false;
    grouping.defaultExpanded = next;
    this.#appliedDefaultExpanded = next;
    return true;
  }

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
   * Any other attribute value leaves it on; removing the attribute turns it off.
   * Pairs with `<apex-grid-status-bar>` for live selection aggregates and with
   * {@link copySelection} for clipboard export.
   */
  @property({ attribute: 'range-selection', converter: ON_UNLESS_FALSE })
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
   * Enabled by default; set `context-menu="false"` (or the property) to turn it
   * off; any other attribute value leaves it on, and removing the attribute
   * turns it off.
   * Assign a {@link ContextMenuConfig} (via property) to replace the items.
   */
  @property({ attribute: 'context-menu', converter: ON_UNLESS_FALSE })
  public contextMenu: boolean | ContextMenuConfig<T> = true;

  /**
   * Declarative master/detail: each expanded master row renders a nested grid
   * of related rows. Setting this configures the grid's {@link expansion}
   * automatically (creating, caching, and populating the child grids), so you
   * don't hand-write a `detailTemplate`. Overrides any manual `expansion`;
   * setting it back to `null` restores the `expansion` it replaced.
   */
  @property({ attribute: false })
  public masterDetail: MasterDetailConfig<T> | null = null;

  #masterDetailManager: MasterDetailManager<T> | null = null;
  /** The expansion config master/detail installed, and the one it replaced (restored on off). */
  #masterDetailExpansion?: GridExpansionConfiguration<T>;
  #expansionBeforeMasterDetail?: GridExpansionConfiguration<T>;

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

  /**
   * The default engine build and the reasoner it was built for. A promise, so
   * prompts sent before the AI chunk loads share one engine and its memory.
   */
  #aiEngineBuild: { reasoner: Reasoner | null; engine: Promise<AIEngine<T>> } | null = null;

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
  /** The app's own `dataPipelineConfiguration`, which `#composePipeline` builds on. */
  #appPipeline: DataPipelineConfiguration<T> | undefined;
  /** The configuration the grid last installed, to tell an app's assignment from its own. */
  #ownPipeline: DataPipelineConfiguration<T> | undefined;
  /** Every hook the grid has installed, so it never passes one off as an app hook. */
  readonly #gridHooks = new WeakSet<object>();

  /** The active advanced filter model, or `null` when none is applied. */
  public get advancedFilterModel(): AdvancedFilterModel | null {
    return this.#advancedFilterModel;
  }

  /**
   * Apply a nested AND/OR advanced filter. On client data it evaluates through
   * the `dataPipelineConfiguration.filter` hook and, while active, owns column
   * filtering (it replaces the built-in filter and any app filter hook).
   * Composes with sort / pagination / grouping / pivoting. Under
   * `infiniteRowModel` or `serverSideRowModel` it is sent to the datasource as
   * `advancedFilterModel` instead, and the rows reload. Call
   * {@link clearAdvancedFilter} to remove it. The grid keeps a copy, so
   * changing `model` afterwards takes effect only on the next apply.
   */
  public applyAdvancedFilter(model: AdvancedFilterModel): void {
    this.#advancedFilterModel = copyAdvancedFilter(model);
    this.#composePipeline();
    this.requestUpdate(PIPELINE);
  }

  /** Remove the advanced filter, restoring any app-provided filter hook. */
  public clearAdvancedFilter(): void {
    if (!this.#advancedFilterModel) return;
    this.#advancedFilterModel = null;
    this.#composePipeline();
    this.requestUpdate(PIPELINE);
  }

  /**
   * Install the one pipeline the enterprise features agree on, built on the
   * app's own configuration: a running server row model owns sort, filter and
   * quick filter (the server applies them, the advanced filter included);
   * otherwise an advanced filter replaces the app's filter hook; otherwise the
   * app's configuration stands. Every start and stop recomposes from the app's
   * configuration, so no feature puts back a stale snapshot of another.
   */
  #composePipeline(): void {
    const current = this.dataPipelineConfiguration;
    if (current !== this.#ownPipeline) this.#appPipeline = this.#appHooks(current);
    const model = this.#advancedFilterModel;
    let next = this.#infiniteManager?.pipeline ?? this.#ssrmManager?.pipeline;
    if (next) {
      for (const hook of Object.values(next)) if (hook) this.#gridHooks.add(hook);
    } else if (model) {
      // It filters the source rows, so while pivoting it reads the source columns.
      const filter = ({ data }: { data: T[] }) =>
        filterRows(data, model, this.#savedColumns ?? this.columns);
      this.#gridHooks.add(filter);
      next = { ...this.#appPipeline, filter };
    } else {
      next = this.#appPipeline;
    }
    this.#ownPipeline = next ?? undefined;
    if (next !== current) this.dataPipelineConfiguration = next as DataPipelineConfiguration<T>;
  }

  /**
   * An app's new configuration with the grid's own hooks, which it carries over
   * when it spreads an installed configuration (the current one or one it read
   * earlier) into a new object, mapped back to the app hooks they stood in for
   * (or dropped where the app had none).
   */
  #appHooks(config: DataPipelineConfiguration<T> | undefined) {
    if (!config) return config;
    const app = this.#appPipeline as Record<string, unknown> | undefined;
    let changed = false;
    const kept: [string, unknown][] = [];
    for (const [key, hook] of Object.entries(config)) {
      if (typeof hook !== 'function' || !this.#gridHooks.has(hook)) {
        kept.push([key, hook]);
        continue;
      }
      changed = true;
      if (app?.[key] !== undefined) kept.push([key, app[key]]);
    }
    return changed ? (Object.fromEntries(kept) as DataPipelineConfiguration<T>) : config;
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
    ApexGridEnterprise.#refreshAll();
  }

  static #refreshAll(): void {
    for (const grid of ApexGridEnterprise.#instances) {
      grid.requestUpdate();
    }
  }

  static #panelsWatched = false;

  public override connectedCallback(): void {
    super.connectedCallback();
    ApexGridEnterprise.#instances.add(this);
    // A toolbar panel registered after a grid renders adds its button then.
    if (!ApexGridEnterprise.#panelsWatched) {
      ApexGridEnterprise.#panelsWatched = true;
      for (const tag of [CHART_PANEL, AI_PANEL]) {
        customElements.whenDefined(tag).then(ApexGridEnterprise.#refreshAll);
      }
    }
    // A cell edit changes a value without changing the view's shape, so the structural view
    // signature would not move. Bump the data epoch and re-signal so a view-bound chart redraws.
    this.addEventListener('cellValueChanged', this.#onCellValueChanged);
    // On-selection charting: a floating affordance appears over a non-empty range, and Alt+F1
    // charts the selection from the keyboard (Excel-style). RANGE_CHANGED is a custom event not in
    // the grid's typed event map, so listen via the EventTarget interface.
    (this as EventTarget).addEventListener(RANGE_CHANGED_EVENT, this.#updateChartAffordance);
    this.addEventListener('keydown', this.#onChartShortcut);
    window.addEventListener('scroll', this.#onChartViewportChange, true);
    window.addEventListener('resize', this.#onChartViewportChange);
    // A charted range's outline and chart track the rows under it as the view changes.
    (this as EventTarget).addEventListener(VIEW_CHANGED_EVENT, this.#repositionChartRanges);
    this.#watchLicense();
    // `disconnectedCallback` drops the watermark layer and Lit does not re-render on reconnect,
    // so repaint here. Before the first update there is nothing to restore: `updated` paints.
    if (this.hasUpdated) this.#syncWatermark();
    // Bring back the dialogs a detach took off the page (see disconnectedCallback).
    for (const dialog of this.#floatingDialogs()) {
      if (!dialog.isConnected) document.body.appendChild(dialog);
    }
    this.#chartRangeManagerInstance?.reposition();
  }

  /** The open floating chart and Ask AI dialogs this grid owns. */
  #floatingDialogs(): HTMLElement[] {
    return this.#aiDialog ? [...this.#chartDialogs, this.#aiDialog] : [...this.#chartDialogs];
  }

  /** Pending frame for {@link #onChartViewportChange}, so a burst of scroll events costs one. */
  #viewportFrame = 0;

  /** Keep both the selection affordance and any charted-range overlays anchored on scroll/resize. */
  #onChartViewportChange = (): void => {
    if (this.#viewportFrame) return;
    this.#viewportFrame = requestAnimationFrame(() => {
      this.#viewportFrame = 0;
      // Removed before the frame: its affordance is gone and must not come back.
      if (!this.isConnected) return;
      this.#updateChartAffordance();
      if (this.#chartRangesStale) this.#chartRangeManagerInstance?.refresh();
      else this.#chartRangeManagerInstance?.reposition();
      this.#chartRangesStale = false;
    });
  };

  /** Set by a view change: the next frame re-drives the linked charts, not just their outlines. */
  #chartRangesStale = false;

  /**
   * A view change moves other rows under a charted range: re-drive its chart and outline. On the
   * next frame, as a view-bound chart redraws, since the signal can come before the rows settle.
   */
  #repositionChartRanges = (): void => {
    this.#chartRangesStale = true;
    this.#onChartViewportChange();
  };

  #onCellValueChanged = (): void => {
    this.#dataEpoch += 1;
    // A bulk write (applyEdits, paste, fill, undo, a formula recalc) fires one
    // event per cell: the update they share signals the view once in `updated`.
    this.requestUpdate();
  };

  public override disconnectedCallback(): void {
    ApexGridEnterprise.#instances.delete(this);
    // The row-model managers keep running: they hold no document listener, and
    // a moved grid (a keyed reorder, a dashboard drag) must come back with its
    // server pipeline, columns, cache and in-flight blocks intact.
    this.removeEventListener('cellValueChanged', this.#onCellValueChanged);
    (this as EventTarget).removeEventListener(RANGE_CHANGED_EVENT, this.#updateChartAffordance);
    this.removeEventListener('keydown', this.#onChartShortcut);
    window.removeEventListener('scroll', this.#onChartViewportChange, true);
    window.removeEventListener('resize', this.#onChartViewportChange);
    (this as EventTarget).removeEventListener(VIEW_CHANGED_EVENT, this.#repositionChartRanges);
    this.#licenseUnsubscribe?.();
    this.#licenseUnsubscribe = null;
    this.#watermarkLayer?.remove();
    this.#watermarkLayer = null;
    this.#chartAffordance?.remove();
    this.#chartAffordance = null;
    // The floating dialogs and charted-range overlays live on document.body. A same-task move (a
    // keyed reorder, a dashboard drag) leaves them in place; otherwise they leave the page with the
    // grid and come back when it is attached again (a detail grid scrolled out and back), or go
    // with it to garbage collection. Nothing else holds them.
    queueMicrotask(() => {
      if (this.isConnected) return;
      for (const dialog of this.#floatingDialogs()) dialog.remove();
      this.#chartRangeManagerInstance?.reposition();
    });
    super.disconnectedCallback();
  }

  /** The floating "Chart" button shown over a non-empty range selection (lazily created). */
  #chartAffordance: HTMLButtonElement | null = null;

  /**
   * True when the range-selection module has a non-empty active range and
   * `<apex-grid-chart>` is registered to chart it.
   */
  #canChartSelection(): boolean {
    // Scroll handling asks this every frame: stop at the first data row rather than
    // read the range's values (a group header or a total row alone is not chartable).
    const bounds = this.#rangeController()?.getSelectionBounds();
    if (!bounds || !panelDefined(CHART_PANEL)) return false;
    const items = this.pageItems;
    for (let row = Math.max(0, bounds.top); row <= bounds.bottom && row < items.length; row += 1) {
      if (items[row] && this.stateController.isDataRow(items[row])) return true;
    }
    return false;
  }

  /** Alt+F1 charts the current selection (a no-op without one, or without the chart panel). */
  #onChartShortcut = (event: KeyboardEvent): void => {
    if (event.altKey && event.key === 'F1' && this.#canChartSelection()) {
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
    if (!this.#canChartSelection() || editing) {
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
        border: '1px solid var(--_ag-text, #1f2328)',
        background: 'var(--_ag-text, #1f2328)',
        color: 'var(--_ag-surface, #fff)',
        borderRadius: '6px',
        cursor: 'pointer',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.22)',
      });
      button.addEventListener('click', () => this.#openChartDialog({ source: 'selection' }));
      carryGridTheme(this, button);
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
   * state (row grouping, aggregations, pivoting and its options, group and pivot
   * tree expansion, ranges, formulas, and the advanced filter), stored under
   * `modules.enterprise`.
   *
   * @remarks
   * These live as reactive properties on the enterprise grid (the controllers
   * are synced from them), so they are captured here rather than through the
   * per-module {@link SerializableModule} seam.
   */
  public override getState(options?: GetStateOptions<T>): GridState {
    const base = super.getState(options);
    const pivotOptions: EnterpriseStateBlob['pivotOptions'] = { ...this.pivotOptions };
    const cap = pivotOptions.maxValueColumns;
    // JSON has no Infinity (no cap): store it as null. Other non-finite values
    // mean the default, so they are left out.
    if (cap === Number.POSITIVE_INFINITY) pivotOptions.maxValueColumns = null;
    else if (cap != null && !Number.isFinite(cap)) delete pivotOptions.maxValueColumns;
    const filter = this.#advancedFilterModel;
    const enterprise: EnterpriseStateBlob = {
      groupBy: [...this.groupBy],
      aggregations: { ...this.aggregations },
      pivotOn: this.pivotOn,
      pivotRows: [...this.pivotRows],
      pivotValues: { ...this.pivotValues },
      pivotOptions,
      pivotExpand: this.#pivotController()?.getExpandOverrides() ?? {},
      groupExpand: this.#groupingController()?.getExpandOverrides() ?? {},
      groupDefaultExpanded: this.#groupingController()?.defaultExpanded,
      ranges: this.#rangeController()?.getRanges() ?? [],
      formulas: this.#serializeFormulas(options?.rowId ?? this.rowId),
      advancedFilter: filter && copyAdvancedFilter(filter),
    };
    return { ...base, modules: { ...base.modules, enterprise } };
  }

  /**
   * Serialize stored formulas with a durable row reference: the `rowId` in
   * effect for this call (the option, else the grid's), or the data index.
   */
  #serializeFormulas(rowId: ((row: T) => string | number) | undefined): FormulaStateEntry[] {
    return (this.#formulaController()?.listFormulas() ?? []).map(
      ({ row, index, columnKey, src }) =>
        rowId
          ? { row: { id: rowId(row) }, column: columnKey, src, origin: index }
          : { row: { index }, column: columnKey, src }
    );
  }

  /**
   * Extends the core {@link ApexGrid.getSchema} descriptor with the enterprise
   * capabilities this grid's registered modules provide: grouping (columns
   * groupable), pivot (columns pivotable), and aggregation (numeric columns
   * aggregatable, with the supported functions). A grid set up with
   * {@link ApexGridEnterprise.use} without a module does not advertise it.
   */
  public override getSchema(): GridSchema {
    const base = super.getSchema();
    const formulaColumns = new Set(
      this.columns.filter((column) => column.allowFormula).map((column) => String(column.key))
    );
    const grouping = !!this.#groupingController();
    const pivot = !!this.#pivotController();
    // Group header aggregates, pivot values and the aggregation module all take
    // aggregation configs, so any of them offers the functions.
    const aggregation = grouping || pivot || !!this.stateController.module(AGGREGATION_MODULE_ID);
    return {
      ...base,
      columns: base.columns.map((column) => {
        const aggregatable = aggregation && isNumericType(column.dataType);
        return {
          ...column,
          groupable: grouping,
          pivotable: pivot,
          aggregatable,
          aggFuncs: aggregatable ? [...AGGREGATION_FUNCS] : undefined,
          allowFormula: formulaColumns.has(column.key) || undefined,
        };
      }),
      capabilities: {
        ...base.capabilities,
        grouping,
        pivot,
        ...(aggregation && { aggregation: { funcs: [...AGGREGATION_FUNCS] } }),
      },
    };
  }

  /**
   * Restores the enterprise view state from `modules.enterprise` (if present),
   * then applies the core slices via {@link ApexGrid.setState}. Enterprise
   * structure (grouping / pivot) is set first so the transformed view is in
   * place before the core pass resolves row-referencing slices.
   *
   * Keeps the core defensive contract: every enterprise field is checked before
   * anything is applied, a malformed one is skipped with a message in
   * `warnings` (or throws, with `strict`), unresolved formula rows are counted
   * the way core row slices are, and each accepted field whose module is
   * registered is listed in `applied` as `modules.enterprise.<field>`. These
   * dotted names sit next to the core slice names, so an app that maps
   * `applied` back to the core slice keys should skip them.
   */
  public override setState(
    state: Partial<GridState>,
    options?: SetStateOptions<T>
  ): SetStateResult {
    const strict = options?.strict === true;
    const warnings: string[] = [];
    const warn = (message: string): void => {
      if (strict) throw new Error(`[apex-grid] setState: ${message}`);
      warnings.push(message);
    };
    // Validate the whole blob first, so a wrong-typed field is skipped (or
    // throws, in strict mode) without leaving the rest half set.
    const raw = isRecord(state.modules) ? state.modules.enterprise : undefined;
    if (raw !== undefined && !isRecord(raw)) {
      warn(`modules.enterprise: expected an object, got ${typeof raw}; skipped`);
    }
    const blob = isRecord(raw) ? raw : {};
    const valid: Record<string, unknown> = {};
    for (const [field, check] of Object.entries(BLOB_FIELDS)) {
      const value = blob[field];
      if (value === undefined) continue;
      if (check(value)) valid[field] = value;
      else warn(`${field}: malformed; skipped`);
    }
    const enterprise = valid as EnterpriseStateBlob;
    const expansion = readGroupExpansion(blob.groupDefaultExpanded, blob.groupExpand, warn);
    const formulaController = this.#formulaController();
    const formulas =
      enterprise.formulas && formulaController
        ? this.#resolveFormulas(enterprise.formulas, options?.rowId ?? this.rowId, warn)
        : undefined;

    if (enterprise.groupBy) this.groupBy = [...enterprise.groupBy];
    if (enterprise.aggregations) this.aggregations = { ...enterprise.aggregations };
    if (enterprise.pivotOn !== undefined) this.pivotOn = enterprise.pivotOn;
    if (enterprise.pivotRows) this.pivotRows = [...enterprise.pivotRows];
    if (enterprise.pivotValues) this.pivotValues = { ...enterprise.pivotValues };
    if (enterprise.pivotOptions) {
      const next = { ...enterprise.pivotOptions } as PivotOptions;
      if (enterprise.pivotOptions.maxValueColumns === null) {
        next.maxValueColumns = Number.POSITIVE_INFINITY;
      }
      this.pivotOptions = next;
    }
    // Expansion before the core pass: it must be in place when the pipeline
    // rebuilds the (restored) group and pivot structure.
    this.#groupingController()?.restoreExpansion(expansion);
    if (enterprise.pivotExpand) {
      this.#pivotController()?.restoreExpandOverrides(enterprise.pivotExpand);
    }
    // Through the filter builder's own path, so a server row model reloads too.
    if (enterprise.advancedFilter === null) this.clearAdvancedFilter();
    else if (enterprise.advancedFilter) this.applyAdvancedFilter(enterprise.advancedFilter);

    const result = super.setState(state, options);

    // Ranges last: their bounds are view coordinates into the freshly-restored
    // columns / rows, so resolve them against the post-restore view.
    if (enterprise.ranges) this.#rangeController()?.restoreRanges(enterprise.ranges);

    // Formulas recompute on restore. Their rows resolved above, against the
    // same data; entries that do not parse or target a column without
    // `allowFormula` are skipped here (strict throws before any changes).
    if (formulas) {
      for (const { columnKey, src, reason } of formulaController!.restoreFormulas(
        formulas,
        strict
      )) {
        warn(
          `formulas: "${src}" in "${columnKey}" skipped (${reason === 'column' ? 'no allowFormula' : 'invalid'})`
        );
      }
    }

    const fields = Object.keys(valid);
    if (expansion.overrides) fields.push('groupExpand');
    if (expansion.defaultExpanded !== undefined) fields.push('groupDefaultExpanded');
    // Report only what the grid can show: a field whose module is not
    // registered is set but has no effect. The advanced filter is built in.
    const has = (id: string): boolean => !!this.stateController.module(id);
    const grouping = has(GROUPING_MODULE_ID);
    const pivot = has(PIVOT_MODULE_ID);
    const shown = (field: string): boolean =>
      field === 'advancedFilter' ||
      (field.startsWith('group') && grouping) ||
      (field.startsWith('pivot') && pivot) ||
      (field === 'aggregations' && (grouping || has(AGGREGATION_MODULE_ID))) ||
      (field === 'ranges' && has(RANGE_SELECTION_MODULE_ID)) ||
      (field === 'formulas' && !!formulaController);
    result.applied.push(...fields.filter(shown).map((field) => `modules.enterprise.${field}`));
    result.warnings.push(...warnings);
    return result;
  }

  /**
   * Resolve persisted formula row references against the current data. Entries
   * that lack a row, column or source are malformed; entries whose row is gone
   * do not resolve. Both are dropped and counted, one message each, as core row
   * slices report them, through `warn` (which throws in strict mode).
   */
  #resolveFormulas(
    formulas: ReadonlyArray<unknown>,
    rowId: ((row: T) => string | number) | undefined,
    warn: (message: string) => void
  ): FormulaRestoreEntry<T>[] {
    // One id map for every entry (a per-entry resolve rebuilt it per formula).
    const byId = rowId ? new Map(this.data.map((row) => [rowId(row), row])) : null;
    const entries: FormulaRestoreEntry<T>[] = [];
    let malformed = 0;
    for (const entry of formulas as Partial<FormulaStateEntry>[]) {
      const ref = isRecord(entry) ? entry.row : undefined;
      if (!isRecord(ref) || typeof entry.column !== 'string' || typeof entry.src !== 'string') {
        malformed++;
        continue;
      }
      const byIdRef = 'id' in ref;
      const row = byIdRef ? byId?.get(ref.id) : resolveRowRefs([ref], this.data)[0];
      if (row) {
        const origin = byIdRef ? entry.origin : (ref as { index: number }).index;
        entries.push({ row, columnKey: entry.column, src: entry.src, origin });
      }
    }
    if (malformed) warn(`formulas: ${malformed} of ${formulas.length} entries malformed; skipped`);
    const wellFormed = formulas.length - malformed;
    const missed = wellFormed - entries.length;
    if (missed) warn(`formulas: ${missed} of ${wellFormed} row(s) could not be resolved`);
    return entries;
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
  #ensureAIEngine(): Promise<AIEngine<T>> {
    if (this.aiEngine) return Promise.resolve(this.aiEngine);
    const reasoner = this.aiReasoner;
    if (!this.#aiEngineBuild || this.#aiEngineBuild.reasoner !== reasoner) {
      const build = {
        reasoner,
        engine: Promise.all([
          import('./features/ai/engine.js'),
          import('./features/ai/grid-api.js'),
          import('./features/ai/reasoner.js'),
        ]).then(([{ createAIEngine }, { gridApiFor }, { createRuleBasedReasoner }]) =>
          createAIEngine<T>(gridApiFor(this), {
            reasoners: reasoner
              ? [createRuleBasedReasoner(), reasoner]
              : [createRuleBasedReasoner()],
          })
        ),
      };
      // A chunk that failed to load is fetched again on the next prompt.
      build.engine.catch(() => {
        if (this.#aiEngineBuild === build) this.#aiEngineBuild = null;
      });
      this.#aiEngineBuild = build;
    }
    return this.#aiEngineBuild.engine;
  }

  protected override willUpdate(changed: PropertyValues): void {
    // An app assigned its own pipeline: compose the active features over it.
    const pipeline = this.dataPipelineConfiguration;
    if (changed.has('dataPipelineConfiguration') && pipeline !== this.#ownPipeline) {
      this.#composePipeline();
    }
    // Sync feature config to the controllers *before* super.willUpdate runs the
    // `@watch('data')` handler, so the initial dataState reflects the config on
    // first paint. Pivot runs first since it disables grouping when active. The
    // server-side model runs before both: turning it on clears groupBy and
    // pivotOn, which those syncs must see in this same update.
    this.#syncServerSideRowModel(changed);
    this.#syncPivot(changed);
    this.#syncGrouping(changed);
    this.#syncTotalRow(changed);
    this.#syncRange(changed);
    this.#syncContextMenu(changed);
    this.#syncMasterDetail(changed);
    this.#syncInfiniteRowModel(changed);
    this.#injectFormulaEditors(changed);
    this.#syncFormulaCoordinates(changed);
    this.#injectFormulaDisplays(changed);
    // A new `data` array is a content change the value-blind structural view signature would miss;
    // bump the epoch so a view-bound chart redraws on it. In-place cell edits are covered by the
    // `cellValueChanged` listener wired in connectedCallback.
    if (changed.has('data')) this.#dataEpoch += 1;
    if (changed.has('localeText')) this.#aiDialog?.requestUpdate();
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
    // the grouping module is present, and a "Chart range" submenu while
    // <apex-grid-chart> is registered.
    controller.items =
      userItems ??
      ((target) => [
        ...controller.defaultItems(target),
        ...this.#groupingMenuItems(target),
        ...(panelDefined(CHART_PANEL) ? [this.#chartRangeItem()] : []),
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
    this.#composePipeline();
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
    this.#composePipeline();
  }

  /** Last editing state seen by `updated`, to sync the chart affordance on change. */
  #wasEditing = false;

  protected override updated(): void {
    super.updated();
    this.#syncWatermark();
    if (this.#infiniteManager && this.#infiniteNeedsStart) {
      this.#infiniteNeedsStart = false;
      this.#infiniteManager.start();
      this.#composePipeline();
    }
    if (this.#ssrmManager && this.#ssrmNeedsStart) {
      this.#ssrmNeedsStart = false;
      this.#ssrmManager.start();
      this.#composePipeline();
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
   * (visible columns and their order, page, row count, grouping and its
   * aggregations, pivot, sort, or filter), so `<apex-grid-chart>` (and future
   * dashboards) can live-redraw. A view-bound chart must track sort and filter
   * too: sorting keeps the row count identical, and a filter can preserve it,
   * so the signature folds in a compact sort/filter/quick-filter fingerprint
   * rather than relying on row count alone. Gated on the signature so it does
   * not fire on every render, and run once per update, so a bulk write signals
   * once.
   */
  #viewSignature = '';
  /** Bumped on a `data` array swap or a cell edit, so a value change (invisible to the structural
   * signature) still moves it and re-signals view-bound charts. */
  #dataEpoch = 0;

  #emitViewChanged(): void {
    const signature = JSON.stringify([
      this.#visibleColumns().map((column) => column.key),
      this.page,
      this.pageItems.length,
      this.groupBy,
      // Only a grouped view plots the aggregations.
      this.groupBy.length ? this.aggregations : 0,
      this.pivotOn,
      this.#pivotActive,
      serverQueryKey(this),
      this.#dataEpoch,
    ]);
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

  /** Discard the infinite-model cache and refetch from the top, failed blocks included. */
  public refreshRows(): void {
    this.#infiniteManager?.refresh();
  }

  /** Rows of collapsed server-side groups stay cached and come back on expand, so undo keeps them. */
  protected override *historyRecords(): Iterable<T> {
    yield* this.data;
    if (this.#ssrmManager) yield* this.#ssrmManager.cachedRecords();
  }

  /** Whether the server-side (grouping) row model is active. */
  public get isServerSideRowModel(): boolean {
    return this.#ssrmManager !== null;
  }

  /** Discard the server-side tree and reload from the top level, failed blocks included. */
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
    const installed =
      !!this.#masterDetailExpansion && this.expansion === this.#masterDetailExpansion;
    if (this.masterDetail) {
      if (!installed) this.#expansionBeforeMasterDetail = this.expansion;
      this.#masterDetailManager = new MasterDetailManager<T>(this.masterDetail, () =>
        this.requestUpdate()
      );
      this.expansion = this.#masterDetailExpansion = this.#masterDetailManager.buildExpansion();
    } else {
      // Off: put back what master/detail replaced, unless the app has set its own since. Dropping
      // the installed config releases the old manager and its cached detail grids.
      if (installed) this.expansion = this.#expansionBeforeMasterDetail;
      this.#masterDetailManager = null;
      this.#masterDetailExpansion = this.#expansionBeforeMasterDetail = undefined;
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
   * changes while pivoting (distinct column-dimension values may differ), and
   * when the locale changes (generated headers and total labels are localized).
   */
  #syncPivot(changed: PropertyValues): void {
    const configChanged =
      changed.has('pivotOn') ||
      changed.has('pivotRows') ||
      changed.has('pivotValues') ||
      changed.has('pivotOptions');
    const relabel = changed.has('localeText') && this.#pivotActive;
    if (!configChanged && !relabel && !(changed.has('data') && this.#pivotActive)) return;

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
      const repivot = this.#pivotActive;
      if (!repivot) {
        this.#savedColumns = this.columns;
        this.#savedColumnGroups = this.columnGroups;
        this.#pivotActive = true;
      }
      // Pivot and row grouping are mutually exclusive — pivot wins.
      const grouping = this.#groupingController();
      if (grouping) grouping.groupBy = [];
      // A fresh empty array would still count as a groupBy change and request the pipeline again.
      if (this.groupBy.length > 0) this.groupBy = [];
      // Carry width / pin state across a re-pivot for keys that survive; the flat
      // view's columns only lend their header text and format.
      this.columns = pivot.computeColumns(
        this.data,
        repivot ? this.columns : undefined,
        this.#savedColumns ?? undefined
      );
      this.columnGroups = pivot.computeColumnGroups();
      // A data change alone already runs the pipeline from the core data watcher.
      if (configChanged || relabel || !this.hasUpdated) this.requestUpdate(PIPELINE);
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
    // Picks up a defaultExpanded changed in place followed by
    // requestUpdate('groupingOptions'), which never runs the setter.
    if (changed.has('groupingOptions')) this.#applyDefaultExpanded();
    this.requestUpdate(PIPELINE);
  }

  /**
   * Set a spreadsheet formula on a cell (enterprise formula module). The source
   * may start with `=`; the computed result becomes the cell value and any
   * dependent cells recompute. No-op if the formula module is not enabled or the
   * row is not in {@link ApexGrid.data}. Only formulas in `allowFormula` columns
   * are saved by {@link getState}.
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
   * formulas as `NAME(args)`. A name starts with a letter or `_` and goes on
   * with letters, digits, `_` or `.` (`LOG10`, `STDEV.S`); any other name, and
   * `IF`, `TRUE` or `FALSE`, throws a `TypeError` because no formula could call
   * it. A function that throws shows `#VALUE!` in its cell.
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

  #syncTotalRow(changed: PropertyValues): void {
    if (!changed.has('totalRow')) return;
    const controller = this.#totalRowController();
    if (!controller) return;
    controller.config = this.totalRow;
    this.requestUpdate(PIPELINE);
  }

  #totalRowController(): TotalRowController<T> | undefined {
    return this.stateController.module<TotalRowController<T>>(TOTAL_ROW_MODULE_ID);
  }

  /**
   * The grand-total row's computed values from the latest pipeline run, keyed by
   * column then aggregation function. Empty when {@link totalRow} is unset or has
   * no aggregations, and while a pivot, the server-side row model or the infinite
   * row model is active.
   */
  public getTotals() {
    return this.#totalRowController()?.totals ?? {};
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
        return { ...column, editorTemplate: controller.editorTemplate() };
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
   * Fill from the active range toward the given cell (row + column key), the
   * programmatic form of dragging the fill handle. Numeric source lines extend
   * a series in numeric columns (and in untyped or `string` columns whose
   * values are numbers); everything else tiles the source. Writes only cells
   * the user could edit, so it needs `editing.enabled` and an `editable`
   * target column.
   */
  public fillTo(to: { row: number; column: string }): void {
    this.#rangeController()?.fillTo(to);
  }

  /**
   * Paste a TSV block into the grid starting at the active range's top-left,
   * expanding the selection to cover it (values coerced to column type).
   * Writes only cells the user could edit, so it needs `editing.enabled` and
   * an `editable` target column.
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
      // One category per pivot row the data defines: a tree's top-level nodes by their label, or
      // the flat rows by their row fields. Subtotal and grand-total rows would count twice.
      const rows = (this.pageItems as ReadonlyArray<Record<string, unknown>>).filter((row) => {
        const meta = getPivotMeta(row);
        return meta?.key === undefined ? meta?.kind === 'data' : meta.depth === 0;
      });
      const categories = rows.map((row) =>
        getPivotMeta(row)?.key === undefined
          ? this.pivotRows.map((field) => String(row[field])).join(' / ')
          : String(row[PIVOT_GROUP_KEY])
      );
      const valueCols = this.columns.filter((column) => String(column.key).startsWith('pivot::'));
      // A blank cell (an avg, min or max over no values) plots as 0: the model does not
      // know the chart type, and a pie or donut cannot draw a null slice.
      const series: ChartSeries[] = valueCols.map((column) => ({
        name: column.headerText ?? String(column.key),
        data: rows.map((row) => Number(row[String(column.key)]) || 0),
      }));
      return { categories, series };
    }

    // Flat grid: chart the full current view. Visible columns in display order, values read from
    // the (sorted/filtered) pageItems, so every grid operation is reflected on the next redraw.
    const columns = this.#visibleColumns();
    const items = this.#pageRecords();
    if (columns.length === 0 || items.length === 0) return { categories: [], series: [] };
    const rows = items.map((record) => columns.map((column) => record[String(column.key)]));
    return buildCategoryModel(columns, rows, definition, this.localize('grouping.blank'));
  }

  /** The visible columns in display order: what a view chart plots. */
  #visibleColumns(): ColumnConfiguration<T>[] {
    return getDisplayColumns(this.columns).filter((column) => !column.hidden);
  }

  /** The current page's data records, without rows a module synthesized (a total row). */
  #pageRecords(): ReadonlyArray<Record<string, unknown>> {
    return this.stateController.dataRows(this.pageItems) as ReadonlyArray<Record<string, unknown>>;
  }

  /**
   * The chartable columns of a chart source (key, label, and whether the column is numeric) for
   * driving a mapping UI (`<apex-grid-chart>`'s Data popover and its calculated-field letters).
   * Category candidates are all columns; measure candidates are the numeric ones.
   *
   * `source` picks the same columns the model of that source reads: `'view'` (the default) the
   * visible columns over the current (sorted/filtered) rows, empty while grouping/pivot is active
   * (those views carry their own aggregation and ignore a {@link ChartDefinition}); `'selection'`
   * the columns of the active cell range; `'auto'` the range's when the range model wins in
   * {@link getChartModel} for `definition`, else the view's.
   */
  public getChartFields(source: ChartSource = 'view', definition?: ChartDefinition): ChartField[] {
    const range = this.#rangeController()?.getActiveGrid();
    let grid: { columns: ColumnConfiguration<T>[]; rows: ReadonlyArray<ReadonlyArray<unknown>> };
    if (source === 'selection') {
      grid = range ?? { columns: [], rows: [] };
    } else if (
      source === 'auto' &&
      range?.rows.length &&
      buildCategoryModel(range.columns, range.rows, definition).series.length > 0
    ) {
      grid = range;
    } else {
      if (this.groupBy.length > 0 || this.#pivotActive) return [];
      const columns = this.#visibleColumns();
      const rows = this.#pageRecords().map((record) =>
        columns.map((column) => record[String(column.key)])
      );
      grid = { columns, rows };
    }
    const numeric = detectNumericColumns(grid.columns, grid.rows);
    return grid.columns.map((column, c) => ({
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
  public getRangeChartModel(definition?: ChartDefinition, bounds?: RangeBounds): ChartModel {
    const controller = this.#rangeController();
    // An explicit `bounds` (the chart-range handle re-driving a linked chart) wins over the live
    // selection; otherwise chart the active selection exactly as before.
    const grid = bounds ? controller?.gridForBounds(bounds) : controller?.getActiveGrid();
    if (!grid || grid.rows.length === 0) return { categories: [], series: [] };
    return buildCategoryModel(grid.columns, grid.rows, definition, this.localize('grouping.blank'));
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
    // The same orientation rule as the range model: numeric by declared type or by the values.
    // An all-numeric range still needs a column to filter on: its first one.
    const numeric = detectNumericColumns(active.columns, active.rows);
    const categoryCol = active.columns.find((_, c) => !numeric[c]) ?? active.columns[0];
    const valueCol = active.columns.find((column, c) => numeric[c] && column !== categoryCol);
    if (!categoryCol) return empty;

    const categoryKey = String(categoryCol.key);
    const valueKey = valueCol ? String(valueCol.key) : null;
    const totals = new Map<string, number>();
    for (const row of this.data as ReadonlyArray<Record<string, unknown>>) {
      const category = String(row[categoryKey] ?? '');
      const amount = valueKey ? (toFiniteNumber(row[valueKey]) ?? 0) : 1;
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

  /** Manages the in-grid charted-range overlays + resize handles (lazily created). */
  #chartRangeManagerInstance: ChartRangeManager | null = null;
  #chartRangeManager(): ChartRangeManager {
    if (!this.#chartRangeManagerInstance) {
      this.#chartRangeManagerInstance = new ChartRangeManager({
        gridElement: this as unknown as HTMLElement,
        localize: (key, params, fallback) => this.localize(key as GridLocaleKey, params, fallback),
        boundsClientRect: (bounds) => this.#rangeController()?.boundsClientRect(bounds) ?? null,
        cellAtPoint: (x, y) => this.#rangeController()?.cellAtPoint(x, y) ?? null,
        modelForBounds: (bounds, definition) => this.getRangeChartModel(definition, bounds),
        extent: () => ({ rows: this.pageItems.length, cols: this.#visibleColumns().length }),
        announce: (message) => this.announce(message),
      });
    }
    return this.#chartRangeManagerInstance;
  }

  /**
   * Adds "Create chart" and "Ask AI" buttons to the toolbar (on top of the community grid's none),
   * each once its panel element is registered (the `/define` entry registers both). Clicking one
   * opens a floating `<apex-grid-chart mode="dialog">` or `<apex-grid-ai mode="dialog">` bound to
   * this grid.
   */
  public override get toolbarActions(): ReadonlyArray<ToolbarAction> {
    const actions = [...super.toolbarActions];
    if (panelDefined(CHART_PANEL)) {
      actions.push({
        id: 'create-chart',
        label: this.localize('toolbar.createChart'),
        run: () => this.#openChartDialog(),
      });
    }
    if (panelDefined(AI_PANEL)) {
      actions.push({
        id: 'ask-ai',
        label: this.localize('toolbar.askAI'),
        run: () => this.#openAIDialog(),
      });
    }
    return actions;
  }

  #aiDialog: ApexGridAI | null = null;

  /**
   * Adds an "Ask AI" button to the toolbar. Clicking it opens a floating
   * `<apex-grid-ai mode="dialog">` bound to this grid, which drives
   * {@link runPrompt} (the built-in rule engine, plus any {@link aiReasoner}).
   * Requires `<apex-grid-ai>` to be registered (the `/define` entry does so).
   */
  #openAIDialog(): void {
    if (!panelDefined(AI_PANEL)) return;
    if (!this.#aiDialog) {
      // createElement by tag (not an import) keeps the grid free of a runtime
      // dependency on the element, so it tree-shakes when a consumer never asks.
      const ai = document.createElement(AI_PANEL) as ApexGridAI;
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
    if (!panelDefined(CHART_PANEL)) return;
    // createElement by tag (not an import) keeps the grid free of a runtime dependency on the
    // chart element, so it tree-shakes when a consumer never charts.
    const chart = document.createElement(CHART_PANEL) as ApexGridChart;
    chart.mode = 'dialog';
    chart.grid = this as unknown as ApexGridEnterprise<Record<string, unknown>>;
    // Cascade each new dialog by its position in the open set.
    chart.style.setProperty('--chart-cascade', String(this.#chartDialogs.size));
    if (options.type) chart.type = options.type;
    if (options.source) chart.source = options.source;
    // Freeze the current model so this chart is independent of later selection / data changes.
    chart.staticModel =
      options.source === 'selection' ? this.getRangeChartModel() : this.getChartModel();
    // Link the source range so it stays outlined in the grid with a resize handle that live-drives
    // this chart (the in-grid range handle). Only selection charts have a source range to link.
    const linkedBounds =
      options.source === 'selection' ? this.#rangeController()?.getSelectionBounds() : null;
    chart.addEventListener('apex-chart-closed', () => {
      this.#chartRangeManagerInstance?.unlink(chart);
      chart.remove();
      this.#chartDialogs.delete(chart);
    });
    // On the body so the grid never clips it; carry the grid's theme with it.
    carryGridTheme(this, chart);
    document.body.appendChild(chart);
    this.#chartDialogs.add(chart);
    chart.show();
    if (linkedBounds) this.#chartRangeManager().link(chart, linkedBounds);
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
   * cells export their formula source rather than the computed value, with
   * references moved to the file's cells (`=A1*B1` on the first data row is
   * written `=A2*B2` below the header row; see {@link FormulaExportOptions}).
   * Formula sources are written as they are, while headers and every other
   * text cell keep the `escapeFormulas` rule. Otherwise identical to the
   * community {@link ApexGrid.exportToCSV}.
   */
  public override exportToCSV(options: CSVExportOptions<T> & FormulaExportOptions = {}): string {
    const sources =
      options.formulas &&
      this.#formulaSources(
        options,
        resolveExportColumns(this, options),
        resolveExportRows(this, options.source)
      );
    if (!sources) return super.exportToCSV(options);
    // A source comes back as a boxed `String`, which the CSV formula escaping leaves alone, so
    // sources stay raw while headers and other text are escaped.
    const formatter = (
      column: ColumnConfiguration<T>,
      _value: unknown,
      row: T
    ): ExportCellValue => {
      const src = sources(row, String(column.key));
      return src === undefined
        ? resolveExportValue(column, row, options)
        : (new String(src) as unknown as string);
    };
    return super.exportToCSV({ ...options, formatter });
  }

  /**
   * When `options.formulas` is set and the grid holds formulas, a lookup of
   * each formula cell's source in the file's coordinates (see
   * {@link FormulaController.exportSources}); `null` otherwise.
   */
  #formulaSources(
    options: ExportOptions<T> & FormulaExportOptions,
    columns: ReadonlyArray<ColumnConfiguration<T>>,
    rows: ReadonlyArray<T>
  ): ((row: T, key: string) => string | undefined) | null {
    const controller = options.formulas ? this.#formulaController() : undefined;
    return (
      controller?.exportSources(
        rows,
        columns.map((column) => String(column.key)),
        options.includeHeader === false ? 0 : 1
      ) ?? null
    );
  }

  /**
   * Exports the current grid contents as an `.xlsx` workbook and (in a browser
   * context) triggers a download.
   *
   * @remarks
   * Produces a single-sheet workbook with a bold header row. Numbers, booleans
   * and `Date` values keep their native cell type in Excel; everything else is
   * written as inline strings. With `formulas`, formula cells are written as
   * formulas that keep their computed value. Shares the same `source` / `columns` /
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
  public exportToXLSX(opts: XLSXExportOptions<T> & FormulaExportOptions = {}): Uint8Array {
    const columns = resolveExportColumns(this, opts);
    const rows = resolveExportRows(this, opts.source);
    const includeHeader = opts.includeHeader ?? true;
    const sources = this.#formulaSources(opts, columns, rows);
    const bytes = buildXLSX({
      name: opts.sheetName ?? 'Sheet1',
      headers: includeHeader ? columns.map((column) => getColumnLabel(column)) : [],
      rows: rows.map((row) =>
        columns.map((column): XLSXCell => {
          const value = resolveExportValue(column, row, opts);
          const src = sources?.(row, String(column.key));
          return src === undefined ? value : { formula: src.slice(1), value };
        })
      ),
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

  // --- license watermark ---------------------------------------------------

  /**
   * Out-of-flow layer the shared watermark paints into.
   *
   * `Watermark` is an imperative DOM API: it appends a node to a container and
   * needs a real element, which rules out both the light DOM (the grid renders
   * no `<slot>`, so light children are never shown) and the shadow root itself
   * (`getComputedStyle` throws on a `ShadowRoot`). It also has to be
   * `position: absolute`, or the host's `display: grid` would lay it out as an
   * extra grid row and push the real content down.
   *
   * Created once and appended outside Lit's rendered range, so re-renders leave
   * both it and the node inside it alone.
   */
  #watermarkLayer: HTMLElement | null = null;

  /** Unsubscribes the licence listener on disconnect. */
  #licenseUnsubscribe: (() => void) | null = null;

  #watermarkContainer(): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    if (!this.#watermarkLayer?.isConnected) {
      const layer = document.createElement('div');
      layer.style.position = 'absolute';
      layer.style.inset = '0';
      layer.style.pointerEvents = 'none';
      this.renderRoot.appendChild(layer);
      this.#watermarkLayer = layer;
    }
    return this.#watermarkLayer;
  }

  /**
   * Reconcile the watermark with the licence.
   *
   * The pattern, the overlay styles and the tamper-resistant bits all live in
   * `Watermark`, shared with the other Apex products — this used to be a private
   * copy of them. What stays here is the decision and the `license-watermark`
   * part, which is documented API this package has to keep on the node.
   *
   * Driven with `manage: false` rather than letting `Watermark` reconcile
   * internally: its own reconcile paints a *fresh* node, which would arrive
   * without that part and outside any render this component knows about. Doing
   * it here means one decision point, and the part is stamped every time.
   */
  #syncWatermark(): void {
    // A disconnected grid must not paint: `disconnectedCallback` drops the layer,
    // and a licence change arriving afterwards would otherwise rebuild it and
    // re-append to a detached shadow root.
    if (!this.isConnected) return;
    const container = this.#watermarkContainer();
    if (!container) return;
    if (LicenseManager.isLicenseValid()) {
      Watermark.remove(container, { manage: false });
      return;
    }
    const node = Watermark.add(container, { manage: false });
    node?.setAttribute('part', 'license-watermark');
    node?.setAttribute('aria-hidden', 'true');
  }

  /**
   * Signature verification settles a microtask after `setLicense`, and
   * {@link LicenseManager.isLicenseValid} answers synchronously from the
   * structural check until it does. Without this, a forged-but-well-formed key
   * would paint unwatermarked and never be corrected, since nothing would ask
   * again after the verdict flipped.
   */
  #watchLicense(): void {
    this.#licenseUnsubscribe ??= LicenseManager.onChange(() => this.#syncWatermark());
  }
}
