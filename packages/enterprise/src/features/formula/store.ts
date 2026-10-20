/**
 * The formula store, dependency graph, and recalc controller (F3).
 *
 * Two layers:
 *  - {@link FormulaStore} is the pure recalc core: it holds which cells are
 *    formulas, the reverse dependency graph, and a topological recompute with
 *    cycle detection. It reads and writes values through an injected
 *    {@link FormulaEngineHost}, so it is unit-testable against an in-memory grid.
 *  - {@link FormulaController} binds that core to a real grid: it implements the
 *    host over `grid.data` / `grid.columns`, listens for `cellValueChanged` to
 *    recompute dependents, writes computed values back into `row[key]` (the
 *    canonical value), and requests one pipeline pass so sort/filter/aggregates
 *    see fresh values.
 *
 * Addresses are 0-based: `row` indexes `grid.data` (source order), `col` is a
 * stable A1 letter index (see {@link FormulaController} column handling). The
 * computed value is the canonical cell value (decision D1), so display and every
 * value-reading feature work unchanged.
 */
import type { GridLocaleKey } from 'apex-grid';
import {
  type CellDecoration,
  type CellDecoratorContext,
  type GridFeatureModule,
  type GridHost,
  PIPELINE,
  viewIndexer,
} from 'apex-grid/internal';
import type { ReactiveController } from 'lit';
import { type CellValue, cycleError, refError } from './errors.js';
import { evaluate, type FormulaContext } from './evaluator.js';
import { createFunctionRegistry, type FormulaFn } from './functions.js';
import {
  type FormulaAst,
  formulaReferences,
  isFunctionName,
  offsetReferences,
  parseFormula,
  stringifyFormula,
} from './parser.js';
import {
  type CellAddress,
  formatCell,
  indexToColumnLetter,
  normalizeRange,
  type RangeAddress,
  rangeCells,
} from './refs.js';

export const FORMULA_MODULE_ID = 'formula';

/** Number of distinct colors the reference highlighter cycles (mirrors body-cell.scss). */
const HIGHLIGHT_PALETTE_SIZE = 6;

const cellKey = (address: CellAddress): string => `${address.row}:${address.col}`;

function parseCellKey(key: string): CellAddress {
  const separator = key.indexOf(':');
  return { row: Number(key.slice(0, separator)), col: Number(key.slice(separator + 1)) };
}

/** The value under `key` in `map`, created by `make` on first use. */
function slot<K, V>(map: Map<K, V>, key: K, make: () => V): V {
  let value = map.get(key);
  if (value === undefined) {
    value = make();
    map.set(key, value);
  }
  return value;
}

interface FormulaEntry {
  src: string;
  ast: FormulaAst;
  /** Single-cell keys this formula reads, for graph edges. */
  cells: Set<string>;
  /** Ranges this formula reads, normalized and never expanded per cell. */
  ranges: RangeAddress[];
}

/** The grid binding the {@link FormulaStore} needs to read, write, and validate cells. */
export interface FormulaEngineHost {
  /** Current canonical value at an address (`row[columnKey]`), or null. */
  readValue(address: CellAddress): CellValue;
  /** Write a computed value back into the canonical cell. */
  writeValue(address: CellAddress, value: CellValue): void;
  /** Whether an address is within the current data + columns. */
  isValidAddress(address: CellAddress): boolean;
  /** Available functions, keyed by upper-case name. */
  functions: Map<string, FormulaFn>;
}

/** A cell whose computed value changed during a recalc pass. */
export interface RecalcChange {
  address: CellAddress;
  value: CellValue;
}

/**
 * Pure recalc core: the formula set, the dependency graph, and a topological
 * recompute with cycle detection. No DOM and no grid knowledge beyond the
 * injected {@link FormulaEngineHost}.
 *
 * Single-cell references are edges in a reverse map. Range references stay
 * un-expanded: each is indexed once per column it spans, so a fill-down of
 * `=A1/SUM($A$1:$A$10000)` costs one index entry per formula, not one per cell.
 */
export class FormulaStore {
  readonly #entries = new Map<string, FormulaEntry>();
  /** precedent cell key -> set of formula cells that read it. */
  readonly #dependents = new Map<string, Set<string>>();
  /** column -> (formula key -> ranges of that formula over the column). */
  readonly #rangeDependents = new Map<number, Map<string, RangeAddress[]>>();

  constructor(private readonly host: FormulaEngineHost) {}

  /** Whether a formula is stored at the address. */
  public has(address: CellAddress): boolean {
    return this.#entries.has(cellKey(address));
  }

  /** The formula source at the address, if any. */
  public get(address: CellAddress): string | undefined {
    return this.#entries.get(cellKey(address))?.src;
  }

