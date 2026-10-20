import type {
  FilterCriteria,
  FilterExpression,
  FilterOperation,
} from '../operations/filter/types.js';
import type { SortExpression, SortingDirection } from '../operations/sort/types.js';
import type { ColumnConfiguration, Keys, PinPosition } from './types.js';
import { getFilterOperandsFor } from './utils.js';

/**
 * A serializable, JSON-safe snapshot of the grid's restorable state, produced by
 * `ApexGrid.getState` and consumed by `ApexGrid.setState`.
 *
 * @remarks
 * Functions and templates are never serialized — sort comparers, filter
 * condition functions, and cell/header/editor templates are re-bound from the
 * live column configuration on restore. Filter conditions are captured as
 * operand name strings (e.g. `'contains'`). Selection / expansion / tree rows
 * are captured as {@link RowRef}s (a stable `id` when an `ApexGrid.rowId`
 * resolver is configured, otherwise a positional `index` into `ApexGrid.data`,
 * which round-trips within a session but not across a data reload).
 */
export interface GridState {
  /** Snapshot schema version. */
  version: 1;
  /** Per-column layout (order, width, pinning, visibility). */
  columns: ColumnLayoutState[];
  /** Active sort expressions (comparer functions omitted). */
  sort: SortStateSnapshot[];
  /** Active per-column filter expressions (condition captured by operand name). */
  filter: FilterStateSnapshot[];
  /** Global quick-filter term. */
  quickFilter: string;
  /** Pagination position. */
  pagination: { page: number; pageSize: number };
  /** Selected rows. */
  selection: RowRef[];
  /** Expanded (master-detail) rows. */
  expansion: RowRef[];
  /** Expanded tree rows that have backing data. */
  treeExpanded: RowRef[];
  /** Expanded synthesized tree parents (path-keyed; already string-stable). */
  treeExpandedKeys: string[];
  /**
   * Pinned rows (F4) by {@link RowRef}, per band. Optional: absent on snapshots
   * produced before row pinning existed; `getState` always emits it (empty bands
   * when nothing is pinned).
   */
  rowPinning?: { top: RowRef[]; bottom: RowRef[] };
  /**
   * Manual drag-reorder order (F5) as a full {@link RowRef} list, or `null` for
   * the derived (filter → sort) order. Optional for back-compat; `getState`
   * always emits it (`null` when no manual order is active). Mutually exclusive
   * with `sort`: a snapshot carrying both drops `rowOrder` on restore.
   */
  rowOrder?: RowRef[] | null;
  /** Per-module serialized state, keyed by module id. */
  modules: Record<string, unknown>;
}

/** Layout state for a single column. Order is implied by array position. */
export interface ColumnLayoutState {
  key: string;
  width?: string;
  pinned?: PinPosition;
  hidden?: boolean;
}

/** A single sort expression, stripped of its (non-serializable) comparer. */
export interface SortStateSnapshot {
  key: string;
  direction: SortingDirection;
  caseSensitive?: boolean;
}

/** A single filter expression with its condition captured by operand name. */
export interface FilterStateSnapshot {
  key: string;
  /** Operand name, e.g. `'contains'` / `'greaterThan'` (see the `*Operands`). */
  operand: string;
  searchTerm?: unknown;
  criteria?: FilterCriteria;
  caseSensitive?: boolean;
}

/**
 * A reference to a row in `ApexGrid.data`: a stable `id` (when an
 * `ApexGrid.rowId` resolver is configured) or a positional `index`.
 */
export type RowRef = { readonly id: string | number } | { readonly index: number };

/** Options for `ApexGrid.getState`. */
export interface GetStateOptions<T extends object> {
  /** Row-identity resolver; overrides `ApexGrid.rowId` for this call. */
  rowId?: (row: T) => string | number;
}

/** Options for `ApexGrid.setState`. */
export interface SetStateOptions<T extends object> {
  /** Row-identity resolver; overrides `ApexGrid.rowId` for this call. */
  rowId?: (row: T) => string | number;
  /**
   * Throw on the first problem instead of degrading. Off by default: `setState`
   * applies what it can and reports the rest via {@link SetStateResult.warnings}
   * (the right behavior for LLM-produced or persisted-and-possibly-stale input).
   * Turn on for tests / development to fail loudly.
   */
  strict?: boolean;
}

/**
 * The `setState` slices in the order `setState` applies them, each mapped to
 * the {@link GridState} keys it restores (`tree` restores both tree keys).
 */
export const SET_STATE_SLICE_KEYS = {
  columns: ['columns'],
  sort: ['sort'],
  filter: ['filter'],
  quickFilter: ['quickFilter'],
  modules: ['modules'],
  rowOrder: ['rowOrder'],
  tree: ['treeExpanded', 'treeExpandedKeys'],
  expansion: ['expansion'],
  rowPinning: ['rowPinning'],
  selection: ['selection'],
  pagination: ['pagination'],
} as const satisfies Record<string, ReadonlyArray<keyof GridState>>;

/** A `setState` slice name, as reported in {@link SetStateResult}. */
export type SetStateSlice = keyof typeof SET_STATE_SLICE_KEYS;

