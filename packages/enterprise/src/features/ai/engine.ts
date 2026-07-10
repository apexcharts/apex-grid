/**
 * The AI engine: the wired pipeline and the orchestrator behind `grid.runPrompt`.
 *
 * `createAIEngine(api)` bundles the default rule reasoner, the tool registry +
 * executor, an in-memory {@link Memory}, a {@link ContextBuilder}, and a rule-first
 * {@link Router}. `runPrompt` builds the context, routes to a reasoner, executes the
 * resulting {@link Plan} through the tools, records the turn to memory (so the next
 * turn can resolve "it"/"the other way"/"undo"), and returns a clean {@link AIResult}
 * (control: applied + warnings + undo; ask: answer). `previewPrompt` is a dry-run:
 * it builds the plan without executing it. Push an LLM reasoner (P4) to go hybrid.
 *
 * @see plans/ai-reasoning-layer-spec.md (section 4.9)
 */

import type { ContextBuilder } from './context.js';
import { createContextBuilder } from './context.js';
import type { GridApi } from './grid-api.js';
import type { Memory } from './memory.js';
import { ConversationMemory } from './memory.js';
import type { Reasoner } from './reasoner.js';
import { createRuleBasedReasoner } from './reasoner.js';
import type { Router, RoutingPolicy } from './router.js';
import { createRouter } from './router.js';
import { createDefaultRegistry } from './tools/builtins.js';
import type { ToolExecutor, ToolRegistry } from './tools/registry.js';
import { createToolExecutor } from './tools/registry.js';
import type { AIMode, Plan, ResolvedEntities } from './types.js';

/** Options for {@link AIEngine.runPrompt} / {@link AIEngine.previewPrompt}. */
export interface RunPromptOptions {
  /** Force ask (read-only) mode even if the reasoner planned a control action. */
  mode?: AIMode;
  /** Cooperative cancellation (forwarded to any LLM reasoner). */
  signal?: AbortSignal;
  /** Override the rows sampled into context for this call. */
  maxDataRows?: number;
}

/** The outcome of a {@link AIEngine.runPrompt} call: a discriminated union by `mode`. */
export type AIResult =
  | {
      mode: 'control';
      /** The plan that was executed (inspectable). */
      plan: Plan;
      /** Human-readable descriptions of what was applied. */
      applied: string[];
      /** Slices present but not applied. */
      skipped: string[];
      /** Reasoner notes plus per-tool warnings, merged. */
      warnings: string[];
      /** Restore the pre-prompt snapshot. Idempotent. */
      undo: () => void;
    }
  | {
      mode: 'ask';
      plan: Plan;
      answer: string;
      /**
       * True when the pipeline could neither map an action nor ground a real answer:
       * an honest "I could not do that" rather than a silent no-op. The `answer` holds
       * a plain-text note; the host UI should show a localized abstention message.
       */
      abstained?: boolean;
    };

/** The wired pipeline. Fields are exposed so a host can inspect or swap parts. */
export interface AIEngine<T = unknown> {
  api: GridApi<T>;
  contextBuilder: ContextBuilder<T>;
  memory: Memory;
  registry: ToolRegistry;
  executor: ToolExecutor;
  reasoners: Reasoner[];
  router: Router;
  runPrompt(prompt: string, options?: RunPromptOptions): Promise<AIResult>;
  previewPrompt(prompt: string, options?: RunPromptOptions): Promise<Plan>;
}

