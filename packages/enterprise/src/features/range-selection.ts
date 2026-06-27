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
  PIPELINE,
  type StateController,
} from 'apex-grid/internal';
import type { ReactiveController } from 'lit';

export const RANGE_SELECTION_MODULE_ID = 'range-selection';

/** Custom event fired on the grid host whenever the selected range changes. */
export const RANGE_CHANGED_EVENT = 'apex-range-changed';

/** How close (px) to a cell's bottom-right corner counts as grabbing the fill handle. */
const FILL_HANDLE_HIT = 10;

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

/** Aggregate statistics over the values in the current selection. */
export interface RangeStats {
  /** Non-empty cells in the selection. */
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
  /** Active range bounds, or `null` when the selection was cleared. */
  readonly bounds: RangeBounds | null;
  /** All selected rectangles (additional Ctrl-click ranges + the active one). */
  readonly ranges: RangeBounds[];
  /** Stats over every selected cell (deduped across ranges; zeroed when empty). */
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

function sameBounds(a: RangeBounds, b: RangeBounds): boolean {
  return a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.right === b.right;
}

/**
 * Enterprise feature: spreadsheet-style cell **range selection** and the
 * productivity tools built on it — multi-range (Ctrl-click), clipboard
 * copy/paste (TSV), and a drag **fill handle** (copy or numeric series).
 *
 * Wired through the core seams: it implements {@link CellInteractionHandler} (to
 * track drags from forwarded pointer events) and {@link CellDecorator} (to flag
 * in-range cells with `data-range` / `data-range-edge` and the corner with
 * `data-range-handle`, all styled inertly by the core cell via `--apex-range-*`).
 * It also installs host listeners for Escape (clear), Ctrl/Cmd+C (copy), and
 * Ctrl/Cmd+V (paste).
 */
export class RangeSelectionController<T extends object>
  implements ReactiveController, CellDecorator<T>, CellInteractionHandler<T>
{
  /** Whether range selection is active. When `false`, the feature is inert. */
  public enabled = true;

  /** The active range's corners. */
  #anchor: CellRef | null = null;
  #focus: CellRef | null = null;
  /** Committed extra rectangles from Ctrl-click (the active range is separate). */
  #additional: RangeBounds[] = [];

  #mode: 'idle' | 'select' | 'fill' = 'idle';
  /** Fill-drag state: the source range and the live preview region. */
  #fillSource: RangeBounds | null = null;
  #fillPreview: RangeBounds | null = null;

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
    if (this.#mode === 'fill') this.#commitFill();
    this.#mode = 'idle';
  };

  #onKeydown = (event: KeyboardEvent): void => {
    if (!this.enabled || !this.hasSelection()) return;
    if (event.key === 'Escape') {
      this.clearSelection();
      return;
    }
    const accel = event.ctrlKey || event.metaKey;
    if (accel && (event.key === 'c' || event.key === 'C')) {
      event.preventDefault();
      void this.copySelection();
      return;
    }
    if (accel && (event.key === 'v' || event.key === 'V')) {
      event.preventDefault();
      void this.pasteFromClipboard();
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

        // Grabbing the fill handle starts a fill-drag rather than a selection.
        if (this.#isHandleGrab(interaction, ref)) {
          this.#fillSource = this.#activeBounds();
          this.#fillPreview = this.#fillSource;
          this.#mode = 'fill';
          this.#commit();
          return;
        }

        // Move the grid's active (focused) cell to the pressed cell so an earlier click's active
        // outline doesn't linger outside the new selection. A Shift-extend keeps the existing
        // anchor active, matching spreadsheet behavior.
        if (!(interaction.shiftKey && this.#anchor)) {
          this.state.active = { column: interaction.column.key, row: interaction.rowIndex };
        }

        const additive = (interaction.ctrlKey || interaction.metaKey) && !interaction.shiftKey;
        if (interaction.shiftKey && this.#anchor) {
          this.#focus = ref;
        } else if (additive) {
          const current = this.#activeBounds();
          if (current) this.#additional.push(current);
          this.#anchor = ref;
          this.#focus = ref;
        } else {
          this.#additional = [];
          this.#anchor = ref;
          this.#focus = ref;
        }
        this.#mode = 'select';
        this.#commit();
        return;
      }
      case 'over': {
        if (this.#mode === 'fill' && this.#fillSource) {
          this.#fillPreview = this.#computeFillPreview(this.#fillSource, ref);
          this.#commit();
          return;
        }
        if (this.#mode !== 'select') return;
        if (this.#focus && this.#focus.row === ref.row && this.#focus.col === ref.col) return;
        this.#focus = ref;
        this.#commit();
        return;
      }
      case 'up': {
        if (this.#mode === 'fill') this.#commitFill();
        this.#mode = 'idle';
        this.#commit();
        return;
      }
    }
  }

  // --- CellDecorator -------------------------------------------------------

  public decorateCell(ctx: CellDecoratorContext<T>): CellDecoration | null {
    if (!this.enabled) return null;
    const ranges = this.getRanges();
    if (!ranges.length) return null;
    const col = this.#colIndex(ctx.column);
    if (col < 0) return null;
    const row = ctx.rowIndex;

    const container = ranges.find(
      (b) => row >= b.top && row <= b.bottom && col >= b.left && col <= b.right
    );
    if (!container) return null;

    const edges: string[] = [];
    if (row === container.top) edges.push('top');
    if (row === container.bottom) edges.push('bottom');
    if (col === container.left) edges.push('left');
    if (col === container.right) edges.push('right');

    const isFocus = this.#mode !== 'fill' && this.#focus?.row === row && this.#focus?.col === col;
    // The fill handle sits on the bottom-right of the primary range, shown only
    // when idle so it doesn't get in the way of an in-progress drag.
    const primary = this.#fillPreview ?? this.#activeBounds();
    const isHandle =
      this.#mode === 'idle' && !!primary && row === primary.bottom && col === primary.right;

    return {
      attributes: {
        'data-range': isFocus ? 'selected active' : 'selected',
        'data-range-edge': edges.length ? edges.join(' ') : null,
        'data-range-handle': isHandle ? '' : null,
      },
    };
  }

  // --- public API ----------------------------------------------------------

  /**
   * Programmatically select a rectangular range by row index and column key
   * (the anchor → focus corners). `to` defaults to `from` for a single cell.
   * Clears any multi-range selection. No-op if disabled or a key isn't visible.
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
    this.#additional = [];
    this.#anchor = { row: from.row, col: anchorCol };
    this.#focus = { row: to.row, col: focusCol };
    this.#mode = 'idle';
    this.#commit();
  }

  /** Whether any range is currently selected. */
  public hasSelection(): boolean {
    return this.#anchor !== null && this.#focus !== null;
  }

  /** The active range's bounds (view coordinates), or `null`. */
  public getSelectionBounds(): RangeBounds | null {
    return this.#activeBounds();
  }

  /** Every selected rectangle (committed Ctrl-click ranges + the active one). */
  public getRanges(): RangeBounds[] {
    const ranges = [...this.#additional];
    const primary = this.#fillPreview ?? this.#activeBounds();
    if (primary) ranges.push(primary);
    return ranges;
  }

  /**
   * The active range as a labeled grid for charting/inspection: the in-range display columns and
   * their per-row cell values (clipped to existing rows). `null` when nothing is selected. A
   * multi-range selection uses the active (primary) range.
   */
  public getActiveGrid(): { columns: ColumnConfiguration<T>[]; rows: unknown[][] } | null {
    const bounds = this.#activeBounds();
    if (!bounds) return null;
    return {
      columns: this.#visibleColumns().slice(bounds.left, bounds.right + 1),
      rows: this.#matrix(bounds),
    };
  }

  /** Clears the selection and refreshes decoration. */
  public clearSelection(): void {
    if (!this.hasSelection()) return;
    this.#anchor = null;
    this.#focus = null;
    this.#additional = [];
    this.#fillSource = null;
    this.#fillPreview = null;
    this.#mode = 'idle';
    this.#commit();
  }

  /** Aggregate statistics over every selected cell (deduped across ranges). */
  public getSelectionStats(): RangeStats {
    let count = 0;
    let numericCount = 0;
    let sum = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (const value of this.#unionValues()) {
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

    if (numericCount === 0) {
      return { count, numericCount: 0, sum: 0, average: 0, min: 0, max: 0 };
    }
    return { count, numericCount, sum, average: sum / numericCount, min, max };
  }

  /**
   * The selection serialized as TSV (Excel-pasteable). A single range is one
   * matrix; multiple Ctrl-click ranges are emitted as blocks separated by a
   * blank line.
   */
  public getSelectionTSV(): string {
    return this.getRanges()
      .map((bounds) =>
        this.#matrix(bounds)
          .map((line) => line.map(formatCell).join('\t'))
          .join('\n')
      )
      .join('\n\n');
  }

  /**
   * Copies the selection to the clipboard as TSV. Resolves `false` when there's
   * nothing selected or the clipboard API is unavailable/blocked.
   */
  public async copySelection(): Promise<boolean> {
    const tsv = this.getSelectionTSV();
    if (!tsv) return false;
    try {
      await navigator.clipboard.writeText(tsv);
      this.host.announce('Copied selection to the clipboard');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Writes a block of TSV (rows split on `\n`, columns on `\t`) into the grid
   * starting at the active range's top-left cell, then expands the selection to
   * cover the written block. Values are coerced to the target column's type.
   * Cells beyond the data/columns are clipped. No-op without an active range.
   */
  public pasteText(text: string): void {
    if (!this.enabled || !text) return;
    const start = this.#activeBounds();
    if (!start) return;

    const matrix = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map((line) => line.split('\t'));
    // Drop a trailing empty line (common with copied blocks).
    if (
      matrix.length > 1 &&
      matrix[matrix.length - 1].length === 1 &&
      matrix[matrix.length - 1][0] === ''
    ) {
      matrix.pop();
    }

    const columns = this.#visibleColumns();
    const items = this.host.pageItems as Record<string, unknown>[];
    let wrote = false;
    let lastRow = start.top;
    let lastCol = start.left;

    // Coalesce the whole paste into one undo step.
    this.state.history.beginBatch();
    try {
      for (let i = 0; i < matrix.length; i += 1) {
        const row = start.top + i;
        const record = items[row];
        if (!record) continue;
        for (let j = 0; j < matrix[i].length; j += 1) {
          const colIndex = start.left + j;
          const column = columns[colIndex];
          if (!column) continue;
          // Route through the editing choke point so paste participates in the
          // cellValueChanging/cellValueChanged events (and, in turn, validation +
          // undo). The pasted region still drives the selection regardless of
          // whether a given cell's value actually changed.
          this.state.editing.applyCellEdit(
            row,
            column.key,
            record as T,
            this.#coerce(matrix[i][j], column)
          );
          wrote = true;
          lastRow = Math.max(lastRow, row);
          lastCol = Math.max(lastCol, colIndex);
        }
      }
    } finally {
      this.state.history.endBatch();
    }
    if (!wrote) return;

    this.#additional = [];
    this.#anchor = { row: start.top, col: start.left };
    this.#focus = { row: lastRow, col: lastCol };
    this.host.requestUpdate(PIPELINE);
    this.#commit();
    this.host.announce(`Pasted ${matrix.length} × ${matrix[0]?.length ?? 0} cells`);
  }

  /**
   * Reads the clipboard and pastes it via {@link pasteText}. Resolves `false`
   * if the clipboard API is unavailable/blocked.
   */
  public async pasteFromClipboard(): Promise<boolean> {
    try {
      const text = await navigator.clipboard.readText();
      if (text) this.pasteText(text);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fills from the active range toward `to` (row + column key) — the
   * programmatic equivalent of dragging the fill handle. Extends along the
   * dominant axis only; numeric source lines extrapolate a linear series,
   * everything else tiles (repeats) the source pattern.
   */
  public fillTo(to: { row: number; column: string }): void {
    if (!this.enabled) return;
    const source = this.#activeBounds();
    if (!source) return;
    const targetCol = this.#visibleColumns().findIndex((c) => String(c.key) === to.column);
    if (targetCol < 0) return;
    const preview = this.#computeFillPreview(source, { row: to.row, col: targetCol });
    if (sameBounds(preview, source)) return;
    this.#applyFill(source, preview);
    this.#anchor = { row: preview.top, col: preview.left };
    this.#focus = { row: preview.bottom, col: preview.right };
    this.host.requestUpdate(PIPELINE);
    this.#commit();
  }

  // --- internals -----------------------------------------------------------

  #activeBounds(): RangeBounds | null {
    if (!this.#anchor || !this.#focus) return null;
    return {
      top: Math.min(this.#anchor.row, this.#focus.row),
      bottom: Math.max(this.#anchor.row, this.#focus.row),
      left: Math.min(this.#anchor.col, this.#focus.col),
      right: Math.max(this.#anchor.col, this.#focus.col),
    };
  }

  /** Visible columns in display (pinned/reorder) order. */
  #visibleColumns(): ColumnConfiguration<T>[] {
    return getDisplayColumns(this.host.columns).filter((column) => !column.hidden);
  }

  #colIndex(column: ColumnConfiguration<T>): number {
    return this.#visibleColumns().findIndex((candidate) => candidate.key === column.key);
  }

  /** The 2-D value matrix for a bounds (clipped to existing rows/columns). */
  #matrix(bounds: RangeBounds): unknown[][] {
    const columns = this.#visibleColumns().slice(bounds.left, bounds.right + 1);
    const items = this.host.pageItems as ReadonlyArray<Record<string, unknown>>;
    const rows: unknown[][] = [];
    for (let row = bounds.top; row <= bounds.bottom; row += 1) {
      const record = items[row];
      if (!record) continue;
      rows.push(columns.map((column) => record[String(column.key)]));
    }
    return rows;
  }

  /** Flat list of values over every distinct selected cell. */
  #unionValues(): unknown[] {
    const columns = this.#visibleColumns();
    const items = this.host.pageItems as ReadonlyArray<Record<string, unknown>>;
    const seen = new Set<string>();
    const out: unknown[] = [];
    for (const bounds of this.getRanges()) {
      for (let row = bounds.top; row <= bounds.bottom; row += 1) {
        const record = items[row];
        if (!record) continue;
        for (let col = bounds.left; col <= bounds.right; col += 1) {
          const key = `${row}:${col}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const column = columns[col];
          if (column) out.push(record[String(column.key)]);
        }
      }
    }
    return out;
  }

  #coerce(value: string, column: ColumnConfiguration<T>): unknown {
    if (column.type === 'number') {
      const n = Number(value);
      return value.trim() !== '' && Number.isFinite(n) ? n : value;
    }
    if (column.type === 'boolean') {
      if (value === 'true') return true;
      if (value === 'false') return false;
    }
    return value;
  }

  /** The fill region that extending `source` toward `target` would produce. */
  #computeFillPreview(source: RangeBounds, target: CellRef): RangeBounds {
    const vertical = Math.max(0, source.top - target.row, target.row - source.bottom);
    const horizontal = Math.max(0, source.left - target.col, target.col - source.right);
    if (vertical === 0 && horizontal === 0) return source;
    if (vertical >= horizontal) {
      return {
        top: Math.min(source.top, target.row),
        bottom: Math.max(source.bottom, target.row),
        left: source.left,
        right: source.right,
      };
    }
    return {
      top: source.top,
      bottom: source.bottom,
      left: Math.min(source.left, target.col),
      right: Math.max(source.right, target.col),
    };
  }

  /** Continuation value for `position` (relative to the source start) of a line. */
  #seriesValue(sourceLine: unknown[], position: number): unknown {
    const m = sourceLine.length;
    if (m === 0) return '';
    const numbers = sourceLine.map(toNumber);
    if (numbers.every((n) => n !== null)) {
      const first = numbers[0] as number;
      const step = m >= 2 ? ((numbers[m - 1] as number) - first) / (m - 1) : 0;
      return first + step * position;
    }
    return sourceLine[((position % m) + m) % m];
  }

  /** Write the extrapolated/tiled values into the extension cells of `preview`. */
  #applyFill(source: RangeBounds, preview: RangeBounds): void {
    const columns = this.#visibleColumns();
    const items = this.host.pageItems as Record<string, unknown>[];
    const vertical = preview.top < source.top || preview.bottom > source.bottom;

    // Coalesce the whole fill into one undo step.
    this.state.history.beginBatch();
    try {
      if (vertical) {
        for (let col = source.left; col <= source.right; col += 1) {
          const column = columns[col];
          if (!column) continue;
          const key = String(column.key);
          const line: unknown[] = [];
          for (let row = source.top; row <= source.bottom; row += 1) line.push(items[row]?.[key]);
          for (let row = preview.top; row <= preview.bottom; row += 1) {
            if (row >= source.top && row <= source.bottom) continue;
            const record = items[row];
            if (record) {
              this.state.editing.applyCellEdit(
                row,
                column.key,
                record as T,
                this.#seriesValue(line, row - source.top)
              );
            }
          }
        }
      } else {
        for (let row = source.top; row <= source.bottom; row += 1) {
          const record = items[row];
          if (!record) continue;
          const line: unknown[] = [];
          for (let col = source.left; col <= source.right; col += 1) {
            line.push(columns[col] ? record[String(columns[col].key)] : undefined);
          }
          for (let col = preview.left; col <= preview.right; col += 1) {
            if (col >= source.left && col <= source.right) continue;
            const column = columns[col];
            if (column) {
              this.state.editing.applyCellEdit(
                row,
                column.key,
                record as T,
                this.#seriesValue(line, col - source.left)
              );
            }
          }
        }
      }
    } finally {
      this.state.history.endBatch();
    }
  }

  /** Apply the in-progress fill-drag and promote the preview to the selection. */
  #commitFill(): void {
    if (this.#fillSource && this.#fillPreview && !sameBounds(this.#fillSource, this.#fillPreview)) {
      const preview = this.#fillPreview;
      this.#applyFill(this.#fillSource, preview);
      this.#anchor = { row: preview.top, col: preview.left };
      this.#focus = { row: preview.bottom, col: preview.right };
      this.host.requestUpdate(PIPELINE);
    }
    this.#fillSource = null;
    this.#fillPreview = null;
  }

  /** Whether a `down` interaction landed on the fill handle's hit area. */
  #isHandleGrab(interaction: CellInteraction<T>, ref: CellRef): boolean {
    if (this.#mode !== 'idle') return false;
    const primary = this.#activeBounds();
    if (!primary || ref.row !== primary.bottom || ref.col !== primary.right) return false;
    const cell = interaction.originalEvent
      .composedPath()
      .find((el) => el instanceof HTMLElement && el.localName === 'apex-grid-cell') as
      | HTMLElement
      | undefined;
    if (!cell) return false;
    const rect = cell.getBoundingClientRect();
    return (
      interaction.originalEvent.clientX >= rect.right - FILL_HANDLE_HIT &&
      interaction.originalEvent.clientY >= rect.bottom - FILL_HANDLE_HIT
    );
  }

  /** Re-decorate cells and notify listeners (status bar / app) of the change. */
  #commit(): void {
    this.state.bumpDecoration();
    const bounds = this.#activeBounds();
    const detail: RangeChangedDetail = {
      bounds,
      ranges: this.getRanges(),
      stats: this.hasSelection() ? this.getSelectionStats() : EMPTY_STATS,
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
