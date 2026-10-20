import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration, GridState } from 'apex-grid';
import {
  ConversationMemory,
  createContextBuilder,
  createDefaultRegistry,
  createFakeGridApi,
  createToolExecutor,
  gridApiFor,
} from '../src/features/ai/index.js';
import { sanitizePatch } from '../src/features/ai-sanitize.js';
import { toJSONSchema } from '../src/features/ai-schema.js';
import { formulaModule } from '../src/features/formula/index.js';
import { ApexGridEnterprise, enterpriseModules } from '../src/index.js';
import { enterpriseSchema, rows as salesRows } from './ai-fixtures.js';

// The AI tools against a live <apex-grid-enterprise>: undo restores only what a
// turn changed, column and filter tools merge into the live view, export
// reaches the grid, and the read-only paths agree with the analytics engine.

interface Row {
  id: number;
  name: string;
  qty: number;
  price: number;
  total: number;
}

const rows = (): Row[] => [
  { id: 1, name: 'a', qty: 1, price: 5, total: 0 },
  { id: 2, name: 'b', qty: 3, price: 5, total: 0 },
  { id: 3, name: 'c', qty: 4, price: 9, total: 0 },
  { id: 4, name: 'd', qty: 1, price: 9, total: 0 },
];

const layout = (): ColumnConfiguration<Row>[] => [
  { key: 'id', headerText: 'Id', type: 'number' },
  { key: 'name', headerText: 'Name', width: '150px', filter: true },
  { key: 'qty', headerText: 'Qty', type: 'number', sort: true, filter: true },
  { key: 'price', headerText: 'Price', type: 'number', width: '120px', hidden: true, filter: true },
  { key: 'total', headerText: 'Total', type: 'number', pinned: 'end', allowFormula: true },
];

