import type { ReactiveController } from 'lit';
import { awaitChildUpdates, captureRect, type FlipEntry, playFlip } from '../internal/flip.js';
import type { ColumnConfiguration, GridHost, Keys } from '../internal/types.js';
import { isRTL } from '../internal/utils.js';

/**
 * Live drag state surfaced to the header row so it can render the floating
 * "ghost" element that follows the cursor.
 *
 * @remarks
 * The dragged column itself stays in the columns array — we live-swap it
 * with neighbours as the cursor crosses their midpoints, so the rendered
 * order updates while the user is still dragging. The ghost is purely a
 * visual indicator of what the user is grabbing.
 */
interface ReorderState<T> {
  /** The column currently being dragged. */
  sourceKey: Keys<T>;
  /** Ghost position (viewport-relative top-left, in CSS pixels). */
  ghostX: number;
  ghostY: number;
  /** Ghost size — fixed at the source header's initial bounding rect. */
  ghostWidth: number;
  ghostHeight: number;
  /** Cursor offset within the ghost so the grab point stays under the cursor. */
  pointerOffsetX: number;
  pointerOffsetY: number;
  /** Display label for the ghost (header text or column key). */
  label: string;
}

/**
 * Reactive controller backing pointer-driven column reordering with a
 * floating ghost and live mid-drag swaps.
 *
 * @remarks
 * Headers feed `pointerdown` / `pointermove` / `pointerup` events into the
 * controller. While dragging, the controller updates the ghost position and
 * decides whether the cursor has crossed an adjacent column's midpoint —
 * if so it calls {@link ApexGrid.moveColumn} immediately, so the swap
 * happens during the drag instead of waiting for drop. The same cancellable
 * `columnMoving` / follow-up `columnMoved` event pipeline applies for
 * every swap.
 */
export class ReorderController<T extends object> implements ReactiveController {
  public state: ReorderState<T> | null = null;

  /** Re-entrancy guard so a slow `moveColumn` can't trigger a second swap. */
  #swapping = false;

  /**
   * The swap (`targetKey:position`) a `columnMoving` listener last vetoed. It
   * is not asked again while the cursor stays past that target's midpoint,
   * only once the cursor leaves and crosses it afresh.
   */
  #vetoed = '';

  constructor(protected host: GridHost<T>) {
    this.host.addController(this);
  }

  public hostConnected() {}

  protected get headerRow() {
    // @ts-expect-error - protected member access
    return this.host.headerRow as
      | (HTMLElement & { headers?: Array<HTMLElement & { column: ColumnConfiguration<T> }> })
      | undefined;
  }

  /**
   * Whether reordering is enabled for the given column.
   */
  public isDraggable(column: ColumnConfiguration<T>): boolean {
    if (!this.host.columnReordering) return false;
    if (column.hidden) return false;
    return column.reorderable !== false;
  }

  /**
   * Whether `source` may be dropped onto `target`. Cross-pinning-group moves
   * are blocked so the drag can't escape its pin region.
   */
  public canDrop(source: ColumnConfiguration<T>, target: ColumnConfiguration<T>): boolean {
    if (source.key === target.key) return false;
    if (!this.isDraggable(source) || !this.isDraggable(target)) return false;
    if ((source.pinned ?? null) !== (target.pinned ?? null)) return false;
    // Grouped columns reorder only within their own group; ungrouped only among
    // ungrouped. Keeps a group's members contiguous (v1 has no group-level move).
    return (source.group ?? null) === (target.group ?? null);
  }

  /**
   * Begins a drag from `sourceKey`. Captures the source's bounding rect and
   * the cursor offset within it so the ghost stays anchored to the grab
   * point as the cursor moves.
   */
  public start(
    sourceKey: Keys<T>,
    sourceRect: DOMRect,
    initialClientX: number,
    initialClientY: number,
    label: string
  ): void {
    this.state = {
      sourceKey,
      ghostX: sourceRect.left,
      ghostY: sourceRect.top,
      ghostWidth: sourceRect.width,
      ghostHeight: sourceRect.height,
      pointerOffsetX: initialClientX - sourceRect.left,
      pointerOffsetY: initialClientY - sourceRect.top,
      label,
    };
    this.host.requestUpdate();
  }

