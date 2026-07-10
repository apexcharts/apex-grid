/**
 * Built-in tools: the default operation catalog.
 *
 * View-state operations (sort / filter / quick-filter / columns / select /
 * paginate / group / ungroup / pivot / aggregate / reset) build a `StatePatch`,
 * run it through the shipped `sanitizePatch` guard, and apply it via
 * {@link GridApi.applyState} (which on a live grid re-defends through `setState`).
 * Each returns a snapshot-based inverse. `answer` is read-only (it never mutates).
 * `export` is an imperative action. Tools that a grid cannot perform are gated out
 * by `available`, so they are never listed and never planned.
 *
 * @see plans/ai-reasoning-layer-spec.md (section 4.7)
 */

import type { ColumnSchema, GridState, RowRef, SortingDirection } from 'apex-grid';
import type { AggregationConfig } from '../../aggregation.js';
import { sanitizePatch } from '../../ai-sanitize.js';
import type { StatePatch } from '../../ai-schema.js';
import { type AnalyticsQuery, formatAnalyticsAnswer, runAnalytics } from '../analytics.js';
import type { GridContext } from '../context.js';
import {
  createToolRegistry,
  type Tool,
  type ToolContext,
  type ToolOutcome,
  type ToolRegistry,
} from './registry.js';

// --- small helpers ---------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function ok<A>(value: A): { ok: true; value: A } {
  return { ok: true, value };
}

function fail(...errors: string[]): { ok: false; errors: string[] } {
  return { ok: false, errors };
}

const noop = () => undefined;

const always = () => true;

function normalizeDirection(direction: string | undefined): SortingDirection {
  if (direction && /^desc/i.test(direction)) return 'descending';
  return 'ascending';
}

function normalizeRowRef(ref: Record<string, unknown>): RowRef | null {
  if (typeof ref.id === 'string' || typeof ref.id === 'number') return { id: ref.id };
  if (typeof ref.index === 'number') return { index: ref.index };
  return null;
}

function normalizePin(value: unknown): 'start' | 'end' | null | undefined {
  if (value === 'start' || value === 'end') return value;
  if (value === null) return null;
  return undefined;
}

function isNumericColumn(column: ColumnSchema): boolean {
  return column.dataType === 'number' || column.dataType === 'currency';
}

/**
 * Sanitize a raw view-state patch against the live schema, apply it, and return an
 * outcome whose `undo` restores the pre-apply snapshot. The single code path shared
 * by every view-state tool, so they all inherit the same guardrails.
 */
function applyViewState(raw: Partial<GridState>, tc: ToolContext): ToolOutcome {
  const { patch, warnings } = sanitizePatch(raw, tc.ctx.schema);
  const before = tc.api.getState();
  const result = tc.api.applyState(patch);
  return {
    applied: result.applied,
    skipped: result.skipped,
    warnings: [...warnings, ...result.warnings],
    undo: () => {
      tc.api.applyState(before);
    },
  };
}

// --- read-only answering ---------------------------------------------------

function summarizeView(ctx: GridContext): string {
  const { state } = ctx;
  const parts: string[] = [`${ctx.columns.length} columns`];
  if (state.sort.length > 0) {
    parts.push(`sorted by ${state.sort.map((s) => `${s.key} ${s.direction}`).join(', ')}`);
  } else {
    parts.push('no sort');
  }
  if (state.filter.length > 0) parts.push(`${state.filter.length} filter(s)`);
  if (state.quickFilter) parts.push(`quick filter "${state.quickFilter}"`);
  const enterprise = state.modules.enterprise as { groupBy?: string[] } | undefined;
  if (enterprise?.groupBy?.length) parts.push(`grouped by ${enterprise.groupBy.join(', ')}`);
  return `Current view: ${parts.join('; ')}.`;
}

