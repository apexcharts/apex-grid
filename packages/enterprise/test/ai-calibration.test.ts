import { expect } from '@open-wc/testing';
import {
  createAIEngine,
  createIntentDetector,
  createRuleBasedReasoner,
  type Plan,
  type Reasoner,
} from '../src/features/ai/index.js';
import { makeApi, makeContext, type Row } from './ai-fixtures.js';

describe('AI calibration — vocabulary reduction', () => {
  const detector = createIntentDetector();
  const ctx = makeContext(makeApi());

  it('a bare question word no longer hijacks a near-miss command', () => {
    // "delete" is not a command verb, and the stray "who" must NOT classify this as a
    // read-only question (the old behavior returned a confident wrong answer).
    expect(detector.detect('delete who have amount less than 15', ctx).kind).to.equal('unknown');
  });

  it('still routes a question word paired with a superlative to analyze', () => {
    expect(detector.detect('who has the highest amount', ctx).kind).to.equal('analyze');
  });

  it('still recognizes an explicit "how many" question', () => {
    expect(detector.detect('how many rows are there?', ctx).kind).to.equal('ask');
  });
});

describe('AI calibration — grounding-based confidence', () => {
  const reasoner = createRuleBasedReasoner();
  const plan = (utterance: string): Promise<Plan> =>
    reasoner.reason(utterance, makeContext(makeApi()));

  it('keeps a grounded question at or above the escalation floor', async () => {
    const p = await plan('highest amount?');
    expect(p.mode).to.equal('ask');
    expect(p.confidence).to.be.greaterThan(0.5);
  });

  it('drops a generic question below the floor so it can escalate or abstain', async () => {
    const p = await plan('what is going on here?');
    expect(p.mode).to.equal('ask');
    expect(p.confidence).to.be.lessThan(0.5);
  });
});

describe('AI calibration — abstention', () => {
  it('abstains honestly on an unmappable prompt instead of a silent no-op', async () => {
    const api = makeApi();
    const result = await createAIEngine<Row>(api).runPrompt('delete who have amount less than 15');
    expect(result.mode).to.equal('ask');
    if (result.mode !== 'ask') return;
    expect(result.abstained).to.equal(true);
    // The grid is untouched: abstention never mutates.
    expect(api.calls).to.be.empty;
    expect(api.getState().filter).to.be.empty;
  });

  it('escalates to an LLM before abstaining when one is configured', async () => {
    const api = makeApi();
    const llm: Reasoner = {
      name: 'llm:test',
      score: () => 0.9,
      reason: () =>
        Promise.resolve({
          mode: 'control',
          steps: [
            {
              tool: 'filter',
              args: { where: [{ key: 'amount', operand: 'greaterThanOrEqual', searchTerm: 15 }] },
            },
          ],
          confidence: 0.9,
          source: 'llm:test',
        }),
    };
    const result = await createAIEngine<Row>(api, {
      reasoners: [createRuleBasedReasoner(), llm],
    }).runPrompt('delete who have amount less than 15');
    expect(result.mode).to.equal('control');
    if (result.mode !== 'control') return;
    expect(result.applied).to.include('filter');
    expect(result.plan.source).to.equal('llm:test');
  });
});
