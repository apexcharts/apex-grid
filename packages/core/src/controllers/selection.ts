import type { ReactiveController } from 'lit';
import type { GridHost, SelectionMode } from '../internal/types.js';
import type { StateController } from './state.js';

/**
 * The default selection configuration used when the grid has none set.
 */
export const DEFAULT_SELECTION_CONFIG = Object.freeze({
  enabled: false,
  mode: 'multiple' as SelectionMode,
  showCheckboxColumn: false,
});

/**
 * Reactive controller backing row selection.
 *
 * @remarks
 * Selection state is reference-based — the controller holds a `Set` of row
 * data references so the selection survives sort / filter / pagination as
 * long as those operations preserve identities (the default in-place
 * pipeline does). Replacing {@link ApexGrid.data} wholesale will invalidate
 * any selected rows that are no longer present in the new array; consumers
 * should call {@link clear} or re-apply selection after such a change.
 *
 * Only selectable data records are selected (see {@link isSelectable}): rows
 * a feature module synthesizes into the view (group headers, a grand-total
 * row; see {@link StateController.isDataRow}) and rows the
 * `selection.isRowSelectable` predicate rejects are skipped by every
 * mutation and ignored by {@link allSelected}.
 *
 * Mutations go through the cancellable `rowSelecting` event and emit a
 * follow-up `rowSelected` event, mirroring the pattern used by editing.
 */
export class SelectionController<T extends object> implements ReactiveController {
  /** Set of currently selected row data references. */
  public selected: Set<T> = new Set();

  /**
   * Anchor row for Shift+click range selection. Set whenever a single row
   * is toggled / picked so a follow-up Shift+click knows where to start.
   */
  public anchor: T | null = null;

  /** The selection config and data the selection was last checked against. */
  #seen: [unknown, unknown] = [undefined, undefined];

  constructor(protected host: GridHost<T>) {
    this.host.addController(this);
  }

  public hostConnected() {}

