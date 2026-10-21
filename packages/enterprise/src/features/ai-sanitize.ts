import type { ColumnLayoutState, GridSchema, GridState, RowRef } from 'apex-grid';
import {
  aggFuncsFor,
  aggregatableColumns,
  ENTERPRISE_PATCH_FIELDS,
  groupableKeys,
  pivotableKeys,
  type StatePatch,
} from './ai-schema.js';

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

/** The typed fields a column-layout entry may carry, each with its check. */
const COLUMN_FIELDS = new Map<string, (value: unknown) => boolean>([
  ['hidden', (value) => typeof value === 'boolean'],
  ['pinned', (value) => value === 'start' || value === 'end' || value === null],
  ['width', (value) => typeof value === 'string'],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * `kept`, unless a non-empty input lost every entry: then `undefined` and a
 * warning, so a refused request leaves the slice as it is instead of sending an
 * empty one, which setState reads as a clear. An empty input is that clear.
 */
function keptOrUnchanged<T>(
  field: string,
  input: readonly unknown[],
  kept: T[],
  warnings: string[]
): T[] | undefined {
  if (input.length === 0 || kept.length > 0) return kept;
  warnings.push(`${field}: no valid entries, left unchanged`);
  return undefined;
}

/** `entry` without a `caseSensitive` that is not a boolean, with a warning. */
function withValidCase<E extends { key: string; caseSensitive?: boolean }>(
  entry: E,
  slice: string,
  warnings: string[]
): E {
  if (entry.caseSensitive === undefined || typeof entry.caseSensitive === 'boolean') return entry;
  warnings.push(`${slice}: caseSensitive on "${entry.key}" must be a boolean, dropped`);
  const copy = { ...entry };
  delete copy.caseSensitive;
  return copy;
}

/** A column-layout entry rebuilt from its typed fields, with a warning per dropped field. */
function columnEntry(entry: Record<string, unknown>, warnings: string[]): ColumnLayoutState {
  const clean: Record<string, unknown> = { key: entry.key };
  for (const [field, value] of Object.entries(entry)) {
    if (field === 'key' || value === undefined) continue;
    const valid = COLUMN_FIELDS.get(field);
    if (valid?.(value)) clean[field] = value;
    else {
      const why = valid ? 'has an invalid value' : 'is not a layout field';
      warnings.push(`columns: "${field}" on "${String(entry.key)}" ${why}, dropped`);
    }
  }
  return clean as unknown as ColumnLayoutState;
}

/** A selection item as `{ id }` or `{ index }`, or undefined when it is neither. */
function rowRef(item: unknown): RowRef | undefined {
  if (!isRecord(item)) return undefined;
  const { id, index } = item;
  if (typeof id === 'string' || typeof id === 'number') return { id };
  if (typeof index === 'number' && Number.isInteger(index) && index >= 0) return { index };
  return undefined;
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
    aggregatableColumns(schema).map((column) => [column.key, new Set(aggFuncsFor(column, schema))])
  );
  const out: Record<string, string[]> = {};
  // A known key sent with no functions asks for that column to have none:
  // a deliberate removal, so it counts as an entry even though it adds none.
  let clearsKey = false;
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
    if (fns.length === 0) {
      clearsKey = true;
      continue;
    }
    const kept = fns.filter((fn): fn is string => {
      const ok = typeof fn === 'string' && validFns.has(fn);
      if (!ok) warnings.push(`${field}: function "${String(fn)}" invalid for "${key}", dropped`);
      return ok;
    });
    if (kept.length > 0) out[key] = kept;
  }
  if (Object.keys(out).length > 0 || clearsKey || Object.keys(value).length === 0) return out;
  warnings.push(`${field}: no valid entries, left unchanged`);
  return undefined;
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
      const kept = blob.groupBy.filter((key) => {
        const ok = typeof key === 'string' && groupable.has(key);
        if (!ok) warnings.push(`groupBy: "${String(key)}" is not groupable, dropped`);
        return ok;
      });
      clean.groupBy = keptOrUnchanged('groupBy', blob.groupBy, kept, warnings);
    }
  }

  const pivotable = new Set(pivotableKeys(schema));
  const keepPivotable = (keys: unknown[], field: string) =>
    keptOrUnchanged(
      field,
      keys,
      keys.filter((key) => {
        const ok = typeof key === 'string' && pivotable.has(key);
        if (!ok) warnings.push(`${field}: "${String(key)}" is not pivotable, dropped`);
        return ok;
      }),
      warnings
    );

  if (blob.pivotOn !== undefined) {
    // One column key ('' disables the pivot) or several (a multi-field pivot).
    if (!caps.pivot) warnings.push('pivot: not available, pivotOn dropped');
    else if (Array.isArray(blob.pivotOn)) clean.pivotOn = keepPivotable(blob.pivotOn, 'pivotOn');
    else if (blob.pivotOn === '' || pivotable.has(blob.pivotOn as string)) {
      clean.pivotOn = blob.pivotOn;
    } else warnings.push(`pivotOn: "${String(blob.pivotOn)}" is not pivotable, dropped`);
  }

  if (blob.pivotRows !== undefined) {
    if (!caps.pivot) warnings.push('pivot: not available, pivotRows dropped');
    else if (!Array.isArray(blob.pivotRows)) warnings.push('pivotRows: expected an array, dropped');
    else clean.pivotRows = keepPivotable(blob.pivotRows, 'pivotRows');
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
    clean[field] = sanitizeAggregationConfig(blob[field], schema, field, warnings);
  }

  // Group-collapse overrides, ranges and anything else are outside the advertised
  // schema (enterpriseModuleSchema emits the same field list).
  const fields = new Set<string>(ENTERPRISE_PATCH_FIELDS);
  for (const key of Object.keys(blob)) {
    if (!fields.has(key)) {
      warnings.push(`modules.enterprise.${key}: not part of the AI patch surface, dropped`);
    }
  }

  for (const key of Object.keys(clean)) if (clean[key] === undefined) delete clean[key];
  // Nothing survived a non-empty blob: leave the module out rather than report it applied.
  if (Object.keys(clean).length > 0 || Object.keys(blob).length === 0) out.enterprise = clean;
  else delete out.enterprise;
  return Object.keys(out).length > 0 || Object.keys(modules).length === 0 ? out : undefined;
}