  /** Every stored formula as `{ address, src }`, for persistence. */
  public list(): Array<{ address: CellAddress; src: string }> {
    return [...this.#entries].map(([key, entry]) => ({
      address: parseCellKey(key),
      src: entry.src,
    }));
  }

  /** Number of stored formulas. */
  public get size(): number {
    return this.#entries.size;
  }

  /**
   * Store (or replace) a formula at the address and recompute it plus its
   * dependents. Throws `ParseError` for malformed input (nothing is mutated).
   */
  public set(address: CellAddress, src: string): RecalcChange[] {
    this.#insert(address, src, parseFormula(src));
    return this.recalc([address], true);
  }

  /**
   * Remove the formula at the address (if any) and recompute its dependents
   * (which now read whatever literal value the cell holds).
   */
  public clear(address: CellAddress): RecalcChange[] {
    return this.release([address]);
  }

  /**
   * A literal landed on each seed: drop any formula stored there, then
   * recompute the seeds' dependents.
   */
  public release(seeds: CellAddress[]): RecalcChange[] {
    for (const seed of seeds) {
      this.#remove(cellKey(seed));
    }
    return this.recalc(seeds, false);
  }

  /** Recompute every stored formula (e.g. after the data array is replaced). */
  public recalcAll(): RecalcChange[] {
    return this.recalc([...this.#entries.keys()].map(parseCellKey), true);
  }

  /**
   * Replace every formula with `entries` (already parsed) and recompute them
   * all in one pass. `entries` carry their AST so callers can validate first.
   * Stored formulas whose address passes `keep` stay alongside them.
   */
  public load(
    entries: ReadonlyArray<{ address: CellAddress; src: string; ast: FormulaAst }>,
    keep?: (address: CellAddress) => boolean
  ) {
    const kept: Array<{ address: CellAddress; src: string; ast: FormulaAst }> = [];
    for (const [key, { src, ast }] of keep ? this.#entries : []) {
      const address = parseCellKey(key);
      if (keep?.(address)) {
        kept.push({ address, src, ast });
      }
    }
    this.clearAll();
    for (const { address, src, ast } of [...kept, ...entries]) {
      this.#insert(address, src, ast);
    }
    return this.recalcAll();
  }

  /**
   * Move each formula to the data row `moveRow(row, col)` returns (`-1` drops
   * it), shifting its relative references by the same delta, as a fill would,
   * so a formula keeps reading its own row. Recomputes everything afterwards.
   */
  public moveRows(moveRow: (row: number, col: number) => number): RecalcChange[] {
    const moved: Array<{ address: CellAddress; src: string; ast: FormulaAst }> = [];
    for (const [key, { src, ast }] of this.#entries) {
      const { row, col } = parseCellKey(key);
      const next = moveRow(row, col);
      if (next === row) {
        moved.push({ address: { row, col }, src, ast });
      } else if (next >= 0) {
        const shifted = offsetReferences(ast, next - row, 0);
        moved.push({ address: { row: next, col }, src: stringifyFormula(shifted), ast: shifted });
      }
    }
    return this.load(moved);
  }

  /** Drop every formula and dependency edge (values are left untouched). */
  public clearAll(): void {
    this.#entries.clear();
    this.#dependents.clear();
    this.#rangeDependents.clear();
  }

  /**
   * Recompute the formula cells affected by changes to `seeds`. When
   * `includeSeeds` is true, seed cells that are themselves formulas are
   * recomputed as well (used when a formula is set or on a full recompute).
   */
  public recalc(seeds: CellAddress[], includeSeeds: boolean): RecalcChange[] {
    const affected = this.#collectAffected(seeds, includeSeeds);
    if (!affected.size) {
      return [];
    }

    const { order, cyclic } = this.#topoSort(affected);
    const context = this.#context();
    const changes: RecalcChange[] = [];

    for (const key of order) {
      const entry = this.#entries.get(key);
      if (!entry) {
        continue;
      }
      const address = parseCellKey(key);
      const value = evaluate(entry.ast, context);
      this.host.writeValue(address, value);
      changes.push({ address, value });
    }
    for (const key of cyclic) {
      const address = parseCellKey(key);
      const value = cycleError(key);
      this.host.writeValue(address, value);
      changes.push({ address, value });
    }
    return changes;
  }

  #insert(address: CellAddress, src: string, ast: FormulaAst): void {
    const key = cellKey(address);
    this.#remove(key);
    const refs = formulaReferences(ast);
    const cells = new Set(refs.cells.map(cellKey));
    const ranges = refs.ranges.map(normalizeRange);
    this.#entries.set(key, { src, ast, cells, ranges });
    for (const precedent of cells) {
      slot(this.#dependents, precedent, () => new Set<string>()).add(key);
    }
    for (const range of ranges) {
      for (let col = range.start.col; col <= range.end.col; col++) {
        const byFormula = slot(this.#rangeDependents, col, () => new Map());
        slot(byFormula, key, () => []).push(range);
      }
    }
  }

  #remove(key: string): void {
    const entry = this.#entries.get(key);
    if (!entry) {
      return;
    }
    this.#entries.delete(key);
    for (const precedent of entry.cells) {
      const set = this.#dependents.get(precedent);
      if (set) {
        set.delete(key);
        if (!set.size) {
          this.#dependents.delete(precedent);
        }
      }
    }
    for (const range of entry.ranges) {
      for (let col = range.start.col; col <= range.end.col; col++) {
        this.#rangeDependents.get(col)?.delete(key);
      }
    }
  }

  /** Formula cells that read `address` through a single-cell or a range reference. */
  *#readersOf(address: CellAddress, key: string): Iterable<string> {
    yield* this.#dependents.get(key) ?? [];
    const byFormula = this.#rangeDependents.get(address.col);
    if (byFormula) {
      for (const [reader, ranges] of byFormula) {
        if (ranges.some((r) => r.start.row <= address.row && address.row <= r.end.row)) {
          yield reader;
        }
      }
    }
  }

  /** Formula cells transitively dependent on the seeds (plus the seeds if asked). */
  #collectAffected(seeds: CellAddress[], includeSeeds: boolean): Set<string> {
    const affected = new Set<string>();
    const seen = new Set<string>();
    const queue: CellAddress[] = [];
    for (const seed of seeds) {
      const key = cellKey(seed);
      if (includeSeeds && this.#entries.has(key)) {
        affected.add(key);
      }
      if (!seen.has(key)) {
        seen.add(key);
        queue.push(seed);
      }
    }
    // Every formula is already in: their dependents are formulas too.
    if (affected.size === this.#entries.size) {
      return affected;
    }
    for (let head = 0; head < queue.length; head++) {
      const address = queue[head];
      for (const reader of this.#readersOf(address, cellKey(address))) {
        affected.add(reader);
        if (!seen.has(reader)) {
          seen.add(reader);
          queue.push(parseCellKey(reader));
        }
      }
    }
    return affected;
  }

  /** Kahn's algorithm over the affected subgraph; leftovers are cyclic. */
  #topoSort(affected: Set<string>): { order: string[]; cyclic: string[] } {
    const indegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();
    // Affected formulas per column, so a range finds the ones it covers
    // without walking its cells.
    const byColumn = new Map<number, CellAddress[]>();
    for (const key of affected) {
      indegree.set(key, 0);
      const address = parseCellKey(key);
      slot(byColumn, address.col, () => []).push(address);
    }
    const edge = (precedent: string, key: string): void => {
      slot(adjacency, precedent, () => []).push(key);
      indegree.set(key, (indegree.get(key) ?? 0) + 1);
    };
    for (const key of affected) {
      const entry = this.#entries.get(key);
      if (!entry) {
        continue;
      }
      for (const precedent of entry.cells) {
        if (affected.has(precedent)) {
          edge(precedent, key);
        }
      }
      for (const range of entry.ranges) {
        for (let col = range.start.col; col <= range.end.col; col++) {
          for (const address of byColumn.get(col) ?? []) {
            if (range.start.row <= address.row && address.row <= range.end.row) {
              edge(cellKey(address), key);
            }
          }
        }
      }
    }

    const queue: string[] = [];
    for (const [key, degree] of indegree) {
      if (degree === 0) {
        queue.push(key);
      }
    }
    const order: string[] = [];
    for (let head = 0; head < queue.length; head++) {
      const key = queue[head];
      order.push(key);
      for (const dependent of adjacency.get(key) ?? []) {
        const next = (indegree.get(dependent) ?? 0) - 1;
        indegree.set(dependent, next);
        if (next === 0) {
          queue.push(dependent);
        }
      }
    }

    if (order.length === affected.size) {
      return { order, cyclic: [] };
    }
    const inOrder = new Set(order);
    const cyclic = [...affected].filter((key) => !inOrder.has(key));
    return { order, cyclic };
  }

  #context(): FormulaContext {
    return {
      getRef: (address) =>
        this.host.isValidAddress(address)
          ? this.host.readValue(address)
          : refError(formatCell(address)),
      getRange: (range) =>
        rangeCells(range).map((address) =>
          this.host.isValidAddress(address)
            ? this.host.readValue(address)
            : refError(formatCell(address))
        ),
      functions: this.host.functions,
    };
  }
}

