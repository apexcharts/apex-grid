import type Anthropic from '@anthropic-ai/sdk';
import type { AIAdapter, AIRequest, AIResponse } from './ai.js';
import { type StatePatch, toJSONSchema } from './ai-schema.js';

/** Default model. Configurable; never silently downgraded. */
const DEFAULT_MODEL = 'claude-opus-4-8';
/** A grid patch (or a short answer) is small; this is plenty and bounds cost. */
const DEFAULT_MAX_TOKENS = 1024;
/** Rows of the current data sampled into the prompt so answers/patches are grounded. */
const DEFAULT_MAX_DATA_ROWS = 50;
/** The single tool the model calls in control mode; its input is the state patch. */
const CONTROL_TOOL_NAME = 'apply_grid_state';

/**
 * Configures {@link createClaudeAdapter}. Two transports: a server **proxy**
 * (`endpoint`, recommended for production: the key stays on your backend) or a
 * **direct** browser call (`apiKey` + `dangerouslyAllowBrowser`, development
 * only: the key is exposed to the page). The adapter interface itself is
 * provider-agnostic; this is the bundled Anthropic/Claude reference.
 */
export interface ClaudeAdapterConfig {
  /** Production transport: POST `{ prompt, mode, schema, data }` to your backend. */
  endpoint?: string;
  /** Development transport: call Anthropic directly. Requires {@link dangerouslyAllowBrowser}. */
  apiKey?: string;
  /** Acknowledge that an in-browser `apiKey` is exposed to the page. Dev only. */
  dangerouslyAllowBrowser?: boolean;
  /** Model id. Defaults to `claude-opus-4-8`. */
  model?: string;
  /** Max output tokens. Defaults to 1024. */
  maxTokens?: number;
  /** Rows of the current data to include in the prompt (0 disables). Defaults to 50. */
  maxDataRows?: number;
  /** Extra system-prompt text appended to the built-in grid instructions. */
  system?: string;
  /** Override `fetch` (proxy transport), e.g. to add auth headers or for testing. */
  fetch?: typeof fetch;
  /** Supply the Anthropic client (or a stub) instead of the bundled dynamic import. */
  client?: ClaudeClient;
}

/** The slice of an Anthropic message the adapter reads. */
export interface ClaudeMessage {
  content: ReadonlyArray<{ type: string; text?: string; input?: unknown; name?: string }>;
  stop_reason?: string | null;
  stop_details?: { explanation?: string | null } | null;
}