/** Options for {@link createAIEngine}. */
export interface CreateAIEngineOptions {
  /** Reasoners in priority order. Defaults to `[rule]`; push an LLM reasoner to go hybrid. */
  reasoners?: Reasoner[];
  /** Routing policy. Default `'rule-first'`. */
  policy?: RoutingPolicy;
  /** Escalation threshold for `rule-first` / `llm-first`. Default `0.5`. */
  threshold?: number;
  /** Conversation + grid-state memory. Defaults to a bounded in-memory store. */
  memory?: Memory;
  /** Tool registry. Defaults to the built-in catalog. */
  registry?: ToolRegistry;
  /** Rows sampled into context by default. */
  maxDataRows?: number;
  /** Injected clock; defaults to `Date.now`. The pure components never read time themselves. */
  now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Collect the column keys a plan referenced, so memory can resolve later anaphora. */
function entitiesFromPlan(plan: Plan): ResolvedEntities | undefined {
  const columns: string[] = [];
  for (const step of plan.steps) {
    const args = step.args;
    const by = args.by;
    if (Array.isArray(by)) {
      for (const entry of by) {
        if (typeof entry === 'string') columns.push(entry);
        else if (isRecord(entry) && typeof entry.key === 'string') columns.push(entry.key);
      }
    }
    for (const field of ['where', 'columns'] as const) {
      const list = args[field];
      if (Array.isArray(list)) {
        for (const entry of list)
          if (isRecord(entry) && typeof entry.key === 'string') columns.push(entry.key);
      }
    }
    if (typeof args.on === 'string') columns.push(args.on);
    if (isRecord(args.aggregations)) columns.push(...Object.keys(args.aggregations));
  }
  return columns.length > 0 ? { columns: [...new Set(columns)] } : undefined;
}

/** Build a fully wired {@link AIEngine} over a {@link GridApi}. */
export function createAIEngine<T = unknown>(
  api: GridApi<T>,
  options: CreateAIEngineOptions = {}
): AIEngine<T> {
  const contextBuilder = createContextBuilder<T>();
  const memory = options.memory ?? new ConversationMemory();
  const registry = options.registry ?? createDefaultRegistry();
  const executor = createToolExecutor(registry);
  const reasoners = options.reasoners ?? [createRuleBasedReasoner()];
  const router = createRouter({ policy: options.policy, threshold: options.threshold });
  const now = options.now ?? (() => Date.now());
  const defaultMaxRows = options.maxDataRows;

  return {
    api,
    contextBuilder,
    memory,
    registry,
    executor,
    reasoners,
    router,

    async runPrompt(prompt, opts = {}): Promise<AIResult> {
      const ctx = contextBuilder.build(api, memory, {
        now: now(),
        maxDataRows: opts.maxDataRows ?? defaultMaxRows,
        requestedMode: opts.mode,
        signal: opts.signal,
      });
      const plan = await router.route(prompt, ctx, reasoners);
      const tc = { api, ctx };

      if (opts.mode === 'ask' || plan.mode === 'ask') {
        // Ask mode is strictly read-only. Prefer a reasoner-provided answer; else run
        // the routed plan when every step is a read-only tool (e.g. `analyze`/`answer`);
        // else fall back to the read-only `answer` tool over the prompt. A control plan
        // forced into ask can never run its mutating steps here.
        if (plan.answer !== undefined && plan.answer !== '') {
          memory.record({ utterance: prompt, plan, outcome: 'answered', at: ctx.now });
          return { mode: 'ask', plan, answer: plan.answer };
        }
        const readOnly =
          plan.steps.length > 0 &&
          plan.steps.every((step) => registry.get(step.tool)?.readOnly === true);
        const askPlan: Plan = readOnly
          ? plan
          : {
              mode: 'ask',
              steps: [{ tool: 'answer', args: { question: prompt } }],
              confidence: plan.confidence,
              source: plan.source,
            };
        const exec = executor.run(askPlan, tc);
        memory.record({ utterance: prompt, plan: askPlan, outcome: 'answered', at: ctx.now });
        return { mode: 'ask', plan: askPlan, answer: exec.answer ?? '' };
      }

      // Abstention: a control-mode plan with no steps means the reasoner (and any LLM
      // it escalated to) could not map the prompt to an action. Report that honestly
      // instead of a silent "nothing applied", so the host can guide the user. The
      // plan's note (if any) is carried as plain text; the UI localizes the headline.
      if (plan.steps.length === 0) {
        memory.record({ utterance: prompt, plan, outcome: 'no-op', at: ctx.now });
        return { mode: 'ask', plan, answer: plan.notes?.[0] ?? '', abstained: true };
      }

      const before = api.getState();
      const exec = executor.run(plan, tc);
      const warnings = [...(plan.notes ?? []), ...exec.warnings];
      memory.record({
        utterance: prompt,
        plan,
        outcome: exec.applied.length > 0 ? 'applied' : 'no-op',
        stateBefore: before,
        stateAfter: api.getState(),
        entities: entitiesFromPlan(plan),
        at: ctx.now,
      });
      return {
        mode: 'control',
        plan,
        applied: exec.applied,
        skipped: exec.skipped,
        warnings,
        undo: exec.undo,
      };
    },

    previewPrompt(prompt, opts = {}): Promise<Plan> {
      const ctx = contextBuilder.build(api, memory, {
        now: now(),
        maxDataRows: opts.maxDataRows ?? defaultMaxRows,
        requestedMode: opts.mode,
        signal: opts.signal,
      });
      return router.route(prompt, ctx, reasoners);
    },
  };
}
