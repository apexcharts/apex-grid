import DataOperation from './base.js';
import type { SortExpression, SortState } from './sort/types.js';

/** Stands in for an empty cell (null, undefined, NaN, invalid Date) in a precomputed sort key. */
const EMPTY = Symbol('empty');

type RowCompare = (x: number, y: number) => number;

/**
 * Sorts rows by one or more sort expressions, in priority order.
 *
 * @remarks
 * The built-in comparison (an expression without a `comparer`):
 * - Empty cells, meaning `null`, `undefined`, `NaN` and invalid Dates, sort after every
 *   real value in both directions, and empties count as equal to each other.
 * - Strings compare with `localeCompare`, case folded first unless `caseSensitive` is true.
 *   Other values compare with `<` and `>`.
 *
 * A custom `comparer` receives the raw cell values, empty ones and original casing
 * included, and owns their order; a descending sort reverses its result.
 *
 * Rows that tie on every expression keep their incoming order, so the result is a stable
 * total order. Each row's key is resolved once per expression before sorting, so case
 * folding costs one call per row rather than one per comparison.
 */
export default class SortDataOperation<T> extends DataOperation<T> {
  protected orderBy = new Map(
    Object.entries({
      ascending: 1,
      descending: -1,
    })
  );

  protected compareValues<U>(first: U, second: U) {
    if (typeof first === 'string' && typeof second === 'string') {
      return first.localeCompare(second);
    }
    return first > second ? 1 : first < second ? -1 : 0;
  }

  /** The key the built-in comparison sorts by: case folded, Dates as time, empties as EMPTY. */
  protected sortKey(value: unknown, caseSensitive?: boolean) {
    const key = value instanceof Date ? value.getTime() : this.resolveCase(value, caseSensitive);
    return key == null || Number.isNaN(key) ? EMPTY : key;
  }

  #rowCompare(data: T[], expression: SortExpression<T>, dir: number): RowCompare {
    const { key, caseSensitive, comparer } = expression;
    const keys = data.map((row) =>
      comparer
        ? this.resolveValue(row, key)
        : this.sortKey(this.resolveValue(row, key), caseSensitive)
    );

    if (comparer) {
      // TODO: Remove casting as any
      return (x, y) => dir * comparer(keys[x] as any, keys[y] as any);
    }

    return (x, y) => {
      const a = keys[x];
      const b = keys[y];
      // Empties sit after real values whatever the direction, so `dir` is not applied here.
      if (a === EMPTY || b === EMPTY) {
        return a === b ? 0 : a === EMPTY ? 1 : -1;
      }
      return dir * this.compareValues(a, b);
    };
  }

  public apply(data: T[], state: SortState<T>) {
    const compares: RowCompare[] = [];
    for (const expression of state.values()) {
      const dir = this.orderBy.get(expression.direction);
      if (dir) compares.push(this.#rowCompare(data, expression, dir));
    }
    if (!compares.length) return data;

    const length = compares.length;
    const order = data.map((_, i) => i);
    order.sort((x, y) => {
      for (let i = 0; i < length; i++) {
        const result = compares[i](x, y);
        if (result) return result;
      }
      return x - y;
    });

    const rows = data.slice();
    for (let i = 0; i < order.length; i++) {
      data[i] = rows[order[i]];
    }
    return data;
  }
}