function answerQuestion(question: string, tc: ToolContext): string {
  const rows = tc.api.getData() as ReadonlyArray<Record<string, unknown>>;
  const lower = question.toLowerCase();
  if (rows.length > 0) {
    if (/how many|number of|count/.test(lower)) return `There are ${rows.length} rows.`;
    const column = tc.ctx.columns
      .filter(isNumericColumn)
      .find((c) => lower.includes(c.key.toLowerCase()) || lower.includes(c.label.toLowerCase()));
    if (column) {
      const values = rows.map((row) => Number(row[column.key])).filter((n) => Number.isFinite(n));
      if (values.length > 0) {
        if (/highest|max|most|top|largest/.test(lower)) {
          return `The highest ${column.label} is ${Math.max(...values)}.`;
        }
        if (/lowest|min|least|smallest|bottom/.test(lower)) {
          return `The lowest ${column.label} is ${Math.min(...values)}.`;
        }
        if (/average|mean|avg/.test(lower)) {
          const avg = values.reduce((sum, n) => sum + n, 0) / values.length;
          return `The average ${column.label} is ${Math.round(avg * 100) / 100}.`;
        }
        if (/sum|total/.test(lower)) {
          return `The total ${column.label} is ${values.reduce((sum, n) => sum + n, 0)}.`;
        }
      }
    }
  }
  return summarizeView(tc.ctx);
}

// --- argument shapes -------------------------------------------------------

interface SortArgs {
  by: Array<{ key: string; direction?: string }>;
}
interface FilterArgs {
  where: Array<{ key: string; operand: string; searchTerm?: unknown; caseSensitive?: boolean }>;
}
interface QuickFilterArgs {
  text: string;
}
interface ColumnsArgs {
  columns: Array<{
    key: string;
    hidden?: boolean;
    pinned?: 'start' | 'end' | null;
    width?: string;
  }>;
}
interface SelectArgs {
  rows: RowRef[];
}
interface PaginateArgs {
  page?: number;
  pageSize?: number;
}
interface GroupArgs {
  by: string[];
}
interface PivotArgs {
  on?: string;
  rows?: string[];
  values?: AggregationConfig;
}
interface AggregateArgs {
  aggregations: AggregationConfig;
}
interface AnswerArgs {
  question: string;
}
interface ExportArgs {
  format?: string;
}
interface ApplyStateArgs {
  patch: StatePatch;
}
interface AnalyzeArgs {
  query: AnalyticsQuery;
}

// --- the tools -------------------------------------------------------------

const sortTool: Tool<SortArgs> = {
  name: 'sort',
  description: 'Sort the rows by one or more columns, in priority order.',
  parameters: {
    type: 'object',
    required: ['by'],
    properties: {
      by: {
        type: 'array',
        items: {
          type: 'object',
          required: ['key'],
          properties: { key: { type: 'string' }, direction: { enum: ['ascending', 'descending'] } },
        },
      },
    },
  },
  available: always,
  validate(args) {
    if (!isRecord(args)) return fail('sort: expected an object with a "by" array');
    const by = asArray(args.by);
    if (!by) return fail('sort: "by" must be an array of { key, direction }');
    const parsed = by.filter(isRecord).map((entry) => ({
      key: String(entry.key ?? ''),
      direction: entry.direction === undefined ? undefined : String(entry.direction),
    }));
    return ok({ by: parsed });
  },
  execute(args, tc) {
    return applyViewState(
      { sort: args.by.map((e) => ({ key: e.key, direction: normalizeDirection(e.direction) })) },
      tc
    );
  },
};

const filterTool: Tool<FilterArgs> = {
  name: 'filter',
  description: 'Apply per-column filters. Each entry pairs a column with an operand valid for it.',
  parameters: {
    type: 'object',
    required: ['where'],
    properties: {
      where: {
        type: 'array',
        items: {
          type: 'object',
          required: ['key', 'operand'],
          properties: {
            key: { type: 'string' },
            operand: { type: 'string' },
            searchTerm: {},
            caseSensitive: { type: 'boolean' },
          },
        },
      },
    },
  },
  available: always,
  validate(args) {
    if (!isRecord(args)) return fail('filter: expected an object with a "where" array');
    const where = asArray(args.where);
    if (!where) return fail('filter: "where" must be an array of { key, operand }');
    const parsed = where.filter(isRecord).map((entry) => ({
      key: String(entry.key ?? ''),
      operand: String(entry.operand ?? ''),
      searchTerm: entry.searchTerm,
      caseSensitive: typeof entry.caseSensitive === 'boolean' ? entry.caseSensitive : undefined,
    }));
    return ok({ where: parsed });
  },
  execute(args, tc) {
    return applyViewState({ filter: args.where }, tc);
  },
};

