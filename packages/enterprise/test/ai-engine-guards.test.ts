import { expect, fixtureCleanup } from '@open-wc/testing';
import type { ColumnSchema, GridSchema } from 'apex-grid';
import {
  type AIResult,
  type AnalyticsQuery,
  createAIEngine,
  createFakeGridApi,
  createRuleBasedReasoner,
  formatAnalyticsAnswer,
  type Plan,
  type Reasoner,
  runAnalytics,
} from '../src/features/ai/index.js';
import { enterpriseSchema, makeApi, mountPersonGrid, type Row } from './ai-fixtures.js';
// Load the grid with the file, not inside the live-grid test's timeout.
import '../src/index.js';

const control = (result: AIResult) => {
  if (result.mode !== 'control') throw new Error(`expected control, got ${JSON.stringify(result)}`);
  return result;
};

const groupBy = (state: { modules: Record<string, unknown> }) =>
  (state.modules.enterprise as { groupBy?: string[] } | undefined)?.groupBy ?? [];

/** A model-backed reasoner that ignores the abort signal and answers late. */
function slowReasoner(calls: string[] = []): Reasoner {
  return {
    name: 'llm:slow',
    score: () => 0.9,
    reason: async (utterance) => {
      calls.push(utterance);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        mode: 'control',
        steps: [{ tool: 'quickFilter', args: { text: 'from-llm' } }],
        confidence: 0.9,
        source: 'llm:slow',
      };
    },
  };
}

/** A prompt the rule engine cannot map, so the router escalates. */
const UNMAPPED = 'delete who have amount less than 15';

describe('AI engine guards: repeated undo steps back', () => {
  it('undo, undo, undo takes back three changes in turn, then has nothing left', async () => {
    const api = makeApi();
    const engine = createAIEngine<Row>(api);
    await engine.runPrompt('sort by amount descending');
    await engine.runPrompt('search EMEA');
    await engine.runPrompt('group by region');
    expect(groupBy(api.getState())).to.deep.equal(['region']);

    await engine.runPrompt('undo');
    expect(groupBy(api.getState()), 'first undo: grouping').to.be.empty;
    expect(api.getState().quickFilter).to.equal('EMEA');

    await engine.runPrompt('undo');
    expect(api.getState().quickFilter, 'second undo: search').to.equal('');
    expect(groupBy(api.getState()), 'grouping is not re-applied').to.be.empty;
    expect(api.getState().sort).to.have.lengthOf(1);

    await engine.runPrompt('undo');
    expect(api.getState().sort, 'third undo: sort').to.be.empty;
    expect(api.getState().quickFilter).to.equal('');

    const last = control(await engine.runPrompt('undo'));
    expect(last.warnings).to.include('Nothing to undo.');
    expect(api.getState().sort).to.be.empty;
    expect(groupBy(api.getState())).to.be.empty;
  });

  it("a result's undo() counts as an undo step", async () => {
    const api = makeApi();
    const engine = createAIEngine<Row>(api);
    await engine.runPrompt('sort by amount descending');
    control(await engine.runPrompt('search EMEA')).undo();
    expect(api.getState().quickFilter).to.equal('');

    await engine.runPrompt('undo');
    expect(api.getState().sort, 'the undo prompt takes back the sort').to.be.empty;
    expect(api.getState().quickFilter).to.equal('');
  });

  it('a prompt that undoes and changes something is taken back as a whole', async () => {
    const api = makeApi();
    const engine = createAIEngine<Row>(api);
    await engine.runPrompt('sort by amount descending');
    await engine.runPrompt('search EMEA');
    const compound = control(await engine.runPrompt('undo and group by region'));
    expect(compound.applied).to.include('undo');
    expect(api.getState().quickFilter).to.equal('');
    expect(groupBy(api.getState())).to.deep.equal(['region']);

    await engine.runPrompt('undo');
    expect(groupBy(api.getState()), 'the grouping is taken back').to.be.empty;
    expect(api.getState().quickFilter, 'with the search it undid').to.equal('EMEA');
    expect(api.getState().sort).to.have.lengthOf(1);

    await engine.runPrompt('undo');
    expect(api.getState().quickFilter, 'then the search').to.equal('');
    expect(api.getState().sort).to.have.lengthOf(1);

    await engine.runPrompt('undo');
    expect(api.getState().sort, 'then the sort').to.be.empty;
  });

  it('the undo baseline passes over a turn that changed nothing, as undo does', () => {
    const api = makeApi();
    const { memory } = createAIEngine<Row>(api);
    const plain = api.getState();
    const sorted = { ...plain, sort: [{ key: 'amount', direction: 'descending' as const }] };
    memory.record({
      utterance: 'sort',
      outcome: 'applied',
      stateBefore: plain,
      stateAfter: sorted,
      at: 1,
    });
    memory.record({
      utterance: 'export',
      outcome: 'applied',
      stateBefore: sorted,
      stateAfter: sorted,
      at: 2,
    });
    expect(memory.snapshot().lastControlBefore).to.equal(plain);

    memory.record({
      utterance: 'undo',
      outcome: 'applied',
      stateBefore: sorted,
      stateAfter: plain,
      at: 3,
      reverts: true,
    });
    expect(memory.snapshot().lastControlBefore, 'the undo took back the sort').to.equal(undefined);
  });

  it('undoing an undo is a redo that the next undo takes back', async () => {
    const api = makeApi();
    const engine = createAIEngine<Row>(api);
    await engine.runPrompt('sort by amount descending');
    const undo = control(await engine.runPrompt('undo'));
    expect(api.getState().sort).to.be.empty;
    undo.undo();
    expect(api.getState().sort).to.have.lengthOf(1);
    await engine.runPrompt('undo');
    expect(api.getState().sort).to.be.empty;
  });
});

