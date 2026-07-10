/**
 * Tool Registry and Tool Executor.
 *
 * The registry is the operation catalog: each {@link Tool} wraps one grid
 * operation with the metadata a planner (and, later, an LLM) needs (name,
 * description, an argument JSON Schema, a validator, and an executor that returns
 * its own inverse). The {@link ToolExecutor} runs a {@link Plan} step by step,
 * validating each step's arguments, aggregating the outcomes, and composing a
 * single LIFO undo. Both are grid-agnostic: they act only through {@link GridApi}
 * (carried on {@link ToolContext}), so they are unit-testable with a fake grid.
 *
 * @see plans/ai-reasoning-layer-spec.md (section 4.7)
 */

import type { JSONSchema } from '../../ai-schema.js';
import type { GridContext } from '../context.js';
import type { GridApi } from '../grid-api.js';
import type { Plan } from '../types.js';

/** What a {@link Tool.execute} receives: the grid boundary plus the reasoning context. */
export interface ToolContext<T = unknown> {
  api: GridApi<T>;
  ctx: GridContext<T>;
}

/** The result of running one tool: what changed, any notes, an optional answer, and its inverse. */
export interface ToolOutcome {
  applied: string[];
  skipped?: string[];
  warnings?: string[];
  /** Set by read-only tools (e.g. `answer`). */
  answer?: string;
  /** Restores the state this tool changed. A no-op for read-only / side-effect tools. */
  undo: () => void;
}

/** The outcome of validating a tool's raw arguments. */
export type ToolValidation<A> = { ok: true; value: A } | { ok: false; errors: string[] };

/**
 * One registered operation. `A` is the validated argument shape; built-ins type it
 * precisely and the registry stores tools type-erased.
 */
export interface Tool<A = Record<string, unknown>> {
  name: string;
  description: string;
  /** JSON Schema for the arguments (metadata; drives LLM tool definitions later). */
  parameters: JSONSchema;
  /** True if the tool never mutates the grid (answer / analyze). Ask mode runs only these. */
  readOnly?: boolean;
  /** Capability gate: is this operation possible for the current grid? */
  available(ctx: GridContext): boolean;
  /** Turn raw (untrusted) arguments into a typed value, or a list of errors. */
  validate(args: unknown, ctx: GridContext): ToolValidation<A>;
  /** Perform the operation through the grid boundary and return its inverse. */
  execute(args: A, tc: ToolContext): ToolOutcome;
}

/** An LLM-facing tool definition (the generalization of `toJSONSchema`). */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: JSONSchema;
}

/** The catalog: register operations, look them up, and enumerate the available ones. */
export interface ToolRegistry {
  register<A>(tool: Tool<A>): void;
  get(name: string): Tool | undefined;
  /** Only the tools currently available for the given context. */
  list(ctx: GridContext): Tool[];
  /** Tool definitions for the available tools (for an LLM reasoner). */
  toToolDefinitions(ctx: GridContext): ToolDefinition[];
}

/** The aggregated result of executing a whole plan. */
export interface ExecutionResult {
  outcomes: ToolOutcome[];
  applied: string[];
  skipped: string[];
  warnings: string[];
  answer?: string;
  /** Undo every step's change, most-recent-first. Idempotent. */
  undo(): void;
}

/** Runs a {@link Plan} against a {@link ToolContext} using a {@link ToolRegistry}. */
export interface ToolExecutor {
  run(plan: Plan, tc: ToolContext): ExecutionResult;
}

class DefaultToolRegistry implements ToolRegistry {
  readonly #tools = new Map<string, Tool>();

  register<A>(tool: Tool<A>): void {
    this.#tools.set(tool.name, tool as unknown as Tool);
  }

  get(name: string): Tool | undefined {
    return this.#tools.get(name);
  }

  list(ctx: GridContext): Tool[] {
    const out: Tool[] = [];
    for (const tool of this.#tools.values()) {
      if (tool.available(ctx)) out.push(tool);
    }
    return out;
  }

  toToolDefinitions(ctx: GridContext): ToolDefinition[] {
    return this.list(ctx).map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }
}

/** Create an empty {@link ToolRegistry}. */
export function createToolRegistry(): ToolRegistry {
  return new DefaultToolRegistry();
}

class DefaultToolExecutor implements ToolExecutor {
  readonly #registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.#registry = registry;
  }

  run(plan: Plan, tc: ToolContext): ExecutionResult {
    const outcomes: ToolOutcome[] = [];
    const undos: Array<() => void> = [];
    const applied: string[] = [];
    const skipped: string[] = [];
    const warnings: string[] = [];
    const answers: string[] = [];

    for (const step of plan.steps) {
      const tool = this.#registry.get(step.tool);
      if (!tool) {
        warnings.push(`unknown tool "${step.tool}", skipped`);
        continue;
      }
      if (!tool.available(tc.ctx)) {
        warnings.push(`tool "${step.tool}" is not available here, skipped`);
        continue;
      }
      const validation = tool.validate(step.args, tc.ctx);
      if (!validation.ok) {
        warnings.push(...validation.errors);
        continue;
      }
      const outcome = tool.execute(validation.value, tc);
      outcomes.push(outcome);
      undos.push(outcome.undo);
      applied.push(...outcome.applied);
      if (outcome.skipped) skipped.push(...outcome.skipped);
      if (outcome.warnings) warnings.push(...outcome.warnings);
      if (outcome.answer !== undefined && outcome.answer !== '') answers.push(outcome.answer);
    }

    let undone = false;
    const undo = () => {
      if (undone) return;
      undone = true;
      for (let i = undos.length - 1; i >= 0; i--) undos[i]();
    };

    return {
      outcomes,
      applied,
      skipped,
      warnings,
      answer: answers.length > 0 ? answers.join('\n') : undefined,
      undo,
    };
  }
}

/** Create a {@link ToolExecutor} bound to a registry. */
export function createToolExecutor(registry: ToolRegistry): ToolExecutor {
  return new DefaultToolExecutor(registry);
}
