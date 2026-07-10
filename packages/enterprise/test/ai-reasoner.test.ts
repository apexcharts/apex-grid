import { expect } from '@open-wc/testing';
import {
  ConversationMemory,
  createDefaultRegistry,
  createRuleBasedReasoner,
  createToolExecutor,
  emptyGridState,
} from '../src/features/ai/index.js';
import { makeApi, makeContext } from './ai-fixtures.js';

const reasoner = createRuleBasedReasoner();
const executor = createToolExecutor(createDefaultRegistry());

describe('AI reasoning layer — RuleBasedReasoner (resolve + plan)', () => {
  it('plans a sort with the resolved column and direction', async () => {
    const plan = await reasoner.reason('sort by amount descending', makeContext(makeApi()));
    expect(plan.mode).to.equal('control');
    expect(plan.source).to.equal('rule');
    expect(plan.steps).to.deep.equal([
      { tool: 'sort', args: { by: [{ key: 'amount', direction: 'descending' }] } },
    ]);
  });

  it('fuzzy-resolves a mistyped column name', async () => {
    const plan = await reasoner.reason('sort by amont', makeContext(makeApi()));
    expect(plan.steps[0]?.args).to.deep.equal({ by: [{ key: 'amount', direction: 'ascending' }] });
  });

  it('maps a natural-language operator to a valid per-column operand and types the value', async () => {
    const plan = await reasoner.reason('filter amount > 100', makeContext(makeApi()));
    expect(plan.steps[0]?.tool).to.equal('filter');
    expect(plan.steps[0]?.args).to.deep.equal({
      where: [{ key: 'amount', operand: 'greaterThan', searchTerm: 100 }],
    });
  });

  it('plans multi-column grouping', async () => {
    const plan = await reasoner.reason('group by region and product', makeContext(makeApi()));
    expect(plan.steps[0]).to.deep.equal({ tool: 'group', args: { by: ['region', 'product'] } });
  });

  it('plans an ask (read-only) for a question', async () => {
    const plan = await reasoner.reason('how many rows are there?', makeContext(makeApi()));
    expect(plan.mode).to.equal('ask');
    expect(plan.steps[0]?.tool).to.equal('answer');
  });

  it('degrades to an empty, low-confidence plan with a helpful note on an unknown column', async () => {
    const plan = await reasoner.reason('sort by zzz', makeContext(makeApi()));
    expect(plan.steps).to.be.empty;
    expect(plan.confidence).to.be.lessThan(0.5);
    expect(plan.notes?.[0]).to.contain('Region');
  });

  it('reverses the active sort (reads live state)', async () => {
    const api = makeApi({ sort: [{ key: 'amount', direction: 'ascending' }] });
    const plan = await reasoner.reason('reverse the sort', makeContext(api));
    expect(plan.steps[0]).to.deep.equal({
      tool: 'sort',
      args: { by: [{ key: 'amount', direction: 'descending' }] },
    });
  });

  it('resolves a pronoun ("it") against conversation memory', async () => {
    const memory = new ConversationMemory();
    memory.record({
      utterance: 'sort by amount',
      outcome: 'applied',
      entities: { columns: ['amount'] },
      at: 0,
    });
    const plan = await reasoner.reason('sort it descending', makeContext(makeApi(), memory));
    expect(plan.steps[0]?.args).to.deep.equal({
      by: [{ key: 'amount', direction: 'descending' }],
    });
  });

  it('score() reflects detector confidence (high for a clear command, 0 for gibberish)', () => {
    const ctx = makeContext(makeApi());
    expect(reasoner.score('group by region', ctx)).to.be.greaterThan(0.7);
    expect(reasoner.score('asdf qwer', ctx)).to.equal(0);
  });
});

describe('AI reasoning layer — end to end (reason then execute)', () => {
  it('applies a sort through the executor and grid api', async () => {
    const api = makeApi();
    const ctx = makeContext(api);
    const plan = await reasoner.reason('sort by amount, highest first', ctx);
    const result = executor.run(plan, { api, ctx });
    expect(result.applied).to.include('sort');
    expect(api.getState().sort).to.deep.equal([{ key: 'amount', direction: 'descending' }]);
  });

  it('applies grouping through the executor', async () => {
    const api = makeApi();
    const ctx = makeContext(api);
    const plan = await reasoner.reason('group by region', ctx);
    executor.run(plan, { api, ctx });
    expect((api.getState().modules.enterprise as { groupBy?: string[] }).groupBy).to.deep.equal([
      'region',
    ]);
  });

  it('answers a data question via the analytics query, without mutating the grid', async () => {
    const api = makeApi();
    const ctx = makeContext(api);
    const plan = await reasoner.reason('what is the highest amount?', ctx);
    const result = executor.run(plan, { api, ctx });
    expect(result.answer).to.equal('The maximum Amount is 30.');
    expect(api.calls).to.be.empty;
  });

  it('undoes the last change via memory baseline', async () => {
    const memory = new ConversationMemory();
    memory.record({ utterance: 'sort', outcome: 'applied', stateBefore: emptyGridState(), at: 0 });
    const api = makeApi({ sort: [{ key: 'amount', direction: 'descending' }] });
    const ctx = makeContext(api, memory);
    const plan = await reasoner.reason('undo', ctx);
    const result = executor.run(plan, { api, ctx });
    expect(result.applied).to.include('undo');
    expect(api.getState().sort).to.be.empty;
  });
});