/** The `cellValueChanged` detail the controller reacts to (see core grid.ts). */
interface CellValueChangedDetail<T extends object> {
  key: keyof T & string;
  rowIndex: number;
  data: T;
  value: unknown;
}

/** A formula to restore: its row, column, source, and the data index it was saved at. */
export interface FormulaRestoreEntry<T> {
  row: T;
  columnKey: string;
  src: string;
  /** Data index the formula was saved at; relative references shift by the move. */
  origin?: number;
}

/** Why {@link FormulaController.restoreFormulas} skipped an entry. */
export interface FormulaRestoreRejection {
  columnKey: string;
  src: string;
  reason: 'invalid' | 'column';
}

/**
 * Bound on the extra recalc passes one settle runs for edits that listeners
 * make while it dispatches, so a listener that always writes cannot spin forever.
 */
const MAX_SETTLE_PASSES = 100;

/**
 * Host-bound recalc controller. Adapts a grid to the {@link FormulaStore}:
 * resolves A1 column indices to data keys with a stable letter order, reads and
 * writes `row[key]`, recomputes dependents on `cellValueChanged`, and settles a
 * pass with one pipeline update. Computed values are the canonical cell values
 * (D1); recalc writes are not recorded in edit history.
 *
 * Formulas belong to rows, not positions: the controller keeps the data order
 * it last addressed (its row frame) and, when rows are reordered, removed or
 * replaced, moves each formula with its row (by the grid's `rowId` when set,
 * else by object identity), falling back to positions only when no row survives.
 */
