/**
 * Entity Resolver: turn an {@link Intent}'s raw slots into grounded values against
 * the schema, the live state, and conversation memory. Column names are matched
 * exactly, then case-insensitively, then by a bounded fuzzy match (so "reginn"
 * resolves to "region"); filter operators map to a valid per-column operand; values
 * are typed per the column; a bare "reverse" reads the active sort; and pronouns
 * ("it" / "those") resolve against `memory.lastEntities`. Errors are collected, not
 * thrown, so the planner can degrade to a helpful no-op.
 *
 * @see plans/ai-reasoning-layer-spec.md (section 4.5)
 */

import type { ColumnSchema, SortingDirection } from 'apex-grid';
import type { AggregationFn } from '../aggregation.js';
import type { AnalyticsFunc, AnalyticsQuery, QueryFilter } from './analytics.js';
import type { GridContext } from './context.js';
import type { Intent } from './types.js';

/** Grounded entities for the planner. `columns` is order-preserving and may be empty. */
export interface ResolveResult {
  columns: ColumnSchema[];
  direction?: SortingDirection;
  operand?: string;
  value?: unknown;
  aggFunc?: AggregationFn;
  text?: string;
  page?: number;
  pageSize?: number;
  visibility?: 'show' | 'hide';
  pin?: 'start' | 'end' | null;
  reverse?: boolean;
  format?: string;
  /** A read-only analytics query, for the `analyze` intent. */
  query?: AnalyticsQuery;
  errors: string[];
  usedMemory?: boolean;
}

/** Grounds an {@link Intent} against a {@link GridContext}. */
export interface EntityResolver {
  resolve(intent: Intent, ctx: GridContext): ResolveResult;
}

