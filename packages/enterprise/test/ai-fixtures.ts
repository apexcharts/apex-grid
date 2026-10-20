import { fixture, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration, GridSchema, GridState } from 'apex-grid';
import {
  ConversationMemory,
  createContextBuilder,
  createFakeGridApi,
  emptyGridState,
  type GridApi,
  type GridContext,
  type Memory,
} from '../src/features/ai/index.js';
import type { ApexGridEnterprise } from '../src/grid-enterprise.js';

export interface Row {
  region: string;
  product: string;
  amount: number;
}

/**
 * The operand lists core advertises per column type (`getFilterOperandsFor`), so
 * resolver tests see the same vocabulary a real grid's `getSchema()` reports.
 */
export const STRING_OPERANDS = [
  'contains',
  'doesNotContain',
  'startsWith',
  'endsWith',
  'equals',
  'doesNotEqual',
  'empty',
  'notEmpty',
];
export const NUMBER_OPERANDS = [
  'equals',
  'doesNotEqual',
  'greaterThan',
  'lessThan',
  'greaterThanOrEqual',
  'lessThanOrEqual',
  'empty',
  'notEmpty',
];

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
      filterOperands: STRING_OPERANDS,
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
      filterOperands: STRING_OPERANDS,
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
      filterOperands: NUMBER_OPERANDS,
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

// --- a real <apex-grid-enterprise> fixture -----------------------------------

export interface Person {
  avatar: string;
  name: string;
  department: string;
  country: string;
  status: string;
  active: boolean;
  hired: Date;
  salary: number;
  age: number;
  rating: number;
}

/**
 * Columns covering the types a real grid reports: string, boolean, date, number,
 * rating, and an empty header (an avatar column, as in demo/column-types.html).
 */
export const personColumns: ColumnConfiguration<Person>[] = [
  { key: 'avatar', headerText: '', type: 'avatar' },
  { key: 'name', headerText: 'Name', sort: true, filter: true },
  { key: 'department', headerText: 'Department', sort: true, filter: true },
  { key: 'country', headerText: 'Country', sort: true, filter: true },
  { key: 'status', headerText: 'Status', sort: true, filter: true },
  { key: 'active', headerText: 'Active', type: 'boolean', filter: true },
  { key: 'hired', headerText: 'Hire Date', type: 'date', sort: true, filter: true },
  { key: 'salary', headerText: 'Salary', type: 'number', sort: true, filter: true },
  { key: 'age', headerText: 'Age', type: 'number', sort: true, filter: true },
  { key: 'rating', headerText: 'Rating', type: 'rating', sort: true, filter: true },
];

const DEPARTMENTS = ['Sales', 'Ops', 'Eng'];

/**
 * 60 people, more than the 50-row context sample. Germany appears only from row 55,
 * so a scope value past the sample is exercised. Salaries are 1000 * (i + 1).
 */
export const personRows: Person[] = Array.from({ length: 60 }, (_, i) => ({
  avatar: `a${i}.png`,
  name: `N${i}`,
  department: DEPARTMENTS[i % 3],
  country: i >= 55 ? 'Germany' : 'USA',
  status: i % 2 === 0 ? 'Overdue' : 'Paid',
  active: i % 4 !== 0,
  hired: new Date(2020, 0, 1 + i),
  salary: 1000 * (i + 1),
  age: 20 + (i % 40),
  rating: (i % 5) + 1,
}));

/** Mount a real enterprise grid over {@link personRows}; import it lazily so other suites stay light. */
export async function mountPersonGrid(): Promise<ApexGridEnterprise<Person>> {
  const { ApexGridEnterprise, enterpriseModules } = await import('../src/index.js');
  ApexGridEnterprise.use(...enterpriseModules);
  ApexGridEnterprise.register();
  const grid = await fixture<ApexGridEnterprise<Person>>(html`<apex-grid-enterprise
    .data=${personRows}
    .columns=${personColumns}
  ></apex-grid-enterprise>`);
  await grid.updateComplete;
  await nextFrame();
  return grid;
}
