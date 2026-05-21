import type { ReactiveControllerHost, TemplateResult } from 'lit';
import type ApexGridCell from '../components/cell.js';
import type { ApexGrid } from '../components/grid.js';
import type ApexGridHeader from '../components/header.js';
import type ApexGridRow from '../components/row.js';
import type { SortComparer } from '../operations/sort/types.js';

export type NavigationState = 'previous' | 'current';
export type GridHost<T extends object> = ReactiveControllerHost & ApexGrid<T>;

/**
 * Helper type for resolving keys of type T.
 */
export type Keys<T> = keyof T;

/**
 * Helper type for resolving types of type T.
 */
export type BasePropertyType<T, K extends Keys<T> = Keys<T>> = T[K];

/**
 * Helper type for resolving types of type T.
 */
export type PropertyType<T, K extends Keys<T> = Keys<T>> = K extends Keys<T>
  ? BasePropertyType<T, K>
  : never;

/**
 * The data type — or, for the declarative built-ins (`'select'`, `'rating'`,
 * `'date'`, `'image'`), the presentation type — for the current column.
 *
 * @remarks
 * - `'string'` / `'number'` are the primitive data types. They drive the
 *   default filter operands, the default editor, and the default sort
 *   comparison.
 * - `'boolean'` stores `true` / `false`. In display mode the grid renders
 *   a check-mark icon for `true` and a dimmed mark for `false`. In edit
 *   mode the default editor is a native checkbox.
 * - `'select'` is a presentation type for columns that store one of a fixed
 *   set of values. Supply the available options via
 *   {@link BaseColumnConfiguration.options}. The cell renders the matching
 *   option's label in display mode and a native `<select>` in edit mode.
 *   For sorting / filtering, select columns behave as their underlying
 *   value type (typically string).
 * - `'rating'` renders a numeric value (0..`max`) as filled stars in display
 *   mode and as an interactive star picker in edit mode. Configure the star
 *   count via {@link BaseColumnConfiguration.max} (defaults to `5`).
 *   For sorting / filtering, rating columns behave as numbers.
 * - `'date'` renders values as locale-aware formatted dates in display mode
 *   and a native `<input type="date">` in edit mode. Accepts `Date`
 *   instances, ISO strings, or millisecond timestamps as input and commits
 *   back in the same shape. Configure the display format via
 *   {@link BaseColumnConfiguration.format} (`'short' | 'medium' | 'long' |
 *   'full'`, default `'medium'`).
 * - `'image'` renders the value as an `<img>` source. Use
 *   {@link BaseColumnConfiguration.shape} to pick between `'square'`
 *   (default) and `'circle'`. The cell's default text editor is used for
 *   editing the URL string when `editable: true` is set.
 */
export type DataType = 'number' | 'string' | 'boolean' | 'select' | 'rating' | 'date' | 'image';

/**
 * Display format presets for `'date'` columns. Map to
 * `Intl.DateTimeFormatOptions.dateStyle`.
 */
export type ColumnDateFormat = 'short' | 'medium' | 'long' | 'full';

/**
 * An entry in a `'select'` column's `options` list. Bare values use
 * `String(value)` as their display label; the explicit form lets you give
 * a value a separate display label.
 */
export type ColumnSelectOption<V = unknown> = V | { value: V; label?: string };

/**
 * Configures the sort behavior for the grid.
 */
export interface GridSortConfiguration {
  /**
   * Whether multiple sorting is enabled.
   */
  multiple: boolean;
  /**
   * Whether tri-state sorting is enabled.
   */
  triState: boolean;
}

/**
 * Extended sort configuration for a column.
 */
export interface BaseColumnSortConfiguration<T, K extends Keys<T> = Keys<T>> {
  /**
   * Whether the sort operations will be case sensitive.
   */
  caseSensitive?: boolean;
  /**
   * Custom comparer function for sort operations for this column.
   */
  comparer?: SortComparer<T, K>;
}

/**
 * See {@link BaseColumnSortConfiguration} for the full documentation.
 */
export type ColumnSortConfiguration<T, K extends Keys<T> = Keys<T>> = K extends Keys<T>
  ? BaseColumnSortConfiguration<T, K>
  : never;

/**
 * Extended filter configuration for a column.
 */
export interface ColumnFilterConfiguration {
  /**
   * Whether the filter operations will be case sensitive.
   */
  caseSensitive?: boolean;
}