export class FormulaController<T extends object> implements ReactiveController, FormulaEngineHost {
  /** Per-instance registry, so custom functions do not leak across grids. */
  public readonly functions: Map<string, FormulaFn> = createFunctionRegistry();

  readonly #host: GridHost<T>;
  readonly #store: FormulaStore;
  /** Owning state controller, for requesting cell-decoration refreshes. */
  readonly #state: { bumpDecoration(): void } | undefined;
  /** Stable A1 letter order: column keys in first-seen order, append-only so a
   * formula's letters survive column reorder; a removed column's slot is kept. */
  readonly #letterOrder: string[] = [];
  readonly #letterIndex = new Map<string, number>();
  /** Keys of the current columns, and of those that allow formulas. */
  #columnKeys = new Set<string>();
  #formulaColumns = new Set<string>();
  #syncedColumns: unknown;
  #syncedLength = 0;
  /** The data order formula addresses refer to, as of the last sync. */
  #rows: T[] | null = null;
  #rowIndex: Map<T, number> | null = null;
  #lastData: ReadonlyArray<T> | undefined;
  /** True while {@link #settle} dispatches its `cellValueChanged` events. */
  #settling = false;
  /** Events {@link #settle} dispatched itself, so the listener skips only those. */
  readonly #ownEvents = new WeakSet<Event>();
  /** Literal edits that arrived while settling, applied in a follow-up pass. */
  #queued: Array<{ row: T; key: string }> = [];
  /**
   * Transient reference highlights for the formula being edited: row data object
   * → (column key → palette slot). `null` when no formula is open. Read by
   * {@link decorateCell}; rebuilt by {@link highlightReferences}.
   */
  #highlights: Map<T, Map<string, number>> | null = null;
  /**
   * Transient "point-mode" pointer for the reference the user is currently
   * dragging or arrowing in the grid while editing a formula: row data object →
   * (column key → edge tokens, e.g. `"top left"`). `null` when not pointing.
   * Read by {@link decorateCell} to draw the marching-ants marquee; set by
   * {@link setPointer}.
   */
  #pointerCells: Map<T, Map<string, string>> | null = null;

  constructor(host: GridHost<T>, state?: { bumpDecoration(): void }) {
    this.#host = host;
    this.#state = state;
    this.#store = new FormulaStore(this);
    host.addController(this);
  }

