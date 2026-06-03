import type { ColumnConfiguration, Keys } from '../internal/types.js';
import DataOperation from './base.js';

/**
 * Built-in quick-filter (global search) data operation.
 *
 * @remarks
 * Performs a case-insensitive substring match of the search term across every visible
 * column's stringified value. Returns the original dataset unchanged when the search
 * term is empty / whitespace-only. Used by the grid when `quickFilter` is set; the
 * search can be customised through {@link DataPipelineConfiguration.quickFilter}.
 */
export default class QuickFilterDataOperation<T extends object> extends DataOperation<T> {
  /**
   * Returns the records whose visible column values contain `searchTerm` (case-insensitive).
   *
   * @param data - The dataset to filter.
   * @param searchTerm - The trimmed search term (already normalised to lower-case is fine).
   * @param columns - The current column configuration; hidden columns are skipped.
   */
  public apply(data: T[], searchTerm: string, columns: Array<ColumnConfiguration<T>>): T[] {
    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      return data;
    }

    const keys = columns.filter((column) => !column.hidden).map((column) => column.key as Keys<T>);

    if (keys.length === 0) {
      return data;
    }

    return data.filter((record) => {
      for (const key of keys) {
        const value = record[key];
        if (value === null || value === undefined) {
          continue;
        }
        if (String(value).toLowerCase().includes(term)) {
          return true;
        }
      }
      return false;
    });
  }
}
