import { ContextProvider } from '@lit/context';
import { html, nothing, type PropertyDeclaration } from 'lit';
import { eventOptions, property, query, queryAll, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { DataOperationsController } from '../controllers/data-operation.js';
import { GridDOMController } from '../controllers/dom.js';
import { viewIndexer } from '../controllers/history.js';
import type { RowPinPosition } from '../controllers/row-pin.js';
import type { RowDropPosition } from '../controllers/row-reorder.js';
import { gridStateContext, StateController } from '../controllers/state.js';
import {
  type GridLocaleKey,
  type GridLocaleText,
  type LocaleParams,
  localize as resolveLocaleText,
} from '../i18n/index.js';
import { DEFAULT_COLUMN_CONFIG, PIPELINE, SENTINEL_NODE } from '../internal/constants.js';
import { adoptGridDocumentStyles } from '../internal/document-styles.js';
import {
  buildCSV,
  type CSVExportOptions,
  downloadBlob,
  type ExportFormat,
  type ExportOptions,
} from '../internal/export.js';
import type { CellInteractionKind } from '../internal/feature-module.js';
import { EventEmitterBase } from '../internal/mixins/event-emitter.js';
import { registerComponent } from '../internal/register.js';
import { columnSchema, type GridSchema, operandsByType } from '../internal/state-schema.js';
import {
  applyColumnLayout,
  type ColumnLayoutState,
  deserializeFilter,
  type GetStateOptions,
  type GridState,
  type RowRef,
  resolveFilterOperand,
  resolveRowRefs,
  SET_STATE_SLICES,
  type SetStateOptions,
  type SetStateResult,
  type SetStateSlice,
  type SortStateSnapshot,
  serializeColumnLayout,
  serializeFilter,
  serializeRowRefs,
  serializeSort,
} from '../internal/state-snapshot.js';
import { GRID_TAG } from '../internal/tags.js';
import type {
  ColumnConfiguration,
  ColumnGroupConfiguration,
  DataPipelineConfiguration,
  GridEditingConfiguration,
  GridExpansionConfiguration,
  GridRowPinningConfiguration,
  GridRowReorderingConfiguration,
  GridSelectionConfiguration,
  GridSortConfiguration,
  GridTreeConfiguration,
  Keys,
  PaginationConfiguration,
  PaginationState,
  PinPosition,
  ToolbarAction,
} from '../internal/types.js';
import { asArray, autoGenerateColumns, getDisplayColumns } from '../internal/utils.js';
import { watch } from '../internal/watch.js';
import type { FilterExpression } from '../operations/filter/types.js';
import type { SortExpression, SortingDirection } from '../operations/sort/types.js';
import { styles as gridStyles } from '../styles/grid/grid.css.js';
import ApexGridCell from './cell.js';
import ApexFilterRow from './filter-row.js';
import ApexGridGroupHeaderRow from './group-header-row.js';
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
   * The view-relative row index (matches {@link ApexGrid.pageItems}), or
   * -1 when the record is pinned or on another page.
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
   * The view-relative row index after the change (matches
   * {@link ApexGrid.pageItems}), or -1 when the record is pinned or on
   * another page. Use `data` to identify the row.
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
 * Event payload for the `cellValidationFailed` event.
 */
export interface ApexCellValidationFailedEvent<T extends object> {
  /**
   * The column key of the rejected cell.
   */
  key: Keys<T>;
  /**
   * The view-relative row index of the rejected cell, or -1 when the record
   * is pinned or on another page.
   */
  rowIndex: number;
  /**
   * The data record being edited (a live reference to the row in
   * {@link ApexGrid.data}).
   */
  data: T;
  /**
   * The candidate value that failed validation.
   */
  value: unknown;
  /**
   * The collected validator error messages.
   */
  errors: readonly string[];
}

/**
 * Event payload for the cancellable `rowPinning` event and the follow-up
 * `rowPinned` event.
 */
export interface ApexRowPinningEvent<T extends object> {
  /** The row being pinned or unpinned (a live reference into {@link ApexGrid.data}). */
  row: T;
  /**
   * The target band: `'top'` / `'bottom'` when pinning, or `null` when
   * unpinning.
   */
  position: RowPinPosition | null;
}

/**
 * Event payload for the cancellable `rowMoving` event and the follow-up
 * `rowMoved` event.
 */
export interface ApexRowMovingEvent<T extends object> {
  /** The moving row's view index before the move. */
  from: number;
  /** The target row's view index. */
  to: number;
  /** The row being moved (a live reference into {@link ApexGrid.data}). */
  data: T;
}

/**
 * Event payload for the `historyChanged` event.
 */
export interface ApexHistoryChangedEvent {
  /** Whether there is at least one command to undo. */
  canUndo: boolean;
  /** Whether there is at least one command to redo. */
  canRedo: boolean;
}

/**
 * Event payload for the `stateChanged` event.
 */
export interface ApexStateChangedEvent {
  /** The grid's restorable state after the change, as captured by `getState`. */
  state: GridState;
}

/**
 * Event payload for the `rowEditStarted` event.
 */
export interface ApexRowEditStartedEvent {
  /**
   * The view-relative row index entering edit mode, or -1 when the record is
   * pinned or on another page.
   */
  rowIndex: number;
}

/**
 * Event payload for the `rowEditEnded` event.
 */
export interface ApexRowEditEndedEvent {
  /**
   * The view-relative row index that left edit mode, or -1 when the record is
   * pinned or on another page.
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
 *
 * @remarks
 * A parent that exists only as a path segment (no row of its own in
 * {@link ApexGrid.data}) appears in these arrays as a synthesized placeholder
 * row, not as one of your records.
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
 *
 * @remarks
 * A parent that exists only as a path segment (no row of its own in
 * {@link ApexGrid.data}) appears in these arrays as a synthesized placeholder
 * row, not as one of your records.
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
   * Emitted when a candidate cell value is rejected by one or more of the
   * column's {@link BaseColumnConfiguration.validators}. The value is not
   * written; in inline edit mode the editor stays open. Fires for single,
   * row-mode, and bulk (paste / fill) edits.
   *
   * @event
   */
  cellValidationFailed: CustomEvent<ApexCellValidationFailedEvent<T>>;
  /**
   * Emitted after the undo / redo stacks change (a recorded edit, an undo, a
   * redo, or a clear). Carries the current `canUndo` / `canRedo` so a toolbar
   * can enable or disable its buttons.
   *
   * @event
   */
  historyChanged: CustomEvent<ApexHistoryChangedEvent>;
  /**
   * Emitted (debounced, after the render pipeline settles) whenever the grid's
   * restorable state changes, carrying the new {@link ApexGrid.getState}
   * snapshot. The single signal for persistence (save the snapshot) or for
   * re-prompting an AI layer. The payload is only computed while at least one
   * `stateChanged` listener is attached, so it is zero-cost otherwise.
   *
   * @remarks
   * Fires for programmatic changes (including `setState`) as well as user
   * interaction. To avoid a save loop, compare the snapshot to your last-saved
   * one before persisting (identical snapshots never fire a second time).
   * Attach the listener to the grid element itself: the snapshot is computed
   * only for listeners registered on the grid, so a listener on an ancestor
   * (event delegation) receives nothing while none is attached to the grid.
   *
   * @event
   */
  stateChanged: CustomEvent<ApexStateChangedEvent>;
  /**
   * Emitted before a row is pinned, moved between bands, or unpinned.
   *
   * @remarks
   * Cancellable — `preventDefault()` aborts the change.
   *
   * @event
   */
  rowPinning: CustomEvent<ApexRowPinningEvent<T>>;
  /**
   * Emitted after a row's pin state has changed.
   *
   * @event
   */
  rowPinned: CustomEvent<ApexRowPinningEvent<T>>;
  /**
   * Emitted before a row is moved via drag, keyboard, or {@link ApexGrid.moveRow}.
   *
   * @remarks
   * Cancellable — `preventDefault()` aborts the move.
   *
   * @event
   */
  rowMoving: CustomEvent<ApexRowMovingEvent<T>>;
  /**
   * Emitted after a row has been moved.
   *
   * @event
   */
  rowMoved: CustomEvent<ApexRowMovingEvent<T>>;
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

/** Sort directions a restored sort may carry (getSchema advertises the first two). */
const SORT_DIRECTIONS: ReadonlyArray<SortingDirection> = ['ascending', 'descending', 'none'];

/** Slices that can change the row count, so a page cannot be clamped before they render. */
const VIEW_SHAPING_SLICES: ReadonlySet<SetStateSlice> = new Set([
  'columns',
  'filter',
  'quickFilter',
  'modules',
  'tree',
]);

/**
 * Properties whose change can alter the row or page count before the pipeline
 * reruns, each with the fields that matter for a configuration object (`null`:
 * compared by identity). A framework re-binding an equal inline object does
 * not count as a change.
 */
const VIEW_SHAPING_PROPERTIES: ReadonlyMap<PropertyKey, readonly string[] | null> = new Map([
  ['data', null],
  ['quickFilter', null],
  ['pagination', ['enabled', 'mode', 'pageSize', 'totalItems']],
  ['tree', ['enabled', 'getDataPath', 'defaultExpanded']],
  ['dataPipelineConfiguration', ['sort', 'filter', 'pagination', 'quickFilter']],
]);

/** Whether a view-shaping property changed in a way that can alter the row count. */
function viewShapeChanged(fields: readonly string[] | null, before: unknown, after: unknown) {
  if (Object.is(before, after)) return false;
  if (!fields) return true;
  const a = (before ?? {}) as Record<string, unknown>;
  const b = (after ?? {}) as Record<string, unknown>;
  return fields.some((field) => !Object.is(a[field], b[field]));
}

/** Report a dropped entry from a property setter (no result object to carry it). */
function warnDropped(message: string): void {
  // biome-ignore lint/suspicious/noConsole: the setter has no other channel for a dropped entry
  console.warn(`[apex-grid] ${message}`);
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
 * tokens on the host (or any ancestor) to rebrand; where an Ignite UI palette is
 * present, the brand tokens auto-tint from it. For dark mode, set
 * the `theme="dark"` attribute on the host for the built-in slate dark palette
 * (further `--ag-*` overrides still compose on top). Add `tinted` (e.g.
 * `theme="tinted"` or `theme="dark tinted"`) to mix the brand into the chrome
 * so the grid wears its brand even at rest. See the README "Getting Started"
 * and "Theming" sections for the full example and token list.
 *
 * @element apex-grid
 *
 * @attr {string} theme - Space-separated theme flags. `dark` opts into the built-in dark palette; `tinted` mixes `--ag-brand` into the chrome surfaces. Combine as `theme="dark tinted"`.
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
 * @cssprop [--ag-brand] - Brand color for selection, focus rings, and accents. Auto-tints from `--ig-primary-500` where an Ignite UI palette is present.
 * @cssprop [--ag-brand-strong] - Brand color for hover / pressed states.
 * @cssprop [--ag-grid-shadow] - Grid edge/shadow override. Default is a flat 1px hairline edge; set to `var(--ag-shadow-card)` (`var(--ag-dark-shadow-card)` on a dark grid) for the elevated card look, or `none` to remove it.
 * @cssprop [--ag-grid-bg] - Host card background. Defaults to a subtle light gradient; override with a flat color (or use `theme="dark"`) for dark themes.
 * @cssprop [--ag-surface] - Grid card background (must be opaque).
 * @cssprop [--ag-surface-alt] - Alternating row tint.
 * @cssprop [--ag-surface-elevated] - Header background.
 * @cssprop [--ag-hairline] - Header / structural gridline color.
 * @cssprop [--ag-border] - Row separator color.
 * @cssprop [--ag-text] - Primary text color.
 * @cssprop [--ag-text-body] - Row text color.
 * @cssprop [--ag-text-muted] - Muted text (roles, labels).
 * @cssprop [--ag-row-hover] - Row hover wash.
 * @cssprop [--ag-dark-grid-bg] - Host card background on `theme="dark"` grids. Dark grids read the `--ag-dark-*` colours instead of the light ones.
 * @cssprop [--ag-dark-surface] - Grid card background on dark grids (must be opaque).
 * @cssprop [--ag-dark-surface-alt] - Alternating row tint on dark grids.
 * @cssprop [--ag-dark-surface-elevated] - Header background on dark grids.
 * @cssprop [--ag-dark-hairline] - Header / structural gridline color on dark grids.
 * @cssprop [--ag-dark-border] - Row separator color on dark grids.
 * @cssprop [--ag-dark-text] - Primary text color on dark grids.
 * @cssprop [--ag-dark-text-body] - Row text color on dark grids.
 * @cssprop [--ag-dark-text-muted] - Muted text (roles, labels) on dark grids.
 * @cssprop [--ag-dark-row-hover] - Row hover wash on dark grids.
 * @cssprop [--ag-dark-shadow-card] - Elevated card shadow for dark grids (see `--ag-grid-shadow`).
 * @cssprop [--ag-row-h] - Row height.
 * @cssprop [--ag-header-h] - Header height.
 * @cssprop [--ag-radius] - Outer card corner radius.
 * @cssprop [--ag-font] - Grid font family.
 * @cssprop [--ag-fs-cell] - Cell font size.
 *
 * @see {@link https://github.com/apexcharts/apex-grid/blob/main/packages/core/src/styles/_tokens.scss | _tokens.scss} for the complete `--ag-*` token list.
 *
 * @fires cellValidationFailed - Emitted when a candidate cell value is rejected by a column validator; the value is not written.
 * @fires historyChanged - Emitted after the undo / redo stacks change; carries the current `canUndo` / `canRedo`.
 * @fires stateChanged - Emitted (debounced) whenever the grid's restorable state changes; carries the new `getState` snapshot.
 * @fires rowPinning - Cancellable. Emitted before a row is pinned, moved between bands, or unpinned.
 * @fires rowPinned - Emitted after a row's pin state has changed.
 * @fires rowMoving - Cancellable. Emitted before a row is moved via drag, keyboard, or `moveRow`.
 * @fires rowMoved - Emitted after a row has been moved.
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
      ApexGridGroupHeaderRow,
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

  #data: Array<T> = [];

  /**
   * The data source for the grid. `null` or `undefined` (a framework prop that
   * is still loading) is stored as an empty array.
   *
   * @default []
   */
  @property({ attribute: false })
  public get data(): Array<T> {
    return this.#data;
  }

  public set data(value: Array<T>) {
    // Keep the current empty array, so a repeated nullish value is no change.
    if (value == null && !this.#data.length) return;
    this.#data = value ?? [];
  }

  /**
   * Optional stable row-identity resolver.
   *
   * @remarks
   * When provided, {@link ApexGrid.getState} captures selection / expansion /
   * tree rows by the returned id, so they survive a wholesale {@link ApexGrid.data}
   * reload. Without it those rows are captured by positional index into
   * {@link ApexGrid.data}, which round-trips within a session but not across a
   * data swap. The id must be unique per row and stable across reloads.
   */
  @property({ attribute: false })
  public rowId?: (row: T) => string | number;

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
   * @default ''
   */
  @property({ type: String, attribute: 'quick-filter' })
  public get quickFilter(): string {
    return this.#quickFilter;
  }

  public set quickFilter(value: string) {
    this.#quickFilter = value;
    this.#quickFilterWrites++;
  }

  #quickFilter = '';
  /** Counts quickFilter writes, so setQuickFilter sees a listener's own write. */
  #quickFilterWrites = 0;

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
   * Localization overrides for the grid's built-in UI text (pagination, filter
   * operators and controls, row/selection labels, the toolbar, and so on).
   *
   * @remarks
   * A (possibly partial) map of locale keys to translated strings. Any key you
   * omit falls back to the built-in English default, so partial maps are valid.
   * A ready-made Spanish dictionary ships as `esLocale`; community translations
   * are just plain objects of the same shape.
   *
   * @example
   * ```ts
   * import { esLocale } from '@apexcharts/grid';
   *
   * // Whole-UI translation:
   * grid.localeText = esLocale;
   *
   * // Or override a handful of strings:
   * grid.localeText = { 'toolbar.searchPlaceholder': 'Buscar productos…' };
   * ```
   */
  @property({ attribute: false })
  public localeText?: GridLocaleText;

  /**
   * Resolves a built-in locale key to its display string, applying any
   * {@link ApexGrid.localeText} override over the English default and
   * interpolating `{placeholder}` tokens from `params`.
   *
   * @remarks
   * Used internally by the grid's components. `fallback` is returned when the
   * key is not part of the built-in set (for example a custom filter operand's
   * own label).
   */
  public localize(key: GridLocaleKey, params?: LocaleParams, fallback?: string): string {
    return resolveLocaleText(this.localeText, key, params, fallback);
  }

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
   * Shows a persistent vertical divider on the trailing edge of every column
   * header, rather than only the frozen-column pin edges.
   *
   * @remarks
   * On by default. On columns that opt into resizing (via
   * {@link BaseColumnConfiguration.resizable}) the divider doubles as the
   * resize handle: it takes the `col-resize` cursor and can be dragged to
   * resize, so the always-visible line is also the grab target. On
   * non-resizable columns it is purely decorative.
   *
   * Because the default is `true`, hide the dividers by setting the property to
   * `false` (`grid.columnSeparator = false`); the reflected `column-separator`
   * attribute is then removed. The line's color and vertical inset are themeable
   * through the `--ag-header-separator` / `--header-separator-color` custom
   * properties and `--apex-header-separator-inset`.
   *
   * @attr column-separator
   */
  @property({ type: Boolean, attribute: 'column-separator', reflect: true })
  public columnSeparator = true;

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
   * Row-pinning configuration.
   *
   * @remarks
   * Disabled by default. Set `enabled: true` to allow pinning rows to a sticky
   * top / bottom band via {@link ApexGrid.pinRow}.
   *
   * @example
   * ```ts
   * grid.rowPinning = { enabled: true };
   * grid.pinRow(grid.data[0], 'top');
   * ```
   */
  @property({ attribute: false })
  public rowPinning?: GridRowPinningConfiguration;

  /**
   * Row-reordering configuration.
   *
   * @remarks
   * Disabled by default. Set `enabled: true` to allow drag / keyboard reorder
   * and {@link ApexGrid.moveRow}. A manual order is mutually exclusive with
   * column sorting (applying a sort clears it). Set `applyToData: true` to also
   * splice {@link ApexGrid.data} in place.
   *
   * @example
   * ```ts
   * grid.rowReordering = { enabled: true };
   * ```
   */
  @property({ attribute: false })
  public rowReordering?: GridRowReorderingConfiguration;

  /**
   * Transient spreadsheet coordinate hints: when `true`, a leading row-number
   * gutter (1, 2, 3, ...) and A / B / C column letters are revealed so cell
   * references are discoverable. Enterprise toggles this while a formula cell is
   * being edited; it can also be set directly for a persistent spreadsheet look.
   * Reflected so styling / tests can observe it on the host.
   */
  @property({ type: Boolean, reflect: true, attribute: 'coordinate-hints' })
  public coordinateHints = false;

  /**
   * Whether column headers show the column-menu (kebab) button. On by default,
   * and the button is always visible (not hover-only). Set to `false` to hide it
   * entirely; a feature module's menu (e.g. the enterprise context menu) stays
   * reachable by right-click. This is a JS property (no attribute) so it can
   * stay `true` by default.
   */
  @property({ attribute: false })
  public columnMenu = true;

  /**
   * Column groups rendered as spanning headers above the column header row.
   *
   * @remarks
   * A column joins a group via its {@link BaseColumnConfiguration.group} id.
   * Members must be contiguous within one pin region. `columns` stays flat — all
   * width / pin / resize / reorder machinery is unchanged; grouping is a
   * presentational header layer. v1 ships static spanning headers (no collapse).
   *
   * @example
   * ```ts
   * grid.columnGroups = [{ id: 'name', headerText: 'Name' }];
   * grid.columns = [{ key: 'first', group: 'name' }, { key: 'last', group: 'name' }];
   * ```
   */
  @property({ attribute: false })
  public columnGroups?: ColumnGroupConfiguration[];

  /**
   * Whether a group header row should render: at least one configured group has
   * a visible member column.
   */
  public get hasColumnGroups(): boolean {
    if (!this.columnGroups?.length) return false;
    const ids = new Set(this.columnGroups.map((group) => group.id));
    return this.columns.some((column) => !column.hidden && column.group && ids.has(column.group));
  }

  /**
   * Number of group header rows above the column header (0 or 1 in v1).
   */
  public get columnGroupDepth(): number {
    return this.hasColumnGroups ? 1 : 0;
  }

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
   * hierarchy from a user-supplied `getDataPath(row)` callback (the
   * flat-array "tree data" pattern). When enabled, the first visible data column (or
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
   * Expressions assigned through the setters, applied at the next update once
   * the columns settle (they may be bound after the sort or filter, in the same
   * render, or be auto-generated).
   */
  #pendingSort?: SortExpression<T>[];
  #pendingFilter?: FilterExpression<T>[];

  /**
   * Set the sort state for the grid.
   *
   * @remarks
   * Replaces the current sort; `[]`, `null` or `undefined` clears it. Applied
   * at the next update, against the columns as they are then.
   */
  public set sortExpressions(expressions: SortExpression<T>[] | null | undefined) {
    this.#pendingSort = [...(expressions ?? [])];
    this.requestUpdate(PIPELINE);
  }

  /**
   * Get the sort state for the grid.
   */
  @property({ attribute: false })
  public get sortExpressions(): SortExpression<T>[] {
    if (this.#pendingSort) return [...this.#pendingSort];
    return Array.from(this.stateController.sorting.state.values());
  }

  /**
   * Set the filter state for the grid.
   *
   * @remarks
   * Replaces the current filter; `[]`, `null` or `undefined` clears it. Applied
   * at the next update, against the columns as they are then.
   */
  public set filterExpressions(expressions: FilterExpression<T>[] | null | undefined) {
    this.#pendingFilter = [...(expressions ?? [])];
    this.#markViewChange();
  }

  /**
   * Get the filter state for the grid.
   */
  @property({ attribute: false })
  public get filterExpressions(): FilterExpression<T>[] {
    if (this.#pendingFilter) {
      // Shaped like the applied state where the column already exists.
      return this.#pendingFilter.map((each) => {
        const resolved = this.#resolveFilter(each);
        return typeof resolved === 'string' ? each : resolved;
      });
    }
    const expressions: FilterExpression<T>[] = [];

    for (const each of this.stateController.filtering.state.values) {
      expressions.push(...each.all);
    }

    return expressions;
  }

  /**
   * `each` resolved against its column on a new object (the caller's may be
   * frozen): the column's defaults under it and an operand name replaced by
   * the live operation. Returns the reason instead when it cannot resolve.
   */
  #resolveFilter(each: FilterExpression<T>): FilterExpression<T> | string {
    const column = each ? this.getColumn(each.key) : undefined;
    if (!column) return `filter: unknown column "${String(each?.key)}"; dropped`;
    const defaults = this.stateController.filtering.getDefaultExpression(column);
    const named = each.condition ?? defaults.condition;
    const condition = typeof named === 'string' ? resolveFilterOperand(column, named) : named;
    if (!condition) return `filter: unknown operand "${named}" for "${String(each.key)}"; dropped`;
    return {
      ...defaults,
      ...each,
      condition,
      criteria: each.criteria ?? 'and',
    } as unknown as FilterExpression<T>;
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
    // Pinned rows are lifted out of the scrollable body and rendered in their
    // own sticky bands, so they're excluded here to avoid duplication. The
    // exclusion happens before pagination so a pinned row never consumes a body
    // page slot.
    const rowPin = this.stateController.rowPin;
    const base =
      rowPin?.enabled && rowPin.hasPinnedRows
        ? this.dataState.filter((row) => !rowPin.isPinned(row))
        : this.dataState;
    if (!this.stateController.pagination.enabled) return base;
    if (this.pagination?.mode === 'remote') return base;
    const { page, pageSize } = this.stateController.pagination;
    if (!pageSize) return base;
    const start = page * pageSize;
    return base.slice(start, start + pageSize);
  }

  /**
   * The current zero-based page index.
   *
   * @remarks
   * Navigates like {@link ApexGrid.gotoPage}, with the cancellable
   * `pageChanging` and the `pageChanged` events. Assigned before the first
   * render, or while a data, filter or quick filter change has yet to render,
   * the page is kept as given and clamped once the view settles, without those
   * events.
   */
  @property({ attribute: false })
  public get page(): number {
    return this.stateController.pagination.page;
  }

  public set page(value: number) {
    if (this.#viewStale) {
      // The row count is about to change: keep the page and let the reclamp
      // after the pipeline clamp it against the settled view.
      this.stateController.pagination.page = Number.isFinite(value)
        ? Math.max(0, Math.trunc(value))
        : 0;
      this.requestUpdate(PIPELINE);
    } else {
      this.stateController.pagination.gotoPage(value);
    }
  }

  /**
   * A row count changing input (see VIEW_SHAPING_PROPERTIES) has not rendered
   * yet. Only set alongside a requested update, which clears it.
   */
  #viewChangePending = false;
  /** A run carrying such a change started and the latest run has not settled. */
  #shapingPending = false;

  /** Whether the row count may still change, so a page cannot be clamped yet. */
  get #viewStale(): boolean {
    return !this.hasUpdated || this.#viewChangePending || this.#shapingPending;
  }

  /** Mark the row count as about to change and request the pipeline that settles it. */
  #markViewChange(): void {
    this.#viewChangePending = true;
    this.requestUpdate(PIPELINE);
  }

  public override requestUpdate(
    name?: PropertyKey,
    oldValue?: unknown,
    options?: PropertyDeclaration,
    useNewValue?: boolean,
    newValue?: unknown
  ): void {
    // Before the first render the view is stale anyway (and this runs while
    // the class fields, these flags included, are still being initialised).
    // A shaping change is also a Lit change (a stricter test than identity),
    // so the update requested below clears the flag.
    const fields = name === undefined ? undefined : VIEW_SHAPING_PROPERTIES.get(name);
    if (
      this.hasUpdated &&
      fields !== undefined &&
      viewShapeChanged(fields, oldValue, useNewValue ? newValue : this[name as keyof this])
    ) {
      this.#viewChangePending = true;
    }
    super.requestUpdate(name, oldValue, options, useNewValue, newValue);
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

  /**
   * The records undo history may still replay onto after {@link ApexGrid.data}
   * changes; history naming any other record is cleared. Defaults to `data`.
   * A row model that writes only part of a larger record set into `data` (rows
   * under a collapsed group leave `data` but stay cached and come back as the
   * same objects) overrides this to also yield the records it keeps, so a
   * collapse does not wipe the history. Read only while history has entries.
   */
  protected historyRecords(): Iterable<T> {
    return this.data;
  }

  @watch('data')
  protected dataChanged() {
    // Shallow copy of the array — items keep reference equality with
    // `this.data` so cell edits can write through to the source record.
    let next: T[] = [...this.data];
    autoGenerateColumns(this);
    // Undo must not replay onto records the grid no longer holds.
    this.stateController?.history?.reconcile(() => this.historyRecords());
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
    // Requested, not called, so every watcher of this update shares one run.
    if (this.hasUpdated) this.requestUpdate(PIPELINE);
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
    if (this.hasUpdated) this.requestUpdate(PIPELINE);
  }

  @watch('quickFilter')
  protected quickFilterChanged() {
    // Also before the first render, so a term set at mount (the attribute or
    // a bound property) filters the first view.
    if (this.hasUpdated || this.quickFilter) this.requestUpdate(PIPELINE);
  }

  /** The first render shapes the tree in dataChanged; later changes rebuild it. */
  @watch('tree', { waitUntilFirstUpdate: true })
  protected treeChanged(previous?: GridTreeConfiguration<T>) {
    if (!viewShapeChanged(VIEW_SHAPING_PROPERTIES.get('tree')!, previous, this.tree)) return;
    this.stateController.tree.resetForDataChange();
    this.requestUpdate(PIPELINE);
  }

  /** The latest pipeline run; an older one that settles later is dropped. */
  #pipelineRun = 0;
  /**
   * Settles (never rejects) once the latest pipeline run settles. Overlapping
   * runs share it and only the latest one settles it, so a superseded run
   * that is slow, or never settles, does not hold back its waiters.
   */
  #pipelineSettled: Promise<void> = Promise.resolve();
  #settlePipeline: (() => void) | null = null;

  // Declared after every watcher that requests it, so each request made while
  // this update's watchers run is seen here and the pipeline runs once.
  @watch(PIPELINE)
  protected pipeline(): Promise<void> {
    if (!this.#settlePipeline) {
      this.#pipelineSettled = new Promise((settle) => {
        this.#settlePipeline = settle;
      });
    }
    return this.#runPipeline(++this.#pipelineRun);
  }

  async #runPipeline(run: number): Promise<void> {
    try {
      this.#flushPendingExpressions();
      // The first run, or one carrying a row count change, leaves the page
      // unsettled until the latest run reclamps it, so a run that supersedes
      // an unsettled one carries its change too.
      if (this.#viewChangePending || !this.hasUpdated) this.#shapingPending = true;
      this.#viewChangePending = false;
      const next = await this.dataController.apply([...this.data], this.stateController);
      if (run !== this.#pipelineRun) return;
      this.dataState = next;
      this.stateController.dataVersion++;
      this.stateController.pagination.reclamp();
    } finally {
      // Only the latest run settles; a superseded one leaves the state alone.
      if (run === this.#pipelineRun) {
        this.#settlePipeline?.();
        this.#settlePipeline = null;
        if (this.#shapingPending) {
          this.#shapingPending = false;
          this.#baselineStateIfUnset();
        }
      }
    }
  }

  /**
   * Resolves once the pending update, the pipeline runs it started and the
   * render of their result have settled. Events that report the new view
   * (`sorted`, `filtered`, `pageChanged`, `quickFilterChanged`) await this,
   * so with an async pipeline hook they fire after the rows changed.
   */
  protected async pipelineSettled(): Promise<void> {
    await this.updateComplete;
    let settled: Promise<void>;
    do {
      settled = this.#pipelineSettled;
      await settled;
      await this.updateComplete;
    } while (settled !== this.#pipelineSettled);
  }

  /** Apply the expressions assigned through the setters, now that columns settled. */
  #flushPendingExpressions(): void {
    const sort = this.#pendingSort;
    const filter = this.#pendingFilter;
    this.#pendingSort = undefined;
    this.#pendingFilter = undefined;
    if (sort) this.#replaceSort(sort, warnDropped);
    if (filter) this.#replaceFilter(filter);
  }

  /**
   * Replace the sort with `entries`, dropping (and reporting) any that is not
   * an object, names an unknown column, or carries an unknown direction (an
   * omitted one takes the column default). The one path for the
   * `sortExpressions` setter and the `setState` sort slice.
   */
  #replaceSort(entries: ReadonlyArray<unknown>, warn: (message: string) => void): void {
    this.stateController.sorting.reset();
    const valid: SortExpression<T>[] = [];
    for (const entry of entries) {
      const { direction, ...rest } = (entry ?? {}) as SortExpression<T>;
      if (typeof entry !== 'object' || entry === null || !this.getColumn(rest.key)) {
        warn(`sort: unknown column "${String(rest.key)}"; dropped`);
      } else if (direction === undefined) {
        valid.push(rest as SortExpression<T>);
      } else if (SORT_DIRECTIONS.includes(direction)) {
        valid.push(entry as SortExpression<T>);
      } else {
        warn(`sort: invalid direction "${String(direction)}"; dropped`);
      }
    }
    if (valid.length) this.sort(valid);
    this.requestUpdate(PIPELINE);
  }

  /** Replace the filter with `entries` (unresolvable ones are dropped by `filter`). */
  #replaceFilter(entries: ReadonlyArray<FilterExpression<T>>): void {
    this.#markViewChange();
    this.stateController.filtering.reset();
    if (entries.length) this.filter([...entries]);
  }

  protected override updated(): void {
    // Expose ARIA grid semantics on the host so screen readers announce the
    // structure correctly. We do this in `updated()` (post-render) rather
    // than `willUpdate()` because `@watch('data')` runs *after* the original
    // willUpdate via decorator wrapping — reading `pageItems` earlier would
    // see a stale (empty) `dataState`.
    // This update's watchers consumed every change requested before it; a
    // pipeline still running is tracked by #shapingPending.
    this.#viewChangePending = false;
    this.setAttribute('role', this.stateController.tree.enabled ? 'treegrid' : 'grid');
    const pinned = this.stateController.rowPin.pinnedRows;
    this.setAttribute(
      'aria-rowcount',
      String(this.headerRowCount + pinned.top.length + this.pageItems.length + pinned.bottom.length)
    );
    const visibleColumns = this.columns.filter((column) => !column.hidden).length;
    const extras =
      (this.stateController.selection.showCheckboxColumn ? 1 : 0) +
      (this.stateController.expansion.showToggleColumn ? 1 : 0);
    this.setAttribute('aria-colcount', String(visibleColumns + extras));

    const selection = this.stateController.selection;
    if (selection.enabled && selection.mode === 'multiple') {
      this.setAttribute('aria-multiselectable', 'true');
    } else {
      this.removeAttribute('aria-multiselectable');
    }

    this.#syncBodyTabStop();

    // Default accessible name for the host. An author-provided `aria-label`
    // or `aria-labelledby` always wins; only the value this grid set itself
    // is kept in sync (e.g. when `localeText` changes).
    const currentLabel = this.getAttribute('aria-label');
    const authorLabeled =
      this.hasAttribute('aria-labelledby') ||
      (currentLabel !== null && currentLabel !== this.#autoAriaLabel);
    if (!authorLabeled) {
      const label = this.localize('grid.label');
      if (currentLabel !== label) this.setAttribute('aria-label', label);
      this.#autoAriaLabel = label;
    }

    this.#emitStateChangedIfNeeded();
  }

  /** The `aria-label` value this grid last auto-applied (never an author's). */
  #autoAriaLabel: string | null = null;

  /**
   * The `stateChanged` listeners registered on the grid, keyed by listener and
   * capture flag the way the DOM dedupes them, so the (potentially
   * non-trivial) snapshot is only computed while something is listening. A
   * `once` listener or one with an aborted `signal` leaves the set when the
   * DOM drops it.
   */
  #stateChangedListeners = new Map<EventListenerOrEventListenerObject, Map<boolean, object>>();
  /** Serialized last-emitted state, to fire `stateChanged` only on real changes. */
  #lastStateJson: string | null = null;

  public override addEventListener<
    K extends keyof M,
    M extends ApexGridEventMap<T> & HTMLElementEventMap,
  >(
    type: K,
    listener: (this: HTMLElement, ev: M[K]) => unknown,
    options?: boolean | AddEventListenerOptions
  ): void;
  public override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void {
    if (type === 'stateChanged' && listener) this.#trackStateChangedListener(listener, options);
    (
      super.addEventListener as (
        t: string,
        l: EventListenerOrEventListenerObject,
        o?: boolean | AddEventListenerOptions
      ) => void
    )(type, listener, options);
  }

  #trackStateChangedListener(
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    const captures = this.#stateChangedListeners.get(listener) ?? new Map<boolean, object>();
    // The DOM ignores a duplicate (listener, capture) and an already aborted
    // signal, so neither is tracked.
    if (!captures.has(capture) && !(options as AddEventListenerOptions)?.signal?.aborted) {
      if (!this.#stateChangedListeners.size) {
        // Baseline when the first listener arrives so its first emit is the
        // next real change; later subscribers share it (no re-baseline).
        this.#lastStateJson = this.hasUpdated ? JSON.stringify(this.getState()) : null;
      }
      // A token per registration, so a hook left over from an earlier one
      // cannot untrack the same listener after it is added again.
      const token = {};
      captures.set(capture, token);
      this.#stateChangedListeners.set(listener, captures);
      const forget = () => this.#forgetStateChangedListener(listener, capture, token);
      if (typeof options === 'object') {
        // Registered before the caller's listener, so it fires first, when
        // the DOM has already dropped that listener; one that subscribes
        // itself again from its callback is then tracked anew.
        if (options.once) {
          HTMLElement.prototype.addEventListener.call(this, 'stateChanged', forget, {
            capture,
            once: true,
          });
        }
        options.signal?.addEventListener('abort', forget, { once: true });
      }
    }
  }

  #forgetStateChangedListener(
    listener: EventListenerOrEventListenerObject,
    capture: boolean,
    token?: object
  ) {
    const captures = this.#stateChangedListeners.get(listener);
    if (!captures || (token && captures.get(capture) !== token)) return;
    captures.delete(capture);
    if (!captures.size) this.#stateChangedListeners.delete(listener);
  }

  public override removeEventListener<
    K extends keyof M,
    M extends ApexGridEventMap<T> & HTMLElementEventMap,
  >(
    type: K,
    listener: (this: HTMLElement, ev: M[K]) => unknown,
    options?: boolean | EventListenerOptions
  ): void;
  public override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void {
    if (type === 'stateChanged' && listener) {
      const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
      this.#forgetStateChangedListener(listener, capture);
    }
    (
      super.removeEventListener as (
        t: string,
        l: EventListenerOrEventListenerObject,
        o?: boolean | EventListenerOptions
      ) => void
    )(type, listener, options);
  }

  /**
   * Emit `stateChanged` when the restorable state differs from the last emitted
   * snapshot. No-op (and no snapshot computed) when nothing is listening. Called
   * from `updated()`, so the snapshot reflects the settled post-pipeline view.
   */
  #emitStateChangedIfNeeded(): void {
    if (!this.#stateChangedListeners.size) return;
    // No baseline yet (subscribed before the first render): the first settled
    // state is the initial one, not a change, so it is recorded, not emitted.
    if (this.#lastStateJson === null) {
      this.#baselineStateIfUnset();
      return;
    }
    const snapshot = this.getState();
    const json = JSON.stringify(snapshot);
    if (json === this.#lastStateJson) return;
    this.#lastStateJson = json;
    this.emitEvent('stateChanged', { detail: { state: snapshot } });
  }

  /**
   * Record the initial state for listeners attached before the first render,
   * once the first view settles (its reclamp may still move the page).
   */
  #baselineStateIfUnset(): void {
    if (this.#lastStateJson === null && this.#stateChangedListeners.size && !this.#shapingPending) {
      this.#lastStateJson = JSON.stringify(this.getState());
    }
  }

  public override connectedCallback(): void {
    super.connectedCallback();
    // The `--ag-*` root defaults (and the `setup()` host sizing) live outside
    // the shadow root; see internal/document-styles.ts.
    adoptGridDocumentStyles(this);
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
    if (this.#pendingFilter) {
      // Adds onto the assigned filter, which applies at the next update.
      const added = asArray(config);
      this.#pendingFilter.push(...added);
      if (added.length) this.#markViewChange();
      return;
    }
    const expressions: FilterExpression<T>[] = [];
    for (const each of asArray(config)) {
      const resolved = this.#resolveFilter(each);
      if (typeof resolved === 'string') warnDropped(resolved);
      else expressions.push(resolved);
    }
    // Nothing to apply leaves the view, and the page events, as they were.
    if (!expressions.length) return;
    this.#markViewChange();
    this.stateController.filtering.filter(expressions);
  }

  /**
   * Performs a sort operation in the grid based on the passed expression(s).
   */
  public sort(expressions: SortExpression<T> | SortExpression<T>[]) {
    if (this.#pendingSort) {
      // Adds onto the assigned sort, which applies at the next update.
      this.#pendingSort.push(...asArray(expressions));
      this.requestUpdate(PIPELINE);
      return;
    }
    this.stateController.sorting.sort(expressions);
  }

  /**
   * Returns a serializable, JSON-safe snapshot of the grid's restorable state:
   * column layout, sort, filter, quick-filter, pagination, selection, expansion,
   * tree expansion, and any feature-module state. Functions and templates are
   * omitted (see {@link GridState}).
   *
   * @remarks
   * Pair with {@link ApexGrid.setState} to persist/restore views, drive an AI
   * assistant, or implement save/restore. Set {@link ApexGrid.rowId} for
   * selection/expansion to survive a wholesale data reload.
   *
   * @example
   * ```ts
   * const snapshot = grid.getState();
   * localStorage.setItem('grid', JSON.stringify(snapshot));
   * // later …
   * grid.setState(JSON.parse(localStorage.getItem('grid')!));
   * ```
   */
  public getState(options?: GetStateOptions<T>): GridState {
    const rowId = options?.rowId ?? this.rowId;
    const pinned = this.stateController.rowPin.pinnedRows;
    const manualOrder = this.stateController.rowReorder.getManualOrder();
    return {
      version: 1,
      columns: serializeColumnLayout(this.columns),
      sort: serializeSort(this.sortExpressions),
      filter: serializeFilter(this.filterExpressions),
      // Removing the `quick-filter` attribute sets the property to null.
      quickFilter: this.quickFilter ?? '',
      pagination: { page: this.page, pageSize: this.pageSize },
      selection: serializeRowRefs(this.selectedRows, this.data, rowId),
      expansion: serializeRowRefs(this.expandedRows, this.data, rowId),
      treeExpanded: serializeRowRefs([...this.stateController.tree.expanded], this.data, rowId),
      treeExpandedKeys: [...this.stateController.tree.expandedKeys],
      rowPinning: {
        top: serializeRowRefs(pinned.top, this.data, rowId),
        bottom: serializeRowRefs(pinned.bottom, this.data, rowId),
      },
      rowOrder: manualOrder ? serializeRowRefs(manualOrder, this.data, rowId) : null,
      modules: this.stateController.serializeModuleState(),
    };
  }

  /**
   * A machine-readable description of the grid: its columns and data types, the
   * operations available per column (sort directions, filter operands), the
   * grid-level capabilities, and the current {@link ApexGrid.getState} snapshot.
   *
   * @remarks
   * This is the contract an AI layer hands to an LLM (to constrain its output)
   * and validates a returned patch against before {@link ApexGrid.setState}, but
   * it is AI-agnostic: it equally drives a view-editor UI or documentation. It is
   * a descriptor, not a JSON-Schema document. The enterprise grid extends it with
   * grouping / pivot / aggregation availability.
   */
  public getSchema(): GridSchema {
    return {
      version: 1,
      columns: this.columns.map((column) => columnSchema(column)),
      capabilities: {
        sort: {
          directions: SORT_DIRECTIONS.filter((direction) => direction !== 'none'),
          multi: Boolean(this.sortConfiguration?.multiple),
        },
        filter: { operandsByType: operandsByType(this.columns) },
        pagination: Boolean(this.pagination?.enabled),
        selection: this.selection?.enabled ? (this.selection.mode ?? 'multiple') : false,
        rowPinning: Boolean(this.rowPinning?.enabled),
        rowReordering: Boolean(this.rowReordering?.enabled),
      },
      state: this.getState(),
    };
  }

  /**
   * Applies a (partial) state snapshot produced by {@link ApexGrid.getState}.
   *
   * @remarks
   * Only the slices present on `state` are applied — omit a slice to leave it
   * untouched (e.g. pass `{ sort }` to change only sorting). A present-but-empty
   * `sort`/`filter` array clears that operation. Slices are applied in dependency
   * order (columns → sort → filter → quick-filter → module structure → row order
   * → tree → expansion → row pinning → selection → pagination) so row-referencing
   * state resolves against the transformed view. `rowOrder` is mutually exclusive
   * with an active `sort`: a snapshot carrying both keeps the sort and drops
   * `rowOrder`.
   *
   * **Defensive by design.** `setState` is written into by persisted blobs and
   * LLM output, so it never throws on malformed input (unless
   * {@link SetStateOptions.strict}): unknown columns / operands, out-of-range
   * pages, unresolvable rows, and wrong-typed slices are dropped, clamped, or
   * skipped, each recorded in the returned {@link SetStateResult}.
   */
  public setState(state: Partial<GridState>, options?: SetStateOptions<T>): SetStateResult {
    const rowId = options?.rowId ?? this.rowId;
    const strict = options?.strict ?? false;
    const applied: SetStateSlice[] = [];
    const warnings: string[] = [];
    // The view is current only when no row count change is waiting to render;
    // a page can be clamped against it now only if no slice below changes it.
    const viewSettled = !this.#viewStale;
    const warn = (message: string): void => {
      if (strict) throw new Error(`[apex-grid] setState: ${message}`);
      warnings.push(message);
    };

    // Defensive accessors: a wrong-typed slice is skipped with a warning rather
    // than throwing mid-apply.
    const asArray = <V>(value: unknown, label: string): V[] | null => {
      if (value === undefined) return null;
      if (!Array.isArray(value)) {
        warn(`${label}: expected an array, got ${typeof value}; skipped`);
        return null;
      }
      return value as V[];
    };
    const resolveCounted = (refs: ReadonlyArray<RowRef>, label: string): T[] => {
      const rows = resolveRowRefs(refs, this.data, rowId);
      if (rows.length < refs.length) {
        warn(
          `${label}: ${refs.length - rows.length} of ${refs.length} row(s) could not be resolved`
        );
      }
      return rows;
    };

    if (state.version !== undefined && state.version !== 1) {
      warn(
        `unsupported snapshot version ${String(state.version)}; applying recognized slices best-effort`
      );
    }

    const columns = asArray<ColumnLayoutState>(state.columns, 'columns');
    if (columns) {
      const unkeyed = columns.filter((entry) => typeof entry?.key !== 'string').length;
      if (unkeyed)
        warn(`columns: ${unkeyed} entr${unkeyed === 1 ? 'y' : 'ies'} without a key; dropped`);
      this.columns = applyColumnLayout(this.columns, columns);
      applied.push('columns');
    }

    const sort = asArray<SortStateSnapshot>(state.sort, 'sort');
    if (sort) {
      this.#pendingSort = undefined;
      this.#replaceSort(sort, warn);
      applied.push('sort');
    }

    const filter = asArray<GridState['filter'][number]>(state.filter, 'filter');
    if (filter) {
      this.#pendingFilter = undefined;
      const expressions = deserializeFilter<T>(
        filter,
        (key) => this.getColumn(key as Keys<T>),
        (snapshot, reason) => warn(`filter: "${snapshot.key}" dropped (${reason})`)
      );
      this.#replaceFilter(expressions);
      applied.push('filter');
    }

    if (state.quickFilter !== undefined) {
      if (typeof state.quickFilter === 'string') {
        this.quickFilter = state.quickFilter;
        applied.push('quickFilter');
      } else {
        warn(`quickFilter: expected a string, got ${typeof state.quickFilter}; skipped`);
      }
    }

    // Module structure (e.g. grouping / pivot) before the row-referencing slices,
    // so the transformed view exists when selection / expansion are resolved.
    if (state.modules !== undefined) {
      if (state.modules && typeof state.modules === 'object') {
        this.stateController.restoreModuleState(state.modules);
        this.#markViewChange();
        applied.push('modules');
      } else {
        warn(`modules: expected an object, got ${typeof state.modules}; skipped`);
      }
    }

    // Manual row order, applied after sort so the conflict is resolvable here:
    // a manual order is mutually exclusive with sorting, so drop it when the
    // restored state also carries an active sort (the sort wins).
    if (state.rowOrder !== undefined) {
      if (state.rowOrder === null) {
        this.stateController.rowReorder.restoreManualOrder(null);
        applied.push('rowOrder');
      } else {
        const order = asArray<RowRef>(state.rowOrder, 'rowOrder');
        if (order) {
          if (this.sortExpressions.length) {
            warn('rowOrder dropped: a manual order is mutually exclusive with an active sort');
          } else {
            this.stateController.rowReorder.restoreManualOrder(resolveCounted(order, 'rowOrder'));
          }
          applied.push('rowOrder');
        }
      }
    }

    if (state.treeExpanded !== undefined || state.treeExpandedKeys !== undefined) {
      const refs = asArray<RowRef>(state.treeExpanded, 'treeExpanded') ?? [];
      const keys = asArray<string>(state.treeExpandedKeys, 'treeExpandedKeys') ?? [];
      this.stateController.tree.restoreExpansion(
        resolveCounted(refs, 'treeExpanded'),
        keys.filter((key) => typeof key === 'string')
      );
      this.#markViewChange();
      applied.push('tree');
    }

    const expansion = asArray<RowRef>(state.expansion, 'expansion');
    if (expansion) {
      const ctrl = this.stateController.expansion;
      const predicate = this.expansion?.isExpandable;
      const rows = resolveCounted(expansion, 'expansion');
      const expected = predicate ? rows.filter((row) => predicate(row)) : rows;
      if (
        this.#replaceRows('expansion', ctrl.enabled, expected, warn, () => {
          void ctrl.replaceExpansion(expected);
          return ctrl.expandedRows();
        })
      ) {
        applied.push('expansion');
      }
    }

    if (state.rowPinning !== undefined) {
      const pinning = state.rowPinning;
      if (pinning && typeof pinning === 'object') {
        this.stateController.rowPin.restore(
          resolveCounted(asArray<RowRef>(pinning.top, 'rowPinning.top') ?? [], 'rowPinning.top'),
          resolveCounted(
            asArray<RowRef>(pinning.bottom, 'rowPinning.bottom') ?? [],
            'rowPinning.bottom'
          )
        );
        applied.push('rowPinning');
      } else {
        warn(`rowPinning: expected an object, got ${typeof pinning}; skipped`);
      }
    }

    const selection = asArray<RowRef>(state.selection, 'selection');
    if (selection) {
      const ctrl = this.stateController.selection;
      const rows = resolveCounted(selection, 'selection');
      const expected = ctrl.mode === 'single' ? rows.slice(0, 1) : rows;
      if (
        this.#replaceRows('selection', ctrl.enabled, expected, warn, () => {
          void ctrl.replaceSelection(expected);
          return ctrl.selectedRows();
        })
      ) {
        applied.push('selection');
      }
    }

    if (state.pagination !== undefined) {
      const pagination = state.pagination;
      if (pagination && typeof pagination === 'object') {
        const { page, pageSize } = pagination;
        if (pageSize !== undefined) {
          if (typeof pageSize === 'number' && Number.isFinite(pageSize) && pageSize > 0) {
            this.pageSize = pageSize;
          } else {
            warn(`pagination: invalid pageSize ${String(pageSize)}; ignored`);
          }
        }
        if (page !== undefined) {
          if (typeof page === 'number' && Number.isFinite(page)) {
            const requested = Math.trunc(page);
            const reshaped = applied.some((slice) => VIEW_SHAPING_SLICES.has(slice));
            const ctrl = this.stateController.pagination;
            // Against a stale view (before the first render, or with filters
            // or row structure restored above) keep the page as requested and
            // let the reclamp after the pipeline clamp it to the restored view.
            const next = viewSettled && !reshaped ? ctrl.clamp(requested) : Math.max(0, requested);
            if (next !== requested) {
              warn(`pagination: page ${requested} out of range; clamped to ${next}`);
            }
            ctrl.page = next;
          } else {
            warn(`pagination: invalid page ${String(page)}; ignored`);
          }
        }
        applied.push('pagination');
      } else {
        warn(`pagination: expected an object, got ${typeof pagination}; skipped`);
      }
    }

    this.requestUpdate(PIPELINE);

    const skipped = SET_STATE_SLICES.filter((slice) => !applied.includes(slice));
    return { applied, skipped, warnings };
  }

  /**
   * Restore a row slice (selection or expansion) through its controller and
   * report whether it took: a disabled feature or a vetoing `rowSelecting` /
   * `rowExpanding` listener leaves the rows unchanged, which is a warning, not
   * an applied slice. `replace` runs synchronously up to the veto decision.
   */
  #replaceRows(
    label: SetStateSlice,
    enabled: boolean,
    expected: ReadonlyArray<T>,
    warn: (message: string) => void,
    replace: () => ReadonlyArray<T>
  ): boolean {
    if (!enabled) {
      if (expected.length) warn(`${label}: the feature is disabled on this grid; skipped`);
      return !expected.length;
    }
    const actual = new Set(replace());
    const took = actual.size === new Set(expected).size && expected.every((row) => actual.has(row));
    if (!took) warn(`${label}: the change was cancelled by a listener; skipped`);
    return took;
  }

  /**
   * Resets the current sort state of the control.
   */
  public clearSort(key?: Keys<T>) {
    if (this.#pendingSort && key !== undefined) {
      this.#pendingSort = this.#pendingSort.filter((each) => each.key !== key);
    } else {
      this.#pendingSort = undefined;
    }
    this.stateController.sorting.reset(key);
    this.requestUpdate(PIPELINE);
  }

  /**
   * Resets the current filter state of the control.
   */
  public clearFilter(key?: Keys<T>) {
    if (this.#pendingFilter && key !== undefined) {
      this.#pendingFilter = this.#pendingFilter.filter((each) => each.key !== key);
    } else {
      this.#pendingFilter = undefined;
    }
    this.#markViewChange();
    this.stateController.filtering.reset(key);
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
   * pipeline has run. Moving back to the first page fires `pageChanged` too.
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

    const previous = this.quickFilter;
    const writes = this.#quickFilterWrites;
    const proceed = this.emitEvent('quickFilterChanging', {
      detail: { value: previous, nextValue: next },
      cancelable: true,
    });
    if (!proceed) return false;

    // A listener that assigned quickFilter substituted its own value. A
    // substitute equal to the previous value changes nothing.
    if (this.#quickFilterWrites === writes) this.quickFilter = next;
    if (this.quickFilter === previous) return false;
    const pageReset = this.stateController.pagination.resetPage();
    await this.pipelineSettled();
    await pageReset;
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
   * The cell currently in edit mode, or `null`. `rowIndex` is view-relative
   * (matches {@link ApexGrid.pageItems}), or -1 when the edited record is
   * pinned or on another page.
   */
  public get editingCell(): { rowIndex: number; columnKey: Keys<T> } | null {
    const active = this.stateController.editing.activeCell;
    return active ? { rowIndex: active.rowIndex, columnKey: active.columnKey } : null;
  }

  /**
   * The view-relative index of the row currently in edit mode (row edit mode
   * only), or `null`. It is -1 when the edited record is pinned or on another
   * page.
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
   * Applies many cell edits as a **single** operation.
   *
   * Every write goes through the same choke point interactive editing uses, so
   * each one emits the cancellable `cellValueChanging` and then
   * `cellValueChanged`, and runs the column's validators. What differs from
   * calling {@link editCell} + {@link commitEdit} in a loop is that the whole
   * set lands as one undo step and triggers one pipeline run, which is the
   * point: a thousand `editCell` round-trips would be a thousand entries in the
   * undo stack and a thousand re-renders.
   *
   * Name each target cell's row in one of two ways. `rowIndex` is
   * view-relative and matches {@link ApexGrid.pageItems}, the same as
   * {@link editCell}, so it reaches the current page only. `row` is the record
   * itself (a live reference into {@link ApexGrid.data}), which also reaches
   * rows on other pages, pinned rows and rows under a collapsed tree parent;
   * their events and validators see `rowIndex` -1. A `rowIndex` must be a
   * whole number from 0 to `pageItems.length - 1`. Edits naming an unknown
   * column, any other row index (negative, fractional or past the end of the
   * page), a row a feature synthesized (a group header, a total, a row a
   * server has not sent yet), or a column the user could not edit
   * either (editing off, not `editable`, or hidden: the same gate interactive
   * editing uses) are skipped rather than throwing, so a partially-stale batch
   * still applies what it can.
   *
   * @param edits Cells to write. Order is preserved, so later edits to the same
   * cell win.
   * @returns A per-outcome tally. `applied` counts cells whose value actually
   * changed; `unchanged`, `invalid` and `cancelled` explain the rest, so a caller
   * can tell a rejected batch from a no-op one.
   *
   * @example Bulk-clear a column for the rows the user selected, on any page
   * ```ts
   * grid.applyEdits(grid.selectedRows.map((row) => ({ row, column: 'discount', value: 0 })));
   * ```
   */
  public applyEdits(
    edits: ReadonlyArray<
      { column: Keys<T>; value: unknown } & (
        | { rowIndex: number; row?: never }
        | { row: T; rowIndex?: never }
      )
    >
  ): {
    applied: number;
    unchanged: number;
    invalid: number;
    cancelled: number;
    skipped: number;
  } {
    const tally = { applied: 0, unchanged: 0, invalid: 0, cancelled: 0, skipped: 0 };
    if (!edits.length) return tally;

    const editing = this.stateController.editing;
    const items = this.pageItems;
    const indexOf = viewIndexer(items, edits.length);
    const version = editing.validationVersion;
    // One history entry for the batch, so undo reverses the whole thing.
    this.stateController.history.beginBatch();
    try {
      for (const { row, rowIndex, column, value } of edits) {
        const record = row ?? items[rowIndex as number];
        const config = this.getColumn(column);
        if (
          !record ||
          !config ||
          !editing.isEditable(config) ||
          !this.stateController.isDataRow(record)
        ) {
          tally.skipped += 1;
          continue;
        }
        const index = row ? indexOf(row) : (rowIndex as number);
        tally[editing.applyCellEdit(index, column, record, value)] += 1;
      }
    } finally {
      this.stateController.history.endBatch();
    }

    if (tally.applied > 0) this.requestUpdate(PIPELINE);
    // Rejected or reverted values change only the cells' invalid markers.
    else if (editing.validationVersion !== version) this.requestUpdate();
    return tally;
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
   * Whether there is a recorded edit to undo.
   *
   * @remarks
   * Always `false` unless `editing.history.enabled` is set.
   */
  public get canUndo(): boolean {
    return this.stateController.history.canUndo;
  }

  /**
   * Whether there is a previously-undone edit to redo.
   */
  public get canRedo(): boolean {
    return this.stateController.history.canRedo;
  }

  /**
   * Reverts the most recent cell-data edit (single, row-mode, or bulk paste /
   * fill commits each as one step). No-op when there is nothing to undo or
   * history is disabled.
   */
  public undo(): void {
    this.stateController.history.undo();
  }

  /**
   * Re-applies the most recently undone edit. No-op when there is nothing to
   * redo or history is disabled.
   */
  public redo(): void {
    this.stateController.history.redo();
  }

  /**
   * Clears the undo / redo stacks.
   */
  public clearHistory(): void {
    this.stateController.history.clear();
  }

  /**
   * Pins `row` to a sticky top or bottom band, lifting it out of the scrolling
   * body. Moves it between bands when already pinned elsewhere.
   *
   * @remarks
   * Requires `rowPinning.enabled`. Goes through the cancellable `rowPinning`
   * event and emits `rowPinned` on success. Identity is by reference, so pass
   * the same object held in {@link ApexGrid.data}.
   *
   * @returns `true` when applied, `false` when disabled or cancelled.
   */
  public pinRow(row: T, position: RowPinPosition = 'top'): boolean {
    return this.stateController.rowPin.pinRow(row, position);
  }

  /**
   * Unpins `row` from whichever band holds it, returning it to the scrolling
   * body.
   *
   * @returns `true` when applied (or already unpinned), `false` when cancelled.
   */
  public unpinRow(row: T): boolean {
    return this.stateController.rowPin.unpinRow(row);
  }

  /**
   * The currently pinned rows per band, in the order they were pinned.
   */
  public get pinnedRows(): { top: T[]; bottom: T[] } {
    return this.stateController.rowPin.pinnedRows;
  }

  /**
   * Moves the row at view index `from` to land `position` (`'before'` /
   * `'after'`) the row at view index `to`. Indices are into
   * {@link ApexGrid.pageItems}.
   *
   * @remarks
   * Requires `rowReordering.enabled`. Establishes a manual order and clears
   * any column sort (the two are mutually exclusive), goes through the
   * cancellable `rowMoving` event, emits `rowMoved`, and animates the affected
   * rows. Rows hidden by a filter keep their place in the order.
   *
   * @returns `true` when applied, `false` when disabled, out of range, or
   * cancelled.
   */
  public moveRow(from: number, to: number, position: RowDropPosition = 'before'): boolean {
    return this.stateController.rowReorder.moveRow(from, to, position);
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
   * Custom action buttons rendered in the toolbar's trailing actions area, in
   * order.
   *
   * @remarks
   * The community grid contributes none. This is the seam derived grids use to
   * add toolbar buttons (mirroring {@link ApexGrid.exportFormats}):
   * `@apexcharts/grid-enterprise` overrides it to add a "Create chart" action.
   * The toolbar renders one button per entry and calls its `run()` on click.
   */
  public get toolbarActions(): ReadonlyArray<ToolbarAction> {
    return [];
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

    const next = this.columns.slice();
    const [moved] = next.splice(fromIndex, 1);
    let insertIndex = next.findIndex((column) => column.key === toKey);
    if (position === 'after') insertIndex += 1;
    next.splice(insertIndex, 0, moved);
    // A move that changes nothing is a no-op, with no columnMoving.
    if (next.every((column, index) => column === this.columns[index])) return false;

    const proceed = this.emitEvent('columnMoving', {
      detail: { key: fromKey, fromIndex, toKey, position },
      cancelable: true,
    });
    if (!proceed) return false;

    this.columns = next;
    await this.updateComplete;
    const resolvedIndex = this.columns.findIndex((column) => column.key === fromKey);
    this.emitEvent('columnMoved', {
      detail: { key: fromKey, fromIndex, toIndex: resolvedIndex },
    });
    return true;
  }

  /**
   * Whether `event` belongs to this grid, rather than to a grid nested inside
   * it (the grid in a master-detail panel renders inside one of this grid's
   * rows, so its events cross this grid's body on their way out). The first
   * grid, or grid body, on the composed path from the event origin outward is
   * the one that owns it.
   *
   * @param event - an event that reached this grid.
   */
  public ownsEvent(event: Event): boolean {
    for (const node of event.composedPath()) {
      if (node === this || node === this.scrollContainer) return true;
      if (node instanceof ApexGrid || node instanceof ApexVirtualizer) return false;
    }
    return false;
  }

  /**
   * Roving tabindex: once a rendered cell is active it is the body's single
   * tab stop, so the scroll container leaves the tab order. Keeping both
   * focusable would make Shift+Tab bounce off the container back into the
   * grid (a keyboard trap). With no active cell, or with the active row
   * scrolled out of the rendered window, the container is the tab stop.
   */
  #syncBodyTabStop(): void {
    const body = this.scrollContainer;
    if (!body) return;
    const active = this.stateController.active;
    body.tabIndex = active !== SENTINEL_NODE && body.isRendered(active.row) ? -1 : 0;
  }

  /**
   * The virtualizer is about to re-render a new range of rows. When the row
   * holding focus leaves it, its cell is removed and focus would fall to the
   * document, so the scroll container takes focus first and the keyboard
   * keeps working from the active cell.
   */
  protected bodyRangeChanged(event: Event) {
    const { first, last } = event as Event & { first: number; last: number };
    this.#syncBodyTabStop();
    const focused = this.renderRoot instanceof ShadowRoot ? this.renderRoot.activeElement : null;
    if (
      focused instanceof ApexGridRow &&
      focused.parentElement === this.scrollContainer &&
      (focused.index < first || focused.index > last)
    ) {
      this.scrollContainer.focus({ preventScroll: true });
    }
  }

  /** The body cell an event started on, when that cell is one of this grid's. */
  #ownCell(event: Event): ApexGridCell<T> | undefined {
    if (!this.ownsEvent(event)) return undefined;
    return event.composedPath().find((el) => el instanceof ApexGridCell) as
      | ApexGridCell<T>
      | undefined;
  }

  @eventOptions({ capture: true })
  protected bodyClickHandler(event: MouseEvent) {
    if (!this.ownsEvent(event)) return;
    const path = event.composedPath();
    const target = path.find((el) => el instanceof ApexGridCell) as ApexGridCell<T> | undefined;
    if (target) {
      this.stateController.active = {
        column: target.column.key,
        row: target.row.index,
      };
      // The active cell is the body's roving tab stop; give it real focus so
      // keyboard navigation continues from the clicked cell. Skip while an
      // editor is open (the editor owns focus).
      if (!target.editing) target.focus({ preventScroll: true });
    } else {
      // A row a feature module renders full width (a group header, a total
      // row) has no cells; a click on its focus target makes it the active
      // row, keeping the column (the clamp settles it when nothing was active).
      const row = path.find((el) => el instanceof ApexGridRow) as ApexGridRow<T> | undefined;
      const cell = row?.presentedCell;
      if (row && cell && path.includes(cell)) {
        const { column } = this.stateController.active;
        this.stateController.active = { column, row: row.index };
      }
    }
  }

  protected bodyKeydownHandler(event: KeyboardEvent) {
    // Navigation drives from the scroll container (the tab entry point) or
    // from a focused cell (the roving tab stop). Keys originating inside an
    // open editor or an embedded control (button, input) are left alone.
    if (!this.ownsEvent(event)) return;
    const origin = event.composedPath()[0];
    const fromBody = this.scrollContainer.isSameNode(event.target as HTMLElement);
    const fromCell =
      (origin instanceof ApexGridCell && !origin.editing) ||
      (event.target instanceof ApexGridRow && event.target.presentedCell === origin);
    if (fromBody || fromCell) {
      this.stateController.navigation.navigate(event);
    }
  }

  /**
   * Tabbing into the grid body lands on the scroll container; forward focus to
   * the active cell (when one exists) so the roving tab stop is honored.
   */
  protected bodyFocusHandler(event: FocusEvent) {
    if (this.scrollContainer.isSameNode(event.target as HTMLElement)) {
      this.stateController.navigation.focusActiveCell();
    }
  }

  /**
   * Forwards body-cell pointer interactions (press / drag-over / release) to
   * feature modules via {@link StateController.handleCellInteraction}. Gated on
   * there being at least one registered module so the community grid does no
   * per-event work (it registers none). The seam a range-selection feature
   * builds on.
   */
  protected bodyPointerHandler(event: PointerEvent) {
    if (this.stateController.modules.size === 0) return;
    // `pointermove` drives the drag-extend (`over`): tracking the move (not just
    // cell-entry via `pointerover`) means a cell is flagged the instant the
    // cursor crosses into it, even while in-range cells re-render under the
    // pointer. Plain hover moves carry no held button, so skip them — a drag
    // always opens with a `pointerdown` that keeps the button down.
    if (event.type === 'pointermove' && event.buttons === 0) return;
    const target = this.#ownCell(event);
    if (!target?.row) return;
    const kind: CellInteractionKind =
      event.type === 'pointerdown' ? 'down' : event.type === 'pointerup' ? 'up' : 'over';
    this.stateController.handleCellInteraction({
      kind,
      row: target.row.data,
      rowIndex: target.row.index,
      column: target.column,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      originalEvent: event,
    });
  }

  protected renderGroupHeaderRow() {
    if (!this.hasColumnGroups) return nothing;
    return html`
      <apex-grid-group-header-row
        style=${styleMap(this.DOM.columnSizes)}
        .columns=${this.DOM.displayColumns}
        .pinOffsets=${this.DOM.pinOffsets}
        .groups=${this.columnGroups ?? []}
      ></apex-grid-group-header-row>
    `;
  }

  protected renderHeaderRow() {
    return html`
      <apex-grid-header-row
      style=${styleMap(this.DOM.columnSizes)}
      .columns=${this.DOM.displayColumns}
      .pinOffsets=${this.DOM.pinOffsets}
      .coordinateHints=${this.coordinateHints}
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
        @focusin=${this.bodyFocusHandler}
        @rangeChanged=${this.bodyRangeChanged}
        @pointerdown=${this.bodyPointerHandler}
        @pointermove=${this.bodyPointerHandler}
        @pointerup=${this.bodyPointerHandler}
      ></apex-virtualizer>
    `;
  }

  /** Number of chrome rows above the body (group header + header + optional filter). */
  protected get headerRowCount(): number {
    return this.columnGroupDepth + 1 + (this.columns.some((column) => column.filter) ? 1 : 0);
  }

  protected renderPinnedTop() {
    const rowPin = this.stateController.rowPin;
    if (!rowPin.enabled) return nothing;
    const rows = rowPin.pinnedRows.top;
    if (rows.length === 0) return nothing;
    return html`<div part="pinned-rows pinned-top">
      ${rows.map((data, i) => this.DOM.pinnedRowRenderer(data, i, this.headerRowCount))}
    </div>`;
  }

  protected renderPinnedBottom() {
    const rowPin = this.stateController.rowPin;
    if (!rowPin.enabled) return nothing;
    const rows = rowPin.pinnedRows.bottom;
    if (rows.length === 0) return nothing;
    // Pinned-bottom rows follow the chrome rows, the pinned-top band, and the
    // body in the aria-rowindex sequence.
    const offset = this.headerRowCount + rowPin.pinnedRows.top.length + this.pageItems.length;
    return html`<div part="pinned-rows pinned-bottom">
      ${rows.map((data, i) => this.DOM.pinnedRowRenderer(data, i, offset))}
    </div>`;
  }

  protected renderFilterRow() {
    // The filter row is a floating panel overlay (position: fixed), not a grid
    // row. It must stay in the shadow root so the @query selector can find it,
    // but it takes up no layout space when inactive.
    return this.columns.some((column) => column.filter)
      ? html`<apex-filter-row></apex-filter-row>`
      : nothing;
  }

  protected renderToolbar() {
    // Toolbar is shared by all toolbar-housed features. Render it whenever
    // any one of them is enabled.
    if (!this.showQuickFilter && !this.showExport && this.toolbarActions.length === 0) {
      return nothing;
    }
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

  /**
   * Floating "ghost" of the row being pointer-dragged for reorder. Rendered at
   * the top of the shadow tree (outside the virtualizer) so its `position: fixed`
   * tracks the viewport, and painted from the cell snapshot captured at grab
   * time so it mirrors the row's visible content and column widths.
   */
  protected renderRowDragGhost() {
    const ghost = this.stateController.rowReorder.ghost;
    if (!ghost) return nothing;
    return html`<div
      part="row-drag-ghost"
      style=${styleMap({
        left: `${ghost.x}px`,
        top: `${ghost.y}px`,
        height: `${ghost.height}px`,
      })}
    >
      <span part="row-drag-ghost-grip" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="16" height="16">
          <circle cx="6" cy="3.5" r="1.25" />
          <circle cx="10" cy="3.5" r="1.25" />
          <circle cx="6" cy="8" r="1.25" />
          <circle cx="10" cy="8" r="1.25" />
          <circle cx="6" cy="12.5" r="1.25" />
          <circle cx="10" cy="12.5" r="1.25" />
        </svg>
      </span>
      ${ghost.cells.map(
        (cell) =>
          html`<span
            part="row-drag-ghost-cell"
            style=${styleMap({ width: `${cell.width}px`, textAlign: cell.align })}
            >${cell.text}</span
          >`
      )}
    </div>`;
  }

  protected override render() {
    return html`
      ${this.stateController.resizing.renderIndicator()}
      ${this.renderToolbar()}
      ${this.renderGroupHeaderRow()}
      ${this.renderHeaderRow()}
      ${this.renderFilterRow()}
      ${this.renderPinnedTop()}
      ${this.renderBody()}
      ${this.renderPinnedBottom()}
      ${this.renderPaginator()}
      ${this.renderLiveRegion()}
      ${this.renderRowDragGhost()}
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
