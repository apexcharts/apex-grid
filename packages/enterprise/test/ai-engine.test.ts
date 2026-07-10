import { expect } from '@open-wc/testing';
import {
  createAIEngine,
  createRuleBasedReasoner,
  type Plan,
  type Reasoner,
} from '../src/features/ai/index.js';
import { makeApi, type Row } from './ai-fixtures.js';

/** A stub LLM reasoner that always returns a fixed, confident plan. */
function stubLLM(plan: Plan): Reasoner {
  return { name: 'llm:test', score: () => 0.9, reason: () => Promise.resolve(plan) };
}

describe('AI reasoning layer — AIEngine', () => {
  it('runPrompt applies a control plan and records the turn to memory', async () => {
    const api = makeApi();
    const engine = createAIEngine<Row>(api, { now: () => 1 });
    const result = await engine.runPrompt('sort by amount descending');

    expect(result.mode).to.equal('control');
    if (result.mode !== 'control') return;
    expect(result.applied).to.include('sort');
    expect(api.getState().sort.map((s) => s.key)).to.deep.equal(['amount']);

    const snap = engine.memory.snapshot();
    expect(snap.turns).to.have.lengthOf(1);
    expect(snap.turns[0].stateBefore, 'records the pre-change snapshot').to.exist;
    expect(snap.lastEntities?.columns).to.deep.equal(['amount']);
  });

  it('exposes a working undo on the control result', async () => {
    const api = makeApi();
    const engine = createAIEngine<Row>(api);
    const result = await engine.runPrompt('sort by amount descending');
    if (result.mode !== 'control') throw new Error('expected control');
    result.undo();
    expect(api.getState().sort).to.be.empty;
  });

  it('previewPrompt returns the plan WITHOUT executing it', async () => {
    const api = makeApi();
    const engine = createAIEngine<Row>(api);
    const plan = await engine.previewPrompt('group by region');
    expect(plan.steps[0]?.tool).to.equal('group');
    expect(api.calls, 'preview must not mutate the grid').to.be.empty;
  });

  it('ask mode is strictly read-only, even forced on a control-style prompt', async () => {
    const api = makeApi();
    const engine = createAIEngine<Row>(api);
    const result = await engine.runPrompt('sort by amount descending', { mode: 'ask' });
    expect(result.mode).to.equal('ask');
    expect(api.calls, 'ask mode must not mutate the grid').to.be.empty;
  });

  it('supports a multi-turn refinement using live state ("reverse the sort")', async () => {
    const api = makeApi();
    const engine = createAIEngine<Row>(api);
    await engine.runPrompt('sort by amount ascending');
    expect(api.getState().sort).to.deep.equal([{ key: 'amount', direction: 'ascending' }]);
    await engine.runPrompt('reverse the sort');
    expect(api.getState().sort).to.deep.equal([{ key: 'amount', direction: 'descending' }]);
  });

  it('undoes the previous turn from conversation memory', async () => {
    const api = makeApi();
    const engine = createAIEngine<Row>(api);
    await engine.runPrompt('sort by amount descending');
    expect(api.getState().sort).to.have.lengthOf(1);
    await engine.runPrompt('undo');
    expect(api.getState().sort).to.be.empty;
  });
});

describe('AI reasoning layer — Router (hybrid dispatch)', () => {
  const llmPlan: Plan = {
    mode: 'control',
    steps: [{ tool: 'quickFilter', args: { text: 'from-llm' } }],
    confidence: 0.9,
    source: 'llm:test',
  };

  it('rule-first: keeps the rule plan when the rule engine is confident', async () => {
    const api = makeApi();
    const engine = createAIEngine<Row>(api, {
      reasoners: [createRuleBasedReasoner(), stubLLM(llmPlan)],
    });
    const result = await engine.runPrompt('sort by amount descending');
    expect(result.plan.source).to.equal('rule');
    expect(api.getState().sort.map((s) => s.key)).to.deep.equal(['amount']);
  });

  it('rule-first: escalates to the LLM reasoner when the rule engine is unsure', async () => {
    const api = makeApi();
    const engine = createAIEngine<Row>(api, {
      reasoners: [createRuleBasedReasoner(), stubLLM(llmPlan)],
    });
    const result = await engine.runPrompt('do something the rules cannot map xyzzy');
    expect(result.plan.source).to.equal('llm:test');
    expect(api.getState().quickFilter).to.equal('from-llm');
  });

  it('rule-only policy never escalates to the LLM', async () => {
    const api = makeApi();
    const engine = createAIEngine<Row>(api, {
      reasoners: [createRuleBasedReasoner(), stubLLM(llmPlan)],
      policy: 'rule-only',
    });
    const result = await engine.runPrompt('gibberish xyzzy that no rule matches');
    expect(result.plan.source).to.not.equal('llm:test');
    expect(api.getState().quickFilter).to.equal('');
  });
});