  public hostConnected(): void {
    const el = this.#host as unknown as HTMLElement;
    el.addEventListener('cellValueChanged', this.#onCellValueChanged);
  }

  public hostDisconnected(): void {
    const el = this.#host as unknown as HTMLElement;
    el.removeEventListener('cellValueChanged', this.#onCellValueChanged);
  }

  /**
   * After each grid update, follow any change to the data: a new array, a
   * different length, or rows reordered in place (row drag with `applyToData`).
   * Free until a formula or a row label has needed the row frame.
   */
  public hostUpdated(): void {
    if (this.#settling || this.#rows === null) {
      return;
    }
    const data = this.#host.data;
    if (this.#stale() || data.some((row, index) => row !== this.#rows?.[index])) {
      this.#resync();
    }
  }

  /** Whether {@link #settle} is dispatching recalc events right now. */
  public get settling(): boolean {
    return this.#settling;
  }

  // --- FormulaEngineHost ----------------------------------------------------

  public isValidAddress(address: CellAddress): boolean {
    return (
      address.row >= 0 &&
      address.row < this.#frame().length &&
      this.#keyForIndex(address.col) !== undefined
    );
  }

  public readValue(address: CellAddress): CellValue {
    const key = this.#keyForIndex(address.col);
    const row = this.#frame()[address.row] as Record<string, unknown> | undefined;
    return (key === undefined ? null : (row?.[key] ?? null)) as CellValue;
  }

  public writeValue(address: CellAddress, value: CellValue): void {
    const key = this.#keyForIndex(address.col);
    const row = this.#frame()[address.row] as Record<string, unknown> | undefined;
    if (key !== undefined && row) {
      row[key] = value;
    }
  }

  // --- public API (forwarded by the grid in F5) -----------------------------

  /**
   * Set a formula on a cell and recompute it plus its dependents. App code may
   * target any column; fill, paste and `setState` only reach `allowFormula`
   * columns, and `getState` saves only those.
   */
  public setFormula(row: T, columnKey: keyof T & string, src: string): void {
    const address = this.#addressOf(row, columnKey, true);
    if (address) {
      this.#settle(this.#store.set(address, src), true);
    }
  }

  /** The formula source on a cell, if any. */
  public getFormula(row: T, columnKey: keyof T & string): string | undefined {
    if (!this.#store.size) {
      return undefined;
    }
    const address = this.#addressOf(row, columnKey);
    return address ? this.#store.get(address) : undefined;
  }

  /** Remove a formula from a cell and recompute its dependents. */
  public clearFormula(row: T, columnKey: keyof T & string): void {
    const address = this.#addressOf(row, columnKey, true);
    if (address) {
      const had = this.#store.has(address);
      this.#settle(this.#store.clear(address), had);
    }
  }

  /**
   * Copy the formula from a source cell to a target cell, shifting its
   * **relative** references by the data-row / column-letter delta between the
   * two cells; absolute (`$`) axes are preserved. Returns `false` without
   * writing when the source holds no formula or the target column has no
   * `allowFormula`, so a caller (the fill handle or an intra-grid paste) can
   * fall back to copying the literal value.
   */
  public fillFormula(
    sourceRow: T,
    sourceKey: keyof T & string,
    targetRow: T,
    targetKey: keyof T & string
  ): boolean {
    const source = this.#allows(targetKey) && this.#addressOf(sourceRow, sourceKey, true);
    const target = source && this.#addressOf(targetRow, targetKey, true);
    if (!source || !target) {
      return false;
    }
    const src = this.#store.get(source);
    if (src === undefined) {
      return false;
    }
    const shifted = offsetReferences(
      parseFormula(src),
      target.row - source.row,
      target.col - source.col
    );
    this.#settle(this.#store.set(target, stringifyFormula(shifted)), true);
    return true;
  }

  /** Recompute every stored formula. */
  public recalculate(): void {
    this.#sync();
    this.#settle(this.#store.recalcAll());
  }

  /**
   * Register a custom function (upper-cased) for this grid. Throws a
   * `TypeError` for a name no formula could call: one that is not a letter or
   * `_` followed by letters, digits, `_` or `.`, or that is `IF`, `TRUE` or
   * `FALSE`.
   */
  public registerFormulaFunction(name: string, fn: FormulaFn): void {
    if (!isFunctionName(name)) {
      throw new TypeError(`invalid formula function name "${name}"`);
    }
    this.functions.set(name.toUpperCase(), fn);
  }

  /**
   * Every available function name (built-ins + custom + `IF`), upper-case and
   * sorted, for the editor's autocomplete. `IF` is added explicitly because the
   * evaluator implements it directly rather than via the registry.
   */
  public functionNames(): string[] {
    return [...new Set([...this.functions.keys(), 'IF'])].sort();
  }

  /**
   * The A1 reference for a cell, resolved over the grid data and the stable
   * letter order. `absolute` emits a fully-absolute `$A$1` (shift-click insert);
   * otherwise a relative `A1`. Returns `undefined` when the row or column is not
   * in the grid. Used by the editor's click-to-insert.
   */
  public referenceFor(row: T, columnKey: keyof T & string, absolute = false): string | undefined {
    const address = this.#addressOf(row, columnKey);
    return address
      ? formatCell(address, { colAbsolute: absolute, rowAbsolute: absolute })
      : undefined;
  }

  /**
   * The A1 {@link CellAddress} of a cell (data-row index + stable letter index),
   * or `null` when the row/column is not in the grid. The editor uses it to
   * resolve the anchor/focus cells of a click or drag into a reference.
   */
  public addressFor(row: T, columnKey: keyof T & string): CellAddress | null {
    return this.#addressOf(row, columnKey);
  }

  /**
   * The coordinate-hint gutter label for a row: its 1-based A1 row number over
   * the data, so the gutter matches what a reference reads through any sort,
   * filter or page. `null` for a row outside the data (a group or total row);
   * `undefined` when the grid has no formula columns (the gutter then counts
   * view positions).
   */
  public rowCoordinate(row: T): string | null | undefined {
    this.#syncColumns();
    if (!this.#formulaColumns.size) {
      return undefined;
    }
    const index = this.#indexOf(row);
    return index === undefined ? null : String(index + 1);
  }

  /** The coordinate-hint letter of a column: its stable A1 letter (see {@link rowCoordinate}). */
  public columnCoordinate(key: string): string | null | undefined {
    this.#syncColumns();
    return this.#formulaColumns.size ? indexToColumnLetter(this.#indexForKey(key)) : undefined;
  }

  /**
   * Format the A1 reference spanning `anchor`→`focus`: a single cell when the
   * two coincide, else a normalized `A1:C3` range. `absolute` fixes both axes on
   * every corner (`$A$1`), matching the Shift modifier of click/drag insert.
   * Drives the mouse drag-to-insert-range reference entry.
   */
  public rangeReferenceForAddresses(
    anchor: CellAddress,
    focus: CellAddress,
    absolute = false
  ): string {
    const range = normalizeRange({ start: anchor, end: focus });
    const flags = { colAbsolute: absolute, rowAbsolute: absolute };
    const start = formatCell(range.start, flags);
    if (range.start.row === range.end.row && range.start.col === range.end.col) {
      return start;
    }
    return `${start}:${formatCell(range.end, flags)}`;
  }

  /**
   * Show (or clear) the point-mode marquee over the cell/range the user is
   * currently pointing at while editing a formula. Precomputes each cell's edge
   * tokens once (so {@link decorateCell} is a cheap per-cell lookup), mirroring
   * the reference-highlight machinery. `null` clears it.
   */
  public setPointer(range: RangeAddress | null): void {
    if (range === null) {
      if (this.#pointerCells === null) {
        return;
      }
      this.#pointerCells = null;
      this.#state?.bumpDecoration();
      return;
    }
    const r = normalizeRange(range);
    const next = new Map<T, Map<string, string>>();
    for (const cell of rangeCells(r)) {
      const data = this.#frame()[cell.row];
      const key = this.#keyForIndex(cell.col);
      if (data === undefined || key === undefined) {
        continue;
      }
      const edges: string[] = [];
      if (cell.row === r.start.row) edges.push('top');
      if (cell.row === r.end.row) edges.push('bottom');
      if (cell.col === r.start.col) edges.push('left');
      if (cell.col === r.end.col) edges.push('right');
      slot(next, data, () => new Map()).set(key, edges.join(' '));
    }
    this.#pointerCells = next.size ? next : null;
    this.#state?.bumpDecoration();
  }

  /**
   * Reflect the cells the formula being edited references as cell decoration
   * (the editor's live reference highlighting). Each distinct reference cycles a
   * small palette so it reads as its own color, spreadsheet-style. Tolerates
   * partial/invalid input (keeps the last good highlight); `null`, empty, or a
   * non-formula clears. Drives the {@link decorateCell} seam.
   */
  public highlightReferences(src: string | null): void {
    const text = src?.trim() ?? '';
    if (!text.startsWith('=')) {
      this.#setHighlights(null);
      return;
    }
    let ast: FormulaAst;
    try {
      ast = parseFormula(text);
    } catch {
      return; // mid-typing / invalid: leave the last good highlight in place
    }
    const slots = new Map<string, number>(); // ref signature → palette slot
    const next = new Map<T, Map<string, number>>();
    const paint = (cells: CellAddress[], signature: string): void => {
      const palette = slot(slots, signature, () => slots.size % HIGHLIGHT_PALETTE_SIZE);
      for (const cell of cells) {
        const data = this.#frame()[cell.row];
        const key = this.#keyForIndex(cell.col);
        if (data === undefined || key === undefined) {
          continue;
        }
        slot(next, data, () => new Map()).set(key, palette);
      }
    };
    const refs = formulaReferences(ast);
    for (const cell of refs.cells) {
      paint([cell], `c:${cell.row}:${cell.col}`);
    }
    for (const range of refs.ranges) {
      const r = normalizeRange(range);
      paint(rangeCells(range), `r:${r.start.row}:${r.start.col}:${r.end.row}:${r.end.col}`);
    }
    this.#setHighlights(next.size ? next : null);
  }

  /**
   * Decorate a cell for the formula editor: its palette slot when the formula
   * being edited references it (`data-formula-ref`), and/or the point-mode
   * marquee when the user is currently pointing at it (`data-formula-pointer`
   * plus per-side `data-formula-pointer-edge`). Both merge into one decoration.
   */
  public decorateCell(ctx: CellDecoratorContext<T>): CellDecoration | null {
    const key = String(ctx.column.key);
    const slot = this.#highlights?.get(ctx.row)?.get(key);
    const edges = this.#pointerCells?.get(ctx.row)?.get(key);
    if (slot === undefined && edges === undefined) {
      return null;
    }
    const attributes: Record<string, string | null> = {};
    if (slot !== undefined) {
      attributes['data-formula-ref'] = String(slot);
    }
    if (edges !== undefined) {
      attributes['data-formula-pointer'] = '';
      attributes['data-formula-pointer-edge'] = edges.length ? edges : null;
    }
    return { attributes };
  }

  /** Localize a grid string (delegates to the host), used by the editor. */
  public localize(key: GridLocaleKey): string {
    return this.#host.localize(key);
  }

  /**
   * The stored formulas as `(row object, data index, column key, src)`, for
   * state serialization. The grid maps each row object to a durable row
   * reference. Formulas code set outside `allowFormula` columns are left out,
   * as {@link restoreFormulas} would reject them.
   */
  public listFormulas(): Array<{ row: T; index: number; columnKey: string; src: string }> {
    this.#sync();
    const out: Array<{ row: T; index: number; columnKey: string; src: string }> = [];
    for (const { address, src } of this.#store.list()) {
      const row = this.#frame()[address.row];
      const columnKey = this.#letterOrder[address.col];
      if (row !== undefined && this.#formulaColumns.has(columnKey)) {
        out.push({ row, index: address.row, columnKey, src });
      }
    }
    return out;
  }

  /**
   * Replace the formulas in `allowFormula` columns with `entries` and recompute
   * them in one pass (formulas code set in other columns stay). Every entry is
   * validated first, so a bad one never costs the others: a source
   * that does not parse, or a column without `allowFormula`, is skipped and
   * returned. A formula restored onto a row that now sits at another index than
   * its `origin` shifts its relative references by the move, as a fill would.
   * With `strict`, any rejection leaves the stored formulas untouched.
   */
  public restoreFormulas(
    entries: ReadonlyArray<FormulaRestoreEntry<T>>,
    strict = false
  ): FormulaRestoreRejection[] {
    this.#sync();
    const rejected: FormulaRestoreRejection[] = [];
    const valid: Array<{ address: CellAddress; src: string; ast: FormulaAst }> = [];
    for (const { row, columnKey, src: saved, origin } of entries) {
      let src = saved;
      const address = this.#addressOf(row, columnKey as keyof T & string, true);
      if (!address) {
        continue;
      }
      if (!this.#allows(columnKey)) {
        rejected.push({ columnKey, src: saved, reason: 'column' });
        continue;
      }
      let ast: FormulaAst;
      try {
        ast = parseFormula(src);
      } catch {
        rejected.push({ columnKey, src: saved, reason: 'invalid' });
        continue;
      }
      const delta = Number.isInteger(origin) ? address.row - (origin as number) : 0;
      if (delta) {
        ast = offsetReferences(ast, delta, 0);
        src = stringifyFormula(ast);
      }
      valid.push({ address, src, ast });
    }
    if (!(strict && rejected.length)) {
      // Saved state owns only allowFormula columns: formulas code set in other
      // columns are never saved, so a restore (or an AI undo) leaves them.
      const owned = this.#formulaColumns;
      const keep = ({ col }: CellAddress) => !owned.has(this.#letterOrder[col]);
      this.#settle(this.#store.load(valid, keep), true);
    }
    return rejected;
  }

  /** The underlying store, for state serialization (F5). */
  public get store(): FormulaStore {
    return this.#store;
  }

  // --- internals ------------------------------------------------------------

  /** Swap the highlight map and refresh cell decoration (no-op for null→null). */
  #setHighlights(next: Map<T, Map<string, number>> | null): void {
    if (next === null && this.#highlights === null) {
      return;
    }
    this.#highlights = next;
    this.#state?.bumpDecoration();
  }

  /**
   * Any `cellValueChanged` the engine did not dispatch itself is a literal
   * write (editor, paste, fill, `applyEdits`, undo or redo): it replaces a
   * formula stored on that cell and recomputes the cell's dependents. Writes a
   * listener makes while a recalc dispatches are queued for a follow-up pass.
   */
  #onCellValueChanged = (event: Event): void => {
    // With no formula stored, no formula sits on or reads the cell.
    if (this.#ownEvents.has(event) || !this.#store.size) {
      return;
    }
    const detail = (event as CustomEvent<CellValueChangedDetail<T>>).detail;
    if (!detail) {
      return;
    }
    const edit = { row: detail.data, key: String(detail.key) };
    if (this.#settling) {
      this.#queued.push(edit);
      return;
    }
    const { changes, dropped } = this.#applyLiterals([edit]);
    this.#settle(changes, dropped);
  };

  /** Literal edits replace the formulas they land on; their dependents recompute. */
  #applyLiterals(edits: ReadonlyArray<{ row: T; key: string }>): {
    changes: RecalcChange[];
    dropped: boolean;
  } {
    const seeds: CellAddress[] = [];
    let dropped = false;
    for (const { row, key } of edits) {
      const address = this.#addressOf(row, key as keyof T & string, true);
      if (address) {
        dropped ||= this.#store.has(address);
        seeds.push(address);
      }
    }
    return { changes: seeds.length ? this.#store.release(seeds) : [], dropped };
  }

  /** Whether the column takes formulas (`allowFormula`). */
  #allows(key: string): boolean {
    this.#syncColumns();
    return this.#formulaColumns.has(key);
  }

