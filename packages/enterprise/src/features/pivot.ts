import type {
  ApexCellContext,
  ColumnConfiguration,
  ColumnGroupConfiguration,
  GridLocaleKey,
} from 'apex-grid';
import {
  type GridFeatureModule,
  type GridHost,
  getColumnTypeRenderer,
  PIPELINE,
  type RowAria,
  type RowAriaProvider,
  type RowTransformer,
} from 'apex-grid/internal';
import { html, type ReactiveController, type TemplateResult } from 'lit';
import { type AggregationConfig, type AggregationFn, toFiniteNumber } from './aggregation.js';

/** Synthetic key of the auto group column emitted in expandable (tree) mode. */
export const PIVOT_GROUP_KEY = '__pivot_group__';

export const PIVOT_MODULE_ID = 'pivot';

/** Marks a synthesized subtotal / grand-total pivot row and carries its kind. */
const PIVOT_META = Symbol('apex-grid-enterprise.pivot');

/** The kind of a synthesized pivot row. */
export type PivotRowKind = 'data' | 'subtotal' | 'grandTotal';

/** Metadata attached to synthesized pivot rows (subtotals / grand total / tree nodes). */
export interface PivotRowMeta {
  readonly kind: PivotRowKind;
  /** 0-based nesting depth in expandable (tree) mode. */
  readonly depth?: number;
  /** Stable path-joined identity of a tree node (expandable mode). */
  readonly key?: string;
  /** Display label shown in the auto group column (expandable mode). */
  readonly label?: string;
  /** Whether this tree node has children that can expand/collapse. */
  readonly expandable?: boolean;
}

/** Returns the pivot metadata if `row` is a synthesized total row, else `undefined`. */
export function getPivotMeta<T extends object>(row: T): PivotRowMeta | undefined {
  return row
    ? ((row as Record<symbol, unknown>)[PIVOT_META] as PivotRowMeta | undefined)
    : undefined;
}

/**
 * Options controlling the pivot output beyond the core row × column × measure
 * shape: whether to emit a grand-total row, per-group subtotal rows, and where
 * the grand total sits.
 */
export interface PivotOptions {
  /** Emit a grand-total row over all leaves. `true` ⇒ `'bottom'`. Off by default. */
  grandTotal?: boolean | 'top' | 'bottom';
  /**
   * Emit a subtotal row after each distinct value of the first row-dimension
   * field. Off by default; requires more than one row-dimension field to apply.
   * Ignored in {@link expandable} mode (parent tree rows already carry subtotals).
   */
  subtotals?: boolean;
  /**
   * Render the row dimension as a nested, expandable tree (one auto group
   * column with indentation + chevrons) instead of flat combo rows. Each parent
   * row carries the aggregate over its subtree. Off by default.
   */
  expandable?: boolean;
  /**
   * Initial expansion in {@link expandable} mode: `true` (all), `false` (none),
   * or a depth threshold (expand nodes shallower than it). Default `true`.
   */
  defaultExpanded?: boolean | number;
  /**
   * Most value columns the pivot generates. Columns are not virtualized, so a
   * column dimension with thousands of distinct values would otherwise render
   * thousands of cells per row. Whole column-dimension combinations are kept
   * in their sorted order (always at least one); when some are left out the
   * grid announces it and logs one console warning per recompute. A positive
   * integer, or `Infinity` to turn the cap off; anything else means the
   * default, `200`.
   */
  maxValueColumns?: number;
}

/** Default for {@link PivotOptions.maxValueColumns}. */
const DEFAULT_MAX_VALUE_COLUMNS = 200;

interface PivotColumnSpec {
  /** Synthetic column key the pivot row carries its computed value under. */
  readonly key: string;
  /** Index of the column-dimension combination, see `PivotController.#comboIndex`. */
  readonly combo: number;
  /** Index of the measure in `PivotController.#measures`. */
  readonly measure: number;
  /** Aggregation function. */
  readonly fn: AggregationFn;
}

