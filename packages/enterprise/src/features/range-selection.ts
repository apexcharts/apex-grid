import {
  type CellDecoration,
  type CellDecorator,
  type CellDecoratorContext,
  type CellInteraction,
  type CellInteractionHandler,
  type ColumnConfiguration,
  type GridFeatureModule,
  type GridHost,
  getDisplayColumns,
  type StateController,
} from 'apex-grid/internal';
import type { ReactiveController } from 'lit';

export const RANGE_SELECTION_MODULE_ID = 'range-selection';

/** Custom event fired on the grid host whenever the selected range changes. */
export const RANGE_CHANGED_EVENT = 'apex-range-changed';

/** A cell coordinate within the current page/view (visible-column index). */
interface CellRef {
  /** Row index within `host.pageItems`. */
  readonly row: number;
  /** Index within the visible (display-ordered) columns. */
  readonly col: number;
}

/** The rectangular bounds of a selection, in view coordinates. */
export interface RangeBounds {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** Aggregate statistics over the values in the current range. */
export interface RangeStats {
  /** Non-empty cells in the range. */
  readonly count: number;
  /** Cells whose value is numeric (drives sum/avg/min/max). */
  readonly numericCount: number;
  readonly sum: number;
  readonly average: number;
  readonly min: number;
  readonly max: number;
}

/** Detail payload of the {@link RANGE_CHANGED_EVENT}. */
export interface RangeChangedDetail {
  /** Current bounds, or `null` when the selection was cleared. */
  readonly bounds: RangeBounds | null;
  /** Stats over the current range (zeroed when empty). */
  readonly stats: RangeStats;
}

const EMPTY_STATS: RangeStats = {
  count: 0,
  numericCount: 0,
  sum: 0,
  average: 0,
  min: 0,
  max: 0,
};

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/** Coerce a cell value to a finite number, or `null` if it isn't numeric. */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatCell(value: unknown): string {
  if (isBlank(value)) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Enterprise feature: spreadsheet-style cell **range selection**. Click-drag (or
 * shift-click) across body cells to select a rectangular range; the selection is
 * the basis for the {@link RangeStats} status bar and clipboard copy (TSV).
 *
 * Wired through the core seams: it implements {@link CellInteractionHandler} (to
 * track the drag from forwarded pointer events) and {@link CellDecorator} (to
 * flag the cells inside the range with `data-range` / `data-range-edge`, which
 * the core cell styles inertly via `--apex-range-*` custom properties). It also
 * installs host-level listeners for Escape (clear) and Ctrl/Cmd+C (copy).
 */
export class RangeSelectionController<T extends object>
  implements ReactiveController, CellDecorator<T>, CellInteractionHandler<T>
{
  /** Whether range selection is active. When `false`, the feature is inert. */
  public enabled = true;

  #anchor: CellRef | null = null;
  #focus: CellRef | null = null;
  #dragging = false;

  constructor(
    private host: GridHost<T>,
    private state: StateController<T>
  ) {
    host.addController(this);
  }

  // --- lifecycle -----------------------------------------------------------

  public hostConnected(): void {
    const el = this.host as unknown as HTMLElement;
    el.addEventListener('keydown', this.#onKeydown);
    // Catch pointer release outside the grid body so a drag always ends.
    globalThis.addEventListener?.('pointerup', this.#onWindowPointerUp);
  }

  public hostDisconnected(): void {
    const el = this.host as unknown as HTMLElement;
    el.removeEventListener('keydown', this.#onKeydown);
    globalThis.removeEventListener?.('pointerup', this.#onWindowPointerUp);
  }

  #onWindowPointerUp = (): void => {
    this.#dragging = false;
  };

  #onKeydown = (event: KeyboardEvent): void => {
    if (!this.enabled || !this.hasSelection()) return;
    if (event.key === 'Escape') {
      this.clearSelection();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key === 'c' || event.key === 'C')) {
      event.preventDefault();
      void this.copySelection();
    }
  };

  // --- CellInteractionHandler ---------------------------------------------

  public handleCellInteraction(interaction: CellInteraction<T>): void {
    if (!this.enabled) return;
    const col = this.#colIndex(interaction.column);
    if (col < 0) return;
    const ref: CellRef = { row: interaction.rowIndex, col };

    switch (interaction.kind) {
      case 'down': {
        // Primary button only; let right-click / middle-click pass through.
        if (interaction.originalEvent.button !== 0) return;
        if (interaction.shiftKey && this.#anchor) {
          this.#focus = ref;
        } else {
          this.#anchor = ref;
          this.#focus = ref;
        }
        this.#dragging = true;
        this.#commit();
        return;
      }
      case 'over': {
        if (!this.#dragging) return;
        if (this.#focus && this.#focus.row === ref.row && this.#focus.col === ref.col) return;
        this.#focus = ref;
        this.#commit();
        return;
      }
      case 'up': {
        this.#dragging = false;
        return;
      }
    }
  }

  // --- CellDecorator -------------------------------------------------------

  public decorateCell(ctx: CellDecoratorContext<T>): CellDecoration | null {
    if (!this.enabled) return null;
    const bounds = this.getSelectionBounds();
    if (!bounds) return null;
    const col = this.#colIndex(ctx.column);
    if (col < 0) return null;
    const row = ctx.rowIndex;
    if (row < bounds.top || row > bounds.bottom || col < bounds.left || col > bounds.right) {
      return null;
    }

    const edges: string[] = [];
    if (row === bounds.top) edges.push('top');
    if (row === bounds.bottom) edges.push('bottom');
    if (col === bounds.left) edges.push('left');
    if (col === bounds.right) edges.push('right');

    const isFocus = this.#focus?.row === row && this.#focus?.col === col;
    return {
      attributes: {
        'data-range': isFocus ? 'selected active' : 'selected',
        'data-range-edge': edges.length ? edges.join(' ') : null,
      },
    };
  }

  // --- public API ----------------------------------------------------------

  /**
   * Programmatically select a rectangular range by row index and column key
   * (the anchor → focus corners). `to` defaults to `from` for a single cell.
   * No-op if the feature is disabled or a column key isn't visible.
   */
  public selectRange(
    from: { row: number; column: string },
    to: { row: number; column: string } = from
  ): void {
    if (!this.enabled) return;
    const columns = this.#visibleColumns();
    const indexOf = (key: string) => columns.findIndex((column) => String(column.key) === key);
    const anchorCol = indexOf(from.column);
    const focusCol = indexOf(to.column);
    if (anchorCol < 0 || focusCol < 0) return;
    this.#anchor = { row: from.row, col: anchorCol };
    this.#focus = { row: to.row, col: focusCol };
    this.#dragging = false;
    this.#commit();
  }

  /** Whether a range is currently selected. */
  public hasSelection(): boolean {
    return this.#anchor !== null && this.#focus !== null;
  }

  /** The current rectangular bounds (view coordinates), or `null`. */
  public getSelectionBounds(): RangeBounds | null {
    if (!this.#anchor || !this.#focus) return null;
    return {
      top: Math.min(this.#anchor.row, this.#focus.row),
      bottom: Math.max(this.#anchor.row, this.#focus.row),
      left: Math.min(this.#anchor.col, this.#focus.col),
      right: Math.max(this.#anchor.col, this.#focus.col),
    };
  }

  /** Clears the selection and refreshes decoration. */
  public clearSelection(): void {
    if (!this.hasSelection()) return;
    this.#anchor = null;
    this.#focus = null;
    this.#dragging = false;
    this.#commit();
  }

  /** Aggregate statistics over the current range (zeroed when empty). */
  public getSelectionStats(): RangeStats {
    const { values } = this.#cellsInRange();
    let count = 0;
    let numericCount = 0;
    let sum = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (const rowValues of values) {
      for (const value of rowValues) {
        if (isBlank(value)) continue;
        count += 1;
        const n = toNumber(value);
        if (n !== null) {
          numericCount += 1;
          sum += n;
          if (n < min) min = n;
          if (n > max) max = n;
        }
      }
    }

    if (numericCount === 0) {
      return { count, numericCount: 0, sum: 0, average: 0, min: 0, max: 0 };
    }
    return { count, numericCount, sum, average: sum / numericCount, min, max };
  }

  /** The current range serialized as tab-separated values (Excel-pasteable). */
  public getSelectionTSV(): string {
    const { values } = this.#cellsInRange();
    return values.map((rowValues) => rowValues.map(formatCell).join('\t')).join('\n');
  }

  /**
   * Copies the current range to the clipboard as TSV. Resolves `false` when
   * there's nothing selected or the clipboard API is unavailable/blocked.
   */
  public async copySelection(): Promise<boolean> {
    const tsv = this.getSelectionTSV();
    if (!tsv) return false;
    try {
      await navigator.clipboard.writeText(tsv);
      const cells = this.#cellsInRange().values.reduce((sum, row) => sum + row.length, 0);
      this.host.announce(`Copied ${cells} cells to the clipboard`);
      return true;
    } catch {
      return false;
    }
  }

  // --- internals -----------------------------------------------------------

  /** Visible columns in display (pinned/reorder) order. */
  #visibleColumns(): ColumnConfiguration<T>[] {
    return getDisplayColumns(this.host.columns).filter((column) => !column.hidden);
  }

  #colIndex(column: ColumnConfiguration<T>): number {
    return this.#visibleColumns().findIndex((candidate) => candidate.key === column.key);
  }

  #cellsInRange(): { values: unknown[][]; columns: ColumnConfiguration<T>[] } {
    const bounds = this.getSelectionBounds();
    if (!bounds) return { values: [], columns: [] };
    const columns = this.#visibleColumns().slice(bounds.left, bounds.right + 1);
    const items = this.host.pageItems as ReadonlyArray<Record<string, unknown>>;
    const values: unknown[][] = [];
    for (let row = bounds.top; row <= bounds.bottom; row += 1) {
      const record = items[row];
      if (!record) continue;
      values.push(columns.map((column) => record[String(column.key)]));
    }
    return { values, columns };
  }

  /** Re-decorate cells and notify listeners (status bar / app) of the change. */
  #commit(): void {
    this.state.bumpDecoration();
    const bounds = this.getSelectionBounds();
    const detail: RangeChangedDetail = {
      bounds,
      stats: bounds ? this.getSelectionStats() : EMPTY_STATS,
    };
    (this.host as unknown as HTMLElement).dispatchEvent(
      new CustomEvent<RangeChangedDetail>(RANGE_CHANGED_EVENT, {
        detail,
        bubbles: true,
        composed: true,
      })
    );
  }
}

/** Feature module registered on the enterprise grid. */
export const rangeSelectionModule: GridFeatureModule = {
  id: RANGE_SELECTION_MODULE_ID,
  create: (host, state) => new RangeSelectionController(host, state),
};
