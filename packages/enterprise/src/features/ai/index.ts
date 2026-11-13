/**
 * AI reasoning layer (enterprise).
 *
 * The public surface of the AI layer, re-exported from the package entry: the
 * shared data contracts, the {@link GridApi} boundary, the {@link ContextBuilder},
 * {@link Memory}, the tool registry and executor, the rule engine, the engine and
 * router, and the LLM reasoners. Everything exported here is public API.
 *
 * @see plans/ai-reasoning-layer-spec.md
 */

export { sanitizePatch } from '../ai-sanitize.js';
export type {
  AnalyticsFunc,
  AnalyticsQuery,
  AnalyticsResult,
  MetricValue,
  QueryFilter,
} from './analytics.js';
export { formatAnalyticsAnswer, formatNumber, runAnalytics } from './analytics.js';
export type {
  ContextBuilder,
  ContextBuildOptions,
  GridContext,
} from './context.js';
export { createContextBuilder, DEFAULT_MAX_DATA_ROWS } from './context.js';
// P3 — engine + router
export type {
  AIEngine,
  AIResult,
  CreateAIEngineOptions,
  RunPromptOptions,
} from './engine.js';
export { createAIEngine } from './engine.js';
export type { EntityResolver, ResolveResult } from './entities.js';
export { createEntityResolver } from './entities.js';
export type { ActionResult, GridApi } from './grid-api.js';
export { emptyGridState, gridApiFor } from './grid-api.js';
// P2 — the rule engine
export type { IntentDetector } from './intent.js';
export { createIntentDetector } from './intent.js';
export type {
  ConversationMemoryOptions,
  ConversationTurn,
  Memory,
  MemorySnapshot,
} from './memory.js';
export { ConversationMemory } from './memory.js';
export type { Planner } from './planner.js';
export { createRulePlanner } from './planner.js';
export type { Reasoner, RuleBasedReasonerDeps } from './reasoner.js';
export { createRuleBasedReasoner, RuleBasedReasoner, segmentClauses } from './reasoner.js';
// P4 — LLM reasoners (hybrid seam)
export type {
  ClaudeClient,
  ClaudeMessage,
  ClaudeReasonerConfig,
  ClaudeRequest,
} from './reasoner-claude.js';
export {
  buildAskRequest,
  buildControlRequest,
  createClaudeReasoner,
  extractAnswer,
  extractPatch,
} from './reasoner-claude.js';
export type { LLMComplete, LLMReasonerOptions, LLMRequest, LLMResponse } from './reasoner-llm.js';
export { createLLMReasoner } from './reasoner-llm.js';
export type { Router, RouterOptions, RoutingPolicy } from './router.js';
export { createRouter } from './router.js';
export { BUILT_IN_TOOLS, createDefaultRegistry } from './tools/builtins.js';
export type {
  ExecutionResult,
  Tool,
  ToolContext,
  ToolDefinition,
  ToolExecutor,
  ToolOutcome,
  ToolRegistry,
  ToolValidation,
} from './tools/registry.js';
export { createToolExecutor, createToolRegistry } from './tools/registry.js';
export type {
  AIMode,
  Intent,
  IntentKind,
  Plan,
  PlanStep,
  RawSlot,
  ResolvedEntities,
} from './types.js';
