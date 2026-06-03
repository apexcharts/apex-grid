import type { Keys } from '../../internal/types.js';

/**
 * Sort direction for a given sort expression.
 *
 * @remarks
 * `none` is used
 */
export type SortingDirection = 'ascending' | 'descending' | 'none';

/**
 * Custom comparer function for a given column used when sorting is performed.
 */
export type BaseSortComparer<T, K extends Keys<T> = Keys<T>> = (a: T[K], b: T[K]) => number;

/**
 * See {@link BaseSortComparer} for the full documentation.
 */
export type SortComparer<T, K extends Keys<T> = Keys<T>> =
  K extends Keys<T> ? BaseSortComparer<T, K> : never;

/**
 * Represents a sort operation for a given column.
 */
export interface BaseSortExpression<T, K extends Keys<T> = Keys<T>> {
  /**
   * The target column.
   */
  key: K;
  /**
   * Sort direction for this operation.
   */
  direction: SortingDirection;
  /**
   * Whether the sort operation should be case sensitive.
   *
   * @remarks
   * If not provided, the value is resolved based on the column sort configuration (if any).
   */
  caseSensitive?: boolean;
  /**
   * Custom comparer function for this operation.
   *
   * @remarks
   * If not provided, the value is resolved based on the column sort configuration (if any).
   */
  comparer?: SortComparer<T, K>;
}

/**
 * See {@link BaseSortExpression} for the full documentation.
 */
export type SortExpression<T, K extends Keys<T> = Keys<T>> =
  K extends Keys<T> ? BaseSortExpression<T, K> : never;

/** Represents the sort state of the grid. */
export type SortState<T> = Map<Keys<T>, SortExpression<T>>;
