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
import { type GridFeatureModule, type GridHost, PIPELINE } from 'apex-grid/internal';
import type { ReactiveController } from 'lit';
import { type CellValue, cycleError, refError } from './errors.js';
import { evaluate, type FormulaContext } from './evaluator.js';
import { createFunctionRegistry, type FormulaFn } from './functions.js';
import {
  type FormulaAst,
  formulaReferences,
  offsetReferences,
  parseFormula,
  stringifyFormula,
} from './parser.js';
import { type CellAddress, formatCell, rangeCells } from './refs.js';

export const FORMULA_MODULE_ID = 'formula';

const cellKey = (address: CellAddress): string => `${address.row}:${address.col}`;

function parseCellKey(key: string): CellAddress {
  const separator = key.indexOf(':');
  return { row: Number(key.slice(0, separator)), col: Number(key.slice(separator + 1)) };
}

interface FormulaEntry {
  src: string;
  ast: FormulaAst;
  /** Cell keys this formula reads (range cells expanded), for graph edges. */
  precedents: Set<string>;
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
 */
export class FormulaStore {
  readonly #entries = new Map<string, FormulaEntry>();
  /** precedent cell key -> set of formula cells that read it. */
  readonly #dependents = new Map<string, Set<string>>();

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
    const ast = parseFormula(src);
    const precedents = new Set<string>();
    const refs = formulaReferences(ast);
    for (const cell of refs.cells) {
      precedents.add(cellKey(cell));
    }
    for (const range of refs.ranges) {
      for (const cell of rangeCells(range)) {
        precedents.add(cellKey(cell));
      }
    }

    const key = cellKey(address);
    this.#removeEdges(key);
    this.#entries.set(key, { src, ast, precedents });
    for (const precedent of precedents) {
      let set = this.#dependents.get(precedent);
      if (!set) {
        set = new Set();
        this.#dependents.set(precedent, set);
      }
      set.add(key);
    }
    return this.recalc([address], true);
  }

  /**
   * Remove the formula at the address (if any) and recompute its dependents
   * (which now read whatever literal value the cell holds).
   */
  public clear(address: CellAddress): RecalcChange[] {
    const key = cellKey(address);
    if (!this.#entries.has(key)) {
      return [];
    }
    this.#removeEdges(key);
    this.#entries.delete(key);
    return this.recalc([address], false);
  }

