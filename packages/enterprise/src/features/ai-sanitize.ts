import type { GridSchema, GridState } from 'apex-grid';
import { aggregatableColumns, groupableKeys, pivotableKeys, type StatePatch } from './ai-schema.js';

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
 * Defense-in-depth on top of the grid's defensive `setState`: strip anything the
 * reasoner returned that the {@link GridSchema} does not advertise, so the applied
 * patch is a faithful, predictable record and the UI can report exactly what was
 * refused. Drops, with a warning each: sort on unknown / non-sortable columns or
 * invalid directions (and extra entries on a single-sort grid); filters on unknown
 * columns or with operands invalid for the column; column-layout entries on unknown
 * keys; selection / pagination when the grid disables them; out-of-vocabulary
 * grouping / pivot / aggregation fields; and any slice outside the documented
 * {@link StatePatch} surface. Used by the view-state tools before `applyState`.
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
