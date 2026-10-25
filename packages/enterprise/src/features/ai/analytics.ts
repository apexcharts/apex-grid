/**
 * The analytics query layer: the read-only, deterministic analog of the control
 * side's `StatePatch`. An {@link AnalyticsQuery} describes an insight to compute
 * (scalar metrics, a grouped aggregate, or ranked rows); {@link runAnalytics}
 * evaluates it over the grid's rows; {@link formatAnalyticsAnswer} renders a
 * natural-language answer. Pure: no grid, no DOM, no clock. The rule engine builds
 * a query from an utterance (see entities.ts), and an LLM reasoner can emit the same
 * shape via structured output, so both share one executor.
 *
 * @see plans/analytics-query-spec.md
 */

import type { ColumnSchema, GridSchema } from 'apex-grid';
import { isNumericColumn } from './entities.js';

/** The statistics the analytics executor can compute. Superset of the grid's agg funcs. */
export type AnalyticsFunc =
  | 'min'
  | 'max'
  | 'avg'
  | 'median'
  | 'sum'
  | 'count'
  | 'distinct'
  | 'range'
  | 'stddev'
  | 'mode';

/**
 * A scope clause, in the grid's filter-operand vocabulary for the column's type
 * (string, number or boolean operands, as its filter row offers). An operand the
 * column type does not have refuses the query with a note.
 */
export interface QueryFilter {
  key: string;
  operand: string;
  value: unknown;
}

/** A read-only analytical question over the grid data. */
export interface AnalyticsQuery {
  /** `aggregate` = scalar metrics; `group` = metric per dimension; `rank` = ranked rows. */
  kind: 'aggregate' | 'group' | 'rank';
  /** Aggregate: one or many. Group: the primary metric (first is used). */
  metrics: AnalyticsFunc[];
  /** The measure column key (optional for a plain row `count`). */
  column?: string;
  /** `group` kind: the dimension column key. */
  groupBy?: string;
  /** Row scope, applied before computing (all kinds). */
  where?: QueryFilter[];
  /** `rank` (and ranked `group`): which end to take. */
  direction?: 'top' | 'bottom';
  /** `rank` / ranked `group`: how many. */
  limit?: number;
  /** `rank` kind: the column whose value labels a returned row. */
  labelColumn?: string;
}

/**
 * Every function the analytics engine computes. Keyed by the union, so a new
 * func cannot be left out of {@link parseAnalyticsQuery} and the tool schema.
 */
const ANALYTICS_FUNC_KEYS: Record<AnalyticsFunc, true> = {
  min: true,
  max: true,
  avg: true,
  median: true,
  sum: true,
  count: true,
  distinct: true,
  range: true,
  stddev: true,
  mode: true,
};
export const ANALYTICS_FUNCS: ReadonlySet<AnalyticsFunc> = new Set(
  Object.keys(ANALYTICS_FUNC_KEYS) as AnalyticsFunc[]
);

const isText = (value: unknown) => value === undefined || typeof value === 'string';

/**
 * Check an untrusted {@link AnalyticsQuery} (from a model or a custom reasoner)
 * before {@link runAnalytics} reads it, listing every field that is wrong.
 * Missing `metrics` default as the rule engine does: none for `rank`, else a sum
 * of the column, or a row count without one.
 */
export function parseAnalyticsQuery(
  value: unknown
): { ok: true; value: AnalyticsQuery } | { ok: false; errors: string[] } {
  if (!isRecord(value)) return { ok: false, errors: ['analyze: "query" must be an object'] };
  const { kind, metrics, where, limit, direction } = value;
  const errors: string[] = [];
  if (kind !== 'aggregate' && kind !== 'group' && kind !== 'rank') {
    errors.push('analyze: "kind" must be "aggregate", "group" or "rank"');
  }
  if (
    metrics !== undefined &&
    !(Array.isArray(metrics) && metrics.every((func) => ANALYTICS_FUNCS.has(func)))
  ) {
    errors.push(`analyze: "metrics" must be an array of ${[...ANALYTICS_FUNCS].join(', ')}`);
  }
  if (
    where !== undefined &&
    !(
      Array.isArray(where) &&
      where.every((c) => isRecord(c) && typeof c.key === 'string' && typeof c.operand === 'string')
    )
  ) {
    errors.push('analyze: "where" must be an array of { key, operand, value }');
  }
  // The rule planner reads "top 0" as limit 0, which runAnalytics clamps to 1.
  if (limit !== undefined && !(Number.isInteger(limit) && (limit as number) >= 0)) {
    errors.push('analyze: "limit" must be an integer of 0 or more');
  }
  if (direction !== undefined && direction !== 'top' && direction !== 'bottom') {
    errors.push('analyze: "direction" must be "top" or "bottom"');
  }
  for (const field of ['column', 'groupBy', 'labelColumn']) {
    if (!isText(value[field])) errors.push(`analyze: "${field}" must be a column key`);
  }
  if (errors.length > 0) return { ok: false, errors };
  const query = value as unknown as AnalyticsQuery;
  const fallback: AnalyticsFunc[] = kind === 'rank' ? [] : [query.column ? 'sum' : 'count'];
  return { ok: true, value: { ...query, metrics: query.metrics ?? fallback } };
}

