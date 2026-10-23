import { createContext } from '@lit/context';
import type { ReactiveController } from 'lit';
import type { GridLocaleKey, LocaleParams } from '../i18n/index.js';
import {
  type CellDecoration,
  type CellDecoratorContext,
  type CellInteraction,
  type GridFeatureModule,
  isCellDecorator,
  isCellInteractionHandler,
  isColumnMenuProvider,
  isCoordinateLabeler,
  isRowAriaProvider,
  isRowPresenter,
  isRowTransformer,
  isSerializableModule,
  type PresentedRow,
  type RowAria,
  type RowAriaProvider,
  type RowPresenterContext,
  type RowTransformer,
} from '../internal/feature-module.js';
import type { ActiveNode, ColumnConfiguration, GridHost } from '../internal/types.js';
import { isNumericColumn } from '../internal/utils.js';
import { EditingController } from './editing.js';
import { ExpansionController } from './expansion.js';
import { FilterController } from './filter.js';
import { HistoryController } from './history.js';
import { NavigationController } from './navigation.js';
import { PaginationController } from './pagination.js';
import { ReorderController } from './reorder.js';
import { ResizeController } from './resize.js';
import { RowPinController } from './row-pin.js';
import { RowReorderController } from './row-reorder.js';
import { SelectionController } from './selection.js';
import { SortController } from './sort.js';
import { TreeController } from './tree.js';

export class StateController<T extends object> implements ReactiveController {
  public sorting!: SortController<T>;
  public filtering!: FilterController<T>;
  public navigation!: NavigationController<T>;
  public resizing!: ResizeController<T>;
  public pagination!: PaginationController<T>;
  public reordering!: ReorderController<T>;
  public editing!: EditingController<T>;
  public history!: HistoryController<T>;
  public selection!: SelectionController<T>;
  public expansion!: ExpansionController<T>;
  public tree!: TreeController<T>;
  public rowPin!: RowPinController<T>;
  public rowReorder!: RowReorderController<T>;

  /**
   * Optional feature controllers contributed by {@link GridFeatureModule}s,
   * keyed by module id. Empty for the community `<apex-grid>` element; populated
   * by derived grids (e.g. `@apexcharts/grid-enterprise`) that pass modules to
   * the constructor.
   */
  public readonly modules = new Map<string, ReactiveController>();

  /**
   * Current message in the grid's polite live region. Bound by the host's
   * `renderLiveRegion()` template; mutated through {@link setAnnouncement}
   * so screen readers re-announce on every change.
   */
  public announcement = '';
  #announceToken = 0;

  /**
   * Updates the polite live region's text. Repeats are forced to fire by
   * appending a zero-width space — screen readers ignore unchanged content,
   * so two identical sort announcements wouldn't otherwise be read aloud.
   */
  public setAnnouncement(message: string): void {
    if (!message) {
      this.announcement = '';
      this.host.requestUpdate();
      return;
    }
    this.#announceToken = (this.#announceToken + 1) % 2;
    // Escaped on purpose: a literal zero-width space is invisible in review
    // and an ordinary space would be collapsed out of the accessible text.
    this.announcement = this.#announceToken ? message : `${message}\u200B`;
    this.host.requestUpdate();
  }

  /**
   * Resolves a built-in locale key to its display string, honoring the host
   * grid's {@link ApexGrid.localeText} overrides. Thin proxy to
   * {@link ApexGrid.localize} so components can localize via `this.state`.
   */
  public localize(key: GridLocaleKey, params?: LocaleParams, fallback?: string): string {
    return this.host.localize(key, params, fallback);
  }

  /**
   * Whether `column` holds numbers (`'number'`, `'currency'`, `'rating'`,
   * `'progress'`), so it filters with the number operands and a numeric term.
   * The one numeric-type rule the core filter applies; features that classify
   * columns should read it here rather than keep their own list.
   */
  public isNumericColumn(column: Pick<ColumnConfiguration<T>, 'type'>): boolean {
    return isNumericColumn(column);
  }

  public get active() {
    return this.navigation.active;
  }

  public set active(node: ActiveNode<T>) {
    this.navigation.active = node;
  }

  public get headerRow() {
    // @ts-expect-error - Protected member access
    return this.host.headerRow;
  }

  public get scrollContainer() {
    // @ts-expect-error - Protected member access
    return this.host.scrollContainer;
  }