/**
 * Defense-in-depth on top of the grid's defensive `setState`: strip anything the
 * reasoner returned that the {@link GridSchema} does not advertise, so the applied
 * patch is a faithful, predictable record and the UI can report exactly what was
 * refused. Drops, with a warning each: sort on unknown / non-sortable columns or
 * invalid directions (and extra entries on a single-sort grid); filters on unknown
 * columns or with operands invalid for the column; a non-boolean `caseSensitive`;
 * column-layout entries on unknown keys and layout fields of the wrong type;
 * selection items that are not `{ id }` or `{ index }`; selection / pagination
 * when the grid disables them; out-of-vocabulary grouping / pivot / aggregation
 * values and any other `modules.enterprise` field; and any slice outside the
 * documented {@link StatePatch} surface. A slice whose every entry was refused is
 * left out (and warned about), so a refused request never clears the view; an
 * explicitly empty slice still clears it. Used by the view-state tools before
 * `applyState`.
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
      const valid = patch.sort.filter((entry) => {
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
      let kept = valid.map((entry) => withValidCase(entry, 'sort', warnings));
      if (!caps.sort.multi && kept.length > 1) {
        warnings.push(`sort: grid is single-sort, kept only "${kept[0].key}"`);
        kept = kept.slice(0, 1);
      }
      out.sort = keptOrUnchanged('sort', patch.sort, kept, warnings);
    }
  }

  if (patch.filter !== undefined) {
    if (!Array.isArray(patch.filter)) {
      warnings.push('filter: expected an array, ignored');
    } else {
      const valid = patch.filter.filter((entry) => {
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
      const kept = valid.map((entry) => withValidCase(entry, 'filter', warnings));
      out.filter = keptOrUnchanged('filter', patch.filter, kept, warnings);
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
      const kept: ColumnLayoutState[] = [];
      for (const entry of patch.columns) {
        if (columns.has(entry?.key))
          kept.push(columnEntry(entry as unknown as Record<string, unknown>, warnings));
        else warnings.push(`columns: unknown column "${entry?.key}", dropped`);
      }
      out.columns = keptOrUnchanged('columns', patch.columns, kept, warnings);
    }
  }

  if (patch.selection !== undefined) {
    if (caps.selection === false) warnings.push('selection: grid selection is disabled, dropped');
    else if (!Array.isArray(patch.selection))
      warnings.push('selection: expected an array, ignored');
    else {
      const kept: RowRef[] = [];
      for (const item of patch.selection as unknown[]) {
        const ref = rowRef(item);
        if (ref) kept.push(ref);
        else warnings.push('selection: expected { id } or { index }, dropped');
      }
      out.selection = keptOrUnchanged('selection', patch.selection, kept, warnings);
    }
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

  for (const key of Object.keys(out) as (keyof StatePatch)[]) {
    if (out[key] === undefined) delete out[key];
  }

  for (const key of Object.keys(patch)) {
    if (key !== 'version' && !PATCH_SLICES.has(key)) {
      warnings.push(`${key}: not part of the AI patch surface, dropped`);
    }
  }

  return { patch: out, warnings };
}