/** One computed metric. `value` is a string only for `mode` over a non-numeric column. */
export interface MetricValue {
  func: AnalyticsFunc;
  value: number | string | null;
}

/** The result of {@link runAnalytics}: shape depends on `kind`. */
export interface AnalyticsResult {
  kind: AnalyticsQuery['kind'];
  column?: string;
  groupBy?: string;
  /** `aggregate`. */
  metrics?: MetricValue[];
  /** `group`: one row per group. `value` is a string only for `mode` over text. */
  groups?: Array<{ group: string; value: MetricValue['value'] }>;
  /** `rank`: the ranked rows. */
  rows?: Array<{ label: string; value: number }>;
  direction?: 'top' | 'bottom';
  /** `rank` / ranked `group`: how many were requested. */
  limit?: number;
  /** Rows considered, after `where`. */
  rowCount: number;
  /** Scope clauses echoed back, for the answer. */
  where?: QueryFilter[];
  notes: string[];
}

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null;
}

function labelOf(schema: GridSchema, key: string | undefined): string {
  if (!key) return '';
  return schema.columns.find((c) => c.key === key)?.label ?? key;
}

/**
 * Round to 2 decimals, or to 2 significant digits under 1 so a small rate is not
 * reported as 0, and render raw (no locale separators, for deterministic output).
 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return String(Math.abs(n) < 1 ? Number(n.toPrecision(2)) : Math.round(n * 100) / 100);
}

/** A cell as a number: numeric text ("$60,000") parses, blank text is missing (NaN). */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return Number.NaN;
  const digits = value.replace(/[$,]/g, '').trim();
  return digits === '' ? Number.NaN : Number(digits);
}

// --- statistics ------------------------------------------------------------

function numericValues(rows: readonly Row[], column: string): number[] {
  return rows.map((row) => toNumber(row[column])).filter((n) => Number.isFinite(n));
}

/**
 * The smallest of `values`, exactly as `Math.min(...values)` but without the
 * argument spread, which throws RangeError past roughly 120k values. A local
 * twin of the helper in aggregation.ts: importing that module from here
 * would pull it into its own eager chunk for consumers that code-split,
 * because this file is only loaded with the lazy AI engine.
 */
export function minOf(values: readonly number[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < values.length; i += 1) min = Math.min(min, values[i]);
  return min;
}

