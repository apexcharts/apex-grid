/**
 * Router: pick which {@link Reasoner} handles an utterance.
 *
 * The default policy is `rule-first`: run the rule reasoner; if its plan is
 * confident enough (at or above the threshold) or no other reasoner is registered,
 * keep it; otherwise escalate to the highest-scoring other reasoner (an LLM, when
 * one is added in P4). With only the rule reasoner present this degrades cleanly to
 * rule-only, which is the no-LLM default.
 *
 * @see plans/ai-reasoning-layer-spec.md (section 4.8)
 */

import type { GridContext } from './context.js';
import type { Reasoner } from './reasoner.js';
import type { Plan } from './types.js';

export type RoutingPolicy = 'rule-only' | 'llm-only' | 'rule-first' | 'llm-first' | 'highest-score';

/** Chooses a reasoner and returns its plan. */
export interface Router {
  route(utterance: string, ctx: GridContext, reasoners: Reasoner[]): Promise<Plan>;
}

/** Options for {@link createRouter}. */
export interface RouterOptions {
  /** Default `'rule-first'`. */
  policy?: RoutingPolicy;
  /** Rule-plan confidence at/above which the router does NOT escalate. Default `0.5`. */
  threshold?: number;
}

const NO_REASONER: Plan = {
  mode: 'control',
  steps: [],
  confidence: 0,
  source: 'none',
  notes: ['No reasoner is configured.'],
};

/** Highest-scoring reasoner with a positive score, or undefined. */
function bestByScore(
  reasoners: Reasoner[],
  utterance: string,
  ctx: GridContext
): Reasoner | undefined {
  let best: { reasoner: Reasoner; score: number } | undefined;
  for (const reasoner of reasoners) {
    const score = reasoner.score(utterance, ctx);
    if (score > 0 && (!best || score > best.score)) best = { reasoner, score };
  }
  return best?.reasoner;
}

class DefaultRouter implements Router {
  readonly #policy: RoutingPolicy;
  readonly #threshold: number;

  constructor(options: RouterOptions = {}) {
    this.#policy = options.policy ?? 'rule-first';
    this.#threshold = options.threshold ?? 0.5;
  }

  async route(utterance: string, ctx: GridContext, reasoners: Reasoner[]): Promise<Plan> {
    const rule = reasoners.find((r) => r.name === 'rule');
    const others = reasoners.filter((r) => r.name !== 'rule');

    switch (this.#policy) {
      case 'rule-only':
        return rule ? rule.reason(utterance, ctx) : NO_REASONER;

      case 'llm-only': {
        const llm = bestByScore(others, utterance, ctx);
        if (llm) return llm.reason(utterance, ctx);
        return rule ? rule.reason(utterance, ctx) : NO_REASONER;
      }

      case 'highest-score': {
        const best = bestByScore(reasoners, utterance, ctx);
        return best ? best.reason(utterance, ctx) : NO_REASONER;
      }

      case 'llm-first': {
        const llm = bestByScore(others, utterance, ctx);
        if (llm) {
          const plan = await llm.reason(utterance, ctx);
          if (plan.confidence >= this.#threshold || !rule) return plan;
        }
        return rule ? rule.reason(utterance, ctx) : NO_REASONER;
      }

      default: {
        // 'rule-first'
        if (!rule) {
          const best = bestByScore(reasoners, utterance, ctx);
          return best ? best.reason(utterance, ctx) : NO_REASONER;
        }
        const plan = await rule.reason(utterance, ctx);
        if (plan.confidence >= this.#threshold || others.length === 0) return plan;
        const llm = bestByScore(others, utterance, ctx);
        return llm ? llm.reason(utterance, ctx) : plan;
      }
    }
  }
}

/** Create the default {@link Router}. */
export function createRouter(options?: RouterOptions): Router {
  return new DefaultRouter(options);
}