/** Minimal structural view of the Anthropic client (the part the adapter uses). */
export interface ClaudeClient {
  messages: {
    create(body: Anthropic.MessageCreateParamsNonStreaming): Promise<ClaudeMessage>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** `schema` + a bounded data sample, as a system-prompt block. */
function contextBlock(request: AIRequest, config: ClaudeAdapterConfig): string {
  let block = `Grid schema (columns, capabilities, and current state):\n${JSON.stringify(request.schema)}`;
  const max = config.maxDataRows ?? DEFAULT_MAX_DATA_ROWS;
  const rows = request.data ?? [];
  if (max > 0 && rows.length > 0) {
    const sample = rows.slice(0, max);
    const note = rows.length > sample.length ? ` (first ${sample.length} of ${rows.length})` : '';
    block += `\n\nCurrent rows${note}:\n${JSON.stringify(sample)}`;
  }
  return block;
}

function controlSystemPrompt(request: AIRequest, config: ClaudeAdapterConfig): string {
  return [
    'You translate a user request into a change to a data grid.',
    `Call the ${CONTROL_TOOL_NAME} tool with a patch that achieves the request. Use only the columns, operands, and values described by the schema, and include only the slices you want to change.`,
    contextBlock(request, config),
    config.system ?? '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function askSystemPrompt(request: AIRequest, config: ClaudeAdapterConfig): string {
  return [
    'You answer questions about a data grid and its data, concisely. This is read-only: do not propose or make any change to the grid.',
    contextBlock(request, config),
    config.system ?? '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Build the control-mode (tool-use) request. Exported for testing. */
export function buildControlRequest(
  request: AIRequest,
  config: ClaudeAdapterConfig
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: config.model ?? DEFAULT_MODEL,
    max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    thinking: { type: 'adaptive' },
    system: controlSystemPrompt(request, config),
    tools: [
      {
        name: CONTROL_TOOL_NAME,
        description:
          'Apply a view-state patch to the grid to satisfy the request. Include only the slices you want to change; omit everything else.',
        input_schema: toJSONSchema(request.schema) as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: CONTROL_TOOL_NAME },
    messages: [{ role: 'user', content: request.prompt }],
  };
}

/** Build the ask-mode (plain message) request. Exported for testing. */
export function buildAskRequest(
  request: AIRequest,
  config: ClaudeAdapterConfig
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: config.model ?? DEFAULT_MODEL,
    max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    thinking: { type: 'adaptive' },
    system: askSystemPrompt(request, config),
    messages: [{ role: 'user', content: request.prompt }],
  };
}

/** Read the state patch out of the tool-use block. Exported for testing. */
export function extractPatch(message: ClaudeMessage): StatePatch {
  const named = message.content.find(
    (block) =>
      block.type === 'tool_use' && block.name === CONTROL_TOOL_NAME && isRecord(block.input)
  );
  if (named) return named.input as StatePatch;
  // Fall back to any tool_use block (a model may name it differently).
  const any = message.content.find((block) => block.type === 'tool_use' && isRecord(block.input));
  return any ? (any.input as StatePatch) : {};
}

/** Concatenate the text blocks of an answer. Exported for testing. */
export function extractAnswer(message: ClaudeMessage): string {
  return message.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('')
    .trim();
}

function assertNotRefused(message: ClaudeMessage): void {
  if (message.stop_reason === 'refusal') {
    const why = message.stop_details?.explanation ?? 'no explanation provided';
    throw new Error(`apex-grid AI: the model declined this request (${why}).`);
  }
}

function validateConfig(config: ClaudeAdapterConfig): void {
  if (config.endpoint || config.client) return;
  if (config.apiKey) {
    if (!config.dangerouslyAllowBrowser) {
      throw new Error(
        'apex-grid AI: createClaudeAdapter with an apiKey calls Anthropic from the browser and exposes the key to the page. Set dangerouslyAllowBrowser: true to acknowledge (development only), or pass an endpoint (a server proxy) for production.'
      );
    }
    return;
  }
  throw new Error(
    'apex-grid AI: createClaudeAdapter needs an endpoint (server proxy, recommended) or an apiKey (development only).'
  );
}

async function proxyRequest(config: ClaudeAdapterConfig, request: AIRequest): Promise<AIResponse> {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('apex-grid AI: no fetch available; pass config.fetch.');
  const response = await fetchImpl(config.endpoint as string, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: request.prompt,
      mode: request.mode,
      schema: request.schema,
      data: request.data,
    }),
    signal: request.signal,
  });
  if (!response.ok) {
    throw new Error(`apex-grid AI: proxy endpoint responded ${response.status}`);
  }
  const json = (await response.json()) as AIResponse;
  return { patch: json.patch, answer: json.answer };
}

async function callMessages(
  config: ClaudeAdapterConfig,
  body: Anthropic.MessageCreateParamsNonStreaming
): Promise<ClaudeMessage> {
  if (config.client) return config.client.messages.create(body);
  // Dynamic, literal import so a non-AI (or proxy-only) consumer never bundles
  // the SDK; mirrors how the chart panel lazy-imports apexcharts.
  const mod = await import('@anthropic-ai/sdk');
  const client = new mod.default({ apiKey: config.apiKey, dangerouslyAllowBrowser: true });
  return client.messages.create(body);
}

async function directRequest(config: ClaudeAdapterConfig, request: AIRequest): Promise<AIResponse> {
  const body =
    request.mode === 'ask'
      ? buildAskRequest(request, config)
      : buildControlRequest(request, config);
  const message = await callMessages(config, body);
  assertNotRefused(message);
  return request.mode === 'ask'
    ? { answer: extractAnswer(message) }
    : { patch: extractPatch(message) };
}

/**
 * The first-class Anthropic/Claude reference {@link AIAdapter}. Set it on
 * `grid.aiAdapter`, then call `grid.runPrompt(...)`.
 *
 * Control mode uses tool use: the grid's {@link toJSONSchema} becomes the tool's
 * `input_schema`, so the returned patch is shaped by the grid's advertised
 * vocabulary (and the grid sanitizes + applies it defensively). Ask mode is a
 * plain, read-only message over the schema and a bounded data sample.
 *
 * @example Production (server proxy holds the key)
 * ```ts
 * grid.aiAdapter = createClaudeAdapter({ endpoint: '/api/grid-ai' });
 * ```
 * @example Development (browser key; never ship this)
 * ```ts
 * grid.aiAdapter = createClaudeAdapter({ apiKey, dangerouslyAllowBrowser: true });
 * ```
 */
export function createClaudeAdapter(config: ClaudeAdapterConfig): AIAdapter {
  validateConfig(config);
  return (request: AIRequest): Promise<AIResponse> =>
    config.endpoint ? proxyRequest(config, request) : directRequest(config, request);
}
