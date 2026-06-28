import type { ReactiveController } from 'lit';
import type { GridHost } from '../internal/types.js';

/** Where a row is pinned, or `null` when it scrolls with the body. */
export type RowPinPosition = 'top' | 'bottom';

/**
 * Reactive controller backing row pinning.
 *
 * @remarks
 * Pinned rows are lifted out of the scrollable body and rendered in sticky
 * bands above (`'top'`) or below (`'bottom'`) the virtualized rows. State is
 * reference-based: the controller holds a `Set` of row data references per band,
 * so pins survive sort / filter / pagination as long as those preserve row
 * identity (the default in-place pipeline does). Replacing {@link ApexGrid.data}
 * wholesale should be followed by re-pinning or {@link clear}.
 *
 * Mutations go through the cancellable `rowPinning` event and emit a follow-up
 * `rowPinned` event, mirroring selection / expansion.
 */
export class RowPinController<T extends object> implements ReactiveController {
  #top: Set<T> = new Set();
  #bottom: Set<T> = new Set();

  constructor(protected host: GridHost<T>) {
    this.host.addController(this);
  }

  public hostConnected() {}

  /** Whether row pinning is enabled at the grid level. */
  public get enabled(): boolean {
    return Boolean(this.host.rowPinning?.enabled);
  }

  /** Whether any row is currently pinned. */
  public get hasPinnedRows(): boolean {
    return this.#top.size > 0 || this.#bottom.size > 0;
  }

  /** The band `row` is pinned to, or `null` when it is not pinned. */
  public pinnedPosition(row: T): RowPinPosition | null {
    if (this.#top.has(row)) return 'top';
    if (this.#bottom.has(row)) return 'bottom';
    return null;
  }

  /** Whether `row` is pinned to either band. */
  public isPinned(row: T): boolean {
    return this.#top.has(row) || this.#bottom.has(row);
  }

  /** Pinned rows per band, in the order they were pinned. */
  public get pinnedRows(): { top: T[]; bottom: T[] } {
    return { top: [...this.#top], bottom: [...this.#bottom] };
  }

  /**
   * Pins `row` to the given band. Moves it between bands when already pinned
   * elsewhere. No-op (returns `true`) when it is already pinned there.
   *
   * @returns `true` when applied, `false` when disabled or cancelled.
   */
  public pinRow(row: T, position: RowPinPosition): boolean {
    if (!this.enabled) return false;
    if (this.pinnedPosition(row) === position) return true;
    if (!this.#emitPinning(row, position)) return false;

    this.#top.delete(row);
    this.#bottom.delete(row);
    (position === 'top' ? this.#top : this.#bottom).add(row);
    this.#commit(row, position, `Row pinned to ${position}`);
    return true;
  }

  /**
   * Unpins `row` from whichever band holds it. No-op (returns `true`) when it is
   * not pinned.
   *
   * @returns `true` when applied, `false` when cancelled.
   */
  public unpinRow(row: T): boolean {
    if (!this.isPinned(row)) return true;
    if (!this.#emitPinning(row, null)) return false;

    this.#top.delete(row);
    this.#bottom.delete(row);
    this.#commit(row, null, 'Row unpinned');
    return true;
  }

  /** Clears every pin in both bands. */
  public clear(): void {
    if (!this.hasPinnedRows) return;
    this.#top.clear();
    this.#bottom.clear();
    this.host.requestUpdate();
  }

  /**
   * Restores pinned rows from explicit per-band reference lists (state restore),
   * replacing any current pins. Silent: emits no `rowPinning` / `rowPinned` and
   * preserves the given order within each band.
   */
  public restore(top: ReadonlyArray<T>, bottom: ReadonlyArray<T>): void {
    this.#top = new Set(top);
    this.#bottom = new Set(bottom);
    this.host.requestUpdate();
  }

  #emitPinning(row: T, position: RowPinPosition | null): boolean {
    return this.host.emitEvent('rowPinning', {
      detail: { row, position },
      cancelable: true,
    });
  }

  #commit(row: T, position: RowPinPosition | null, message: string): void {
    this.host.requestUpdate();
    this.host.announce(message);
    this.host.emitEvent('rowPinned', { detail: { row, position } });
  }
}
