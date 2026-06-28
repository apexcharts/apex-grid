import type { SortingDirection } from '../operations/sort/types.js';
import type { GridState } from './state-snapshot.js';
import type { ColumnConfiguration, DataType, SelectionMode } from './types.js';
import { getFilterOperandsFor } from './utils.js';

/**
 * A machine-readable description of what the grid is and what can be done to it:
 * the columns and their data types, the operations available per column, the
 * grid-level capabilities, and the current {@link GridState}. Produced by
 * `ApexGrid.getSchema`.
 *
 * @remarks
 * This is the contract an AI layer feeds to an LLM (as the basis of a
 * structured-output schema) and validates a returned state patch against, but it
 * is AI-agnostic: it is equally useful for building a view-editor UI or for docs.
 * It is a descriptor, not a JSON-Schema document — everything needed to *build* a
 * strict JSON Schema (or validate a `setState` patch) is here. Enterprise grids
 * populate the optional grouping / pivot / aggregation fields.
 */
export interface GridSchema {
  /** Schema version, matching {@link GridState.version}. */
  version: 1;
  /** Per-column description, in display order. */
  columns: ColumnSchema[];
  /** Grid-level operation availability. */
  capabilities: GridCapabilities;
  /** The current restorable state, so capabilities and live values travel together. */
  state: GridState;
}

/** Description of a single column for {@link GridSchema}. */
export interface ColumnSchema {
  key: string;
  /** Human label (`headerText`, falling back to `key`). */
  label: string;
  dataType: DataType;
  /** Whether the column opts into sorting (its header sort affordance). */
  sortable: boolean;
  /** Whether the column opts into filtering. */
  filterable: boolean;
  /** Operand names valid for this column when `filterable` (e.g. `'contains'`); else empty. */
  filterOperands: string[];
  editable: boolean;
  hidden: boolean;
  /** Pin band, omitted when the column scrolls with the body. */
  pinned?: 'start' | 'end';
  /** Enterprise: whether the column can be row-grouped. Set by the enterprise grid. */
  groupable?: boolean;
  /** Enterprise: whether the column can be a pivot dimension. Set by the enterprise grid. */
  pivotable?: boolean;
  /** Enterprise: whether the column can be aggregated. Set by the enterprise grid. */
  aggregatable?: boolean;
  /** Enterprise: aggregation functions valid for this column, when `aggregatable`. */
  aggFuncs?: string[];
}

/** Grid-level operation availability for {@link GridSchema}. */
export interface GridCapabilities {
  sort: { directions: SortingDirection[]; multi: boolean };
  filter: { operandsByType: Partial<Record<DataType, string[]>> };
  pagination: boolean;
  selection: SelectionMode | false;
  rowPinning: boolean;
  rowReordering: boolean;
  /** Enterprise: whether row grouping is available. Set by the enterprise grid. */
  grouping?: boolean;
  /** Enterprise: whether pivoting is available. Set by the enterprise grid. */
  pivot?: boolean;
  /** Enterprise: aggregation availability + the supported functions. Set by the enterprise grid. */
  aggregation?: { funcs: string[] };
}

/** Describe a single column: data type + the operations it opts into. */
export function columnSchema<T extends object>(column: ColumnConfiguration<T>): ColumnSchema {
  const filterable = Boolean(column.filter);
  const schema: ColumnSchema = {
    key: String(column.key),
    label: String(column.headerText ?? column.key),
    dataType: (column.type ?? 'string') as DataType,
    sortable: Boolean(column.sort),
    filterable,
    filterOperands: filterable ? Object.keys(getFilterOperandsFor(column)) : [],
    editable: Boolean(column.editable),
    hidden: Boolean(column.hidden),
  };
  if (column.pinned === 'start' || column.pinned === 'end') schema.pinned = column.pinned;
  return schema;
}

/**
 * The filter-operand vocabulary keyed by the data types present among `columns`
 * (the global reference for `capabilities.filter`), resolved from the same
 * source the apply path trusts ({@link getFilterOperandsFor}), so the schema and
 * `setState` can never disagree about valid operands.
 */
export function operandsByType<T extends object>(
  columns: ReadonlyArray<ColumnConfiguration<T>>
): Partial<Record<DataType, string[]>> {
  const out: Partial<Record<DataType, string[]>> = {};
  for (const column of columns) {
    const type = (column.type ?? 'string') as DataType;
    if (!out[type]) out[type] = Object.keys(getFilterOperandsFor(column));
  }
  return out;
}
