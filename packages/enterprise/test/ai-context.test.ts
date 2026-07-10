import { expect } from '@open-wc/testing';
import type { GridSchema } from 'apex-grid';
import {
  ConversationMemory,
  createContextBuilder,
  createFakeGridApi,
  DEFAULT_MAX_DATA_ROWS,
  emptyGridState,
} from '../src/features/ai/index.js';

interface Row {
  region: string;
  amount: number;
}

const schema: GridSchema = {
  version: 1,
  columns: [
    {
      key: 'region',
      label: 'Region',
      dataType: 'string',
      sortable: true,
      filterable: true,
      filterOperands: ['equals', 'contains'],
      editable: false,
      hidden: false,
    },
    {
      key: 'amount',
      label: 'Amount',
      dataType: 'number',
      sortable: true,
      filterable: true,
      filterOperands: ['equals', 'greaterThan'],
      editable: false,
      hidden: false,
    },
  ],
  capabilities: {
    sort: { directions: ['ascending', 'descending'], multi: true },
    filter: { operandsByType: {} },
    pagination: false,
    selection: 'multiple',
    rowPinning: false,
    rowReordering: false,
  },
  state: emptyGridState(),
};

const data: Row[] = [
  { region: 'EMEA', amount: 10 },
  { region: 'AMER', amount: 30 },
];

describe('AI reasoning layer — ContextBuilder', () => {
  it('assembles schema, state, columns, and a bounded data sample', () => {
    const api = createFakeGridApi<Row>({ schema, data });
    const ctx = createContextBuilder<Row>().build(api, new ConversationMemory());
    expect(ctx.columns.map((c) => c.key)).to.deep.equal(['region', 'amount']);
    expect(ctx.data.rowCount).to.equal(2);
    expect(ctx.data.truncated).to.be.false;
    expect(ctx.data.sample).to.have.length(2);
    expect(ctx.now).to.equal(0);
  });

  it('bounds the sample to maxDataRows and flags truncation', () => {
    const many: Row[] = Array.from({ length: DEFAULT_MAX_DATA_ROWS + 5 }, (_unused, i) => ({
      region: 'X',
      amount: i,
    }));
    const api = createFakeGridApi<Row>({ schema, data: many });
    const ctx = createContextBuilder<Row>().build(api, new ConversationMemory(), {
      maxDataRows: 10,
    });
    expect(ctx.data.sample).to.have.length(10);
    expect(ctx.data.rowCount).to.equal(DEFAULT_MAX_DATA_ROWS + 5);
    expect(ctx.data.truncated).to.be.true;
  });

  it('injects the provided clock rather than reading Date.now()', () => {
    const api = createFakeGridApi<Row>({ schema, data });
    const ctx = createContextBuilder<Row>().build(api, new ConversationMemory(), { now: 12345 });
    expect(ctx.now).to.equal(12345);
  });

  it('carries the memory snapshot into the context', () => {
    const memory = new ConversationMemory();
    memory.record({
      utterance: 'sort by amount',
      outcome: 'applied',
      entities: { columns: ['amount'] },
      at: 0,
    });
    const api = createFakeGridApi<Row>({ schema, data });
    const ctx = createContextBuilder<Row>().build(api, memory);
    expect(ctx.memory.lastEntities).to.deep.equal({ columns: ['amount'] });
  });

  it('reflects live state through the fake after applyState', () => {
    const api = createFakeGridApi<Row>({ schema, data });
    api.applyState({ sort: [{ key: 'amount', direction: 'descending' }] });
    const ctx = createContextBuilder<Row>().build(api, new ConversationMemory());
    expect(ctx.state.sort.map((s) => s.key)).to.deep.equal(['amount']);
  });
});
