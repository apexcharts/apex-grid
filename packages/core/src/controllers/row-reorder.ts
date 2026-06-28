import type { ReactiveController } from 'lit';
import { PIPELINE } from '../internal/constants.js';
import { awaitChildUpdates, type KeyedFlipEntry, playKeyedFlip } from '../internal/flip.js';
import type { GridHost } from '../internal/types.js';

/** Where a moved row lands relative to its target. */
export type RowDropPosition = 'before' | 'after';

/**
 * Reactive controller backing row drag-reorder and a manual row order.
 *
 * @remarks
 * Row order is normally derived (filter → sort). This controller adds a
 * **manual order**: an explicit sequence of row references applied as a
 * pipeline step after sort. While a manual order is active, sorting is mutually
 * exclusive (applying a sort clears the manual order). State is reference-based,
 * so it survives the in-place pipeline.
 *
 * Reordering happens through {@link moveRow} (pointer live-swap during a drag,
 * the keyboard grab/move flow, or the public API). Each move goes through the
 * cancellable `rowMoving` event and emits a follow-up `rowMoved`, then animates
 * with a Y-axis FLIP. Pinned rows (F4) are never the drag source and reorder
 * only within the unpinned body set.
 *
 * Persistence: by default the order lives in this controller and the app
 * persists via `rowMoved`. With `rowReordering.applyToData` the move also
 * splices {@link ApexGrid.data} in place (and clears the manual order, since the
 * data array then carries the order).
 */
export class RowReorderController<T extends object> implements ReactiveController {
  /** Manual order of row references, or `null` for the natural (sorted) order. */
  #order: T[] | null = null;

  /** Order snapshot captured at keyboard-grab time, for Escape-to-cancel. */
  #preGrab: T[] | null = null;

  /** The row currently being pointer-dragged, or `null`. */
  public dragging: T | null = null;

  /** The row currently grabbed for keyboard reorder, or `null`. */
  public grabbed: T | null = null;

  /** Re-entrancy guard so a slow swap can't trigger a second mid-drag. */
  #swapping = false;

  constructor(protected host: GridHost<T>) {
    this.host.addController(this);
  }

  public hostConnected() {}

  /** Whether row reordering is enabled at the grid level. */
  public get enabled(): boolean {
    return Boolean(this.host.rowReordering?.enabled);
  }

  /** Whether moves also splice {@link ApexGrid.data} in place. */
  public get applyToData(): boolean {
    return Boolean(this.host.rowReordering?.applyToData);
  }

  /** Whether a manual order is currently active. */
  public get hasManualOrder(): boolean {
    return this.#order !== null;
  }

  /** Whether a row is currently grabbed for keyboard reorder. */
  public get isGrabbing(): boolean {
    return this.grabbed !== null;
  }

