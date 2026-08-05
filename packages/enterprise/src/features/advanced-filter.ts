import {
  BooleanOperands,
  type ColumnConfiguration,
  type DataType,
  type FilterOperation,
  NumberOperands,
  StringOperands,
} from 'apex-grid';

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

const OPERANDS_BY_TYPE: Partial<Record<DataType, OperandTable>> = {
  number: NumberOperands as unknown as OperandTable,
  rating: NumberOperands as unknown as OperandTable,
  boolean: BooleanOperands as unknown as OperandTable,
  string: StringOperands as unknown as OperandTable,
  select: StringOperands as unknown as OperandTable,
  image: StringOperands as unknown as OperandTable,
  date: StringOperands as unknown as OperandTable,
};

/** The operand table for a column type (string operands by default). */
export function operandsForType(type: DataType | undefined): OperandTable {
  return OPERANDS_BY_TYPE[type ?? 'string'] ?? (StringOperands as unknown as OperandTable);
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

function columnType<T extends object>(
  columns: ReadonlyArray<ColumnConfiguration<T>>,
  key: string
): DataType | undefined {
  return columns.find((column) => String(column.key) === key)?.type;
}

/** Coerce a text input value to the type the operand expects. */
function coerce(type: DataType | undefined, value: unknown): unknown {
  if ((type === 'number' || type === 'rating') && typeof value === 'string') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  if (type === 'boolean' && typeof value === 'string') return value === 'true';
  return value;
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
  if (node.kind === 'condition') {
    if (!node.column) return true;
    const operand = operandsForType(columnType(columns, node.column))[node.operator];
    if (!operand) return true;
    return !operand.unary && (node.value === undefined || node.value === '');
  }
  return node.children.every((child) => isIgnored(child, columns));
}

/** Evaluate one node against a row (assumes non-ignored). */
function evaluateNode<T extends object>(
  row: T,
  node: AdvancedFilterNode,
  columns: ReadonlyArray<ColumnConfiguration<T>>
): boolean {
  if (node.kind === 'condition') {
    const type = columnType(columns, node.column);
    const operand = operandsForType(type)[node.operator];
    if (!operand) return true;
    const target = (row as Record<string, unknown>)[node.column];
    return operand.logic(target, coerce(type, node.value), undefined);
  }
  const active = node.children.filter((child) => !isIgnored(child, columns));
  if (!active.length) return true;
  return node.join === 'and'
    ? active.every((child) => evaluateNode(row, child, columns))
    : active.some((child) => evaluateNode(row, child, columns));
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
  if (isEmptyModel(model, columns)) return data as T[];
  return data.filter((row) => evaluateNode(row, model, columns));
}

/** A fresh, empty root group (AND). */
export function emptyAdvancedFilter(): AdvancedFilterModel {
  return { kind: 'group', join: 'and', children: [] };
}
