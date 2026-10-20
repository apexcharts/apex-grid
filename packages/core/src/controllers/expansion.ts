import type { ReactiveController } from 'lit';
import type { GridHost } from '../internal/types.js';

/**
 * The default expansion configuration used when the grid has none set.
 *
 * @remarks
 * `detailTemplate` defaults to `null` here; the controller will refuse to
 * toggle rows when the configuration is missing or no template is provided.
 */
export const DEFAULT_EXPANSION_CONFIG = Object.freeze({
  enabled: false,
  showToggleColumn: true,
});

/**
 * Returns `rows` without the entries that are no longer in `data`, for an
 * expansion set that follows a data refresh. The survivors are counted first,
 * so the usual refresh (nothing left) allocates nothing and returns `rows`
 * itself. A row listed twice in `data` counts twice, which can keep one stale
 * entry until a later refresh.
 */
export function retainPresent<T>(rows: Set<T>, data: ReadonlyArray<T>): Set<T> {
  if (rows.size === 0) return rows;
  let present = 0;
  for (const row of data) if (rows.has(row)) present++;
  if (present === rows.size) return rows;
  const next = new Set<T>();
  for (const row of data) if (rows.has(row)) next.add(row);
  return next;
}

/**
 * Reactive controller backing row expansion (master-detail).
 *
 * @remarks
 * Expansion state is reference-based: the controller holds a `Set` of row
 * data references so the expansion set survives sort / filter / pagination as
 * long as those operations preserve row identity (the default in-place
 * pipeline does). Replacing {@link ApexGrid.data} keeps the rows that are
 * still present and drops the rest, without events.
 *
 * Mutations go through the cancellable `rowExpanding` event and emit a
 * follow-up `rowExpanded` event, mirroring the pattern used by selection
 * and editing.
 */
export class ExpansionController<T extends object> implements ReactiveController {
  /** Set of currently expanded row data references. */
  public expanded: Set<T> = new Set();
  /** The data array the expansion set was last reconciled with. */
  #data?: ReadonlyArray<T>;

  constructor(protected host: GridHost<T>) {
    this.host.addController(this);
  }

  public hostConnected() {}

  /** Drops expanded rows that left {@link ApexGrid.data} once it is replaced. */
  public hostUpdate() {
    const data = this.host.data;
    if (!data || data === this.#data) return;
    this.#data = data;
    this.expanded = retainPresent(this.expanded, data);
  }

  /** Whether expansion is enabled at the grid level. */
  public get enabled(): boolean {
    return Boolean(this.host.expansion?.enabled);
  }

  /** Whether the built-in chevron toggle column should be rendered. */
  public get showToggleColumn(): boolean {
    return (
      this.enabled &&
      (this.host.expansion?.showToggleColumn ?? DEFAULT_EXPANSION_CONFIG.showToggleColumn)
    );
  }

  /** Whether `row` is currently expanded. */
  public isExpanded(row: T): boolean {
    return this.expanded.has(row);
  }

  /**
   * Whether `row` is permitted to expand. Combines the grid-wide `enabled`
   * flag, the presence of a `detailTemplate`, and the optional per-row
   * `isExpandable` predicate.
   */
  public canExpand(row: T): boolean {
    if (!this.enabled) return false;
    if (typeof this.host.expansion?.detailTemplate !== 'function') return false;
    const predicate = this.host.expansion?.isExpandable;
    return predicate ? Boolean(predicate(row)) : true;
  }

  /** Snapshot of currently expanded rows in insertion order. */
  public expandedRows(): T[] {
    return Array.from(this.expanded);
  }

  /** Toggles the expansion of `row`. */
  public async toggleRow(row: T): Promise<boolean> {
    if (!this.canExpand(row) && !this.expanded.has(row)) return false;
    const next = new Set(this.expanded);
    if (next.has(row)) next.delete(row);
    else next.add(row);
    return this.#commit(next);
  }

  /** Expands `row`. No-op when the row is already expanded or not expandable. */
  public async expandRow(row: T): Promise<boolean> {
    if (this.expanded.has(row)) return true;
    if (!this.canExpand(row)) return false;
    const next = new Set(this.expanded);
    next.add(row);
    return this.#commit(next);
  }

  /** Collapses `row`. No-op when the row is not expanded. */
  public async collapseRow(row: T): Promise<boolean> {
    if (!this.expanded.has(row)) return true;
    const next = new Set(this.expanded);
    next.delete(row);
    return this.#commit(next);
  }

  /**
   * Expands every expandable row in {@link ApexGrid.dataView}. Skips rows
   * the optional `isExpandable` predicate rejects.
   */
  public async expandAll(): Promise<boolean> {
    if (!this.enabled || typeof this.host.expansion?.detailTemplate !== 'function') return false;
    const predicate = this.host.expansion?.isExpandable;
    const next = new Set(this.expanded);
    for (const row of this.host.dataView as ReadonlyArray<T>) {
      if (!predicate || predicate(row)) next.add(row);
    }
    return this.#commit(next);
  }

  /** Collapses every currently expanded row. */
  public async collapseAll(): Promise<boolean> {
    if (this.expanded.size === 0) return true;
    return this.#commit(new Set());
  }

  /**
   * Replaces the expansion set with `rows`. Used by the public
   * {@link ApexGrid.expandedRows} setter for programmatic control.
   */
  public async replaceExpansion(rows: ReadonlyArray<T>): Promise<boolean> {
    if (!this.enabled) return false;
    const predicate = this.host.expansion?.isExpandable;
    const next = new Set(predicate ? rows.filter((row) => predicate(row)) : rows);
    return this.#commit(next);
  }

  async #commit(next: Set<T>): Promise<boolean> {
    const added: T[] = [];
    const removed: T[] = [];
    for (const row of next) {
      if (!this.expanded.has(row)) added.push(row);
    }
    for (const row of this.expanded) {
      if (!next.has(row)) removed.push(row);
    }
    if (added.length === 0 && removed.length === 0) return true;

    const proceed = this.host.emitEvent('rowExpanding', {
      detail: {
        added,
        removed,
        current: Array.from(this.expanded),
        next: Array.from(next),
      },
      cancelable: true,
    });
    if (!proceed) return false;

    this.expanded = next;
    this.host.requestUpdate();

    if (added.length === 1 && removed.length === 0) {
      this.host.announce(this.host.localize('announce.rowExpanded'));
    } else if (added.length === 0 && removed.length === 1) {
      this.host.announce(this.host.localize('announce.rowCollapsed'));
    } else if (added.length > 0 && removed.length === 0) {
      // Only a pure expansion has a count to report; a swap that also
      // collapses rows would be misread as "N rows expanded".
      this.host.announce(this.host.localize('announce.rowsExpanded', { count: added.length }));
    } else if (removed.length > 0 && next.size === 0) {
      this.host.announce(this.host.localize('announce.allRowsCollapsed'));
    }

    this.host.emitEvent('rowExpanded', {
      detail: { added, removed, expanded: Array.from(this.expanded) },
    });
    return true;
  }
}
