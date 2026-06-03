import type { ReactiveController } from 'lit';
import type { GridHost } from '../internal/types.js';

/**
 * The default expansion configuration used when the grid has none set.
 *
 * @remarks
 * `detailTemplate` defaults to `null` here — the controller will refuse to
 * toggle rows when the configuration is missing or no template is provided.
 */
export const DEFAULT_EXPANSION_CONFIG = Object.freeze({
  enabled: false,
  showToggleColumn: true,
});

/**
 * Reactive controller backing row expansion (master-detail).
 *
 * @remarks
 * Expansion state is reference-based — the controller holds a `Set` of row
 * data references so the expansion set survives sort / filter / pagination as
 * long as those operations preserve row identity (the default in-place
 * pipeline does). Replacing {@link ApexGrid.data} wholesale invalidates any
 * expanded rows that are no longer present; consumers should call
 * {@link collapseAll} or re-apply expansion afterwards.
 *
 * Mutations go through the cancellable `rowExpanding` event and emit a
 * follow-up `rowExpanded` event, mirroring the pattern used by selection
 * and editing.
 */
export class ExpansionController<T extends object> implements ReactiveController {
  /** Set of currently expanded row data references. */
  public expanded: Set<T> = new Set();

  constructor(protected host: GridHost<T>) {
    this.host.addController(this);
  }

  public hostConnected() {}

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
      this.host.announce('Row expanded');
    } else if (added.length === 0 && removed.length === 1) {
      this.host.announce('Row collapsed');
    } else if (added.length > 0 && next.size === added.length + this.expanded.size - added.length) {
      this.host.announce(`${added.length} rows expanded`);
    } else if (removed.length > 0 && next.size === 0) {
      this.host.announce('All rows collapsed');
    }

    this.host.emitEvent('rowExpanded', {
      detail: { added, removed, expanded: Array.from(this.expanded) },
    });
    return true;
  }
}