/**
 * Pin position for a column.
 *
 * @remarks
 * `'start'` pins the column to the leading edge of the grid (inline-start);
 * `'end'` pins it to the trailing edge. `null` or `undefined` means the column
 * is part of the scrollable region.
 */
export type PinPosition = 'start' | 'end' | null;

/** Configuration object for grid columns. */
export interface BaseColumnConfiguration<T extends object, K extends Keys<T> = Keys<T>> {
  /**
   * The field for from the data the this column will reference.
   */
  key: K;
  /**
   * The type of data this column will reference.
   *
   * Affects the default filter operands if the column is with filtering enabled.
   *
   * @remarks
   * If not passed, `string` is assumed to be the default type.
   *
   */
  type?: DataType;
  /**
   * Optional text to display in the column header. By default, the column key is used
   * to render the header text.
   */
  headerText?: string;
  /**
   * Width for the current column.
   *
   * Accepts most CSS units for controlling width.
   *
   * @remarks
   * If not passed, the column will try to size itself based on the number of other
   * columns and the total width of the grid.
   *
   */
  width?: string;
  /**
   * Whether the column is hidden or not.
   */
  hidden?: boolean;
  /**
   * Pin the column to a side of the grid.
   *
   * @remarks
   * Pinned columns stay fixed during horizontal scroll. Use `'start'` (left in LTR,
   * right in RTL) for the leading edge or `'end'` for the trailing edge. The grid
   * renders columns in the order: `'start'`-pinned, unpinned, `'end'`-pinned, while
   * preserving the original array order inside each group. The `columns` array
   * itself is not mutated.
   */
  pinned?: PinPosition;
  /**
   * Whether this column can be reordered via drag-and-drop or the
   * {@link ApexGrid.moveColumn} API.
   *
   * @remarks
   * Has no effect unless the grid's `columnReordering` flag is `true`. When
   * unset, columns inherit the grid-wide flag. Reordering is constrained to the
   * column's own pinning group — start-pinned columns can only swap with other
   * start-pinned columns, and likewise for end-pinned and unpinned.
   */
  reorderable?: boolean;
  /**
   * Whether the the column can be resized or not.
   */
  resizable?: boolean;
  /**
   * Whether the column can be sorted or not.
   */
  sort?: ColumnSortConfiguration<T, K> | boolean;
  /**
   * Whether filter operation can be applied on the column or not.
   */
  filter?: ColumnFilterConfiguration | boolean;
  /**
   * Header template callback.
   */
  headerTemplate?: (params: ApexHeaderContext<T>) => TemplateResult | unknown;
  /**
   * Cell template callback.
   */
  cellTemplate?: (params: ApexCellContext<T, K>) => TemplateResult | unknown;
  /**
   * Whether values in this column can be edited inline.
   *
   * @remarks
   * Has no effect unless the grid's `editing.enabled` is `true`. The default
   * editor is chosen from the column's `type` (`'string'` → text input,
   * `'number'` → number input, `'boolean'` → checkbox). Supply
   * {@link BaseColumnConfiguration.editorTemplate} for full control.
   */
  editable?: boolean;
  /**
   * Custom editor template invoked while this column's cell is in edit mode.
   *
   * @remarks
   * The callback receives an {@link ApexEditorContext} that includes the cell
   * value plus `commit` / `cancel` helpers. Returning a focusable element is
   * recommended so keyboard handoff works.
   */
  editorTemplate?: (params: ApexEditorContext<T, K>) => TemplateResult | unknown;
  /**
   * Option list for columns with `type: 'select'`.
   *
   * @remarks
   * Each entry is either a bare value or an explicit `{ value, label }` pair.
   * The cell renders the matching option's `label` in display mode and a
   * native `<select>` of all options in edit mode. Has no effect on columns
   * with another `type`.
   */
  options?: ColumnSelectOption<BasePropertyType<T, K>>[];
  /**
   * Star count for columns with `type: 'rating'`.
   *
   * @remarks
   * The displayed value is clamped to the range `[0, max]`. Defaults to `5`.
   * Has no effect on columns with another `type`.
   */
  max?: number;
  /**
   * Display format for columns with `type: 'date'`.
   *
   * @remarks
   * Selects an `Intl.DateTimeFormatOptions.dateStyle` preset. Defaults to
   * `'medium'`. Has no effect on columns with another `type`.
   */
  format?: ColumnDateFormat;
  /**
   * Cropping shape for columns with `type: 'image'`.
   *
   * @remarks
   * `'square'` (default) renders the image at its native aspect. `'circle'`
   * crops to a circle (useful for avatars). Has no effect on columns with
   * another `type`.
   */
  shape?: 'square' | 'circle';
  /**
   * Alt text for `<img>` elements rendered by `type: 'image'` columns.
   *
   * @remarks
   * Defaults to the column key. Has no effect on columns with another
   * `type`.
   */
  alt?: string;
}

