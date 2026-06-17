import {
  type GridFeatureModule,
  type GridHost,
  PIPELINE,
  type PresentedRow,
  type RowPresenter,
  type RowPresenterContext,
  type RowTransformer,
} from 'apex-grid/internal';
import { html, nothing, type ReactiveController } from 'lit';
import {
  type AggregationConfig,
  type AggregationResults,
  computeAggregations,
} from './aggregation.js';

export const GROUPING_MODULE_ID = 'grouping';

/** Marks a synthesized group-header row and carries its metadata. */
const GROUP_META = Symbol('apex-grid-enterprise.group');

/** Metadata describing a single synthesized group-header row. */
export interface GroupRowMeta<T extends object> {
  /** Stable, path-joined identity (e.g. `/EMEA/2024`). */
  readonly key: string;
  /** The `groupBy` field this level groups on. */
  readonly field: string;
  /** The shared field value for this group. */
  readonly value: unknown;
  /** Display label for the header (the stringified value). */
  readonly label: string;
  /** 0-based nesting depth. */
  readonly depth: number;
  /** Number of leaf rows under this group. */
  readonly count: number;
  /** The leaf rows under this group (post-filter/sort) — used for aggregation. */
  readonly leaves: ReadonlyArray<T>;
  /** Per-column aggregates computed over {@link leaves}. */
  readonly aggregates: AggregationResults;
}

function makeGroupRow<T extends object>(meta: GroupRowMeta<T>): T {
  const row: Record<symbol, unknown> = {};
  Object.defineProperty(row, GROUP_META, { value: meta, enumerable: false });
  return row as unknown as T;
}

/** Returns the group metadata if `row` is a synthesized group header, else `undefined`. */
export function getGroupMeta<T extends object>(row: T): GroupRowMeta<T> | undefined {
  return row
    ? ((row as Record<symbol, unknown>)[GROUP_META] as GroupRowMeta<T> | undefined)
    : undefined;
}

