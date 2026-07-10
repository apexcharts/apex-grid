/**
 * Intent Detection: classify an utterance into an {@link IntentKind} with a
 * confidence, capturing the raw spans (column names, values, directions) it
 * carries. The default detector is lexical: a table of scored patterns, a
 * productionized generalization of the old mock's regex list. It is a pure
 * function of the utterance (the context is available for future
 * schema-aware scoring but the default does not need it), so the highest-scoring
 * matching rule wins and anything unmatched is `unknown`.
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

// Order is for readability only: detection picks the highest-confidence match,
// not the first. Confidences encode specificity (a keyworded command outranks a
// bare question marker).
const RULES: IntentRule[] = [
  {
    kind: 'reset',
    confidence: 0.9,
    pattern: /\b(?:reset|clear all|clear everything|start over)\b/di,
  },
  { kind: 'undo', confidence: 0.85, pattern: /\b(?:undo|revert|go back)\b/di },
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
    pattern:
      /\b(?:sort|order)(?:\s+by)?\s+([\w ,]+?)(?:\s+(ascending|descending|asc|desc|a-z|z-a|highest|lowest|high|low|largest|smallest|most|least)(?:\s+first)?(?:\s+order)?)?\s*$/di,
    groups: { column: 1, direction: 2 },
  },
  {
    kind: 'group',
    confidence: 0.82,
    pattern: /\bgroup(?:\s+rows)?(?:\s+by)?\s+([\w ,]+?)\s*$/di,
    groups: { columns: 1 },
  },
  {
    kind: 'pivot',
    confidence: 0.8,
    pattern: /\bpivot(?:\s+(?:on|by))?\s+([\w ]+?)\s*$/di,
    groups: { column: 1 },
  },
  {
    kind: 'aggregate',
    confidence: 0.7,
    pattern:
      /\b(sum|total|average|avg|mean|count|min(?:imum)?|max(?:imum)?)\s+(?:of\s+)?([\w ]+?)\s*$/di,
    groups: { func: 1, column: 2 },
  },
  {
    kind: 'filter',
    confidence: 0.82,
    pattern:
      /\b(?:filter|where|only show|show only)\s+([\w ]+?)\s*(is not|is|=|==|!=|equals?|contains?|has|includes?|starts with|ends with|greater than or equal|less than or equal|greater than|less than|more than|at least|at most|>=|<=|>|<)\s*(.+?)\s*$/di,
    groups: { column: 1, operator: 2, value: 3 },
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
    pattern: /\b(hide|show)\s+(?!me\b)(?:the\s+)?(?:column\s+)?([\w ]+?)(?:\s+column)?\s*$/di,
    groups: { action: 1, column: 2 },
  },
  {
    kind: 'columns',
    confidence: 0.78,
    pattern:
      /\b(?:pin|freeze)\s+(?:the\s+)?([\w ]+?)(?:\s+(?:to\s+(?:the\s+)?)?(left|right|start|end))?\s*$/di,
    groups: { pinColumn: 1, pinSide: 2 },
  },
  {
    kind: 'quick-filter',
    confidence: 0.75,
    pattern: /\b(?:search|find|quick\s*filter)\s+(?:for\s+)?(.+?)\s*$/di,
    groups: { text: 1 },
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
  // schema + data). Confidence sits above generic `ask` (0.8) and the control
  // `aggregate` command (0.7), but below the anchored control verbs (0.82), so a
  // real "sort/filter/group ..." still wins when its keyword is present.
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
  },
  { kind: 'ask', confidence: 0.6, pattern: /\?\s*$/d },
];

class RuleIntentDetector implements IntentDetector {
  detect(utterance: string, _ctx: GridContext): Intent {
    const raw = utterance.trim();
    let best: Intent | null = null;
    for (const rule of RULES) {
      const match = raw.match(rule.pattern);
      if (!match) continue;
      if (!best || rule.confidence > best.confidence) {
        best = {
          kind: rule.kind,
          confidence: rule.confidence,
          slots: rule.groups ? slotsFrom(match, rule.groups) : {},
          raw,
        };
      }
    }
    return best ?? { kind: 'unknown', confidence: 0, slots: {}, raw };
  }
}

/** Create the default lexical {@link IntentDetector}. */
export function createIntentDetector(): IntentDetector {
  return new RuleIntentDetector();
}