  public get paginator() {
    // @ts-expect-error - Protected member access
    return this.host.paginator;
  }

  public get toolbar() {
    // @ts-expect-error - Protected member access
    return this.host.toolbar;
  }

  /**
   * Cumulative pin offsets (in px) keyed by column key. Populated by the
   * {@link GridDOMController} after each layout.
   */
  public get pinOffsets(): Map<unknown, number> {
    // @ts-expect-error - Protected member access
    const dom = this.host.DOM as { pinOffsets?: Map<unknown, number> } | undefined;
    return dom?.pinOffsets ?? new Map();
  }

  constructor(
    public host: GridHost<T>,
    private extraModules: ReadonlyArray<GridFeatureModule<T>> = []
  ) {
    this.host.addController(this);
    this.init();
  }

  protected init() {
    this.sorting = new SortController(this.host);
    this.filtering = new FilterController(this.host);
    this.navigation = new NavigationController(this.host);
    this.resizing = new ResizeController(this.host);
    this.pagination = new PaginationController(this.host);
    this.reordering = new ReorderController(this.host);
    this.history = new HistoryController(this.host);
    this.editing = new EditingController(this.host, this.history);
    this.selection = new SelectionController(this.host);
    this.expansion = new ExpansionController(this.host);
    this.tree = new TreeController(this.host);
    this.rowPin = new RowPinController(this.host);
    this.rowReorder = new RowReorderController(this.host);

    for (const module of this.extraModules) {
      if (this.modules.has(module.id)) continue;
      this.modules.set(module.id, module.create(this.host, this));
    }

    // Resolve the row transforms once, in their declared order. Array sort is
    // stable, so equal (or unset) orders keep registration order.
    if (this.modules.size) {
      const transformers: RowTransformer<T>[] = [];
      for (const controller of this.modules.values()) {
        if (isRowTransformer<T>(controller)) transformers.push(controller);
      }
      transformers.sort((a, b) => (a.transformOrder ?? 0) - (b.transformOrder ?? 0));
      this.#transformers = transformers;
      this.#synthesizers = transformers.filter((t) => typeof t.isSyntheticRow === 'function');
    }
  }

  /** {@link RowTransformer}s sorted by `transformOrder`. Empty for the community grid. */
  #transformers: ReadonlyArray<RowTransformer<T>> = [];
  /** The transformers that can synthesize rows. Empty for the community grid. */
  #synthesizers: ReadonlyArray<RowTransformer<T>> = [];

  /** The controllers each hook guard matched, keyed by the guard. */
  #hooks = new Map<unknown, unknown[]>();

