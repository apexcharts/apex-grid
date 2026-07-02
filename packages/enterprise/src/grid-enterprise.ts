import { LicenseManager } from 'apex-commons';
import type {
  ApexCellContext,
  ColumnConfiguration,
  CSVExportOptions,
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
import {
  AGGREGATION_MODULE_ID,
  type AggregationConfig,
  type AggregationController,
  type AggregationFn,
  type AggregationResults,
} from './features/aggregation.js';
import { type AIAdapter, type AIResult, type RunPromptOptions, runPrompt } from './features/ai.js';
import {
  type ChartModel,
  type ChartSeries,
  type ChartType,
  type RenderChartOptions,
  renderApexChart,
} from './features/chart.js';
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
import { PIVOT_MODULE_ID, type PivotController } from './features/pivot.js';
import {
  RANGE_SELECTION_MODULE_ID,
  type RangeBounds,
  type RangeSelectionController,
  type RangeStats,
} from './features/range-selection.js';
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

/**
 * Enterprise view state captured under `modules.enterprise` in a grid snapshot
 * (see {@link ApexGridEnterprise.getState} / {@link ApexGridEnterprise.setState}).
 */
interface EnterpriseStateBlob {
  groupBy?: string[];
  aggregations?: AggregationConfig;
  pivotOn?: string;
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
   * Column-dimension field for pivoting: its distinct values become columns.
   * Empty disables pivoting. Requires {@link pivotRows} and {@link pivotValues}.
   * Pivoting and {@link groupBy} are mutually exclusive (pivot wins).
   */
  @property({ attribute: false })
  public pivotOn = '';

  /** Row-dimension field(s) for pivoting (one leading column each). */
  @property({ attribute: false })
  public pivotRows: string[] = [];

  /** Measures aggregated into each pivot cell, e.g. `{ salary: ['sum'] }`. */
  @property({ attribute: false })
  public pivotValues: AggregationConfig = {};

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
   * Adapter the AI Toolkit calls to turn a natural-language prompt into a grid
   * change (or an answer). Provider-agnostic: assign `createClaudeAdapter(...)`
   * for Anthropic/Claude, `createMockAdapter()` for a no-network demo, or your
   * own `(request) => Promise<{ patch?, answer? }>`. Unset, {@link runPrompt}
   * rejects. The entire AI Toolkit is an enterprise feature.
   */
  public aiAdapter: AIAdapter | null = null;

  #infiniteManager: InfiniteRowModelManager<T> | null = null;
  #infiniteNeedsStart = false;

  /** Columns saved before pivoting activated, restored when it deactivates. */
  #savedColumns: ColumnConfiguration<T>[] | null = null;
  #pivotActive = false;

  public static override get tagName(): string {
    return ENTERPRISE_TAG;
  }

  /** Whether a pivot view is currently active. */
  public get isPivoting(): boolean {
    return this.#pivotActive;
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
  }

  public override disconnectedCallback(): void {
    ApexGridEnterprise.#instances.delete(this);
    this.#infiniteManager?.stop();
    super.disconnectedCallback();
  }

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
   * Run a natural-language `prompt` against the grid via {@link aiAdapter}.
   *
   * - **`'control'` (default):** the adapter returns a state patch, which is
   *   validated against {@link getSchema}, applied via {@link setState}, and made
   *   reversible: the result carries an `undo()` that restores the prior snapshot.
   * - **`'ask'`:** the adapter returns a text answer about the current view; the
   *   grid is not mutated.
   *
   * Rejects when no {@link aiAdapter} is set. AI Toolkit is an enterprise feature.
   *
   * @example
   * ```ts
   * grid.aiAdapter = createMockAdapter();
   * const result = await grid.runPrompt('sort by price, highest first');
   * if (result.mode === 'control') result.undo(); // one-click revert
   * ```
   */
  public runPrompt(prompt: string, options?: RunPromptOptions): Promise<AIResult> {
    return runPrompt(this, prompt, options);
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
    this.#injectFormulaEditors(changed);
    this.#syncFormulaCoordinates(changed);
    this.#injectFormulaDisplays(changed);
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

  /** The "Chart range ▸ [type]" submenu entry, opening the dialog on the current selection. */
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
    return {
      id: 'chart-range',
      label: this.localize('chart.chartRange'),
      separatorBefore: true,
      submenu: types.map(({ type, label }) => ({
        id: `chart-${type}`,
        label: this.localize(`chart.type.${type}` as GridLocaleKey, undefined, label),
        run: () => this.#openChartDialog({ source: 'selection', type }),
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

  protected override updated(): void {
    super.updated();
    if (this.#infiniteManager && this.#infiniteNeedsStart) {
      this.#infiniteNeedsStart = false;
      this.#infiniteManager.start();
    }
    // Idempotent — binds the virtualizer's rangeChanged once it's rendered.
    this.#infiniteManager?.attach();
    this.#emitViewChanged();
  }

  /**
   * Fire {@link VIEW_CHANGED_EVENT} when the rendered view actually changed
   * (columns, row count, grouping, or pivot), so `<apex-grid-chart>` (and future
   * dashboards) can live-redraw on group/pivot/data changes — which, unlike
   * header-click sort/filter, emit no `sorted`/`filtered` event. Gated on a cheap
   * signature so it does not fire on every render.
   */
  #viewSignature = '';

  #emitViewChanged(): void {
    const signature = [
      this.columns.length,
      this.pageItems.length,
      this.groupBy.join(','),
      this.pivotOn,
      this.#pivotActive ? '1' : '0',
    ].join('|');
    if (signature === this.#viewSignature) return;
    this.#viewSignature = signature;
    this.dispatchEvent(new CustomEvent(VIEW_CHANGED_EVENT, { bubbles: true, composed: true }));
  }

  /** Whether a row is an unloaded placeholder under the infinite row model. */
  public isRowLoading(row: T): boolean {
    return this.#infiniteManager?.isPlaceholder(row) ?? false;
  }

  /** Discard the infinite-model cache and refetch from the top. */
  public refreshRows(): void {
    this.#infiniteManager?.refresh();
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
      changed.has('pivotOn') || changed.has('pivotRows') || changed.has('pivotValues');
    if (!configChanged && !(changed.has('data') && this.#pivotActive)) return;

    const pivot = this.#pivotController();
    if (!pivot) return;

    const shouldActivate =
      this.pivotOn !== '' && this.pivotRows.length > 0 && Object.keys(this.pivotValues).length > 0;

    if (shouldActivate) {
      pivot.rows = this.pivotRows;
      pivot.on = this.pivotOn;
      pivot.values = this.pivotValues;
      if (!this.#pivotActive) {
        this.#savedColumns = this.columns;
        this.#pivotActive = true;
      }
      // Pivot and row grouping are mutually exclusive — pivot wins.
      const grouping = this.#groupingController();
      if (grouping) grouping.groupBy = [];
      this.groupBy = [];
      this.columns = pivot.computeColumns(this.data);
      this.requestUpdate(PIPELINE);
    } else if (this.#pivotActive) {
      this.#deactivatePivot();
    }
  }

  /** Turn pivoting off and restore the pre-pivot columns. */
  #deactivatePivot(): void {
    const pivot = this.#pivotController();
    if (pivot) pivot.on = '';
    this.#pivotActive = false;
    if (this.#savedColumns) this.columns = this.#savedColumns;
    this.#savedColumns = null;
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
   */
  public getChartModel(): ChartModel {
    const range = this.getRangeChartModel();
    if (range.series.length > 0) return range;
    return this.getViewChartModel();
  }

  /**
   * Build a chart-ready model from the **grouping or pivot view** (ignoring any cell range
   * selection). The selection-independent half of {@link getChartModel}; `<apex-grid-chart>` uses
   * it for `source="view"`.
   * - **Grouping active:** categories = top-level group labels; one series per `aggregations`
   *   measure×fn.
   * - **Pivot active:** categories = pivot row labels; one series per generated pivot value column.
   * - **Neither:** empty model.
   */
  public getViewChartModel(): ChartModel {
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

    return { categories: [], series: [] };
  }

  /**
   * Build a chart-ready model from the **active cell range selection** (the Excel-style
   * "select cells → chart" path). Orientation: the first non-numeric column in the range is the
   * category axis; every numeric column becomes a series (named by its header). When the range is
   * all-numeric, row positions (1, 2, 3, …) are the categories and every column is a series.
   *
   * When the category column has **repeated values** (e.g. a `department` column with several rows
   * per department) the rows are grouped by category and each series is **summed** per category, so
   * the chart shows one bar/point per distinct category instead of one per row. A category axis of
   * already-distinct values (or all-numeric row positions) is charted row-for-row.
   *
   * Returns an empty model when there is no selection or no numeric series. Uses the active
   * (primary) range under a multi-range selection.
   */
  public getRangeChartModel(): ChartModel {
    const active = this.#rangeController()?.getActiveGrid();
    if (!active || active.rows.length === 0) return { categories: [], series: [] };
    const { columns, rows } = active;

    // A column is numeric if declared `type: 'number'` or every non-blank cell parses to a finite
    // number (and there is at least one value to judge by).
    const numeric = columns.map((column, c) => {
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

    const catIndex = numeric.findIndex((isNumeric) => !isNumeric);
    const labels =
      catIndex >= 0
        ? rows.map((row) => String(row[catIndex] ?? ''))
        : rows.map((_, i) => String(i + 1));

    const valueColumns = columns.filter((_, c) => c !== catIndex && numeric[c]);
    if (valueColumns.length === 0) return { categories: [], series: [] };

    const perRow: ChartSeries[] = [];
    columns.forEach((column, c) => {
      if (c === catIndex || !numeric[c]) return;
      perRow.push({
        name: getColumnLabel(column),
        data: rows.map((row) => toNumber(row[c]) ?? 0),
      });
    });

    // Distinct labels → chart row-for-row. Repeats (only possible with a real category column) →
    // group by category and sum each series, preserving first-seen category order.
    const hasRepeats = catIndex >= 0 && new Set(labels).size !== labels.length;
    if (!hasRepeats) return { categories: labels, series: perRow };

    const categories: string[] = [];
    const index = new Map<string, number>();
    const sums = perRow.map(() => [] as number[]);
    labels.forEach((label, r) => {
      let slot = index.get(label);
      if (slot === undefined) {
        slot = categories.length;
        index.set(label, slot);
        categories.push(label);
        for (const sum of sums) sum[slot] = 0;
      }
      perRow.forEach((s, si) => {
        sums[si][slot as number] += s.data[r];
      });
    });
    const series = perRow.map((s, si) => ({ name: s.name, data: sums[si] }));
    return { categories, series };
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

  #chartDialog: ApexGridChart | null = null;

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
   * {@link runPrompt} via the configured {@link aiAdapter}. Requires
   * `<apex-grid-ai>` to be registered (the `/define` entry does so).
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

  #openChartDialog(options: { source?: ChartSource; type?: ChartType | 'auto' } = {}): void {
    if (!this.#chartDialog) {
      // createElement by tag (not an import) keeps the grid free of a runtime dependency on the
      // chart element, so it tree-shakes when a consumer never charts.
      const chart = document.createElement('apex-grid-chart') as ApexGridChart;
      chart.mode = 'dialog';
      chart.grid = this as unknown as ApexGridEnterprise<Record<string, unknown>>;
      chart.addEventListener('apex-chart-closed', () => {
        chart.remove();
        this.#chartDialog = null;
      });
      document.body.appendChild(chart);
      this.#chartDialog = chart;
    }
    if (options.source) this.#chartDialog.source = options.source;
    if (options.type) this.#chartDialog.type = options.type;
    this.#chartDialog.show();
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