  /**
   * Drops selected rows the `isRowSelectable` predicate rejects once
   * `selection` or `data` is reassigned. Runs after the render, so the
   * `rowSelecting`/`rowSelected` listeners (and any grid property they
   * write) start a normal update. Without a predicate nothing is checked,
   * and a mode switch never trims the selection here.
   */
  public hostUpdated() {
    const { selection, data } = this.host;
    if (selection === this.#seen[0] && data === this.#seen[1]) return;
    this.#seen = [selection, data];
    if (!this.enabled || !selection?.isRowSelectable) return;
    const keep = this.selectable(this.selectedRows());
    if (keep.length < this.selected.size) void this.#commit(new Set(keep));
  }

  /**
   * Whether selection is enabled at the grid level.
   */
  public get enabled(): boolean {
    return Boolean(this.host.selection?.enabled);
  }

  /**
   * The resolved selection mode (`'multiple'` if unset).
   */
  public get mode(): SelectionMode {
    return this.host.selection?.mode ?? DEFAULT_SELECTION_CONFIG.mode;
  }

  /**
   * Whether to render the built-in checkbox column.
   */
  public get showCheckboxColumn(): boolean {
    return (
      this.enabled &&
      (this.host.selection?.showCheckboxColumn ?? DEFAULT_SELECTION_CONFIG.showCheckboxColumn)
    );
  }

  /**
   * Whether the given row is currently selected.
   */
  public isSelected(row: T): boolean {
    return this.selected.has(row);
  }

  /**
   * Whether `row` can be selected: a data record (see
   * {@link StateController.isDataRow}) that `selection.isRowSelectable`, when
   * set, accepts.
   */
  public isSelectable(row: T): boolean {
    return (
      (this.#state?.isDataRow(row) ?? true) && (this.host.selection?.isRowSelectable?.(row) ?? true)
    );
  }

  /**
   * The selectable rows of `rows` (see {@link isSelectable}), in order.
   * Returns `rows` itself when nothing filters them (the community grid
   * without a predicate).
   */
  public selectable(rows: ReadonlyArray<T>): ReadonlyArray<T> {
    return this.#accepted(this.#state?.dataRows(rows) ?? rows);
  }

  /** The rows `selection.isRowSelectable` accepts; `rows` itself when unset. */
  #accepted(rows: ReadonlyArray<T>): ReadonlyArray<T> {
    const accept = this.host.selection?.isRowSelectable;
    return accept ? rows.filter((row) => accept(row)) : rows;
  }

  /**
   * Returns the currently selected rows in insertion order.
   */
  public selectedRows(): T[] {
    return Array.from(this.selected);
  }

  /**
   * Whether every selectable record the current view covers is selected,
   * including the leaves of collapsed groups (see
   * {@link StateController.viewRecords}). `false` when the view covers none.
   * Used by the header checkbox to render its "all" state.
   */
  public allSelected(): boolean {
    const records = this.#records();
    if (records.length === 0) return false;
    for (const row of records) {
      if (!this.selected.has(row)) return false;
    }
    return true;
  }

  /**
   * Whether some — but not all — rows in the current view are selected.
   * Used to render the header checkbox in its indeterminate state.
   */
  public someSelected(): boolean {
    if (this.selected.size === 0) return false;
    if (this.allSelected()) return false;
    return true;
  }

  /**
   * Toggles selection of `row`. In `'single'` mode this either selects the
   * row (replacing any previous selection) or deselects it if it was the
   * only selected row.
   */
  public async toggleRow(row: T): Promise<boolean> {
    if (!this.#togglable(row)) return false;
    const next = new Set(this.selected);
    if (next.has(row)) {
      next.delete(row);
    } else {
      if (this.mode === 'single') next.clear();
      next.add(row);
    }
    this.anchor = next.has(row) ? row : null;
    return this.#commit(next);
  }

  /**
   * Adds `row` to the selection. In `'single'` mode the existing selection
   * is cleared first.
   */
  public async selectRow(row: T): Promise<boolean> {
    if (!this.enabled || !this.isSelectable(row)) return false;
    const next = new Set(this.mode === 'single' ? [] : this.selected);
    next.add(row);
    this.anchor = row;
    return this.#commit(next);
  }

  /**
   * Removes `row` from the selection.
   */
  public async deselectRow(row: T): Promise<boolean> {
    if (!this.enabled) return false;
    if (!this.selected.has(row)) return true;
    const next = new Set(this.selected);
    next.delete(row);
    return this.#commit(next);
  }

  /**
   * Adds `row` to the selection without affecting other selected rows
   * (`'multiple'` mode only). In `'single'` mode this behaves like
   * {@link selectRow}.
   */
  public async additiveToggle(row: T): Promise<boolean> {
    if (!this.#togglable(row)) return false;
    if (this.mode === 'single') return this.toggleRow(row);
    const next = new Set(this.selected);
    if (next.has(row)) {
      next.delete(row);
    } else {
      next.add(row);
    }
    this.anchor = next.has(row) ? row : this.anchor;
    return this.#commit(next);
  }

  /**
   * Selects every row between {@link anchor} and `row` (inclusive) in the
   * current page view. No-op in `'single'` mode or when no anchor is set —
   * in those cases the call falls back to a plain {@link selectRow}.
   */
  public async rangeToggle(row: T): Promise<boolean> {
    if (!this.enabled || !this.isSelectable(row)) return false;
    if (this.mode === 'single' || !this.anchor) {
      return this.selectRow(row);
    }
    const pageItems = this.host.pageItems as ReadonlyArray<T>;
    const startIdx = pageItems.indexOf(this.anchor);
    const endIdx = pageItems.indexOf(row);
    if (startIdx === -1 || endIdx === -1) {
      return this.selectRow(row);
    }
    const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
    const next = new Set(this.selected);
    for (let i = lo; i <= hi; i++) {
      if (this.isSelectable(pageItems[i])) next.add(pageItems[i]);
    }
    return this.#commit(next);
  }

  /**
   * Selects every selectable record the current view
   * ({@link ApexGrid.dataView}) covers, including the leaves of collapsed
   * groups. No-op in `'single'` mode.
   */
  public async selectAll(): Promise<boolean> {
    if (!this.enabled || this.mode === 'single') return false;
    return this.#commit(new Set(this.#records()));
  }

  /**
   * Clears the selection.
   */
  public async clear(): Promise<boolean> {
    if (this.selected.size === 0) return true;
    return this.#commit(new Set());
  }

  /**
   * Replaces the current selection with `rows`. Used by the public
   * {@link ApexGrid.selectedRows} setter so callers can drive selection
   * programmatically. Single-mode keeps at most one row.
   */
  public async replaceSelection(rows: ReadonlyArray<T>): Promise<boolean> {
    if (!this.enabled) return false;
    const records = this.selectable(rows);
    const next = new Set(this.mode === 'single' ? records.slice(0, 1) : records);
    return this.#commit(next);
  }

  /** The owning state controller; absent only while the grid is constructing. */
  get #state(): StateController<T> | undefined {
    return (this.host as unknown as { stateController?: StateController<T> }).stateController;
  }

  /**
   * Whether a toggle may act on `row`: a selected row can always be
   * deselected, even one the predicate has since come to reject (a row
   * pinned or edited in place), so it never gets stuck selected.
   */
  #togglable(row: T): boolean {
    return this.enabled && (this.selected.has(row) || this.isSelectable(row));
  }

  /** The selectable records the current view covers, collapsed group leaves included. */
  #records(): ReadonlyArray<T> {
    const view = this.host.dataView as ReadonlyArray<T>;
    return this.#accepted(this.#state?.viewRecords(view) ?? view);
  }

  async #commit(next: Set<T>): Promise<boolean> {
    const added: T[] = [];
    const removed: T[] = [];
    for (const row of next) {
      if (!this.selected.has(row)) added.push(row);
    }
    for (const row of this.selected) {
      if (!next.has(row)) removed.push(row);
    }
    if (added.length === 0 && removed.length === 0) return true;

    const proceed = this.host.emitEvent('rowSelecting', {
      detail: {
        added,
        removed,
        current: Array.from(this.selected),
        next: Array.from(next),
      },
      cancelable: true,
    });
    if (!proceed) return false;

    this.selected = next;
    this.host.requestUpdate();

    const total = this.selected.size;
    if (total === 0) {
      this.host.announce(this.host.localize('announce.selectionCleared'));
    } else if (added.length === 1 && removed.length === 0 && total === 1) {
      this.host.announce(this.host.localize('announce.rowSelected'));
    } else {
      this.host.announce(this.host.localize('announce.rowsSelected', { count: total }));
    }

    this.host.emitEvent('rowSelected', {
      detail: { added, removed, selected: Array.from(this.selected) },
    });
    return true;
  }
}
