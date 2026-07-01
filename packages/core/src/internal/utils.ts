import type { StyleInfo } from 'lit/directives/style-map.js';
import { BooleanOperands } from '../operations/filter/operands/boolean.js';
import { NumberOperands } from '../operations/filter/operands/number.js';
import { StringOperands } from '../operations/filter/operands/string.js';
import type { ColumnConfiguration, DataType, GridHost } from './types.js';

/** Width of the auto-rendered selection (checkbox) column in CSS pixels. */
export const SELECTION_COLUMN_WIDTH = 44;
/** Width of the auto-rendered expansion (chevron) column in CSS pixels. */
export const EXPANSION_COLUMN_WIDTH = 40;
/** Width of the auto-rendered row-reorder (grip handle) column in CSS pixels. */
export const REORDER_HANDLE_COLUMN_WIDTH = 36;
/** Width of the transient spreadsheet row-number gutter in CSS pixels. */
export const ROW_NUMBER_COLUMN_WIDTH = 48;

export function applyColumnWidths<T extends object>(
  columns: Array<ColumnConfiguration<T>>,
  options: {
    showSelectionColumn?: boolean;
    showExpansionColumn?: boolean;
    showReorderHandle?: boolean;
    showRowNumbers?: boolean;
  } = {}
): StyleInfo {
  const tracks = columns
    .filter((each) => !each.hidden)
    .map(({ width }) => width ?? 'minmax(136px, 1fr)');
  if (options.showExpansionColumn) {
    tracks.unshift(`${EXPANSION_COLUMN_WIDTH}px`);
  }
  if (options.showSelectionColumn) {
    tracks.unshift(`${SELECTION_COLUMN_WIDTH}px`);
  }
  // Unshifted last so the grip handle is the leftmost leading column, ahead of
  // any selection / expansion chrome.
  if (options.showReorderHandle) {
    tracks.unshift(`${REORDER_HANDLE_COLUMN_WIDTH}px`);
  }
  // The spreadsheet row-number gutter is the very first column (matches A1).
  if (options.showRowNumbers) {
    tracks.unshift(`${ROW_NUMBER_COLUMN_WIDTH}px`);
  }
  return { 'grid-template-columns': tracks.join(' ') };
}

/**
 * The spreadsheet column letter for a zero-based column index (`0 → A`,
 * `25 → Z`, `26 → AA`). Used for the transient A1 coordinate hints shown while a
 * formula cell is being edited.
 */
export function columnLetter(index: number): string {
  let n = index;
  let letters = '';
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

/**
 * Returns the visual render order of the columns: start-pinned columns first,
 * then unpinned columns, then end-pinned columns. Within each group the
 * original `columns` array order is preserved.
 *
 * @remarks
 * The grid uses this order for rendering, navigation, and CSS grid track widths.
 * The user-supplied `columns` array is never mutated; this returns a new array.
 */
export function getDisplayColumns<T extends object>(
  columns: Array<ColumnConfiguration<T>>
): Array<ColumnConfiguration<T>> {
  const start: Array<ColumnConfiguration<T>> = [];
  const middle: Array<ColumnConfiguration<T>> = [];
  const end: Array<ColumnConfiguration<T>> = [];
  for (const column of columns) {
    if (column.pinned === 'start') start.push(column);
    else if (column.pinned === 'end') end.push(column);
    else middle.push(column);
  }
  return [...start, ...middle, ...end];
}

/**
 * Returns `'start'` for the last visible start-pinned column, `'end'` for the
 * first visible end-pinned column, or `null` otherwise. The edge column gets a
 * subtle shadow / border to separate the pinned region from the scrolling one.
 */
export function getPinEdge<T extends object>(
  displayColumns: Array<ColumnConfiguration<T>>,
  index: number
): 'start' | 'end' | null {
  const column = displayColumns[index];
  if (!column?.pinned) return null;

  if (column.pinned === 'start') {
    for (let i = index + 1; i < displayColumns.length; i++) {
      const next = displayColumns[i];
      if (next.hidden) continue;
      return next.pinned === 'start' ? null : 'start';
    }
    return 'start';
  }

  for (let i = index - 1; i >= 0; i--) {
    const prev = displayColumns[i];
    if (prev.hidden) continue;
    return prev.pinned === 'end' ? null : 'end';
  }
  return 'end';
}

export function autoGenerateColumns<T extends object>(grid: GridHost<T>) {
  if (grid.autoGenerate && grid.columns.length < 1) {
    const record = grid.data[0] ?? {};

    grid.columns = Object.entries(record).map(([key, value]) => {
      const type: DataType =
        typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string';
      return { key, type } as ColumnConfiguration<T>;
    });
  }
}

export function asArray<T>(value: T | T[]) {
  return Array.isArray(value) ? value : [value];
}

export function getFilterOperandsFor<T extends object>(column: ColumnConfiguration<T>) {
  // Check for custom class in the filter config
  switch (column.type) {
    case 'boolean':
      return BooleanOperands;
    case 'number':
      return NumberOperands;
    default:
      return StringOperands;
  }
}
