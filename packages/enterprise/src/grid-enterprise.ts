import { LicenseManager } from 'apex-commons';
import type { ColumnConfiguration } from 'apex-grid';
import {
  ApexGrid,
  downloadBlob,
  type ExportFormat,
  type ExportOptions,
  type GridFeatureModule,
  getColumnLabel,
  PIPELINE,
  registerComponent,
  resolveExportColumns,
  resolveExportRows,
  resolveExportValue,
  StateController,
} from 'apex-grid/internal';
import { html, nothing, type PropertyValues } from 'lit';
import { property } from 'lit/decorators.js';
import {
  AGGREGATION_MODULE_ID,
  type AggregationConfig,
  type AggregationController,
  type AggregationResults,
  aggregationModule,
} from './features/aggregation.js';
import {
  type ChartModel,
  type ChartSeries,
  type RenderChartOptions,
  renderApexChart,
} from './features/chart.js';
import {
  GROUPING_MODULE_ID,
  type GroupingController,
  type GroupRowMeta,
  groupingModule,
} from './features/grouping.js';
import {
  type InfiniteHost,
  type InfiniteRowModelConfig,
  InfiniteRowModelManager,
} from './features/infinite-row-model.js';
import { type MasterDetailConfig, MasterDetailManager } from './features/master-detail.js';
import { PIVOT_MODULE_ID, type PivotController, pivotModule } from './features/pivot.js';
import {
  RANGE_SELECTION_MODULE_ID,
  type RangeBounds,
  type RangeSelectionController,
  type RangeStats,
  rangeSelectionModule,
} from './features/range-selection.js';
import { buildXLSX, type XLSXExportOptions } from './features/xlsx.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Custom-element tag for the enterprise grid. */
export const ENTERPRISE_TAG = 'apex-grid-enterprise';

/**
 * Feature modules layered onto the enterprise grid via the core extension seam.
 * Kept as a module-level constant so it is shared across instances.
 */
const ENTERPRISE_MODULES: ReadonlyArray<GridFeatureModule> = [
  aggregationModule,
  groupingModule,
  pivotModule,
  rangeSelectionModule,
];

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

  protected override willUpdate(changed: PropertyValues): void {
    // Sync feature config to the controllers *before* super.willUpdate runs the
    // `@watch('data')` handler, so the initial dataState reflects the config on
    // first paint. Pivot runs first since it disables grouping when active.
    this.#syncPivot(changed);
    this.#syncGrouping(changed);
    this.#syncRange(changed);
    this.#syncMasterDetail(changed);
    this.#syncInfiniteRowModel(changed);
    super.willUpdate(changed);
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

  #groupingController(): GroupingController<T> | undefined {
    return this.stateController.module<GroupingController<T>>(GROUPING_MODULE_ID);
  }

  #pivotController(): PivotController<T> | undefined {
    return this.stateController.module<PivotController<T>>(PIVOT_MODULE_ID);
  }

  #rangeController(): RangeSelectionController<T> | undefined {
    return this.stateController.module<RangeSelectionController<T>>(RANGE_SELECTION_MODULE_ID);
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
   * Build a chart-ready model from the current view's aggregates:
   * - **Grouping active:** categories = top-level group labels; one series per
   *   `aggregations` measure×fn.
   * - **Pivot active:** categories = pivot row labels; one series per generated
   *   pivot value column.
   * - **Neither:** empty model.
   */
  public getChartModel(): ChartModel {
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
   * Render the current {@link getChartModel} into a (light-DOM) container using
   * ApexCharts and return the instance. ApexCharts is dynamically imported.
   */
  public renderChart(container: HTMLElement, options?: RenderChartOptions) {
    return renderApexChart(container, this.getChartModel(), options);
  }

  /**
   * Adds XLSX (Excel) export to the community grid's CSV-only menu. Excel
   * export is an enterprise feature; CSV stays in the community package.
   */
  public override get exportFormats(): ReadonlyArray<ExportFormat> {
    return [...super.exportFormats, { id: 'xlsx', label: 'Export XLSX' }];
  }

  public override exportAs(formatId: string, options: ExportOptions<T> = {}): void {
    if (formatId === 'xlsx') {
      this.exportToXLSX(options as XLSXExportOptions<T>);
      return;
    }
    super.exportAs(formatId, options);
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
  public exportToXLSX(options: XLSXExportOptions<T> = {}): Uint8Array {
    const columns = resolveExportColumns(this, options);
    const rows = resolveExportRows(this, options.source);
    const includeHeader = options.includeHeader ?? true;
    const bytes = buildXLSX({
      name: options.sheetName ?? 'Sheet1',
      headers: includeHeader ? columns.map((column) => getColumnLabel(column)) : [],
      rows: rows.map((row) => columns.map((column) => resolveExportValue(column, row, options))),
    });
    const filename = options.filename;
    if (filename) {
      downloadBlob(`${filename}.xlsx`, bytes, XLSX_MIME);
    } else if (filename === undefined) {
      downloadBlob('data.xlsx', bytes, XLSX_MIME);
    }
    return bytes;
  }

  protected override createStateController(): StateController<T> {
    return new StateController<T>(this, ENTERPRISE_MODULES as ReadonlyArray<GridFeatureModule<T>>);
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