  /**
   * Updates the ghost position and decides whether to swap with an adjacent
   * column.
   */
  public move(clientX: number, clientY: number): void {
    if (!this.state) return;
    this.state = {
      ...this.state,
      ghostX: clientX - this.state.pointerOffsetX,
      ghostY: clientY - this.state.pointerOffsetY,
    };
    this.host.requestUpdate();
    void this.#checkSwap(clientX);
  }

  /**
   * Ends the drag session. The columns are already in their final order
   * because we live-swapped during the drag, so there's nothing to commit.
   */
  public end(): void {
    if (!this.state) return;
    this.state = null;
    this.#vetoed = '';
    this.host.requestUpdate();
  }

  async #checkSwap(clientX: number): Promise<void> {
    if (!this.state || this.#swapping) return;
    const swap = this.#swapAt(clientX);
    const key = swap ? `${String(swap.target.key)}:${swap.position}` : '';
    if (key && key === this.#vetoed) return;
    this.#vetoed = '';
    if (!swap) return;

    this.#swapping = true;
    try {
      const before = this.#captureCellRects();
      if (!(await this.host.moveColumn(swap.source.key, swap.target.key, swap.position))) {
        this.#vetoed = key;
        return;
      }
      await this.host.updateComplete;
      // Child rows + header row schedule their own updates one microtask
      // after the grid, so wait for them until the cells have actually moved
      // before measuring the "Last" rect.
      await awaitChildUpdates([
        this.headerRow as unknown as { updateComplete: Promise<unknown> } | undefined,
        ...this.host.rows,
      ]);
      playFlip(before, 'x');
    } finally {
      this.#swapping = false;
    }
  }

  /**
   * The swap the cursor at `clientX` asks for: the droppable header under it,
   * once the cursor is past that header's midpoint, or `null`.
   */
  #swapAt(clientX: number) {
    const source = this.state && this.host.getColumn(this.state.sourceKey);
    if (!source) return null;
    const headerRow = this.headerRow;
    if (!headerRow?.headers) return null;

    // Find the visible header whose box currently contains the cursor X.
    const target = headerRow.headers.find((h) => {
      const rect = h.getBoundingClientRect();
      return clientX >= rect.left && clientX < rect.right;
    });
    if (!target || target.column.key === source.key) return null;
    if (!this.canDrop(source, target.column)) return null;

    // Only swap once the cursor crosses the target's midpoint, so we don't
    // bounce back and forth as soon as the ghost touches the edge.
    const rect = target.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    const visibleColumns = this.host.columns.filter((c) => !c.hidden);
    const sourceIdx = visibleColumns.findIndex((c) => c.key === source.key);
    const targetIdx = visibleColumns.findIndex((c) => c.key === target.column.key);
    if (sourceIdx === -1 || targetIdx === -1) return null;

    // `position` is order-based, so it needs no direction awareness. The
    // midpoint test does: moving toward a *later* column means moving right in
    // LTR and left under `dir="rtl"`, so the comparison flips.
    const rtl = isRTL(this.host as unknown as Element);
    let position: 'before' | 'after';
    if (sourceIdx < targetIdx) {
      // Toward a later column — swap once the cursor crosses the target's centre.
      if (rtl ? clientX > midpoint : clientX < midpoint) return null;
      position = 'after';
    } else {
      // Toward an earlier column — swap once the cursor crosses back over it.
      if (rtl ? clientX < midpoint : clientX > midpoint) return null;
      position = 'before';
    }
    return { source, target: target.column, position } as const;
  }

  /**
   * Snapshots the bounding rect of every header + body cell before a
   * swap. Used as the "First" step of a FLIP — after `moveColumn` resolves,
   * `playFlip` computes the delta against the new rect and animates each
   * element from its old position back to identity.
   */
  #captureCellRects(): FlipEntry[] {
    const entries: FlipEntry[] = [];
    const headerRow = this.headerRow;
    if (headerRow?.headers) {
      for (const header of headerRow.headers) {
        entries.push(captureRect(header));
      }
    }
    for (const row of this.host.rows) {
      for (const cell of row.cells) {
        entries.push(captureRect(cell as unknown as HTMLElement));
      }
    }
    return entries;
  }
}
