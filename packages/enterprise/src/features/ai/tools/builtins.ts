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

import type {
  ColumnLayoutState,
  ColumnSchema,
  GridState,
  RowRef,
  SortingDirection,
} from 'apex-grid';
import type { AggregationConfig } from '../../aggregation.js';
import { sanitizePatch } from '../../ai-sanitize.js';
import type { StatePatch } from '../../ai-schema.js';
import {
  ANALYTICS_FUNCS,
  type AnalyticsFunc,
  type AnalyticsQuery,
  computeMetric,
  formatAnalyticsAnswer,
  formatNumber,
  parseAnalyticsQuery,
  runAnalytics,
} from '../analytics.js';
import type { GridContext } from '../context.js';
import { isNumericColumn, mentionsColumn } from '../entities.js';
import { changedShape, type MemorySnapshot, undoTarget } from '../memory.js';
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

type Blob = Record<string, unknown>;

const LAYOUT_FIELDS = ['width', 'pinned', 'hidden'] as const;

/**
 * Overlay partial column entries on the live layout, keeping its order: an entry
 * changes only the fields it defines, and `pinned: null` unpins. A local twin of
 * core's `mergeColumnLayout`: a runtime import of `apex-grid` from this lazily
 * loaded module would split the core into a shared chunk (see `minOf`).
 */
function overlayLayout(
  live: readonly ColumnLayoutState[],
  entries: readonly Blob[]
): ColumnLayoutState[] {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  return live.map((column) => {
    const entry = byKey.get(column.key);
    if (!entry) return column;
    const next: Blob = { ...column };
    for (const field of LAYOUT_FIELDS) {
      if (entry[field] !== undefined) next[field] = entry[field] ?? undefined;
    }
    return next as unknown as ColumnLayoutState;
  });
}

/** `columns` sorted by the key order of `order`; keys it lacks go last. */
function sortByKeys(columns: ColumnLayoutState[], order: readonly string[]): ColumnLayoutState[] {
  const rank = (key: string) => {
    const index = order.indexOf(key);
    return index === -1 ? order.length : index;
  };
  return columns.sort((a, b) => rank(a.key) - rank(b.key));
}

/**
 * Fold a patch's partial `columns` list into the live layout, since setState
 * takes a full one: each entry changes only the fields it defines, the order,
 * widths and pins of other columns stay, and naming every column is an
 * explicit reorder. With `layout`, a list naming every column is instead the
 * full layout setState documents (a missing pin, width or hidden clears it),
 * which is what a patch copied from getState() means. A list whose entries
 * were all refused is dropped, so the step does not report a layout it never
 * changed.
 */
function mergeColumns(patch: StatePatch, live: GridState, layout = false): StatePatch {
  if (!patch.columns) return patch;
  const { columns: entries, ...rest } = patch;
  if (entries.length === 0) return rest;
  if (live.columns.length === 0) return patch;
  const order = entries.map((entry) => entry.key);
  const named = live.columns.every((column) => order.includes(column.key));
  if (named && layout) return patch;
  const columns = overlayLayout(live.columns, entries as unknown as Blob[]);
  return { ...rest, columns: named ? sortByKeys(columns, order) : columns };
}

/**
 * Take back a turn's column changes on the live layout: only the fields that
 * differ between `before` and `after` are put back, and the order only when
 * the turn changed it, so a column hidden or resized since then keeps that.
 */
function restoreColumns(
  before: readonly ColumnLayoutState[],
  after: readonly ColumnLayoutState[],
  live: readonly ColumnLayoutState[]
): ColumnLayoutState[] {
  if (live.length === 0) return [...before];
  const turned = new Map(after.map((column) => [column.key, column as unknown as Blob]));
  const entries = before.map((column) => {
    const was = column as unknown as Blob;
    const now = turned.get(column.key);
    const entry: Blob = { key: column.key };
    for (const field of LAYOUT_FIELDS) {
      if (now && was[field] !== now[field]) entry[field] = was[field] ?? null;
    }
    return entry;
  });
  const columns = overlayLayout(live, entries);
  const order = before.map((column) => column.key);
  const reordered = order.join('\n') !== after.map((column) => column.key).join('\n');
  return reordered ? sortByKeys(columns, order) : columns;
}

/** `restore` with its columns slice narrowed by {@link restoreColumns}. */
function narrowColumns(
  restore: StatePatch,
  after: readonly ColumnLayoutState[] | undefined,
  live: GridState
): StatePatch {
  if (!restore.columns || !after) return restore;
  return { ...restore, columns: restoreColumns(restore.columns, after, live.columns) };
}