async function mount<R extends object = Row>(
  data: R[] = rows() as unknown as R[],
  columns: ColumnConfiguration<R>[] = layout() as unknown as ColumnConfiguration<R>[]
) {
  const grid = await fixture<ApexGridEnterprise<R>>(
    html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`
  );
  await grid.updateComplete;
  await nextFrame();
  return grid;
}

const keysOf = (grid: ApexGridEnterprise<Row>) => grid.columns.map((c) => String(c.key));

describe('AI tools on a live grid', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules, formulaModule);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  describe('undo baseline (ent-ai-builtins-1)', () => {
    it('keeps a formula entered after an AI sort when the sort is undone', async () => {
      const grid = await mount();
      const result = await grid.runPrompt('sort by qty descending');
      if (result.mode !== 'control') throw new Error('expected a control turn');
      grid.setFormula(grid.data[0], 'total', '=B1*C1');
      await grid.updateComplete;

      result.undo();
      await grid.updateComplete;
      expect(grid.getState().sort).to.be.empty;
      expect(grid.getFormula(grid.data[0], 'total')).to.equal('=B1*C1');
    });

    it('keeps a formula entered after an AI sort through the "undo" prompt', async () => {
      const grid = await mount();
      await grid.runPrompt('sort by qty descending');
      grid.setFormula(grid.data[1], 'total', '=B2*C2');
      await grid.updateComplete;

      await grid.runPrompt('undo');
      await grid.updateComplete;
      expect(grid.getState().sort).to.be.empty;
      expect(grid.getFormula(grid.data[1], 'total')).to.equal('=B2*C2');
    });

    it('the "undo" prompt leaves slices the turn did not change alone', async () => {
      const grid = await mount();
      await grid.runPrompt('filter qty > 2');
      grid.sort({ key: 'qty', direction: 'descending' });
      await grid.updateComplete;

      await grid.runPrompt('undo');
      await grid.updateComplete;
      expect(grid.getState().filter).to.be.empty;
      expect(grid.getState().sort.map((s) => s.key)).to.deep.equal(['qty']);
    });

    it('the "undo" prompt passes over an export and undoes the sort before it', async () => {
      const grid = await mount();
      (grid as unknown as { exportAs: () => void }).exportAs = () => undefined;
      await grid.runPrompt('sort by qty descending');
      await grid.runPrompt('export as csv');
      const undo = await grid.runPrompt('undo');
      await grid.updateComplete;
      expect(grid.getState().sort).to.be.empty;
      expect(undo.mode === 'control' && undo.applied).to.deep.equal(['undo']);
    });

    it('the "undo" prompt says there is nothing to undo after only an export', async () => {
      const grid = await mount();
      (grid as unknown as { exportAs: () => void }).exportAs = () => undefined;
      await grid.runPrompt('export as csv');
      const undo = await grid.runPrompt('undo');
      if (undo.mode !== 'control') throw new Error('expected a control turn');
      expect(undo.applied).to.deep.equal([]);
      expect(undo.warnings).to.include('Nothing to undo.');
    });

    it('undoing a pin keeps a column the user hid and resized since', async () => {
      const grid = await mount();
      const result = await grid.runPrompt('pin name to the left');
      await grid.runPrompt('pin total to the left');
      if (result.mode !== 'control') throw new Error('expected a control turn');
      const touchQty = () => {
        grid.columns = grid.columns.map((c) =>
          c.key === 'qty' ? { ...c, width: '90px', hidden: true } : c
        );
      };
      touchQty();
      await grid.updateComplete;

      result.undo();
      await grid.updateComplete;
      const byKey = (key: string) => grid.columns.find((c) => c.key === key);
      expect(byKey('name')?.pinned).to.be.undefined;
      expect(byKey('name')?.width).to.equal('150px');
      expect(byKey('total')?.pinned, 'a later AI pin stays').to.equal('start');
      expect(byKey('qty')?.hidden).to.equal(true);
      expect(byKey('qty')?.width).to.equal('90px');

      // The "undo" prompt takes back the latest turn the same way.
      await grid.runPrompt('undo');
      await grid.updateComplete;
      expect(byKey('total')?.pinned).to.equal('end');
      expect(byKey('qty')?.hidden).to.equal(true);
      expect(byKey('qty')?.width).to.equal('90px');
    });
  });

  describe('columns tool (ent-ai-builtins-2)', () => {
    it('"show price" keeps the column order and the configured width', async () => {
      const grid = await mount();
      await grid.runPrompt('show price');
      await grid.updateComplete;
      const price = grid.columns.find((c) => c.key === 'price');
      expect(price?.hidden).to.not.equal(true);
      expect(keysOf(grid)).to.deep.equal(['id', 'name', 'qty', 'price', 'total']);
      expect(price?.width).to.equal('120px');
      expect(grid.columns.find((c) => c.key === 'total')?.pinned).to.equal('end');
    });

    it('"hide the name column" keeps the order and the width', async () => {
      const grid = await mount();
      await grid.runPrompt('hide the name column');
      await grid.updateComplete;
      const name = grid.columns.find((c) => c.key === 'name');
      expect(name?.hidden).to.equal(true);
      expect(keysOf(grid)).to.deep.equal(['id', 'name', 'qty', 'price', 'total']);
      expect(name?.width).to.equal('150px');
    });

    it('"pin name to the left" keeps the width of name', async () => {
      const grid = await mount();
      const result = await grid.runPrompt('pin name to the left');
      await grid.updateComplete;
      const name = grid.columns.find((c) => c.key === 'name');
      expect(name?.pinned).to.equal('start');
      expect(name?.width).to.equal('150px');

      if (result.mode !== 'control') throw new Error('expected a control turn');
      result.undo();
      await grid.updateComplete;
      expect(grid.columns.find((c) => c.key === 'name')?.pinned).to.be.undefined;
      expect(keysOf(grid)).to.deep.equal(['id', 'name', 'qty', 'price', 'total']);
    });

    it('pinned null unpins, and a list naming every column reorders', async () => {
      const grid = await mount();
      const api = gridApiFor(grid);
      const registry = createDefaultRegistry();
      const ctx = createContextBuilder<Row>().build(api, new ConversationMemory());
      const tool = registry.get('columns');
      tool?.execute({ columns: [{ key: 'total', pinned: null }] }, { api, ctx });
      await grid.updateComplete;
      expect(grid.columns.find((c) => c.key === 'total')?.pinned).to.be.undefined;

      const order = ['total', 'price', 'qty', 'name', 'id'];
      tool?.execute({ columns: order.map((key) => ({ key })) }, { api, ctx });
      await grid.updateComplete;
      expect(keysOf(grid)).to.deep.equal(order);
      expect(grid.columns.find((c) => c.key === 'name')?.width).to.equal('150px');
    });

    it('applyState merges a partial columns list like the columns tool', async () => {
      const grid = await mount();
      const api = gridApiFor(grid);
      const ctx = createContextBuilder<Row>().build(api, new ConversationMemory());
      const exec = createToolExecutor(createDefaultRegistry()).run(
        {
          mode: 'control',
          steps: [
            { tool: 'applyState', args: { patch: { columns: [{ key: 'name', hidden: true }] } } },
          ],
          confidence: 1,
          source: 'llm',
        },
        { api, ctx }
      );
      await grid.updateComplete;
      expect(exec.applied).to.include('columns');
      expect(keysOf(grid)).to.deep.equal(['id', 'name', 'qty', 'price', 'total']);
      const byKey = (key: string) => grid.columns.find((c) => c.key === key);
      expect(byKey('name')?.hidden).to.equal(true);
      expect(byKey('name')?.width).to.equal('150px');
      expect(byKey('price')?.width).to.equal('120px');
      expect(byKey('total')?.pinned).to.equal('end');
    });

    const runApplyState = (grid: ApexGridEnterprise<Row>, patch: Partial<GridState>) => {
      const api = gridApiFor(grid);
      const ctx = createContextBuilder<Row>().build(api, new ConversationMemory());
      return createToolExecutor(createDefaultRegistry()).run(
        {
          mode: 'control',
          steps: [{ tool: 'applyState', args: { patch } }],
          confidence: 1,
          source: 'llm',
        },
        { api, ctx }
      );
    };

    it('applyState naming every column is the full layout, so a missing pin unpins', async () => {
      const grid = await mount();
      // A model copying getState() and dropping the pin of total.
      const columns = grid.getState().columns.map(({ pinned: _pinned, ...column }) => column);
      const exec = runApplyState(grid, { columns });
      await grid.updateComplete;
      expect(exec.applied).to.include('columns');
      expect(keysOf(grid)).to.deep.equal(['id', 'name', 'qty', 'price', 'total']);
      expect(grid.columns.find((c) => c.key === 'total')?.pinned).to.be.undefined;
      expect(grid.columns.find((c) => c.key === 'name')?.width).to.equal('150px');
    });

    it('the schema lets a model unpin with pinned null, and applyState applies it', async () => {
      const grid = await mount();
      const schema = toJSONSchema(grid.getSchema()) as {
        properties: {
          columns: {
            description: string;
            items: { properties: Record<string, { enum?: unknown[] }> };
          };
        };
      };
      expect(schema.properties.columns.items.properties.pinned.enum).to.include(null);
      expect(schema.properties.columns.description).to.contain('null');
      runApplyState(grid, { columns: [{ key: 'total', pinned: null }] } as Partial<GridState>);
      await grid.updateComplete;
      expect(grid.columns.find((c) => c.key === 'total')?.pinned).to.be.undefined;
      expect(keysOf(grid)).to.deep.equal(['id', 'name', 'qty', 'price', 'total']);
    });

    it('a columns step whose entries are all refused applies nothing', async () => {
      const grid = await mount();
      const api = gridApiFor(grid);
      const ctx = createContextBuilder<Row>().build(api, new ConversationMemory());
      const outcome = createDefaultRegistry()
        .get('columns')
        ?.execute({ columns: [{ key: 'nope', hidden: true }] }, { api, ctx });
      expect(outcome?.applied).to.deep.equal([]);
      expect(outcome?.skipped).to.deep.equal(['columns']);
      expect(outcome?.warnings?.join(' ')).to.contain('nope');
    });
  });

  describe('filter tool (ent-ai-builtins-3, ent-ai-builtins-10)', () => {
    it('"filter qty > 2 and filter price < 7" keeps both clauses', async () => {
      const grid = await mount();
      const result = await grid.runPrompt('filter qty > 2 and filter price < 7');
      await grid.updateComplete;
      if (result.mode !== 'control') throw new Error('expected a control turn');
      const keys = grid
        .getState()
        .filter.map((f) => f.key)
        .sort();
      expect(keys).to.deep.equal(['price', 'qty']);
      expect(grid.dataView.map((r) => r.id)).to.deep.equal([2]);
      expect(result.skipped, 'only slices present but not applied').to.deep.equal([]);
    });

    it('a new clause on a filtered column replaces it, and "clear all filters" clears', async () => {
      const grid = await mount();
      await grid.runPrompt('filter qty > 2');
      await grid.runPrompt('filter price < 7');
      await grid.runPrompt('filter qty < 2');
      await grid.updateComplete;
      const qty = grid.getState().filter.filter((f) => f.key === 'qty');
      expect(
        grid
          .getState()
          .filter.map((f) => f.key)
          .sort()
      ).to.deep.equal(['price', 'qty']);
      expect(qty.map((f) => f.operand)).to.deep.equal(['lessThan']);

      await grid.runPrompt('clear all filters');
      await grid.updateComplete;
      expect(grid.getState().filter).to.be.empty;
    });
  });

  describe('export (ent-ai-builtins-4, ent-ai-context-api-3)', () => {
    it('"export as csv" and "export to excel" call the grid export', async () => {
      const grid = await mount();
      const calls: string[] = [];
      (grid as unknown as { exportAs: (f: string) => void }).exportAs = (f) => calls.push(f);

      const csv = await grid.runPrompt('export as csv');
      expect(csv.mode === 'control' && csv.warnings).to.deep.equal([]);
      await grid.runPrompt('export to excel');
      expect(calls).to.deep.equal(['csv', 'xlsx']);
    });

    it('an unknown format is a warning naming the available ones', async () => {
      const grid = await mount();
      (grid as unknown as { exportAs: () => void }).exportAs = () => {
        throw new Error('must not export');
      };
      const result = gridApiFor(grid).export?.('pdf');
      expect(result?.applied).to.deep.equal([]);
      expect(result?.warnings[0]).to.contain('pdf').and.contain('csv').and.contain('xlsx');
    });
  });

  describe('paginate (ent-ai-builtins-5)', () => {
    it('"page size 50 and go to page 3" keeps the new page size', async () => {
      const data = Array.from({ length: 200 }, (_, i) => ({ ...rows()[0], id: i + 1 }));
      const grid = await mount(data);
      grid.pagination = { enabled: true, pageSize: 25 };
      await grid.updateComplete;
      await grid.runPrompt('page size 50 and go to page 3');
      await grid.updateComplete;
      expect(grid.getState().pagination).to.deep.equal({ page: 2, pageSize: 50 });
    });
  });

  describe('answer tool (ent-ai-builtins-7, sweep-drift-duplication-4)', () => {
    interface Person {
      name: string;
      age: number;
      salary: number | null;
      discount: number;
    }
    const people: Person[] = [
      { name: 'a', age: 30, salary: 50000, discount: 5 },
      { name: 'b', age: 50, salary: 60000, discount: 10 },
      { name: 'c', age: 40, salary: null, discount: 15 },
    ];
    const personColumns: ColumnConfiguration<Person>[] = [
      { key: 'name', headerText: 'Name' },
      { key: 'age', headerText: 'Age', type: 'number' },
      { key: 'salary', headerText: 'Salary', type: 'number' },
      { key: 'discount', headerText: 'Discount', type: 'number' },
    ];

    it('matches keywords and columns as whole words', async () => {
      const grid = await mount(people, personColumns);
      const avg = await grid.runPrompt('average salary', { mode: 'ask' });
      expect(avg.mode === 'ask' && avg.answer)
        .to.contain('Salary')
        .and.contain('55000');
      const top = await grid.runPrompt('highest discount?', { mode: 'ask' });
      expect(top.mode === 'ask' && top.answer).to.contain('15');
    });

    it('"top 0 by discount" still answers, like the analytics engine', async () => {
      const grid = await mount(people, personColumns);
      const top = await grid.runPrompt('top 0 by discount', { mode: 'ask' });
      expect(top.mode === 'ask' && top.answer).to.contain('15');
    });

    it('skips blank cells like the analytics engine does', async () => {
      const grid = await mount(people, personColumns);
      const low = await grid.runPrompt('lowest salary?');
      expect(low.mode === 'ask' && low.answer).to.contain('50000');
      const avg = await grid.runPrompt('average salary?');
      expect(avg.mode === 'ask' && avg.answer).to.contain('55000');
    });
  });

  describe('remote row models (ent-ai-context-api-6)', () => {
    it('getData drops loading placeholders under the infinite row model', async () => {
      const host = document.createElement('div');
      host.style.height = '400px';
      document.body.append(host);
      try {
        const all = Array.from({ length: 250 }, (_, i) => ({ ...rows()[0], id: i + 1 }));
        const grid = await fixture<ApexGridEnterprise<Row>>(
          html`<apex-grid-enterprise .columns=${layout()}></apex-grid-enterprise>`,
          { parentNode: host }
        );
        grid.infiniteRowModel = {
          blockSize: 50,
          datasource: {
            getRows: (p) =>
              Promise.resolve({ rows: all.slice(p.startRow, p.endRow), rowCount: all.length }),
          },
        };
        for (let i = 0; i < 5; i++) await nextFrame();
        await grid.updateComplete;
        const loading = grid.data.filter((row) => grid.isRowLoading(row)).length;
        expect(loading, 'placeholders present').to.be.greaterThan(0);
        expect(gridApiFor(grid).getData().length).to.equal(grid.data.length - loading);
      } finally {
        fixtureCleanup();
        host.remove();
      }
    });
  });
});

describe('AI tool contracts', () => {
  const build = (state?: Partial<GridState>) => {
    const api = createFakeGridApi({ schema: enterpriseSchema, state, data: salesRows });
    const ctx = createContextBuilder().build(api, new ConversationMemory());
    return { api, ctx };
  };

  it('analyze rejects a malformed query with a warning (ent-ai-builtins-9)', () => {
    const { api, ctx } = build();
    const exec = createToolExecutor(createDefaultRegistry()).run(
      {
        mode: 'ask',
        steps: [{ tool: 'analyze', args: { query: { metric: 'avg', column: 'amount' } } }],
        confidence: 1,
        source: 'rule',
      },
      { api, ctx }
    );
    expect(exec.answer).to.be.undefined;
    expect(exec.warnings.join(' ')).to.contain('analyze');
  });

  it('analyze refuses malformed where clauses and limits', () => {
    const { ctx } = build();
    const tool = createDefaultRegistry().get('analyze');
    const base = { kind: 'aggregate', metrics: ['avg'], column: 'amount' };
    expect(tool?.validate({ query: { ...base, where: [{}] } }, ctx).ok).to.equal(false);
    expect(tool?.validate({ query: { ...base, kind: 'rank', limit: 'x' } }, ctx).ok).to.equal(
      false
    );
    expect(tool?.validate({ query: { ...base, kind: 'rank', limit: -1 } }, ctx).ok).to.equal(false);
    expect(tool?.validate({ query: { ...base, kind: 'rank', limit: 1.5 } }, ctx).ok).to.equal(
      false
    );
    // The rule planner reads "top 0" as limit 0; analytics clamps it to 1.
    expect(tool?.validate({ query: { ...base, kind: 'rank', limit: 0 } }, ctx).ok).to.equal(true);
    const fine = {
      ...base,
      where: [{ key: 'region', operand: 'equals', value: 'East' }],
      limit: 2,
    };
    expect(tool?.validate({ query: fine }, ctx).ok).to.equal(true);
  });

  it('a throwing tool keeps the undo of the steps before it (ent-ai-context-api-5)', () => {
    const { api, ctx } = build();
    const registry = createDefaultRegistry();
    registry.register({
      name: 'boom',
      description: 'always throws',
      parameters: { type: 'object' },
      available: () => true,
      validate: (args) => ({ ok: true, value: args as Record<string, unknown> }),
      execute: () => {
        throw new Error('server down');
      },
    });
    const exec = createToolExecutor(registry).run(
      {
        mode: 'control',
        steps: [
          { tool: 'sort', args: { by: [{ key: 'amount', direction: 'descending' }] } },
          { tool: 'boom', args: {} },
        ],
        confidence: 1,
        source: 'rule',
      },
      { api, ctx }
    );
    expect(exec.applied).to.include('sort');
    expect(exec.warnings.join(' ')).to.contain('boom').and.contain('server down');
    expect(api.getState().sort.map((s) => s.key)).to.deep.equal(['amount']);
    exec.undo();
    expect(api.getState().sort).to.deep.equal([]);
  });

  it('pivotOn accepts several fields in the tool, sanitizer and schema (sweep-regression-3.5-5)', () => {
    const { api, ctx } = build();
    const tool = createDefaultRegistry().get('pivot');
    const validated = tool?.validate({ on: ['region'], rows: [] }, ctx);
    expect(validated?.ok).to.equal(true);
    if (!validated?.ok) return;
    tool?.execute(validated.value, { api, ctx });
    const blob = api.getState().modules.enterprise as { pivotOn?: unknown };
    expect(blob.pivotOn).to.deep.equal(['region']);

    const { patch, warnings } = sanitizePatch(
      { modules: { enterprise: { pivotOn: ['region', 'product'] } } },
      enterpriseSchema
    );
    expect((patch.modules?.enterprise as { pivotOn?: unknown }).pivotOn).to.deep.equal(['region']);
    expect(warnings.join(' ')).to.contain('product');

    const json = JSON.stringify(toJSONSchema(enterpriseSchema));
    expect(json).to.contain('"pivotOn":{"anyOf"');
  });
});