describe('AI engine guards: cancellation', () => {
  it('an already aborted signal rejects before any plan runs or is recorded', async () => {
    const api = makeApi();
    const engine = createAIEngine<Row>(api);
    const controller = new AbortController();
    controller.abort();
    const run = await engine
      .runPrompt('sort by amount descending', { signal: controller.signal })
      .catch((error: unknown) => error);
    expect((run as Error).name).to.equal('AbortError');
    const preview = await engine
      .previewPrompt('sort by amount descending', { signal: controller.signal })
      .catch((error: unknown) => error);
    expect((preview as Error).name).to.equal('AbortError');
    expect(api.calls).to.be.empty;
    expect(engine.memory.snapshot().turns).to.be.empty;
  });

  it('a cancel while a model ignores the signal never applies its late plan', async () => {
    const api = makeApi();
    const engine = createAIEngine<Row>(api, {
      reasoners: [createRuleBasedReasoner(), slowReasoner()],
      policy: 'llm-first',
    });
    const controller = new AbortController();
    const pending = engine.runPrompt(UNMAPPED, { signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    const error = await pending.catch((e: unknown) => e);
    expect((error as Error).name).to.equal('AbortError');
    expect(api.getState().quickFilter).to.equal('');
    expect(api.calls).to.be.empty;
    expect(engine.memory.snapshot().turns).to.be.empty;
  });

  it('the router does not escalate to a model once the prompt is cancelled', async () => {
    const api = makeApi();
    const calls: string[] = [];
    const engine = createAIEngine<Row>(api, {
      reasoners: [createRuleBasedReasoner(), slowReasoner(calls)],
    });
    const controller = new AbortController();
    const pending = engine.runPrompt(UNMAPPED, { signal: controller.signal });
    controller.abort();
    const error = await pending.catch((e: unknown) => e);
    expect((error as Error).name).to.equal('AbortError');
    expect(calls, 'no model call after the cancel').to.be.empty;
    expect(api.calls).to.be.empty;
  });
});

describe('AI engine guards: abstention and grounding', () => {
  it('forced ask mode answers what the answer tool grounds and abstains otherwise', async () => {
    const engine = createAIEngine<Row>(makeApi());
    const highest = await engine.runPrompt('highest amount', { mode: 'ask' });
    if (highest.mode !== 'ask') throw new Error('expected ask');
    expect(highest.answer).to.equal('The highest Amount is 30.');
    expect(highest.abstained).to.equal(undefined);

    const backflip = await engine.runPrompt('do a backflip', { mode: 'ask' });
    if (backflip.mode !== 'ask') throw new Error('expected ask');
    expect(backflip.abstained).to.equal(true);

    const sort = await engine.runPrompt('sort by amount', { mode: 'ask' });
    if (sort.mode !== 'ask') throw new Error('expected ask');
    expect(sort.abstained).to.equal(true);
    expect(sort.plan.mode, 'reported without its mutating steps').to.equal('ask');
    expect(sort.plan.steps).to.be.empty;
  });

  it('a generic question abstains instead of answering with the view summary', async () => {
    const result = await createAIEngine<Row>(makeApi()).runPrompt('what are the regions?');
    expect(result.mode).to.equal('ask');
    if (result.mode !== 'ask') return;
    expect(result.abstained).to.equal(true);
    expect(result.answer).to.not.contain('Current view');
    expect(result.answer, 'with a hint').to.contain('I can count rows');
  });

  it('a measure that does not resolve abstains with its note', async () => {
    const result = await createAIEngine<Row>(makeApi()).runPrompt('what is the median of salary');
    if (result.mode !== 'ask') throw new Error('expected ask');
    expect(result.abstained).to.equal(true);
    expect(result.answer).to.contain('Tell me which column');
  });

  it('a raised threshold keeps the answers the rule engine computes', async () => {
    const engine = createAIEngine<Row>(makeApi(), { threshold: 0.9 });
    const count = await engine.runPrompt('how many rows?');
    if (count.mode !== 'ask') throw new Error('expected ask');
    expect(count.answer).to.equal('There are 3 rows.');
    expect(count.abstained).to.equal(undefined);

    const average = await engine.runPrompt('what is the average amount');
    if (average.mode !== 'ask') throw new Error('expected ask');
    expect(average.answer).to.equal('The average Amount is 20.');
    expect(average.abstained).to.equal(undefined);

    const generic = await engine.runPrompt('what are the regions?');
    expect(generic.mode === 'ask' && generic.abstained).to.equal(true);
  });

  it('grounded questions still answer, and the planner grounds what the answer tool computes', async () => {
    const engine = createAIEngine<Row>(makeApi());
    const count = await engine.runPrompt('how many rows?');
    if (count.mode !== 'ask') throw new Error('expected ask');
    expect(count.answer).to.equal('There are 3 rows.');
    expect(count.abstained).to.equal(undefined);

    const maximum = await engine.runPrompt('maximum amount?');
    if (maximum.mode !== 'ask') throw new Error('expected ask');
    expect(maximum.answer).to.equal('The highest Amount is 30.');
    expect(maximum.abstained).to.equal(undefined);
    expect(maximum.plan.confidence, '"maximum" is grounded').to.be.at.least(0.5);

    const analyzed = await engine.runPrompt('what is the average amount');
    if (analyzed.mode !== 'ask') throw new Error('expected ask');
    expect(analyzed.answer).to.equal('The average Amount is 20.');
  });

  it('a malformed analyze query is a clear refusal, a missing metrics list a default', async () => {
    const custom = (query: unknown): Reasoner => ({
      name: 'custom',
      score: () => 0.9,
      reason: async (): Promise<Plan> => ({
        mode: 'ask',
        steps: [{ tool: 'analyze', args: { query } }],
        confidence: 0.9,
        source: 'custom',
      }),
    });
    const ask = async (query: unknown) => {
      const result = await createAIEngine<Row>(makeApi(), { reasoners: [custom(query)] }).runPrompt(
        'anything'
      );
      if (result.mode !== 'ask') throw new Error('expected ask');
      return result;
    };

    const bad = await ask({ kind: 'average', metrics: ['avg'], column: 'amount', limit: 'two' });
    expect(bad.abstained).to.equal(true);
    expect(bad.answer).to.contain('"kind"');

    const defaulted = await ask({ kind: 'aggregate', column: 'amount' });
    expect(defaulted.answer).to.equal('The total Amount is 60.');
  });
});

describe('AI engine guards: concurrent first prompts', () => {
  afterEach(() => fixtureCleanup());

  it('share one engine, so a following undo sees both turns', async () => {
    const grid = await mountPersonGrid();
    const [sorted] = await Promise.all([
      grid.runPrompt('sort by salary descending'),
      grid.runPrompt('how many rows?'),
    ]);
    expect(control(sorted).applied).to.include('sort');
    expect(grid.getState().sort).to.have.lengthOf(1);

    const undo = control(await grid.runPrompt('undo'));
    expect(undo.applied).to.include('undo');
    expect(grid.getState().sort).to.be.empty;
  });
});

// --- analytics ---------------------------------------------------------------

const textColumn = enterpriseSchema.columns[0];
const numberColumn = enterpriseSchema.columns[2];
const column = (base: ColumnSchema, key: string, label: string, extra = {}): ColumnSchema => ({
  ...base,
  key,
  label,
  ...extra,
});

const staffSchema: GridSchema = {
  ...enterpriseSchema,
  columns: [
    column(textColumn, 'name', 'Name'),
    column(textColumn, 'dept', 'Department'),
    column(textColumn, 'title', 'Title'),
    column(numberColumn, 'salary', 'Salary'),
    column(numberColumn, 'rate', 'Rate'),
    column(textColumn, 'active', 'Active', {
      dataType: 'boolean',
      filterOperands: ['all', 'true', 'false', 'empty', 'notEmpty'],
    }),
  ],
};

const staff = [
  { name: 'Ann', dept: 'Eng', title: 'Engineer', salary: '95,000', rate: 0.0012, active: true },
  { name: 'Bob', dept: 'Eng', title: 'Engineer', salary: '', rate: 0.0031, active: false },
  { name: 'Cy', dept: 'Sales', title: 'Rep', salary: '$60,000', rate: 0.0024, active: true },
  { name: 'Dee', dept: 'Eng', title: 'Manager', salary: '70000', rate: 0.0009, active: true },
];

const say = (query: AnalyticsQuery) =>
  formatAnalyticsAnswer(runAnalytics(query, staff, staffSchema), staffSchema);

describe('AI engine guards: analytics', () => {
  it('a blank cell is missing, not 0', () => {
    expect(say({ kind: 'aggregate', metrics: ['min'], column: 'salary' })).to.equal(
      'The minimum Salary is 60000.'
    );
    expect(
      say({ kind: 'rank', metrics: [], column: 'salary', direction: 'bottom', labelColumn: 'name' })
    ).to.equal('Cy has the lowest Salary (60000).');
    expect(
      say({
        kind: 'aggregate',
        metrics: ['count'],
        where: [{ key: 'salary', operand: 'lessThan', value: 65000 }],
      })
    ).to.equal('There are 1 matching rows (Salary < 65000).');
  });

  it('scopes with every grid operand of the column type and refuses an unknown one', () => {
    expect(
      say({
        kind: 'aggregate',
        metrics: ['count'],
        where: [{ key: 'name', operand: 'startsWith', value: 'A' }],
      })
    ).to.equal('There are 1 matching rows (Name starts with A).');
    expect(
      say({
        kind: 'aggregate',
        metrics: ['count'],
        where: [{ key: 'active', operand: 'true', value: undefined }],
      })
    ).to.equal('There are 3 matching rows (Active is true).');
    const refused = say({
      kind: 'aggregate',
      metrics: ['count'],
      where: [{ key: 'salary', operand: 'between', value: [1, 2] }],
    });
    expect(refused).to.contain('"between"');
    expect(refused).to.not.contain('There are 4');
  });

  it('mode works per group and reads as the most common value in each group', () => {
    expect(say({ kind: 'group', metrics: ['mode'], column: 'title', groupBy: 'dept' })).to.equal(
      'Most common Title in each Department: Eng Engineer; Sales Rep.'
    );
  });

  it('"most common title per department" answers from the rule engine', async () => {
    const api = createFakeGridApi({ schema: staffSchema, data: staff });
    const result = await createAIEngine(api).runPrompt('most common title per department');
    if (result.mode !== 'ask') throw new Error('expected ask');
    expect(result.answer).to.equal(
      'Most common Title in each Department: Eng Engineer; Sales Rep.'
    );

    const distinct = await createAIEngine(api).runPrompt('distinct titles per department');
    if (distinct.mode !== 'ask') throw new Error('expected ask');
    expect(distinct.answer, 'distinct reads the mentioned column too').to.not.contain('n/a');
    expect(distinct.answer).to.contain('Eng');
  });

  it('a per-group mode with no column to read asks for one instead of answering n/a', async () => {
    const result = await createAIEngine(makeApi()).runPrompt('most common colour per region');
    if (result.mode !== 'ask') throw new Error('expected ask');
    expect(result.abstained).to.equal(true);
    expect(result.answer).to.contain('Tell me which column to measure');
    expect(result.answer).to.not.contain('n/a');
  });

  it('an empty scope says no rows match, not that the column has nothing', () => {
    expect(
      say({
        kind: 'rank',
        metrics: [],
        column: 'salary',
        direction: 'top',
        limit: 3,
        where: [{ key: 'salary', operand: 'greaterThan', value: 1_000_000 }],
      })
    ).to.equal('No rows match (Salary > 1000000).');
  });

  it('small magnitudes keep significant digits', () => {
    expect(say({ kind: 'aggregate', metrics: ['avg'], column: 'rate' })).to.equal(
      'The average Rate is 0.0019.'
    );
  });

  it('a group count names no empty column', () => {
    expect(
      say({ kind: 'group', metrics: ['count'], groupBy: 'dept', direction: 'top', limit: 1 })
    ).to.equal('Eng has the highest count (3).');
    expect(say({ kind: 'group', metrics: ['count'], groupBy: 'dept' })).to.equal(
      'Count by Department: Eng 3; Sales 1.'
    );
  });
});
