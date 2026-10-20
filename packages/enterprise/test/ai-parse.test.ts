import { expect, fixtureCleanup } from '@open-wc/testing';
import type { ColumnSchema, DataType, GridSchema } from 'apex-grid';
import {
  createAIEngine,
  createFakeGridApi,
  createIntentDetector,
  createRuleBasedReasoner,
  emptyGridState,
  type Plan,
  type Reasoner,
} from '../src/features/ai/index.js';
import {
  enterpriseSchema,
  makeApi,
  makeContext,
  mountPersonGrid,
  NUMBER_OPERANDS,
  type Row,
  rows,
  STRING_OPERANDS,
} from './ai-fixtures.js';

// Parsing regressions in the deterministic AI rule engine: operators read inside
// column names, range phrasing, command words inside labels, word-bounded column
// mentions, empty headers, scope values past the context sample, and the one
// operator table behind keep / remove / filter.

type Rec = Record<string, unknown>;

function col(key: string, label: string, dataType: DataType = 'string'): ColumnSchema {
  const numeric = dataType === 'number' || dataType === 'currency' || dataType === 'rating';
  return {
    key,
    label,
    dataType,
    sortable: true,
    filterable: true,
    filterOperands:
      dataType === 'boolean'
        ? ['all', 'true', 'false', 'empty', 'notEmpty']
        : numeric
          ? NUMBER_OPERANDS
          : STRING_OPERANDS,
    editable: false,
    hidden: false,
    groupable: true,
    pivotable: true,
  };
}

