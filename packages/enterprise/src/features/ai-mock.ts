import type { ColumnSchema, GridSchema } from 'apex-grid';
import type { AIAdapter, AIRequest, AIResponse } from './ai.js';
import type { StatePatch } from './ai-schema.js';

/** A single prompt-to-patch rule for {@link createMockAdapter}. */
export interface MockRule {
  test: RegExp;
  build: (match: RegExpMatchArray, request: AIRequest) => AIResponse;
}

/** Options for {@link createMockAdapter}. */
export interface MockAdapterOptions {
  /** Extra control-mode rules, tried before the built-ins. */
  rules?: MockRule[];
}

function findColumn(schema: GridSchema, name: string): ColumnSchema | undefined {
  const target = name.trim().toLowerCase();
  return schema.columns.find(
    (column) => column.key.toLowerCase() === target || column.label.toLowerCase() === target
  );
}

function isNumeric(column: ColumnSchema): boolean {
  return column.dataType === 'number' || column.dataType === 'currency';
}

/** Full column layout, in schema order, with one column's flags overridden. */
function layoutWith(schema: GridSchema, key: string, patch: { hidden?: boolean }): StatePatch {
  return {
    columns: schema.columns.map((column) => ({
      key: column.key,
      hidden: column.key === key ? patch.hidden : column.hidden,
      pinned: column.pinned,
    })),
  };
}

/** Pick a sensible operand name from those the column advertises. */
function pickOperand(column: ColumnSchema, prefer: string[]): string {
  for (const name of prefer) if (column.filterOperands.includes(name)) return name;
  return column.filterOperands[0] ?? 'equals';
}

const DESCENDING = /\b(desc|descending|high(?:est)?|large(?:st)?|most|top)\b/;

const DEFAULT_RULES: MockRule[] = [
  {
    // "reset" / "clear all"
    test: /\b(reset|clear)\b/i,
    build: () => ({
      patch: { sort: [], filter: [], quickFilter: '', modules: { enterprise: { groupBy: [] } } },
    }),
  },
  {
    // "group by region"
    test: /\bgroup\s+(?:rows\s+)?(?:by\s+)?([\w ]+?)\b/i,
    build: (match, request) => {
      const column = findColumn(request.schema, match[1]);
      if (!column) return { patch: {} };
      return { patch: { modules: { enterprise: { groupBy: [column.key] } } } };
    },
  },
  {
    // "sort by price descending" / "sort name"
    test: /\bsort\s+(?:by\s+)?([\w ]+?)(?:\s+(asc|ascending|desc|descending|high\w*|low\w*|large\w*|small\w*))?\s*$/i,
    build: (match, request) => {
      const column = findColumn(request.schema, match[1]);
      if (!column) return { patch: {} };
      const direction = DESCENDING.test(match[2] ?? '') ? 'descending' : 'ascending';
      return { patch: { sort: [{ key: column.key, direction }] } };
    },
  },
  {
    // "filter category = Audio" / "filter name contains hub"
    test: /\bfilter\s+([\w ]+?)\s*(?:=|==|is|equals?|contains|has)\s*(.+?)\s*$/i,
    build: (match, request) => {
      const column = findColumn(request.schema, match[1]);
      if (!column) return { patch: {} };
      const raw = match[2].replace(/^["']|["']$/g, '');
      const searchTerm = isNumeric(column) ? Number(raw) : raw;
      const wantsContains = /contains|has/i.test(match[0]);
      const operand = pickOperand(
        column,
        wantsContains ? ['contains', 'equals'] : ['equals', 'contains']
      );
      return { patch: { filter: [{ key: column.key, operand, searchTerm }] } };
    },
  },
  {
    // "hide price" / "show price"
    test: /\b(hide|show)\s+(?:column\s+)?([\w ]+?)\s*$/i,
    build: (match, request) => {
      const column = findColumn(request.schema, match[2]);
      if (!column) return { patch: {} };
      return { patch: layoutWith(request.schema, column.key, { hidden: /hide/i.test(match[1]) }) };
    },
  },
  {
    // "search wireless" / "find hub"
    test: /\b(?:search|find|quick\s*filter)\s+(.+?)\s*$/i,
    build: (match) => ({ patch: { quickFilter: match[1].replace(/^["']|["']$/g, '') } }),
  },
];

/** Summarize the current view from the schema's embedded state. */
function summarize(schema: GridSchema): string {
  const state = schema.state;
  const parts: string[] = [`${schema.columns.length} columns`];
  if (state.sort?.length) {
    parts.push(`sorted by ${state.sort.map((s) => `${s.key} ${s.direction}`).join(', ')}`);
  } else parts.push('no sort');
  if (state.filter?.length) parts.push(`${state.filter.length} filter(s)`);
  if (state.quickFilter) parts.push(`quick filter "${state.quickFilter}"`);
  const enterprise = state.modules?.enterprise as { groupBy?: string[] } | undefined;
  if (enterprise?.groupBy?.length) parts.push(`grouped by ${enterprise.groupBy.join(', ')}`);
  return `Current view: ${parts.join('; ')}.`;
}

/** Answer a data question from the bounded sample, or null if not recognized. */
function answerData(request: AIRequest): string | null {
  const rows = (request.data ?? []) as ReadonlyArray<Record<string, unknown>>;
  if (rows.length === 0) return null;
  const lower = request.prompt.toLowerCase();
  if (/how many|number of|count/.test(lower)) return `There are ${rows.length} rows.`;

  const column = request.schema.columns
    .filter(isNumeric)
    .find((c) => lower.includes(c.key.toLowerCase()) || lower.includes(c.label.toLowerCase()));
  if (!column) return null;
  const values = rows.map((row) => Number(row[column.key])).filter((n) => Number.isFinite(n));
  if (values.length === 0) return null;

  if (/highest|max|most|top|largest/.test(lower))
    return `The highest ${column.label} is ${Math.max(...values)}.`;
  if (/lowest|min|least|smallest|bottom/.test(lower))
    return `The lowest ${column.label} is ${Math.min(...values)}.`;
  if (/average|mean|avg/.test(lower)) {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return `The average ${column.label} is ${Math.round(avg * 100) / 100}.`;
  }
  if (/sum|total/.test(lower))
    return `The total ${column.label} is ${values.reduce((a, b) => a + b, 0)}.`;
  return null;
}

/**
 * A deterministic, no-network {@link AIAdapter} for demos and tests. Control mode
 * maps a small canned vocabulary ("sort by price descending", "group by region",
 * "filter category = Audio", "hide stock", "search hub", "reset") to patches,
 * resolving column names against the live schema. Ask mode answers simple data
 * questions ("how many rows?", "highest price?") from the bounded data sample, or
 * summarizes the current view. Extend it with {@link MockAdapterOptions.rules}.
 */
export function createMockAdapter(options: MockAdapterOptions = {}): AIAdapter {
  const rules = [...(options.rules ?? []), ...DEFAULT_RULES];
  return async (request: AIRequest): Promise<AIResponse> => {
    if (request.mode === 'ask') return { answer: answerData(request) ?? summarize(request.schema) };
    for (const rule of rules) {
      const match = request.prompt.match(rule.test);
      if (match) return rule.build(match, request);
    }
    return { patch: {} };
  };
}
