/**
 * The LLM reasoner bridge: adapt any "complete a prompt" function into a
 * {@link Reasoner}, so an LLM can join the pipeline as an escalation target.
 *
 * A reasoner turns an utterance into a {@link Plan}. This one delegates to a model
 * (through the injected {@link LLMComplete}) and wraps the result: a control
 * response (a view-state patch) becomes a single `applyState` step, which is
 * sanitized, applied, and made undoable exactly like every other tool; an ask
 * response becomes a plan carrying the text answer. The mode comes from the
 * engine's request hint (`ctx.requestedMode`), falling back to a light question
 * heuristic when the caller did not force one. The model call itself is
 * provider-agnostic: {@link createClaudeReasoner} builds a Claude-backed
 * `complete`, or pass your own for any other provider.
 *
 * @see plans/ai-reasoning-layer-spec.md (section 4.8)
 */

import type { GridSchema } from 'apex-grid';
import type { StatePatch } from '../ai-schema.js';
import type { GridContext } from './context.js';
import type { Reasoner } from './reasoner.js';
import type { AIMode, Plan } from './types.js';

/** The provider-agnostic request handed to an {@link LLMComplete}. */
export interface LLMRequest {
  /** The user's natural-language utterance. */
  prompt: string;
  /** `'control'` expects a `patch`; `'ask'` expects an `answer`. */
  mode: AIMode;
  /** The grid capability descriptor (columns, capabilities, and live state). */
  schema: GridSchema;
  /** A bounded sample of the current rows, so the answer or patch is grounded. */
  data?: readonly unknown[];
  /** Cooperative cancellation, forwarded from `runPrompt`. */
  signal?: AbortSignal;
}

/** What an {@link LLMComplete} returns: a patch (control) and/or an answer (ask). */
export interface LLMResponse {
  patch?: StatePatch;
  answer?: string;
}

/** Turn an {@link LLMRequest} into an {@link LLMResponse}: the one provider seam. */
export type LLMComplete = (request: LLMRequest) => Promise<LLMResponse>;

/** Options for {@link createLLMReasoner}. */
export interface LLMReasonerOptions {
  /** The model call. Provider-specific transport lives here. */
  complete: LLMComplete;
  /** Reasoner name stamped on plans. Default `'llm'`. */
  name?: string;
  /**
   * Triage score in `[0, 1]` the Router uses to pick this reasoner. Default `0.6`:
   * high enough to win escalation when the rule engine is unsure, low enough that a
   * confident rule plan still wins under the `highest-score` policy.
   */
  score?: number;
  /** Confidence stamped on a plan that produced a change / answer. Default `0.9`. */
  planConfidence?: number;
}

const DEFAULT_SCORE = 0.6;
const DEFAULT_PLAN_CONFIDENCE = 0.9;
/** A plan the model returned empty: low enough that `llm-first` falls back to the rule engine. */
const EMPTY_CONFIDENCE = 0.2;

/** A light heuristic for auto mode: does the utterance read as a question? */
function looksLikeQuestion(utterance: string): boolean {
  const text = utterance.trim();
  if (text.endsWith('?')) return true;
  return /^(who|what|when|where|why|how|which|is|are|does|do|did|can|could|should|would|list|count|tell me|show me)\b/i.test(
    text
  );
}

function isNonEmptyPatch(patch: StatePatch): boolean {
  return Object.keys(patch).length > 0;
}

/**
 * A {@link Reasoner} backed by a model-completion function. Stateless: it holds the
 * `complete` transport and its triage/confidence constants, and builds a fresh plan
 * per call.
 */
class LLMReasoner implements Reasoner {
  readonly name: string;
  readonly #complete: LLMComplete;
  readonly #score: number;
  readonly #planConfidence: number;

  constructor(options: LLMReasonerOptions) {
    this.name = options.name ?? 'llm';
    this.#complete = options.complete;
    this.#score = options.score ?? DEFAULT_SCORE;
    this.#planConfidence = options.planConfidence ?? DEFAULT_PLAN_CONFIDENCE;
  }

  score(): number {
    return this.#score;
  }

  async reason(utterance: string, ctx: GridContext): Promise<Plan> {
    const mode: AIMode = ctx.requestedMode ?? (looksLikeQuestion(utterance) ? 'ask' : 'control');
    const response = await this.#complete({
      prompt: utterance,
      mode,
      schema: ctx.schema,
      data: ctx.data.sample,
      signal: ctx.signal,
    });

    if (mode === 'ask') {
      const answer = (response.answer ?? '').trim();
      return {
        mode: 'ask',
        steps: [],
        answer,
        confidence: answer ? this.#planConfidence : EMPTY_CONFIDENCE,
        source: this.name,
        notes: answer ? undefined : ['The model returned no answer.'],
      };
    }

    const patch = response.patch ?? {};
    const hasChange = isNonEmptyPatch(patch);
    return {
      mode: 'control',
      steps: hasChange
        ? [{ tool: 'applyState', args: { patch }, rationale: 'Model-proposed view-state patch.' }]
        : [],
      confidence: hasChange ? this.#planConfidence : EMPTY_CONFIDENCE,
      source: this.name,
      notes: hasChange ? undefined : ['The model proposed no change.'],
    };
  }
}

/**
 * Adapt any model-completion function into a {@link Reasoner}. The returned reasoner
 * escalates naturally under the default `rule-first` router: the deterministic rule
 * engine handles what it can, and only unmapped prompts reach the model.
 *
 * @example A custom provider
 * ```ts
 * grid.aiReasoner = createLLMReasoner({
 *   name: 'llm:acme',
 *   async complete({ prompt, mode, schema, data }) {
 *     const out = await myModel(prompt, { schema, data, mode });
 *     return mode === 'ask' ? { answer: out.text } : { patch: out.patch };
 *   },
 * });
 * ```
 */
export function createLLMReasoner(options: LLMReasonerOptions): Reasoner {
  return new LLMReasoner(options);
}