const quickFilterTool: Tool<QuickFilterArgs> = {
  name: 'quickFilter',
  description: 'Set the global quick-filter text applied across all columns.',
  parameters: {
    type: 'object',
    required: ['text'],
    properties: { text: { type: 'string' } },
  },
  available: always,
  validate(args) {
    if (!isRecord(args) || typeof args.text !== 'string') {
      return fail('quickFilter: "text" must be a string');
    }
    return ok({ text: args.text });
  },
  execute(args, tc) {
    return applyViewState({ quickFilter: args.text }, tc);
  },
};

const columnsTool: Tool<ColumnsArgs> = {
  name: 'columns',
  description: 'Change column layout: show/hide, pin (start/end), reorder (array order), or width.',
  parameters: {
    type: 'object',
    required: ['columns'],
    properties: {
      columns: {
        type: 'array',
        items: {
          type: 'object',
          required: ['key'],
          properties: {
            key: { type: 'string' },
            hidden: { type: 'boolean' },
            pinned: { enum: ['start', 'end'] },
            width: { type: 'string' },
          },
        },
      },
    },
  },
  available: always,
  validate(args) {
    if (!isRecord(args)) return fail('columns: expected an object with a "columns" array');
    const cols = asArray(args.columns);
    if (!cols) return fail('columns: "columns" must be an array of { key, ... }');
    const parsed = cols.filter(isRecord).map((c) => ({
      key: String(c.key ?? ''),
      hidden: typeof c.hidden === 'boolean' ? c.hidden : undefined,
      pinned: normalizePin(c.pinned),
      width: typeof c.width === 'string' ? c.width : undefined,
    }));
    return ok({ columns: parsed });
  },
  execute(args, tc) {
    return applyViewState(
      {
        columns: args.columns.map((c) => ({
          key: c.key,
          hidden: c.hidden,
          pinned: c.pinned ?? undefined,
          width: c.width,
        })),
      },
      tc
    );
  },
};

const selectTool: Tool<SelectArgs> = {
  name: 'select',
  description: 'Select rows by id or by positional index.',
  parameters: {
    type: 'object',
    required: ['rows'],
    properties: {
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: ['string', 'number'] }, index: { type: 'integer' } },
        },
      },
    },
  },
  available: (ctx) => ctx.schema.capabilities.selection !== false,
  validate(args) {
    if (!isRecord(args)) return fail('select: expected an object with a "rows" array');
    const rows = asArray(args.rows);
    if (!rows) return fail('select: "rows" must be an array of { id } or { index }');
    const parsed = rows
      .filter(isRecord)
      .map(normalizeRowRef)
      .filter((ref): ref is RowRef => ref !== null);
    return ok({ rows: parsed });
  },
  execute(args, tc) {
    return applyViewState({ selection: args.rows }, tc);
  },
};

const paginateTool: Tool<PaginateArgs> = {
  name: 'paginate',
  description: 'Go to a page (zero-based) and/or change the page size.',
  parameters: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 0 },
      pageSize: { type: 'integer', minimum: 1 },
    },
  },
  available: (ctx) => ctx.schema.capabilities.pagination,
  validate(args) {
    if (!isRecord(args)) return fail('paginate: expected an object with page and/or pageSize');
    const page = typeof args.page === 'number' ? args.page : undefined;
    const pageSize = typeof args.pageSize === 'number' ? args.pageSize : undefined;
    if (page === undefined && pageSize === undefined) {
      return fail('paginate: provide page and/or pageSize');
    }
    return ok({ page, pageSize });
  },
  execute(args, tc) {
    const current = tc.ctx.state.pagination;
    return applyViewState(
      {
        pagination: {
          page: args.page ?? current.page,
          pageSize: args.pageSize ?? current.pageSize,
        },
      },
      tc
    );
  },
};

