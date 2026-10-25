import { expect } from '@open-wc/testing';
import {
  type AIResult,
  createAIEngine,
  createRuleBasedReasoner,
  type Reasoner,
} from '../src/features/ai/index.js';
import { makeApi, type Row } from './ai-fixtures.js';

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
