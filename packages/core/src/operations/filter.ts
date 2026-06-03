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

  protected match(record: T, ands: FilterExpression<T>[], ors: FilterExpression<T>[]): boolean {
    for (const or of ors) {
      if (this.resolveFilter(record, or)) {
        return this.match(
          record,
          ands.filter((f) => f.key !== or.key),
          []
        );
      }
    }
    return ands.every((f) => this.resolveFilter(record, f));
  }

  public apply(data: T[], state: FilterState<T>): T[] {
    if (state.empty) return data;

    const { ands, ors } = state;
    return data.filter((record) => this.match(record, ands, ors));
  }
}
