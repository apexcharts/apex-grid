/**
 * The LLM reasoner bridge: adapt any "complete a prompt" function into a
 * {@link Reasoner}, so an LLM can join the pipeline as an escalation target.
 *
 * A reasoner turns an utterance into a {@link Plan}. This one delegates to a model
 * (through the injected {@link LLMComplete}) and wraps the result: a control
 * response (a view-state patch) becomes a single `applyState` step, which is
 * sanitized, applied, and made undoable exactly like every other tool; an ask
 * response becomes a plan carrying the text answer. The mode comes from the
 * engine's request hint (`ctx.requestedMode`), falling back to the rule engine's
 * own question test when the caller did not force one. The model call itself is
 * provider-agnostic: {@link createClaudeReasoner} builds a Claude-backed
 * `complete`, or pass your own for any other provider.
 *
 * This bridge is the one egress point every provider goes through, so it decides
 * what row data leaves the page: each sampled row is copied onto the visible
 * schema columns only (fields that are not columns, and hidden columns, are never
 * sent; under an active pivot, the source fields the pivot displays), and the
 * number of loaded rows travels with the sample.
 *
 * @see plans/ai-reasoning-layer-spec.md (section 4.8)
 */

import type { GridSchema, GridState } from 'apex-grid';
import type { StatePatch } from '../ai-schema.js';
import type { GridContext } from './context.js';
import { isQuestion } from './intent.js';
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
  /**
   * A bounded sample of the current rows, so the answer or patch is grounded. Each
   * row is a fresh plain object holding only the visible schema columns' values:
   * fields that are not grid columns, and hidden columns, are never included. While
   * a pivot is active the schema columns are the pivot's synthetic columns, so the
   * source rows keep the pivot's row, column, and value fields instead.
   */
  data?: readonly unknown[];
  /**
   * The number of rows loaded in the grid. `data` holds at most this many and fewer
   * when the sample was cut, so an answer can say it covers only the first N of
   * this. A server-backed row model (infinite or server-side) counts only the rows
   * it has loaded; the server may hold more.
   */
  rowCount?: number;
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

function isNonEmptyPatch(patch: StatePatch): boolean {
  return Object.keys(patch).length > 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list.filter((entry): entry is string => typeof entry === 'string' && entry !== '');
}

/**
 * The source fields an active pivot displays: its row dimensions, column
 * dimensions, and measures. While pivoting, the schema columns are the pivot's
 * synthetic columns but the sample is still the source rows, so these are the keys
 * that carry what the user sees. Empty when no pivot is active (the grid pivots
 * only when all three are set).
 */
function pivotFields(state: GridState | undefined): string[] {
  const blob = state?.modules?.enterprise;
  if (!isPlainRecord(blob)) return [];
  const rows = stringList(blob.pivotRows ?? []);
  const on = stringList(blob.pivotOn ?? []);
  const values = isPlainRecord(blob.pivotValues) ? Object.keys(blob.pivotValues) : [];
  return rows.length && on.length && values.length ? [...rows, ...on, ...values] : [];
}

/**
 * Copy each row onto the visible columns' keys (plus an active pivot's source
 * fields), into fresh plain objects, so only values the user can see in the grid
 * reach a model.
 */
function projectRows(rows: readonly unknown[], schema: GridSchema): Record<string, unknown>[] {
  const keys = new Set(
    schema.columns.filter((column) => !column.hidden).map((column) => column.key)
  );
  for (const field of pivotFields(schema.state)) keys.add(field);
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    if (typeof row !== 'object' || row === null) return out;
    for (const key of keys) if (key in row) out[key] = (row as Record<string, unknown>)[key];
    return out;
  });
}

/**
 * Check the {@link LLMResponse} contract: `answer` a string and `patch` an object
 * when present (`null` reads as absent). A transport that returns anything else
 * fails with a clear error instead of an opaque one further down.
 */
function checkResponse(response: unknown): LLMResponse {
  const valid =
    isPlainRecord(response) &&
    (response.answer == null || typeof response.answer === 'string') &&
    (response.patch == null || isPlainRecord(response.patch));
  if (!valid) {
    throw new Error(
      'apex-grid AI: the model returned an invalid response; expected { answer?: string, patch?: object }.'
    );
  }
  return {
    answer: (response.answer ?? undefined) as string | undefined,
    patch: (response.patch ?? undefined) as StatePatch | undefined,
  };
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
    const mode: AIMode = ctx.requestedMode ?? (isQuestion(utterance) ? 'ask' : 'control');
    const response = checkResponse(
      await this.#complete({
        prompt: utterance,
        mode,
        schema: ctx.schema,
        data: projectRows(ctx.data.sample, ctx.schema),
        rowCount: ctx.data.rowCount,
        signal: ctx.signal,
      })
    );

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
 * `complete` receives the context's row sample projected onto the visible columns
 * (fresh plain objects; fields that are not columns and hidden columns are left
 * out) plus `rowCount`, the number of rows loaded in the grid. Its response must hold `answer` as a string and
 * `patch` as an object when present; anything else rejects with a clear error.
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
