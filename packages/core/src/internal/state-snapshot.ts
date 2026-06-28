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
 * The outcome of an {@link SetStateOptions} apply. `setState` never throws on
 * malformed input (unless `strict`): it applies recognized slices, skips the
 * rest, and records human-readable {@link warnings} for anything dropped,
 * clamped, or unresolved.
 */
export interface SetStateResult {
  /** Slice names that were present and applied (e.g. `'sort'`, `'columns'`). */
  applied: string[];
  /** Known slice names that were absent (left untouched). */
  skipped: string[];
  /** What was dropped / clamped / unresolved, one message each. */
  warnings: string[];
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
 * from `layout` are appended unchanged; layout entries with no matching column
 * are ignored.
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
 * Rebuild filter expressions from a snapshot, resolving each operand name back
 * to a live {@link FilterOperation} via the target column's operand set.
 * Entries whose column or operand can't be resolved are dropped; `onDrop` (when
 * given) is called with the dropped entry and a reason.
 */
export function deserializeFilter<T extends object>(
  snapshots: ReadonlyArray<FilterStateSnapshot>,
  getColumn: (key: string) => ColumnConfiguration<T> | undefined,
  onDrop?: (snapshot: FilterStateSnapshot, reason: string) => void
): FilterExpression<T>[] {
  const expressions: FilterExpression<T>[] = [];
  for (const snapshot of snapshots) {
    const column = getColumn(snapshot.key);
    if (!column) {
      onDrop?.(snapshot, 'unknown column');
      continue;
    }
    const operands = getFilterOperandsFor(column) as unknown as Record<
      string,
      FilterOperation<unknown>
    >;
    const condition = operands[snapshot.operand];
    if (!condition) {
      onDrop?.(snapshot, `unknown operand "${snapshot.operand}"`);
      continue;
    }
    expressions.push({
      key: snapshot.key as Keys<T>,
      condition,
      searchTerm: snapshot.searchTerm,
      criteria: snapshot.criteria,
      caseSensitive: snapshot.caseSensitive,
    } as unknown as FilterExpression<T>);
  }
  return expressions;
}

// --- row references --------------------------------------------------------

/**
 * Serialize a set of rows to {@link RowRef}s. With a `rowId` resolver each row
 * is captured by id; otherwise by its positional index in `universe`
 * (`ApexGrid.data`). Rows not found in `universe` (index mode) are skipped.
 */
export function serializeRowRefs<T extends object>(
  rows: ReadonlyArray<T>,
  universe: ReadonlyArray<T>,
  rowId?: (row: T) => string | number
): RowRef[] {
  const refs: RowRef[] = [];
  for (const row of rows) {
    if (rowId) {
      refs.push({ id: rowId(row) });
    } else {
      const index = universe.indexOf(row);
      if (index !== -1) refs.push({ index });
    }
  }
  return refs;
}

/**
 * Resolve {@link RowRef}s back to rows in `universe`. `id` refs require a
 * `rowId` resolver (otherwise they're skipped); `index` refs resolve
 * positionally. Unresolvable refs are dropped.
 */
export function resolveRowRefs<T extends object>(
  refs: ReadonlyArray<RowRef>,
  universe: ReadonlyArray<T>,
  rowId?: (row: T) => string | number
): T[] {
  const out: T[] = [];
  let byId: Map<string | number, T> | null = null;
  for (const ref of refs) {
    if ('id' in ref) {
      if (!rowId) continue;
      if (!byId) {
        byId = new Map();
        for (const row of universe) byId.set(rowId(row), row);
      }
      const row = byId.get(ref.id);
      if (row) out.push(row);
    } else {
      const row = universe[ref.index];
      if (row) out.push(row);
    }
  }
  return out;
}