/** The largest of `values`, exactly as `Math.max(...values)`; see {@link minOf}. */
export function maxOf(values: readonly number[]): number {
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < values.length; i += 1) max = Math.max(max, values[i]);
  return max;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stddev(values: number[]): number {
  const mean = values.reduce((s, n) => s + n, 0) / values.length;
  const variance = values.reduce((s, n) => s + (n - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** The most frequent raw value of a column (any type), or null. */
function mode(rows: readonly Row[], column: string): string | number | null {
  const counts = new Map<string, { value: string | number; count: number }>();
  for (const row of rows) {
    const raw = row[column];
    if (raw === null || raw === undefined || raw === '') continue;
    const value = typeof raw === 'number' ? raw : String(raw);
    const key = String(value);
    const entry = counts.get(key) ?? { value, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  let best: { value: string | number; count: number } | undefined;
  for (const entry of counts.values()) if (!best || entry.count > best.count) best = entry;
  return best ? best.value : null;
}

/** Compute one metric over the (already scoped) rows. Returns null when undefined. */
export function computeMetric(
  func: AnalyticsFunc,
  rows: readonly Row[],
  column: string | undefined
): MetricValue {
  if (func === 'count') return { func, value: rows.length };
  if (!column) return { func, value: null };
  if (func === 'distinct') {
    const seen = new Set<string>();
    for (const row of rows) {
      const raw = row[column];
      if (raw !== null && raw !== undefined && raw !== '') seen.add(String(raw));
    }
    return { func, value: seen.size };
  }
  if (func === 'mode') return { func, value: mode(rows, column) };

  const values = numericValues(rows, column);
  if (values.length === 0) return { func, value: null };
  switch (func) {
    case 'min':
      return { func, value: minOf(values) };
    case 'max':
      return { func, value: maxOf(values) };
    case 'sum':
      return { func, value: values.reduce((s, n) => s + n, 0) };
    case 'avg':
      return { func, value: values.reduce((s, n) => s + n, 0) / values.length };
    case 'median':
      return { func, value: median(values) };
    case 'range':
      return { func, value: maxOf(values) - minOf(values) };
    case 'stddev':
      return { func, value: stddev(values) };
    default:
      return { func, value: null };
  }
}

// --- scope (where) ---------------------------------------------------------

type ScopeTest = (cell: unknown, value: unknown) => boolean;

/** Text as the grid's string filters compare it: case-folded, missing as ''. */
const text = (value: unknown): string => (value == null ? '' : String(value)).toLowerCase();

/** A missing number, as the grid's number filters read it: null, NaN or blank text. */
const isBlankNumber = (value: unknown): boolean => Number.isNaN(toNumber(value ?? Number.NaN));

const compare =
  (test: (cell: number, value: number) => boolean): ScopeTest =>
  (cell, value) =>
    test(toNumber(cell), toNumber(value));

/**
 * The grid's filter operands per column type (core's String/Number/BooleanOperands),
 * restated: a runtime import of `apex-grid` from this lazily loaded chunk would
 * split the core out of the define bundle (see {@link minOf}).
 */
const STRING_SCOPE = new Map<string, ScopeTest>([
  ['equals', (cell, value) => text(cell) === text(value)],
  ['doesNotEqual', (cell, value) => text(cell) !== text(value)],
  ['contains', (cell, value) => text(cell).includes(text(value))],
  ['doesNotContain', (cell, value) => !text(cell).includes(text(value))],
  ['startsWith', (cell, value) => text(cell).startsWith(text(value))],
  ['endsWith', (cell, value) => text(cell).endsWith(text(value))],
  ['empty', (cell) => text(cell) === ''],
  ['notEmpty', (cell) => text(cell) !== ''],
]);
const NUMBER_SCOPE = new Map<string, ScopeTest>([
  ['equals', compare((cell, value) => cell === value)],
  ['doesNotEqual', compare((cell, value) => cell !== value)],
  ['greaterThan', compare((cell, value) => cell > value)],
  ['lessThan', compare((cell, value) => cell < value)],
  ['greaterThanOrEqual', compare((cell, value) => cell >= value)],
  ['lessThanOrEqual', compare((cell, value) => cell <= value)],
  ['empty', isBlankNumber],
  ['notEmpty', (cell) => !isBlankNumber(cell)],
]);
const BOOLEAN_SCOPE = new Map<string, ScopeTest>([
  ['all', () => true],
  ['true', (cell) => cell === true],
  ['false', (cell) => cell === false],
  ['empty', (cell) => cell == null],
  ['notEmpty', (cell) => cell != null],
]);

/** Spellings a model may use for a grid operand. */
const OPERAND_ALIASES = new Map([
  ['notEquals', 'doesNotEqual'],
  ['greaterThanOrEqualTo', 'greaterThanOrEqual'],
  ['lessThanOrEqualTo', 'lessThanOrEqual'],
]);

/** How a scope operand reads in an answer; a unary one (no value) starts with "is". */
const OPERAND_TEXT = new Map([
  ['equals', '='],
  ['doesNotEqual', '!='],
  ['greaterThan', '>'],
  ['lessThan', '<'],
  ['greaterThanOrEqual', '>='],
  ['lessThanOrEqual', '<='],
  ['contains', 'contains'],
  ['doesNotContain', 'does not contain'],
  ['startsWith', 'starts with'],
  ['endsWith', 'ends with'],
  ['empty', 'is empty'],
  ['notEmpty', 'is not empty'],
  ['true', 'is true'],
  ['false', 'is false'],
  ['all', 'is any value'],
]);

const operandOf = (clause: QueryFilter): string =>
  OPERAND_ALIASES.get(clause.operand) ?? clause.operand;

/** The scope test for a clause, by its column's type, or undefined for an unknown operand. */
function scopeTest(schema: GridSchema, clause: QueryFilter): ScopeTest | undefined {
  const column: ColumnSchema | undefined = schema.columns.find((c) => c.key === clause.key);
  const operands =
    column?.dataType === 'boolean'
      ? BOOLEAN_SCOPE
      : column && isNumericColumn(column)
        ? NUMBER_SCOPE
        : STRING_SCOPE;
  return operands.get(operandOf(clause));
}

// --- executor --------------------------------------------------------------

/** Evaluate an {@link AnalyticsQuery} over the grid's rows. Pure. */
export function runAnalytics(
  query: AnalyticsQuery,
  data: readonly unknown[],
  schema: GridSchema
): AnalyticsResult {
  const allRows = data.filter(isRecord);
  const notes: string[] = [];
  const tests: Array<(row: Row) => boolean> = [];
  for (const clause of query.where ?? []) {
    const test = scopeTest(schema, clause);
    if (test) tests.push((row) => test(row[clause.key], clause.value));
    else {
      // Never drop a clause silently: the answer would cover the wrong rows.
      notes.push(
        `I cannot narrow ${labelOf(schema, clause.key)} with "${clause.operand}", so I did not compute this.`
      );
    }
  }
  const rows = notes.length > 0 ? [] : allRows.filter((row) => tests.every((test) => test(row)));
  const base: AnalyticsResult = {
    kind: query.kind,
    column: query.column,
    groupBy: query.groupBy,
    direction: query.direction,
    limit: query.limit,
    where: query.where,
    rowCount: rows.length,
    notes,
  };

  if (notes.length > 0) return base;
  if (allRows.length === 0) {
    notes.push('There is no data to analyze.');
    return base;
  }
  // An empty scope is reported as such, not as a column with nothing to compute.
  if (rows.length === 0) notes.push(`No rows match${scopeText(schema, query.where)}.`);

  if (query.kind === 'rank') {
    const column = query.column;
    if (!column) {
      notes.push('I need a column to rank by.');
      return base;
    }
    const label = query.labelColumn ?? column;
    const direction = query.direction ?? 'top';
    const limit = Math.max(1, query.limit ?? 1);
    const ranked = rows
      .map((row) => ({ label: String(row[label] ?? ''), value: toNumber(row[column]) }))
      .filter((r) => Number.isFinite(r.value))
      .sort((a, b) => (direction === 'top' ? b.value - a.value : a.value - b.value))
      .slice(0, limit);
    base.rows = ranked;
    if (ranked.length === 0) notes.push(`"${column}" has no numeric values to rank.`);
    return base;
  }

  if (query.kind === 'group') {
    const groupBy = query.groupBy;
    const func = query.metrics[0] ?? 'count';
    if (!groupBy) {
      notes.push('I need a column to group by.');
      return base;
    }
    const buckets = new Map<string, Row[]>();
    for (const row of rows) {
      const key = String(row[groupBy] ?? '');
      const bucket = buckets.get(key);
      if (bucket) bucket.push(row);
      else buckets.set(key, [row]);
    }
    let groups = [...buckets.entries()].map(([group, groupRows]) => ({
      group,
      value: computeMetric(func, groupRows, query.column).value,
    }));
    // The most common value per group is a label, not a quantity to rank by.
    if (query.direction && func !== 'mode') {
      const top = query.direction === 'top';
      const rank = (value: MetricValue['value']) =>
        typeof value === 'number'
          ? value
          : top
            ? Number.NEGATIVE_INFINITY
            : Number.POSITIVE_INFINITY;
      groups = groups.sort((a, b) =>
        top ? rank(b.value) - rank(a.value) : rank(a.value) - rank(b.value)
      );
      if (query.limit) groups = groups.slice(0, Math.max(1, query.limit));
    }
    base.groups = groups;
    base.metrics = [{ func, value: null }]; // carries the group func for the formatter
    return base;
  }

  // aggregate
  base.metrics = query.metrics.map((func) => computeMetric(func, rows, query.column));
  for (const metric of base.metrics) {
    if (metric.value === null && metric.func !== 'count') {
      notes.push(`I could not compute ${funcLabel(metric.func)} for "${query.column ?? 'that'}".`);
    }
  }
  return base;
}

// --- formatting ------------------------------------------------------------

function funcLabel(func: AnalyticsFunc): string {
  switch (func) {
    case 'min':
      return 'minimum';
    case 'max':
      return 'maximum';
    case 'avg':
      return 'average';
    case 'median':
      return 'median';
    case 'sum':
      return 'total';
    case 'count':
      return 'count';
    case 'distinct':
      return 'distinct';
    case 'range':
      return 'range';
    case 'stddev':
      return 'standard deviation';
    case 'mode':
      return 'most common';
  }
}

function renderValue(value: number | string | null): string {
  if (value === null) return 'n/a';
  return typeof value === 'number' ? formatNumber(value) : value;
}

function scopeText(schema: GridSchema, where: QueryFilter[] | undefined): string {
  if (!where || where.length === 0) return '';
  const parts = where.map((clause) => {
    const phrase = OPERAND_TEXT.get(operandOf(clause)) ?? clause.operand;
    const value = phrase.startsWith('is ') ? '' : ` ${clause.value}`;
    return `${labelOf(schema, clause.key)} ${phrase}${value}`;
  });
  return ` (${parts.join(', ')})`;
}

/** Render an {@link AnalyticsResult} as a concise natural-language answer. */
export function formatAnalyticsAnswer(result: AnalyticsResult, schema: GridSchema): string {
  if (result.rowCount === 0 && result.notes.length > 0) return result.notes[0];
  const column = labelOf(schema, result.column);
  const scope = scopeText(schema, result.where);

  if (result.kind === 'rank' && result.rows) {
    if (result.rows.length === 0) return result.notes[0] ?? 'Nothing to rank.';
    const superlative = result.direction === 'bottom' ? 'lowest' : 'highest';
    if (result.rows.length === 1) {
      const only = result.rows[0];
      return `${only.label} has the ${superlative} ${column} (${formatNumber(only.value)}).`;
    }
    const end = result.direction === 'bottom' ? 'Bottom' : 'Top';
    const list = result.rows.map((r) => `${r.label} ${formatNumber(r.value)}`).join('; ');
    return `${end} ${result.rows.length} by ${column}${scope}: ${list}.`;
  }

  if (result.kind === 'group' && result.groups) {
    const func = result.metrics?.[0]?.func ?? 'count';
    const dimension = labelOf(schema, result.groupBy);
    // A plain count has no measure column to name.
    const measure = column ? `${funcLabel(func)} ${column}` : funcLabel(func);
    if (result.groups.length === 0) return `No ${dimension} groups to report.`;
    const list = result.groups.map((g) => `${g.group} ${renderValue(g.value)}`).join('; ');
    if (func === 'mode') return `${capitalize(measure)} in each ${dimension}${scope}: ${list}.`;
    if (result.direction && result.limit === 1) {
      const top = result.groups[0];
      const superlative = result.direction === 'bottom' ? 'lowest' : 'highest';
      return `${top.group} has the ${superlative} ${measure} (${renderValue(top.value)}).`;
    }
    return `${capitalize(measure)} by ${dimension}${scope}: ${list}.`;
  }

  // aggregate
  const metrics = result.metrics ?? [];
  if (metrics.length === 0) return result.notes[0] ?? 'Nothing to compute.';
  if (metrics.length === 1) return singleMetricSentence(metrics[0], column, scope, result);
  const list = metrics.map((m) => `${funcLabel(m.func)} ${renderValue(m.value)}`).join('; ');
  return `${column}${scope}: ${list}.`;
}

function singleMetricSentence(
  metric: MetricValue,
  column: string,
  scope: string,
  result: AnalyticsResult
): string {
  const value = renderValue(metric.value);
  switch (metric.func) {
    case 'count':
      return scope ? `There are ${value} matching rows${scope}.` : `There are ${value} rows.`;
    case 'distinct':
      return `There are ${value} distinct ${column} values${scope}.`;
    case 'mode':
      return metric.value === null
        ? `There is no ${column} value to report.`
        : `The most common ${column} is ${value}${scope}.`;
    default:
      return metric.value === null
        ? (result.notes[0] ?? `I could not compute ${funcLabel(metric.func)} ${column}.`)
        : `The ${funcLabel(metric.func)} ${column} is ${value}${scope}.`;
  }
}

function capitalize(text: string): string {
  return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text;
}