  /** Recompute every stored formula (e.g. after the data array is replaced). */
  public recalcAll(): RecalcChange[] {
    return this.recalc([...this.#entries.keys()].map(parseCellKey), true);
  }

  /** Drop every formula and dependency edge (values are left untouched). */
  public clearAll(): void {
    this.#entries.clear();
    this.#dependents.clear();
  }

  /**
   * Recompute the formula cells affected by changes to `seeds`. When
   * `includeSeeds` is true, seed cells that are themselves formulas are
   * recomputed as well (used when a formula is set or on a full recompute).
   */
  public recalc(seeds: CellAddress[], includeSeeds: boolean): RecalcChange[] {
    const affected = this.#collectAffected(seeds.map(cellKey), includeSeeds);
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

  #removeEdges(key: string): void {
    const entry = this.#entries.get(key);
    if (!entry) {
      return;
    }
    for (const precedent of entry.precedents) {
      const set = this.#dependents.get(precedent);
      if (set) {
        set.delete(key);
        if (!set.size) {
          this.#dependents.delete(precedent);
        }
      }
    }
  }

  /** Formula cells transitively dependent on the seeds (plus the seeds if asked). */
  #collectAffected(seedKeys: string[], includeSeeds: boolean): Set<string> {
    const affected = new Set<string>();
    if (includeSeeds) {
      for (const key of seedKeys) {
        if (this.#entries.has(key)) {
          affected.add(key);
        }
      }
    }
    const seen = new Set<string>(seedKeys);
    const queue = [...seedKeys];
    while (queue.length) {
      const key = queue.shift() as string;
      const dependents = this.#dependents.get(key);
      if (!dependents) {
        continue;
      }
      for (const dependent of dependents) {
        if (this.#entries.has(dependent)) {
          affected.add(dependent);
        }
        if (!seen.has(dependent)) {
          seen.add(dependent);
          queue.push(dependent);
        }
      }
    }
    return affected;
  }

  /** Kahn's algorithm over the affected subgraph; leftovers are cyclic. */
  #topoSort(affected: Set<string>): { order: string[]; cyclic: string[] } {
    const indegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();
    for (const key of affected) {
      indegree.set(key, 0);
    }
    for (const key of affected) {
      const entry = this.#entries.get(key);
      if (!entry) {
        continue;
      }
      for (const precedent of entry.precedents) {
        if (affected.has(precedent)) {
          const list = adjacency.get(precedent);
          if (list) {
            list.push(key);
          } else {
            adjacency.set(precedent, [key]);
          }
          indegree.set(key, (indegree.get(key) ?? 0) + 1);
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
    while (queue.length) {
      const key = queue.shift() as string;
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

/**
 * Host-bound recalc controller. Adapts a grid to the {@link FormulaStore}:
 * resolves A1 column indices to data keys with a stable letter order, reads and
 * writes `row[key]`, recomputes dependents on `cellValueChanged`, and settles a
 * pass with one pipeline update. Computed values are the canonical cell values
 * (D1); recalc writes are not recorded in edit history.
 */
export class FormulaController<T extends object> implements ReactiveController, FormulaEngineHost {
  /** Per-instance registry, so custom functions do not leak across grids. */
  public readonly functions: Map<string, FormulaFn> = createFunctionRegistry();

  readonly #host: GridHost<T>;
  readonly #store: FormulaStore;
  /** Stable A1 letter order: column keys in first-seen order, append-only so a
   * formula's letters survive column reorder; a removed column's slot is kept. */
  #letterOrder: string[] = [];
  #recomputing = false;
  #lastData: ReadonlyArray<T> | undefined;

  constructor(host: GridHost<T>) {
    this.#host = host;
    this.#store = new FormulaStore(this);
    host.addController(this);
  }

  public hostConnected(): void {
    const el = this.#host as unknown as HTMLElement;
    el.addEventListener('cellValueChanged', this.#onCellValueChanged);
    this.#syncColumns();
    this.#lastData = this.#host.data;
  }

  public hostDisconnected(): void {
    const el = this.#host as unknown as HTMLElement;
    el.removeEventListener('cellValueChanged', this.#onCellValueChanged);
  }

  /** After each grid update, a new data array means a positional full recompute. */
  public hostUpdated(): void {
    if (this.#recomputing) {
      return;
    }
    if (this.#host.data !== this.#lastData) {
      this.#lastData = this.#host.data;
      this.#syncColumns();
      this.#settle(this.#store.recalcAll());
    }
  }

  // --- FormulaEngineHost ----------------------------------------------------

  public isValidAddress(address: CellAddress): boolean {
    const key = this.#letterOrder[address.col];
    return (
      key !== undefined &&
      address.row >= 0 &&
      address.row < this.#host.data.length &&
      this.#columnExists(key)
    );
  }

  public readValue(address: CellAddress): CellValue {
    const key = this.#keyForIndex(address.col);
    if (key === undefined) {
      return null;
    }
    const row = this.#host.data[address.row] as Record<string, unknown> | undefined;
    return (row?.[key] ?? null) as CellValue;
  }

  public writeValue(address: CellAddress, value: CellValue): void {
    const key = this.#keyForIndex(address.col);
    if (key === undefined) {
      return;
    }
    const row = this.#host.data[address.row] as Record<string, unknown> | undefined;
    if (row) {
      row[key] = value;
    }
  }

  // --- public API (forwarded by the grid in F5) -----------------------------

  /** Set a formula on a cell and recompute it plus its dependents. */
  public setFormula(row: T, columnKey: keyof T & string, src: string): void {
    const address = this.#addressOf(row, columnKey);
    if (address) {
      this.#settle(this.#store.set(address, src));
    }
  }

  /** The formula source on a cell, if any. */
  public getFormula(row: T, columnKey: keyof T & string): string | undefined {
    const address = this.#addressOf(row, columnKey);
    return address ? this.#store.get(address) : undefined;
  }

  /** Remove a formula from a cell and recompute its dependents. */
  public clearFormula(row: T, columnKey: keyof T & string): void {
    const address = this.#addressOf(row, columnKey);
    if (address) {
      this.#settle(this.#store.clear(address));
    }
  }

  /**
   * Copy the formula from a source cell to a target cell, shifting its
   * **relative** references by the data-row / column-letter delta between the
   * two cells; absolute (`$`) axes are preserved. Returns `false` without
   * writing when the source holds no formula, so a caller (the fill handle or an
   * intra-grid paste) can fall back to copying the literal value.
   */
  public fillFormula(
    sourceRow: T,
    sourceKey: keyof T & string,
    targetRow: T,
    targetKey: keyof T & string
  ): boolean {
    const source = this.#addressOf(sourceRow, sourceKey);
    const target = this.#addressOf(targetRow, targetKey);
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
    this.#settle(this.#store.set(target, stringifyFormula(shifted)));
    return true;
  }

  /** Recompute every stored formula. */
  public recalculate(): void {
    this.#syncColumns();
    this.#settle(this.#store.recalcAll());
  }

  /** Register a custom function (upper-cased) for this grid. */
  public registerFormulaFunction(name: string, fn: FormulaFn): void {
    this.functions.set(name.toUpperCase(), fn);
  }

  /** Localize a grid string (delegates to the host), used by the editor. */
  public localize(key: GridLocaleKey): string {
    return this.#host.localize(key);
  }

  /**
   * The stored formulas as `(row object, column key, src)`, for state
   * serialization. The grid maps each row object to a durable row reference.
   */
  public listFormulas(): Array<{ row: T; columnKey: string; src: string }> {
    this.#syncColumns();
    const out: Array<{ row: T; columnKey: string; src: string }> = [];
    for (const { address, src } of this.#store.list()) {
      const row = this.#host.data[address.row];
      const columnKey = this.#letterOrder[address.col];
      if (row !== undefined && columnKey !== undefined) {
        out.push({ row, columnKey, src });
      }
    }
    return out;
  }

  /** Replace all formulas with the given `(row object, column key, src)` entries. */
  public restoreFormulas(entries: ReadonlyArray<{ row: T; columnKey: string; src: string }>): void {
    this.#store.clearAll();
    for (const { row, columnKey, src } of entries) {
      this.setFormula(row, columnKey as keyof T & string, src);
    }
  }

  /** The underlying store, for state serialization (F5). */
  public get store(): FormulaStore {
    return this.#store;
  }

  // --- internals ------------------------------------------------------------

  #onCellValueChanged = (event: Event): void => {
    if (this.#recomputing) {
      return;
    }
    const detail = (event as CustomEvent<CellValueChangedDetail<T>>).detail;
    if (!detail) {
      return;
    }
    this.#syncColumns();
    const row = this.#host.data.indexOf(detail.data);
    if (row === -1) {
      return;
    }
    const col = this.#indexForKey(String(detail.key));
    this.#settle(this.#store.recalc([{ row, col }], false));
  };

  #addressOf(row: T, columnKey: keyof T & string): CellAddress | null {
    this.#syncColumns();
    const rowIndex = this.#host.data.indexOf(row);
    if (rowIndex === -1) {
      return null;
    }
    return { row: rowIndex, col: this.#indexForKey(String(columnKey)) };
  }

  #syncColumns(): void {
    for (const column of this.#host.columns) {
      const key = String(column.key);
      if (!this.#letterOrder.includes(key)) {
        this.#letterOrder.push(key);
      }
    }
  }

  #keyForIndex(col: number): string | undefined {
    const key = this.#letterOrder[col];
    return key !== undefined && this.#columnExists(key) ? key : undefined;
  }

  #indexForKey(key: string): number {
    const existing = this.#letterOrder.indexOf(key);
    if (existing !== -1) {
      return existing;
    }
    this.#letterOrder.push(key);
    return this.#letterOrder.length - 1;
  }

  #columnExists(key: string): boolean {
    return this.#host.columns.some((column) => String(column.key) === key);
  }

  /**
   * Apply a recalc pass to the grid: values are already written into `row[key]`;
   * re-emit `cellValueChanged` (non-cancelable) for each changed cell so
   * data-bound consumers stay in sync, then request one pipeline pass. Guarded
   * by `#recomputing` so the engine's own writes never re-trigger recalc.
   */
  #settle(changes: RecalcChange[]): void {
    if (!changes.length) {
      return;
    }
    this.#recomputing = true;
    try {
      for (const { address, value } of changes) {
        const key = this.#keyForIndex(address.col);
        const data = this.#host.data[address.row];
        if (key === undefined || data === undefined) {
          continue;
        }
        const viewIndex = this.#host.pageItems.indexOf(data);
        this.#host.dispatchEvent(
          new CustomEvent<CellValueChangedDetail<T>>('cellValueChanged', {
            detail: {
              key: key as keyof T & string,
              rowIndex: viewIndex >= 0 ? viewIndex : address.row,
              data,
              value,
            },
            bubbles: true,
            composed: true,
          })
        );
      }
    } finally {
      this.#recomputing = false;
    }
    this.#host.requestUpdate(PIPELINE);
  }
}

/** Feature module registered on the enterprise grid (wired into the set in F5). */
export const formulaModule: GridFeatureModule = {
  id: FORMULA_MODULE_ID,
  create: (host) => new FormulaController(host),
};