/**
 * The slices of `state` that `shape` names, and inside the enterprise blob only
 * the fields `shape` names (other module blobs are taken whole): the undo
 * baseline of a patch. Restoring it puts back exactly what the patch changed, so
 * cell formulas, ranges and every slice the patch left alone keep whatever the
 * user did after the AI turn.
 */
function sliceOf(state: GridState, shape: Partial<GridState>): StatePatch {
  const source = state as unknown as Blob;
  const out: Blob = {};
  for (const key of Object.keys(shape)) {
    if (key !== 'modules') {
      out[key] = source[key];
      continue;
    }
    const modules: Blob = {};
    for (const [id, fields] of Object.entries(shape.modules ?? {})) {
      const live = state.modules?.[id];
      if (live === undefined) continue;
      modules[id] =
        id === 'enterprise' && isRecord(fields) && isRecord(live)
          ? Object.fromEntries(Object.keys(fields).map((field) => [field, live[field]]))
          : live;
    }
    out.modules = modules;
  }
  return out as StatePatch;
}

/** A snapshot without its cell content (formulas, ranges): data, not view. */
function withoutCells(state: GridState): GridState {
  const blob = state.modules?.enterprise;
  if (!isRecord(blob)) return state;
  const { formulas: _formulas, ranges: _ranges, ...view } = blob;
  return { ...state, modules: { ...state.modules, enterprise: view } };
}

/**
 * Sanitize a raw view-state patch against the live schema, apply it, and return an
 * outcome whose `undo` restores what the patch changed. The single code path shared
 * by every view-state tool, so they all inherit the same guardrails. `merge` folds
 * the sanitized patch into the live state (e.g. a partial column layout), so only
 * the caller's own clauses are validated.
 */