/** Every slice name, in apply order. */
export const SET_STATE_SLICES = Object.keys(SET_STATE_SLICE_KEYS) as SetStateSlice[];

// Compile-time check: a new GridState key cannot be added without a slice.
const _everyKeyHasASlice: Exclude<
  keyof GridState,
  'version' | (typeof SET_STATE_SLICE_KEYS)[SetStateSlice][number]
> extends never
  ? true
  : never = true;
void _everyKeyHasASlice;

/**
 * The outcome of an {@link SetStateOptions} apply. `setState` never throws on
 * malformed input (unless `strict`): it applies recognized slices, skips the
 * rest, and records human-readable {@link warnings} for anything dropped,
 * clamped, or unresolved.
 */
export interface SetStateResult {
  /**
   * Slice names that were present and applied (e.g. `'sort'`, `'columns'`); see
   * {@link SET_STATE_SLICE_KEYS} for the {@link GridState} keys of each.
   */
  applied: string[];
  /** Known slice names ({@link SetStateSlice}) that were absent or not applied. */
  skipped: string[];
  /** What was dropped / clamped / unresolved, one message each. */
  warnings: string[];
}

/** A non-null object with a string `key`: the shape every keyed entry needs. */
function isKeyed(value: unknown): value is { key: string } {
  return typeof value === 'object' && value !== null && typeof (value as any).key === 'string';
}

// --- columns ---------------------------------------------------------------

/** Capture the layout-managed properties of each column, in array order. */
export function serializeColumnLayout<T extends object>(
  columns: ReadonlyArray<ColumnConfiguration<T>>
): ColumnLayoutState[] {
  return columns.map((column) => ({
    key: String(column.key),
    width: column.width,
    pinned: column.pinned ?? undefined,
    hidden: column.hidden ?? undefined,
  }));
}

/**
 * Return a new columns array reordered to match `layout`, with width / pinning /
 * visibility applied. Column objects are shallow-cloned so non-layout
 * properties (templates, comparers, type config) are preserved. Columns absent
 * from `layout` are appended unchanged; layout entries with no matching column,
 * a repeated key, or no string `key` are ignored. This is the full-layout
 * restorer: to change a few fields in place, overlay them with
 * {@link mergeColumnLayout} first.
 */
export function applyColumnLayout<T extends object>(
  columns: ReadonlyArray<ColumnConfiguration<T>>,
  layout: ReadonlyArray<ColumnLayoutState>
): ColumnConfiguration<T>[] {
  const byKey = new Map<string, ColumnConfiguration<T>>();
  for (const column of columns) byKey.set(String(column.key), column);

  const used = new Set<string>();
  const ordered: ColumnConfiguration<T>[] = [];
  for (const entry of layout) {
    if (!isKeyed(entry) || used.has(entry.key)) continue;
    const column = byKey.get(entry.key);
    if (!column) continue;
    used.add(entry.key);
    ordered.push({
      ...column,
      width: entry.width,
      pinned: entry.pinned ?? undefined,
      hidden: entry.hidden ?? false,
    } as ColumnConfiguration<T>);
  }
  for (const column of columns) {
    if (!used.has(String(column.key))) ordered.push(column);
  }
  return ordered;
}

/**
 * Overlay a partial layout onto `current` (a full {@link serializeColumnLayout}
 * result): each `partial` entry changes only the fields it defines on the
 * column with the same key, and the order of `current` is kept. `null` clears
 * a field (e.g. `pinned: null` unpins). Entries for unknown keys are ignored.
 * Returns a new full layout to hand to `setState({ columns })`.
 */
export function mergeColumnLayout(
  current: ReadonlyArray<ColumnLayoutState>,
  partial: ReadonlyArray<Partial<Record<keyof ColumnLayoutState, unknown>>>
): ColumnLayoutState[] {
  const patches = new Map<string, Record<string, unknown>>();
  for (const entry of partial) {
    if (isKeyed(entry)) patches.set(entry.key, entry);
  }
  return current.map((column) => {
    const next: Record<string, unknown> = { ...column };
    const patch = patches.get(column.key);
    if (patch) {
      for (const field of ['width', 'pinned', 'hidden'] as const) {
        if (patch[field] !== undefined) next[field] = patch[field] ?? undefined;
      }
    }
    return next as unknown as ColumnLayoutState;
  });
}

// --- sort ------------------------------------------------------------------

export function serializeSort<T extends object>(
  expressions: ReadonlyArray<SortExpression<T>>
): SortStateSnapshot[] {
  return expressions.map((expression) => ({
    key: String(expression.key),
    direction: expression.direction,
    caseSensitive: expression.caseSensitive,
  }));
}

// --- filter ----------------------------------------------------------------

export function serializeFilter<T extends object>(
  expressions: ReadonlyArray<FilterExpression<T>>
): FilterStateSnapshot[] {
  return expressions.map((expression) => {
    const condition = expression.condition as FilterOperation<unknown> | string;
    return {
      key: String(expression.key),
      operand: typeof condition === 'string' ? condition : condition.name,
      searchTerm: expression.searchTerm,
      criteria: expression.criteria,
      caseSensitive: expression.caseSensitive,
    };
  });
}