const groupTool: Tool<GroupArgs> = {
  name: 'group',
  description: 'Group rows by one or more columns, in order.',
  parameters: {
    type: 'object',
    required: ['by'],
    properties: { by: { type: 'array', items: { type: 'string' } } },
  },
  available: (ctx) => ctx.schema.capabilities.grouping === true,
  validate(args) {
    if (!isRecord(args)) return fail('group: expected an object with a "by" array');
    const by = asArray(args.by);
    if (!by) return fail('group: "by" must be an array of column keys');
    return ok({ by: by.map((key) => String(key)) });
  },
  execute(args, tc) {
    return applyViewState({ modules: { enterprise: { groupBy: args.by } } }, tc);
  },
};

const ungroupTool: Tool<Record<string, never>> = {
  name: 'ungroup',
  description: 'Remove all row grouping.',
  parameters: { type: 'object', properties: {} },
  available: (ctx) => ctx.schema.capabilities.grouping === true,
  validate() {
    return ok({});
  },
  execute(_args, tc) {
    return applyViewState({ modules: { enterprise: { groupBy: [] } } }, tc);
  },
};

const pivotTool: Tool<PivotArgs> = {
  name: 'pivot',
  description:
    'Configure a pivot: the column to pivot on, the row-group columns, and the value aggregations.',
  parameters: {
    type: 'object',
    properties: {
      on: { type: 'string' },
      rows: { type: 'array', items: { type: 'string' } },
      values: { type: 'object' },
    },
  },
  available: (ctx) => ctx.schema.capabilities.pivot === true,
  validate(args) {
    if (!isRecord(args)) return fail('pivot: expected an object');
    const on = typeof args.on === 'string' ? args.on : undefined;
    const rows = asArray(args.rows)?.map((key) => String(key));
    const values = isRecord(args.values) ? (args.values as AggregationConfig) : undefined;
    return ok({ on, rows, values });
  },
  execute(args, tc) {
    const enterprise: Record<string, unknown> = {};
    if (args.on !== undefined) enterprise.pivotOn = args.on;
    if (args.rows !== undefined) enterprise.pivotRows = args.rows;
    if (args.values !== undefined) enterprise.pivotValues = args.values;
    return applyViewState({ modules: { enterprise } }, tc);
  },
};

const aggregateTool: Tool<AggregateArgs> = {
  name: 'aggregate',
  description: 'Set per-column aggregations, e.g. { revenue: ["sum"], price: ["avg", "max"] }.',
  parameters: {
    type: 'object',
    required: ['aggregations'],
    properties: { aggregations: { type: 'object' } },
  },
  available: (ctx) => ctx.schema.capabilities.aggregation !== undefined,
  validate(args) {
    if (!isRecord(args) || !isRecord(args.aggregations)) {
      return fail('aggregate: "aggregations" must be an object of { columnKey: functions[] }');
    }
    return ok({ aggregations: args.aggregations as AggregationConfig });
  },
  execute(args, tc) {
    return applyViewState({ modules: { enterprise: { aggregations: args.aggregations } } }, tc);
  },
};

const resetTool: Tool<Record<string, never>> = {
  name: 'reset',
  description: 'Clear sort, filters, quick filter, and grouping: return to the default view.',
  parameters: { type: 'object', properties: {} },
  available: always,
  validate() {
    return ok({});
  },
  execute(_args, tc) {
    return applyViewState(
      { sort: [], filter: [], quickFilter: '', modules: { enterprise: { groupBy: [] } } },
      tc
    );
  },
};

const answerTool: Tool<AnswerArgs> = {
  name: 'answer',
  description:
    'Answer a read-only question about the current view or data (count, min/max/avg/sum, summary).',
  readOnly: true,
  parameters: {
    type: 'object',
    required: ['question'],
    properties: { question: { type: 'string' } },
  },
  available: always,
  validate(args) {
    if (!isRecord(args) || typeof args.question !== 'string') {
      return fail('answer: "question" must be a string');
    }
    return ok({ question: args.question });
  },
  execute(args, tc) {
    return { applied: [], warnings: [], answer: answerQuestion(args.question, tc), undo: noop };
  },
};

