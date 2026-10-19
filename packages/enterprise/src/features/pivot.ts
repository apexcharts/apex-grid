import type { ApexCellContext, ColumnConfiguration, ColumnGroupConfiguration } from 'apex-grid';
import {
  type GridFeatureModule,
  type GridHost,
  PIPELINE,
  type RowAria,
  type RowAriaProvider,
  type RowTransformer,
} from 'apex-grid/internal';
import { html, type ReactiveController, type TemplateResult } from 'lit';
import { type AggregationConfig, type AggregationFn, computeAggregations } from './aggregation.js';

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
}

interface PivotColumnSpec {
  /** Synthetic column key the pivot row carries its computed value under. */
  readonly key: string;
  /** Stringified distinct values of the column-dimension field(s), aligned to `on`. */
  readonly combo: readonly string[];
  /** Measure (source field) being aggregated. */
  readonly measure: string;
  /** Aggregation function. */
  readonly fn: AggregationFn;
}

function stringify(value: unknown): string {
  return value === null || value === undefined || value === '' ? '(blank)' : String(value);
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

/** Cartesian product of the per-field distinct-value lists, first field varying slowest. */
function product(lists: string[][]): string[][] {
  return lists.reduce<string[][]>(
    (acc, list) => acc.flatMap((prefix) => list.map((value) => [...prefix, value])),
    [[]]
  );
}

/**
 * Enterprise feature: pivoting (v2). Turns the distinct values of one or more
 * column-dimension fields (`on`) into columns, groups rows by one or more
 * row-dimension fields (`rows`), and fills each cell with an aggregate
 * (`values`) of the matching leaves — a cross-tab pivot table with spanning
 * column headers, subtotals, and a grand total.
 *
 * Implemented purely enterprise-side: it implements {@link RowTransformer} to
 * synthesize the pivot rows (each carrying the computed aggregates under
 * generated synthetic column keys) and exposes {@link computeColumns} +
 * {@link computeColumnGroups} so the grid can swap in the generated columns and
 * their spanning headers. The existing cell renderer reads `data[column.key]` —
 * which is the precomputed aggregate — so no core change is needed. Aggregates
 * reuse {@link computeAggregations} over the (filtered) leaves.
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
    const s = stringify(value);
    return s === stringify('') ? this.host.localize('pivot.blank') : s;
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
   * field, then one column per (distinct column-dimension combo × measure × fn).
   * A single measure over a single `on` field stays flat (the value is the
   * header); otherwise columns group under a spanning header. Stores the specs
   * and column groups for {@link processRows} / {@link computeColumnGroups}.
   *
   * `previous` (the currently-rendered generated columns) lets width / pin state
   * carry across a re-pivot for keys that survive.
   */
  public computeColumns(
    data: ReadonlyArray<T>,
    previous?: ReadonlyArray<ColumnConfiguration<T>>
  ): ColumnConfiguration<T>[] {
    const carry = new Map<string, Record<string, unknown>>();
    for (const col of previous ?? []) {
      carry.set(String(col.key), { width: col.width, pinned: col.pinned, hidden: col.hidden });
    }

    // Distinct values per `on` field, then their cartesian product (outer slowest).
    const perField = this.on.map((field) =>
      [...new Set(data.map((row) => stringify((row as Record<string, unknown>)[field])))].sort()
    );
    const combos = product(perField);

    const singleMeasure = this.#valueSpecCount() === 1;
    const grouped = !(this.on.length === 1 && singleMeasure);
    const blankLabel = this.host.localize('pivot.blank');
    const display = (value: string) => (value === stringify('') ? blankLabel : value);

    this.#specs = [];
    this.#groups = [];
    const seenGroups = new Set<string>();
    const valueCols: ColumnConfiguration<T>[] = [];

    for (const combo of combos) {
      // Outer value heads the spanning group; inner values fold into the leaf header.
      const groupId = grouped ? `pv::${combo[0]}` : undefined;
      if (groupId && !seenGroups.has(groupId)) {
        seenGroups.add(groupId);
        this.#groups.push({ id: groupId, headerText: display(combo[0]) });
      }
      const innerLabel = combo.slice(1).map(display).join(' / ');

      for (const [measure, fns] of Object.entries(this.values)) {
        for (const fn of fns) {
          const key = `pivot::${combo.join('|')}::${measure}::${fn}`;
          this.#specs.push({ key, combo, measure, fn });

          // Leaf header: inner value(s) and/or measure(fn); ungrouped ⇒ the value itself.
          let headerText: string;
          if (!grouped) {
            headerText = display(combo[0]);
          } else if (this.on.length > 1) {
            headerText = singleMeasure ? innerLabel : `${innerLabel} · ${measure} (${fn})`;
          } else {
            headerText = `${measure} (${fn})`;
          }

          valueCols.push({
            key,
            headerText,
            type: 'number',
            ...(groupId ? { group: groupId } : {}),
            ...carry.get(key),
          } as unknown as ColumnConfiguration<T>);
        }
      }
    }

    // Expandable mode collapses the per-field leading columns into one auto group
    // column that renders the nested tree (indent + chevron + label).
    const rowCols: ColumnConfiguration<T>[] = this.#isTree()
      ? [
          {
            key: PIVOT_GROUP_KEY,
            headerText: this.rows.map(capitalize).join(' / '),
            cellTemplate: (ctx: ApexCellContext<T>) => this.#groupCellTemplate(ctx),
            ...carry.get(PIVOT_GROUP_KEY),
          } as unknown as ColumnConfiguration<T>,
        ]
      : this.rows.map(
          (field) =>
            ({
              key: field,
              headerText: capitalize(field),
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
    if (this.#isTree()) return this.#buildTreeRows(rows);

    // Partition leaves by the full row-dimension combination (first-seen order).
    const combos = new Map<string, { values: unknown[]; leaves: T[] }>();
    for (const row of rows) {
      const rec = row as Record<string, unknown>;
      const values = this.rows.map((field) => rec[field]);
      const comboKey = values.map(stringify).join('\u0000');
      const bucket = combos.get(comboKey);
      if (bucket) {
        bucket.leaves.push(row);
      } else {
        combos.set(comboKey, { values, leaves: [row] });
      }
    }

    const dataRows = [...combos.values()];
    const out: T[] = [];
    const grand = this.#grandTotalPlacement();

    if (grand === 'top') out.push(this.#grandTotalRow(rows));

    if (this.#showSubtotals()) {
      // Group the row-combos by the first row-dimension field, in first-seen order.
      const byFirst = new Map<string, { value: unknown; leaves: T[]; rows: typeof dataRows }>();
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
        for (const entry of group.rows) out.push(this.#dataRow(entry.values, entry.leaves));
        out.push(this.#subtotalRow(group.value, group.leaves));
      }
    } else {
      for (const entry of dataRows) out.push(this.#dataRow(entry.values, entry.leaves));
    }

    if (grand === 'bottom') out.push(this.#grandTotalRow(rows));
    return out;
  }

  /** Aggregate a column spec over a leaf subset (leaves matching the spec's `on` combo). */
  #cell(spec: PivotColumnSpec, leaves: ReadonlyArray<T>): number {
    const subset = leaves.filter((row) =>
      this.on.every(
        (field, i) => stringify((row as Record<string, unknown>)[field]) === spec.combo[i]
      )
    );
    const agg = computeAggregations(subset, { [spec.measure]: [spec.fn] });
    return agg[spec.measure]?.[spec.fn] ?? 0;
  }

  #fillCells(row: Record<string, unknown>, leaves: ReadonlyArray<T>): void {
    for (const spec of this.#specs) row[spec.key] = this.#cell(spec, leaves);
  }

  #dataRow(values: unknown[], leaves: ReadonlyArray<T>): T {
    const row: Record<string, unknown> = {};
    this.rows.forEach((field, i) => {
      row[field] = values[i];
    });
    this.#fillCells(row, leaves);
    Object.defineProperty(row, PIVOT_META, { value: { kind: 'data' }, enumerable: false });
    return row as unknown as T;
  }

  #subtotalRow(value: unknown, leaves: ReadonlyArray<T>): T {
    const row: Record<string, unknown> = {};
    // Label the group value, put "Total" in the next row-dimension column.
    this.rows.forEach((field, i) => {
      row[field] = i === 0 ? value : i === 1 ? this.host.localize('pivot.total') : '';
    });
    this.#fillCells(row, leaves);
    Object.defineProperty(row, PIVOT_META, { value: { kind: 'subtotal' }, enumerable: false });
    return row as unknown as T;
  }

  #grandTotalRow(leaves: ReadonlyArray<T>): T {
    const row: Record<string, unknown> = {};
    const label = this.host.localize('pivot.grandTotal');
    // Flat mode uses the per-field leading columns; tree mode uses the group column.
    this.rows.forEach((field, i) => {
      row[field] = i === 0 ? label : '';
    });
    row[PIVOT_GROUP_KEY] = label;
    this.#fillCells(row, leaves);
    Object.defineProperty(row, PIVOT_META, {
      value: { kind: 'grandTotal', depth: 0, label, expandable: false },
      enumerable: false,
    });
    return row as unknown as T;
  }

  // --- Expandable (tree) mode ----------------------------------------------

  /** Build nested, expandable pivot rows (one auto group column + value columns). */
  #buildTreeRows(allLeaves: ReadonlyArray<T>): T[] {
    this.#nodeDepth.clear();
    const out: T[] = [];
    const grand = this.#grandTotalPlacement();
    if (grand === 'top') out.push(this.#grandTotalRow(allLeaves));
    this.#buildTree(allLeaves, 0, '', out);
    if (grand === 'bottom') out.push(this.#grandTotalRow(allLeaves));
    return out;
  }

  #buildTree(leaves: ReadonlyArray<T>, depth: number, parentKey: string, out: T[]): void {
    const field = this.rows[depth];
    const isLeaf = depth === this.rows.length - 1;
    for (const [value, subLeaves] of this.#partition(leaves, field)) {
      const key = `${parentKey}/${stringify(value)}`;
      this.#nodeDepth.set(key, depth);
      out.push(this.#nodeRow(value, subLeaves, depth, key, !isLeaf));
      if (!isLeaf && this.isExpanded(key, depth)) {
        this.#buildTree(subLeaves, depth + 1, key, out);
      }
    }
  }

  /** Bucket rows by a field value, preserving first-seen (already-sorted) order. */
  #partition(leaves: ReadonlyArray<T>, field: string): Map<unknown, T[]> {
    const buckets = new Map<unknown, T[]>();
    for (const row of leaves) {
      const value = (row as Record<string, unknown>)[field];
      const bucket = buckets.get(value);
      if (bucket) bucket.push(row);
      else buckets.set(value, [row]);
    }
    return buckets;
  }

  #nodeRow(
    value: unknown,
    leaves: ReadonlyArray<T>,
    depth: number,
    key: string,
    expandable: boolean
  ): T {
    const row: Record<string, unknown> = {};
    const label = this.#label(value);
    row[PIVOT_GROUP_KEY] = label;
    this.#fillCells(row, leaves);
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