  /**
   * Pipeline step: reorders the (post-filter, post-sort) rows by the manual
   * order. Rows absent from the manual order (e.g. newly added) keep their
   * incoming relative order at the end. Identity pass-through when inactive.
   */
  public apply(rows: T[]): T[] {
    if (!this.#order) return rows;
    const rank = new Map<T, number>();
    this.#order.forEach((row, i) => {
      rank.set(row, i);
    });
    return [...rows].sort((a, b) => {
      const ra = rank.has(a) ? (rank.get(a) as number) : Number.POSITIVE_INFINITY;
      const rb = rank.has(b) ? (rank.get(b) as number) : Number.POSITIVE_INFINITY;
      return ra - rb;
    });
  }

  /**
   * The current manual order as a copy of its row references, or `null` for the
   * derived order. Consumed by `ApexGrid.getState`.
   */
  public getManualOrder(): T[] | null {
    return this.#order ? [...this.#order] : null;
  }

  /**
   * Restores a manual order from a list of row references (state restore). Pass
   * `null` (or an empty list) to clear it. Silent: emits no `rowMoving` /
   * `rowMoved` and does not animate; re-runs the pipeline.
   */
  public restoreManualOrder(order: T[] | null): void {
    this.#order = order && order.length ? [...order] : null;
    this.host.requestUpdate(PIPELINE);
  }

  /**
   * Clears the manual order (e.g. when a sort is applied). Re-runs the pipeline.
   */
  public clearManualOrder(announce = false): void {
    if (!this.#order) return;
    this.#order = null;
    this.host.requestUpdate(PIPELINE);
    if (announce) this.host.announce('Manual row order cleared');
  }

  /**
   * Moves the row at view index `from` relative to the row at view index `to`.
   * Indices are into {@link ApexGrid.pageItems}.
   *
   * @returns `true` when applied, `false` when disabled, out of range, or
   * cancelled via `rowMoving`.
   */
  public moveRow(from: number, to: number, position: RowDropPosition = 'before'): boolean {
    const view = this.host.pageItems;
    const before = this.#captureRowRects();
    const ok = this.#commit(view[from] as T, view[to] as T, position);
    if (ok) void this.#flipAfterUpdate(before);
    return ok;
  }

  // --- pointer drag -------------------------------------------------------

  /** Begins a pointer drag from `source`. */
  public startDrag(source: T): void {
    if (!this.enabled) return;
    this.dragging = source;
    this.host.requestUpdate();
  }

  /**
   * Called on pointer-move during a drag: live-swaps the dragged row past the
   * body row currently under `clientY` once the cursor crosses its midpoint.
   */
  public dragOver(clientY: number): void {
    if (!this.dragging || this.#swapping) return;
    const target = this.#bodyRowAt(clientY);
    if (!target || target.data === this.dragging) return;

    const view = this.host.pageItems;
    const sourceIdx = view.indexOf(this.dragging);
    const targetIdx = view.indexOf(target.data);
    if (sourceIdx === -1 || targetIdx === -1) return;

    const rect = target.element.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    let position: RowDropPosition;
    if (sourceIdx < targetIdx) {
      if (clientY < midpoint) return; // dragging down — wait for the midpoint
      position = 'after';
    } else {
      if (clientY > midpoint) return; // dragging up
      position = 'before';
    }
    void this.#dragSwap(target.data, position);
  }

  /** Ends the pointer drag. The order is already final (live-swapped). */
  public endDrag(): void {
    if (!this.dragging) return;
    this.dragging = null;
    this.host.requestUpdate();
  }

  async #dragSwap(target: T, position: RowDropPosition): Promise<void> {
    if (this.#swapping) return;
    this.#swapping = true;
    try {
      const before = this.#captureRowRects();
      if (this.#commit(this.dragging as T, target, position)) {
        await this.host.updateComplete;
        await awaitChildUpdates(this.host.rows);
        this.#playRowFlip(before);
      }
    } finally {
      this.#swapping = false;
    }
  }

  // --- keyboard grab ------------------------------------------------------

  /** Grabs the row at view index `rowIndex` for keyboard reorder. */
  public grab(rowIndex: number): boolean {
    if (!this.enabled) return false;
    const row = this.host.pageItems[rowIndex] as T | undefined;
    if (!row) return false;
    this.grabbed = row;
    this.#preGrab = this.#order ? [...this.#order] : null;
    this.host.requestUpdate();
    this.host.announce('Row grabbed. Use arrow keys to move, Enter to drop, Escape to cancel.');
    return true;
  }

  /**
   * Moves the grabbed row one position in `direction`. Returns the grabbed
   * row's new view index, or `-1` when it can't move (no grab / at the edge).
   */
  public moveGrabbed(direction: -1 | 1): number {
    if (!this.grabbed) return -1;
    const view = this.host.pageItems;
    const current = view.indexOf(this.grabbed);
    const target = current + direction;
    if (current === -1 || target < 0 || target >= view.length) return -1;
    const before = this.#captureRowRects();
    const ok = this.#commit(this.grabbed, view[target] as T, direction > 0 ? 'after' : 'before', {
      silent: true,
    });
    if (!ok) return -1;
    void this.#flipAfterUpdate(before);
    this.host.announce(`Row moved to position ${target + 1}`);
    return target;
  }

  /** Drops the grabbed row, keeping its moves. */
  public drop(): void {
    if (!this.grabbed) return;
    this.grabbed = null;
    this.#preGrab = null;
    this.host.requestUpdate();
    this.host.announce('Row dropped');
  }

  /** Cancels the grab, reverting to the order captured when it was grabbed. */
  public cancelGrab(): void {
    if (!this.grabbed) return;
    this.grabbed = null;
    this.#order = this.#preGrab;
    this.#preGrab = null;
    this.host.requestUpdate(PIPELINE);
    this.host.announce('Reorder cancelled');
  }

  // --- internals ----------------------------------------------------------

  /**
   * The core order mutation: validates, emits `rowMoving` (cancellable),
   * updates the manual order (or splices data when `applyToData`), re-runs the
   * pipeline, and emits `rowMoved`. Does not animate.
   */
  #commit(
    source: T | undefined,
    target: T | undefined,
    position: RowDropPosition,
    options: { silent?: boolean } = {}
  ): boolean {
    if (!this.enabled || !source || !target || source === target) return false;
    const view = this.host.pageItems;
    const from = view.indexOf(source);
    const to = view.indexOf(target);

    const proceed = this.host.emitEvent('rowMoving', {
      detail: { from, to, data: source },
      cancelable: true,
    });
    if (!proceed) return false;

    const baseline = this.#order ?? [...(this.host.dataView as ReadonlyArray<T>)];
    const next = baseline.filter((row) => row !== source);
    let index = next.indexOf(target);
    if (index === -1) return false;
    if (position === 'after') index += 1;
    next.splice(index, 0, source);

    if (this.applyToData) {
      this.#spliceData(next);
      this.#order = null; // the data array now carries the order
    } else {
      this.#order = next;
    }

    this.host.requestUpdate(PIPELINE);
    if (!options.silent) this.host.announce('Row moved');
    this.host.emitEvent('rowMoved', { detail: { from, to, data: source } });
    return true;
  }

  /** Reorders {@link ApexGrid.data} in place to match `order`. */
  #spliceData(order: ReadonlyArray<T>): void {
    const rank = new Map<T, number>();
    order.forEach((row, i) => {
      rank.set(row, i);
    });
    (this.host.data as T[]).sort((a, b) => {
      const ra = rank.has(a) ? (rank.get(a) as number) : Number.POSITIVE_INFINITY;
      const rb = rank.has(b) ? (rank.get(b) as number) : Number.POSITIVE_INFINITY;
      return ra - rb;
    });
  }

  /** The rendered body row (non-pinned) whose box contains `clientY`. */
  #bodyRowAt(clientY: number): { data: T; element: HTMLElement } | null {
    const pinned = this.host.pinnedRows;
    for (const row of this.host.rows) {
      if (pinned.top.includes(row.data) || pinned.bottom.includes(row.data)) continue;
      const element = row as unknown as HTMLElement;
      const rect = element.getBoundingClientRect();
      if (clientY >= rect.top && clientY < rect.bottom) return { data: row.data, element };
    }
    return null;
  }

  #captureRowRects(): KeyedFlipEntry<T>[] {
    const entries: KeyedFlipEntry<T>[] = [];
    for (const row of this.host.rows) {
      const el = row as unknown as HTMLElement;
      entries.push({ key: row.data, rect: el.getBoundingClientRect() });
    }
    return entries;
  }

  async #flipAfterUpdate(before: ReadonlyArray<KeyedFlipEntry<T>>): Promise<void> {
    await this.host.updateComplete;
    await awaitChildUpdates(this.host.rows);
    this.#playRowFlip(before);
  }

  #playRowFlip(before: ReadonlyArray<KeyedFlipEntry<T>>): void {
    const byData = new Map<T, HTMLElement>();
    for (const row of this.host.rows) {
      byData.set(row.data, row as unknown as HTMLElement);
    }
    playKeyedFlip(before, (data) => byData.get(data) ?? null, 'y');
  }
}
