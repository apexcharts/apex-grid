import { expect } from '@open-wc/testing';
import {
  type AIMode,
  ConversationMemory,
  createAIEngine,
  createContextBuilder,
  createDefaultRegistry,
  createLLMReasoner,
  createRuleBasedReasoner,
  createToolExecutor,
  type GridApi,
  type LLMComplete,
  type LLMRequest,
  type LLMResponse,
} from '../src/features/ai/index.js';
import { makeApi, type Row } from './ai-fixtures.js';

/** A stub `complete` that returns a fixed response and records every request. */
function recording(response: LLMResponse): { complete: LLMComplete; calls: LLMRequest[] } {
  const calls: LLMRequest[] = [];
  const complete: LLMComplete = (request) => {
    calls.push(request);
    return Promise.resolve(response);
  };
  return { complete, calls };
}

function ctxWith(api: GridApi<Row>, requestedMode?: AIMode, signal?: AbortSignal) {
  return createContextBuilder<Row>().build(api, new ConversationMemory(), {
    requestedMode,
    signal,
  });
}

describe('AI reasoning layer — createLLMReasoner (generic bridge)', () => {
  it('wraps a control patch into a single applyState step and applies it', async () => {
    const { complete } = recording({ patch: { quickFilter: 'wireless' } });
    const reasoner = createLLMReasoner({ complete });
    const api = makeApi();
    const ctx = ctxWith(api, 'control');

    const plan = await reasoner.reason('make everything wireless', ctx);
    expect(plan.mode).to.equal('control');
    expect(plan.source).to.equal('llm');
    expect(plan.steps).to.have.lengthOf(1);
    expect(plan.steps[0]?.tool).to.equal('applyState');

    createToolExecutor(createDefaultRegistry()).run(plan, { api, ctx });
    expect(api.getState().quickFilter).to.equal('wireless');
  });

  it('carries the model answer in ask mode (no steps)', async () => {
    const { complete, calls } = recording({ answer: 'There are 3 rows.' });
    const reasoner = createLLMReasoner({ complete });
    const plan = await reasoner.reason('tell me about the data', ctxWith(makeApi(), 'ask'));
    expect(plan.mode).to.equal('ask');
    expect(plan.answer).to.equal('There are 3 rows.');
    expect(plan.steps).to.be.empty;
    expect(calls[0]?.mode).to.equal('ask');
  });

  it('marks an empty control patch as low confidence with a note', async () => {
    const reasoner = createLLMReasoner({ complete: () => Promise.resolve({ patch: {} }) });
    const plan = await reasoner.reason('do a thing', ctxWith(makeApi(), 'control'));
    expect(plan.steps).to.be.empty;
    expect(plan.confidence).to.be.lessThan(0.5);
    expect(plan.notes?.[0]).to.contain('no change');
  });

  it('marks an empty answer as low confidence with a note', async () => {
    const reasoner = createLLMReasoner({ complete: () => Promise.resolve({ answer: '   ' }) });
    const plan = await reasoner.reason('what is going on?', ctxWith(makeApi(), 'ask'));
    expect(plan.answer).to.equal('');
    expect(plan.confidence).to.be.lessThan(0.5);
    expect(plan.notes?.[0]).to.contain('no answer');
  });

  it('honors ctx.requestedMode over the question heuristic', async () => {
    const { complete, calls } = recording({ patch: { quickFilter: 'x' } });
    const reasoner = createLLMReasoner({ complete });
    // A question shape, but the caller forced control.
    await reasoner.reason('what is the max amount?', ctxWith(makeApi(), 'control'));
    expect(calls[0]?.mode).to.equal('control');
  });

  it('auto-detects ask mode from a question when no mode is forced', async () => {
    const { complete, calls } = recording({ answer: 'ok' });
    const reasoner = createLLMReasoner({ complete });
    await reasoner.reason('why is revenue down?', ctxWith(makeApi(), undefined));
    expect(calls[0]?.mode).to.equal('ask');
  });

  it('auto-detects control mode from an imperative command', async () => {
    const { complete, calls } = recording({ patch: { quickFilter: 'x' } });
    const reasoner = createLLMReasoner({ complete });
    await reasoner.reason('group everything by region', ctxWith(makeApi(), undefined));
    expect(calls[0]?.mode).to.equal('control');
  });

  it('reports a default triage score of 0.6, configurable', () => {
    const complete: LLMComplete = () => Promise.resolve({});
    expect(createLLMReasoner({ complete }).score('x', ctxWith(makeApi()))).to.equal(0.6);
    expect(createLLMReasoner({ complete, score: 0.42 }).score('x', ctxWith(makeApi()))).to.equal(
      0.42
    );
  });

  it('forwards the schema, bounded data sample, and signal to the model', async () => {
    const { complete, calls } = recording({ answer: 'ok' });
    const reasoner = createLLMReasoner({ complete });
    const controller = new AbortController();
    await reasoner.reason('question?', ctxWith(makeApi(), 'ask', controller.signal));
    expect(calls[0]?.schema.columns.map((c) => c.key)).to.deep.equal([
      'region',
      'product',
      'amount',
    ]);
    expect(calls[0]?.data).to.have.lengthOf(3);
    expect(calls[0]?.signal).to.equal(controller.signal);
  });

  it('works as an escalation target through the engine (rule-first)', async () => {
    const api = makeApi();
    const llm = createLLMReasoner({
      complete: () => Promise.resolve({ patch: { quickFilter: 'from-llm' } }),
    });
    const engine = createAIEngine<Row>(api, { reasoners: [createRuleBasedReasoner(), llm] });
    const result = await engine.runPrompt('please perform the unmappable xyzzy frobnication');
    expect(result.plan.source).to.equal('llm');
    expect(api.getState().quickFilter).to.equal('from-llm');
  });
});
