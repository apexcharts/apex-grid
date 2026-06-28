import type { GridSchema, GridState, SetStateResult } from 'apex-grid';
import { aggregatableColumns, groupableKeys, pivotableKeys, type StatePatch } from './ai-schema.js';

/** What the AI is asked to do: control the grid, or answer a read-only question. */
export type AIMode = 'control' | 'ask';

/** The payload handed to an {@link AIAdapter}. */
export interface AIRequest {
  /**
   * The grid's capability descriptor (columns, capabilities, and current state).
   * The basis for a structured-output schema and the contract a patch is judged
   * against. `schema.state` carries the live values, so no separate state arg.
   */
  schema: GridSchema;
  /** The user's natural-language prompt. */
  prompt: string;
  /** `'control'` expects a `patch`; `'ask'` expects an `answer`. */
  mode: AIMode;
  /** Cooperative cancellation; {@link runPrompt} forwards an `AbortSignal`. */
  signal?: AbortSignal;
}

/** What an {@link AIAdapter} returns. */
export interface AIResponse {
  /** Control mode: the proposed state patch (validated before it is applied). */
  patch?: StatePatch;
  /** Ask mode: the natural-language answer. */
  answer?: string;
}

/**
 * Turns an {@link AIRequest} into an {@link AIResponse}. Provider- and
 * transport-agnostic: the grid only defines the contract and applies the
 * validated result. Use {@link createClaudeAdapter} for Anthropic/Claude,
 * {@link createMockAdapter} for a no-network demo, or supply your own.
 */
export type AIAdapter = (request: AIRequest) => Promise<AIResponse>;

/** Options for {@link runPrompt}. */
export interface RunPromptOptions {
  /** `'control'` (default) applies a patch; `'ask'` returns an answer only. */
  mode?: AIMode;
  /** Forwarded to the adapter for cancellation. */
  signal?: AbortSignal;
}

/** The outcome of a {@link runPrompt} call: a discriminated union by `mode`. */
export type AIResult =
  | {
      mode: 'control';
      /** The sanitized patch that was actually applied. */
      patch: StatePatch;
      /** The `setState` outcome (applied / skipped / warnings). */
      result: SetStateResult;
      /** Sanitizer drops merged with `setState` warnings. */
      warnings: string[];
      /** Restore the pre-prompt snapshot. Idempotent: a second call is a no-op. */
      undo: () => SetStateResult;
    }
  | { mode: 'ask'; answer: string };

/**
 * The grid surface {@link runPrompt} needs. {@link ApexGridEnterprise} satisfies
 * it structurally; keeping it an interface decouples the orchestration from the
 * element (and makes it trivial to test).
 */
export interface AIHost {
  aiAdapter: AIAdapter | null;
  getSchema(): GridSchema;
  getState(): GridState;
  setState(patch: Partial<GridState>): SetStateResult;
}

