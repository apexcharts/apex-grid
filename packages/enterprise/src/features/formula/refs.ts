/**
 * The reference model (F2): A1-style addressing bound to the grid **data**.
 *
 * A1 column letters are a pure positional bijection with the non-negative
 * integers (`A`=0, `B`=1, ..., `Z`=25, `AA`=26, ...), so converting a letter to
 * a column index needs no knowledge of the grid. The grid's column list is only
 * needed to map a column index back to its data key (`row[key]`), which
 * {@link buildColumnLetters} provides for the recalc layer (F3).
 *
 * Addresses are 0-based internally (`row` = data-row index, `col` = column
 * index). A1 text is 1-based for rows. References bind to the underlying data
 * (source order), so a formula's meaning is stable across sort, filter, column
 * reorder, and paging.
 *
 * This module is pure (no DOM, no grid knowledge beyond the `{ key }` shape).
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

/** Maps between a column's data key and its stable A1 letter. */
export interface ColumnLetterMaps {
  /** Column key (stringified) to its A1 letter, e.g. `price` to `C`. */
  toLetter: Map<string, string>;
  /** A1 letter to column key, e.g. `C` to `price`. */
  toKey: Map<string, string>;
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

function parseCell(token: string, position: number): CellAddress {
  return parseCellRef(token, position).address;
}

/**
 * Parse an A1 token into an address. `B2` yields a {@link CellAddress};
 * `A1:C3` yields a {@link RangeAddress}. Throws {@link ParseError} on malformed
 * input. The `position` is recorded on thrown errors so the editor can point at
 * the offending text.
 */
export function parseA1(token: string, position = 0): CellAddress | RangeAddress {
  const colonIndex = token.indexOf(':');
  if (colonIndex === -1) {
    return parseCell(token, position);
  }
  const start = parseCell(token.slice(0, colonIndex), position);
  const end = parseCell(token.slice(colonIndex + 1), position + colonIndex + 1);
  return { start, end };
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
 * relative; absolute axes keep their value. Results are clamped at 0 so the
 * address stays well-formed; a target beyond the data surfaces as `#REF!` at
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
    row: flags?.rowAbsolute ? addr.row : Math.max(0, addr.row + dRow),
    col: flags?.colAbsolute ? addr.col : Math.max(0, addr.col + dCol),
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
 * Enumerate every cell in a range in row-major order. Used by the dependency
 * graph (F3) to wire each cell of a range to the formula that reads it.
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
 * Build the stable column-key to A1-letter maps from the grid's column list.
 * Letters are assigned by configuration order (`A` = first column, including
 * hidden ones), so a formula's references keep their meaning across reorder,
 * sort, and filter. The recalc layer (F3) uses {@link ColumnLetterMaps.toKey}
 * to resolve a parsed column index to the data key it reads.
 */
export function buildColumnLetters(columns: readonly { key: PropertyKey }[]): ColumnLetterMaps {
  const toLetter = new Map<string, string>();
  const toKey = new Map<string, string>();
  columns.forEach((column, index) => {
    const key = String(column.key);
    const letter = indexToColumnLetter(index);
    toLetter.set(key, letter);
    toKey.set(letter, key);
  });
  return { toLetter, toKey };
}
