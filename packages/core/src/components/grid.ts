import { ContextProvider } from '@lit/context';
import { html, nothing } from 'lit';
import { eventOptions, property, query, queryAll, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { DataOperationsController } from '../controllers/data-operation.js';
import { GridDOMController } from '../controllers/dom.js';
import { gridStateContext, StateController } from '../controllers/state.js';
import { DEFAULT_COLUMN_CONFIG, PIPELINE } from '../internal/constants.js';
import {
  buildCSV,
  type CSVExportOptions,
  downloadBlob,
  type ExportFormat,
  type ExportOptions,
} from '../internal/export.js';
import { EventEmitterBase } from '../internal/mixins/event-emitter.js';
import { registerComponent } from '../internal/register.js';
import { GRID_TAG } from '../internal/tags.js';
import type {
  ColumnConfiguration,
  DataPipelineConfiguration,
  GridEditingConfiguration,
  GridExpansionConfiguration,
  GridSelectionConfiguration,
  GridSortConfiguration,
  GridTreeConfiguration,
  Keys,
  PaginationConfiguration,
  PaginationState,
  PinPosition,
} from '../internal/types.js';
import {
  asArray,
  autoGenerateColumns,
  getDisplayColumns,
  getFilterOperandsFor,
} from '../internal/utils.js';
import { watch } from '../internal/watch.js';
import type { FilterExpression } from '../operations/filter/types.js';
import type { SortExpression } from '../operations/sort/types.js';
import { styles as gridStyles } from '../styles/grid/grid.css.js';
import ApexGridCell from './cell.js';
import ApexFilterRow from './filter-row.js';
import ApexGridHeaderRow from './header-row.js';
import ApexGridPaginator from './paginator.js';
import ApexGridRow from './row.js';
import ApexGridToolbar from './toolbar.js';
import ApexVirtualizer from './virtualizer.js';

/**
 * Event object for the filtering event of the grid.
 */
export interface ApexFilteringEvent<T extends object> {
  /**
   * The target column for the filter operation.
   */
  key: Keys<T>;

  /**
   * The filter expression(s) to apply.
   */
  expressions: FilterExpression<T>[];

  /**
   * The type of modification which will be applied to the filter
   * state of the column.
   *
   * @remarks
   * `add` - a new filter expression will be added to the state of the column.
   * `modify` - an existing filter expression will be modified.
   * `remove` - the expression(s) will be removed from the state of the column.
   */
  type: 'add' | 'modify' | 'remove';
}

/**
 * Event object for the filtered event of the grid.
 */
export interface ApexFilteredEvent<T extends object> {
  /**
   * The target column for the filter operation.
   */
  key: Keys<T>;

  /**
   * The filter state of the column after the operation.
   */
  state: FilterExpression<T>[];
}

/**
 * Event payload for the cancellable `pageChanging` event.
 */
export interface ApexPageChangingEvent {
  /**
   * The current page (zero-based) before the change.
   */
  page: number;
  /**
   * The current page size before the change.
   */
  pageSize: number;
  /**
   * The proposed page (zero-based) the grid will navigate to.
   */
  nextPage: number;
  /**
   * The proposed page size after the change.
   */
  nextPageSize: number;
}

/**
 * Event payload for the `pageChanged` event. Mirrors {@link PaginationState}.
 */
export interface ApexPageChangedEvent extends PaginationState {}

/**
 * Event payload for the cancellable `quickFilterChanging` event.
 */
export interface ApexQuickFilterChangingEvent {
  /**
   * The current quick-filter value before the change.
   */
  value: string;
  /**
   * The proposed quick-filter value.
   */
  nextValue: string;
}

/**
 * Event payload for the `quickFilterChanged` event.
 */
export interface ApexQuickFilterChangedEvent {
  /**
   * The resolved quick-filter value after the change.
   */
  value: string;
}

/**
 * Drop position relative to a target column when reordering.
 */
export type ColumnDropPosition = 'before' | 'after';

/**
 * Event payload for the cancellable `cellValueChanging` event.
 */
export interface ApexCellValueChangingEvent<T extends object> {
  /**
   * The column key of the edited cell.
   */
  key: Keys<T>;
  /**
   * The view-relative row index (matches {@link ApexGrid.pageItems}).
   */
  rowIndex: number;
  /**
   * The data record being edited (a live reference to the row in
   * {@link ApexGrid.data}).
   */
  data: T;
  /**
   * The value before the edit.
   */
  oldValue: unknown;
  /**
   * The candidate new value.
   */
  newValue: unknown;
}

/**
 * Event payload for the `cellValueChanged` event.
 */
export interface ApexCellValueChangedEvent<T extends object> {
  /**
   * The column key of the edited cell.
   */
  key: Keys<T>;
  /**
   * The view-relative row index after the change.
   */
  rowIndex: number;
  /**
   * The data record after the change (a live reference to the row in
   * {@link ApexGrid.data}).
   */
  data: T;
  /**
   * The applied value.
   */
  value: unknown;
}

/**
 * Event payload for the `rowEditStarted` event.
 */
export interface ApexRowEditStartedEvent {
  /**
   * The view-relative row index entering edit mode.
   */
  rowIndex: number;
}

/**
 * Event payload for the `rowEditEnded` event.
 */
export interface ApexRowEditEndedEvent {
  /**
   * The view-relative row index that left edit mode.
   */
  rowIndex: number;
  /**
   * `true` when pending edits were applied, `false` when discarded.
   */
  committed: boolean;
}

/**
 * Event payload for the cancellable `columnMoving` event.
 */
export interface ApexColumnMovingEvent<T extends object> {
  /**
   * The column being moved.
   */
  key: Keys<T>;
  /**
   * The current index of the moving column in {@link ApexGrid.columns}.
   */
  fromIndex: number;
  /**
   * The target column key. The dragged column will be placed `position`
   * (before/after) this column.
   */
  toKey: Keys<T>;
  /**
   * Whether the dragged column is being placed before or after `toKey`.
   */
  position: ColumnDropPosition;
}

/**
 * Event payload for the `columnMoved` event.
 */
export interface ApexColumnMovedEvent<T extends object> {
  /**
   * The column that was moved.
   */
  key: Keys<T>;
  /**
   * The original index in {@link ApexGrid.columns}.
   */
  fromIndex: number;
  /**
   * The resolved index in {@link ApexGrid.columns} after the move.
   */
  toIndex: number;
}

/**
 * Event payload for the cancellable `rowSelecting` event.
 */
export interface ApexRowSelectingEvent<T extends object> {
  /**
   * The rows that will become selected by this change.
   */
  added: T[];
  /**
   * The rows that will become deselected by this change.
   */
  removed: T[];
  /**
   * The full current selection before this change is applied.
   */
  current: T[];
  /**
   * The full selection after this change would be applied. Listeners can
   * inspect this to decide whether to cancel.
   */
  next: T[];
}

/**
 * Event payload for the `rowSelected` event.
 */
export interface ApexRowSelectedEvent<T extends object> {
  /**
   * The rows that became selected in this change.
   */
  added: T[];
  /**
   * The rows that became deselected in this change.
   */
  removed: T[];
  /**
   * The full current selection after the change has been applied.
   */
  selected: T[];
}

/**
 * Event payload for the cancellable `treeRowExpanding` event.
 */
export interface ApexTreeRowExpandingEvent<T extends object> {
  /** Rows that will become expanded by this change. */
  added: T[];
  /** Rows that will become collapsed by this change. */
  removed: T[];
  /** The full current tree-expansion set before this change is applied. */
  current: T[];
  /** The full set after this change would be applied. */
  next: T[];
}

/**
 * Event payload for the `treeRowExpanded` event.
 */
export interface ApexTreeRowExpandedEvent<T extends object> {
  /** Rows that became expanded in this change. */
  added: T[];
  /** Rows that became collapsed in this change. */
  removed: T[];
  /** The full tree-expansion set after the change has been applied. */
  expanded: T[];
}

/**
 * Event payload for the cancellable `rowExpanding` event.
 */
export interface ApexRowExpandingEvent<T extends object> {
  /** The rows that will become expanded by this change. */
  added: T[];
  /** The rows that will become collapsed by this change. */
  removed: T[];
  /** The full current expansion set before this change is applied. */
  current: T[];
  /**
   * The full expansion set after this change would be applied. Listeners can
   * inspect this to decide whether to cancel.
   */
  next: T[];
}

/**
 * Event payload for the `rowExpanded` event.
 */
export interface ApexRowExpandedEvent<T extends object> {
  /** The rows that became expanded in this change. */
  added: T[];
  /** The rows that became collapsed in this change. */
  removed: T[];
  /** The full expansion set after the change has been applied. */
  expanded: T[];
}

/**
 * Event payload for the cancellable `columnPinning` event.
 */
export interface ApexColumnPinningEvent<T extends object> {
  /**
   * The target column key.
   */
  key: Keys<T>;
  /**
   * The current pin position before the change (`null` if unpinned).
   */
  previous: PinPosition;
  /**
   * The proposed pin position (`null` to unpin).
   */
  next: PinPosition;
}

/**
 * Event payload for the `columnPinned` event.
 */
export interface ApexColumnPinnedEvent<T extends object> {
  /**
   * The target column key.
   */
  key: Keys<T>;
  /**
   * The resolved pin position after the change.
   */
  pinned: PinPosition;
}

/**
 * Events for the apex-grid.
 */
export interface ApexGridEventMap<T extends object> {
  /**
   * Emitted when sorting is initiated through the UI.
   * Returns the sort expression which will be used for the operation.
   *
   * @remarks
   * The event is cancellable which prevents the operation from being applied.
   * The expression can be modified prior to the operation running.
   *
   * @event
   */
  sorting: CustomEvent<SortExpression<T>>;
  /**
   * Emitted when a sort operation initiated through the UI has completed.
   * Returns the sort expression used for the operation.
   *
   * @event
   */
  sorted: CustomEvent<SortExpression<T>>;
  /**
   * Emitted when filtering is initiated through the UI.
   *
   * @remarks
   * The event is cancellable which prevents the operation from being applied.
   * The expression can be modified prior to the operation running.
   *
   * @event
   */
  filtering: CustomEvent<ApexFilteringEvent<T>>;
  /**
   * Emitted when a filter operation initiated through the UI has completed.
   * Returns the filter state for the affected column.
   *
   * @event
   */
  filtered: CustomEvent<ApexFilteredEvent<T>>;
  /**
   * Emitted before the grid navigates to a new page or applies a new page size.
   *
   * @remarks
   * Cancellable — calling `preventDefault()` (or returning a falsy result from
   * `addEventListener` synchronously) aborts the page change.
   *
   * @event
   */
  pageChanging: CustomEvent<ApexPageChangingEvent>;
  /**
   * Emitted after a page or page-size change has been applied and the pipeline has run.
   *
   * @event
   */
  pageChanged: CustomEvent<ApexPageChangedEvent>;
  /**
   * Emitted before the quick-filter value is applied.
   *
   * @remarks
   * Cancellable — calling `preventDefault()` aborts the change. The value can
   * be replaced inside the listener by reassigning {@link ApexGrid.quickFilter}.
   *
   * @event
   */
  quickFilterChanging: CustomEvent<ApexQuickFilterChangingEvent>;
  /**
   * Emitted after a quick-filter change has been applied and the pipeline has run.
   *
   * @event
   */
  quickFilterChanged: CustomEvent<ApexQuickFilterChangedEvent>;
  /**
   * Emitted before a column's pin position changes.
   *
   * @remarks
   * Cancellable — calling `preventDefault()` aborts the change.
   *
   * @event
   */
  columnPinning: CustomEvent<ApexColumnPinningEvent<T>>;
  /**
   * Emitted after a column's pin position change has been applied.
   *
   * @event
   */
  columnPinned: CustomEvent<ApexColumnPinnedEvent<T>>;
  /**
   * Emitted before a column is moved through the UI or {@link ApexGrid.moveColumn}.
   *
   * @remarks
   * Cancellable — calling `preventDefault()` aborts the move. The event detail
   * carries the source column key, its current array index, the target column
   * key and the drop position.
   *
   * @event
   */
  columnMoving: CustomEvent<ApexColumnMovingEvent<T>>;
  /**
   * Emitted after a column has been moved.
   *
   * @event
   */
  columnMoved: CustomEvent<ApexColumnMovedEvent<T>>;
  /**
   * Emitted before a cell value is committed.
   *
   * @remarks
   * Cancellable — `preventDefault()` rolls back the candidate value. In row
   * edit mode the event still fires per-cell at commit time.
   *
   * @event
   */
  cellValueChanging: CustomEvent<ApexCellValueChangingEvent<T>>;
  /**
   * Emitted after a cell value has been committed.
   *
   * @event
   */
  cellValueChanged: CustomEvent<ApexCellValueChangedEvent<T>>;
  /**
   * Emitted when a row enters edit mode (row edit mode only).
   *
   * @event
   */
  rowEditStarted: CustomEvent<ApexRowEditStartedEvent>;
  /**
   * Emitted when a row leaves edit mode, with `committed` reporting whether
   * pending edits were applied (row edit mode only).
   *
   * @event
   */
  rowEditEnded: CustomEvent<ApexRowEditEndedEvent>;
  /**
   * Emitted before the tree-row expansion set changes.
   *
   * @remarks
   * Fires only when {@link ApexGrid.tree} is enabled and a row's tree
   * expansion is toggled (via the chevron, the public API, or
   * `expand-all/collapse-all`). Cancellable.
   *
   * @event
   */
  treeRowExpanding: CustomEvent<ApexTreeRowExpandingEvent<T>>;
  /**
   * Emitted after a tree-row expansion change has been applied.
   *
   * @event
   */
  treeRowExpanded: CustomEvent<ApexTreeRowExpandedEvent<T>>;
  /**
   * Emitted before the row expansion set changes.
   *
   * @remarks
   * Cancellable — calling `preventDefault()` aborts the change. Fires for
   * every expansion-mutating call (toggle, expand-all, programmatic
   * `expandedRows = ...`).
   *
   * @event
   */
  rowExpanding: CustomEvent<ApexRowExpandingEvent<T>>;
  /**
   * Emitted after a row-expansion change has been applied.
   *
   * @event
   */
  rowExpanded: CustomEvent<ApexRowExpandedEvent<T>>;
  /**
   * Emitted before the row selection set changes.
   *
   * @remarks
   * Cancellable — calling `preventDefault()` aborts the selection change.
   * Fires for every selection-mutating call (toggle, range select, select-all,
   * programmatic `selectedRows = ...`).
   *
   * @event
   */
  rowSelecting: CustomEvent<ApexRowSelectingEvent<T>>;
  /**
   * Emitted after a row-selection change has been applied.
   *
   * @event
   */
  rowSelected: CustomEvent<ApexRowSelectedEvent<T>>;
}

/**
 * Apex grid is a web component for displaying data in a tabular format quick and easy.
 *
 * Out of the box it provides row virtualization, sort and filter operations (client and server side),
 * the ability to template cells and headers and column hiding.
 *
 * @remarks
 * A working, styled grid requires three things:
 *  1. Register the element: `import 'apex-grid/define'` (or `ApexGrid.register()`).
 *  2. Give the host element a bounded height, e.g. `apex-grid { height: 480px }` —
 *     the virtualizer collapses without one.
 *  3. Do NOT set `display` on the host — the component declares `:host { display: grid }`
 *     internally and any override breaks the track layout.
 *
 * The grid is styled out of the box through `--ag-*` CSS custom properties —
 * there is no theme to import and no `configureTheme()` call. Override `--ag-*`
 * tokens on the host (or any ancestor) to rebrand; when `igniteui-webcomponents`
 * is present, the brand tokens auto-tint from its palette. See the README
 * "Getting Started" and "Theming" sections for the full example and token list.
 *
 * @element apex-grid
 *
 * @fires sorting - Emitted when sorting is initiated through the UI.
 * @fires sorted - Emitted when a sort operation initiated through the UI has completed.
 * @fires filtering - Emitted when filtering is initiated through the UI.
 * @fires filtered - Emitted when a filter operation initiated through the UI has completed.
 * @fires pageChanging - Cancellable. Emitted before page/page-size changes are applied.
 * @fires pageChanged - Emitted after a page/page-size change has been applied.
 * @fires quickFilterChanging - Cancellable. Emitted before a quick-filter value is applied.
 * @fires quickFilterChanged - Emitted after a quick-filter change has been applied.
 * @fires columnPinning - Cancellable. Emitted before a column's pin position changes.
 * @fires columnPinned - Emitted after a column's pin position has changed.
 * @fires columnMoving - Cancellable. Emitted before a column is moved.
 * @fires columnMoved - Emitted after a column has been moved.
 * @fires cellValueChanging - Cancellable. Emitted before a cell value is committed.
 * @fires cellValueChanged - Emitted after a cell value has been committed.
 * @fires rowEditStarted - Emitted when a row enters edit mode (row mode only).
 * @fires rowEditEnded - Emitted when a row leaves edit mode (row mode only).
 * @fires rowSelecting - Cancellable. Emitted before a selection-set change is applied.
 * @fires rowSelected - Emitted after a selection-set change has been applied.
 * @fires rowExpanding - Cancellable. Emitted before the row-expansion set changes (master-detail).
 * @fires rowExpanded - Emitted after a row-expansion change has been applied.
 * @fires treeRowExpanding - Cancellable. Emitted before a tree-row expansion change (tree mode).
 * @fires treeRowExpanded - Emitted after a tree-row expansion change has been applied.
 *
 * @csspart live-region - Visually-hidden ARIA live region used for screen-reader announcements.
 *
 * @cssprop [--ag-brand] - Brand color for selection, focus rings, and accents. Auto-tints from `--ig-primary-500` when igniteui is present.
 * @cssprop [--ag-brand-strong] - Brand color for hover / pressed states.
 * @cssprop [--ag-grid-shadow] - Grid edge/shadow override. Default is a flat 1px hairline edge; set to `var(--ag-shadow-card)` for the elevated card look, or `none` to remove it.
 * @cssprop [--ag-surface] - Grid card background (must be opaque).
 * @cssprop [--ag-surface-alt] - Alternating row tint.
 * @cssprop [--ag-surface-elevated] - Header background.
 * @cssprop [--ag-hairline] - Header / structural gridline color.
 * @cssprop [--ag-border] - Row separator color.
 * @cssprop [--ag-text] - Primary text color.
 * @cssprop [--ag-text-body] - Row text color.
 * @cssprop [--ag-text-muted] - Muted text (roles, labels).
 * @cssprop [--ag-row-hover] - Row hover wash.
 * @cssprop [--ag-row-h] - Row height.
 * @cssprop [--ag-header-h] - Header height.
 * @cssprop [--ag-radius] - Outer card corner radius.
 * @cssprop [--ag-font] - Grid font family.
 * @cssprop [--ag-fs-cell] - Cell font size.
 *
 * @see {@link https://github.com/apexcharts/apex-grid/blob/main/packages/core/src/styles/_tokens.scss | _tokens.scss} for the complete `--ag-*` token list.
 */
export class ApexGrid<T extends object> extends EventEmitterBase<ApexGridEventMap<T>> {
  public static get tagName(): string {
    return GRID_TAG;
  }

  public static override styles = gridStyles;

  /**
   * Registers `<apex-grid>` and its internal dependencies with the custom-element
   * registry. Idempotent — safe to call more than once.
   *
   * @remarks
   * Registering the element is only step one of four required for a visible, styled
   * grid. You must also configure an Ignite UI theme + CSS, give the host a bounded
   * height, and avoid overriding `display` on the host. See the README
   * "Getting Started" section for the full setup.
   */
  public static register() {
    registerComponent(
      ApexGrid,
      ApexVirtualizer,
      ApexGridRow,
      ApexGridHeaderRow,
      ApexFilterRow,
      ApexGridPaginator,
      ApexGridToolbar
    );
  }

  protected stateController = this.createStateController();
  protected DOM = new GridDOMController<T>(this, this.stateController);
  protected dataController = new DataOperationsController<T>(this);

  /**
   * Builds the grid's {@link StateController}. This is the single construction
   * site for `stateController` — overriding it (rather than re-declaring the
   * field) is the supported seam for derived grids to inject optional
   * {@link GridFeatureModule}s while preserving field-initializer ordering.
   * The community grid registers no extra modules.
   */
  protected createStateController(): StateController<T> {
    return new StateController<T>(this);
  }

  protected stateProvider = new ContextProvider(this, {
    context: gridStateContext,
    initialValue: this.stateController,
  });

  @query(ApexVirtualizer.tagName)
  protected scrollContainer!: ApexVirtualizer;

  @query(ApexGridHeaderRow.tagName)
  protected headerRow!: ApexGridHeaderRow<T>;

  @query(ApexFilterRow.tagName)
  protected filterRow!: ApexFilterRow<T>;

  @query(ApexGridPaginator.tagName)
  protected paginator!: ApexGridPaginator<T>;

  @query(ApexGridToolbar.tagName)
  protected toolbar!: ApexGridToolbar<T>;

  @state()
  protected dataState: Array<T> = [];

  @queryAll(ApexGridRow.tagName)
  protected _rows!: NodeListOf<ApexGridRow<T>>;

  /** Column configuration for the grid. */
  @property({ attribute: false })
  public columns: Array<ColumnConfiguration<T>> = [];

  /** The data source for the grid. */
  @property({ attribute: false })
  public data: Array<T> = [];

  /**
   * Whether the grid will try to "resolve" its column configuration based on the passed
   * data source.
   *
   * @remarks
   * This is usually executed on initial rendering in the DOM. It depends on having an existing data source
   * to infer the column configuration for the grid.
   * Passing an empty data source or having a late bound data source (such as a HTTP request) will usually
   * result in empty column configuration for the grid.
   *
   * This property is ignored if any existing column configuration already exists in the grid.
   *
   * In a scenario where you want to bind a new data source and still keep the auto-generation behavior,
   * make sure to reset the column collection of the grid before passing in the new data source.
   *
   * @example
   * ```typescript
   * // assuming autoGenerate is set to true
   * grid.columns = [];
   * grid.data = [...];
   * ```
   *
   * @attr auto-generate
   */
  @property({ type: Boolean, attribute: 'auto-generate' })
  public autoGenerate = false;

  /** Sort configuration property for the grid. */
  @property({ attribute: false })
  public sortConfiguration: GridSortConfiguration = {
    multiple: true,
    triState: true,
  };

  /**
   * Configuration object which controls remote data operations for the grid.
   */
  @property({ attribute: false })
  public dataPipelineConfiguration!: DataPipelineConfiguration<T>;

  /**
   * Pagination configuration for the grid.
   *
   * @remarks
   * Pagination is disabled by default. Set `enabled: true` and (optionally) `pageSize`
   * to render the built-in `<apex-grid-paginator>` and slice the dataView. For
   * server-side pagination set `mode: 'remote'` and supply `totalItems`. The grid
   * emits the cancellable `pageChanging` event before applying a change and the
   * `pageChanged` event after the pipeline has run.
   *
   * @example
   * ```ts
   * grid.pagination = { enabled: true, pageSize: 25 };
   * grid.addEventListener('pageChanged', (event) => {
   *   console.log('Now on page', event.detail.page, 'of', event.detail.pageCount);
   * });
   * ```
   */
  @property({ attribute: false })
  public pagination?: PaginationConfiguration;

  /**
   * The quick-filter (global search) value applied to the dataView.
   *
   * @remarks
   * When non-empty, the grid filters records whose visible-column values contain
   * the term (case-insensitive substring match). Customise by providing
   * {@link DataPipelineConfiguration.quickFilter}.
   *
   * @attr quick-filter
   */
  @property({ type: String, attribute: 'quick-filter' })
  public quickFilter = '';

  /**
   * Whether the built-in quick-filter input is rendered in the toolbar.
   *
   * @remarks
   * The {@link ApexGrid.quickFilter} value can be controlled programmatically
   * regardless of this flag; this only controls the toolbar input UI.
   *
   * @attr show-quick-filter
   */
  @property({ type: Boolean, attribute: 'show-quick-filter' })
  public showQuickFilter = false;

  /**
   * Whether the built-in export menu is rendered in the toolbar.
   *
   * @remarks
   * When `true`, the toolbar shows a download button on the trailing side;
   * clicking it opens a menu with one entry per {@link ApexGrid.exportFormats}
   * (CSV in the community grid) that calls {@link ApexGrid.exportAs}.
   * {@link ApexGrid.exportToCSV} remains callable programmatically regardless
   * of this flag.
   *
   * @attr show-export
   */
  @property({ type: Boolean, attribute: 'show-export' })
  public showExport = false;

  /**
   * Enables drag-and-drop column reordering on the column headers.
   *
   * @remarks
   * Per-column opt-out is available through {@link BaseColumnConfiguration.reorderable}.
   * Reordering is constrained to a column's own pinning group — start-pinned
   * columns can only swap with start-pinned, unpinned with unpinned, and
   * end-pinned with end-pinned.
   *
   * @attr column-reordering
   */
  @property({ type: Boolean, attribute: 'column-reordering' })
  public columnReordering = false;

  /**
   * Inline editing configuration for the grid.
   *
   * @remarks
   * Editing is disabled by default. Set `enabled: true` and (optionally) `mode`
   * (`'cell' | 'row'`) and `trigger` (`'click' | 'doubleClick'`) to opt in.
   * Per-column opt-in is required via {@link BaseColumnConfiguration.editable}.
   *
   * @example
   * ```ts
   * grid.editing = { enabled: true, mode: 'cell', trigger: 'doubleClick' };
   * ```
   */
  @property({ attribute: false })
  public editing?: GridEditingConfiguration;

  /**
   * Row selection configuration for the grid.
   *
   * @remarks
   * Selection is disabled by default. Set `enabled: true` and (optionally)
   * `mode` (`'single' | 'multiple'`) and `showCheckboxColumn` to opt in.
   *
   * @example
   * ```ts
   * grid.selection = { enabled: true, mode: 'multiple', showCheckboxColumn: true };
   * ```
   */
  @property({ attribute: false })
  public selection?: GridSelectionConfiguration;

  /**
   * The currently selected rows, in insertion order.
   *
   * @remarks
   * Returned as a plain array snapshot — mutating the returned array does
   * not change the grid's selection. Set this property to replace the
   * selection programmatically (goes through the cancellable
   * `rowSelecting` event).
   */
  public get selectedRows(): T[] {
    return this.stateController.selection.selectedRows();
  }

  public set selectedRows(rows: ReadonlyArray<T>) {
    void this.stateController.selection.replaceSelection(rows);
  }

  /**
   * Selects `row`, replacing the existing selection in `'single'` mode or
   * adding to it in `'multiple'` mode.
   *
   * @returns `true` if the selection changed, `false` if the change was
   * rejected by a `rowSelecting` listener or selection is disabled.
   */
  public selectRow(row: T): Promise<boolean> {
    return this.stateController.selection.selectRow(row);
  }

  /**
   * Deselects `row`. No-op if `row` is not currently selected.
   */
  public deselectRow(row: T): Promise<boolean> {
    return this.stateController.selection.deselectRow(row);
  }

  /**
   * Toggles selection of `row`.
   */
  public toggleRowSelection(row: T): Promise<boolean> {
    return this.stateController.selection.toggleRow(row);
  }

  /**
   * Selects every row in the current view ({@link dataView}). No-op in
   * `'single'` selection mode.
   */
  public selectAllRows(): Promise<boolean> {
    return this.stateController.selection.selectAll();
  }

  /**
   * Clears the row selection.
   */
  public clearSelection(): Promise<boolean> {
    return this.stateController.selection.clear();
  }

  /**
   * Whether `row` is currently selected.
   */
  public isRowSelected(row: T): boolean {
    return this.stateController.selection.isSelected(row);
  }

  /**
   * Row-expansion (master-detail) configuration for the grid.
   *
   * @remarks
   * Expansion is disabled by default. Set `enabled: true` and supply a
   * `detailTemplate` to opt in. The default UX renders a chevron toggle in a
   * dedicated leading column; set `showToggleColumn: false` to drive
   * expansion entirely through the public API or a custom cell template.
   *
   * @example
   * ```ts
   * grid.expansion = {
   *   enabled: true,
   *   detailTemplate: ({ data }) => html`<order-summary .order=${data}></order-summary>`,
   * };
   * ```
   */
  @property({ attribute: false })
  public expansion?: GridExpansionConfiguration<T>;

  /**
   * The currently expanded rows, in insertion order.
   *
   * @remarks
   * Returned as a plain array snapshot — mutating the returned array does
   * not change the grid's expansion state. Set this property to replace the
   * expansion set programmatically (goes through the cancellable
   * `rowExpanding` event).
   */
  public get expandedRows(): T[] {
    return this.stateController.expansion.expandedRows();
  }

  public set expandedRows(rows: ReadonlyArray<T>) {
    void this.stateController.expansion.replaceExpansion(rows);
  }

  /**
   * Expands `row`. No-op when the row is already expanded, expansion is
   * disabled, or the optional `isExpandable` predicate rejects it.
   */
  public expandRow(row: T): Promise<boolean> {
    return this.stateController.expansion.expandRow(row);
  }

  /**
   * Collapses `row`. No-op when the row is not currently expanded.
   */
  public collapseRow(row: T): Promise<boolean> {
    return this.stateController.expansion.collapseRow(row);
  }

  /**
   * Toggles expansion of `row`.
   */
  public toggleRowExpansion(row: T): Promise<boolean> {
    return this.stateController.expansion.toggleRow(row);
  }

  /**
   * Expands every row in {@link ApexGrid.dataView} that passes the optional
   * `isExpandable` predicate.
   */
  public expandAllRows(): Promise<boolean> {
    return this.stateController.expansion.expandAll();
  }

  /**
   * Collapses every currently expanded row.
   */
  public collapseAllRows(): Promise<boolean> {
    return this.stateController.expansion.collapseAll();
  }

  /**
   * Whether `row` is currently expanded.
   */
  public isRowExpanded(row: T): boolean {
    return this.stateController.expansion.isExpanded(row);
  }

  /**
   * Tree-data (nested rows) configuration for the grid.
   *
   * @remarks
   * Tree mode keeps {@link ApexGrid.data} flat; the grid derives the
   * hierarchy from a user-supplied `getDataPath(row)` callback (AG Grid's
   * "tree data" pattern). When enabled, the first visible data column (or
   * the column referenced by `groupColumnKey`) renders a chevron toggle
   * and depth-based indentation.
   *
   * @example
   * ```ts
   * grid.tree = {
   *   enabled: true,
   *   getDataPath: (row) => row.path,    // e.g., ['Adrian'], ['Adrian', 'Bryan']
   *   defaultExpanded: true,
   * };
   * ```
   */
  @property({ attribute: false })
  public tree?: GridTreeConfiguration<T>;

  /**
   * Toggles tree-expansion of `row`. No-op when tree mode is disabled or
   * the row has no children.
   */
  public toggleTreeRow(row: T): Promise<boolean> {
    return this.stateController.tree.toggleRow(row);
  }

  /**
   * Expands a tree row. No-op when the row is already expanded, has no
   * children, or tree mode is disabled.
   */
  public expandTreeRow(row: T): Promise<boolean> {
    return this.stateController.tree.expandRow(row);
  }

  /**
   * Collapses a tree row. No-op when the row is not currently expanded.
   */
  public collapseTreeRow(row: T): Promise<boolean> {
    return this.stateController.tree.collapseRow(row);
  }

  /** Expands every parent row in the current tree. */
  public expandAllTreeRows(): Promise<boolean> {
    return this.stateController.tree.expandAll();
  }

  /** Collapses every currently-expanded tree row. */
  public collapseAllTreeRows(): Promise<boolean> {
    return this.stateController.tree.collapseAll();
  }

  /** Whether `row` is currently expanded in the tree. */
  public isTreeRowExpanded(row: T): boolean {
    return this.stateController.tree.isExpanded(row);
  }

  /**
   * Set the sort state for the grid.
   */
  public set sortExpressions(expressions: SortExpression<T>[]) {
    if (expressions.length) {
      this.sort(expressions);
    }
  }

  /**
   * Get the sort state for the grid.
   */
  @property({ attribute: false })
  public get sortExpressions(): SortExpression<T>[] {
    return Array.from(this.stateController.sorting.state.values());
  }

  /**
   * Set the filter state for the grid.
   */
  public set filterExpressions(expressions: FilterExpression<T>[]) {
    if (expressions.length) {
      this.filter(expressions);
    }
  }

  /**
   * Get the filter state for the grid.
   */
  @property({ attribute: false })
  public get filterExpressions(): FilterExpression<T>[] {
    const expressions: FilterExpression<T>[] = [];

    for (const each of this.stateController.filtering.state.values) {
      expressions.push(...each.all);
    }

    return expressions;
  }

  /**
   * Returns the collection of rendered row elements in the grid.
   *
   * @remarks
   * Since the grid has virtualization, this property returns only the currently rendered
   * chunk of elements in the DOM.
   */
  public get rows() {
    return Array.from(this._rows);
  }

  /**
   * Returns the state of the data source after sort/filter operations
   * have been applied.
   */
  public get dataView(): ReadonlyArray<T> {
    return this.dataState;
  }

  /**
   * The columns in visual render order: `'start'`-pinned columns first, then
   * unpinned columns, then `'end'`-pinned columns.
   *
   * @remarks
   * Use this when you need to iterate the columns in the same order the grid
   * actually displays them (for example to build a column chooser). Public APIs
   * like {@link ApexGrid.getColumn} continue to operate on the user-supplied
   * {@link ApexGrid.columns} array.
   */
  public get displayColumns(): ReadonlyArray<ColumnConfiguration<T>> {
    return getDisplayColumns(this.columns);
  }

  /**
   * The total number of items in the {@link ApexGrid.dataView} collection.
   *
   * @remarks
   * This is always the post-filter, post-sort row count — pagination does not change it.
   * Use {@link ApexGrid.pageItems} to read the rows currently rendered into the body.
   */
  public get totalItems() {
    if (this.pagination?.mode === 'remote') {
      return Math.max(0, this.pagination?.totalItems ?? 0);
    }
    return this.dataState.length;
  }

  /**
   * The records currently rendered into the virtualized body.
   *
   * @remarks
   * Equal to {@link ApexGrid.dataView} when pagination is disabled. With pagination
   * enabled (`'local'` mode) this is the active page slice.
   */
  public get pageItems(): ReadonlyArray<T> {
    if (!this.stateController.pagination.enabled) return this.dataState;
    if (this.pagination?.mode === 'remote') return this.dataState;
    const { page, pageSize } = this.stateController.pagination;
    if (!pageSize) return this.dataState;
    const start = page * pageSize;
    return this.dataState.slice(start, start + pageSize);
  }

  /**
   * The current zero-based page index.
   */
  @property({ attribute: false })
  public get page(): number {
    return this.stateController.pagination.page;
  }

  public set page(value: number) {
    this.stateController.pagination.gotoPage(value);
  }

  /**
   * The current page size.
   */
  @property({ attribute: false })
  public get pageSize(): number {
    return this.stateController.pagination.pageSize;
  }

  public set pageSize(value: number) {
    this.stateController.pagination.setPageSize(value);
  }

  /**
   * The total number of pages computed from {@link ApexGrid.totalItems} and {@link ApexGrid.pageSize}.
   */
  public get pageCount(): number {
    return this.stateController.pagination.pageCount;
  }

  @watch('columns')
  protected watchColumns(_: ColumnConfiguration<T>[], newConfig: ColumnConfiguration<T>[] = []) {
    this.columns = newConfig.map((config) => ({ ...DEFAULT_COLUMN_CONFIG, ...config }));
  }

  @watch('data')
  protected dataChanged() {
    // Shallow copy of the array — items keep reference equality with
    // `this.data` so cell edits can write through to the source record.
    let next: T[] = [...this.data];
    autoGenerateColumns(this);
    // Tree controller needs to re-apply `defaultExpanded` against the new
    // record set when data is swapped wholesale.
    this.stateController?.tree?.resetForDataChange();
    // Tree mode applies its flatten step synchronously here so the first
    // paint shows the right shape. Sort/filter/quickFilter still run via
    // the async pipeline on subsequent updates — they take this dataState
    // as input and re-apply tree at the end. Running tree both here and
    // inside the pipeline is idempotent because `process` is pure.
    if (this.stateController?.tree?.enabled) {
      next = this.stateController.tree.process(next);
    }
    // Run any feature-module row transforms (e.g. enterprise grouping) so
    // injected rows appear on first paint, not only after the async pipeline.
    // Identity pass-through when no modules are registered (community grid).
    this.dataState = this.stateController ? this.stateController.applyModuleTransforms(next) : next;
    if (this.hasUpdated) {
      this.pipeline();
    }
  }

  @watch(PIPELINE)
  protected async pipeline() {
    this.dataState = await this.dataController.apply([...this.data], this.stateController);
    this.stateController.pagination.reclamp();
  }

  @watch('pagination')
  protected paginationChanged() {
    const ctrl = this.stateController?.pagination;
    if (!ctrl) return;
    const next = this.pagination ?? {};
    if (typeof next.pageSize === 'number' && next.pageSize > 0) {
      ctrl.pageSize = next.pageSize;
    }
    if (typeof next.page === 'number') {
      ctrl.page = next.page;
    }
    if (this.hasUpdated) {
      this.pipeline();
    }
  }

  @watch('quickFilter')
  protected quickFilterChanged() {
    if (this.hasUpdated) {
      this.pipeline();
    }
  }

  protected override updated(): void {
    // Expose ARIA grid semantics on the host so screen readers announce the
    // structure correctly. We do this in `updated()` (post-render) rather
    // than `willUpdate()` because `@watch('data')` runs *after* the original
    // willUpdate via decorator wrapping — reading `pageItems` earlier would
    // see a stale (empty) `dataState`.
    this.setAttribute('role', this.stateController.tree.enabled ? 'treegrid' : 'grid');
    const hasFilter = this.columns.some((column) => column.filter);
    const headerRows = hasFilter ? 2 : 1;
    this.setAttribute('aria-rowcount', String(headerRows + this.pageItems.length));
    const visibleColumns = this.columns.filter((column) => !column.hidden).length;
    const extras =
      (this.stateController.selection.showCheckboxColumn ? 1 : 0) +
      (this.stateController.expansion.showToggleColumn ? 1 : 0);
    this.setAttribute('aria-colcount', String(visibleColumns + extras));
  }

  protected override firstUpdated(): void {
    // The component declares `:host { display: grid }` for its internal track
    // layout (header / filter / virtualized body). If a consumer rule overrides
    // it, the virtualizer collapses and only a few rows render. Warn loudly so
    // the failure mode isn't silent.
    if (typeof getComputedStyle === 'function' && getComputedStyle(this).display !== 'grid') {
      // biome-ignore lint/suspicious/noConsole: intentional one-shot user diagnostic
      console.warn(
        '[apex-grid] Host `display` has been overridden. The grid requires ' +
          '`display: grid` for its internal track layout and will not render correctly. ' +
          'Remove any CSS rule that sets `display` on <apex-grid>. ' +
          'See: https://github.com/apexcharts/apexgrid#4-size-the-host'
      );
    }
  }

  /**
   * Performs a filter operation in the grid based on the passed expression(s).
   */
  public filter(config: FilterExpression<T> | FilterExpression<T>[]) {
    this.stateController.filtering.filter(
      asArray(config).map((each) =>
        typeof each.condition === 'string'
          ? // XXX: Types
            Object.assign(each, {
              condition: (getFilterOperandsFor(this.getColumn(each.key)!) as any)[each.condition],
            })
          : each
      )
    );
  }

  /**
   * Performs a sort operation in the grid based on the passed expression(s).
   */
  public sort(expressions: SortExpression<T> | SortExpression<T>[]) {
    this.stateController.sorting.sort(expressions);
  }

  /**
   * Resets the current sort state of the control.
   */
  public clearSort(key?: Keys<T>) {
    this.stateController.sorting.reset(key);
    this.requestUpdate(PIPELINE);
  }

  /**
   * Resets the current filter state of the control.
   */
  public clearFilter(key?: Keys<T>) {
    this.stateController.filtering.reset(key);
    this.requestUpdate(PIPELINE);
  }

  /**
   * Navigates the grid to the given zero-based `page` index.
   *
   * @remarks
   * Emits the cancellable `pageChanging` event before applying the change and the
   * `pageChanged` event after. Out-of-range values are clamped into `[0, pageCount - 1]`.
   *
   * @param page - The target zero-based page index.
   * @returns `true` if the change was applied, `false` if cancelled or a no-op.
   *
   * @example
   * ```ts
   * await grid.gotoPage(2);
   * ```
   */
  public gotoPage(page: number): Promise<boolean> {
    return this.stateController.pagination.gotoPage(page);
  }

  /**
   * Updates the grid's page size and returns to the first page.
   *
   * @remarks
   * Emits the cancellable `pageChanging` event before applying the change and the
   * `pageChanged` event after.
   *
   * @param size - The new page size (must be a positive integer).
   * @returns `true` if the change was applied, `false` if cancelled or a no-op.
   */
  public setPageSize(size: number): Promise<boolean> {
    return this.stateController.pagination.setPageSize(size);
  }

  /**
   * Navigates to the next page. No-op if already on the last page.
   */
  public nextPage() {
    return this.stateController.pagination.nextPage();
  }

  /**
   * Navigates to the previous page. No-op if already on the first page.
   */
  public previousPage() {
    return this.stateController.pagination.previousPage();
  }

  /**
   * Navigates to the first page.
   */
  public firstPage() {
    return this.stateController.pagination.firstPage();
  }

  /**
   * Navigates to the last page.
   */
  public lastPage() {
    return this.stateController.pagination.lastPage();
  }

  /**
   * Applies a new quick-filter (global search) value, emitting the cancellable
   * `quickFilterChanging` event first and the `quickFilterChanged` event after the
   * pipeline has run.
   *
   * @param value - The new quick-filter value. Pass `''` to clear.
   * @returns `true` if the change was applied, `false` if cancelled or a no-op.
   *
   * @example
   * ```ts
   * await grid.setQuickFilter('john');
   * ```
   */
  public async setQuickFilter(value: string): Promise<boolean> {
    const next = value ?? '';
    if (next === this.quickFilter) return false;

    const proceed = this.emitEvent('quickFilterChanging', {
      detail: { value: this.quickFilter, nextValue: next },
      cancelable: true,
    });
    if (!proceed) return false;

    this.quickFilter = next;
    this.stateController.pagination.page = 0;
    await this.updateComplete;
    this.emitEvent('quickFilterChanged', { detail: { value: this.quickFilter } });
    return true;
  }

  /**
   * Returns a {@link ColumnConfiguration} for a given column.
   */
  public getColumn(id: Keys<T> | number) {
    return typeof id === 'number'
      ? this.columns.at(id)
      : this.columns.find(({ key }) => key === id);
  }

  /**
   * Updates the column configuration of the grid.
   *
   * @remarks
   * Each updated column is replaced with a fresh object reference so that cells
   * and headers re-render with the new template / configuration. The
   * user-supplied `columns` array is also reassigned for Lit reactivity.
   */
  public updateColumns(columns: ColumnConfiguration<T> | ColumnConfiguration<T>[]) {
    const updates = new Map(asArray(columns).map((c) => [c.key, c]));
    if (updates.size === 0) return;

    let touched = false;
    const next = this.columns.map((column) => {
      const patch = updates.get(column.key);
      if (!patch) return column;
      touched = true;
      return { ...column, ...patch };
    });

    if (!touched) return;
    this.columns = next;
    this.requestUpdate(PIPELINE);
  }

  /**
   * Pins a column to one of the grid's edges, or unpins it when `position` is `null`.
   *
   * @remarks
   * Emits the cancellable `columnPinning` event first and the `columnPinned`
   * event after the update is applied. The user-supplied {@link ApexGrid.columns}
   * array is not reordered — only the visual render order changes.
   *
   * @param key - The target column key.
   * @param position - `'start'`, `'end'`, or `null` to unpin.
   * @returns `true` if the change was applied, `false` if cancelled or a no-op.
   *
   * @example
   * ```ts
   * await grid.pinColumn('name', 'start');
   * await grid.pinColumn('actions', 'end');
   * ```
   */
  public async pinColumn(key: Keys<T>, position: PinPosition): Promise<boolean> {
    const column = this.getColumn(key);
    if (!column) return false;

    const previous = column.pinned ?? null;
    const next = position ?? null;
    if (previous === next) return false;

    const proceed = this.emitEvent('columnPinning', {
      detail: { key, previous, next },
      cancelable: true,
    });
    if (!proceed) return false;

    column.pinned = next ?? undefined;
    this.columns = [...this.columns];
    await this.updateComplete;
    this.emitEvent('columnPinned', { detail: { key, pinned: next } });
    return true;
  }

  /**
   * Unpins a column. Equivalent to {@link ApexGrid.pinColumn}(`key`, `null`).
   *
   * @param key - The target column key.
   * @returns `true` if the change was applied, `false` if the column was already
   * unpinned or the operation was cancelled.
   */
  public unpinColumn(key: Keys<T>): Promise<boolean> {
    return this.pinColumn(key, null);
  }

  /**
   * The cell currently in edit mode, or `null`.
   */
  public get editingCell(): { rowIndex: number; columnKey: Keys<T> } | null {
    const active = this.stateController.editing.activeCell;
    return active ? { rowIndex: active.rowIndex, columnKey: active.columnKey } : null;
  }

  /**
   * The view-relative index of the row currently in edit mode (row edit mode
   * only), or `null`.
   */
  public get editingRow(): number | null {
    return this.stateController.editing.activeRow?.rowIndex ?? null;
  }

  /**
   * Begins editing the cell at `(rowIndex, columnKey)`.
   *
   * @remarks
   * `rowIndex` is the view-relative index (matches {@link ApexGrid.pageItems}).
   * Returns `false` when the column isn't editable, the row index is out of
   * range, or the request was rejected (for example in row mode with pending
   * changes that couldn't be committed).
   */
  public editCell(rowIndex: number, columnKey: Keys<T>): Promise<boolean> {
    return this.stateController.editing.editCell(rowIndex, columnKey);
  }

  /**
   * Begins editing the entire row at `rowIndex` (row edit mode only).
   *
   * @returns `false` when editing is disabled, the grid is in cell mode, or
   * the row index is out of range.
   */
  public editRow(rowIndex: number): Promise<boolean> {
    return this.stateController.editing.editRow(rowIndex);
  }

  /**
   * Commits the current edit.
   *
   * @remarks
   * In cell mode this writes the active cell's pending value. In row mode it
   * flushes all pending values for the active row. Emits `cellValueChanging`
   * per changed cell (cancellable) and `cellValueChanged` after, followed by
   * `rowEditEnded` in row mode.
   */
  public commitEdit(): Promise<boolean> {
    const editing = this.stateController.editing;
    return editing.mode === 'row' ? editing.commitRow() : editing.commitCell();
  }

  /**
   * Discards the current edit without writing back to {@link ApexGrid.data}.
   */
  public cancelEdit(): void {
    const editing = this.stateController.editing;
    if (editing.mode === 'row') {
      editing.cancelRow();
    } else {
      editing.cancelCell();
    }
  }

  /**
   * Exports the current grid contents as a CSV string and (in a browser
   * context) triggers a download.
   *
   * @remarks
   * By default the export uses the post-filter/post-sort `dataView`, includes
   * every visible column with `exportable !== false`, and prepends a UTF-8 BOM
   * so Excel opens the file with the right encoding. Pass `source: 'page'` to
   * export only the current page, `source: 'selected'` to export the current
   * row selection, or `source: 'all'` to export the raw `data` array. The
   * returned string is the same content written to the file — useful for
   * tests or routing the bytes elsewhere.
   *
   * @example
   * ```ts
   * grid.exportToCSV();                                  // download data.csv
   * grid.exportToCSV({ filename: 'users', source: 'selected' });
   * const text = grid.exportToCSV({ filename: '' });     // string only, no download
   * ```
   */
  public exportToCSV(options: CSVExportOptions<T> = {}): string {
    const csv = buildCSV(this, options);
    const filename = options.filename;
    if (filename) {
      downloadBlob(`${filename}.csv`, csv, 'text/csv;charset=utf-8;');
    } else if (filename === undefined) {
      downloadBlob('data.csv', csv, 'text/csv;charset=utf-8;');
    }
    return csv;
  }

  /**
   * The export formats offered in the toolbar's export menu, in order.
   *
   * @remarks
   * The community grid offers CSV only. This is the seam derived grids use to
   * contribute more formats: `@apexcharts/grid-enterprise` overrides it to add
   * `'xlsx'`. The toolbar renders one menu item per entry and dispatches the
   * chosen id to {@link ApexGrid.exportAs}.
   */
  public get exportFormats(): ReadonlyArray<ExportFormat> {
    return [{ id: 'csv', label: 'Export CSV' }];
  }

  /**
   * Exports the grid in the given format (one of {@link ApexGrid.exportFormats}).
   * Called by the toolbar's export menu. The community grid handles `'csv'`;
   * derived grids override to handle additional formats, delegating to `super`
   * for the ones they don't add.
   */
  public exportAs(formatId: string, options: ExportOptions<T> = {}): void {
    if (formatId === 'csv') {
      this.exportToCSV(options as CSVExportOptions<T>);
    }
  }

  /**
   * Moves a column relative to another column.
   *
   * @remarks
   * Emits the cancellable `columnMoving` event first and `columnMoved` after.
   * Reordering only succeeds when the source and target columns share the same
   * pinning group (start / unpinned / end) — cross-group moves return `false`.
   * Use {@link ApexGrid.pinColumn} to change a column's pinning group first.
   *
   * @param fromKey - The column to move.
   * @param toKey - The reference column.
   * @param position - Whether to place `fromKey` before or after `toKey`. Defaults to `'before'`.
   * @returns `true` if the move was applied, `false` if cancelled or a no-op.
   *
   * @example
   * ```ts
   * await grid.moveColumn('email', 'name', 'after');
   * ```
   */
  public async moveColumn(
    fromKey: Keys<T>,
    toKey: Keys<T>,
    position: ColumnDropPosition = 'before'
  ): Promise<boolean> {
    if (fromKey === toKey) return false;
    const fromIndex = this.columns.findIndex((column) => column.key === fromKey);
    const toIndex = this.columns.findIndex((column) => column.key === toKey);
    if (fromIndex < 0 || toIndex < 0) return false;

    const source = this.columns[fromIndex];
    const target = this.columns[toIndex];
    if ((source.pinned ?? null) !== (target.pinned ?? null)) return false;

    const proceed = this.emitEvent('columnMoving', {
      detail: { key: fromKey, fromIndex, toKey, position },
      cancelable: true,
    });
    if (!proceed) return false;

    const next = this.columns.slice();
    const [moved] = next.splice(fromIndex, 1);
    let insertIndex = next.findIndex((column) => column.key === toKey);
    if (insertIndex < 0) return false;
    if (position === 'after') insertIndex += 1;
    next.splice(insertIndex, 0, moved);

    if (next.every((column, index) => column === this.columns[index])) return false;

    this.columns = next;
    await this.updateComplete;
    const resolvedIndex = this.columns.findIndex((column) => column.key === fromKey);
    this.emitEvent('columnMoved', {
      detail: { key: fromKey, fromIndex, toIndex: resolvedIndex },
    });
    return true;
  }

  @eventOptions({ capture: true })
  protected bodyClickHandler(event: MouseEvent) {
    const target = event.composedPath().find((el) => el instanceof ApexGridCell) as ApexGridCell<T>;
    if (target) {
      this.stateController.active = {
        column: target.column.key,
        row: target.row.index,
      };
    }
  }

  protected bodyKeydownHandler(event: KeyboardEvent) {
    if (this.scrollContainer.isSameNode(event.target as HTMLElement)) {
      this.stateController.navigation.navigate(event);
    }
  }

  protected renderHeaderRow() {
    return html`
      <apex-grid-header-row
      style=${styleMap(this.DOM.columnSizes)}
      .columns=${this.DOM.displayColumns}
      .pinOffsets=${this.DOM.pinOffsets}
      ></apex-grid-header-row>
    `;
  }

  protected renderBody() {
    return html`
      <apex-virtualizer
        .items=${this.pageItems as T[]}
        .renderItem=${this.DOM.rowRenderer}
        @click=${this.bodyClickHandler}
        @keydown=${this.bodyKeydownHandler}
      ></apex-virtualizer>
    `;
  }

  protected renderFilterRow() {
    return this.columns.some((column) => column.filter)
      ? html`<apex-filter-row style=${styleMap(this.DOM.columnSizes)}></apex-filter-row>`
      : nothing;
  }

  protected renderToolbar() {
    // Toolbar is shared by all toolbar-housed features. Render it whenever
    // any one of them is enabled.
    if (!this.showQuickFilter && !this.showExport) return nothing;
    return html`<apex-grid-toolbar
      .value=${this.quickFilter}
      .showQuickFilter=${this.showQuickFilter}
      .showExport=${this.showExport}
      @apex-quick-filter=${(event: CustomEvent<string>) => {
        event.stopPropagation();
        this.setQuickFilter(event.detail);
      }}
    ></apex-grid-toolbar>`;
  }

  protected renderPaginator() {
    if (!this.stateController.pagination.enabled) return nothing;
    const options =
      this.pagination?.pageSizeOptions && this.pagination.pageSizeOptions.length > 0
        ? this.pagination.pageSizeOptions
        : [10, 25, 50, 100];
    return html`<apex-grid-paginator .pageSizeOptions=${options}></apex-grid-paginator>`;
  }

  /**
   * Renders a visually-hidden polite live region. Status messages set via
   * {@link announce} land here; screen readers will read them aloud without
   * stealing focus. We intentionally keep this in the shadow root so we
   * don't have to coordinate consumer DOM placement.
   */
  protected renderLiveRegion() {
    return html`<div
      part="live-region"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;"
    >
      ${this.stateController.announcement}
    </div>`;
  }

  protected override render() {
    return html`
      ${this.stateController.resizing.renderIndicator()}
      ${this.renderToolbar()}
      ${this.renderHeaderRow()}
      ${this.renderFilterRow()}
      ${this.renderBody()}
      ${this.renderPaginator()}
      ${this.renderLiveRegion()}
    `;
  }

  /**
   * Sets the live region's announcement text. Screen readers configured to
   * read polite live updates will read the new value aloud.
   *
   * @remarks
   * Use this from custom UI affordances (e.g. an "Apply filter" button) so
   * the change is announced. Built-in operations (sort / filter / page /
   * select / expand) call this internally already.
   */
  public announce(message: string): void {
    this.stateController.setAnnouncement(message);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [ApexGrid.tagName]: ApexGrid<object>;
  }
}
