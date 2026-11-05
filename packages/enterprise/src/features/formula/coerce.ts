import type { DataType } from 'apex-grid';
import {
  clampRating,
  commitDateInSameShape,
  getRatingMax,
  getSelectOptions,
  parseDate,
  parseLocaleNumberInput,
  StateController,
} from 'apex-grid/internal';

/** The column fields that decide how typed text becomes a cell value. */
export interface CoercibleColumn {
  type?: string;
  options?: unknown[];
  max?: number;
  /** BCP 47 locale whose separators a typed number is read with. */
  locale?: string;
  /** ISO 4217 code whose symbol may surround a typed number. */
  currency?: string;
}

/**
 * Typed or pasted text as a number in `column`, or `NaN`. Grouping in the
 * column's own `locale` wins over a plain decimal, so `1.000` pasted into a
 * `de-DE` column is 1000 like its `1.000.000` neighbours. A percent reads only
 * in a progress column, against the column's scale: `50%` is 50 of the
 * default 100, or 0.5 with `max: 1`. Anything else keeps its `Number()`
 * reading.
 */
function readNumber(text: string, column: CoercibleColumn, type: string): number {
  const percent = type === 'progress' ? /^(.*?)\s*[%％]$/.exec(text) : null;
  if (percent) {
    const max = typeof column.max === 'number' && column.max > 0 ? column.max : 100;
    return (parseLocaleNumberInput(percent[1], column.locale, column.currency) * max) / 100;
  }
  const typed = parseLocaleNumberInput(text, column.locale, column.currency);
  return Number.isNaN(typed) ? Number(text) : typed;
}

/**
 * Typed text as the value a cell of `column` stores: a finite number for a
 * numeric column (a rating clamped to its range; full-width digits, grouping
 * and a currency mark read in the column's locale, so `¥1,200` is 1200; a
 * percent only in a progress column), `true` / `false` for a
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
    const n = readNumber(trimmed, column, type);
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
