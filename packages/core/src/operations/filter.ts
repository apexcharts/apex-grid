import DataOperation from './base.js';
import type { FilterState } from './filter/state.js';
import type { FilterExpression, FilterOperation } from './filter/types.js';

export default class FilterDataOperation<T extends object> extends DataOperation<T> {
  protected resolveFilter(record: T, expr: FilterExpression<T>) {
    const condition = expr.condition as FilterOperation<T>;
    return condition.logic(
      // XXX: Types
      this.resolveValue(record, expr.key) as T,
      expr.searchTerm as T,
      expr.caseSensitive
    );
  }

  /**
   * Whether `record` passes one column's expressions: all of its `and`
   * expressions (when it has any) or any one of its `or` expressions. Criteria
   * never reach across columns, so each column is matched on its own.
   */
  protected match(record: T, ands: FilterExpression<T>[], ors: FilterExpression<T>[]): boolean {
    if (ands.length === 0 && ors.length === 0) return true;
    if (ands.length > 0) {
      let all = true;
      for (let i = 0; i < ands.length && all; i++) all = this.resolveFilter(record, ands[i]);
      if (all) return true;
    }
    for (let i = 0; i < ors.length; i++) {
      if (this.resolveFilter(record, ors[i])) return true;
    }
    return false;
  }

  /** Keeps the records that pass every filtered column. */
  public apply(data: T[], state: FilterState<T>): T[] {
    if (state.empty) return data;

    // Split each column into its and / or lists once per apply, not per record.
    const trees = state.values;
    const ands = trees.map((tree) => tree.ands);
    const ors = trees.map((tree) => tree.ors);
    return data.filter((record) => {
      for (let i = 0; i < trees.length; i++) {
        if (!this.match(record, ands[i], ors[i])) return false;
      }
      return true;
    });
  }
}
