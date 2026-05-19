import { ContextProvider } from '@lit/context';
import { IgcDropdownComponent } from 'igniteui-webcomponents';
import { html, nothing } from 'lit';
import { eventOptions, property, query, queryAll, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { DataOperationsController } from '../controllers/data-operation.js';
import { GridDOMController } from '../controllers/dom.js';
import { gridStateContext, StateController } from '../controllers/state.js';
import { DEFAULT_COLUMN_CONFIG, PIPELINE } from '../internal/constants.js';
import { EventEmitterBase } from '../internal/mixins/event-emitter.js';
import { registerComponent } from '../internal/register.js';
import { GRID_TAG } from '../internal/tags.js';
import { addThemingController } from '../internal/theming.js';
import type {
  ColumnConfiguration,
  DataPipelineConfiguration,
  GridEditingConfiguration,
  GridSortConfiguration,
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
import { styles as bootstrap } from '../styles/grid/themes/light/grid.bootstrap.css.js';
import { styles as fluent } from '../styles/grid/themes/light/grid.fluent.css.js';
import { styles as indigo } from '../styles/grid/themes/light/grid.indigo.css.js';
import { styles as material } from '../styles/grid/themes/light/grid.material.css.js';
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
}

/**
 * Apex grid is a web component for displaying data in a tabular format quick and easy.
 *
 * Out of the box it provides row virtualization, sort and filter operations (client and server side),
 * the ability to template cells and headers and column hiding.
 *
 * @remarks
 * A working, styled grid requires four setup steps:
 *  1. Register the element: `import 'apex-grid/define'` (or `ApexGrid.register()`).
 *  2. Configure an Ignite UI theme + import the matching CSS, e.g.
 *     `import { configureTheme } from 'igniteui-webcomponents';`
 *     `import 'igniteui-webcomponents/themes/light/bootstrap.css';`
 *     `configureTheme('bootstrap');`
 *  3. Give the host element a bounded height, e.g. `apex-grid { height: 480px }` —
 *     the virtualizer collapses without one.
 *  4. Do NOT set `display` on the host — the component declares `:host { display: grid }`
 *     internally and any override breaks the track layout.
 *
 * See the README "Getting Started" section for the full example.
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
 *
 */
export class ApexGrid<T extends object> extends EventEmitterBase<ApexGridEventMap<T>> {
  public static get tagName() {
    return GRID_TAG;
  }

  public static override styles = bootstrap;

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
      ApexGridToolbar,
      IgcDropdownComponent
    );
  }

  protected stateController = new StateController<T>(this);
  protected DOM = new GridDOMController<T>(this, this.stateController);
  protected dataController = new DataOperationsController<T>(this);

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
   * Whether the built-in quick-filter input is rendered above the header row.
   *
   * @remarks
   * The {@link ApexGrid.quickFilter} value can be controlled programmatically regardless
   * of this flag; this only controls whether the toolbar UI is visible.
   *
   * @attr show-quick-filter
   */
  @property({ type: Boolean, attribute: 'show-quick-filter' })
  public showQuickFilter = false;

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
    this.dataState = [...this.data];
    autoGenerateColumns(this);

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

  constructor() {
    super();

    addThemingController(this, {
      light: { bootstrap, material, fluent, indigo },
      dark: { bootstrap, material, fluent, indigo },
    });
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
    if (!this.showQuickFilter) return nothing;
    return html`<apex-grid-toolbar
      .value=${this.quickFilter}
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

  protected override render() {
    return html`
      ${this.stateController.resizing.renderIndicator()}
      ${this.renderToolbar()}
      ${this.renderHeaderRow()}
      ${this.renderFilterRow()}
      ${this.renderBody()}
      ${this.renderPaginator()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [ApexGrid.tagName]: ApexGrid<object>;
  }
}
