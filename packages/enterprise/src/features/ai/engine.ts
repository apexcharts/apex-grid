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
import type { ConversationTurn, Memory } from './memory.js';
import { ConversationMemory } from './memory.js';
import type { Reasoner } from './reasoner.js';
import { createRuleBasedReasoner } from './reasoner.js';
import type { Router, RoutingPolicy } from './router.js';
import { createRouter, DEFAULT_ROUTING_THRESHOLD } from './router.js';
import { createDefaultRegistry, groundQuestion } from './tools/builtins.js';
import type { ToolExecutor, ToolRegistry } from './tools/registry.js';
import { createToolExecutor } from './tools/registry.js';
import type { AIMode, Plan, ResolvedEntities } from './types.js';

/** Options for {@link AIEngine.runPrompt} / {@link AIEngine.previewPrompt}. */
export interface RunPromptOptions {
  /** Force ask (read-only) mode even if the reasoner planned a control action. */
  mode?: AIMode;
  /**
   * Cooperative cancellation, forwarded to any LLM reasoner. Once aborted the
   * call rejects with the signal's reason (an `AbortError` by default) before it
   * runs a plan or records a turn, even when a reasoner ignored the signal.
   */
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
      /**
       * Restore the pre-prompt snapshot. Idempotent. Taking back the newest change
       * is recorded in memory like an "undo" prompt, so a following "undo" steps
       * further back.
       */
      undo: () => void;
    }
  | {
      mode: 'ask';
      plan: Plan;
      answer: string;
      /**
       * True when the pipeline could neither map an action nor ground a real answer
       * (including a question the rule engine cannot compute, a reasoner answer under
       * the routing `threshold`, and a read-only step that was refused): an honest
       * "I could not do that" rather than a silent no-op or a guess. The `answer`
       * holds a plain-text note; the host UI should show a localized abstention
       * message.
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
  /**
   * Escalation threshold for `rule-first` / `llm-first`, and the floor under which
   * a reasoner's own text answer abstains. Answers the tools compute are kept
   * whatever the threshold. Default `0.5`.
   */
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

/**
 * Collect the column keys one tool's args reference: the rule tools' shapes (`by`,
 * `where`, `columns`, `on`, `aggregations`), an `analyze` query (`column`, `groupBy`,
 * `where`), and an `applyState` patch (`sort`, `filter`, `columns`, and the enterprise
 * `groupBy` / `pivotOn` / `aggregations`).
 */
function collectColumns(args: Record<string, unknown>, out: string[]): void {
  for (const field of ['by', 'where', 'columns', 'sort', 'filter', 'groupBy']) {
    const list = args[field];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (typeof entry === 'string') out.push(entry);
      else if (isRecord(entry) && typeof entry.key === 'string') out.push(entry.key);
    }
  }
  for (const field of ['on', 'column', 'groupBy', 'pivotOn']) {
    const value = args[field];
    if (typeof value === 'string') out.push(value);
  }
  if (isRecord(args.aggregations)) out.push(...Object.keys(args.aggregations));
  for (const nested of [
    args.query,
    args.patch,
    isRecord(args.modules) && args.modules.enterprise,
  ]) {
    if (isRecord(nested)) collectColumns(nested, out);
  }
}

