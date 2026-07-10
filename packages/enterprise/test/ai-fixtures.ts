import type { GridSchema, GridState } from 'apex-grid';
import {
  ConversationMemory,
  createContextBuilder,
  createFakeGridApi,
  emptyGridState,
  type GridApi,
  type GridContext,
  type Memory,
} from '../src/features/ai/index.js';

export interface Row {
  region: string;
  product: string;
  amount: number;
}

/** A grid with grouping + pivot + aggregation, and opted-in columns, for rule-engine tests. */
export const enterpriseSchema: GridSchema = {
  version: 1,
  columns: [
    {
      key: 'region',
      label: 'Region',
      dataType: 'string',
      sortable: true,
      filterable: true,
      filterOperands: ['equals', 'doesNotEqual', 'contains'],
      editable: false,
      hidden: false,
      groupable: true,
      pivotable: true,
    },
    {
      key: 'product',
      label: 'Product',
      dataType: 'string',
      sortable: true,
      filterable: true,
      filterOperands: ['equals', 'contains'],
      editable: false,
      hidden: false,
      groupable: true,
    },
    {
      key: 'amount',
      label: 'Amount',
      dataType: 'number',
      sortable: true,
      filterable: true,
      filterOperands: [
        'equals',
        'doesNotEqual',
        'greaterThan',
        'greaterThanOrEqual',
        'lessThan',
        'lessThanOrEqual',
      ],
      editable: false,
      hidden: false,
      aggregatable: true,
      aggFuncs: ['sum', 'avg', 'min', 'max', 'count'],
    },
  ],
  capabilities: {
    sort: { directions: ['ascending', 'descending'], multi: true },
    filter: { operandsByType: {} },
    pagination: true,
    selection: 'multiple',
    rowPinning: false,
    rowReordering: false,
    grouping: true,
    pivot: true,
    aggregation: { funcs: ['sum', 'avg', 'min', 'max', 'count'] },
  },
  state: emptyGridState(),
};

export const rows: Row[] = [
  { region: 'EMEA', product: 'A', amount: 10 },
  { region: 'AMER', product: 'B', amount: 30 },
  { region: 'APAC', product: 'C', amount: 20 },
];

export function makeApi(
  state?: Partial<GridState>
): GridApi<Row> & { readonly calls: readonly unknown[] } {
  return createFakeGridApi<Row>({ schema: enterpriseSchema, data: rows, state });
}

export function makeContext(
  api: GridApi<Row>,
  memory: Memory = new ConversationMemory()
): GridContext<Row> {
  return createContextBuilder<Row>().build(api, memory);
}
