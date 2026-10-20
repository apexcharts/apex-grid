import {
  BooleanOperands,
  type ColumnConfiguration,
  type DataType,
  type FilterOperation,
  NumberOperands,
  StringOperands,
} from 'apex-grid';
import { StateController } from 'apex-grid/internal';

/** How a group's children combine. */
export type AdvancedFilterJoin = 'and' | 'or';

/** A single column condition in the advanced filter tree. */
export interface AdvancedFilterCondition {
  readonly kind: 'condition';
  /** Column key. */
  column: string;
  /** Operand name for the column's type (e.g. `contains`, `greaterThan`). */
  operator: string;
  /** The compared value; omitted for unary operators. */
  value?: string | number | boolean;
}

/** A join group of conditions and/or nested groups. */
export interface AdvancedFilterGroup {
  readonly kind: 'group';
  join: AdvancedFilterJoin;
  children: Array<AdvancedFilterGroup | AdvancedFilterCondition>;
}

export type AdvancedFilterNode = AdvancedFilterGroup | AdvancedFilterCondition;

/** The advanced filter model. Plain JSON, so it round-trips through storage / state. */
export type AdvancedFilterModel = AdvancedFilterGroup;

type OperandTable = Record<string, FilterOperation<unknown>>;

/**
 * Whether a column type holds numbers (`number`, `currency`, `rating`,
 * `progress`). Reads the core rule ({@link StateController.isNumericColumn})
 * so the advanced filter, the builder and the core filter row agree. The
 * method keeps no instance state, and this pure evaluator has no grid, so it
 * is called on the prototype.
 */
export function isNumericType(type: DataType | undefined): boolean {
  return StateController.prototype.isNumericColumn({ type });
}

/**
 * The operand table for a column type: the same choice the core filter makes
 * (boolean, number for the numeric types, string otherwise).
 */
export function operandsForType(type: DataType | undefined): OperandTable {
  if (type === 'boolean') return BooleanOperands as unknown as OperandTable;
  return (isNumericType(type) ? NumberOperands : StringOperands) as unknown as OperandTable;
}

/** The selectable operators (name + label + arity) for a column type. */
export function operatorsForType(
  type: DataType | undefined
): Array<{ name: string; label: string; unary: boolean }> {
  return Object.values(operandsForType(type)).map((op) => ({
    name: op.name,
    label: op.label ?? op.name,
    unary: op.unary,
  }));
}

/** The default operator for a column type (its first operand). */
export function defaultOperator(type: DataType | undefined): string {
  return operatorsForType(type)[0]?.name ?? 'contains';
}

/** Coerce a text input value to the type the operand expects. */
function coerce(type: DataType | undefined, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (isNumericType(type)) {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  if (type === 'boolean') return value === 'true';
  return value;
}

type RowPredicate = (row: Record<string, unknown>) => boolean;

/** Columns by key (first wins on a duplicate key), built once per call. */
function indexColumns<T extends object>(
  columns: ReadonlyArray<ColumnConfiguration<T>>
): Map<string, ColumnConfiguration<T>> {
  const byKey = new Map<string, ColumnConfiguration<T>>();
  for (const column of columns) {
    const key = String(column.key);
    if (!byKey.has(key)) byKey.set(key, column);
  }
  return byKey;
}

/**
 * Compile a node into a row predicate, resolving each condition's column,
 * operand, term and case sensitivity once instead of per row. Returns `null`
 * for a node that contributes nothing: an unknown or empty condition, or a
 * group whose children all do (so a half-built row never hides everything).
 */
function compile<T extends object>(
  node: AdvancedFilterNode,
  byKey: Map<string, ColumnConfiguration<T>>
): RowPredicate | null {
  if (node.kind === 'condition') {
    if (!node.column) return null;
    const column = byKey.get(node.column);
    const operand = operandsForType(column?.type)[node.operator];
    if (!operand) return null;
    if (!operand.unary && (node.value === undefined || node.value === '')) return null;
    const key = node.column;
    const logic = operand.logic;
    const term = coerce(column?.type, node.value);
    // The core filter row's expression, verbatim (FilterController), so a
    // `filter: null` column is tolerated there and here alike.
    const caseSensitive =
      typeof column?.filter === 'boolean' ? false : Boolean(column?.filter?.caseSensitive);
    return (row) => logic(row[key], term, caseSensitive);
  }
  const parts: RowPredicate[] = [];
  for (const child of node.children) {
    const part = compile(child, byKey);
    if (part) parts.push(part);
  }
  if (parts.length < 2) return parts[0] ?? null;
  const count = parts.length;
  return node.join === 'and'
    ? (row) => {
        for (let i = 0; i < count; i++) if (!parts[i](row)) return false;
        return true;
      }
    : (row) => {
        for (let i = 0; i < count; i++) if (parts[i](row)) return true;
        return false;
      };
}

/**
 * Whether a node contributes nothing (so it is skipped): an unknown / empty
 * condition, or a group whose children are all ignored. Keeps a half-built row
 * from hiding everything.
 */
export function isIgnored<T extends object>(
  node: AdvancedFilterNode,
  columns: ReadonlyArray<ColumnConfiguration<T>>
): boolean {
  return compile(node, indexColumns(columns)) === null;
}

/** Whether the model has no effective conditions (a pass-through). */
export function isEmptyModel<T extends object>(
  model: AdvancedFilterModel,
  columns: ReadonlyArray<ColumnConfiguration<T>>
): boolean {
  return isIgnored(model, columns);
}

/** Filter `data` by the advanced filter model (pure; DOM-free). */
export function filterRows<T extends object>(
  data: ReadonlyArray<T>,
  model: AdvancedFilterModel,
  columns: ReadonlyArray<ColumnConfiguration<T>>
): T[] {
  const predicate = compile(model, indexColumns(columns));
  if (!predicate) return data as T[];
  return data.filter(predicate as unknown as (row: T) => boolean);
}

/** A fresh, empty root group (AND). */
export function emptyAdvancedFilter(): AdvancedFilterModel {
  return { kind: 'group', join: 'and', children: [] };
}

/**
 * A deep copy of a model node that shares nothing with it. Spreads each node
 * instead of using structuredClone, which throws on a framework's reactive
 * Proxy; the model is plain data by contract, so spreading is enough.
 */
export function copyAdvancedFilter<N extends AdvancedFilterNode>(node: N): N {
  return (
    node.kind === 'condition'
      ? { ...node }
      : { ...node, children: node.children.map((child) => copyAdvancedFilter(child)) }
  ) as N;
}