function applyViewState(
  raw: Partial<GridState>,
  tc: ToolContext,
  merge?: (patch: StatePatch, live: GridState) => StatePatch
): ToolOutcome {
  const sanitized = sanitizePatch(raw, tc.ctx.schema);
  const live = tc.api.getState();
  const patch = merge ? merge(sanitized.patch, live) : sanitized.patch;
  const before = sliceOf(live, patch);
  const result = tc.api.applyState(patch);
  const applied: string[] = result.applied;
  const after = before.columns ? tc.api.getState().columns : undefined;
  return {
    applied,
    // Slices the tool asked for that did not land (dropped or refused).
    skipped: Object.keys(raw).filter((key) => key !== 'version' && !applied.includes(key)),
    warnings: [...sanitized.warnings, ...result.warnings],
    undo: () => {
      tc.api.applyState(narrowColumns(before, after, tc.api.getState()));
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

/** The metric a question names, as whole words, with the word its answer uses. */
const ANSWER_METRICS: ReadonlyArray<[AnalyticsFunc, RegExp, string]> = [
  ['max', /\b(?:highest|max(?:imum)?|most|top|largest)\b/, 'highest'],
  ['min', /\b(?:lowest|min(?:imum)?|least|smallest|bottom)\b/, 'lowest'],
  ['avg', /\b(?:average|mean|avg)\b/, 'average'],
  ['sum', /\b(?:sum|total)\b/, 'total'],
];

/** What a free-form question grounds to: a row count, or a metric over a numeric column. */
export type QuestionGrounding =
  | { kind: 'count' }
  | { kind: 'metric'; func: AnalyticsFunc; word: string; column: ColumnSchema };

/**
 * Ground a free-form question on whole words: "how many" is a row count, and a
 * metric word with a numeric column it names is that metric. `null` when it
 * grounds neither, so it could only echo the view. The planner scores a question
 * by this and the answer tool computes from it, so the two never drift.
 */
export function groundQuestion(
  question: string,
  columns: readonly ColumnSchema[]
): QuestionGrounding | null {
  const lower = question.toLowerCase();
  if (/\b(?:how many|number of|count)\b/.test(lower)) return { kind: 'count' };
  const column = columns.filter(isNumericColumn).find((c) => mentionsColumn(question, c));
  const metric = column && ANSWER_METRICS.find(([, pattern]) => pattern.test(lower));
  return column && metric ? { kind: 'metric', func: metric[0], word: metric[2], column } : null;
}

/**
 * Answer a free-form question. Metrics are computed by the analytics engine, so
 * this path and the `analyze` tool count blanks and numeric text the same way.
 */
function answerQuestion(question: string, tc: ToolContext): string {
  const rows = tc.api.getData() as ReadonlyArray<Record<string, unknown>>;
  const grounded = rows.length > 0 ? groundQuestion(question, tc.ctx.columns) : null;
  if (grounded?.kind === 'count') return `There are ${rows.length} rows.`;
  if (grounded) {
    const { value } = computeMetric(grounded.func, rows, grounded.column.key);
    if (typeof value === 'number') {
      return `The ${grounded.word} ${grounded.column.label} is ${formatNumber(value)}.`;
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
  on?: string | string[];
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
    // An empty list clears every filter. Otherwise the clauses join the live
    // filters and replace only those on the same columns, so a compound prompt
    // ("qty > 2 and price < 7") keeps each clause.
    return applyViewState({ filter: args.where }, tc, (patch, live) => {
      if (args.where.length === 0 || !patch.filter) return patch;
      if (patch.filter.length === 0) return {}; // every clause was refused
      const keys = new Set(patch.filter.map((entry) => entry.key));
      return { filter: [...live.filter.filter((entry) => !keys.has(entry.key)), ...patch.filter] };
    });
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
  description:
    'Change column layout: show/hide, pin (start/end, null unpins), reorder (array order naming every column), or width. An entry changes only the fields it sets.',
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
            pinned: { enum: ['start', 'end', null] },
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
    return applyViewState({ columns: args.columns }, tc, mergeColumns);
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
    // Live, not the turn's context: an earlier step of this plan may have paged.
    const current = tc.api.getState().pagination;
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
      on: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      rows: { type: 'array', items: { type: 'string' } },
      values: { type: 'object' },
    },
  },
  available: (ctx) => ctx.schema.capabilities.pivot === true,
  validate(args) {
    if (!isRecord(args)) return fail('pivot: expected an object');
    const on = typeof args.on === 'string' ? args.on : asArray(args.on)?.map((key) => String(key));
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
    properties: {
      query: {
        type: 'object',
        required: ['kind', 'metrics'],
        properties: {
          kind: { enum: ['aggregate', 'group', 'rank'] },
          metrics: { type: 'array', items: { enum: [...ANALYTICS_FUNCS] } },
          column: { type: 'string' },
          groupBy: { type: 'string' },
          labelColumn: { type: 'string' },
          where: {
            type: 'array',
            items: {
              type: 'object',
              required: ['key', 'operand'],
              properties: { key: { type: 'string' }, operand: { type: 'string' }, value: {} },
            },
          },
          direction: { enum: ['top', 'bottom'] },
          limit: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
  available: always,
  validate(args) {
    // The shape runAnalytics dereferences; a malformed query is refused, not thrown on.
    const parsed = parseAnalyticsQuery(isRecord(args) ? args.query : undefined);
    return parsed.ok ? ok({ query: parsed.value }) : parsed;
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

/**
 * What the "undo" prompt puts back: the slices the newest applied turn that
 * changed the view, and that no later undo took back, had before it. Turns that
 * changed nothing (an export) are passed over, and later edits (a formula typed
 * after the turn, a sort the user picked) are not the turn's to take back.
 * `null` when there is nothing.
 */
function undoRestore(memory: MemorySnapshot, live: GridState): StatePatch | null {
  const { turns, lastControlBefore } = memory;
  const turn = undoTarget(turns);
  if (turn?.stateBefore) {
    const before = turn.stateBefore;
    // A custom Memory may keep no after state: undo then takes back the view slices.
    const shape = turn.stateAfter
      ? changedShape(before as unknown as Blob, turn.stateAfter as unknown as Blob)
      : null;
    return shape
      ? narrowColumns(sliceOf(before, shape as Partial<GridState>), turn.stateAfter?.columns, live)
      : sliceOf(before, withoutCells(before));
  }
  // A custom Memory that reports a baseline but keeps no turns.
  if (turns.length === 0 && lastControlBefore) {
    return sliceOf(lastControlBefore, withoutCells(lastControlBefore));
  }
  return null;
}

const undoTool: Tool<Record<string, never>> = {
  name: 'undo',
  description: 'Undo the last change: restore the view to before the previous control turn.',
  parameters: { type: 'object', properties: {} },
  available: always,
  validate() {
    return ok({});
  },
  execute(_args, tc) {
    const live = tc.api.getState();
    const restore = undoRestore(tc.ctx.memory, live);
    if (!restore) {
      return { applied: [], warnings: ['Nothing to undo.'], undo: noop };
    }
    const before = sliceOf(live, restore);
    tc.api.applyState(restore);
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
    // An LLM hiding one column sends a partial list: merge it like the columns
    // tool. A list naming every column stays the full layout setState takes.
    return applyViewState(args.patch, tc, (patch, live) => mergeColumns(patch, live, true));
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
