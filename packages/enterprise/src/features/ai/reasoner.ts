/**
 * The Reasoner seam: the one interface an LLM later implements. A reasoner turns an
 * utterance plus a {@link GridContext} into a {@link Plan}. {@link RuleBasedReasoner}
 * is the default, LLM-free reasoner: it composes intent detection, entity
 * resolution, and planning. Its `score` is the detector's confidence, which the
 * Router (P3) uses to decide whether to escalate to an LLM reasoner.
 *
 * @see plans/ai-reasoning-layer-spec.md (section 4.8)
 */

import type { GridContext } from './context.js';
import { createEntityResolver, type EntityResolver } from './entities.js';
import { createIntentDetector, type IntentDetector } from './intent.js';
import { createRulePlanner, type Planner } from './planner.js';
import type { Plan, PlanStep } from './types.js';

/** Verbs that begin a grid command; a clause boundary only splits before one of these. */
const COMMAND_LEAD =
  /^(?:sort|order|group|ungroup|pivot|filter|where|only\s+show|show\s+only|remove|exclude|drop|get\s+rid\s+of|keep|include\s+only|retain|hide|show|unhide|pin|freeze|unpin|search|find|quick\s*filter|reset|clear|undo|revert|go\s+to\s+page|page|export|download|select|deselect)\b/i;

/** Connectives, longest-first, that MAY separate two commands. */
const CLAUSE_SPLIT = /(,\s*then\s+|\s+and\s+then\s+|\s+then\s+|;\s*|,\s+|\s+and\s+)/i;

/**
 * Split a compound utterance into command clauses. A connective only starts a new
 * clause when the fragment after it begins with a command verb, so "sort by region and
 * product" stays one clause (two sort columns) while "sort by X and remove rows..."
 * splits into two. Exported for testing.
 */
export function segmentClauses(utterance: string): string[] {
  const parts = utterance.trim().split(CLAUSE_SPLIT);
  const clauses: string[] = [];
  let current = parts[0] ?? '';
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const delimiter = parts[i];
    const fragment = parts[i + 1];
    if (COMMAND_LEAD.test(fragment.trim())) {
      if (current.trim()) clauses.push(current.trim());
      current = fragment;
    } else {
      current = `${current}${delimiter}${fragment}`;
    }
  }
  if (current.trim()) clauses.push(current.trim());
  return clauses;
}

/** Produces a {@link Plan} from an utterance. The pluggable brain of the pipeline. */
export interface Reasoner {
  /** Provenance stamped on plans, e.g. `'rule'` or `'llm:claude'`. */
  readonly name: string;
  /** Cheap triage in `[0, 1]` the Router uses to choose a reasoner. 0 = cannot handle. */
  score(utterance: string, ctx: GridContext): number;
  /** Produce a plan (control steps or an ask answer). */
  reason(utterance: string, ctx: GridContext): Promise<Plan>;
}

/** Injectable pieces of the {@link RuleBasedReasoner} (all default to the built-ins). */
export interface RuleBasedReasonerDeps {
  detector?: IntentDetector;
  resolver?: EntityResolver;
  planner?: Planner;
}

/**
 * The default, deterministic reasoner: no LLM, no network. Detect the intent,
 * resolve its entities against the schema / memory / live state, and plan the
 * matching tool calls.
 */
export class RuleBasedReasoner implements Reasoner {
  readonly name = 'rule';
  readonly #detector: IntentDetector;
  readonly #resolver: EntityResolver;
  readonly #planner: Planner;

  constructor(deps: RuleBasedReasonerDeps = {}) {
    this.#detector = deps.detector ?? createIntentDetector();
    this.#resolver = deps.resolver ?? createEntityResolver();
    this.#planner = deps.planner ?? createRulePlanner();
  }

  score(utterance: string, ctx: GridContext): number {
    return this.#detector.detect(utterance, ctx).confidence;
  }

  reason(utterance: string, ctx: GridContext): Promise<Plan> {
    const clauses = segmentClauses(utterance);
    const plan =
      clauses.length <= 1
        ? this.#planOne(utterance, ctx)
        : this.#planCompound(utterance, clauses, ctx);
    return Promise.resolve(plan);
  }

  /** Detect -> resolve -> plan for a single command clause. */
  #planOne(clause: string, ctx: GridContext): Plan {
    const intent = this.#detector.detect(clause, ctx);
    const resolved = this.#resolver.resolve(intent, ctx);
    return this.#planner.plan(intent, resolved, ctx);
  }

  /**
   * Plan each clause and merge the control steps into one plan, in order. Clauses that
   * do not map (or read-only questions mixed in) become notes, so a partial compound is
   * reported honestly rather than silently dropped.
   */
  #planCompound(utterance: string, clauses: string[], ctx: GridContext): Plan {
    const steps: PlanStep[] = [];
    const notes: string[] = [];
    let minConfidence = 1;
    let mapped = 0;
    for (const clause of clauses) {
      const plan = this.#planOne(clause, ctx);
      if (plan.mode === 'control' && plan.steps.length > 0) {
        steps.push(...plan.steps);
        minConfidence = Math.min(minConfidence, plan.confidence);
        mapped += 1;
      } else if (plan.mode === 'ask' && plan.steps.length > 0) {
        notes.push(`Ask "${clause}" on its own for an answer.`);
      } else {
        notes.push(
          plan.notes?.[0] ? `"${clause}": ${plan.notes[0]}` : `I could not map "${clause}".`
        );
      }
    }
    // Nothing mapped as a control step: fall back to treating the whole thing as one.
    if (steps.length === 0) return this.#planOne(utterance, ctx);
    return {
      mode: 'control',
      steps,
      confidence: mapped === clauses.length ? minConfidence : minConfidence * 0.8,
      source: 'rule',
      notes: notes.length > 0 ? notes : undefined,
    };
  }
}

/** Create the default rule-based {@link Reasoner}. */
export function createRuleBasedReasoner(deps?: RuleBasedReasonerDeps): RuleBasedReasoner {
  return new RuleBasedReasoner(deps);
}
