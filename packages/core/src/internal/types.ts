import type { ReactiveControllerHost, TemplateResult } from 'lit';
import type ApexGridCell from '../components/cell.js';
import type { ApexGrid } from '../components/grid.js';
import type ApexGridHeader from '../components/header.js';
import type ApexGridRow from '../components/row.js';
import type { SortComparer } from '../operations/sort/types.js';

export type NavigationState = 'previous' | 'current';
export type GridHost<T extends object> = ReactiveControllerHost & ApexGrid<T>;

/**
 * A custom action button contributed to the toolbar's trailing actions area.
 *
 * @remarks
 * The seam derived grids use to add toolbar buttons, mirroring the export-format
 * seam: the community grid contributes none (its {@link ApexGrid.toolbarActions}
 * returns `[]`), and the toolbar renders one button per entry, invoking
 * {@link ToolbarAction.run} on click.
 */
export interface ToolbarAction {
  /** Stable identifier, e.g. `'create-chart'`. */
  id: string;
  /** Button label. */
  label: string;
  /** Invoked when the button is clicked. */
  run(): void;
}

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
export type PropertyType<T, K extends Keys<T> = Keys<T>> =
  K extends Keys<T> ? BasePropertyType<T, K> : never;

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
 *
 * The remaining types are premium presentation renderers over primitive
 * values; for sorting / filtering they behave as their underlying value type:
 * - `'currency'` formats a number via `Intl.NumberFormat` (tabular, right
 *   aligned). Configure with {@link BaseColumnConfiguration.currency} /
 *   {@link BaseColumnConfiguration.locale}. Editable via a number input.
 * - `'avatar'` renders the value's first letter in a tinted circle (hue is
 *   derived from the value, stable per row).
 * - `'badge'` renders the value as a colored pill. Pick the look with
 *   {@link BaseColumnConfiguration.badgeVariant}.
 * - `'progress'` renders a number (0..`max`, default `max` 100) as a health
 *   bar; the fill color tiers at ≥80 / ≥65 / below.
 * - `'sparkline'` renders a `number[]` as an inline trend chart with an
 *   optional delta label ({@link BaseColumnConfiguration.showDelta}).
 * - `'status'` renders a pill with a leading dot. The state is taken from
 *   {@link BaseColumnConfiguration.statusVariant} or inferred from the value.
 */
export type DataType =
  | 'number'
  | 'string'
  | 'boolean'
  | 'select'
  | 'rating'
  | 'date'
  | 'image'
  | 'currency'
  | 'avatar'
  | 'badge'
  | 'progress'
  | 'sparkline'
  | 'status';

/** Visual variant for a `type: 'badge'` pill. */
export type BadgeVariant = 'gold' | 'brand' | 'neutral' | 'muted';

/** State for a `type: 'status'` badge. */
export type StatusVariant = 'active' | 'trial' | 'churn';

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
export type ColumnSortConfiguration<T, K extends Keys<T> = Keys<T>> =
  K extends Keys<T> ? BaseColumnSortConfiguration<T, K> : never;

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
   * Whether this column is included when exporting via
   * {@link ApexGrid.exportToCSV} (or the enterprise grid's XLSX export).
   *
   * @remarks
   * Defaults to `true`. Set to `false` to omit a column from generated files
   * (useful for action columns, derived UI, or sensitive fields). The
   * grid-rendered selection checkbox column is never exported regardless of
   * this flag.
   */
  exportable?: boolean;
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
   * Declarative validators run before a candidate value is written to this
   * column's cells.
   *
   * @remarks
   * Each validator receives the candidate value and a {@link ValidatorContext}
   * and returns an error message string (the cell is rejected) or `null` (it
   * passes). All validators run and every message is collected, so a single
   * failed commit can surface multiple errors. A failing commit keeps the
   * inline editor open, marks the cell `aria-invalid`, and emits
   * `cellValidationFailed`. Validation also covers bulk edits (paste / fill).
   * Use the built-in factories ({@link required}, {@link min}, {@link max},
   * {@link pattern}, {@link custom}) or supply your own function.
   */
  validators?: Validator<T, K>[];
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
   * Upper bound for `type: 'rating'` and `type: 'progress'`.
   *
   * @remarks
   * For `'rating'` this is the star count (default `5`); the displayed value is
   * clamped to `[0, max]`. For `'progress'` this is the value that fills the bar
   * to 100% (default `100`). Has no effect on columns with another `type`.
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
  /**
   * ISO 4217 currency code for `type: 'currency'` columns (e.g. `'USD'`,
   * `'EUR'`). Defaults to `'USD'`. Has no effect on columns with another
   * `type`.
   */
  currency?: string;
  /**
   * BCP 47 locale for `type: 'currency'` number formatting. Defaults to the
   * runtime locale. Has no effect on columns with another `type`.
   */
  locale?: string;
  /**
   * Visual variant for `type: 'badge'` columns. A literal applies to every
   * cell; a callback picks per value. Defaults to `'neutral'`. Has no effect
   * on columns with another `type`.
   */
  badgeVariant?: BadgeVariant | ((value: BasePropertyType<T, K>) => BadgeVariant);
  /**
   * State for `type: 'status'` columns. A literal applies to every cell; a
   * callback maps a value to a state. When omitted the state is inferred from
   * the value text. Has no effect on columns with another `type`.
   */
  statusVariant?: StatusVariant | ((value: BasePropertyType<T, K>) => StatusVariant);
  /**
   * Whether `type: 'sparkline'` columns render a trailing delta-% label.
   * Defaults to `true`. Has no effect on columns with another `type`.
   */
  showDelta?: boolean;
}

