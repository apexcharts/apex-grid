/**
 * Intent Detection: classify an utterance into an {@link IntentKind} with a
 * confidence, capturing the raw spans (column names, values, directions) it
 * carries. The default detector is lexical: a table of scored patterns, a
 * productionized generalization of the old mock's regex list. It is a pure
 * function of the utterance (the context is available for future
 * schema-aware scoring but the default does not need it). The leftmost matching
 * rule wins (confidence breaks a tie at the same position) and anything unmatched
 * is `unknown`.
 *
 * @see plans/ai-reasoning-layer-spec.md (section 4.4)
 */

import type { GridContext } from './context.js';
import type { Intent, IntentKind, RawSlot } from './types.js';

/** Classifies an utterance. */
export interface IntentDetector {
  detect(utterance: string, ctx: GridContext): Intent;
}

interface IntentRule {
  kind: IntentKind;
  confidence: number;
  /** Uses the `d` flag so capture-group offsets are available for {@link RawSlot}. */
  pattern: RegExp;
  /** Map capture-group numbers to named slots. */
  groups?: Record<string, number>;
  /** A generic fallback: any other matching rule wins over it, wherever it matched. */
  fallback?: boolean;
  /**
   * A generic control command whose words also open analytical questions ("max and
   * median of bonus", "show top 5 by salary", "find distinct countries"): any `analyze`
   * match wins over it, wherever it matched.
   */
  yieldsToAnalyze?: boolean;
}

/** Build the named {@link RawSlot} map for a match, using capture-group offsets when present. */
function slotsFrom(
  match: RegExpMatchArray,
  groups: Record<string, number>
): Record<string, RawSlot> {
  const slots: Record<string, RawSlot> = {};
  for (const [name, group] of Object.entries(groups)) {
    const text = match[group];
    if (text === undefined) continue;
    const at = match.indices?.[group];
    const start = at ? at[0] : (match.index ?? 0);
    const end = at ? at[1] : start + text.length;
    slots[name] = { text: text.trim(), start, end };
  }
  return slots;
}

/**
 * One character of a column name in a command. Unicode letters plus the punctuation
 * real headers carry ("E-mail", "Owner's Name", "Growth %", "No.", "Categoría"); the
 * resolver grounds the span against the real column names.
 */
const NAME = "[\\p{L}\\p{N}\\p{M}_ '’#%./&()-]";
/** {@link NAME} plus the comma that separates several columns. */
const NAMES = "[\\p{L}\\p{N}\\p{M}_ ,'’#%./&()-]";
/**
 * {@link NAME} that stops before a trailing clause ("show salary where age is over 30"),
 * so the clause reaches the filter rule instead of being read as part of a column name.
 */
const SPAN_NAME = `(?:(?!\\s+(?:where|with|whose|having)\\b)${NAME})`;
/** A sort direction word; a range ("high to low") is read by its first endpoint. */
const DIRECTION =
  '(?:asc(?:ending)?|desc(?:ending)?|a-z|z-a|a to z|z to a|high(?:est)?|low(?:est)?|large(?:st)?|small(?:est)?|biggest|most|least|newest|latest|oldest|earliest)';

/** A polite opener for a whole-command rule: "please", "can you", "could you please". */
const POLITE = '(?:please\\s+|(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?)?';
/** A polite closer and end punctuation for a whole-command rule. */
const PLEASE = '(?:,?\\s+please)?\\s*[.!?]?';

/** A Unicode-aware pattern with capture offsets (`d`), case-insensitive. */
const rule = (source: string) => new RegExp(source, 'diu');