/** Per-leaf inputs of one {@link PivotController.processRows} run, read once per leaf. */
interface LeafIndex<T> {
  readonly rows: ReadonlyArray<T>;
  /** Combination index of each leaf, or -1 when no generated column takes it. */
  readonly combo: Int32Array;
  /** Measure values, `measures` per leaf; NaN where the cell is not a finite number. */
  readonly values: Float64Array;
}

const BLANK = '(blank)';

/**
 * A dimension value's identity: blanks (null, undefined, '') share one, and
 * anything else is its text, so equal Dates and 1 and '1' fall together.
 */
function stringify(value: unknown): string {
  return value === null || value === undefined || value === '' ? BLANK : String(value);
}

/** A value's identity with `separators` (and the backslash) escaped. */
function escaped(value: unknown, separators: RegExp): string {
  return stringify(value).replace(separators, '\\$&');
}

/** Column identity of a combination: escaped so no two combinations share it. */
function comboId(values: readonly unknown[]): string {
  return values.map((value) => escaped(value, /[\\|:]/g)).join('|');
}

/** Tree node identity: the parent path plus one escaped segment. */
function childKey(parentKey: string, value: unknown): string {
  return `${parentKey}/${escaped(value, /[\\/]/g)}`;
}

let collator: Intl.Collator | undefined;

/**
 * Column order: numbers and Dates by value, text with numeric collation, blanks
 * last. Values the collation ranks equal ('1' and '01') but whose identities
 * differ are ordered by identity, so the order is total and the columns of one
 * outer value stay together under its spanning header.
 */
function compareDimension(a: unknown, b: unknown): number {
  const x = stringify(a);
  const y = stringify(b);
  if (x === y) return 0;
  if (x === BLANK || y === BLANK) return x === BLANK ? 1 : -1;
  const p = a instanceof Date ? a.getTime() : a;
  const q = b instanceof Date ? b.getTime() : b;
  collator ??= new Intl.Collator(undefined, { numeric: true });
  const order =
    typeof p === 'number' && typeof q === 'number' && !Number.isNaN(p - q)
      ? p - q
      : collator.compare(x, y);
  return order || (x < y ? -1 : 1);
}

/**
 * A currency measure's cell: blank for an empty intersection (the currency
 * renderer would show null as 0), the column's currency format otherwise.
 */
function currencyCell<T extends object>(ctx: ApexCellContext<T>): unknown {
  return ctx.value == null ? '' : getColumnTypeRenderer<T>('currency')?.display?.(ctx as never);
}

