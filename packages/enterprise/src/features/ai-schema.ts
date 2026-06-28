import type { ColumnSchema, GridSchema, GridState } from 'apex-grid';

/**
 * A minimal JSON Schema (Draft 7) shape, just enough to express the state-patch
 * contract for an LLM structured-output call. Carried as a plain object: the AI
 * Toolkit never validates against it at runtime (the model SDK does that, and
 * {@link sanitizePatch} is the local guard), so no runtime JSON-Schema library is
 * pulled in.
 */
export interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  enum?: unknown[];
  const?: unknown;
  required?: string[];
  additionalProperties?: boolean | JSONSchema;
  oneOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  description?: string;
  minimum?: number;
  [key: string]: unknown;
}

/**
 * The subset of {@link GridState} an AI patch may set: the view-control surface
 * (sort, filter, quick-filter, column layout, selection, pagination, and the
 * enterprise module blob). Other slices (row pinning, manual order, tree /
 * master-detail expansion) are not part of the v1 AI surface.
 */
export type StatePatch = Partial<
  Pick<
    GridState,
    'sort' | 'filter' | 'quickFilter' | 'columns' | 'selection' | 'pagination' | 'modules'
  >
>;

// --- shared capability vocabulary -----------------------------------------
// Read straight off the GridSchema, so toJSONSchema (the contract shown to the
// LLM) and sanitizePatch (the apply-side guard) draw their allowed keys /
// operands / functions from one source and can never disagree.

/** Keys of columns that opt into sorting. */
export function sortableKeys(schema: GridSchema): string[] {
  return schema.columns.filter((column) => column.sortable).map((column) => column.key);
}

/** Every column key, in display order. */
export function columnKeys(schema: GridSchema): string[] {
  return schema.columns.map((column) => column.key);
}

/** Columns that opt into filtering (i.e. advertise at least one operand). */
export function filterableColumns(schema: GridSchema): ColumnSchema[] {
  return schema.columns.filter((column) => column.filterOperands.length > 0);
}

/** Keys of columns the enterprise grid marks groupable. */
export function groupableKeys(schema: GridSchema): string[] {
  return schema.columns.filter((column) => column.groupable).map((column) => column.key);
}

/** Keys of columns the enterprise grid marks pivotable. */
export function pivotableKeys(schema: GridSchema): string[] {
  return schema.columns.filter((column) => column.pivotable).map((column) => column.key);
}

/** Columns the enterprise grid marks aggregatable (each carries its `aggFuncs`). */
export function aggregatableColumns(schema: GridSchema): ColumnSchema[] {
  return schema.columns.filter((column) => column.aggregatable);
}

// --- JSON Schema emitter ---------------------------------------------------

/** `{ key: ['sum', ...] }` schema: aggregatable column keys to their valid functions. */
function aggregationConfigSchema(schema: GridSchema): JSONSchema | null {
  const columns = aggregatableColumns(schema);
  if (columns.length === 0) return null;
  const fallback = schema.capabilities.aggregation?.funcs ?? [];
  const properties: Record<string, JSONSchema> = {};
  for (const column of columns) {
    properties[column.key] = {
      type: 'array',
      items: { enum: [...(column.aggFuncs ?? fallback)] },
    };
  }
  return { type: 'object', additionalProperties: false, properties };
}

/** The `modules.enterprise` sub-schema (grouping / pivot / aggregation), or null. */
function enterpriseModuleSchema(schema: GridSchema): JSONSchema | null {
  const caps = schema.capabilities;
  const properties: Record<string, JSONSchema> = {};

  if (caps.grouping) {
    const groupable = groupableKeys(schema);
    if (groupable.length > 0) {
      properties.groupBy = {
        type: 'array',
        items: { enum: groupable },
        description: 'Group rows by these columns, in order. Empty disables grouping.',
      };
    }
  }

  if (caps.pivot) {
    const pivotable = pivotableKeys(schema);
    if (pivotable.length > 0) {
      properties.pivotOn = {
        enum: ['', ...pivotable],
        description: "Column whose distinct values become pivot columns ('' disables pivot).",
      };
      properties.pivotRows = { type: 'array', items: { enum: pivotable } };
    }
  }

  if (caps.aggregation) {
    const aggSchema = aggregationConfigSchema(schema);
    if (aggSchema) {
      properties.aggregations = aggSchema;
      if (caps.pivot) properties.pivotValues = aggregationConfigSchema(schema) ?? aggSchema;
    }
  }

  if (Object.keys(properties).length === 0) return null;
  return { type: 'object', additionalProperties: false, properties };
}