// Detection picks the match that starts leftmost (the command verb comes first, so a
// command word inside a column label never wins); confidence breaks a tie at the same
// position, a generic `ask` fallback loses to any other match, and the generic aggregate,
// show and find commands lose to any analytical question. Confidences encode
// specificity (a keyworded command outranks a bare question marker).
const RULES: IntentRule[] = [
  // Reset and undo only as whole commands, so "go back to page 1" or "search for undo"
  // reach their own rule instead of discarding the view. Clearing only the filters or
  // only the sort is its own command below, not a full reset.
  {
    kind: 'reset',
    confidence: 0.9,
    pattern: rule(
      `^${POLITE}(?:reset|clear all|clear everything|start over)(?:\\s+(?:everything|all|it all|the view|the grid|the table|view|grid|table))?${PLEASE}$`
    ),
  },
  {
    kind: 'undo',
    confidence: 0.85,
    pattern: rule(
      `^${POLITE}(?:undo|revert|go back)(?:\\s+(?:(?:the\\s+)?(?:last|previous)(?:\\s+\\p{L}+)?|(?:that|this|the)(?:\\s+\\p{L}+)?|it|once))?${PLEASE}$`
    ),
  },
  {
    kind: 'filter',
    confidence: 0.85,
    pattern: rule(
      `^${POLITE}(?:clear|reset|remove)\\s+(?:all\\s+)?(?:the\\s+)?(?:column\\s+)?filters?${PLEASE}$`
    ),
    groups: { clear: 0 },
  },
  {
    kind: 'sort',
    confidence: 0.85,
    pattern: rule(
      `^${POLITE}(?:clear|reset|remove)\\s+(?:all\\s+)?(?:the\\s+)?sort(?:ing|s)?${PLEASE}$`
    ),
    groups: { clear: 0 },
  },
  {
    kind: 'ungroup',
    confidence: 0.85,
    pattern: /\b(?:ungroup|remove (?:the )?group(?:ing)?|clear group(?:ing)?)\b/di,
  },
  // "reverse the sort" / "the other way" (anaphora: reverse the active sort)
  {
    kind: 'sort',
    confidence: 0.72,
    pattern: /\b(?:reverse|flip|other way|opposite order)\b/di,
    groups: { reverse: 0 },
  },
  {
    kind: 'sort',
    confidence: 0.82,
    pattern: rule(
      `\\b(?:sort|order)(?:\\s+by)?\\s+(${NAMES}+?)(?:,?\\s+(?:from\\s+)?(${DIRECTION}(?:\\s+to\\s+${DIRECTION})?)(?:\\s+first)?(?:\\s+order)?)?\\s*$`
    ),
    groups: { column: 1, direction: 2 },
  },
  {
    kind: 'group',
    confidence: 0.82,
    pattern: rule(`\\bgroup(?:\\s+rows)?(?:\\s+by)?\\s+(${NAMES}+?)\\s*$`),
    groups: { columns: 1 },
  },
  {
    kind: 'pivot',
    confidence: 0.8,
    pattern: rule(`\\bpivot(?:\\s+(?:on|by))?\\s+(${NAME}+?)\\s*$`),
    groups: { column: 1 },
  },
  {
    kind: 'aggregate',
    confidence: 0.7,
    pattern: rule(
      `\\b(sum|total|average|avg|mean|count|min(?:imum)?|max(?:imum)?)\\s+(?:of\\s+)?(${SPAN_NAME}+?)\\s*$`
    ),
    groups: { func: 1, column: 2 },
    yieldsToAnalyze: true,
  },
  // A condition, in either argument order: the resolver grounds the column against the
  // real names and reads the operator from one table, so an operator spelled inside a
  // column name ("discount", "visits") is never split out of it.
  {
    kind: 'filter',
    confidence: 0.82,
    pattern: /\b(?:filter|where|only show|show only)\s+(?:by\s+)?(.+?)\s*$/di,
    groups: { predicate: 1 },
  },
  // Remove / exclude rows matching a condition -> a filter that keeps the complement
  // (the operand is inverted in the resolver). Requires "rows" so "remove grouping" /
  // "hide <column>" still route to ungroup / columns.
  {
    kind: 'filter',
    confidence: 0.83,
    pattern:
      /\b(remove|exclude|drop|get rid of|hide)\s+(?:all\s+)?(?:the\s+)?rows?\s*(?:that\s+(?:have|has|are|is)\s+|with\s+|where\s+|having\s+|containing\s+)?(.+?)\s*$/di,
    groups: { polarityVerb: 1, predicate: 2 },
  },
  // Keep only / show only rows matching a condition -> a positive filter.
  {
    kind: 'filter',
    confidence: 0.83,
    pattern:
      /\b(keep only|only keep|keep|include only|retain|show only|only show)\s+(?:the\s+)?(?:rows?\s*)?(?:that\s+(?:have|has|are|is)\s+|with\s+|where\s+|having\s+|containing\s+)?(.+?)\s*$/di,
    groups: { keepVerb: 1, predicate: 2 },
  },
  {
    kind: 'columns',
    confidence: 0.8,
    pattern: rule(`\\b(hide)\\s+(?:the\\s+)?(?:column\\s+)?(${SPAN_NAME}+?)(?:\\s+column)?\\s*$`),
    groups: { action: 1, column: 2 },
  },
  {
    kind: 'columns',
    confidence: 0.8,
    pattern: rule(
      `\\b(show)\\s+(?!me\\b)(?:the\\s+)?(?:column\\s+)?(${SPAN_NAME}+?)(?:\\s+column)?\\s*$`
    ),
    groups: { action: 1, column: 2 },
    yieldsToAnalyze: true,
  },
  {
    kind: 'columns',
    confidence: 0.78,
    pattern: rule(
      `\\b(?:pin|freeze)\\s+(?:the\\s+)?(${NAME}+?)(?:\\s+(?:to\\s+(?:the\\s+)?)?(left|right|start|end))?\\s*$`
    ),
    groups: { pinColumn: 1, pinSide: 2 },
  },
  {
    kind: 'quick-filter',
    confidence: 0.75,
    pattern: /\b(?:search|quick\s*filter)\s+(?:for\s+)?(.+?)\s*$/di,
    groups: { text: 1 },
  },
  {
    kind: 'quick-filter',
    confidence: 0.75,
    pattern: /\bfind\s+(?:for\s+)?(.+?)\s*$/di,
    groups: { text: 1 },
    yieldsToAnalyze: true,
  },
  {
    kind: 'paginate',
    confidence: 0.82,
    pattern: /\b(?:go to |goto )?page\s+(\d+)/di,
    groups: { page: 1 },
  },
  {
    kind: 'paginate',
    confidence: 0.8,
    pattern: /\bpage\s*size\s+(?:of\s+)?(\d+)/di,
    groups: { pageSize: 1 },
  },
  {
    kind: 'export',
    confidence: 0.82,
    pattern: /\bexport(?:\s+(?:as|to)\s+)?(csv|xlsx|excel)?\b/di,
    groups: { format: 1 },
  },
  // Analytical (read-only) questions -> 'analyze'. The resolver parses the metrics,
  // measure column, group-by, scope, and rank from the raw utterance (it has the
  // schema + data). Any of them outranks the generic aggregate, show and find commands
  // (`yieldsToAnalyze`), so "max and median of bonus" or "show top 5 by salary" is
  // answered; a sort, filter or group verb that comes first still wins.
  {
    // analytical-only words never appear in a control command
    kind: 'analyze',
    confidence: 0.86,
    pattern:
      /\b(?:median|distinct|unique|std\s*-?\s*dev|standard deviation|variance|spread|range|most common|most frequent|mode of)\b/di,
  },
  {
    // a metric grouped by a dimension: "average salary by department", "total per region"
    kind: 'analyze',
    confidence: 0.85,
    pattern:
      /\b(?:average|avg|mean|sum|total|min(?:imum)?|max(?:imum)?|count|how many)\b[\s\S]*\b(?:by|per|for each|grouped by|across)\b/di,
  },
  {
    // top / bottom N
    kind: 'analyze',
    confidence: 0.84,
    pattern: /\b(?:top|bottom)\s+\d+\b/di,
  },
  {
    // a question / imperative frame paired with a metric or superlative
    kind: 'analyze',
    confidence: 0.84,
    pattern:
      /\b(?:who|whom|whose|which|what'?s?|show|give|find|get|list|tell|how much|how many)\b[\s\S]*\b(?:highest|lowest|most|least|max(?:imum)?|min(?:imum)?|cheapest|dearest|largest|smallest|biggest|greatest|average|avg|mean|median|total|sum|count)\b/di,
  },
  // Read-only questions. Deliberately NOT bare relative pronouns (who / which / where /
  // when): those hijacked near-miss commands like "delete who have salary < 76000" into
  // a confident wrong answer. A question word paired with a metric / superlative still
  // routes to `analyze` above; a trailing "?" still lands here. The final confidence is
  // set by grounding in the planner, not by this constant: an ask that could only echo
  // the current view is lowered so it can escalate to an LLM or abstain honestly.
  {
    kind: 'ask',
    confidence: 0.8,
    pattern: /\b(?:how many|number of|what'?s|what is|what are)\b/di,
    fallback: true,
  },
  { kind: 'ask', confidence: 0.6, pattern: /\?\s*$/d, fallback: true },
];

/**
 * Where a match ranks: lower wins. A fallback ranks after every other match, and a
 * command that yields to analytics ranks after any `analyze` match.
 */
function rankOf(rule: IntentRule, match: RegExpMatchArray, analyzes: boolean): number {
  if (rule.fallback) return Number.POSITIVE_INFINITY;
  if (rule.yieldsToAnalyze && analyzes) return Number.MAX_SAFE_INTEGER;
  return match.index ?? 0;
}

class RuleIntentDetector implements IntentDetector {
  detect(utterance: string, _ctx: GridContext): Intent {
    const raw = utterance.trim();
    const matches = RULES.map((r) => ({ rule: r, match: raw.match(r.pattern) }));
    const analyzes = matches.some(({ rule: r, match }) => match && r.kind === 'analyze');
    let best: { intent: Intent; at: number } | null = null;
    for (const { rule: r, match } of matches) {
      if (!match) continue;
      const at = rankOf(r, match, analyzes);
      if (!best || at < best.at || (at === best.at && r.confidence > best.intent.confidence)) {
        best = {
          intent: {
            kind: r.kind,
            confidence: r.confidence,
            slots: r.groups ? slotsFrom(match, r.groups) : {},
            raw,
          },
          at,
        };
      }
    }
    return best?.intent ?? { kind: 'unknown', confidence: 0, slots: {}, raw };
  }
}

/** Create the default lexical {@link IntentDetector}. */
export function createIntentDetector(): IntentDetector {
  return new RuleIntentDetector();
}
