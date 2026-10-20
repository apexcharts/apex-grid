import type { DataType } from 'apex-grid';
import {
  clampRating,
  commitDateInSameShape,
  getRatingMax,
  getSelectOptions,
  parseDate,
  StateController,
} from 'apex-grid/internal';

/** The column fields that decide how typed text becomes a cell value. */
export interface CoercibleColumn {
  type?: string;
  options?: unknown[];
  max?: number;
}

/**
 * Typed text as the value a cell of `column` stores: a finite number for a
 * numeric column (a rating clamped to its range), `true` / `false` for a
 * boolean, a date (in the shape `current` has) for a date column, the
 * matching option of a select, and the text itself otherwise. Blank text
 * clears a numeric, boolean or date cell to `null`; text that does not parse
 * is kept as typed, for validators to judge. This is how a pasted cell's text
 * is read too. `type` overrides the column's type.
 */
export function coerceText(
  text: string,
  column: CoercibleColumn,
  current: unknown,
  type = column.type ?? 'string'
): unknown {
  const trimmed = text.trim();
  if (type === 'select') {
    // A value match wins over a label that happens to spell another value.
    const options = getSelectOptions(column as Parameters<typeof getSelectOptions>[0]);
    const option =
      options.find((o) => String(o.value) === trimmed) ?? options.find((o) => o.label === trimmed);
    return option ? option.value : text;
  }
  // The core numeric rule; it keeps no instance state, so the prototype serves.
  const numeric = StateController.prototype.isNumericColumn({ type: type as DataType });
  if (!numeric && type !== 'boolean' && type !== 'date') return text;
  if (trimmed === '') return null;
  if (numeric) {
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return text;
    return type === 'rating' ? clampRating(n, getRatingMax(column)) : n;
  }
  if (type === 'boolean') {
    const lower = trimmed.toLowerCase();
    return lower === 'true' ? true : lower === 'false' ? false : text;
  }
  const date = parseDate(trimmed);
  return date ? commitDateInSameShape(current, date) : text;
}
