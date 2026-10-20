import type { Keys } from '../../internal/types.js';
import type { BooleanOperands } from './operands/boolean.js';
import type { NumberOperands } from './operands/number.js';
import type { StringOperands } from './operands/string.js';

/**
 * Controls how a data record should resolve in a filter operation:
 *  - `'and'` - the record must pass all the conditions.
 *  - `'or'`  - the record must pass at least one condition.
 */
export type FilterCriteria = 'and' | 'or';

export type FilterOperationLogic<T> = (
  target: T,
  searchTerm: T,
  caseSensitive?: boolean
) => boolean;

export interface FilterOperation<T> {
  name: string;
  label?: string;
  unary: boolean;
  logic: FilterOperationLogic<T>;
}

export type FilterOperands<DataType, Operands extends string> = {
  [key in Operands]: FilterOperation<DataType>;
};

/**
 * Represents a filter operation for a given column.
 */
export interface BaseFilterExpression<T, K extends Keys<T> = Keys<T>> {
  /**
   * The target column for the filter operation.
   */
  key: K;
  /**
   * The filter function which will be executed against the data records.
   */
  condition: FilterOperation<T[K]> | OperandKeys<T[K]>;

  /**
   * The filtering value used in the filter condition function.
   *
   * @remarks
   * Optional for unary conditions.
   */
  searchTerm?: T[K];
  /**
   * Dictates how this expression should resolve in the filter operation in relation to
   * other expressions.
   */
  criteria?: FilterCriteria;
  /**
   * Whether the sort operation should be case sensitive.
   *
   * @remarks
   * If not provided, the value is resolved based on the column filter configuration (if any).
   */
  caseSensitive?: boolean;
}

/**
 * See {@link BaseFilterExpression} for the full documentation.
 */
export type FilterExpression<T, K extends Keys<T> = Keys<T>> =
  K extends Keys<T> ? BaseFilterExpression<T, K> : never;

/**
 * The operand names a filter `condition` may use for a value of `Type`.
 *
 * @remarks
 * Any other value type (a `Date`, an array, an object) offers the string
 * operand names, the set the grid applies to a column with no numeric or
 * boolean type. `null` and `undefined` add no names, so a `number | null` or
 * optional number field keeps the number operand names only. A field typed
 * `unknown` (or `any`), such as every field of a `Record<string, unknown>`
 * row, keeps every operand name: the grid picks the operands from the
 * column type at runtime, which the value type does not tell.
 */
export type OperandKeys<Type> = unknown extends Type
  ? keyof typeof NumberOperands | keyof typeof StringOperands | keyof typeof BooleanOperands
  : Type extends null | undefined
    ? never
    : Type extends number
      ? keyof typeof NumberOperands
      : Type extends string
        ? keyof typeof StringOperands
        : Type extends boolean
          ? keyof typeof BooleanOperands
          : keyof typeof StringOperands;