/**
 * See {@link BaseColumnConfiguration} for the full documentation.
 */
export type ColumnConfiguration<T extends object, K extends Keys<T> = Keys<T>> = K extends Keys<T>
  ? BaseColumnConfiguration<T, K>
  : never;

export interface ActiveNode<T> {
  column: Keys<T>;
  row: number;
}

/**
 * Context object for the column header template callback.
 */
export interface ApexHeaderContext<T extends object> {
  /**
   * The header element parent of the template.
   */
  parent: ApexGridHeader<T>;
  /**
   * The current configuration for the column.
   */
  column: ColumnConfiguration<T>;
}

/**
 * Context object for the row cell template callback.
 */
export interface BaseApexCellContext<T extends object, K extends Keys<T> = Keys<T>> {
  /**
   * The cell element parent of the template.
   */
  parent: ApexGridCell<T>;
  /**
   * The row element containing the cell.
   */
  row: ApexGridRow<T>;
  /**
   * The current configuration for the column.
   */
  column: ColumnConfiguration<T, K>;
  /**
   * The value from the data source for this cell.
   */
  value: PropertyType<T, K>;
  /**
   * Commits a new value for this cell without entering edit mode. Available
   * when the column is editable. Used by interactive display widgets
   * (e.g. the built-in boolean checkbox) so they can toggle inline.
   *
   * Goes through the cancellable `cellValueChanging` event and follow-up
   * `cellValueChanged` event — same write path as an edit-mode commit.
   */
  commit?: (value: PropertyType<T, K>) => Promise<boolean>;
}

/**
 * See {@link BaseApexCellContext} for the full documentation.
 */
export type ApexCellContext<T extends object, K extends Keys<T> = Keys<T>> = K extends Keys<T>
  ? BaseApexCellContext<T, K>
  : never;

/**
 * Context object handed to a custom editor template.
 *
 * @remarks
 * Includes the cell's current `value` plus `commit` / `cancel` callbacks so
 * the editor can hand its result back to the grid. The custom editor is also
 * responsible for forwarding `Enter` / `Escape` to those callbacks.
 */
export interface BaseApexEditorContext<T extends object, K extends Keys<T> = Keys<T>>
  extends BaseApexCellContext<T, K> {
  /**
   * Commits `value` as the new cell value, going through the cancellable
   * `cellValueChanging` event and then `cellValueChanged`.
   *
   * @returns `true` if the value was applied, `false` if cancelled.
   */
  commit: (value: PropertyType<T, K>) => Promise<boolean>;
  /**
   * Discards the in-progress edit and exits edit mode.
   */
  cancel: () => void;
}

/**
 * See {@link BaseApexEditorContext} for the full documentation.
 */
export type ApexEditorContext<T extends object, K extends Keys<T> = Keys<T>> = K extends Keys<T>
  ? BaseApexEditorContext<T, K>
  : never;

/**
 * The edit trigger used to enter cell edit mode.
 *
 * @remarks
 * `'click'` enters edit on a single click on the cell; `'doubleClick'`
 * requires a double click. Defaults to `'doubleClick'`.
 */
export type EditTrigger = 'click' | 'doubleClick';

/**
 * Edit mode for the grid.
 *
 * @remarks
 * `'cell'` — each cell is committed independently on blur or `Enter`.
 * `'row'` — all editable cells in the row enter edit mode together; changes
 *  are batched and applied via {@link ApexGrid.commitEdit} or rolled back via
 *  {@link ApexGrid.cancelEdit}.
 */
export type EditMode = 'cell' | 'row';

/**
 * Selection mode for the grid.
 *
 * @remarks
 * `'single'` — at most one row may be selected at any time. New clicks
 * replace the existing selection.
 * `'multiple'` — multiple rows can be selected. Plain clicks replace the
 * selection, Ctrl/Cmd+click toggles a row additively, and Shift+click
 * selects a range from the previous anchor.
 */
export type SelectionMode = 'single' | 'multiple';

/**
 * Grid-level row-selection configuration.
 */
