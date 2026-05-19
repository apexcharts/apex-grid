import type { PaginationState } from '../internal/types.js';
import DataOperation from './base.js';

/**
 * Built-in pagination data operation.
 *
 * @remarks
 * Slices the post-filter, post-sort dataset by `page` and `pageSize`.
 * Used by the grid when `pagination.mode === 'local'`. Remote pagination
 * is delegated to {@link DataPipelineConfiguration.pagination}.
 */
export default class PaginationDataOperation<T extends object> extends DataOperation<T> {
  /**
   * Returns the slice of `data` corresponding to the given pagination `state`.
   *
   * @param data - The post-filter, post-sort dataset.
   * @param state - The resolved pagination state.
   */
  public apply(data: T[], state: PaginationState): T[] {
    const { page, pageSize } = state;
    if (!pageSize || pageSize < 1) {
      return data;
    }
    const start = page * pageSize;
    return data.slice(start, start + pageSize);
  }
}
