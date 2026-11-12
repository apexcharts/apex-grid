/**
 * The reference model (F2): A1-style addressing bound to the grid **data**.
 *
 * A1 column letters are a pure positional bijection with the non-negative
 * integers (`A`=0, `B`=1, ..., `Z`=25, `AA`=26, ...), so converting a letter to
 * a column index needs no knowledge of the grid. Which data key a column index
 * reads is decided by the FormulaController alone (`#letterOrder` in
 * store.ts): column keys in first-seen order, append-only, so a letter
 * survives column reorder and a removed column keeps its slot.
 *
 * Addresses are 0-based internally (`row` = data-row index, `col` = column
 * index). A1 text is 1-based for rows. References bind to the underlying data
 * (source order), so a formula's meaning is stable across sort, filter, column
 * reorder, and paging.
 *
 * This module is pure (no DOM, no grid knowledge).
 */
import { ParseError } from './errors.js';

/** A single cell, 0-based: `row` is the data-row index, `col` the column index. */
export interface CellAddress {
  row: number;
  col: number;
}

/** A rectangular cell range (inclusive of both corners). */
export interface RangeAddress {
  start: CellAddress;
  end: CellAddress;
}

/**
 * Per-axis `$`-absoluteness of a reference (Tier 2). A bare `A1` is relative on
 * both axes; `$A$1` is absolute on both, `$A1` on the column only, `A$1` on the
 * row only. The resolved {@link CellAddress} is the same either way (relative
 * semantics manifest only when fill/copy rewrites the formula), so these flags
 * ride alongside the address and never reach the evaluator or dependency graph.
 */
export interface CellRefFlags {
  /** The column axis is fixed (`$A`): fill/copy never shifts it. */
  colAbsolute: boolean;
  /** The row axis is fixed (`$1`): fill/copy never shifts it. */
  rowAbsolute: boolean;
}

/** A parsed cell reference: its resolved address plus per-axis absoluteness. */
export interface ParsedCellRef extends CellRefFlags {
  address: CellAddress;
}

const CELL_PATTERN = /^(\$?)([A-Za-z]+)(\$?)([0-9]+)$/;
const LETTER_A = 'A'.charCodeAt(0);

/** Type guard distinguishing a {@link RangeAddress} from a {@link CellAddress}. */
export function isRangeAddress(addr: CellAddress | RangeAddress): addr is RangeAddress {
  return (addr as RangeAddress).start !== undefined;
}

/**
 * Convert A1 column letters to a 0-based column index (bijective base-26).
 * `A` to `0`, `Z` to `25`, `AA` to `26`. Case-insensitive.
 */
export function columnLetterToIndex(letters: string): number {
  let acc = 0;
  for (const char of letters.toUpperCase()) {
    acc = acc * 26 + (char.charCodeAt(0) - LETTER_A + 1);
  }
  return acc - 1;
}

/**
 * Convert a 0-based column index to A1 column letters (the inverse of
 * {@link columnLetterToIndex}). `0` to `A`, `25` to `Z`, `26` to `AA`.
 */
export function indexToColumnLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(LETTER_A + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/**
 * Parse a single A1 cell token into its resolved address plus per-axis
 * `$`-absoluteness ({@link ParsedCellRef}). `$A$1`, `$A1`, `A$1`, and `A1` all
 * resolve to the same address; the `$` markers populate {@link CellRefFlags}.
 * Throws {@link ParseError} on malformed input.
 */
export function parseCellRef(token: string, position = 0): ParsedCellRef {
  const match = CELL_PATTERN.exec(token);
  if (!match) {
    throw new ParseError(`invalid cell reference "${token}"`, position);
  }
  const row = Number(match[4]) - 1;
  if (row < 0) {
    throw new ParseError(`invalid row number in "${token}" (rows are 1-based)`, position);
  }
  return {
    address: { row, col: columnLetterToIndex(match[2]) },
    colAbsolute: match[1] === '$',
    rowAbsolute: match[3] === '$',
  };
}

/**
 * Format a single cell address as A1 text, e.g. `{ row: 1, col: 2 }` to `C2`.
 * When `flags` mark an axis absolute, the corresponding `$` is emitted (`$C$2`).
 */
export function formatCell(addr: CellAddress, flags?: Partial<CellRefFlags>): string {
  const column = `${flags?.colAbsolute ? '$' : ''}${indexToColumnLetter(addr.col)}`;
  const row = `${flags?.rowAbsolute ? '$' : ''}${addr.row + 1}`;
  return `${column}${row}`;
}

/**
 * Shift an address by (`dRow`, `dCol`), moving only the axes that `flags` leave
 * relative; absolute axes keep their value. An axis moved before row 1 or
 * column A comes back negative (it is not clamped), which `offsetReferences`
 * writes as `#REF!`; a target beyond the data surfaces as `#REF!` at
 * evaluation, exactly as an out-of-range literal reference would. Used by fill
 * and intra-grid paste to relocate a formula's references.
 */
export function offsetAddress(
  addr: CellAddress,
  dRow: number,
  dCol: number,
  flags?: Partial<CellRefFlags>
): CellAddress {
  return {
    row: flags?.rowAbsolute ? addr.row : addr.row + dRow,
    col: flags?.colAbsolute ? addr.col : addr.col + dCol,
  };
}

/** Format a cell or range address as A1 text (`C2` or `A1:C3`). */
export function formatA1(addr: CellAddress | RangeAddress): string {
  return isRangeAddress(addr)
    ? `${formatCell(addr.start)}:${formatCell(addr.end)}`
    : formatCell(addr);
}

/**
 * Normalize a range so `start` is the top-left and `end` the bottom-right,
 * regardless of the order the corners were given in.
 */
export function normalizeRange(range: RangeAddress): RangeAddress {
  const { start, end } = range;
  return {
    start: { row: Math.min(start.row, end.row), col: Math.min(start.col, end.col) },
    end: { row: Math.max(start.row, end.row), col: Math.max(start.col, end.col) },
  };
}

/**
 * Enumerate every cell in a range in row-major order. Allocates one address per
 * cell, so a range typed by a user goes through {@link clipRange} first.
 */
export function rangeCells(range: RangeAddress): CellAddress[] {
  const { start, end } = normalizeRange(range);
  const cells: CellAddress[] = [];
  for (let row = start.row; row <= end.row; row++) {
    for (let col = start.col; col <= end.col; col++) {
      cells.push({ row, col });
    }
  }
  return cells;
}

/**
 * The part of `range` inside a sheet of `rows` by `cols` cells, normalized, or
 * `null` when they do not overlap. Lets a caller enumerate a typed range such
 * as `A1:ZZ1000000` without walking cells that do not exist.
 */
export function clipRange(range: RangeAddress, rows: number, cols: number): RangeAddress | null {
  const { start, end } = normalizeRange(range);
  const last = { row: Math.min(end.row, rows - 1), col: Math.min(end.col, cols - 1) };
  return start.row > last.row || start.col > last.col ? null : { start, end: last };
}
