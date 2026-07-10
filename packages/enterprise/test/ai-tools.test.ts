import { expect } from '@open-wc/testing';
import type { GridSchema } from 'apex-grid';
import {
  ConversationMemory,
  createContextBuilder,
  createDefaultRegistry,
  createFakeGridApi,
  createToolExecutor,
  emptyGridState,
  type GridApi,
  type Plan,
  type ToolContext,
} from '../src/features/ai/index.js';

interface Row {
  region: string;
  amount: number;
}

/** A base grid with no enterprise capabilities (no grouping / pivot / aggregation). */
const baseSchema: GridSchema = {
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

/** A grid with grouping + aggregation capabilities and opted-in columns. */
const enterpriseSchema: GridSchema = {
  ...baseSchema,
  columns: [
    { ...baseSchema.columns[0], groupable: true },
    { ...baseSchema.columns[1], aggregatable: true, aggFuncs: ['sum', 'avg', 'max'] },
  ],
  capabilities: {
    ...baseSchema.capabilities,
    grouping: true,
    aggregation: { funcs: ['sum', 'avg', 'min', 'max', 'count'] },
  },
};

const data: Row[] = [
  { region: 'EMEA', amount: 10 },
  { region: 'AMER', amount: 30 },
  { region: 'APAC', amount: 20 },
];

function contextFor(api: GridApi<Row>): ToolContext<Row> {
  return { api, ctx: createContextBuilder<Row>().build(api, new ConversationMemory()) };
}

function controlPlan(steps: Plan['steps']): Plan {
  return { mode: 'control', steps, confidence: 1, source: 'test' };
}

describe('AI reasoning layer — Tool Registry', () => {
  it('lists common tools and gates enterprise tools by capability', () => {
    const registry = createDefaultRegistry();
    const baseCtx = createContextBuilder<Row>().build(
      createFakeGridApi<Row>({ schema: baseSchema, data }),
      new ConversationMemory()
    );
    const baseNames = registry.list(baseCtx).map((t) => t.name);
    expect(baseNames).to.include.members(['sort', 'filter', 'quickFilter', 'answer', 'reset']);
    expect(baseNames).to.not.include('group');
    expect(baseNames).to.not.include('aggregate');

    const entCtx = createContextBuilder<Row>().build(
      createFakeGridApi<Row>({ schema: enterpriseSchema, data }),
      new ConversationMemory()
    );
    const entNames = registry.list(entCtx).map((t) => t.name);
    expect(entNames).to.include.members(['group', 'ungroup', 'aggregate']);
  });

  it('emits tool definitions (name/description/input_schema) for the available tools', () => {
    const registry = createDefaultRegistry();
    const ctx = createContextBuilder<Row>().build(
      createFakeGridApi<Row>({ schema: baseSchema, data }),
      new ConversationMemory()
    );
    const defs = registry.toToolDefinitions(ctx);
    const sortDef = defs.find((d) => d.name === 'sort');
    expect(sortDef).to.exist;
    expect(sortDef?.description).to.be.a('string');
    expect(sortDef?.input_schema).to.have.property('type', 'object');
  });
});

describe('AI reasoning layer — Tool Executor', () => {
  it('runs a multi-step plan, aggregating applied slices', () => {
    const api = createFakeGridApi<Row>({ schema: baseSchema, data });
    const executor = createToolExecutor(createDefaultRegistry());
    const result = executor.run(
      controlPlan([
        { tool: 'sort', args: { by: [{ key: 'amount', direction: 'descending' }] } },
        { tool: 'quickFilter', args: { text: 'hub' } },
      ]),
      contextFor(api)
    );
    expect(result.applied).to.include.members(['sort', 'quickFilter']);
    expect(api.getState().sort.map((s) => s.key)).to.deep.equal(['amount']);
    expect(api.getState().quickFilter).to.equal('hub');
  });

  it('composes a LIFO undo that restores the original state', () => {
    const api = createFakeGridApi<Row>({ schema: baseSchema, data });
    const executor = createToolExecutor(createDefaultRegistry());
    const result = executor.run(
      controlPlan([
        { tool: 'sort', args: { by: [{ key: 'amount', direction: 'ascending' }] } },
        { tool: 'quickFilter', args: { text: 'hub' } },
      ]),
      contextFor(api)
    );
    result.undo();
    expect(api.getState().sort).to.be.empty;
    expect(api.getState().quickFilter).to.equal('');
  });

  it('undo is idempotent', () => {
    const api = createFakeGridApi<Row>({ schema: baseSchema, data });
    const executor = createToolExecutor(createDefaultRegistry());
    const result = executor.run(
      controlPlan([{ tool: 'sort', args: { by: [{ key: 'amount', direction: 'ascending' }] } }]),
      contextFor(api)
    );
    result.undo();
    api.applyState({ quickFilter: 'x' });
    result.undo(); // second call is a no-op: must not clobber the later change
    expect(api.getState().quickFilter).to.equal('x');
  });

  it('warns and skips unknown tools', () => {
    const api = createFakeGridApi<Row>({ schema: baseSchema, data });
    const executor = createToolExecutor(createDefaultRegistry());
    const result = executor.run(controlPlan([{ tool: 'teleport', args: {} }]), contextFor(api));
    expect(result.applied).to.be.empty;
    expect(result.warnings.some((w) => w.includes('unknown tool "teleport"'))).to.be.true;
  });

  it('warns and skips tools not available for the grid (grouping off)', () => {
    const api = createFakeGridApi<Row>({ schema: baseSchema, data });
    const executor = createToolExecutor(createDefaultRegistry());
    const result = executor.run(
      controlPlan([{ tool: 'group', args: { by: ['region'] } }]),
      contextFor(api)
    );
    expect(result.warnings.some((w) => w.includes('"group" is not available'))).to.be.true;
  });

  it('reports validation errors without executing', () => {
    const api = createFakeGridApi<Row>({ schema: baseSchema, data });
    const executor = createToolExecutor(createDefaultRegistry());
    const result = executor.run(
      controlPlan([{ tool: 'quickFilter', args: { text: 42 } }]),
      contextFor(api)
    );
    expect(result.applied).to.be.empty;
    expect(result.warnings.some((w) => w.includes('quickFilter'))).to.be.true;
  });
});

describe('AI reasoning layer — built-in tool behavior', () => {
  it('sort sanitizes unknown columns and reports the drop', () => {
    const api = createFakeGridApi<Row>({ schema: baseSchema, data });
    const executor = createToolExecutor(createDefaultRegistry());
    const result = executor.run(
      controlPlan([
        {
          tool: 'sort',
          args: {
            by: [
              { key: 'amount', direction: 'descending' },
              { key: 'ghost', direction: 'ascending' },
            ],
          },
        },
      ]),
      contextFor(api)
    );
    expect(api.getState().sort.map((s) => s.key)).to.deep.equal(['amount']);
    expect(result.warnings.some((w) => w.includes('unknown column "ghost"'))).to.be.true;
  });

  it('group applies when grouping is available', () => {
    const api = createFakeGridApi<Row>({ schema: enterpriseSchema, data });
    const executor = createToolExecutor(createDefaultRegistry());
    executor.run(controlPlan([{ tool: 'group', args: { by: ['region'] } }]), contextFor(api));
    const enterprise = api.getState().modules.enterprise as { groupBy?: string[] };
    expect(enterprise.groupBy).to.deep.equal(['region']);
  });

  it('reset clears sort, filter, quick filter, and grouping', () => {
    const api = createFakeGridApi<Row>({
      schema: enterpriseSchema,
      state: {
        sort: [{ key: 'amount', direction: 'descending' }],
        quickFilter: 'hub',
        modules: { enterprise: { groupBy: ['region'] } },
      },
      data,
    });
    const executor = createToolExecutor(createDefaultRegistry());
    executor.run(controlPlan([{ tool: 'reset', args: {} }]), contextFor(api));
    expect(api.getState().sort).to.be.empty;
    expect(api.getState().quickFilter).to.equal('');
    expect((api.getState().modules.enterprise as { groupBy?: string[] }).groupBy).to.be.empty;
  });

  it('answer computes count, max, and a view summary (read-only)', () => {
    const api = createFakeGridApi<Row>({ schema: baseSchema, data });
    const executor = createToolExecutor(createDefaultRegistry());

    const count = executor.run(
      controlPlan([{ tool: 'answer', args: { question: 'how many rows are there?' } }]),
      contextFor(api)
    );
    expect(count.answer).to.equal('There are 3 rows.');

    const max = executor.run(
      controlPlan([{ tool: 'answer', args: { question: 'what is the highest amount?' } }]),
      contextFor(api)
    );
    expect(max.answer).to.equal('The highest Amount is 30.');

    const summary = executor.run(
      controlPlan([{ tool: 'answer', args: { question: 'tell me about this view' } }]),
      contextFor(api)
    );
    expect(summary.answer).to.contain('Current view:');
    // Read-only: nothing was mutated.
    expect(api.calls).to.be.empty;
  });

  it('export delegates to the grid api export action', () => {
    const base = createFakeGridApi<Row>({ schema: baseSchema, data });
    const exported: string[] = [];
    const api = {
      ...base,
      export: (format: string) => {
        exported.push(format);
        return { applied: [`export: ${format}`], warnings: [] };
      },
    };
    const executor = createToolExecutor(createDefaultRegistry());
    const result = executor.run(
      controlPlan([{ tool: 'export', args: { format: 'csv' } }]),
      contextFor(api)
    );
    expect(exported).to.deep.equal(['csv']);
    expect(result.applied).to.include('export: csv');
  });
});
