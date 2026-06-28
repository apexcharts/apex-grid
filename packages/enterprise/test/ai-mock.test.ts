import { expect } from '@open-wc/testing';
import type { GridSchema, GridState } from 'apex-grid';
import type { AIRequest } from '../src/features/ai.js';
import { createMockAdapter } from '../src/features/ai-mock.js';

function makeState(): GridState {
  return {
    version: 1,
    columns: [],
    sort: [],
    filter: [],
    quickFilter: '',
    pagination: { page: 0, pageSize: 10 },
    selection: [],
    expansion: [],
    treeExpanded: [],
    treeExpandedKeys: [],
    modules: {},
  };
}

function makeSchema(): GridSchema {
  return {
    version: 1,
    columns: [
      {
        key: 'region',
        label: 'Region',
        dataType: 'string',
        sortable: true,
        filterable: true,
        filterOperands: ['contains', 'equals'],
        editable: false,
        hidden: false,
        groupable: true,
        pivotable: true,
        aggregatable: false,
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
        groupable: true,
        pivotable: true,
        aggregatable: true,
        aggFuncs: ['sum', 'avg'],
      },
    ],
    capabilities: {
      sort: { directions: ['ascending', 'descending'], multi: true },
      filter: { operandsByType: {} },
      pagination: false,
      selection: false,
      rowPinning: false,
      rowReordering: false,
      grouping: true,
      pivot: true,
      aggregation: { funcs: ['sum', 'avg', 'min', 'max', 'count'] },
    },
    state: makeState(),
  };
}

function req(overrides: Partial<AIRequest>): AIRequest {
  return { schema: makeSchema(), prompt: '', mode: 'control', ...overrides };
}

describe('AI Toolkit — mock adapter', () => {
  const mock = createMockAdapter();

  it('maps "sort by X descending" to a sort patch', async () => {
    const res = await mock(req({ prompt: 'sort by amount descending' }));
    expect(res.patch).to.deep.equal({ sort: [{ key: 'amount', direction: 'descending' }] });
  });

  it('maps "group by X" to an enterprise groupBy patch', async () => {
    const res = await mock(req({ prompt: 'group by region' }));
    expect(res.patch).to.deep.equal({ modules: { enterprise: { groupBy: ['region'] } } });
  });

  it('maps "filter X = Y" to a filter patch with a valid operand', async () => {
    const res = await mock(req({ prompt: 'filter region = EMEA' }));
    expect(res.patch?.filter?.[0]?.key).to.equal('region');
    expect(res.patch?.filter?.[0]?.operand).to.equal('equals');
    expect(res.patch?.filter?.[0]?.searchTerm).to.equal('EMEA');
  });

  it('coerces a numeric filter value', async () => {
    const res = await mock(req({ prompt: 'filter amount = 50' }));
    expect(res.patch?.filter?.[0]?.searchTerm).to.equal(50);
  });

  it('maps "search X" to a quick filter', async () => {
    const res = await mock(req({ prompt: 'search hub' }));
    expect(res.patch?.quickFilter).to.equal('hub');
  });

  it('unknown columns produce a no-op patch', async () => {
    const res = await mock(req({ prompt: 'sort by nonsense' }));
    expect(res.patch).to.deep.equal({});
  });

  it('ask mode answers data questions from the sample', async () => {
    const data = [
      { region: 'A', amount: 10 },
      { region: 'B', amount: 30 },
    ];
    expect(
      (await mock(req({ prompt: 'what is the highest amount?', mode: 'ask', data }))).answer
    ).to.include('30');
    expect(
      (await mock(req({ prompt: 'how many rows are there?', mode: 'ask', data }))).answer
    ).to.include('2');
  });

  it('ask mode summarizes the view when no data question matches', async () => {
    const res = await mock(req({ prompt: 'what is going on', mode: 'ask' }));
    expect(res.answer).to.include('Current view');
  });

  it('accepts custom rules ahead of the built-ins', async () => {
    const custom = createMockAdapter({
      rules: [{ test: /surprise/i, build: () => ({ patch: { quickFilter: 'boo' } }) }],
    });
    expect((await custom(req({ prompt: 'surprise me' }))).patch).to.deep.equal({
      quickFilter: 'boo',
    });
  });
});