  /**
   * The module controllers implementing a hook, in registration order. The
   * module set is fixed once {@link init} returns (modules are passed to the
   * constructor only), so each hook's list is resolved on first use and the
   * per-row and per-cell dispatchers walk it instead of guarding every module.
   */
  #withHook<C>(guard: (controller: unknown) => controller is C): C[] {
    let list = this.#hooks.get(guard);
    if (!list) {
      list = [...this.modules.values()].filter(guard);
      this.#hooks.set(guard, list);
    }
    return list as C[];
  }

  /**
   * Look up a feature controller contributed by a {@link GridFeatureModule},
   * by its module id. Returns `undefined` when no such module is registered.
   */
  public module<C extends ReactiveController>(id: string): C | undefined {
    return this.modules.get(id) as C | undefined;
  }

  /**
   * Runs the post-pipeline row transforms contributed by feature modules
   * implementing {@link RowTransformer}, in ascending
   * {@link RowTransformer.transformOrder} (registration order breaks ties).
   * Returns the input unchanged when no such module is registered, so the
   * community grid path is a no-op pass-through.
   */
  public applyModuleTransforms(rows: T[]): T[] {
    let result = rows;
    for (const transformer of this.#transformers) {
      result = transformer.processRows(result);
    }
    return result;
  }

  /**
   * Whether `row` is a data record, as opposed to a row a feature module
   * synthesized into the view (a group header, a grand-total row). Every
   * consumer that treats the view as records (selection, export, paste, charts,
   * keyboard actions) should skip rows for which this is `false`. A row is
   * synthetic when any {@link RowTransformer} claims it through
   * {@link RowTransformer.isSyntheticRow}. Always `true` for the community grid,
   * which registers no modules, at the cost of one length check.
   */
  public isDataRow(row: T): boolean {
    for (const transformer of this.#synthesizers) {
      if (transformer.isSyntheticRow!(row)) return false;
    }
    return true;
  }

  /**
   * The data records of `rows` (see {@link isDataRow}), in order. Returns `rows`
   * itself, not a copy, when no module synthesizes rows (the community grid).
   */
  public dataRows(rows: ReadonlyArray<T>): ReadonlyArray<T> {
    if (this.#synthesizers.length === 0) return rows;
    return rows.filter((row) => this.isDataRow(row));
  }

  /**
   * Every data record `rows` (a view) covers, in order: its data rows plus the
   * records a synthesized row hides through
   * {@link RowTransformer.hiddenRecords} (a collapsed group's leaves). This is
   * what Select all selects and a `'view'` export writes. Returns `rows`
   * itself when no module synthesizes rows (the community grid).
   */
  public viewRecords(rows: ReadonlyArray<T>): ReadonlyArray<T> {
    if (this.#synthesizers.length === 0) return rows;
    const out: T[] = [];
    for (const row of rows) {
      if (this.isDataRow(row)) {
        out.push(row);
        continue;
      }
      for (const transformer of this.#synthesizers) {
        const hidden = transformer.hiddenRecords?.(row);
        if (!hidden?.length) continue;
        // A loop, not push(...hidden): a collapsed group can hold more leaves
        // than the engine accepts as call arguments.
        for (const record of hidden) out.push(record);
        break;
      }
    }
    return out;
  }

  /**
   * Asks feature modules implementing {@link RowPresenter} whether they render
   * the given row as full-width custom content (e.g. a group header). Returns
   * the first non-null result, or `null` when no module owns the row.
   */
  public presentRow(row: T, ctx: RowPresenterContext<T>): PresentedRow | null {
    for (const controller of this.#withHook(isRowPresenter<T>)) {
      const presented = controller.presentRow(row, ctx);
      if (presented) return presented;
    }
    return null;
  }

  /**
   * Columns in the `aria-colindex` sequence: the visible columns plus the
   * selection and expansion chrome columns. Shared by `aria-colcount` and the
   * cells that span a whole row.
   */
  public get colCount(): number {
    return (
      this.host.columns.filter((column) => !column.hidden).length +
      (this.selection.showCheckboxColumn ? 1 : 0) +
      (this.expansion.showToggleColumn ? 1 : 0)
    );
  }

  /**
   * Whether rows carry tree semantics (`aria-level` / `aria-expanded`), which
   * only a `treegrid` supports: the core tree, master-detail, or a feature
   * module that reports {@link RowPresenter.hierarchical} (row grouping, a
   * pivot tree, server-side groups). The grid role is read from here.
   */
  public get hierarchical(): boolean {
    // Master-detail rows can expand once there is a detail to show.
    if (this.tree.enabled || (this.expansion.enabled && this.host.expansion?.detailTemplate)) {
      return true;
    }
    for (const controller of this.modules.values()) {
      if ((controller as RowAriaProvider<T>).hierarchical) return true;
    }
    return false;
  }

  /**
   * Asks feature modules implementing {@link RowAriaProvider} for ARIA
   * tree/expansion semantics on a normal (cell-rendered) row — e.g. pivoting's
   * expandable parent rows. Returns the first non-null result, or `null`.
   */
  public describeRow(row: T, ctx: RowPresenterContext<T>): RowAria | null {
    for (const controller of this.#withHook(isRowAriaProvider<T>)) {
      const aria = controller.describeRow(row, ctx);
      if (aria) return aria;
    }
    return null;
  }

  /**
   * The coordinate-hint label a module gives a row ({@link CoordinateLabeler}),
   * `null` for none, or `undefined` when no module labels rows (the gutter then
   * shows the view position). Only asked while `coordinateHints` is on.
   */
  public rowCoordinate(row: T): string | null | undefined {
    for (const controller of this.#withHook(isCoordinateLabeler<T>)) {
      const label = controller.rowCoordinate(row);
      if (label !== undefined) return label;
    }
    return undefined;
  }

  /** The coordinate-hint letter a module gives a column; see {@link rowCoordinate}. */
  public columnCoordinate(key: string): string | null | undefined {
    for (const controller of this.#withHook(isCoordinateLabeler<T>)) {
      const label = controller.columnCoordinate(key);
      if (label !== undefined) return label;
    }
    return undefined;
  }

  /**
   * Monotonic token bumped by {@link bumpDecoration} whenever module-driven cell
   * decoration changes. Forwarded down to each cell as a reactive property so a
   * decoration-only change (e.g. dragging a selection range) re-decorates cells
   * without re-running the data pipeline. Always `0` for the community grid.
   */
  #decorationVersion = 0;

  public get decorationVersion(): number {
    return this.#decorationVersion;
  }

  /**
   * Monotonic token the grid bumps once per data pipeline run, forwarded to
   * each body row and cell, so a cell whose output reads more than its own
   * value (a `cellTemplate` reading other row fields, the tree group cell's
   * chevron) re-renders after an edit, a data change or a tree toggle,
   * although its own value binding did not change.
   */
  public dataVersion = 0;

  /**
   * Signals that {@link CellDecorator} output may have changed. Bumps the
   * {@link decorationVersion} and requests a host update so cells re-run their
   * decoration. Called by feature modules after mutating decoration state.
   */
  public bumpDecoration(): void {
    this.#decorationVersion += 1;
    this.host.requestUpdate();
  }

  /**
   * Whether any feature module implementing {@link ColumnMenuProvider} offers a
   * column header menu. The header uses this to show its kebab button even on
   * columns that are neither sortable nor resizable, so a module (the enterprise
   * context menu) can surface pin / hide / group / chart actions. Always `false`
   * for the community grid (no modules).
   */
  public get hasColumnMenu(): boolean {
    return this.#withHook(isColumnMenuProvider).some((controller) =>
      controller.providesColumnMenu()
    );
  }

  /**
   * Whether any feature module implements {@link CellDecorator}, so a cell can
   * skip decoration altogether when none does (the community grid).
   */
  public get hasCellDecorators(): boolean {
    return this.#withHook(isCellDecorator).length > 0;
  }

  /**
   * Collects per-cell decoration contributed by feature modules implementing
   * {@link CellDecorator}, merging their attribute maps (later modules win on a
   * key clash). Returns `null` when no module decorates the cell — the community
   * grid path, where each cell applies nothing.
   */
  public decorateCell(ctx: CellDecoratorContext<T>): CellDecoration | null {
    let attributes: Record<string, string | null | undefined> | null = null;
    for (const controller of this.#withHook(isCellDecorator<T>)) {
      const decoration = controller.decorateCell(ctx);
      if (decoration) {
        attributes ??= {};
        Object.assign(attributes, decoration.attributes);
      }
    }
    return attributes ? { attributes } : null;
  }

  /**
   * Forwards a body-cell pointer interaction to every feature module that
   * implements {@link CellInteractionHandler}. No-op for the community grid
   * (no modules); the grid only calls this when modules are registered.
   */
  public handleCellInteraction(interaction: CellInteraction<T>): void {
    for (const controller of this.#withHook(isCellInteractionHandler<T>)) {
      controller.handleCellInteraction(interaction);
    }
  }

  /**
   * Collects per-module snapshot state from feature controllers implementing
   * {@link SerializableModule}, keyed by module id. Returns an empty object for
   * the community grid (no modules). Used by `ApexGrid.getState`.
   */
  public serializeModuleState(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [id, controller] of this.modules) {
      if (isSerializableModule(controller)) {
        out[id] = controller.serializeState();
      }
    }
    return out;
  }

  /**
   * Dispatches previously-serialized state back to the matching feature modules
   * (by id) that implement {@link SerializableModule}, in registration order.
   * Returns the ids in `data` that no registered module consumed, so the caller
   * can report them instead of counting them as applied. Used by
   * `ApexGrid.setState`.
   */
  public restoreModuleState(data: Record<string, unknown> | undefined): string[] {
    if (!data) return [];
    for (const [id, controller] of this.modules) {
      if (isSerializableModule(controller) && Object.hasOwn(data, id)) {
        controller.restoreState(data[id]);
      }
    }
    return Object.keys(data).filter((id) => !isSerializableModule(this.modules.get(id)));
  }

  public hostConnected() {}

  public hostUpdate(): void {
    this.headerRow?.requestUpdate();
    this.scrollContainer?.requestUpdate();
    this.paginator?.requestUpdate();
    this.toolbar?.requestUpdate();
  }
}

export const gridStateContext = createContext<StateController<any>>('gridStateController');
