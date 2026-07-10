import { expect } from '@open-wc/testing';
import {
  createAIEngine,
  createRuleBasedReasoner,
  type Plan,
  segmentClauses,
} from '../src/features/ai/index.js';
import { makeApi, makeContext, type Row } from './ai-fixtures.js';

describe('AI compositional — segmentClauses', () => {
  it('splits only at command boundaries', () => {
    expect(
      segmentClauses(
        'group by department, then sort by salary and remove all rows that have less than 70000 salary'
      )
    ).to.deep.equal([
      'group by department',
      'sort by salary',
      'remove all rows that have less than 70000 salary',
    ]);
  });

  it('keeps a multi-column command as a single clause', () => {
    expect(segmentClauses('sort by region and product')).to.deep.equal([
      'sort by region and product',
    ]);
  });

  it('leaves a single command untouched', () => {
    expect(segmentClauses('filter amount > 100')).to.deep.equal(['filter amount > 100']);
  });

  it('splits search then sort', () => {
    expect(segmentClauses('search hub then sort by amount')).to.deep.equal([
      'search hub',
      'sort by amount',
    ]);
  });
});

describe('AI compositional — broadened filters', () => {
  const reasoner = createRuleBasedReasoner();
  const plan = (utterance: string): Promise<Plan> =>
    reasoner.reason(utterance, makeContext(makeApi()));

  it('remove rows keeps the complement (operand inverted)', async () => {
    const p = await plan('remove all rows that have less than 15 amount');
    expect(p.steps).to.deep.equal([
      {
        tool: 'filter',
        args: { where: [{ key: 'amount', operand: 'greaterThanOrEqual', searchTerm: 15 }] },
      },
    ]);
  });

  it('parses column -> operator -> value with a copula', async () => {
    const p = await plan('keep only rows where amount is greater than 15');
    expect(p.steps[0]?.args).to.deep.equal({
      where: [{ key: 'amount', operand: 'greaterThan', searchTerm: 15 }],
    });
  });

  it('parses the value -> column order', async () => {
    const p = await plan('remove rows with less than 15 amount');
    expect(p.steps[0]?.args).to.deep.equal({
      where: [{ key: 'amount', operand: 'greaterThanOrEqual', searchTerm: 15 }],
    });
  });

  it('inverts "over N" to "<= N" for exclusion', async () => {
    const p = await plan('exclude rows with amount over 25');
    expect(p.steps[0]?.args).to.deep.equal({
      where: [{ key: 'amount', operand: 'lessThanOrEqual', searchTerm: 25 }],
    });
  });

  it('matches a bare value against the data ("show only EMEA")', async () => {
    const p = await plan('show only EMEA');
    expect(p.steps[0]?.args).to.deep.equal({
      where: [{ key: 'region', operand: 'equals', searchTerm: 'EMEA' }],
    });
  });

  it('fails with a note when the complement is not expressible', async () => {
    const p = await plan('remove all rows where product contains A');
    expect(p.steps).to.be.empty;
    expect(p.notes?.[0]).to.contain("can't");
  });
});

describe('AI compositional — compound commands (engine)', () => {
  it('applies group + sort + filter from one compound utterance', async () => {
    const api = makeApi();
    const result = await createAIEngine<Row>(api).runPrompt(
      'group by region, then sort by amount and remove all rows that have less than 15 amount'
    );
    expect(result.mode).to.equal('control');
    if (result.mode !== 'control') return;
    expect(result.applied).to.include.members(['sort', 'filter']);

    const state = api.getState();
    expect(state.sort.map((s) => s.key)).to.deep.equal(['amount']);
    expect((state.modules.enterprise as { groupBy?: string[] })?.groupBy).to.deep.equal(['region']);
    expect(state.filter).to.have.lengthOf(1);
    expect(state.filter[0]).to.include({
      key: 'amount',
      operand: 'greaterThanOrEqual',
      searchTerm: 15,
    });
  });

  it('reports a partial compound honestly instead of dropping it', async () => {
    const api = makeApi();
    const result = await createAIEngine<Row>(api).runPrompt(
      'group by region and sort by nonexistent'
    );
    if (result.mode !== 'control') throw new Error('expected control');
    expect((api.getState().modules.enterprise as { groupBy?: string[] })?.groupBy).to.deep.equal([
      'region',
    ]);
    expect(result.warnings.join(' ')).to.match(/nonexistent|no column/i);
  });

  it('undo restores the pre-compound state', async () => {
    const api = makeApi();
    const result = await createAIEngine<Row>(api).runPrompt(
      'sort by amount and remove all rows that have less than 15 amount'
    );
    if (result.mode !== 'control') throw new Error('expected control');
    expect(api.getState().sort).to.have.lengthOf(1);
    result.undo();
    expect(api.getState().sort).to.be.empty;
    expect(api.getState().filter).to.be.empty;
  });
});