const analyzeTool: Tool<AnalyzeArgs> = {
  name: 'analyze',
  description:
    'Answer a read-only analytical question computed over the data: scalar metrics (min/max/avg/median/sum/count/distinct/range/stddev/mode), a metric grouped by a dimension, or ranked rows (top/bottom N, "who has the most").',
  readOnly: true,
  parameters: {
    type: 'object',
    required: ['query'],
    properties: { query: { type: 'object' } },
  },
  available: always,
  validate(args) {
    if (!isRecord(args) || !isRecord(args.query)) {
      return fail('analyze: "query" must be an object');
    }
    return ok({ query: args.query as unknown as AnalyticsQuery });
  },
  execute(args, tc) {
    const result = runAnalytics(args.query, tc.api.getData(), tc.ctx.schema);
    return {
      applied: [],
      warnings: [],
      answer: formatAnalyticsAnswer(result, tc.ctx.schema),
      undo: noop,
    };
  },
};

const exportTool: Tool<ExportArgs> = {
  name: 'export',
  description: 'Export the current view (defaults to CSV).',
  parameters: {
    type: 'object',
    properties: { format: { type: 'string' } },
  },
  available: always,
  validate(args) {
    const format = isRecord(args) && typeof args.format === 'string' ? args.format : undefined;
    return ok({ format });
  },
  execute(args, tc) {
    if (!tc.api.export) {
      return { applied: [], warnings: ['export: not available on this grid'], undo: noop };
    }
    const result = tc.api.export(args.format ?? 'csv');
    return { applied: result.applied, warnings: result.warnings, undo: result.undo ?? noop };
  },
};

const undoTool: Tool<Record<string, never>> = {
  name: 'undo',
  description: 'Undo the last change: restore the view to before the previous control turn.',
  parameters: { type: 'object', properties: {} },
  available: always,
  validate() {
    return ok({});
  },
  execute(_args, tc) {
    const target = tc.ctx.memory.lastControlBefore;
    if (!target) {
      return { applied: [], warnings: ['Nothing to undo.'], undo: noop };
    }
    const before = tc.api.getState();
    tc.api.applyState(target);
    return {
      applied: ['undo'],
      warnings: [],
      undo: () => {
        tc.api.applyState(before);
      },
    };
  },
};

const applyStateTool: Tool<ApplyStateArgs> = {
  name: 'applyState',
  description:
    'Apply a whole view-state patch in one step: any of sort, filter, quick filter, columns, selection, pagination, and the enterprise module blob (grouping / pivot / aggregation). The patch is sanitized against the grid schema before it is applied. This is the vehicle an LLM reasoner uses to apply the patch it produced.',
  parameters: {
    type: 'object',
    required: ['patch'],
    properties: { patch: { type: 'object' } },
  },
  available: always,
  validate(args) {
    if (!isRecord(args) || !isRecord(args.patch)) {
      return fail('applyState: "patch" must be an object');
    }
    return ok({ patch: args.patch as StatePatch });
  },
  execute(args, tc) {
    return applyViewState(args.patch, tc);
  },
};

/** Every built-in tool, in a stable order. */
export const BUILT_IN_TOOLS: ReadonlyArray<Tool> = [
  sortTool,
  filterTool,
  quickFilterTool,
  columnsTool,
  selectTool,
  paginateTool,
  groupTool,
  ungroupTool,
  pivotTool,
  aggregateTool,
  resetTool,
  undoTool,
  answerTool,
  analyzeTool,
  exportTool,
  applyStateTool,
] as unknown as ReadonlyArray<Tool>;

/** A {@link ToolRegistry} pre-populated with every built-in tool. */
export function createDefaultRegistry(): ToolRegistry {
  const registry = createToolRegistry();
  for (const tool of BUILT_IN_TOOLS) registry.register(tool);
  return registry;
}