/**
 * See {@link BaseColumnConfiguration} for the full documentation.
 */
export type ColumnConfiguration<T extends object, K extends Keys<T> = Keys<T>> =
  K extends Keys<T> ? BaseColumnConfiguration<T, K> : never;

/**
 * Context passed to a {@link Validator} alongside the candidate value.
 */
export interface ValidatorContext<T extends object, K extends Keys<T> = Keys<T>> {
  /** The column configuration the value is being validated against. */
  column: ColumnConfiguration<T, K>;
  /** The full data record being edited (a live reference). */
  data: T;
  /** The view-relative row index of the edited cell. */
  rowIndex: number;
}

/**
 * A single declarative validation rule for a column.
 *
 * @returns An error message string when the value is invalid, or `null` when
 * it passes.
 */
export type Validator<T extends object, K extends Keys<T> = Keys<T>> = (
  value: unknown,
  context: ValidatorContext<T, K>
) => string | null;

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
export type ApexCellContext<T extends object, K extends Keys<T> = Keys<T>> =
  K extends Keys<T> ? BaseApexCellContext<T, K> : never;

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
export type ApexEditorContext<T extends object, K extends Keys<T> = Keys<T>> =
  K extends Keys<T> ? BaseApexEditorContext<T, K> : never;

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
 * Context passed to {@link GridExpansionConfiguration.detailTemplate}.
 */
export interface ApexDetailContext<T extends object> {
  /** The row data for the expanded row. */
  data: T;
  /** The view-relative row index of the master row. */
  rowIndex: number;
  /** The grid element. Useful for emitting events back from the detail. */
  parent: ApexGrid<T>;
}

/**
 * Grid-level tree-data (nested rows) configuration.
 *
 * @remarks
 * Tree mode renders hierarchical data as nested rows that share the same
 * column layout — collapsible parents with indented children, the
 * flat-array "tree data" pattern. The data array stays flat; the grid derives the
 * hierarchy from {@link getDataPath} at runtime.
 *
 * This is distinct from {@link GridExpansionConfiguration} (master-detail),
 * which expands a row to show an arbitrary detail panel. Tree mode and
 * expansion mode can be enabled together, but the chevron column is
 * reserved by whichever is currently rendering the chevron — typically the
 * tree feature when both are enabled.
 *
 * @example
 * ```ts
 * grid.tree = {
 *   enabled: true,
 *   getDataPath: (row) => row.path,
 * };
 * ```
 */
export interface GridTreeConfiguration<T extends object> {
  /** Whether tree mode is enabled. Disabled by default. */
  enabled?: boolean;
  /**
   * Callback that returns the hierarchical path for a row. The path is a
   * sequence of segments from root to the row's own position — for example
   * `['Adrian']` for a CEO, `['Adrian', 'Bryan']` for a VP under Adrian,
   * and so on. Required when `enabled` is `true`.
   */
  getDataPath: (row: T) => readonly string[];
  /**
   * Which column displays the chevron + indentation. Defaults to the first
   * visible non-hidden data column.
   */
  groupColumnKey?: Keys<T>;
  /**
   * Initial expansion state:
   * - `false` (default): all rows collapsed.
   * - `true`: every row expanded.
   * - `number`: expand all rows up to and including the given depth (0 = roots only).
   */
  defaultExpanded?: boolean | number;
  /**
   * Pixels of indentation per depth level. Defaults to `20`.
   */
  childIndent?: number;
}

/**
 * Grid-level row-expansion (master-detail) configuration.
 */
export interface GridExpansionConfiguration<T extends object> {
  /**
   * Whether row expansion is enabled. Disabled by default.
   */
  enabled?: boolean;
  /**
   * Callback that produces the detail panel content for an expanded row.
   * Required when `enabled` is `true`.
   */
  detailTemplate?: (context: ApexDetailContext<T>) => TemplateResult | unknown;
  /**
   * Optional per-row predicate that gates which rows may be expanded. When
   * omitted, every row is expandable.
   */
  isExpandable?: (row: T) => boolean;
  /**
   * Whether to render the built-in chevron toggle column at the start of
   * every row (after the selection column, when present). Defaults to `true`.
   * Set to `false` to drive expansion entirely through the public API or a
   * custom cell template.
   */
  showToggleColumn?: boolean;
}

/**
 * Undo / redo history configuration for cell-data edits.
 */
export interface EditingHistoryConfiguration {
  /**
   * Whether undo / redo tracking is enabled. When `true`, every committed cell
   * edit (single, row-mode, and bulk paste / fill) is recorded and can be
   * reversed via {@link ApexGrid.undo} / {@link ApexGrid.redo} or the keyboard
   * (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y).
   */
  enabled: boolean;
  /**
   * Maximum number of commands retained on the undo stack. Older commands are
   * evicted once the cap is exceeded. Defaults to `100`.
   */
  stackSize?: number;
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
  /**
   * Undo / redo history for cell-data edits. Disabled when omitted.
   */
  history?: EditingHistoryConfiguration;
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