const DESCENDING_RE = /desc|descending|high|highest|large|largest|most|top|z-?a|z to a/i;
const PRONOUN_RE = /^(?:it|that|those|them|this|these)$/i;

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array.from({ length: n + 1 }, () => 0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function isNumericColumn(column: ColumnSchema): boolean {
  return column.dataType === 'number' || column.dataType === 'currency';
}

/** Resolve one column name: exact key/label, then substring, then bounded fuzzy. */
function resolveColumn(name: string, ctx: GridContext): ColumnSchema | undefined {
  const target = name.trim().toLowerCase();
  if (!target) return undefined;
  const columns = ctx.columns;

  const exact = columns.find(
    (c) => c.key.toLowerCase() === target || c.label.toLowerCase() === target
  );
  if (exact) return exact;

  const partial = columns.find((c) => {
    const key = c.key.toLowerCase();
    const label = c.label.toLowerCase();
    return (
      label.includes(target) ||
      key.includes(target) ||
      target.includes(key) ||
      target.includes(label)
    );
  });
  if (partial) return partial;

  let best: { column: ColumnSchema; distance: number } | undefined;
  for (const column of columns) {
    const distance = Math.min(
      editDistance(target, column.key.toLowerCase()),
      editDistance(target, column.label.toLowerCase())
    );
    if (!best || distance < best.distance) best = { column, distance };
  }
  return best && best.distance <= 2 ? best.column : undefined;
}

/** Resolve a possibly multi-column phrase ("region and product"), or a pronoun via memory. */
function resolveColumns(
  phrase: string,
  ctx: GridContext
): { columns: ColumnSchema[]; usedMemory: boolean; errors: string[] } {
  const trimmed = phrase.trim();
  if (PRONOUN_RE.test(trimmed)) {
    const remembered = ctx.memory.lastEntities?.columns ?? [];
    const columns = remembered
      .map((key) => ctx.columns.find((c) => c.key === key))
      .filter((c): c is ColumnSchema => c !== undefined);
    return {
      columns,
      usedMemory: true,
      errors: columns.length > 0 ? [] : ['I do not have an earlier column to refer to.'],
    };
  }

  const parts = trimmed
    .split(/\s*(?:,| and | then | & )\s*/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const columns: ColumnSchema[] = [];
  const errors: string[] = [];
  for (const part of parts) {
    const column = resolveColumn(part, ctx);
    if (column) columns.push(column);
    else errors.push(`No column matches "${part}".`);
  }
  return { columns, usedMemory: false, errors };
}

function resolveDirection(text: string | undefined): SortingDirection {
  return text && DESCENDING_RE.test(text) ? 'descending' : 'ascending';
}

/** Map a natural-language operator to candidate operand names (longest/most-specific first). */
function operandCandidates(op: string): string[] {
  const o = op.trim().toLowerCase();
  if (/^(?:!=|is not|not equals?)$/.test(o)) return ['doesNotEqual', 'notEquals'];
  if (/^(?:=|==|is|equals?)$/.test(o)) return ['equals'];
  if (/contains?|has|includes?/.test(o)) return ['contains'];
  if (/starts with/.test(o)) return ['startsWith'];
  if (/ends with/.test(o)) return ['endsWith'];
  if (/>=|greater than or equal|at least/.test(o))
    return ['greaterThanOrEqual', 'greaterThanOrEqualTo'];
  if (/<=|less than or equal|at most/.test(o)) return ['lessThanOrEqual', 'lessThanOrEqualTo'];
  if (/>|greater than|more than|over|above/.test(o)) return ['greaterThan'];
  if (/<|less than|under|below/.test(o)) return ['lessThan'];
  return ['equals'];
}

/** Pick the first candidate the column advertises; fall back to its first operand (never invalid). */
function pickOperand(column: ColumnSchema, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (column.filterOperands.includes(candidate)) return candidate;
  }
  return column.filterOperands[0];
}

function typeValue(raw: string, column: ColumnSchema): unknown {
  const unquoted = raw.trim().replace(/^["']|["']$/g, '');
  if (isNumericColumn(column)) {
    const match = unquoted.replace(/[$,]/g, '').match(/^(-?[\d.]+)\s*([km])?$/i);
    if (match) {
      let n = Number(match[1]);
      if (match[2]?.toLowerCase() === 'k') n *= 1_000;
      if (match[2]?.toLowerCase() === 'm') n *= 1_000_000;
      if (Number.isFinite(n)) return n;
    }
    return unquoted;
  }
  return unquoted;
}

/** Like {@link pickOperand} but never falls back: returns undefined if none is advertised. */
function pickOperandStrict(column: ColumnSchema, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (column.filterOperands.includes(candidate)) return candidate;
  }
  return undefined;
}

// --- filter predicate parsing (order-agnostic; for remove / keep / exclude) ---------

/** Comparison operators, longest / most-specific first so the leftmost match is greedy-correct. */
const OP_RE =
  /(?:is not|isn'?t|does(?:n'?t| not) equal(?:s| to)?|not equal(?:s| to)?|greater than or equal(?: to)?|less than or equal(?: to)?|greater than|less than|more than|fewer than|at least|at most|starts? with|ends? with|equals?|contains?|includes?|\bis\b|\bhas\b|over|above|under|below|>=|<=|<>|!=|==|=|>|<)/i;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Remove the first column mention (key or label) from the text; return it and the remainder. */
function extractColumnSpan(
  text: string,
  ctx: GridContext
): { column: ColumnSchema; rest: string } | null {
  let best: { column: ColumnSchema; index: number; length: number } | undefined;
  for (const column of ctx.columns) {
    for (const name of [column.label, column.key]) {
      const match = text.match(new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i'));
      if (match?.index !== undefined && (!best || match.index < best.index)) {
        best = { column, index: match.index, length: match[0].length };
      }
    }
  }
  if (!best) return null;
  const rest = `${text.slice(0, best.index)} ${text.slice(best.index + best.length)}`
    .replace(/\s+/g, ' ')
    .trim();
  return { column: best.column, rest };
}

/** Parse a condition into a grounded `{ column, operator, value }`, either argument order. */
function parseComparison(
  text: string,
  ctx: GridContext
): { column: ColumnSchema; operator: string; value: unknown } | null {
  const cleaned = text
    .trim()
    .replace(
      /^(?:the\s+)?rows?\s+(?:that\s+(?:have|has|are|is)\s+|with\s+|where\s+|having\s+|containing\s+)/i,
      ''
    )
    .trim();
  const found = extractColumnSpan(cleaned, ctx);
  if (found) {
    // Drop a leading copula ("amount IS greater than 5") so the real operator is read,
    // but keep "is not" intact (that IS the operator).
    const rest = found.rest.replace(/^(?:is|are|was|were|be|been)\s+(?!not\b)/i, '').trim();
    const opMatch = rest.match(OP_RE);
    const operator = opMatch ? opMatch[0] : '=';
    const value = rest.replace(OP_RE, ' ').replace(/\s+/g, ' ').trim();
    if (value === '') return null;
    return { column: found.column, operator, value: typeValue(value, found.column) };
  }
  // No column named: treat a bare value ("Engineering") as identifying its column.
  const byValue = findColumnByValue(cleaned.toLowerCase(), ctx);
  if (byValue) {
    const column = ctx.columns.find((c) => c.key === byValue.key);
    if (column) return { column, operator: '=', value: byValue.value };
  }
  return null;
}

/** Operand-name candidates for the NEGATION of a comparison ("remove"/"exclude" keeps the complement). */
function invertedOperandCandidates(operator: string): string[] {
  const o = operator.trim().toLowerCase();
  if (/>=|greater than or equal|at least/.test(o)) return ['lessThan'];
  if (/<=|less than or equal|at most/.test(o)) return ['greaterThan'];
  if (/>|greater than|more than|over|above/.test(o))
    return ['lessThanOrEqual', 'lessThanOrEqualTo', 'lessThan'];
  if (/<|less than|under|below|fewer/.test(o))
    return ['greaterThanOrEqual', 'greaterThanOrEqualTo', 'greaterThan'];
  if (/is not|isn'?t|!=|<>|does.*equal|not equal/.test(o)) return ['equals'];
  if (/contains?|includes?|has/.test(o)) return []; // no standard "not contains" -> inexpressible
  return ['doesNotEqual', 'notEquals'];
}

function resolveAggFunc(text: string | undefined): AggregationFn {
  const t = (text ?? '').toLowerCase();
  if (/average|avg|mean/.test(t)) return 'avg';
  if (/count/.test(t)) return 'count';
  if (/min/.test(t)) return 'min';
  if (/max/.test(t)) return 'max';
  return 'sum';
}

function resolvePin(text: string | undefined): 'start' | 'end' {
  return text && /right|end/i.test(text) ? 'end' : 'start';
}

function normalizeFormat(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return /excel|xlsx/i.test(text) ? 'xlsx' : text.toLowerCase();
}

// --- analytics query parsing (the `analyze` intent) ------------------------

/** Metric keywords, in the canonical output order the answer uses. */
const METRIC_PATTERNS: Array<[AnalyticsFunc, RegExp]> = [
  ['min', /\b(?:min|minimum|lowest|smallest|least|cheapest)\b/i],
  ['max', /\b(?:max|maximum|highest|largest|biggest|greatest|most|dearest)\b/i],
  ['avg', /\b(?:average|avg|mean)\b/i],
  ['median', /\bmedian\b/i],
  ['sum', /\b(?:sum|total)\b/i],
  ['count', /\b(?:count|how many|number of)\b/i],
  ['distinct', /\b(?:distinct|unique)\b/i],
  ['range', /\b(?:range|spread)\b/i],
  ['stddev', /\b(?:std\s*-?\s*dev|standard deviation|deviation|variance)\b/i],
  ['mode', /\b(?:most common|most frequent|mode of)\b/i],
];

const GROUPBY_RE =
  /\b(?:by|per|for each|grouped by|across)\s+([a-z][a-z0-9 ]*?)(?:\s*$|\s+(?:where|in|for|over|under|above|below|greater|less|more|at least|at most)\b)/i;
const WHICH_DIM_RE =
  /\b(?:which|what)\s+([a-z][a-z0-9 ]*?)\s+(?:has|have|had|shows?|gets?|earns?)\b/i;
const TOPN_RE = /\b(top|bottom)\s+(\d+)\b/i;
const WHO_RE = /\bwho(?:m|se)?\b/i;
const SUPER_TOP_RE = /\b(?:highest|most|largest|biggest|greatest|max(?:imum)?|dearest|top)\b/i;
const SUPER_BOTTOM_RE = /\b(?:lowest|least|smallest|cheapest|min(?:imum)?|bottom)\b/i;
const NUM_SCOPE_RE =
  /\b(over|above|more than|greater than or equal|greater than|at least|under|below|less than or equal|less than|at most)\s+\$?([\d][\d,]*\.?\d*)\s*([km])?\b/i;
const IN_SCOPE_RE =
  /\b(?:in|for|within|from)\s+([a-z0-9][\w '&-]*?)(?:\s*$|\s+(?:by|per|where|over|under|above|below|group|and)\b)/i;

/** Every metric keyword present, in canonical order (fixes the old first-match bug). */
function detectMetrics(raw: string): AnalyticsFunc[] {
  const out: AnalyticsFunc[] = [];
  for (const [func, pattern] of METRIC_PATTERNS) if (pattern.test(raw)) out.push(func);
  return out;
}

/** Columns whose key or label appears in the utterance, in order of first mention. */
function mentionedColumns(raw: string, ctx: GridContext): ColumnSchema[] {
  const lower = raw.toLowerCase();
  const hits: Array<{ column: ColumnSchema; at: number }> = [];
  for (const column of ctx.columns) {
    const positions = [
      lower.indexOf(column.key.toLowerCase()),
      lower.indexOf(column.label.toLowerCase()),
    ].filter((i) => i >= 0);
    if (positions.length > 0) hits.push({ column, at: Math.min(...positions) });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.column);
}

/** The column that best names a row in a rank answer (a name/title, else a string col). */
function pickLabelColumn(ctx: GridContext, measureKey: string): string {
  const named = ctx.columns.find((c) => /name|title|label|\bid\b/i.test(c.key));
  if (named) return named.key;
  const str = ctx.columns.find((c) => c.dataType === 'string' && c.key !== measureKey);
  return str?.key ?? ctx.columns[0]?.key ?? measureKey;
}

/** Parse "90k" / "1.5m" / "1,200" to a number. */
function parseScopeNumber(digits: string, suffix: string | undefined): number {
  let n = Number(digits.replace(/,/g, ''));
  if (suffix?.toLowerCase() === 'k') n *= 1_000;
  if (suffix?.toLowerCase() === 'm') n *= 1_000_000;
  return n;
}

/** Build scope `where` clauses: categorical "in X" (matched against the data) + numeric "over N". */
function buildScope(raw: string, ctx: GridContext, measureKey: string | undefined): QueryFilter[] {
  const where: QueryFilter[] = [];

  const numMatch = raw.match(NUM_SCOPE_RE);
  if (numMatch) {
    const operand = pickComparisonOperand(numMatch[1]);
    const value = parseScopeNumber(numMatch[2], numMatch[3]);
    const numericCols = ctx.columns.filter(isNumericColumn);
    const target =
      numericCols.find((c) => measureKey && c.key === measureKey) ??
      mentionedColumns(raw, ctx).find(isNumericColumn) ??
      numericCols[0];
    if (target && Number.isFinite(value)) where.push({ key: target.key, operand, value });
  }

  const inMatch = raw.match(IN_SCOPE_RE);
  if (inMatch) {
    const phrase = inMatch[1].trim().toLowerCase();
    const found = findColumnByValue(phrase, ctx);
    if (found) where.push({ key: found.key, operand: 'equals', value: found.value });
  }

  return where;
}

/** Map a comparison word to a filter operand (independent of any column's advertised set). */
function pickComparisonOperand(word: string): string {
  const w = word.toLowerCase();
  if (/greater than or equal|at least/.test(w)) return 'greaterThanOrEqual';
  if (/less than or equal|at most/.test(w)) return 'lessThanOrEqual';
  if (/over|above|more than|greater than/.test(w)) return 'greaterThan';
  return 'lessThan';
}

/** Find a column whose sampled data contains `phrase` as a value; return the original-cased value. */
function findColumnByValue(
  phrase: string,
  ctx: GridContext
): { key: string; value: unknown } | undefined {
  for (const column of ctx.columns) {
    if (isNumericColumn(column)) continue;
    for (const row of ctx.data.sample as ReadonlyArray<Record<string, unknown>>) {
      const cell = row[column.key];
      if (cell !== null && cell !== undefined && String(cell).toLowerCase() === phrase) {
        return { key: column.key, value: cell };
      }
    }
  }
  return undefined;
}

/** Turn an analytical utterance into an {@link AnalyticsQuery}, or collect why it could not. */
function buildAnalyticsQuery(
  raw: string,
  ctx: GridContext
): { query?: AnalyticsQuery; errors: string[] } {
  const errors: string[] = [];
  const metrics = detectMetrics(raw);
  const mentioned = mentionedColumns(raw, ctx);
  const numericMentioned = mentioned.filter(isNumericColumn);

  const topN = raw.match(TOPN_RE);
  const superTop = SUPER_TOP_RE.test(raw);
  const superBottom = SUPER_BOTTOM_RE.test(raw);

  // rank (whole rows): "top/bottom N ...", or "who has the highest/lowest ...".
  if (topN || (WHO_RE.test(raw) && (superTop || superBottom))) {
    const byPhrase = raw.match(GROUPBY_RE);
    const column = (byPhrase ? resolveColumn(byPhrase[1], ctx) : undefined) ?? numericMentioned[0];
    if (!column || !isNumericColumn(column)) {
      return { errors: ['Tell me which numeric column to rank by.'] };
    }
    const direction: 'top' | 'bottom' = topN
      ? /bottom/i.test(topN[1])
        ? 'bottom'
        : 'top'
      : superBottom && !superTop
        ? 'bottom'
        : 'top';
    const limit = topN ? Number(topN[2]) : 1;
    return {
      query: {
        kind: 'rank',
        metrics: [],
        column: column.key,
        direction,
        limit,
        labelColumn: pickLabelColumn(ctx, column.key),
        where: optional(buildScope(raw, ctx, column.key)),
      },
      errors,
    };
  }

  // dimension: "by X" or "which X has ...".
  const byMatch = raw.match(GROUPBY_RE);
  const whichMatch = byMatch ? null : raw.match(WHICH_DIM_RE);
  const groupCol =
    (byMatch ? resolveColumn(byMatch[1], ctx) : undefined) ??
    (whichMatch ? resolveColumn(whichMatch[1], ctx) : undefined);

  const measure = numericMentioned.find((c) => !groupCol || c.key !== groupCol.key) ?? undefined;

  if (groupCol) {
    // A superlative ("highest"/"lowest") is the ranking DIRECTION, not the metric, so
    // the aggregation is any non-extremal metric present (total/average/median/...).
    // Rank the groups when the dimension came from "which X ..." or a superlative pairs
    // with such a metric ("highest total revenue"); otherwise report every group.
    const aggregation = metrics.find((m) => m !== 'count' && m !== 'min' && m !== 'max');
    const ranked = Boolean(whichMatch) || ((superTop || superBottom) && aggregation !== undefined);
    const func: AnalyticsFunc = ranked
      ? (aggregation ?? (measure ? 'sum' : 'count'))
      : (metrics.find((m) => m !== 'count') ?? (measure ? 'sum' : 'count'));
    return {
      query: {
        kind: 'group',
        metrics: [func],
        column: func === 'count' ? undefined : measure?.key,
        groupBy: groupCol.key,
        direction: ranked ? (superBottom && !superTop ? 'bottom' : 'top') : undefined,
        limit: ranked ? 1 : undefined,
        where: optional(buildScope(raw, ctx, measure?.key)),
      },
      errors,
    };
  }

  // aggregate (scalar metrics).
  const funcs =
    metrics.length > 0
      ? metrics
      : measure
        ? (['sum'] as AnalyticsFunc[])
        : (['count'] as AnalyticsFunc[]);
  const needsColumn = funcs.some((f) => f !== 'count' && f !== 'distinct' && f !== 'mode');
  const column = measure?.key ?? mentioned[0]?.key;
  if (needsColumn && !column) {
    return { errors: [`Tell me which column to measure.${columnList(ctx)}`] };
  }
  return {
    query: {
      kind: 'aggregate',
      metrics: funcs,
      column,
      where: optional(buildScope(raw, ctx, column)),
    },
    errors,
  };
}

function optional(where: QueryFilter[]): QueryFilter[] | undefined {
  return where.length > 0 ? where : undefined;
}

function columnList(ctx: GridContext): string {
  const labels = ctx.columns.slice(0, 6).map((c) => c.label);
  return labels.length > 0 ? ` Try a column like: ${labels.join(', ')}.` : '';
}

class DefaultEntityResolver implements EntityResolver {
  resolve(intent: Intent, ctx: GridContext): ResolveResult {
    const errors: string[] = [];
    const result: ResolveResult = { columns: [], errors };

    switch (intent.kind) {
      case 'sort': {
        if (intent.slots.reverse) {
          const current = ctx.state.sort[0];
          if (current) {
            const column = ctx.columns.find((c) => c.key === current.key);
            if (column) result.columns = [column];
            result.direction = current.direction === 'descending' ? 'ascending' : 'descending';
            result.reverse = true;
          } else {
            errors.push('There is no active sort to reverse.');
          }
          break;
        }
        const resolved = resolveColumns(intent.slots.column?.text ?? '', ctx);
        result.columns = resolved.columns;
        result.usedMemory = resolved.usedMemory;
        errors.push(...resolved.errors);
        result.direction = resolveDirection(intent.slots.direction?.text);
        break;
      }
      case 'filter': {
        // Broadened path: a "remove / keep / exclude ... <predicate>" rule captured a
        // free-form predicate (either argument order). Removal keeps the complement.
        const predicate = intent.slots.predicate;
        if (predicate) {
          const remove = intent.slots.polarityVerb !== undefined;
          const parsed = parseComparison(predicate.text, ctx);
          if (!parsed) {
            errors.push(`I could not read a condition from "${predicate.text}".`);
            break;
          }
          const operand = remove
            ? pickOperandStrict(parsed.column, invertedOperandCandidates(parsed.operator))
            : pickOperand(parsed.column, operandCandidates(parsed.operator));
          if (operand === undefined) {
            errors.push(
              `This grid can't ${remove ? 'exclude' : 'filter'} by that ${parsed.column.label} condition.`
            );
            break;
          }
          result.columns = [parsed.column];
          result.operand = operand;
          result.value = parsed.value;
          break;
        }
        const resolved = resolveColumns(intent.slots.column?.text ?? '', ctx);
        result.usedMemory = resolved.usedMemory;
        errors.push(...resolved.errors);
        const column = resolved.columns[0];
        if (column) {
          result.columns = [column];
          result.operand = pickOperand(
            column,
            operandCandidates(intent.slots.operator?.text ?? '=')
          );
          result.value = typeValue(intent.slots.value?.text ?? '', column);
        }
        break;
      }
      case 'group':
      case 'pivot': {
        const key = intent.kind === 'pivot' ? 'column' : 'columns';
        const resolved = resolveColumns(intent.slots[key]?.text ?? '', ctx);
        result.columns = resolved.columns;
        result.usedMemory = resolved.usedMemory;
        errors.push(...resolved.errors);
        break;
      }
      case 'aggregate': {
        const resolved = resolveColumns(intent.slots.column?.text ?? '', ctx);
        result.columns = resolved.columns;
        errors.push(...resolved.errors);
        result.aggFunc = resolveAggFunc(intent.slots.func?.text);
        break;
      }
      case 'columns': {
        if (intent.slots.pinColumn) {
          const column = resolveColumn(intent.slots.pinColumn.text, ctx);
          if (column) {
            result.columns = [column];
            result.pin = resolvePin(intent.slots.pinSide?.text);
          } else {
            errors.push(`No column matches "${intent.slots.pinColumn.text}".`);
          }
          break;
        }
        const name = intent.slots.column?.text ?? '';
        const column = resolveColumn(name, ctx);
        if (column) {
          result.columns = [column];
          result.visibility = /hide/i.test(intent.slots.action?.text ?? '') ? 'hide' : 'show';
        } else {
          errors.push(`No column matches "${name}".`);
        }
        break;
      }
      case 'analyze': {
        const built = buildAnalyticsQuery(intent.raw, ctx);
        result.query = built.query;
        errors.push(...built.errors);
        break;
      }
      case 'quick-filter':
        result.text = (intent.slots.text?.text ?? '').replace(/^["']|["']$/g, '');
        break;
      case 'paginate':
        if (intent.slots.page) result.page = Number(intent.slots.page.text);
        if (intent.slots.pageSize) result.pageSize = Number(intent.slots.pageSize.text);
        break;
      case 'export':
        result.format = normalizeFormat(intent.slots.format?.text);
        break;
      default:
        break;
    }
    return result;
  }
}

/** Create the default {@link EntityResolver}. */
export function createEntityResolver(): EntityResolver {
  return new DefaultEntityResolver();
}