function schemaOf(columns: ColumnSchema[]): GridSchema {
  return {
    version: 1,
    columns,
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
}

function engineOver(columns: ColumnSchema[], data: Rec[] = []) {
  const api = createFakeGridApi<Rec>({ schema: schemaOf(columns), data });
  return { api, engine: createAIEngine<Rec>(api) };
}

const tools = (plan: Plan) => plan.steps.map((s) => s.tool);
const whereOf = (plan: Plan) => (plan.steps[0]?.args as { where?: unknown[] } | undefined)?.where;
const answerOf = (result: Awaited<ReturnType<ReturnType<typeof createAIEngine>['runPrompt']>>) =>
  result.mode === 'ask' ? result.answer : '';

describe('AI parse: filter operators outside column names (ent-ai-engine-intent-1)', () => {
  const columns = [
    col('id', 'Id', 'number'),
    col('discount', 'Discount', 'number'),
    col('visits', 'Visits', 'number'),
    col('division', 'Division'),
  ];
  const data = [
    { id: 1, discount: 2, visits: 50, division: 'sales' },
    { id: 5, discount: 10, visits: 200, division: 'ops' },
  ];
  const filterOf = async (prompt: string) => {
    const { api, engine } = engineOver(columns, data);
    await engine.runPrompt(prompt);
    return api.getState().filter;
  };

  it('"where discount > 5" filters discount greaterThan 5', async () => {
    expect((await filterOf('where discount > 5'))[0]).to.include({
      key: 'discount',
      operand: 'greaterThan',
      searchTerm: 5,
    });
  });

  it('"where visits > 100" filters visits greaterThan 100', async () => {
    expect((await filterOf('where visits > 100'))[0]).to.include({
      key: 'visits',
      operand: 'greaterThan',
      searchTerm: 100,
    });
  });

  it('"where division is sales" filters division equals sales', async () => {
    expect((await filterOf('where division is sales'))[0]).to.include({
      key: 'division',
      operand: 'equals',
      searchTerm: 'sales',
    });
  });

  it('"where id == 5" reads == as one operator', async () => {
    expect((await filterOf('where id == 5'))[0]).to.include({
      key: 'id',
      operand: 'equals',
      searchTerm: 5,
    });
  });

  it('a filler word after "filter" stays out of the value', async () => {
    const words = [col('status', 'Status'), col('onhold', 'On Hold'), col('age', 'Age', 'number')];
    const cases: [string, unknown[]][] = [
      ['filter where status is overdue', ['status', 'equals', 'overdue']],
      ['filter on status equals Paid', ['status', 'equals', 'Paid']],
      ['filter for status Paid', ['status', 'equals', 'Paid']],
      ['filter by status Paid', ['status', 'equals', 'Paid']],
      ['filter where the status is Paid', ['status', 'equals', 'Paid']],
      ['filter with age over 30', ['age', 'greaterThan', 30]],
      ['filter where age > 30', ['age', 'greaterThan', 30]],
      // A column whose name starts with a filler word keeps it.
      ['filter on hold is yes', ['onhold', 'equals', 'yes']],
      // A bare value after a filler word, and a value that starts with one.
      ['filter for Paid', ['status', 'equals', 'Paid']],
      ['filter on time', ['status', 'equals', 'On time']],
    ];
    const data = [
      { status: 'Paid', onhold: 'no', age: 20 },
      { status: 'On time', onhold: 'yes', age: 40 },
    ];
    for (const [prompt, expected] of cases) {
      const { api, engine } = engineOver(words, data);
      await engine.runPrompt(prompt);
      expect(
        api.getState().filter.map((f) => [f.key, f.operand, f.searchTerm]),
        prompt
      ).to.deep.equal([expected]);
    }
  });

  it('"filter where age > 30" filters a number on a real grid', async () => {
    const grid = await mountPersonGrid();
    await grid.runPrompt('filter where age > 30');
    expect(grid.getState().filter.map((f) => [f.key, f.operand, f.searchTerm])).to.deep.equal([
      ['age', 'greaterThan', 30],
    ]);
    fixtureCleanup();
  });

  it('the detector emits one predicate slot for filter / where', () => {
    const intent = createIntentDetector().detect('filter region = EMEA', makeContext(makeApi()));
    expect(intent.kind).to.equal('filter');
    expect(intent.slots.predicate?.text).to.equal('region = EMEA');
  });
});

describe('AI parse: the leftmost command verb wins (ent-ai-engine-intent-2)', () => {
  const columns = [
    col('orderStatus', 'Order Status'),
    col('groupName', 'Group Name'),
    col('exportDate', 'Export Date'),
    col('amount', 'Amount', 'number'),
  ];
  const data = [{ orderStatus: 'shipped', groupName: 'A', exportDate: '2026-01-01', amount: 1 }];
  const preview = (prompt: string) => engineOver(columns, data).engine.previewPrompt(prompt);

  it('"where order status is shipped" filters, it does not sort', async () => {
    const plan = await preview('where order status is shipped');
    expect(tools(plan)).to.deep.equal(['filter']);
    expect(whereOf(plan)).to.deep.equal([
      { key: 'orderStatus', operand: 'equals', searchTerm: 'shipped' },
    ]);
  });

  it('"hide group name" hides the column, it does not group', async () => {
    expect(tools(await preview('hide group name'))).to.deep.equal(['columns']);
  });

  it('"hide the export date column" hides the column, it does not export', async () => {
    expect(tools(await preview('hide the export date column'))).to.deep.equal(['columns']);
  });
});

describe('AI parse: sort direction from range phrasing (ent-ai-engine-intent-3)', () => {
  const sortOf = async (prompt: string, api = makeApi()) => {
    await createAIEngine<Row>(api).runPrompt(prompt);
    return api.getState().sort;
  };
  const cases: Array<[string, 'ascending' | 'descending']> = [
    ['sort by amount high to low', 'descending'],
    ['sort by amount from highest to lowest', 'descending'],
    ['sort by amount low to high', 'ascending'],
    ['sort by amount from low to high', 'ascending'],
    ['sort by amount largest to smallest', 'descending'],
    ['sort by region z to a', 'descending'],
    ['sort by region a to z', 'ascending'],
    ['sort by amount, highest first', 'descending'],
    ['sort by amount descending', 'descending'],
  ];
  for (const [prompt, direction] of cases) {
    it(`"${prompt}" sorts ${direction}`, async () => {
      const sort = await sortOf(prompt);
      expect(sort).to.have.lengthOf(1);
      expect(sort[0].direction, prompt).to.equal(direction);
    });
  }

  it('"newest first" sorts a date descending, "oldest first" ascending', async () => {
    const columns = [col('name', 'Name'), col('hireDate', 'Hire Date', 'date')];
    for (const [prompt, direction] of [
      ['sort by hire date, newest first', 'descending'],
      ['sort by hire date oldest first', 'ascending'],
    ] as const) {
      const { api, engine } = engineOver(columns);
      await engine.runPrompt(prompt);
      expect(api.getState().sort, prompt).to.deep.equal([{ key: 'hireDate', direction }]);
    }
  });

  it('keeps an unresolved part of a multi-column sort as a note', async () => {
    const plan = await createAIEngine<Row>(makeApi()).previewPrompt('sort by amount and zzz');
    expect(tools(plan)).to.deep.equal(['sort']);
    expect(plan.notes?.join(' ')).to.contain('zzz');
  });
});

describe('AI parse: reset and undo as whole commands (ent-ai-engine-intent-7)', () => {
  const detector = createIntentDetector();
  const kind = (u: string) => detector.detect(u, makeContext(makeApi())).kind;

  it('"clear all filters" does not reset the whole view', () => {
    expect(kind('clear all filters')).to.not.equal('reset');
  });

  it('polite and object forms still reset or undo', () => {
    for (const u of ['start over please', 'please reset', 'can you reset the grid']) {
      expect(kind(u), u).to.equal('reset');
    }
    for (const u of [
      'undo please',
      'can you undo that',
      'undo that change',
      'undo the last sort',
      'undo the sort',
    ]) {
      expect(kind(u), u).to.equal('undo');
    }
  });

  it('clearing the filters or the sort leaves the rest of the view', async () => {
    const api = makeApi();
    const engine = createAIEngine<Row>(api);
    await engine.runPrompt('sort by amount descending');
    await engine.runPrompt('filter region = EMEA');
    await engine.runPrompt('search for widget');
    await engine.runPrompt('clear all filters');
    expect(api.getState().filter).to.be.empty;
    expect(api.getState().quickFilter).to.equal('');
    expect(api.getState().sort.map((s) => s.key)).to.deep.equal(['amount']);
    await engine.runPrompt('filter region = EMEA');
    await engine.runPrompt('search for widget');
    await engine.runPrompt('reset sort');
    expect(api.getState().sort).to.be.empty;
    expect(api.getState().filter).to.have.lengthOf(1);
    expect(api.getState().quickFilter).to.equal('widget');
    await engine.runPrompt('reset the filters');
    expect(api.getState().filter).to.be.empty;
    expect(api.getState().quickFilter).to.equal('');
  });

  it('"clear all filters" also clears a quick filter on a real grid', async () => {
    const grid = await mountPersonGrid();
    await grid.runPrompt('where age > 30');
    await grid.runPrompt('search for N1');
    expect(grid.getState().quickFilter).to.equal('N1');
    await grid.runPrompt('clear all filters');
    expect(grid.getState().filter).to.be.empty;
    expect(grid.getState().quickFilter).to.equal('');
    fixtureCleanup();
  });

  it('"go back to page 1" paginates instead of undoing', () => {
    expect(kind('go back to page 1')).to.equal('paginate');
  });

  it('"search for undo" quick-filters instead of undoing', () => {
    expect(kind('search for undo')).to.equal('quick-filter');
  });

  it('bare reset / undo forms still match', () => {
    for (const u of ['reset', 'reset everything', 'clear all', 'start over', 'Reset the view.']) {
      expect(kind(u), u).to.equal('reset');
    }
    for (const u of ['undo', 'undo that', 'revert', 'go back', 'undo the last change']) {
      expect(kind(u), u).to.equal('undo');
    }
  });
});

describe('AI parse: column spans with punctuation and accents (ent-ai-engine-intent-8)', () => {
  const columns = [
    col('email', 'E-mail'),
    col('categoria', 'Categoría'),
    col('owner', "Owner's Name"),
    col('growth', 'Growth %', 'number'),
  ];
  const data = [{ email: 'a@gmail.com', categoria: 'x', owner: 'Ann', growth: 3 }];
  const preview = (prompt: string) => engineOver(columns, data).engine.previewPrompt(prompt);

  it('sort, group, pin, filter and hide accept such names', async () => {
    expect((await preview('sort by e-mail')).steps).to.deep.equal([
      { tool: 'sort', args: { by: [{ key: 'email', direction: 'ascending' }] } },
    ]);
    expect((await preview('group by categoría')).steps).to.deep.equal([
      { tool: 'group', args: { by: ['categoria'] } },
    ]);
    expect((await preview('pin e-mail to the left')).steps).to.deep.equal([
      { tool: 'columns', args: { columns: [{ key: 'email', pinned: 'start' }] } },
    ]);
    expect(whereOf(await preview('where e-mail contains gmail'))).to.deep.equal([
      { key: 'email', operand: 'contains', searchTerm: 'gmail' },
    ]);
    expect((await preview("hide owner's name")).steps).to.deep.equal([
      { tool: 'columns', args: { columns: [{ key: 'owner', hidden: true }] } },
    ]);
    expect(whereOf(await preview('where growth % > 2'))).to.deep.equal([
      { key: 'growth', operand: 'greaterThan', searchTerm: 2 },
    ]);
  });
});

describe('AI parse: highest-score routing uses the grounded confidence (ent-ai-engine-intent-9)', () => {
  function fakeLLM(score = 0.6) {
    const calls: string[] = [];
    const llm: Reasoner = {
      name: 'llm:test',
      score: () => score,
      reason: (utterance) => {
        calls.push(utterance);
        return Promise.resolve({
          mode: 'control',
          steps: [{ tool: 'sort', args: { by: [{ key: 'region', direction: 'ascending' }] } }],
          confidence: 0.9,
          source: 'llm:test',
        });
      },
    };
    return { llm, calls };
  }

  it('the rule score equals the confidence of the plan it would return', async () => {
    const rule = createRuleBasedReasoner();
    const ctx = makeContext(makeApi());
    for (const u of ['sort by revenue', 'sort by amount', 'what is going on?']) {
      expect(rule.score(u, ctx), u).to.equal((await rule.reason(u, ctx)).confidence);
    }
  });

  it('highest-score sends an ungrounded rule prompt to the LLM', async () => {
    const { llm, calls } = fakeLLM();
    const plan = await createAIEngine<Row>(makeApi(), {
      reasoners: [createRuleBasedReasoner(), llm],
      policy: 'highest-score',
    }).previewPrompt('sort by revenue');
    expect(calls).to.deep.equal(['sort by revenue']);
    expect(plan.source).to.equal('llm:test');
  });

  it('highest-score keeps a confident rule plan', async () => {
    const { llm, calls } = fakeLLM();
    const plan = await createAIEngine<Row>(makeApi(), {
      reasoners: [createRuleBasedReasoner(), llm],
      policy: 'highest-score',
    }).previewPrompt('sort by amount');
    expect(calls).to.be.empty;
    expect(plan.source).to.equal('rule');
  });

  it('llm-first uses a confident LLM plan, and llm-only never runs the rule plan', async () => {
    for (const policy of ['llm-first', 'llm-only'] as const) {
      const { llm, calls } = fakeLLM();
      const plan = await createAIEngine<Row>(makeApi(), {
        reasoners: [createRuleBasedReasoner(), llm],
        policy,
      }).previewPrompt('sort by amount');
      expect(calls, policy).to.have.lengthOf(1);
      expect(plan.source, policy).to.equal('llm:test');
    }
  });

  it('llm-first falls back to the rule plan when the LLM is not confident', async () => {
    const llm: Reasoner = {
      name: 'llm:test',
      score: () => 0.6,
      reason: () =>
        Promise.resolve({ mode: 'control', steps: [], confidence: 0.1, source: 'llm:test' }),
    };
    const plan = await createAIEngine<Row>(makeApi(), {
      reasoners: [createRuleBasedReasoner(), llm],
      policy: 'llm-first',
    }).previewPrompt('sort by amount');
    expect(plan.source).to.equal('rule');
    expect(tools(plan)).to.deep.equal(['sort']);
  });
});

describe('AI parse: anaphora after analyze and applyState turns (ent-ai-engine-intent-10)', () => {
  it('"it" refers to the measure of the previous analyze answer', async () => {
    const api = makeApi();
    const engine = createAIEngine<Row>(api);
    await engine.runPrompt('sort by region');
    await engine.runPrompt('what is the median amount');
    await engine.runPrompt('sort by it descending');
    expect(api.getState().sort).to.deep.equal([{ key: 'amount', direction: 'descending' }]);
  });

  it('"it" refers to the columns an applyState patch touched', async () => {
    const api = makeApi();
    const llm: Reasoner = {
      name: 'llm:test',
      score: () => 0.6,
      reason: () =>
        Promise.resolve({
          mode: 'control',
          steps: [
            {
              tool: 'applyState',
              args: { patch: { sort: [{ key: 'product', direction: 'ascending' }] } },
            },
          ],
          confidence: 0.9,
          source: 'llm:test',
        }),
    };
    const engine = createAIEngine<Row>(api, { reasoners: [createRuleBasedReasoner(), llm] });
    await engine.runPrompt('sort by region');
    await engine.runPrompt('make it look nice');
    await engine.runPrompt('sort by it descending');
    expect(api.getState().sort).to.deep.equal([{ key: 'product', direction: 'descending' }]);
  });
});

describe('AI parse: word-bounded column mentions (ent-ai-entities-1)', () => {
  const columns = [
    col('name', 'Name'),
    col('age', 'Age', 'number'),
    col('salary', 'Salary', 'number'),
  ];
  const data = [
    { name: 'Ann', age: 30, salary: 100 },
    { name: 'Bob', age: 49, salary: 200 },
  ];

  it('"what is the average salary" measures salary, not the age inside "average"', async () => {
    const { engine } = engineOver(columns, data);
    expect(answerOf(await engine.runPrompt('what is the average salary'))).to.equal(
      'The average Salary is 150.'
    );
  });

  it('"sort by date paid" does not resolve to the id inside "paid"', async () => {
    const { engine } = engineOver([
      col('id', 'Id', 'number'),
      col('paidDate', 'Paid Date', 'date'),
    ]);
    const plan = await engine.previewPrompt('sort by date paid');
    expect(plan.steps).to.deep.equal([
      { tool: 'sort', args: { by: [{ key: 'paidDate', direction: 'ascending' }] } },
    ]);
  });
});

describe('AI parse: an empty header never matches (ent-ai-entities-2)', () => {
  const emptyHeader: ColumnSchema = { ...col('actions', ''), sortable: false, filterable: false };
  const schema: GridSchema = {
    ...enterpriseSchema,
    columns: [emptyHeader, ...enterpriseSchema.columns],
  };
  const run = async (prompt: string) => {
    const api = createFakeGridApi<Row>({ schema, data: rows });
    await createAIEngine<Row>(api).runPrompt(prompt);
    return api.getState();
  };

  it('a typo still fuzzy-resolves to the intended column', async () => {
    expect((await run('sort by amont descending')).sort.map((s) => s.key)).to.deep.equal([
      'amount',
    ]);
  });

  it('a keep predicate binds to the named column', async () => {
    expect((await run('keep rows where amount > 15')).filter.map((f) => f.key)).to.deep.equal([
      'amount',
    ]);
  });

  it('a short unknown name does not fuzzy-match the empty header', async () => {
    const plan = await createAIEngine<Row>(
      createFakeGridApi<Row>({ schema, data: rows })
    ).previewPrompt('sort by zz');
    expect(plan.steps).to.be.empty;
  });
});

describe('AI parse: categorical scope over all rows (ent-ai-entities-3)', () => {
  const data: Row[] = [
    ...Array.from({ length: 60 }, (_, i) => ({ region: 'AMER', product: `P${i}`, amount: 1 })),
    ...Array.from({ length: 10 }, (_, i) => ({ region: 'EMEA', product: `Q${i}`, amount: 100 })),
  ];
  const ask = async (prompt: string) =>
    answerOf(
      await createAIEngine<Row>(
        createFakeGridApi<Row>({ schema: enterpriseSchema, data })
      ).runPrompt(prompt)
    );

  it('a scope value inside the sample applies', async () => {
    expect(await ask('what is the total amount in AMER')).to.equal(
      'The total Amount is 60 (Region = AMER).'
    );
  });

  it('a scope value first seen after row 50 applies', async () => {
    expect(await ask('what is the total amount in EMEA')).to.equal(
      'The total Amount is 1000 (Region = EMEA).'
    );
  });

  it('a bare value past the sample still identifies its column', async () => {
    const api = createFakeGridApi<Row>({ schema: enterpriseSchema, data });
    const plan = await createAIEngine<Row>(api).previewPrompt('keep only Q7');
    expect(whereOf(plan)).to.deep.equal([{ key: 'product', operand: 'equals', searchTerm: 'Q7' }]);
  });

  it('the rows reference stays out of a serialized context', () => {
    const ctx = makeContext(createFakeGridApi<Row>({ schema: enterpriseSchema, data }));
    expect(ctx.data.rows).to.have.lengthOf(70);
    expect(JSON.parse(JSON.stringify(ctx.data))).to.not.have.property('rows');
  });
});

describe('AI parse: one operator table (ent-ai-entities-4, -5, -8)', () => {
  const reasoner = createRuleBasedReasoner();
  const where = async (u: string) => whereOf(await reasoner.reason(u, makeContext(makeApi())));

  const keep: Array<[string, string, unknown, string]> = [
    ["keep rows where region isn't EMEA", 'region', 'EMEA', 'doesNotEqual'],
    ['keep rows where region does not equal EMEA', 'region', 'EMEA', 'doesNotEqual'],
    ['keep rows where region is not EMEA', 'region', 'EMEA', 'doesNotEqual'],
    ['keep rows with amount fewer than 15', 'amount', 15, 'lessThan'],
    ['keep rows where amount <> 15', 'amount', 15, 'doesNotEqual'],
    ['keep rows where amount != 15', 'amount', 15, 'doesNotEqual'],
    ['keep rows where amount is at least 15', 'amount', 15, 'greaterThanOrEqual'],
    ['keep rows where product starts with A', 'product', 'A', 'startsWith'],
    ['keep rows where product ends with A', 'product', 'A', 'endsWith'],
    ["keep rows where product doesn't contain A", 'product', 'A', 'doesNotContain'],
  ];
  for (const [u, key, searchTerm, operand] of keep) {
    it(`${u} -> ${operand}`, async () => {
      expect(await where(u)).to.deep.equal([{ key, operand, searchTerm }]);
    });
  }

  const remove: Array<[string, string, unknown, string]> = [
    ['remove rows where product contains A', 'product', 'A', 'doesNotContain'],
    ['remove rows where amount <> 15', 'amount', 15, 'equals'],
    ['remove rows where amount != 15', 'amount', 15, 'equals'],
    ['remove rows where amount > 15', 'amount', 15, 'lessThanOrEqual'],
    ['remove rows where region is EMEA', 'region', 'EMEA', 'doesNotEqual'],
  ];
  for (const [u, key, searchTerm, operand] of remove) {
    it(`${u} -> ${operand}`, async () => {
      expect(await where(u)).to.deep.equal([{ key, operand, searchTerm }]);
    });
  }

  it('removal by starts with / ends with abstains instead of a different predicate', async () => {
    for (const u of [
      'remove rows where product starts with A',
      'remove rows where product ends with A',
    ]) {
      const plan = await reasoner.reason(u, makeContext(makeApi()));
      expect(plan.steps, u).to.be.empty;
      expect(plan.notes?.[0], u).to.contain("can't");
    }
  });

  it('word operators match only as whole words (ent-ai-entities-8)', async () => {
    const columns = [col('status', 'Status'), col('city', 'City')];
    const data = [
      { status: 'Overdue', city: 'Hanover' },
      { status: 'Paid', city: 'Bonn' },
    ];
    const preview = (u: string) => engineOver(columns, data).engine.previewPrompt(u);
    expect(whereOf(await preview('keep rows where status is Overdue'))).to.deep.equal([
      { key: 'status', operand: 'equals', searchTerm: 'Overdue' },
    ]);
    expect(whereOf(await preview('keep rows where city is Hanover'))).to.deep.equal([
      { key: 'city', operand: 'equals', searchTerm: 'Hanover' },
    ]);
    expect(whereOf(await preview('remove rows where status is Overdue'))).to.deep.equal([
      { key: 'status', operand: 'doesNotEqual', searchTerm: 'Overdue' },
    ]);
  });
});

describe('AI parse: scope phrases are not metrics (ent-ai-entities-6)', () => {
  const columns = [col('department', 'Department'), col('salary', 'Salary', 'number')];
  const data = [
    { department: 'Sales', salary: 40000 },
    { department: 'Sales', salary: 60000 },
    { department: 'Ops', salary: 80000 },
    { department: 'Eng', salary: 120000 },
  ];
  const ask = async (prompt: string) =>
    answerOf(await engineOver(columns, data).engine.runPrompt(prompt));

  it('a grouped question scoped by "at least" reports every group', async () => {
    const answer = await ask('average salary by department where salary is at least 50000');
    expect(answer).to.contain('Sales 60000');
    expect(answer).to.contain('Ops 80000');
    expect(answer).to.contain('Eng 120000');
  });

  it('"at least" in a count question adds no minimum', async () => {
    const answer = await ask('how many rows have salary at least 50000');
    expect(answer).to.not.match(/minimum/i);
    expect(answer).to.contain('3');
  });

  it('"most common" is the mode, not a maximum', async () => {
    const answer = await ask('what is the most common department');
    expect(answer).to.not.match(/maximum/i);
    expect(answer).to.contain('Sales');
  });
});

describe('AI parse: numeric scope binds to the column named next to it (ent-ai-entities-7)', () => {
  const columns = [
    col('name', 'Name'),
    col('department', 'Department'),
    col('age', 'Age', 'number'),
    col('salary', 'Salary', 'number'),
  ];
  const data = [
    { name: 'Ann', department: 'Sales', age: 25, salary: 90000 },
    { name: 'Bob', department: 'Sales', age: 40, salary: 60000 },
    { name: 'Cy', department: 'Ops', age: 35, salary: 30000 },
  ];
  const plan = (u: string) => engineOver(columns, data).engine.previewPrompt(u);
  const queryOf = (p: Plan) => (p.steps[0]?.args as { query: { where?: unknown[] } }).query;

  it('"... among people with age over 30" scopes by age', async () => {
    const p = await plan('who has the highest salary among people with age over 30');
    expect(queryOf(p).where).to.deep.equal([{ key: 'age', operand: 'greaterThan', value: 30 }]);
  });

  it('"mean age by department where salary over 50000" scopes by salary', async () => {
    const p = await plan('mean age by department where salary over 50000');
    expect(queryOf(p).where).to.deep.equal([
      { key: 'salary', operand: 'greaterThan', value: 50000 },
    ]);
  });
});

describe('AI parse: boolean values and no operand fallback (ent-ai-entities-9)', () => {
  const columns = [col('name', 'Name'), col('active', 'Active', 'boolean')];
  const data = [
    { name: 'Ann', active: true },
    { name: 'Bob', active: false },
  ];
  const preview = (u: string) => engineOver(columns, data).engine.previewPrompt(u);

  it('"filter active is false" applies the false operand', async () => {
    expect(whereOf(await preview('filter active is false'))?.[0]).to.include({
      key: 'active',
      operand: 'false',
    });
    expect(whereOf(await preview('keep rows where active is yes'))?.[0]).to.include({
      key: 'active',
      operand: 'true',
    });
    expect(whereOf(await preview('remove rows where active is true'))?.[0]).to.include({
      key: 'active',
      operand: 'false',
    });
  });

  it('an operator the column cannot express abstains instead of a different one', async () => {
    const plan = await preview('filter name greater than M');
    expect(plan.steps).to.be.empty;
    expect(plan.notes?.[0]).to.contain("can't");
  });
});

describe('AI parse: multi-word names resolve once (ent-ai-entities-10)', () => {
  const columns = [col('department', 'Department'), col('pnl', 'Profit and Loss', 'number')];

  it('"group by department and profit and loss" groups by two columns', async () => {
    const plan = await engineOver(columns).engine.previewPrompt(
      'group by department and profit and loss'
    );
    expect(plan.steps).to.deep.equal([{ tool: 'group', args: { by: ['department', 'pnl'] } }]);
  });

  it('"sort by profit and loss" sorts once', async () => {
    const plan = await engineOver(columns).engine.previewPrompt('sort by profit and loss');
    expect(plan.steps).to.deep.equal([
      { tool: 'sort', args: { by: [{ key: 'pnl', direction: 'ascending' }] } },
    ]);
  });
});

describe('AI parse: rating and progress are numeric (sweep-drift-duplication-3)', () => {
  const columns = [
    col('name', 'Name'),
    col('department', 'Department'),
    col('rating', 'Rating', 'rating'),
  ];
  const data = [
    { name: 'Ann', department: 'Eng', rating: 5 },
    { name: 'Bob', department: 'Ops', rating: 3 },
    { name: 'Cy', department: 'Eng', rating: 4 },
  ];
  const ask = async (prompt: string) =>
    answerOf(await engineOver(columns, data).engine.runPrompt(prompt));

  it('ranks and aggregates a rating column', async () => {
    expect(await ask('top 2 by rating')).to.contain('Ann');
    expect(await ask('who has the highest rating')).to.contain('Ann');
    const avg = await ask('average rating by department');
    expect(avg).to.contain('Average Rating by Department');
    expect(avg).to.contain('Eng 4.5');
  });
});

describe('AI parse: a real <apex-grid-enterprise> schema (ent-ai-entities-11)', () => {
  afterEach(() => fixtureCleanup());

  it('reports the column types the resolver sees', async () => {
    const grid = await mountPersonGrid();
    const schema = grid.getSchema();
    const byKey = Object.fromEntries(schema.columns.map((c) => [c.key, c]));
    expect(byKey.avatar.label).to.equal('');
    expect(byKey.active.filterOperands).to.include('false');
    expect(byKey.name.filterOperands).to.include('doesNotContain');
    expect(grid.data.length).to.be.greaterThan(50);
  });

  it('negation, removal, booleans and the empty header through runPrompt', async () => {
    const grid = await mountPersonGrid();
    await grid.runPrompt("keep rows where department isn't Sales");
    expect(grid.getState().filter.map((f) => [f.key, f.operand, f.searchTerm])).to.deep.equal([
      ['department', 'doesNotEqual', 'Sales'],
    ]);

    await grid.runPrompt('reset');
    await grid.runPrompt('remove rows where name contains N1');
    expect(grid.getState().filter.map((f) => [f.key, f.operand])).to.deep.equal([
      ['name', 'doesNotContain'],
    ]);

    await grid.runPrompt('reset');
    await grid.runPrompt('filter active is false');
    expect(grid.getState().filter.map((f) => [f.key, f.operand])).to.deep.equal([
      ['active', 'false'],
    ]);

    await grid.runPrompt('reset');
    await grid.runPrompt('sort by salry descending');
    expect(grid.getState().sort.map((s) => [s.key, s.direction])).to.deep.equal([
      ['salary', 'descending'],
    ]);
  });

  it('scope past the sample and word-bounded mentions through runPrompt', async () => {
    const grid = await mountPersonGrid();
    const total = await grid.runPrompt('what is the total salary in Germany');
    // rows 55..59 are in Germany: 56000 + 57000 + 58000 + 59000 + 60000
    expect(total.mode === 'ask' ? total.answer : '').to.equal(
      'The total Salary is 290000 (Country = Germany).'
    );
    const avg = await grid.runPrompt('what is the average salary');
    expect(avg.mode === 'ask' ? avg.answer : '').to.equal('The average Salary is 30500.');
    const rated = await grid.runPrompt('who has the highest rating');
    expect(rated.mode === 'ask' ? rated.answer : '').to.match(/Rating/);
  });
});

describe('AI parse: analytical questions outrank generic commands (review r8)', () => {
  const columns = [
    col('avatar', ''),
    col('name', 'Name'),
    col('department', 'Department'),
    col('country', 'Country'),
    col('status', 'Status'),
    col('salary', 'Salary', 'number'),
    col('age', 'Age', 'number'),
    col('price', 'Price', 'currency'),
    col('bonus', 'Bonus', 'number'),
  ];
  const DEPTS = ['Sales', 'Ops', 'Eng'];
  const data = Array.from({ length: 60 }, (_, i) => ({
    avatar: `a${i}`,
    name: `N${i}`,
    department: DEPTS[i % 3],
    country: i >= 55 ? 'Germany' : 'USA',
    status: i % 2 ? 'Paid' : 'Under Review',
    salary: 1000 * (i + 1),
    age: 20 + (i % 40),
    price: i * 3,
    bonus: 5000 + (i % 7) * 1000,
  }));
  const run = (prompt: string) => engineOver(columns, data).engine.runPrompt(prompt);
  const preview = (prompt: string) => engineOver(columns, data).engine.previewPrompt(prompt);

  const answers: Array<[string, RegExp]> = [
    ['min, max and median of bonus', /minimum 5000.*maximum 11000.*median 8000/],
    ['max and median of bonus', /^Bonus: maximum 11000; median 8000\.$/],
    ['sum of bonus and median salary', /median.*total/],
    ['average and median salary', /^Salary: average 30500; median 30500\.$/],
    ['count distinct department', /distinct 3/],
    ['show top 5 by salary', /^Top 5 by Salary: N59 60000/],
    ['show bottom 3 by age', /^Bottom 3 by Age: /],
    ['find top 5 by salary', /^Top 5 by Salary: /],
    ['find distinct countries', /2 distinct Country/],
  ];
  for (const [prompt, expected] of answers) {
    it(`"${prompt}" answers the analytical question`, async () => {
      const result = await run(prompt);
      expect(result.mode, prompt).to.equal('ask');
      expect(answerOf(result), prompt).to.match(expected);
    });
  }

  it('"total bonus where country is Germany" filters instead of summing the country', async () => {
    const plan = await preview('total bonus where country is Germany');
    expect(whereOf(plan)).to.deep.equal([
      { key: 'country', operand: 'equals', searchTerm: 'Germany' },
    ]);
  });

  it('a generic command still runs when no analytical rule matches', async () => {
    expect(tools(await preview('sum of bonus'))).to.deep.equal(['aggregate']);
    expect(tools(await preview('show salary'))).to.deep.equal(['columns']);
    expect(tools(await preview('find Germany'))).to.deep.equal(['quickFilter']);
    expect(tools(await preview('hide the median column'))).to.deep.equal([]);
  });

  it('plural mentions keep the measure of a grouped question', async () => {
    expect(answerOf(await run('average ages by department'))).to.match(
      /^Average Age by Department: Sales \d/
    );
    expect(answerOf(await run('average prices by department'))).to.match(
      /^Average Price by Department: Sales \d/
    );
    expect(answerOf(await run('total salaries by department'))).to.match(
      /^Total Salary by Department: Sales \d/
    );
  });

  it('a grouped metric with no numeric column abstains instead of n/a groups', async () => {
    const plan = await preview('average by department');
    expect(plan.steps).to.be.empty;
    expect(plan.notes?.[0]).to.contain('Tell me which numeric column');
  });

  it('a value after a copula keeps operator-like words a string column cannot use', async () => {
    for (const [prompt, value] of [
      ['where status is Under Review', 'Under Review'],
      ['where status is over budget', 'over budget'],
    ]) {
      expect(whereOf(await preview(prompt)), prompt).to.deep.equal([
        { key: 'status', operand: 'equals', searchTerm: value },
      ]);
    }
    expect(whereOf(await preview('where age is over 30'))).to.deep.equal([
      { key: 'age', operand: 'greaterThan', searchTerm: 30 },
    ]);
    expect(whereOf(await preview('remove rows where status is under review'))).to.deep.equal([
      { key: 'status', operand: 'doesNotEqual', searchTerm: 'under review' },
    ]);
  });

  it('a phrase resolves to its earliest column mention, not the first in schema order', async () => {
    const plan = await preview('sort by bonus then country');
    expect(plan.steps[0]?.args).to.deep.equal({
      by: [
        { key: 'bonus', direction: 'ascending' },
        { key: 'country', direction: 'ascending' },
      ],
    });
    const hide = await preview('hide bonus country');
    expect(hide.steps[0]?.args).to.deep.equal({ columns: [{ key: 'bonus', hidden: true }] });
  });

  it('a show command ends before a where clause, so the condition applies', async () => {
    expect(whereOf(await preview('show salary where age is over 30'))).to.deep.equal([
      { key: 'age', operand: 'greaterThan', searchTerm: 30 },
    ]);
  });

  it('the abstention hint lists no empty header', async () => {
    const plan = await preview('sort by revenue');
    expect(plan.notes?.[0]).to.contain('Try one of: Name, Department');
  });
});