function stringifyValue(value: unknown): string {
  return value === null || value === undefined || value === '' ? '(blank)' : String(value);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * Enterprise feature: row grouping. Groups the post-filter/post-sort rows by one
 * or more column keys (derived grouping, distinct from declared tree data) and
 * injects expandable, full-width group-header rows showing the group value, leaf
 * count, and per-group aggregates.
 *
 * Wired through the core seam: it implements {@link RowTransformer} (to inject
 * the header rows into the rendered `dataView`) and {@link RowPresenter} (to
 * render those headers full-width). Aggregates reuse {@link computeAggregations}
 * over each group's filtered leaves.
 */
export class GroupingController<T extends object>
  implements ReactiveController, RowTransformer<T>, RowPresenter<T>
{
  /** Ordered column keys to group by. Empty = grouping off (pass-through). */
  public groupBy: string[] = [];
  /** Default expansion: `true` (all), `false` (none), or a depth threshold. */
  public defaultExpanded: boolean | number = true;
  /** Aggregations computed per group over its leaf rows. */
  public aggregations: AggregationConfig = {};

  /** Explicit per-group expansion overrides (key → expanded). */
  readonly #overrides = new Map<string, boolean>();
  /** Metadata for the groups built in the most recent {@link processRows}. */
  readonly #metaByKey = new Map<string, GroupRowMeta<T>>();

  constructor(private host: GridHost<T>) {
    host.addController(this);
  }

  public hostConnected(): void {}

  // --- RowTransformer ------------------------------------------------------

  public processRows(rows: ReadonlyArray<T>): T[] {
    this.#metaByKey.clear();
    if (!this.groupBy.length) return rows as T[];
    return this.#build(rows, 0, '');
  }

  #build(rows: ReadonlyArray<T>, depth: number, parentKey: string): T[] {
    const field = this.groupBy[depth];
    const out: T[] = [];

    for (const [value, leaves] of this.#partition(rows, field)) {
      const key = `${parentKey}/${stringifyValue(value)}`;
      const meta: GroupRowMeta<T> = {
        key,
        field,
        value,
        label: stringifyValue(value),
        depth,
        count: leaves.length,
        leaves,
        aggregates: Object.keys(this.aggregations).length
          ? computeAggregations(leaves, this.aggregations)
          : {},
      };
      this.#metaByKey.set(key, meta);
      out.push(makeGroupRow(meta));

      if (this.isExpanded(key, depth)) {
        out.push(
          ...(depth + 1 < this.groupBy.length ? this.#build(leaves, depth + 1, key) : leaves)
        );
      }
    }

    return out;
  }

  /** Bucket rows by a field value, preserving first-seen (already-sorted) order. */
  #partition(rows: ReadonlyArray<T>, field: string): Map<unknown, T[]> {
    const buckets = new Map<unknown, T[]>();
    for (const row of rows) {
      const value = (row as Record<string, unknown>)[field];
      const bucket = buckets.get(value);
      if (bucket) {
        bucket.push(row);
      } else {
        buckets.set(value, [row]);
      }
    }
    return buckets;
  }

  // --- RowPresenter --------------------------------------------------------

  public presentRow(row: T, _ctx: RowPresenterContext<T>): PresentedRow | null {
    const meta = getGroupMeta<T>(row);
    if (!meta) return null;
    const expanded = this.isExpanded(meta.key, meta.depth);
    return { content: this.#renderHeader(meta, expanded), level: meta.depth + 1, expanded };
  }

  #renderHeader(meta: GroupRowMeta<T>, expanded: boolean) {
    const indent = 8 + meta.depth * 16;
    return html`<div
      part="group-header"
      style="display:flex;align-items:center;gap:8px;inline-size:100%;padding-block:6px;padding-inline-start:${indent}px"
    >
      <button
        part="group-toggle"
        type="button"
        aria-label=${expanded ? 'Collapse group' : 'Expand group'}
        aria-expanded=${expanded ? 'true' : 'false'}
        style="display:inline-flex;align-items:center;border:0;background:none;cursor:pointer;padding:0;color:inherit"
        @click=${(event: Event) => {
          event.stopPropagation();
          this.toggleGroup(meta.key);
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
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
      <span part="group-label" style="font-weight:600">${meta.label}</span>
      <span part="group-count" style="opacity:.6">(${meta.count})</span>
      ${this.#renderAggregates(meta)}
    </div>`;
  }

  #renderAggregates(meta: GroupRowMeta<T>) {
    const entries = Object.entries(meta.aggregates);
    if (!entries.length) return nothing;
    return html`<span
      part="group-aggregates"
      style="margin-inline-start:auto;display:flex;gap:12px;opacity:.85"
    >
      ${entries.flatMap(([column, fns]) =>
        Object.entries(fns).map(
          ([fn, value]) =>
            html`<span part="group-aggregate"
              ><b>${column} ${fn}</b>: ${formatNumber(value as number)}</span
            >`
        )
      )}
    </span>`;
  }

  // --- Expansion API -------------------------------------------------------

  /** Whether the group identified by `key` (at `depth`) is currently expanded. */
  public isExpanded(key: string, depth: number): boolean {
    const override = this.#overrides.get(key);
    if (override !== undefined) return override;
    const fallback = this.defaultExpanded;
    if (fallback === true || fallback === undefined) return true;
    if (fallback === false) return false;
    return depth < fallback;
  }

  public toggleGroup(key: string): void {
    const depth = this.#metaByKey.get(key)?.depth ?? 0;
    this.setGroupExpanded(key, !this.isExpanded(key, depth));
  }

  public expandGroup(key: string): void {
    this.setGroupExpanded(key, true);
  }

  public collapseGroup(key: string): void {
    this.setGroupExpanded(key, false);
  }

  /** Expand/collapse a single group, firing cancellable `groupExpanding`. */
  public setGroupExpanded(key: string, expanded: boolean): void {
    const meta = this.#metaByKey.get(key);
    if (this.isExpanded(key, meta?.depth ?? 0) === expanded) return;
    if (!this.#emit('groupExpanding', { key, expanded, meta })) return;

    this.#overrides.set(key, expanded);
    this.host.requestUpdate(PIPELINE);
    this.#emit('groupExpanded', { key, expanded, meta }, false);
    if (meta) {
      this.host.announce(`${expanded ? 'Expanded' : 'Collapsed'} group ${meta.label}`);
    }
  }

  public expandAllGroups(): void {
    this.defaultExpanded = true;
    this.#overrides.clear();
    this.host.requestUpdate(PIPELINE);
  }

  public collapseAllGroups(): void {
    this.defaultExpanded = false;
    this.#overrides.clear();
    this.host.requestUpdate(PIPELINE);
  }

  /** The group headers built in the most recent pipeline pass. */
  public getGroups(): GroupRowMeta<T>[] {
    return [...this.#metaByKey.values()];
  }

  #emit(type: string, detail: unknown, cancelable = true): boolean {
    return this.host.dispatchEvent(
      new CustomEvent(type, { detail, cancelable, bubbles: true, composed: true })
    );
  }
}

/** Feature module registered on the enterprise grid. */
export const groupingModule: GridFeatureModule = {
  id: GROUPING_MODULE_ID,
  create: (host) => new GroupingController(host),
};
