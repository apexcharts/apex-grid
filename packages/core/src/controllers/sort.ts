import type { ReactiveController } from 'lit';
import { PIPELINE } from '../internal/constants.js';
import { awaitChildUpdates, type KeyedFlipEntry, playKeyedFlip } from '../internal/flip.js';
import type {
  ColumnConfiguration,
  ColumnSortConfiguration,
  GridHost,
  Keys,
} from '../internal/types.js';
import { asArray } from '../internal/utils.js';
import type { SortExpression, SortingDirection, SortState } from '../operations/sort/types.js';

export class SortController<T extends object> implements ReactiveController {
  constructor(protected host: GridHost<T>) {
    this.host.addController(this);
  }

  public state: SortState<T> = new Map();

  get #isMultipleSort() {
    return this.host.sortConfiguration.multiple;
  }

  get #isTriStateSort() {
    return this.host.sortConfiguration.triState;
  }

  /**
   * Only the options the column config actually sets, so a header click keeps a
   * comparer or caseSensitive that came in through `grid.sort()` when the column
   * itself does not define one. The trade-off: a comparer later removed from
   * the column config stays on the stored expression until that column's sort
   * is cleared, because its origin is not tracked.
   */
  #resolveSortOptions(options?: boolean | ColumnSortConfiguration<T>) {
    const expr: Partial<SortExpression<T>> = {};
    if (options && typeof options === 'object') {
      if (options.caseSensitive !== undefined) expr.caseSensitive = options.caseSensitive;
      if (options.comparer !== undefined) expr.comparer = options.comparer as any;
    }
    return expr;
  }

  #createDefaultExpression(key: Keys<T>) {
    const options = this.host.getColumn(key)?.sort;

    return {
      key,
      direction: 'ascending',
      caseSensitive: false,
      comparer: undefined,
      ...this.#resolveSortOptions(options),
    } as SortExpression<T>;
  }

  #orderBy(dir?: SortingDirection): SortingDirection {
    return this.#isTriStateSort
      ? dir === 'ascending'
        ? 'descending'
        : dir === 'descending'
          ? 'none'
          : 'ascending'
      : dir === 'ascending'
        ? 'descending'
        : 'ascending';
  }

  #emitSortingEvent(detail: SortExpression<T>) {
    return this.host.emitEvent('sorting', { detail, cancelable: true });
  }

  #emitSortedEvent(detail: SortExpression<T>) {
    return this.host.emitEvent('sorted', { detail });
  }

  #setExpression(expression: SortExpression<T>) {
    expression.direction === 'none'
      ? this.reset(expression.key)
      : this.state.set(expression.key, { ...expression });
  }

  public sortFromHeaderClick(column: ColumnConfiguration<T>, additive = false) {
    return this.sortFromUI(column, { additive });
  }

  /**
   * The one path for a sort the user starts from the UI (header click, column
   * menu): fires the cancelable `sorting` event, replaces the sort unless the
   * gesture is additive in multi-sort mode, announces, then fires `sorted`.
   * Without a `direction` the column steps to its next direction.
   */
  public async sortFromUI(
    column: ColumnConfiguration<T>,
    { direction, additive = false }: { direction?: SortingDirection; additive?: boolean } = {}
  ) {
    const expression = this.prepareExpression(column, direction);

    if (!this.#emitSortingEvent(expression)) {
      return;
    }

    // A plain click sorts by this column alone, clearing any other sorted
    // columns. Only a Ctrl/Cmd+click while multi-sort is enabled keeps the
    // existing sort keys and appends this column as an additional, lower-
    // priority sort. Without this gate every plain click would accumulate a
    // key, so a second column added behind a unique primary column would not
    // change the visible order at all.
    if (!this.#isMultipleSort || !additive) {
      this.reset();
    }

    // Capture visible-row rects keyed by data identity BEFORE the pipeline
    // runs. After the new render the virtualizer will have repositioned
    // rows; we use those captured rects as the "First" of a FLIP and
    // animate each row from its old viewport position back to identity.
    const beforeRects = this.#captureRowRects();

    this._sort(expression);

    await this.host.updateComplete;
    // Wait for body row updates so the new data is committed to each row
    // element before measuring the "Last" rect — otherwise the captured-
    // before and measured-after rects match and the animation no-ops.
    await awaitChildUpdates(this.host.rows);
    this.#playRowFlip(beforeRects);
    this.#announce(expression, column);
    this.#emitSortedEvent(expression);
  }

  #announce(expression: SortExpression<T>, column: ColumnConfiguration<T>) {
    const label = column.headerText ?? String(column.key);
    const message =
      expression.direction === 'none'
        ? this.host.localize('announce.sortCleared', { label })
        : this.host.localize(
            expression.direction === 'ascending'
              ? 'announce.sortedAscending'
              : 'announce.sortedDescending',
            { label }
          );
    this.host.announce(message);
  }

  #captureRowRects(): KeyedFlipEntry<T>[] {
    const entries: KeyedFlipEntry<T>[] = [];
    for (const row of this.host.rows) {
      const el = row as unknown as HTMLElement;
      entries.push({ key: row.data, rect: el.getBoundingClientRect() });
    }
    return entries;
  }

  #playRowFlip(before: ReadonlyArray<KeyedFlipEntry<T>>) {
    // After sort, the same data may be rendered by a different `<apex-grid-row>`
    // DOM element (virtualizer recycles rows). Resolve by data identity.
    const rows = this.host.rows;
    const byData = new Map<T, HTMLElement>();
    for (const row of rows) {
      byData.set(row.data, row as unknown as HTMLElement);
    }
    playKeyedFlip(before, (data) => byData.get(data) ?? null, 'y');
  }

  /**
   * The expression a UI sort would apply. Always a fresh object: the stored
   * entry is only replaced once the `sorting` event is not cancelled.
   */
  public prepareExpression(
    { key, sort: options }: ColumnConfiguration<T>,
    direction?: SortingDirection
  ): SortExpression<T> {
    const expr = this.state.get(key);

    return {
      ...(expr ?? this.#createDefaultExpression(key)),
      direction: direction ?? this.#orderBy(expr?.direction),
      ...this.#resolveSortOptions(options),
    } as SortExpression<T>;
  }

  public reset(key?: Keys<T>) {
    key ? this.state.delete(key) : this.state.clear();
  }

  get #rowReorder() {
    // @ts-expect-error - protected member access
    return this.host.stateController.rowReorder as
      | { hasManualOrder: boolean; clearManualOrder(announce?: boolean): void }
      | undefined;
  }

  protected _sort(expressions: SortExpression<T> | SortExpression<T>[]) {
    const exprs = asArray(expressions);
    // Applying a sort is mutually exclusive with a manual row order (F5):
    // a real sort (any non-`none` direction) clears it, with an announcement.
    const reorder = this.#rowReorder;
    if (reorder?.hasManualOrder && exprs.some((expr) => expr.direction !== 'none')) {
      reorder.clearManualOrder(true);
    }

    for (const expr of exprs) {
      this.#setExpression(expr);
    }

    this.host.requestUpdate(PIPELINE);
  }

  public sort(expressions: SortExpression<T> | SortExpression<T>[]) {
    this._sort(
      asArray(expressions).map(
        (expr) =>
          ({
            ...(this.state.get(expr.key) ?? this.#createDefaultExpression(expr.key)),
            ...expr,
          }) as SortExpression<T>
      )
    );
  }

  public hostConnected() {}
}