export interface GridSelectionConfiguration {
  /**
   * Whether row selection is enabled. Disabled by default.
   */
  enabled?: boolean;
  /**
   * Single-row vs multi-row selection. Defaults to `'multiple'`.
   */
  mode?: SelectionMode;
  /**
   * Whether to render the built-in checkbox column at the start of every
   * row. When `false`, selection is still available via the public API
   * (`selectRow`, `selectedRows = ...`) and via Space on the active row.
   * Defaults to `false`.
   */
  showCheckboxColumn?: boolean;
}

/**
 * Grid-level editing configuration.
 */
export interface GridEditingConfiguration {
  /**
   * Whether editing is enabled. Per-column opt-in still applies via
   * {@link BaseColumnConfiguration.editable}.
   */
  enabled?: boolean;
  /**
   * Whether each cell commits independently or whether the whole row is edited
   * as a batch. Defaults to `'cell'`.
   */
  mode?: EditMode;
  /**
   * The interaction that opens an editor. Defaults to `'doubleClick'`.
   */
  trigger?: EditTrigger;
}

/**
 * The parameters passed to a {@link DataPipelineHook} callback.
 */
export type DataPipelineParams<T extends object> = {
  /**
   * The current data state of the grid.
   */
  data: T[];
  /**
   * The grid component itself.
   */
  grid: ApexGrid<T>;
  /**
   * The type of data operation being performed.
   */
  type: 'sort' | 'filter' | 'quickFilter' | 'pagination';
};

/**
 * Callback function for customizing data operations in the grid.
 */
export type DataPipelineHook<T extends object> = (
  state: DataPipelineParams<T>
) => T[] | Promise<T[]>;

/**
 * Configuration for customizing the various data operations of the grid.
 */
export interface DataPipelineConfiguration<T extends object> {
  /**
   * Hook for customizing sort operations.
   */
  sort?: DataPipelineHook<T>;
  /**
   * Hook for customizing filter operations.
   */
  filter?: DataPipelineHook<T>;
  /**
   * Hook for customizing pagination operations.
   *
   * @remarks
   * The hook receives the filtered + sorted data slice for the grid to render and the current
   * pagination state. Return the page slice. For server-driven pagination, return the externally
   * fetched page and report the row total via {@link ApexGrid.totalItems}.
   */
  pagination?: DataPipelineHook<T>;
  /**
   * Hook for customizing quick (global) filter operations.
   *
   * @remarks
   * Called before column filtering. Return the records that match the {@link ApexGrid.quickFilter}
   * value. If omitted, the default substring matcher is used.
   */
  quickFilter?: DataPipelineHook<T>;
}

/**
 * The pagination mode for the grid.
 *
 * @remarks
 * `'local'` — the grid slices the in-memory {@link ApexGrid.dataView} by `page` and `pageSize`.
 * `'remote'` — the consumer drives data fetching; the grid emits paging events but does not
 *  slice the data. Use together with {@link DataPipelineConfiguration.pagination} or by setting
 *  `data` to the current page on `pageChanged`.
 */
export type PaginationMode = 'local' | 'remote';

/**
 * Pagination configuration for the grid.
 */
export interface PaginationConfiguration {
  /**
   * Whether pagination is enabled.
   *
   * @remarks
   * When `false`, the grid renders no paginator and applies no slicing — the full
   * {@link ApexGrid.dataView} is virtualized as usual.
   */
  enabled?: boolean;
  /**
   * The pagination mode. Defaults to `'local'`.
   */
  mode?: PaginationMode;
  /**
   * The current page (zero-based). Defaults to `0`.
   */
  page?: number;
  /**
   * The number of records per page. Defaults to `25`.
   */
  pageSize?: number;
  /**
   * The list of page sizes offered in the paginator's page-size dropdown.
   * Defaults to `[10, 25, 50, 100]`.
   */
  pageSizeOptions?: number[];
  /**
   * In `'remote'` mode the consumer must supply the unfiltered row total so the paginator
   * can compute the page count. Ignored in `'local'` mode.
   */
  totalItems?: number;
}

/**
 * Resolved pagination state passed to controllers and event payloads.
 */
export interface PaginationState {
  /**
   * The current page (zero-based).
   */
  page: number;
  /**
   * The number of records per page.
   */
  pageSize: number;
  /**
   * The total number of pages.
   */
  pageCount: number;
  /**
   * The total number of records before pagination (after filter/sort).
   */
  totalItems: number;
}
