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

import type { GridSchema } from 'apex-grid';

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

/** A scope clause, reusing the grid's filter-operand vocabulary. */
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
  /** `group`: one row per group. */
  groups?: Array<{ group: string; value: number | null }>;
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

/** Round to 2 decimals and render raw (no locale separators, for deterministic output). */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return String(Math.round(n * 100) / 100);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value.replace(/[$,]/g, ''));
  return Number.NaN;
}

// --- statistics ------------------------------------------------------------

function numericValues(rows: readonly Row[], column: string): number[] {
  return rows.map((row) => toNumber(row[column])).filter((n) => Number.isFinite(n));
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
function computeMetric(
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
      return { func, value: Math.min(...values) };
    case 'max':
      return { func, value: Math.max(...values) };
    case 'sum':
      return { func, value: values.reduce((s, n) => s + n, 0) };
    case 'avg':
      return { func, value: values.reduce((s, n) => s + n, 0) / values.length };
    case 'median':
      return { func, value: median(values) };
    case 'range':
      return { func, value: Math.max(...values) - Math.min(...values) };
    case 'stddev':
      return { func, value: stddev(values) };
    default:
      return { func, value: null };
  }
}

// --- scope (where) ---------------------------------------------------------

function matchesFilter(row: Row, clause: QueryFilter): boolean {
  const cell = row[clause.key];
  const target = clause.value;
  switch (clause.operand) {
    case 'equals':
      return String(cell).toLowerCase() === String(target).toLowerCase();
    case 'doesNotEqual':
    case 'notEquals':
      return String(cell).toLowerCase() !== String(target).toLowerCase();
    case 'contains':
      return String(cell).toLowerCase().includes(String(target).toLowerCase());
    case 'greaterThan':
      return toNumber(cell) > toNumber(target);
    case 'lessThan':
      return toNumber(cell) < toNumber(target);
    case 'greaterThanOrEqual':
    case 'greaterThanOrEqualTo':
      return toNumber(cell) >= toNumber(target);
    case 'lessThanOrEqual':
    case 'lessThanOrEqualTo':
      return toNumber(cell) <= toNumber(target);
    default:
      return true;
  }
}

function applyScope(rows: readonly Row[], where: QueryFilter[] | undefined): readonly Row[] {
  if (!where || where.length === 0) return rows;
  return rows.filter((row) => where.every((clause) => matchesFilter(row, clause)));
}

// --- executor --------------------------------------------------------------

/** Evaluate an {@link AnalyticsQuery} over the grid's rows. Pure. */
export function runAnalytics(
  query: AnalyticsQuery,
  data: readonly unknown[],
  _schema: GridSchema
): AnalyticsResult {
  const allRows = data.filter(isRecord);
  const rows = applyScope(allRows, query.where);
  const notes: string[] = [];
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

  if (allRows.length === 0) {
    notes.push('There is no data to analyze.');
    return base;
  }

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
      value: numericOrNull(computeMetric(func, groupRows, query.column).value),
    }));
    if (query.direction) {
      groups = groups.sort((a, b) =>
        query.direction === 'top'
          ? (b.value ?? Number.NEGATIVE_INFINITY) - (a.value ?? Number.NEGATIVE_INFINITY)
          : (a.value ?? Number.POSITIVE_INFINITY) - (b.value ?? Number.POSITIVE_INFINITY)
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

function numericOrNull(value: number | string | null): number | null {
  return typeof value === 'number' ? value : null;
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
    const label = labelOf(schema, clause.key);
    if (clause.operand === 'greaterThan') return `${label} > ${clause.value}`;
    if (clause.operand === 'lessThan') return `${label} < ${clause.value}`;
    if (clause.operand === 'greaterThanOrEqual' || clause.operand === 'greaterThanOrEqualTo')
      return `${label} >= ${clause.value}`;
    if (clause.operand === 'lessThanOrEqual' || clause.operand === 'lessThanOrEqualTo')
      return `${label} <= ${clause.value}`;
    return `${label} = ${clause.value}`;
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
    if (result.groups.length === 0) return `No ${dimension} groups to report.`;
    if (result.direction && result.limit === 1 && result.groups.length >= 1) {
      const top = result.groups[0];
      const superlative = result.direction === 'bottom' ? 'lowest' : 'highest';
      return `${top.group} has the ${superlative} ${funcLabel(func)} ${column} (${renderValue(top.value)}).`;
    }
    const list = result.groups.map((g) => `${g.group} ${renderValue(g.value)}`).join('; ');
    return `${capitalize(funcLabel(func))} ${column} by ${dimension}${scope}: ${list}.`;
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