/** Slices an AI patch may carry; anything else is dropped with a warning. */
const PATCH_SLICES = new Set<string>([
  'sort',
  'filter',
  'quickFilter',
  'columns',
  'selection',
  'pagination',
  'modules',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Validate an aggregation-config blob (`{ key: fn[] }`) against the schema. */
function sanitizeAggregationConfig(
  value: unknown,
  schema: GridSchema,
  field: string,
  warnings: string[]
): Record<string, string[]> | undefined {
  if (!isRecord(value)) {
    warnings.push(`${field}: expected an object, dropped`);
    return undefined;
  }
  const allowed = new Map(
    aggregatableColumns(schema).map((column) => [column.key, new Set(column.aggFuncs ?? [])])
  );
  const globalFuncs = new Set(schema.capabilities.aggregation?.funcs ?? []);
  const out: Record<string, string[]> = {};
  for (const [key, fns] of Object.entries(value)) {
    const validFns = allowed.get(key);
    if (!validFns) {
      warnings.push(`${field}: "${key}" is not aggregatable, dropped`);
      continue;
    }
    if (!Array.isArray(fns)) {
      warnings.push(`${field}: "${key}" expected an array of functions, dropped`);
      continue;
    }
    const kept = fns.filter((fn): fn is string => {
      const ok = typeof fn === 'string' && (validFns.has(fn) || globalFuncs.has(fn));
      if (!ok) warnings.push(`${field}: function "${String(fn)}" invalid for "${key}", dropped`);
      return ok;
    });
    if (kept.length > 0) out[key] = kept;
  }
  return out;
}

/** Validate the enterprise module blob (grouping / pivot / aggregation). */
function sanitizeEnterpriseModule(
  modules: unknown,
  schema: GridSchema,
  warnings: string[]
): Record<string, unknown> | undefined {
  if (!isRecord(modules)) {
    warnings.push('modules: expected an object, dropped');
    return undefined;
  }
  // Pass third-party module blobs through untouched; only `enterprise` is validated.
  const out: Record<string, unknown> = { ...modules };
  const blob = modules.enterprise;
  if (blob === undefined) return out;
  if (!isRecord(blob)) {
    warnings.push('modules.enterprise: expected an object, dropped');
    delete out.enterprise;
    return out;
  }

  const caps = schema.capabilities;
  const clean: Record<string, unknown> = {};

  if (blob.groupBy !== undefined) {
    if (!caps.grouping) warnings.push('grouping: not available, groupBy dropped');
    else if (!Array.isArray(blob.groupBy)) warnings.push('groupBy: expected an array, dropped');
    else {
      const groupable = new Set(groupableKeys(schema));
      clean.groupBy = blob.groupBy.filter((key) => {
        const ok = typeof key === 'string' && groupable.has(key);
        if (!ok) warnings.push(`groupBy: "${String(key)}" is not groupable, dropped`);
        return ok;
      });
    }
  }

  if (blob.pivotOn !== undefined) {
    if (!caps.pivot) warnings.push('pivot: not available, pivotOn dropped');
    else {
      const pivotable = new Set(pivotableKeys(schema));
      if (
        blob.pivotOn === '' ||
        (typeof blob.pivotOn === 'string' && pivotable.has(blob.pivotOn))
      ) {
        clean.pivotOn = blob.pivotOn;
      } else {
        warnings.push(`pivotOn: "${String(blob.pivotOn)}" is not pivotable, dropped`);
      }
    }
  }

  if (blob.pivotRows !== undefined) {
    if (!caps.pivot) warnings.push('pivot: not available, pivotRows dropped');
    else if (!Array.isArray(blob.pivotRows)) warnings.push('pivotRows: expected an array, dropped');
    else {
      const pivotable = new Set(pivotableKeys(schema));
      clean.pivotRows = blob.pivotRows.filter((key) => {
        const ok = typeof key === 'string' && pivotable.has(key);
        if (!ok) warnings.push(`pivotRows: "${String(key)}" is not pivotable, dropped`);
        return ok;
      });
    }
  }

  for (const field of ['aggregations', 'pivotValues'] as const) {
    if (blob[field] === undefined) continue;
    if (field === 'pivotValues' && !caps.pivot) {
      warnings.push('pivot: not available, pivotValues dropped');
      continue;
    }
    if (!caps.aggregation) {
      warnings.push(`aggregation: not available, ${field} dropped`);
      continue;
    }
    const sanitized = sanitizeAggregationConfig(blob[field], schema, field, warnings);
    if (sanitized !== undefined) clean[field] = sanitized;
  }

  // Group-collapse overrides (dynamic keys) and ranges (view coordinates) can't be
  // validated against the schema; pass them through.
  if (blob.groupExpand !== undefined) clean.groupExpand = blob.groupExpand;
  if (blob.ranges !== undefined) clean.ranges = blob.ranges;

  out.enterprise = clean;
  return out;
}

/**
 * Defense-in-depth on top of the grid's defensive `setState`: strip anything an
 * LLM (or a non-structured-output adapter) returned that the {@link GridSchema}
 * does not advertise, so the applied patch is a faithful, predictable record and
 * the UI can report exactly what was refused. Drops, with a warning each: sort on
 * unknown / non-sortable columns or invalid directions (and extra entries on a
 * single-sort grid); filters on unknown columns or with operands invalid for the
 * column; column-layout entries on unknown keys; selection / pagination when the
 * grid disables them; out-of-vocabulary grouping / pivot / aggregation fields; and
 * any slice outside the documented {@link StatePatch} surface.
 */
export function sanitizePatch(
  patch: Partial<GridState>,
  schema: GridSchema
): { patch: StatePatch; warnings: string[] } {
  const warnings: string[] = [];
  const out: StatePatch = {};
  const columns = new Map(schema.columns.map((column) => [column.key, column]));
  const caps = schema.capabilities;

  if (patch.sort !== undefined) {
    if (!Array.isArray(patch.sort)) {
      warnings.push('sort: expected an array, ignored');
    } else {
      const directions = new Set<string>(caps.sort.directions);
      let kept = patch.sort.filter((entry) => {
        const column = columns.get(entry?.key);
        if (!column) {
          warnings.push(`sort: unknown column "${entry?.key}", dropped`);
          return false;
        }
        if (!column.sortable) {
          warnings.push(`sort: column "${entry.key}" is not sortable, dropped`);
          return false;
        }
        if (!directions.has(entry.direction)) {
          warnings.push(`sort: invalid direction "${entry.direction}" on "${entry.key}", dropped`);
          return false;
        }
        return true;
      });
      if (!caps.sort.multi && kept.length > 1) {
        warnings.push(`sort: grid is single-sort, kept only "${kept[0].key}"`);
        kept = kept.slice(0, 1);
      }
      out.sort = kept;
    }
  }

  if (patch.filter !== undefined) {
    if (!Array.isArray(patch.filter)) {
      warnings.push('filter: expected an array, ignored');
    } else {
      out.filter = patch.filter.filter((entry) => {
        const column = columns.get(entry?.key);
        if (!column) {
          warnings.push(`filter: unknown column "${entry?.key}", dropped`);
          return false;
        }
        if (!column.filterOperands.includes(entry.operand)) {
          warnings.push(
            column.filterOperands.length === 0
              ? `filter: column "${entry.key}" is not filterable, dropped`
              : `filter: operand "${entry.operand}" not valid for "${entry.key}", dropped`
          );
          return false;
        }
        return true;
      });
    }
  }

  if (patch.quickFilter !== undefined) {
    if (typeof patch.quickFilter === 'string') out.quickFilter = patch.quickFilter;
    else warnings.push('quickFilter: expected a string, ignored');
  }

  if (patch.columns !== undefined) {
    if (!Array.isArray(patch.columns)) {
      warnings.push('columns: expected an array, ignored');
    } else {
      out.columns = patch.columns.filter((entry) => {
        if (columns.has(entry?.key)) return true;
        warnings.push(`columns: unknown column "${entry?.key}", dropped`);
        return false;
      });
    }
  }

  if (patch.selection !== undefined) {
    if (caps.selection === false) warnings.push('selection: grid selection is disabled, dropped');
    else if (!Array.isArray(patch.selection))
      warnings.push('selection: expected an array, ignored');
    else out.selection = patch.selection;
  }

  if (patch.pagination !== undefined) {
    if (!caps.pagination) warnings.push('pagination: grid is not paginated, dropped');
    else if (!isRecord(patch.pagination)) warnings.push('pagination: expected an object, ignored');
    else out.pagination = patch.pagination;
  }

  if (patch.modules !== undefined) {
    const modules = sanitizeEnterpriseModule(patch.modules, schema, warnings);
    if (modules !== undefined) out.modules = modules;
  }

  for (const key of Object.keys(patch)) {
    if (key !== 'version' && !PATCH_SLICES.has(key)) {
      warnings.push(`${key}: not part of the AI patch surface, dropped`);
    }
  }

  return { patch: out, warnings };
}

/**
 * Run a natural-language `prompt` against the grid through its {@link AIHost.aiAdapter}.
 *
 * - **`'control'` (default):** the adapter returns a patch, which is sanitized
 *   against {@link AIHost.getSchema}, applied via {@link AIHost.setState}, and made
 *   reversible (the result's `undo()` restores the snapshot taken just before).
 * - **`'ask'`:** the adapter returns a text answer; the grid is not mutated.
 *
 * Rejects if no adapter is set.
 */
export async function runPrompt(
  host: AIHost,
  prompt: string,
  options: RunPromptOptions = {}
): Promise<AIResult> {
  const adapter = host.aiAdapter;
  if (!adapter) {
    throw new Error(
      'apex-grid AI: no adapter set. Assign grid.aiAdapter (createClaudeAdapter(...), createMockAdapter(), or your own) before calling runPrompt.'
    );
  }

  const mode: AIMode = options.mode ?? 'control';
  const schema = host.getSchema();
  const response = await adapter({ schema, prompt, mode, signal: options.signal });

  if (mode === 'ask') {
    return { mode: 'ask', answer: response.answer ?? '' };
  }

  const { patch, warnings: sanitizeWarnings } = sanitizePatch(response.patch ?? {}, schema);
  const before = host.getState();
  const result = host.setState(patch);

  let undone = false;
  const undo = (): SetStateResult => {
    if (undone) return { applied: [], skipped: [], warnings: ['AI change already undone'] };
    undone = true;
    return host.setState(before);
  };

  return {
    mode: 'control',
    patch,
    result,
    warnings: [...sanitizeWarnings, ...result.warnings],
    undo,
  };
}