/**
 * Resolve a filter operand name (e.g. `'contains'`) to the live
 * {@link FilterOperation} of `column`'s type. Only the operand table's own
 * names resolve, so `'toString'` or `'constructor'` never pass as operands.
 */
export function resolveFilterOperand<T extends object>(
  column: ColumnConfiguration<T>,
  name: unknown
): FilterOperation<unknown> | undefined {
  const operands = getFilterOperandsFor(column) as unknown as Record<
    string,
    FilterOperation<unknown>
  >;
  return typeof name === 'string' && Object.hasOwn(operands, name) ? operands[name] : undefined;
}

/**
 * Rebuild filter expressions from a snapshot, resolving each operand name back
 * to a live {@link FilterOperation} via the target column's operand set.
 * Entries that are not keyed objects, whose column or operand can't be
 * resolved, or whose binary operand has no `searchTerm` are dropped; `onDrop`
 * (when given) is called with the dropped entry and a reason.
 */
export function deserializeFilter<T extends object>(
  snapshots: ReadonlyArray<FilterStateSnapshot>,
  getColumn: (key: string) => ColumnConfiguration<T> | undefined,
  onDrop?: (snapshot: FilterStateSnapshot, reason: string) => void
): FilterExpression<T>[] {
  const expressions: FilterExpression<T>[] = [];
  for (const snapshot of snapshots) {
    if (!isKeyed(snapshot)) {
      onDrop?.({ key: String(snapshot) } as FilterStateSnapshot, 'not a filter entry');
      continue;
    }
    const column = getColumn(snapshot.key);
    if (!column) {
      onDrop?.(snapshot, 'unknown column');
      continue;
    }
    const condition = resolveFilterOperand(column, snapshot.operand);
    if (!condition) {
      onDrop?.(snapshot, `unknown operand "${snapshot.operand}"`);
      continue;
    }
    if (!condition.unary && (snapshot.searchTerm === undefined || snapshot.searchTerm === null)) {
      onDrop?.(snapshot, `operand "${snapshot.operand}" needs a searchTerm`);
      continue;
    }
    // Omitted fields stay absent so the column defaults (case sensitivity,
    // 'and' criteria) apply rather than an explicit undefined.
    const expression: Record<string, unknown> = { key: snapshot.key as Keys<T>, condition };
    if (snapshot.searchTerm !== undefined) expression.searchTerm = snapshot.searchTerm;
    if (snapshot.criteria !== undefined) expression.criteria = snapshot.criteria;
    if (snapshot.caseSensitive !== undefined) expression.caseSensitive = snapshot.caseSensitive;
    expressions.push(expression as unknown as FilterExpression<T>);
  }
  return expressions;
}

// --- row references --------------------------------------------------------

/**
 * Serialize a set of rows to {@link RowRef}s. With a `rowId` resolver each row
 * is captured by id; otherwise by its positional index in `universe`
 * (`ApexGrid.data`). Rows not found in `universe` (index mode) are skipped.
 * Index mode builds one position map per call, so it is linear in the sizes
 * of `rows` and `universe` rather than their product.
 */
export function serializeRowRefs<T extends object>(
  rows: ReadonlyArray<T>,
  universe: ReadonlyArray<T>,
  rowId?: (row: T) => string | number
): RowRef[] {
  if (rowId) return rows.map((row) => ({ id: rowId(row) }));
  if (rows.length < 2) {
    // A single lookup is cheaper than building the map.
    const index = rows.length ? universe.indexOf(rows[0]) : -1;
    return index === -1 ? [] : [{ index }];
  }
  const positions = new Map<T, number>();
  universe.forEach((row, index) => {
    if (!positions.has(row)) positions.set(row, index);
  });
  const refs: RowRef[] = [];
  for (const row of rows) {
    const index = positions.get(row);
    if (index !== undefined) refs.push({ index });
  }
  return refs;
}

/**
 * Resolve {@link RowRef}s back to rows in `universe`. `id` refs require a
 * `rowId` resolver (otherwise they're skipped); `index` refs resolve
 * positionally and must be non-negative integers. Refs that are not objects,
 * and unresolvable refs, are dropped.
 */
export function resolveRowRefs<T extends object>(
  refs: ReadonlyArray<RowRef>,
  universe: ReadonlyArray<T>,
  rowId?: (row: T) => string | number
): T[] {
  const out: T[] = [];
  let byId: Map<string | number, T> | null = null;
  for (const ref of refs) {
    if (typeof ref !== 'object' || ref === null) continue;
    if ('id' in ref) {
      if (!rowId) continue;
      if (!byId) {
        byId = new Map();
        for (const row of universe) byId.set(rowId(row), row);
      }
      const row = byId.get(ref.id);
      if (row) out.push(row);
    } else if (Number.isInteger(ref.index) && ref.index >= 0) {
      const row = universe[ref.index];
      if (row) out.push(row);
    }
  }
  return out;
}
