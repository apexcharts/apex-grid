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

  #resolveSortOptions(options?: boolean | ColumnSortConfiguration<T>) {
    const expr: Pick<SortExpression<T>, 'caseSensitive' | 'comparer'> = {
      caseSensitive: false,
      comparer: undefined,
    };

    if (!options || typeof options === 'boolean') {
      return expr as Partial<SortExpression<T>>;
    }

    return Object.assign(expr, {
      caseSensitive: options.caseSensitive,
      comparer: options.comparer,
    }) as Partial<SortExpression<T>>;
  }

  #createDefaultExpression(key: Keys<T>) {
    const options = this.host.getColumn(key)?.sort;

    return {
      key,
      direction: 'ascending',
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

  public async sortFromHeaderClick(column: ColumnConfiguration<T>) {
    const expression = this.prepareExpression(column);

    if (!this.#emitSortingEvent(expression)) {
      return;
    }

    if (!this.#isMultipleSort) {
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
    this.#emitSortedEvent(expression);
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

  public prepareExpression({ key, sort: options }: ColumnConfiguration<T>): SortExpression<T> {
    if (this.state.has(key)) {
      const expr = this.state.get(key)!;

      return Object.assign(expr, {
        direction: this.#orderBy(expr.direction),
        ...this.#resolveSortOptions(options),
      });
    }

    // Initial state
    return this.#createDefaultExpression(key);
  }

  public reset(key?: Keys<T>) {
    key ? this.state.delete(key) : this.state.clear();
  }

  protected _sort(expressions: SortExpression<T> | SortExpression<T>[]) {
    for (const expr of asArray(expressions)) {
      this.#setExpression(expr);
    }

    this.host.requestUpdate(PIPELINE);
  }

  public sort(expressions: SortExpression<T> | SortExpression<T>[]) {
    this._sort(
      asArray(expressions).map((expr) =>
        Object.assign(this.state.get(expr.key) ?? this.#createDefaultExpression(expr.key), expr)
      )
    );
  }

  public hostConnected() {}
}
