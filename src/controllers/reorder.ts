import type { ReactiveController } from 'lit';
import type { ColumnDropPosition } from '../components/grid.js';
import type { ColumnConfiguration, GridHost, Keys } from '../internal/types.js';

interface ReorderState<T> {
  /** The column currently being dragged. */
  sourceKey: Keys<T>;
  /** The column the cursor is currently over (or `null` between targets). */
  targetKey: Keys<T> | null;
  /** Drop side relative to `targetKey`. */
  position: ColumnDropPosition | null;
  /**
   * The header-row-relative inline-start offset where the visual drop indicator
   * should render. `null` while no valid target is hovered.
   */
  indicatorOffset: number | null;
}

/**
 * Reactive controller backing drag-and-drop column reordering.
 *
 * @remarks
 * Header components feed pointer / native drag events into the controller; the
 * controller exposes a single {@link state} object that the header row reads to
 * render its drop indicator. The actual reorder is delegated to
 * {@link ApexGrid.moveColumn} so it goes through the same cancellable event
 * pipeline as programmatic moves.
 */
export class ReorderController<T extends object> implements ReactiveController {
  public state: ReorderState<T> | null = null;

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
   * are blocked here so the drop indicator reflects what `moveColumn` will
   * actually allow.
   */
  public canDrop(source: ColumnConfiguration<T>, target: ColumnConfiguration<T>): boolean {
    if (source.key === target.key) return false;
    if (!this.isDraggable(source) || !this.isDraggable(target)) return false;
    return (source.pinned ?? null) === (target.pinned ?? null);
  }

  /**
   * Begins a drag from `sourceKey`.
   */
  public start(sourceKey: Keys<T>): void {
    this.state = { sourceKey, targetKey: null, position: null, indicatorOffset: null };
    this.host.requestUpdate();
  }

  /**
   * Updates the drag target while the pointer moves across a header cell.
   */
  public over(target: ColumnConfiguration<T>, cursorClientX: number, headerRect: DOMRect): void {
    if (!this.state) return;
    const source = this.host.getColumn(this.state.sourceKey);
    if (!source || !this.canDrop(source, target)) {
      if (this.state.targetKey !== null) {
        this.state = { ...this.state, targetKey: null, position: null, indicatorOffset: null };
        this.host.requestUpdate();
      }
      return;
    }

    const midpoint = headerRect.left + headerRect.width / 2;
    const position: ColumnDropPosition = cursorClientX < midpoint ? 'before' : 'after';
    const indicatorOffset = this.#computeIndicatorOffset(target.key, position);
    if (
      this.state.targetKey === target.key &&
      this.state.position === position &&
      this.state.indicatorOffset === indicatorOffset
    ) {
      return;
    }
    this.state = {
      sourceKey: this.state.sourceKey,
      targetKey: target.key,
      position,
      indicatorOffset,
    };
    this.host.requestUpdate();
  }

  /**
   * Clears the current drag target without ending the drag (used on dragleave).
   */
  public clearTarget(): void {
    if (!this.state || this.state.targetKey === null) return;
    this.state = { ...this.state, targetKey: null, position: null, indicatorOffset: null };
    this.host.requestUpdate();
  }

  /**
   * Ends the drag session without committing.
   */
  public end(): void {
    if (!this.state) return;
    this.state = null;
    this.host.requestUpdate();
  }

  /**
   * Commits the current drop if one is pending. Returns the promise from
   * {@link ApexGrid.moveColumn}.
   */
  public async drop(): Promise<boolean> {
    if (!this.state || !this.state.targetKey || !this.state.position) {
      this.end();
      return false;
    }
    const { sourceKey, targetKey, position } = this.state;
    this.end();
    return this.host.moveColumn(sourceKey, targetKey, position);
  }

  #computeIndicatorOffset(targetKey: Keys<T>, position: ColumnDropPosition): number | null {
    const rowEl = this.headerRow;
    const headerEl = rowEl?.headers?.find((h) => h.column.key === targetKey);
    if (!headerEl || !rowEl) return null;
    const headerRect = headerEl.getBoundingClientRect();
    const rowRect = rowEl.getBoundingClientRect();
    const edge =
      position === 'before' ? headerRect.left - rowRect.left : headerRect.right - rowRect.left;
    return Math.round(edge);
  }
}
