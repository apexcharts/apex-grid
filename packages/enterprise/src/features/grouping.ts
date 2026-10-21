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

/** Parts inside a group header row, re-exported so `::part()` can style them. */
const GROUP_ROW_PARTS = [
  'group-header',
  'group-toggle',
  'group-label',
  'group-count',
  'group-aggregates',
  'group-aggregate',
];

/** Metadata describing a single synthesized group-header row. */
export interface GroupRowMeta<T extends object> {
  /**
   * Stable, path-joined identity (e.g. `/EMEA/2024`). A blank is `(blank)`. A
   * value with a `/` in it is an empty segment plus the value with `%` and `/`
   * percent-escaped (`A/B` is `//A%2FB`), so it never reads as a nested path.
   */
  readonly key: string;
  /** The `groupBy` field this level groups on. */
  readonly field: string;
  /** The shared field value for this group (the first seen, for blanks and dates). */
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

const BLANK_SEGMENT = '(blank)';

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/**
 * The path segment for a group value. Blanks share `(blank)`, and a Date is
 * `String(date)` as before unless it has milliseconds, which only the ISO
 * instant keeps. A text that would not read back as one plain segment (it has
 * a `/`, is empty or is a literal "(blank)") is written as an empty segment
 * followed by the text with `%` and `/` escaped. Plain segments are never
 * empty, so keys stay unique, and any other value keeps the key earlier
 * releases wrote.
 */
function keySegment(value: unknown): string {
  if (isBlank(value)) return BLANK_SEGMENT;
  const text =
    value instanceof Date && value.getMilliseconds() ? value.toISOString() : String(value);
  return text && text !== BLANK_SEGMENT && !text.includes('/')
    ? text
    : `/${text.replace(/[%/]/g, (c) => (c === '/' ? '%2F' : '%25'))}`;
}

/** Group expansion as stored in a state snapshot, validated. */
export interface GroupExpansionState {
  defaultExpanded?: boolean | number;
  overrides?: Record<string, boolean>;
}

/**
 * Validates the group expansion slices of a snapshot (`groupDefaultExpanded`,
 * `groupExpand`) before anything is applied. A wrong-typed slice, including a
 * `groupExpand` with a non-boolean value, is reported through `warn` (which
 * throws in strict mode) and left out.
 */
export function readGroupExpansion(
  defaultExpanded: unknown,
  overrides: unknown,
  warn: (message: string) => void
): GroupExpansionState {
  const out: GroupExpansionState = {};
  if (
    typeof defaultExpanded === 'boolean' ||
    (typeof defaultExpanded === 'number' && defaultExpanded >= 0)
  ) {
    out.defaultExpanded = defaultExpanded;
  } else if (defaultExpanded !== undefined) {
    warn('groupDefaultExpanded: expected a boolean or a depth; skipped');
  }
  if (
    overrides &&
    typeof overrides === 'object' &&
    !Array.isArray(overrides) &&
    Object.values(overrides).every((expanded) => typeof expanded === 'boolean')
  ) {
    out.overrides = overrides as Record<string, boolean>;
  } else if (overrides !== undefined) {
    warn('groupExpand: expected an object of booleans; skipped');
  }
  return out;
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
  #overrides = new Map<string, boolean>();
  /** Metadata for the groups built in the most recent {@link processRows}. */
  readonly #metaByKey = new Map<string, GroupRowMeta<T>>();
  /**
   * Group headers that were built collapsed, so their leaves are not in the
   * view they belong to. Recorded at build time: the live expansion state can
   * run ahead of `dataView` until the next update rebuilds it.
   */
  readonly #builtCollapsed = new WeakSet<GroupRowMeta<T>>();

  constructor(private host: GridHost<T>) {
    host.addController(this);
  }

  public hostConnected(): void {}

  // --- RowTransformer ------------------------------------------------------

  /** Groups before the grand-total row (see `RowTransformer.transformOrder`). */
  public readonly transformOrder = 100;

  /** Group headers are synthesized, so selection and export skip them. */
  public isSyntheticRow(row: T): boolean {
    return getGroupMeta(row) !== undefined;
  }

  /**
   * A collapsed group's leaves, so Select all and a view export cover them.
   * Answers for the view `row` was built into, not the live expansion state,
   * so a collapse or expand not yet rendered neither repeats nor drops leaves.
   */
  public hiddenRecords(row: T): ReadonlyArray<T> {
    const meta = getGroupMeta<T>(row);
    return meta && this.#builtCollapsed.has(meta) ? meta.leaves : [];
  }

  public processRows(rows: ReadonlyArray<T>): T[] {
    this.#metaByKey.clear();
    if (!this.groupBy.length) return rows as T[];
    return this.#build(rows, 0, '');
  }

  #build(rows: ReadonlyArray<T>, depth: number, parentKey: string): T[] {
    const field = this.groupBy[depth];
    const out: T[] = [];

    for (const [value, leaves] of this.#partition(rows, field)) {
      const key = `${parentKey}/${keySegment(value)}`;
      const meta: GroupRowMeta<T> = {
        key,
        field,
        value,
        label: isBlank(value) ? this.host.localize('grouping.blank') : String(value),
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
        const children =
          depth + 1 < this.groupBy.length ? this.#build(leaves, depth + 1, key) : leaves;
        // A loop, not push(...children): spreading throws past ~120k rows.
        for (let i = 0; i < children.length; i += 1) out.push(children[i]);
      } else {
        this.#builtCollapsed.add(meta);
      }
    }

    return out;
  }