/**
 * Build a strict JSON Schema describing a valid {@link StatePatch} from the
 * grid's {@link GridSchema}. This is the structured-output contract an LLM
 * targets: every field is constrained to the vocabulary the grid actually
 * advertises (sortable / filterable / groupable / pivotable column keys, valid
 * per-column filter operands, allowed sort directions, aggregation functions),
 * so a conforming model can only emit operations the grid can perform. Slices the
 * grid does not support (e.g. pagination on a non-paginated grid) are omitted.
 *
 * @remarks
 * Pure and AI-agnostic. The reference Claude adapter feeds the result to
 * `output_config.format`; the apply path validates independently via
 * {@link sanitizePatch}. Both draw from this same {@link GridSchema}.
 */
export function toJSONSchema(schema: GridSchema): JSONSchema {
  const caps = schema.capabilities;
  const properties: Record<string, JSONSchema> = {};

  const sortable = sortableKeys(schema);
  if (sortable.length > 0 && caps.sort.directions.length > 0) {
    properties.sort = {
      type: 'array',
      description: caps.sort.multi
        ? 'Active sort, in priority order.'
        : 'Active sort (single-sort grid: at most one entry).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'direction'],
        properties: {
          key: { enum: sortable },
          direction: { enum: [...caps.sort.directions] },
          caseSensitive: { type: 'boolean' },
        },
      },
    };
  }

  const filterables = filterableColumns(schema);
  if (filterables.length > 0) {
    properties.filter = {
      type: 'array',
      description:
        'Per-column filters. Each entry pairs a column key with an operand valid for it.',
      items: {
        oneOf: filterables.map((column) => ({
          type: 'object',
          additionalProperties: false,
          required: ['key', 'operand'],
          properties: {
            key: { const: column.key },
            operand: { enum: [...column.filterOperands] },
            searchTerm: {
              description: `Value to compare against (column type: ${column.dataType}).`,
            },
            caseSensitive: { type: 'boolean' },
          },
        })),
      },
    };
  }

  properties.quickFilter = {
    type: 'string',
    description: 'Global text filter applied across all columns.',
  };

  const keys = columnKeys(schema);
  if (keys.length > 0) {
    properties.columns = {
      type: 'array',
      description: 'Column layout overrides; array order sets column order.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key'],
        properties: {
          key: { enum: keys },
          hidden: { type: 'boolean' },
          pinned: { enum: ['start', 'end'] },
          width: { type: 'string' },
        },
      },
    };
  }

  if (caps.pagination) {
    properties.pagination = {
      type: 'object',
      additionalProperties: false,
      properties: {
        page: { type: 'integer', minimum: 0, description: 'Zero-based page index.' },
        pageSize: { type: 'integer', minimum: 1 },
      },
    };
  }

  if (caps.selection !== false) {
    properties.selection = {
      type: 'array',
      description:
        caps.selection === 'single'
          ? 'Selected row (single-selection grid: at most one), by id or positional index.'
          : 'Selected rows, by id or positional index.',
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['id'],
            properties: { id: { type: ['string', 'number'] } },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['index'],
            properties: { index: { type: 'integer', minimum: 0 } },
          },
        ],
      },
    };
  }

  const enterprise = enterpriseModuleSchema(schema);
  if (enterprise) {
    properties.modules = {
      type: 'object',
      additionalProperties: true,
      properties: { enterprise },
    };
  }

  return {
    type: 'object',
    additionalProperties: false,
    description: 'A patch of grid view state. Include only the slices you want to change.',
    properties,
  };
}
