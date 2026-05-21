import type { ReactiveController } from 'lit';
import type { GridHost, SelectionMode } from '../internal/types.js';

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

  constructor(protected host: GridHost<T>) {
    this.host.addController(this);
  }

  public hostConnected() {}

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
   * Returns the currently selected rows in insertion order.
   */
  public selectedRows(): T[] {
    return Array.from(this.selected);
  }

  /**
   * Whether every row in the current view ({@link ApexGrid.dataView}) is
   * selected. Used by the header checkbox to render its "all" state.
   */
  public allSelected(): boolean {
    const view = this.host.dataView;
    if (view.length === 0) return false;
    return view.every((row) => this.selected.has(row as T));
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
    if (!this.enabled) return false;
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
    if (!this.enabled) return false;
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
    if (!this.enabled) return false;
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
    if (!this.enabled) return false;
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
      next.add(pageItems[i] as T);
    }
    return this.#commit(next);
  }

  /**
   * Selects every row currently in view ({@link ApexGrid.dataView}). No-op
   * in `'single'` mode.
   */
  public async selectAll(): Promise<boolean> {
    if (!this.enabled || this.mode === 'single') return false;
    const next = new Set(this.host.dataView as ReadonlyArray<T>);
    return this.#commit(next);
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
    const next = new Set(this.mode === 'single' ? rows.slice(0, 1) : rows);
    return this.#commit(next);
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

    this.host.emitEvent('rowSelected', {
      detail: { added, removed, selected: Array.from(this.selected) },
    });
    return true;
  }
}