  #addressOf(row: T, columnKey: keyof T & string, refresh = false): CellAddress | null {
    if (refresh) {
      this.#sync();
    }
    let index = this.#indexOf(row);
    // A row added in place since the last update: catch the frame up once.
    if (index === undefined && refresh && this.#store.size && this.#host.data.includes(row)) {
      this.#resync();
      index = this.#indexOf(row);
    }
    return index === undefined ? null : { row: index, col: this.#indexForKey(String(columnKey)) };
  }

  #indexOf(row: T): number | undefined {
    if (!this.#rowIndex) {
      const rows = this.#frame();
      this.#rowIndex = new Map();
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        this.#rowIndex.set(rows[i], i);
      }
    }
    return this.#rowIndex.get(row);
  }

  /** The row frame, built from the current data on first use. */
  #frame(): T[] {
    if (this.#rows === null) {
      this.#lastData = this.#host.data;
      this.#rows = [...this.#lastData];
    }
    return this.#rows;
  }

  /** Whether the data array was replaced or resized since the frame was taken. */
  #stale(): boolean {
    const data = this.#host.data;
    return this.#rows !== null && (data !== this.#lastData || data.length !== this.#rows.length);
  }

  /** Catch the frame up with a replaced or resized data array (cheap check). */
  #sync(): void {
    this.#syncColumns();
    if (this.#stale()) {
      this.#resync();
    }
  }

  /**
   * Retake the row frame from the current data and move every formula with
   * its row: by `rowId` when the grid has one, else by object identity. A new
   * object at a formula's position (an immutable copy, a reload) takes the
   * formula only while it still holds the value the formula computed there,
   * so reattaching never overwrites a literal the formula did not write.
   */
  #resync(): void {
    const previous = (this.#rows ?? []) as Array<Record<string, unknown>>;
    this.#rows = null;
    this.#rowIndex = null;
    const rows = this.#frame() as Array<Record<string, unknown>>;
    this.#syncColumns();
    if (!this.#store.size) {
      // Only formula columns label rows by their data index.
      if (this.#formulaColumns.size) this.#state?.bumpDecoration();
      return;
    }
    const rowId = this.#host.rowId as ((row: object) => string | number) | undefined;
    const byId = rowId && new Map(rows.map((row, index) => [rowId(row), index] as const).reverse());
    let kept: Set<object> | undefined;
    this.#settle(
      this.#store.moveRows((row, col) => {
        const old = previous[row];
        if (old === undefined) return -1;
        if (byId) return byId.get(rowId(old)) ?? -1;
        const index = this.#indexOf(old as T);
        if (index !== undefined) return index;
        const fresh = rows[row];
        const key = this.#letterOrder[col];
        kept ??= new Set(previous);
        return fresh && !kept.has(fresh) && Object.is(fresh[key], old[key]) ? row : -1;
      }),
      true
    );
  }

  /** Refresh the letter order and column sets when the column array changes. */
  #syncColumns(): void {
    const columns = this.#host.columns;
    if (columns === this.#syncedColumns && columns.length === this.#syncedLength) {
      return;
    }
    this.#syncedColumns = columns;
    this.#syncedLength = columns.length;
    this.#columnKeys = new Set();
    this.#formulaColumns = new Set();
    for (const column of columns) {
      const key = String(column.key);
      this.#columnKeys.add(key);
      if (column.allowFormula) {
        this.#formulaColumns.add(key);
      }
      this.#indexForKey(key);
    }
  }

  #keyForIndex(col: number): string | undefined {
    this.#syncColumns();
    const key = this.#letterOrder[col];
    return key !== undefined && this.#columnKeys.has(key) ? key : undefined;
  }

  #indexForKey(key: string): number {
    let index = this.#letterIndex.get(key);
    if (index === undefined) {
      index = this.#letterOrder.push(key) - 1;
      this.#letterIndex.set(key, index);
    }
    return index;
  }

  /**
   * Apply a recalc pass to the grid: values are already written into `row[key]`;
   * re-emit `cellValueChanged` (non-cancelable) for each changed cell so
   * data-bound consumers stay in sync, then request one pipeline pass. The
   * events are tagged so the engine never treats its own writes as literal
   * edits; edits listeners make meanwhile run as follow-up passes. `changed`
   * marks a change to the stored formulas themselves (shown by show-formulas
   * and saved by `getState`), which refreshes the cells even when no value moved.
   */
  #settle(changes: RecalcChange[], changed = false): void {
    if (!changes.length && !changed) {
      return;
    }
    const outer = this.#settling;
    let pending = changes;
    let refresh = changed;
    this.#settling = true;
    try {
      for (let pass = 0; pending.length && pass < MAX_SETTLE_PASSES; pass++) {
        this.#dispatch(pending);
        const queued = this.#queued;
        this.#queued = [];
        const next = this.#applyLiterals(queued);
        pending = next.changes;
        refresh ||= next.dropped;
      }
    } finally {
      this.#settling = outer;
      if (!outer) this.#queued = [];
    }
    if (refresh) {
      this.#state?.bumpDecoration();
    }
    this.#host.requestUpdate(PIPELINE);
  }

  #dispatch(changes: RecalcChange[]): void {
    const viewIndex = viewIndexer(this.#host.pageItems, changes.length);
    for (const { address, value } of changes) {
      const key = this.#keyForIndex(address.col);
      const data = this.#frame()[address.row];
      if (key === undefined || data === undefined) {
        continue;
      }
      const event = new CustomEvent<CellValueChangedDetail<T>>('cellValueChanged', {
        // rowIndex is the view index, -1 off the page (as for any edit).
        detail: { key: key as keyof T & string, rowIndex: viewIndex(data), data, value },
        bubbles: true,
        composed: true,
      });
      this.#ownEvents.add(event);
      this.#host.dispatchEvent(event);
    }
  }
}

/** Feature module registered on the enterprise grid (wired into the set in F5). */
export const formulaModule: GridFeatureModule = {
  id: FORMULA_MODULE_ID,
  create: (host, state) => new FormulaController(host, state),
};
