/**
 * Shared data contracts that flow through the AI reasoning pipeline
 * (Context to Router to Reasoner to Plan to Executor). Every component imports
 * these from one place, so the rule engine and any future LLM reasoner speak the
 * same vocabulary. Pure types only: no runtime code, no grid dependency.
 *
 * @see plans/ai-reasoning-layer-spec.md
 */

/** Whether a prompt should change the grid (`control`) or answer read-only (`ask`). */
export type AIMode = 'control' | 'ask';

/**
 * The kind of operation an utterance maps to. `ask` is read-only Q&A; `unknown`
 * means the rule engine could not classify it (the Router may then escalate to an
 * LLM reasoner, if one is registered).
 */
export type IntentKind =
  | 'sort'
  | 'filter'
  | 'quick-filter'
  | 'group'
  | 'ungroup'
  | 'pivot'
  | 'aggregate'
  | 'columns'
  | 'select'
  | 'paginate'
  | 'reset'
  | 'undo'
  | 'edit'
  | 'export'
  | 'chart'
  | 'ask'
  | 'analyze'
  | 'unknown';

/** A raw, unresolved span pulled from the utterance (e.g. a column name or a value literal). */
export interface RawSlot {
  /** The matched text, verbatim. */
  text: string;
  /** Character offset of the span in the utterance. */
  start: number;
  /** Character offset just past the span. */
  end: number;
}

/**
 * A classified utterance: an intent kind, a confidence in `[0, 1]`, and the raw
 * spans it carries (resolved to grid vocabulary later, by the EntityResolver).
 */
export interface Intent {
  kind: IntentKind;
  confidence: number;
  slots: Record<string, RawSlot>;
  raw: string;
}

/** One tool invocation in a plan: a registered tool name and its (still unvalidated) arguments. */
export interface PlanStep {
  tool: string;
  args: Record<string, unknown>;
  /** Optional human-readable note, surfaced in a preview. */
  rationale?: string;
}

/**
 * A reasoner's output: an ordered set of tool calls (`control`) or a text answer
 * (`ask`), plus a confidence and the name of the reasoner that produced it. A Plan
 * is fully inspectable, which is what makes `previewPrompt` (dry-run) possible.
 */
export interface Plan {
  mode: 'control' | 'ask';
  /** Control mode: the tool calls to run, in order. Empty for a pure ask plan. */
  steps: PlanStep[];
  /** Ask mode: the text answer (or produced by an `answer` tool at execution time). */
  answer?: string;
  confidence: number;
  /** Provenance: which reasoner produced this, e.g. `'rule'` or `'llm:claude'`. */
  source: string;
  /**
   * Human-readable notes to surface when a plan is empty or partial (e.g. an
   * unresolved column, or "no active sort to reverse"). Merged into warnings on apply.
   */
  notes?: string[];
}

/**
 * Entities carried across conversation turns so anaphora resolves: "sort it the
 * other way", "now filter those", "group by that too".
 */
export interface ResolvedEntities {
  /** Column keys referenced by the last turn. */
  columns?: string[];
  /** Literal values referenced by the last turn. */
  values?: unknown[];
  /** The last turn's intent kind. */
  lastIntent?: IntentKind;
}