/** One cell from running totals: avg, min and max are blank over no values. */
function cellValue(fn: AggregationFn, count: number, sum: number, min: number, max: number) {
  if (fn === 'count') return count;
  if (fn === 'sum') return sum;
  if (!count) return null;
  return fn === 'avg' ? sum / count : fn === 'min' ? min : max;
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

/**
 * Enterprise feature: pivoting (v2). Turns the value combinations of one or
 * more column-dimension fields (`on`) that occur in the data into columns,
 * groups rows by one or more row-dimension fields (`rows`), and fills each cell
 * with an aggregate (`values`) of the matching leaves: a cross-tab pivot table
 * with spanning column headers, subtotals, and a grand total.
 *
 * Implemented purely enterprise-side: it implements {@link RowTransformer} to
 * synthesize the pivot rows (each carrying the computed aggregates under
 * generated synthetic column keys) and exposes {@link computeColumns} +
 * {@link computeColumnGroups} so the grid can swap in the generated columns and
 * their spanning headers. The existing cell renderer reads `data[column.key]`,
 * which is the precomputed aggregate, so no core change is needed. Each run
 * reads every (filtered) leaf once and aggregates per (combination, measure),
 * counting cells by the same rule as the other aggregates (`toFiniteNumber`).
 *
 * Multi-field `on` renders one spanning header level over the **outer** field
 * (core column groups are single-level); the inner field(s) fold into the leaf
 * header text.
 */
export class PivotController<T extends object>
  implements ReactiveController, RowTransformer<T>, RowAriaProvider<T>
{
  /** Row-dimension fields (one leading column each). */
  public rows: string[] = [];
  /** Column-dimension field(s) whose distinct-value combinations become columns. */
  public on: string[] = [];
  /** Measures aggregated into each pivot cell, e.g. `{ amount: ['sum'] }`. */
  public values: AggregationConfig = {};
  /** Subtotal / grand-total options. */
  public options: PivotOptions = {};
  /**
   * After grouping, before the grand-total row (see `RowTransformer.transformOrder`).
   * Pivot rows are the view's records, so it does not mark them synthetic.
   */
  public readonly transformOrder = 200;

  #specs: PivotColumnSpec[] = [];
  #groups: ColumnGroupConfiguration[] = [];
  /** Combination identity ({@link comboId}) → its index in the generated columns. */
  #comboIndex = new Map<string, number>();
  /** The measures of {@link values}, in order; specs refer to them by index. */
  #measures: string[] = [];
  /** Explicit per-node expand/collapse overrides in expandable mode (key → expanded). */
  readonly #expandOverrides = new Map<string, boolean>();
  /** Depth of each tree node built in the most recent {@link processRows} (key → depth). */
  readonly #nodeDepth = new Map<string, number>();

  constructor(private host: GridHost<T>) {
    host.addController(this);
  }

  public hostConnected(): void {}

  /** Whether the row dimension renders as an expandable tree. */
  #isTree(): boolean {
    return this.options.expandable === true;
  }

  /** Display a raw value, localizing the blank placeholder. */
  #label(value: unknown): string {
    return String(this.#rowLabel(value));
  }

  /** A row-dimension cell: the raw value, or the localized blank label for a blank. */
  #rowLabel(value: unknown): unknown {
    return stringify(value) === BLANK ? this.host.localize('pivot.blank') : value;
  }

  /** Whether pivoting is fully configured and should transform the view. */
  public get active(): boolean {
    return (
      this.on.length > 0 && this.on[0] !== '' && this.rows.length > 0 && this.#valueSpecCount() > 0
    );
  }

  #valueSpecCount(): number {
    return Object.values(this.values).reduce((total, fns) => total + fns.length, 0);
  }

  /** {@link PivotOptions.maxValueColumns}, or the default when it is not a valid cap. */
  #maxValueColumns(): number {
    const max = this.options.maxValueColumns;
    return max === Number.POSITIVE_INFINITY || (Number.isInteger(max) && (max as number) > 0)
      ? (max as number)
      : DEFAULT_MAX_VALUE_COLUMNS;
  }

  /** Whether the grand total should render, and where. Off unless requested. */
  #grandTotalPlacement(): 'top' | 'bottom' | null {
    const g = this.options.grandTotal;
    if (!g) return null;
    if (g === true) return 'bottom';
    return g;
  }

  /** Whether subtotal rows should render (opt-in; needs a multi-field row dimension). */
  #showSubtotals(): boolean {
    return this.options.subtotals === true && this.rows.length > 1;
  }

  /**
   * Build the pivot column set from `data`: one leading column per row-dimension
   * field, then one column per (column-dimension combination that occurs in the
   * data × measure × fn), combinations sorted field by field (see
   * {@link compareDimension}) and capped by {@link PivotOptions.maxValueColumns}.
   * A single measure over a single `on` field stays flat (the value is the
   * header); otherwise columns group under a spanning header. Stores the specs
   * and column groups for {@link processRows} / {@link computeColumnGroups}.
   *
   * `previous` (the currently-rendered generated columns) lets width / pin state
   * carry across a re-pivot for keys that survive. `source` (the pre-pivot
   * columns) supplies the header text of row dimensions and measures, and the
   * currency format of a measure.
   */
  public computeColumns(
    data: ReadonlyArray<T>,
    previous?: ReadonlyArray<ColumnConfiguration<T>>,
    source?: ReadonlyArray<ColumnConfiguration<T>>
  ): ColumnConfiguration<T>[] {
    const carry = new Map<string, Record<string, unknown>>();
    for (const col of previous ?? []) {
      carry.set(String(col.key), { width: col.width, pinned: col.pinned, hidden: col.hidden });
    }
    const sourceOf = new Map((source ?? []).map((col) => [String(col.key), col]));
    const header = (field: string) => sourceOf.get(field)?.headerText || capitalize(field);

    // The combinations that occur, one pass, keeping the first raw values of each.
    const observed = new Map<string, unknown[]>();
    for (const row of data) {
      const values = this.on.map((field) => (row as Record<string, unknown>)[field]);
      const id = comboId(values);
      if (!observed.has(id)) observed.set(id, values);
    }
    const sorted = [...observed].sort(([, a], [, b]) => {
      for (let i = 0; i < a.length; i++) {
        const order = compareDimension(a[i], b[i]);
        if (order) return order;
      }
      return 0;
    });

    const perCombo = this.#valueSpecCount();
    const keep = Math.max(1, Math.floor(this.#maxValueColumns() / perCombo));
    const combos = sorted.slice(0, keep);
    if (combos.length < sorted.length) {
      const shown = combos.length * perCombo;
      const total = sorted.length * perCombo;
      this.host.announce(this.host.localize('pivot.columnsTruncated', { shown, total }));
      // biome-ignore lint/suspicious/noConsole: the one channel a developer sees for a cut view
      console.warn(`pivot: ${shown}/${total} columns (maxValueColumns)`);
    }

    const singleMeasure = perCombo === 1;
    const grouped = !(this.on.length === 1 && singleMeasure);

    this.#specs = [];
    this.#groups = [];
    this.#comboIndex = new Map();
    this.#measures = Object.keys(this.values);
    const seenGroups = new Set<string>();
    const valueCols: ColumnConfiguration<T>[] = [];

    combos.forEach(([id, combo], c) => {
      this.#comboIndex.set(id, c);
      // Outer value heads the spanning group; inner values fold into the leaf header.
      const groupId = grouped ? `pv::${comboId(combo.slice(0, 1))}` : undefined;
      if (groupId && !seenGroups.has(groupId)) {
        seenGroups.add(groupId);
        this.#groups.push({ id: groupId, headerText: this.#label(combo[0]) });
      }
      const innerLabel = combo
        .slice(1)
        .map((value) => this.#label(value))
        .join(' / ');

      this.#measures.forEach((measure, m) => {
        const src = sourceOf.get(measure);
        for (const fn of this.values[measure]) {
          const key = `pivot::${id}::${measure}::${fn}`;
          this.#specs.push({ key, combo: c, measure: m, fn });

          // Leaf header: inner value(s) and/or measure (fn); ungrouped ⇒ the value itself.
          const measureLabel = `${header(measure)} (${this.host.localize(`chart.agg.${fn}` as GridLocaleKey)})`;
          let headerText: string;
          if (!grouped) {
            headerText = this.#label(combo[0]);
          } else if (this.on.length > 1) {
            headerText = singleMeasure ? innerLabel : `${innerLabel} · ${measureLabel}`;
          } else {
            headerText = measureLabel;
          }

          // A count is a number whatever it counts; other aggregates keep a currency format.
          const format =
            fn !== 'count' && src?.type === 'currency'
              ? {
                  type: 'currency',
                  currency: src.currency,
                  locale: src.locale,
                  cellTemplate: currencyCell,
                }
              : { type: 'number' };

          valueCols.push({
            key,
            headerText,
            ...format,
            ...(groupId ? { group: groupId } : {}),
            ...carry.get(key),
          } as unknown as ColumnConfiguration<T>);
        }
      });
    });

    // Expandable mode collapses the per-field leading columns into one auto group
    // column that renders the nested tree (indent + chevron + label).
    const rowCols: ColumnConfiguration<T>[] = this.#isTree()
      ? [
          {
            key: PIVOT_GROUP_KEY,
            headerText: this.rows.map(header).join(' / '),
            cellTemplate: (ctx: ApexCellContext<T>) => this.#groupCellTemplate(ctx),
            ...carry.get(PIVOT_GROUP_KEY),
          } as unknown as ColumnConfiguration<T>,
        ]
      : this.rows.map(
          (field) =>
            ({
              key: field,
              headerText: header(field),
              ...carry.get(field),
            }) as unknown as ColumnConfiguration<T>
        );
    return [...rowCols, ...valueCols];
  }

  /** The spanning column groups for the most recent {@link computeColumns}. */
  public computeColumnGroups(): ColumnGroupConfiguration[] {
    return this.#groups;
  }

  public processRows(rows: ReadonlyArray<T>): T[] {
    if (!this.active) return rows as T[];
    const index = this.#indexLeaves(rows);
    if (this.#isTree()) return this.#buildTreeRows(index);

    // Partition leaves by the full row-dimension combination (first-seen order).
    const combos = new Map<string, { values: unknown[]; leaves: number[] }>();
    for (let i = 0; i < rows.length; i++) {
      const rec = rows[i] as Record<string, unknown>;
      const values = this.rows.map((field) => rec[field]);
      const comboKey = values.reduce<string>((key, value) => childKey(key, value), '');
      const bucket = combos.get(comboKey);
      if (bucket) {
        bucket.leaves.push(i);
      } else {
        combos.set(comboKey, { values, leaves: [i] });
      }
    }

    const dataRows = [...combos.values()];
    const out: T[] = [];
    const grand = this.#grandTotalPlacement();

    if (grand === 'top') out.push(this.#grandTotalRow(index));

    if (this.#showSubtotals()) {
      // Group the row-combos by the first row-dimension field, in first-seen order.
      const byFirst = new Map<
        string,
        { value: unknown; leaves: number[]; rows: typeof dataRows }
      >();
      for (const entry of dataRows) {
        const fk = stringify(entry.values[0]);
        const group = byFirst.get(fk);
        if (group) {
          group.leaves.push(...entry.leaves);
          group.rows.push(entry);
        } else {
          byFirst.set(fk, { value: entry.values[0], leaves: [...entry.leaves], rows: [entry] });
        }
      }
      for (const group of byFirst.values()) {
        for (const entry of group.rows) out.push(this.#dataRow(entry.values, index, entry.leaves));
        out.push(this.#subtotalRow(group.value, index, group.leaves));
      }
    } else {
      for (const entry of dataRows) out.push(this.#dataRow(entry.values, index, entry.leaves));
    }

    if (grand === 'bottom') out.push(this.#grandTotalRow(index));
    return out;
  }

  /**
   * Read each leaf once for this run: the generated combination it falls in
   * and its measure values, so filling a row walks its leaves once instead of
   * once per value column.
   */
  #indexLeaves(rows: ReadonlyArray<T>): LeafIndex<T> {
    const measures = this.#measures;
    const combo = new Int32Array(rows.length);
    const values = new Float64Array(rows.length * measures.length);
    for (let i = 0; i < rows.length; i++) {
      const rec = rows[i] as Record<string, unknown>;
      combo[i] = this.#comboIndex.get(comboId(this.on.map((field) => rec[field]))) ?? -1;
      for (let m = 0; m < measures.length; m++) {
        values[i * measures.length + m] = toFiniteNumber(rec[measures[m]]) ?? Number.NaN;
      }
    }
    return { rows, combo, values };
  }

  /**
   * Fill every value column of `row` from `leaves` (indices into the run's
   * rows; every row when omitted), accumulating per (combination, measure).
   */
  #fillCells(row: Record<string, unknown>, index: LeafIndex<T>, leaves?: readonly number[]): void {
    const width = this.#measures.length;
    const slots = this.#comboIndex.size * width;
    const count = new Float64Array(slots);
    const sum = new Float64Array(slots);
    const min = new Float64Array(slots).fill(Number.POSITIVE_INFINITY);
    const max = new Float64Array(slots).fill(Number.NEGATIVE_INFINITY);
    const total = leaves ? leaves.length : index.rows.length;
    for (let n = 0; n < total; n++) {
      const i = leaves ? leaves[n] : n;
      const c = index.combo[i];
      if (c < 0) continue;
      for (let m = 0; m < width; m++) {
        const value = index.values[i * width + m];
        if (Number.isNaN(value)) continue;
        const slot = c * width + m;
        count[slot] += 1;
        sum[slot] += value;
        // Math.min / Math.max, not < / >, so -0 still sorts below 0.
        min[slot] = Math.min(min[slot], value);
        max[slot] = Math.max(max[slot], value);
      }
    }
    for (const spec of this.#specs) {
      const slot = spec.combo * width + spec.measure;
      row[spec.key] = cellValue(spec.fn, count[slot], sum[slot], min[slot], max[slot]);
    }
  }

  #dataRow(values: unknown[], index: LeafIndex<T>, leaves: readonly number[]): T {
    const row: Record<string, unknown> = {};
    this.rows.forEach((field, i) => {
      row[field] = this.#rowLabel(values[i]);
    });
    this.#fillCells(row, index, leaves);
    Object.defineProperty(row, PIVOT_META, { value: { kind: 'data' }, enumerable: false });
    return row as unknown as T;
  }

  #subtotalRow(value: unknown, index: LeafIndex<T>, leaves: readonly number[]): T {
    const row: Record<string, unknown> = {};
    // Label the group value, put "Total" in the next row-dimension column.
    this.rows.forEach((field, i) => {
      row[field] =
        i === 0 ? this.#rowLabel(value) : i === 1 ? this.host.localize('pivot.total') : '';
    });
    this.#fillCells(row, index, leaves);
    Object.defineProperty(row, PIVOT_META, { value: { kind: 'subtotal' }, enumerable: false });
    return row as unknown as T;
  }

  #grandTotalRow(index: LeafIndex<T>): T {
    const row: Record<string, unknown> = {};
    const label = this.host.localize('pivot.grandTotal');
    // Flat mode uses the per-field leading columns; tree mode uses the group column.
    this.rows.forEach((field, i) => {
      row[field] = i === 0 ? label : '';
    });
    row[PIVOT_GROUP_KEY] = label;
    this.#fillCells(row, index);
    Object.defineProperty(row, PIVOT_META, {
      value: { kind: 'grandTotal', depth: 0, label, expandable: false },
      enumerable: false,
    });
    return row as unknown as T;
  }

  // --- Expandable (tree) mode ----------------------------------------------

  /** Build nested, expandable pivot rows (one auto group column + value columns). */
  #buildTreeRows(index: LeafIndex<T>): T[] {
    this.#nodeDepth.clear();
    const out: T[] = [];
    const grand = this.#grandTotalPlacement();
    if (grand === 'top') out.push(this.#grandTotalRow(index));
    this.#buildTree(
      index,
      index.rows.map((_, i) => i),
      0,
      '',
      out
    );
    if (grand === 'bottom') out.push(this.#grandTotalRow(index));
    return out;
  }

  #buildTree(
    index: LeafIndex<T>,
    leaves: readonly number[],
    depth: number,
    parentKey: string,
    out: T[]
  ): void {
    const field = this.rows[depth];
    const isLeaf = depth === this.rows.length - 1;
    for (const { value, leaves: subLeaves } of this.#partition(index, leaves, field)) {
      const key = childKey(parentKey, value);
      this.#nodeDepth.set(key, depth);
      out.push(this.#nodeRow(value, index, subLeaves, depth, key, !isLeaf));
      if (!isLeaf && this.isExpanded(key, depth)) {
        this.#buildTree(index, subLeaves, depth + 1, key, out);
      }
    }
  }

  /**
   * Bucket leaves by a field value, preserving first-seen (already-sorted)
   * order. Buckets by the same identity as flat mode ({@link stringify}), so
   * equal Dates share a node and every blank is one node.
   */
  #partition(
    index: LeafIndex<T>,
    leaves: readonly number[],
    field: string
  ): Iterable<{ value: unknown; leaves: number[] }> {
    const buckets = new Map<string, { value: unknown; leaves: number[] }>();
    for (const i of leaves) {
      const value = (index.rows[i] as Record<string, unknown>)[field];
      const id = stringify(value);
      const bucket = buckets.get(id);
      if (bucket) bucket.leaves.push(i);
      else buckets.set(id, { value, leaves: [i] });
    }
    return buckets.values();
  }

  #nodeRow(
    value: unknown,
    index: LeafIndex<T>,
    leaves: readonly number[],
    depth: number,
    key: string,
    expandable: boolean
  ): T {
    const row: Record<string, unknown> = {};
    const label = this.#label(value);
    row[PIVOT_GROUP_KEY] = label;
    this.#fillCells(row, index, leaves);
    Object.defineProperty(row, PIVOT_META, {
      value: { kind: expandable ? 'subtotal' : 'data', depth, key, label, expandable },
      enumerable: false,
    });
    return row as unknown as T;
  }

  /** Whether the tree node `key` (at `depth`) is expanded (override, else default). */
  public isExpanded(key: string, depth: number): boolean {
    const override = this.#expandOverrides.get(key);
    if (override !== undefined) return override;
    const fallback = this.options.defaultExpanded ?? true;
    if (fallback === true) return true;
    if (fallback === false) return false;
    return depth < fallback;
  }

  /** Toggle a tree node's expansion and re-run the pipeline. */
  public toggleExpand(key: string): void {
    const depth = this.#nodeDepth.get(key) ?? 0;
    this.#expandOverrides.set(key, !this.isExpanded(key, depth));
    this.host.requestUpdate(PIPELINE);
  }

  // --- RowAriaProvider -----------------------------------------------------

  /**
   * Tree nodes render as normal (value-carrying) rows, so their `aria-level` /
   * `aria-expanded` come through this seam rather than {@link RowPresenter}.
   */
  public describeRow(row: T): RowAria | null {
    if (!this.#isTree()) return null;
    const meta = getPivotMeta(row);
    if (!meta || meta.depth === undefined) return null;
    return {
      level: meta.depth + 1,
      expanded: meta.expandable ? this.isExpanded(meta.key ?? '', meta.depth) : undefined,
    };
  }

  /** The auto group column's cell: indent + chevron (expandable) + label. */
  #groupCellTemplate(ctx: ApexCellContext<T>): TemplateResult {
    const data = (ctx.row as { data?: T } | undefined)?.data;
    const meta = data ? getPivotMeta(data) : undefined;
    const depth = meta?.depth ?? 0;
    const label = meta?.label ?? String((ctx as { value?: unknown }).value ?? '');
    const indent = 8 + depth * 16;

    if (!meta?.expandable) {
      // A leaf under a group is indented past where the parent's chevron sits.
      const leafPad = indent + (this.rows.length > 1 && meta?.kind === 'data' ? 18 : 0);
      const weight = meta?.kind === 'data' ? '400' : '600';
      return html`<span
        part="pivot-group-leaf"
        style="padding-inline-start:${leafPad}px;font-weight:${weight}"
        >${label}</span
      >`;
    }

    const expanded = this.isExpanded(meta.key ?? '', depth);
    return html`<span
      part="pivot-group"
      style="display:inline-flex;align-items:center;gap:6px;padding-inline-start:${indent}px"
    >
      <button
        part="pivot-group-toggle"
        type="button"
        aria-label=${
          expanded
            ? this.host.localize('grouping.collapseGroup')
            : this.host.localize('grouping.expandGroup')
        }
        aria-expanded=${expanded ? 'true' : 'false'}
        style="display:inline-flex;align-items:center;border:0;background:none;cursor:pointer;padding:0;color:inherit"
        @click=${(event: Event) => {
          event.stopPropagation();
          this.toggleExpand(meta.key ?? '');
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="12"
          height="12"
          aria-hidden="true"
          style="transform:rotate(${expanded ? 90 : 0}deg);transition:transform .15s"
        >
          <path
            d="M9 6l6 6-6 6"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          ></path>
        </svg>
      </button>
      <span style="font-weight:600">${label}</span>
    </span>`;
  }
}

/** Feature module registered on the enterprise grid. */
export const pivotModule: GridFeatureModule = {
  id: PIVOT_MODULE_ID,
  create: (host) => new PivotController(host),
};