  /**
   * Bucket rows by a field value, preserving first-seen (already-sorted) order.
   * Blanks (null, undefined, '') share one bucket, and so do equal dates held in
   * distinct Date instances: each maps to the first such value seen, which is
   * also the group's `value`.
   */
  #partition(rows: ReadonlyArray<T>, field: string): Map<unknown, T[]> {
    const buckets = new Map<unknown, T[]>();
    let dates: Map<number, Date> | undefined;
    let blank: unknown;
    let blankSeen = false;
    for (const row of rows) {
      let value = (row as Record<string, unknown>)[field];
      if (isBlank(value)) {
        if (blankSeen) value = blank;
        else {
          blank = value;
          blankSeen = true;
        }
      } else if (value instanceof Date) {
        dates ??= new Map();
        const first = dates.get(value.getTime());
        if (first) value = first;
        else dates.set(value.getTime(), value);
      }
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
    return {
      content: this.#renderHeader(meta, expanded),
      level: meta.depth + 1,
      expanded,
      exportParts: GROUP_ROW_PARTS,
    };
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
        aria-label=${
          expanded
            ? this.host.localize('grouping.collapseGroup')
            : this.host.localize('grouping.expandGroup')
        }
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
      this.host.announce(
        this.host.localize(expanded ? 'grouping.announceExpanded' : 'grouping.announceCollapsed', {
          label: meta.label,
        })
      );
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

  /**
   * The explicit per-group collapse overrides (group key → expanded), for state
   * serialization. Groups using the {@link defaultExpanded} fallback are absent.
   */
  public getExpandOverrides(): Record<string, boolean> {
    return Object.fromEntries(this.#overrides);
  }

  /**
   * Restores group expansion from a snapshot read by {@link readGroupExpansion}:
   * the default when present, and the per-group overrides when present
   * (replacing any current ones). Silent: emits no `groupExpanding` /
   * `groupExpanded`; re-runs the pipeline so the next pass honors them.
   */
  public restoreExpansion({ defaultExpanded, overrides }: GroupExpansionState): void {
    if (defaultExpanded === undefined && !overrides) return;
    if (defaultExpanded !== undefined) this.defaultExpanded = defaultExpanded;
    if (overrides) this.#overrides = new Map(Object.entries(overrides));
    this.host.requestUpdate(PIPELINE);
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
