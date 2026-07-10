/**
 * Planner: map a resolved {@link Intent} to an ordered {@link Plan} of tool calls
 * (the built-in tool names from P1). When resolution failed (no column, nothing to
 * reverse), it returns an empty, low-confidence plan carrying a human-readable note,
 * so the pipeline can either escalate to an LLM (hybrid) or explain the miss.
 *
 * @see plans/ai-reasoning-layer-spec.md (section 4.6)
 */

import type { GridContext } from './context.js';
import type { ResolveResult } from './entities.js';
import type { Intent, Plan } from './types.js';

/** Turns a resolved intent into a plan. */
export interface Planner {
  plan(intent: Intent, resolved: ResolveResult, ctx: GridContext): Plan;
}

/** A short "try one of ..." hint listing a few real column labels. */
function columnHint(ctx: GridContext): string {
  const labels = ctx.columns.slice(0, 6).map((c) => c.label);
  return labels.length > 0 ? ` Try one of: ${labels.join(', ')}.` : '';
}

/**
 * Does an `ask` utterance ground a concrete answer (a row count, or a metric over a
 * numeric column), or could it only echo a generic view summary? Mirrors what the
 * `answer` tool computes. A generic ask must score below the escalation floor so it can
 * escalate to an LLM (when configured) or abstain, instead of masquerading as a
 * confident answer.
 */
function asksGroundedAnswer(raw: string, ctx: GridContext): boolean {
  const lower = raw.toLowerCase();
  if (/\b(?:how many|number of|count)\b/.test(lower)) return true;
  const hasMetric =
    /\b(?:highest|lowest|max|min|most|least|top|bottom|smallest|largest|average|mean|avg|sum|total)\b/.test(
      lower
    );
  if (!hasMetric) return false;
  return ctx.columns.some(
    (c) =>
      (c.dataType === 'number' || c.dataType === 'currency') &&
      (lower.includes(c.key.toLowerCase()) || lower.includes(c.label.toLowerCase()))
  );
}

class RulePlanner implements Planner {
  plan(intent: Intent, resolved: ResolveResult, ctx: GridContext): Plan {
    const source = 'rule';
    const confidence = intent.confidence;
    const fail = (message: string): Plan => ({
      mode: 'control',
      steps: [],
      confidence: confidence * 0.3,
      source,
      notes: [message],
    });

    switch (intent.kind) {
      case 'sort': {
        if (resolved.columns.length === 0) {
          return fail((resolved.errors[0] ?? 'I could not find that column.') + columnHint(ctx));
        }
        const by = resolved.columns.map((c) => ({
          key: c.key,
          direction: resolved.direction ?? 'ascending',
        }));
        return { mode: 'control', steps: [{ tool: 'sort', args: { by } }], confidence, source };
      }

      case 'filter': {
        const column = resolved.columns[0];
        if (!column || resolved.operand === undefined) {
          return fail((resolved.errors[0] ?? 'I could not find that column.') + columnHint(ctx));
        }
        return {
          mode: 'control',
          steps: [
            {
              tool: 'filter',
              args: {
                where: [{ key: column.key, operand: resolved.operand, searchTerm: resolved.value }],
              },
            },
          ],
          confidence,
          source,
        };
      }

      case 'group': {
        if (resolved.columns.length === 0) {
          return fail((resolved.errors[0] ?? 'I could not find that column.') + columnHint(ctx));
        }
        return {
          mode: 'control',
          steps: [{ tool: 'group', args: { by: resolved.columns.map((c) => c.key) } }],
          confidence,
          source,
        };
      }

      case 'ungroup':
        return { mode: 'control', steps: [{ tool: 'ungroup', args: {} }], confidence, source };

      case 'pivot': {
        const column = resolved.columns[0];
        if (!column) {
          return fail((resolved.errors[0] ?? 'I could not find that column.') + columnHint(ctx));
        }
        return {
          mode: 'control',
          steps: [{ tool: 'pivot', args: { on: column.key } }],
          confidence,
          source,
        };
      }

      case 'aggregate': {
        const column = resolved.columns[0];
        if (!column) {
          return fail((resolved.errors[0] ?? 'I could not find that column.') + columnHint(ctx));
        }
        return {
          mode: 'control',
          steps: [
            {
              tool: 'aggregate',
              args: { aggregations: { [column.key]: [resolved.aggFunc ?? 'sum'] } },
            },
          ],
          confidence,
          source,
        };
      }

      case 'columns': {
        const column = resolved.columns[0];
        if (!column) {
          return fail((resolved.errors[0] ?? 'I could not find that column.') + columnHint(ctx));
        }
        const entry =
          resolved.pin !== undefined
            ? { key: column.key, pinned: resolved.pin }
            : { key: column.key, hidden: resolved.visibility === 'hide' };
        return {
          mode: 'control',
          steps: [{ tool: 'columns', args: { columns: [entry] } }],
          confidence,
          source,
        };
      }

      case 'quick-filter':
        return {
          mode: 'control',
          steps: [{ tool: 'quickFilter', args: { text: resolved.text ?? '' } }],
          confidence,
          source,
        };

      case 'paginate': {
        const args: Record<string, number> = {};
        // Users say "page 1" (one-based); the grid is zero-based.
        if (resolved.page !== undefined) args.page = Math.max(0, resolved.page - 1);
        if (resolved.pageSize !== undefined) args.pageSize = resolved.pageSize;
        if (Object.keys(args).length === 0) return fail('Tell me a page number or page size.');
        return { mode: 'control', steps: [{ tool: 'paginate', args }], confidence, source };
      }

      case 'export':
        return {
          mode: 'control',
          steps: [{ tool: 'export', args: resolved.format ? { format: resolved.format } : {} }],
          confidence,
          source,
        };

      case 'reset':
        return { mode: 'control', steps: [{ tool: 'reset', args: {} }], confidence, source };

      case 'undo':
        return { mode: 'control', steps: [{ tool: 'undo', args: {} }], confidence, source };

      case 'analyze': {
        if (!resolved.query) {
          const note =
            resolved.errors[0] ?? `I could not work out what to measure.${columnHint(ctx)}`;
          // Surface the note as the answer so ask mode shows it; the low confidence
          // still lets a hybrid router escalate to an LLM when one is configured.
          return {
            mode: 'ask',
            steps: [],
            answer: note,
            confidence: confidence * 0.3,
            source,
            notes: [note],
          };
        }
        return {
          mode: 'ask',
          steps: [{ tool: 'analyze', args: { query: resolved.query } }],
          confidence,
          source,
        };
      }

      case 'ask': {
        // A grounded question keeps its confidence; a generic one that could only echo
        // the current view drops below the escalation floor so it escalates or abstains.
        const grounded = asksGroundedAnswer(intent.raw, ctx);
        return {
          mode: 'ask',
          steps: [{ tool: 'answer', args: { question: intent.raw } }],
          confidence: grounded ? confidence : confidence * 0.4,
          source,
        };
      }

      default:
        return fail(`I could not map that to a grid operation.${columnHint(ctx)}`);
    }
  }
}

/** Create the default rule-based {@link Planner}. */
export function createRulePlanner(): Planner {
  return new RulePlanner();
}