/** Collect the column keys a plan referenced, so memory can resolve later anaphora. */
function entitiesFromPlan(plan: Plan): ResolvedEntities | undefined {
  const columns: string[] = [];
  for (const step of plan.steps) collectColumns(step.args, columns);
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
  const threshold = options.threshold ?? DEFAULT_ROUTING_THRESHOLD;
  const router = createRouter({ policy: options.policy, threshold });
  const now = options.now ?? (() => Date.now());
  const defaultMaxRows = options.maxDataRows;

  /**
   * Build the context and route the prompt. A cancelled call rejects on entry and
   * again once routing settles, so a reasoner that ignored the signal still never
   * gets its plan run or recorded.
   */
  async function route(prompt: string, opts: RunPromptOptions) {
    opts.signal?.throwIfAborted();
    const ctx = contextBuilder.build(api, memory, {
      now: now(),
      maxDataRows: opts.maxDataRows ?? defaultMaxRows,
      requestedMode: opts.mode,
      signal: opts.signal,
    });
    const plan = await router.route(prompt, ctx, reasoners);
    opts.signal?.throwIfAborted();
    return { ctx, plan };
  }

  return {
    api,
    contextBuilder,
    memory,
    registry,
    executor,
    reasoners,
    router,

    async runPrompt(prompt, opts = {}): Promise<AIResult> {
      const { ctx, plan } = await route(prompt, opts);
      const tc = { api, ctx };

      if (opts.mode === 'ask' || plan.mode === 'ask') {
        // Ask mode is strictly read-only. Prefer a reasoner-provided answer; else run
        // the routed plan when every step is a read-only tool (e.g. `analyze`/`answer`);
        // else fall back to the read-only `answer` tool over the prompt. A control plan
        // forced into ask can never run its mutating steps here.
        const answer = plan.answer ?? '';
        const answered = answer !== '';
        const readOnly =
          plan.steps.length > 0 &&
          plan.steps.every((step) => registry.get(step.tool)?.readOnly === true);
        const fallback = !answered && !readOnly;
        // Abstain rather than present a view summary or a hint as the answer. A
        // reasoner's own answer must clear the threshold and be more than the plan's
        // note (a measure that did not resolve). Computed steps answer whatever the
        // threshold, except an `answer` step on a question the answer tool cannot
        // ground; the fallback grounds the prompt the same way.
        const grounds = (question: unknown) =>
          typeof question !== 'string' || groundQuestion(question, ctx.columns) !== null;
        const grounded = answered
          ? plan.confidence >= threshold && !plan.notes?.includes(answer)
          : readOnly
            ? plan.steps.every((step) => step.tool !== 'answer' || grounds(step.args.question))
            : grounds(prompt);
        if (!grounded) {
          // A control plan forced into ask is reported without its mutating steps.
          const abstainPlan: Plan = fallback ? { ...plan, mode: 'ask', steps: [] } : plan;
          memory.record({ utterance: prompt, plan: abstainPlan, outcome: 'no-op', at: ctx.now });
          return {
            mode: 'ask',
            plan: abstainPlan,
            answer: answer || plan.notes?.[0] || '',
            abstained: true,
          };
        }
        if (answered) {
          memory.record({
            utterance: prompt,
            plan,
            outcome: 'answered',
            entities: entitiesFromPlan(plan),
            at: ctx.now,
          });
          return { mode: 'ask', plan, answer };
        }
        const askPlan: Plan = fallback
          ? {
              mode: 'ask',
              steps: [{ tool: 'answer', args: { question: prompt } }],
              confidence: plan.confidence,
              source: plan.source,
            }
          : plan;
        const exec = executor.run(askPlan, tc);
        // No answer means every step was refused (a malformed analyze query): say why.
        const refused = !exec.answer && exec.warnings.length > 0;
        memory.record({
          utterance: prompt,
          plan: askPlan,
          outcome: refused ? 'no-op' : 'answered',
          entities: entitiesFromPlan(askPlan),
          at: ctx.now,
        });
        return refused
          ? { mode: 'ask', plan: askPlan, answer: exec.warnings[0], abstained: true }
          : { mode: 'ask', plan: askPlan, answer: exec.answer ?? '' };
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
      const applied = exec.applied.length > 0;
      // A turn that only undid is a revert, so the next "undo" steps further back. A
      // turn that also changed something ("undo and group by region") is an ordinary
      // change, so the next "undo" takes the whole turn back.
      const reverts = exec.applied.length > 0 && exec.applied.every((step) => step === 'undo');
      const turn: ConversationTurn = {
        utterance: prompt,
        plan,
        outcome: applied ? 'applied' : 'no-op',
        stateBefore: before,
        stateAfter: api.getState(),
        entities: entitiesFromPlan(plan),
        at: ctx.now,
        reverts: reverts || undefined,
      };
      memory.record(turn);
      let undone = false;
      return {
        mode: 'control',
        plan,
        applied: exec.applied,
        skipped: exec.skipped,
        warnings,
        undo: () => {
          if (undone) return;
          undone = true;
          const stateBefore = api.getState();
          exec.undo();
          // Undoing the newest change is recorded like an "undo" prompt, and undoing
          // an undo as a redo the next "undo" takes back. An older turn's undo only
          // restores its slices: the next "undo" still takes back the newest change.
          const { turns } = memory.snapshot();
          let newest: ConversationTurn | undefined;
          for (let i = turns.length - 1; i >= 0 && !newest; i--) {
            if (turns[i].outcome === 'applied') newest = turns[i];
          }
          if (applied && newest === turn) {
            memory.record({
              utterance: prompt,
              outcome: 'applied',
              stateBefore,
              stateAfter: api.getState(),
              at: now(),
              reverts: !reverts || undefined,
            });
          }
        },
      };
    },

    async previewPrompt(prompt, opts = {}): Promise<Plan> {
      return (await route(prompt, opts)).plan;
    },
  };
}
