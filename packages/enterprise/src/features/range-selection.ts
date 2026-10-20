import { isRTL } from 'apex-commons';
import {
  type CellDecoration,
  type CellDecorator,
  type CellDecoratorContext,
  type CellInteraction,
  type CellInteractionHandler,
  type ColumnConfiguration,
  clampRating,
  commitDateInSameShape,
  type ExportCellValue,
  escapeCSVCell,
  type GridFeatureModule,
  type GridHost,
  getDisplayColumns,
  getRatingMax,
  getSelectOptions,
  PIPELINE,
  parseDate,
  type StateController,
} from 'apex-grid/internal';
import type { ReactiveController } from 'lit';
import { toFiniteNumber as toNumber } from './aggregation.js';
import { offsetReferences, parseFormula, stringifyFormula } from './formula/parser.js';
import { FORMULA_MODULE_ID, type FormulaController, FormulaStore } from './formula/store.js';

export const RANGE_SELECTION_MODULE_ID = 'range-selection';

/** Custom event fired on the grid host whenever the selected range changes. */
export const RANGE_CHANGED_EVENT = 'apex-range-changed';

/**
 * How close (px) to a cell's bottom-right corner counts as grabbing the fill
 * handle. Larger than the 7px dot it draws, so the grab is forgiving.
 *
 * Deliberately below the 24x24 WCAG 2.2 AA target size (2.5.8), which it cannot
 * meet: a 24px corner band would swallow a quarter of every cell's click area
 * and make ordinary cell selection unpredictable. The criterion's exceptions
 * cover this — fill is reachable through controls that do meet 24x24 (copy and
 * paste, and Shift+Arrow range extension plus paste), and the handle's position
 * at the range's corner is essential to what it means.
 */
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

/**
 * One clipboard field: a quoted one (closed right before a tab, a line break or
 * the end, a doubled quote inside being a literal one) or else plain text up to
 * the next tab or line break.
 */
const TSV_FIELD = /"((?:[^"]|"")*)"(?=[\t\n]|$)|[^\t\n]*/y;

/**
 * Splits clipboard text (line breaks already `\n`) into rows of fields: a tab
 * between fields, a line break between rows, and a quoted field kept whole, so
 * a cell holding a tab or a line break survives the trip. A quote that does
 * not open a field, or one never closed, is text.
 */
function parseTSV(text: string): string[][] {
  const lines: string[][] = [[]];
  for (let i = 0; ; ) {
    TSV_FIELD.lastIndex = i;
    const [field, quoted] = TSV_FIELD.exec(text) as RegExpExecArray;
    lines[lines.length - 1].push(quoted === undefined ? field : quoted.replace(/""/g, '"'));
    i = TSV_FIELD.lastIndex;
    if (i >= text.length) return lines;
    if (text[i++] === '\n') lines.push([]);
  }
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

  /**
   * Last copied selection, remembered so an immediate in-grid paste of the same
   * clipboard text can re-offset source formulas (a plain-TSV clipboard cannot
   * carry them). `tsv` gates the match; `rows` and `keys` are the source row
   * objects and column keys (robust to a later sort/filter); `data` is the data
   * array they came from, so replacing it releases them. `null` when nothing
   * was copied here, no source cell held a formula, or the copy spanned
   * multiple ranges.
   */
  #copied: { tsv: string; rows: T[]; keys: string[]; data: unknown } | null = null;

  /** A Ctrl/Cmd+C or V whose native clipboard event has not arrived yet. */
  #clipboardKey: 'copy' | 'paste' | null = null;

  /**
   * Edge auto-scroll state (active only during a select/fill drag). `#dragPointer`
   * is the live pointer position in client coordinates, tracked via a window
   * `pointermove` listener because the core only forwards `over` interactions
   * while the pointer is over a cell, not when it is in the dead zone past the
   * last rendered row. `#autoScrollFrame` is the pending rAF handle (0 = idle).
   */
  #dragPointer: { x: number; y: number } | null = null;
  #autoScrollFrame = 0;

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
    // Range extension listens in the *capture* phase, unlike everything else
    // here. The grid's own navigation is bound on `<apex-virtualizer>` inside
    // the shadow root, so a bubbling listener would only see Shift+Arrow after
    // the active cell had already moved; capturing on the host runs first,
    // which is what lets an extension key be claimed outright.
    el.addEventListener('keydown', this.#onExtendKeydown, true);
    // Catch pointer release outside the grid body so a drag always ends.
    globalThis.addEventListener?.('pointerup', this.#onWindowPointerUp);
    // With no text selection the browser aims copy and paste at the document,
    // not at the focused grid, so they are heard there.
    globalThis.document?.addEventListener('copy', this.#onClipboard);
    globalThis.document?.addEventListener('paste', this.#onClipboard);
  }

  /** Releases the last copy's source rows once the data they came from is replaced. */
  public hostUpdated(): void {
    if (this.#copied && this.#copied.data !== this.host.data) this.#copied = null;
  }

  public hostDisconnected(): void {
    const el = this.host as unknown as HTMLElement;
    el.removeEventListener('keydown', this.#onKeydown);
    el.removeEventListener('keydown', this.#onExtendKeydown, true);
    globalThis.removeEventListener?.('pointerup', this.#onWindowPointerUp);
    globalThis.document?.removeEventListener('copy', this.#onClipboard);
    globalThis.document?.removeEventListener('paste', this.#onClipboard);
    this.#endDrag();
  }

  #onWindowPointerUp = (): void => {
    if (this.#mode === 'fill') this.#commitFill();
    this.#mode = 'idle';
    this.#endDrag();
  };

  /**
   * Keyboard range extension: Shift+Arrows grow or shrink the selection one
   * cell at a time, Shift+Home/End reach the row's edges, and adding
   * Ctrl/Cmd reaches the grid's corners — the spreadsheet key model, and what
   * the ARIA grid pattern reserves Shift+Arrow for.
   *
   * The anchor stays put and only the focus corner moves, so the grid's active
   * cell deliberately does not follow (matching the Shift-click path). With no
   * selection yet, the active cell seeds one, so Shift+Arrow from a freshly
   * focused cell starts a range rather than doing nothing.
   *
   * Runs in the capture phase and claims the event, otherwise the grid's own
   * arrow navigation would move the active cell out from under the range.
   */
  #onExtendKeydown = (event: KeyboardEvent): void => {
    if (!this.enabled || event.altKey) return;
    if (!event.shiftKey) return;

    const columns = this.#visibleColumns();
    const lastRow = (this.host.pageItems as unknown[]).length - 1;
    const lastCol = columns.length - 1;
    if (lastRow < 0 || lastCol < 0) return;

    // Only keys pressed on the body itself (the scroll container or a
    // non-editing cell) extend; anything from inside an editor or an embedded
    // control keeps its own meaning.
    const origin = event.composedPath()[0] as HTMLElement | undefined;
    if (!this.#isBodyOrigin(origin)) return;

    const accel = event.ctrlKey || event.metaKey;
    const from = this.#focus ?? this.#seedFromActive(columns);
    if (!from) return;

    let next: CellRef | null = null;
    switch (event.key) {
      case 'ArrowUp':
        next = { row: Math.max(0, from.row - 1), col: from.col };
        break;
      case 'ArrowDown':
        next = { row: Math.min(lastRow, from.row + 1), col: from.col };
        break;
      case 'ArrowLeft':
        next = { row: from.row, col: Math.max(0, from.col - 1) };
        break;
      case 'ArrowRight':
        next = { row: from.row, col: Math.min(lastCol, from.col + 1) };
        break;
      case 'Home':
        next = accel ? { row: 0, col: 0 } : { row: from.row, col: 0 };
        break;
      case 'End':
        next = accel ? { row: lastRow, col: lastCol } : { row: from.row, col: lastCol };
        break;
      default:
        return;
    }

    // Claim the key even when the focus corner is already against the edge, so
    // holding Shift+ArrowUp at row 0 doesn't start scrolling the active cell.
    event.preventDefault();
    event.stopPropagation();

    if (!this.#anchor) this.#anchor = from;
    if (this.#focus && this.#focus.row === next.row && this.#focus.col === next.col) return;
    this.#focus = next;
    this.#mode = 'idle';
    this.#commit();
  };

  /** Whether a keydown came from the grid body rather than an editor or control. */
  #isBodyOrigin(origin: HTMLElement | undefined): boolean {
    if (!origin) return false;
    const tag = origin.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return false;
    if (origin.isContentEditable) return false;
    // A cell mid-edit hosts the editor; its keys belong to the editor.
    return !origin.hasAttribute?.('editing');
  }

  /**
   * Seeds anchor and focus at the grid's active cell so a first Shift+Arrow
   * starts a range. Returns `null` when nothing is focused or the active
   * column is not currently visible.
   */
  #seedFromActive(columns: ColumnConfiguration<T>[]): CellRef | null {
    const active = this.state.active;
    if (!active) return null;
    const col = columns.findIndex((column) => String(column.key) === String(active.column));
    if (col < 0) return null;
    const ref: CellRef = { row: active.row, col };
    this.#additional = [];
    this.#anchor = ref;
    this.#focus = ref;
    return ref;
  }

  #onKeydown = (event: KeyboardEvent): void => {
    if (!this.enabled || !this.hasSelection()) return;
    if (event.key === 'Escape') {
      this.clearSelection();
      return;
    }
    const key = event.key.toLowerCase();
    if (!(event.ctrlKey || event.metaKey) || (key !== 'c' && key !== 'v')) return;
    if (!this.#isBodyOrigin(event.composedPath()[0] as HTMLElement | undefined)) return;
    // The key is left to the browser: its copy or paste event carries the
    // clipboard with no secure origin or permission needed (#onClipboard).
    // Where none follows (some browsers send none without a text selection),
    // the async Clipboard API takes over on the next task.
    const kind = key === 'c' ? 'copy' : 'paste';
    this.#clipboardKey = kind;
    setTimeout(() => {
      if (this.#clipboardKey !== kind) return;
      this.#clipboardKey = null;
      void (kind === 'copy' ? this.copySelection() : this.pasteFromClipboard());
    });
  };

  /**
   * Native copy and paste while the grid holds focus (or the event comes from
   * inside it) and a range is selected: copy writes the selection's TSV into
   * the event, paste writes the event's text into the grid. An editor or
   * control inside the grid keeps its own clipboard behaviour.
   */
  #onClipboard = (event: ClipboardEvent): void => {
    const data = event.clipboardData;
    const host = this.host as unknown as HTMLElement;
    const path = event.composedPath();
    if (!this.enabled || !this.hasSelection() || !data) return;
    if (!path.includes(host) && !host.matches(':focus-within')) return;
    if (!this.#isBodyOrigin(path[0] as HTMLElement | undefined)) return;
    this.#clipboardKey = null;
    if (event.type === 'paste') {
      event.preventDefault();
      this.pasteText(data.getData('text/plain'));
      return;
    }
    const tsv = this.getSelectionTSV();
    if (!tsv) return;
    event.preventDefault();
    data.setData('text/plain', tsv);
    this.#copiedHere(tsv);
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
          this.#beginDrag();
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
        this.#beginDrag();
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
        this.#endDrag();
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
        // The one non-`data-*` attribute this decorator sets, deliberately: the
        // range was visible only as styling, so assistive tech had no way to
        // know a cell was in it. `gridcell` supports `aria-selected` and the
        // cell reflects no attribute by that name, so there is no collision.
        // Absent means "not selected" for a gridcell, so unselected cells stay
        // clean rather than carrying `aria-selected="false"` on every cell.
        'aria-selected': 'true',
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

  /**
   * Restores selected rectangles from their {@link RangeBounds} (state restore).
   * Bounds are view-coordinate (row indices into `pageItems`, column indices into
   * the visible columns), so this round-trips within a session. The last range
   * becomes the active one; earlier ranges restore as additional (Ctrl-click)
   * selections. An empty list clears the selection.
   */
  public restoreRanges(ranges: ReadonlyArray<RangeBounds>): void {
    if (!ranges.length) {
      this.clearSelection();
      return;
    }
    const active = ranges[ranges.length - 1];
    this.#additional = ranges.slice(0, -1);
    this.#anchor = { row: active.top, col: active.left };
    this.#focus = { row: active.bottom, col: active.right };
    this.#fillSource = null;
    this.#fillPreview = null;
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

  /**
   * The labeled grid (in-range columns + per-row values) for **arbitrary** bounds, like
   * {@link getActiveGrid} but for a caller-supplied rectangle. Used by the in-grid chart-range
   * handle to recompute a linked chart from a resized source range.
   */
  public gridForBounds(bounds: RangeBounds): {
    columns: ColumnConfiguration<T>[];
    rows: unknown[][];
  } {
    return {
      columns: this.#visibleColumns().slice(bounds.left, bounds.right + 1),
      rows: this.#matrix(bounds),
    };
  }

  /**
   * The union client rect of a range's **currently rendered** cells, or `null` when none is rendered
   * (the range is fully scrolled out of the virtualized body). Used to position the chart-range
   * overlay. Traverses each rendered `apex-grid-row`'s shadow root for its `apex-grid-cell`s and
   * matches them against the in-range visible columns by key.
   */
  public boundsClientRect(bounds: RangeBounds): DOMRectReadOnly | null {
    const inRangeKeys = new Set(
      this.#visibleColumns()
        .slice(bounds.left, bounds.right + 1)
        .map((column) => String(column.key))
    );
    let top = Number.POSITIVE_INFINITY;
    let left = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let found = false;
    for (const { index, el } of this.#bodyRows()) {
      if (index < bounds.top || index > bounds.bottom) continue;
      const cells = el.shadowRoot?.querySelectorAll('apex-grid-cell');
      if (!cells) continue;
      for (const cell of cells) {
        const key = (cell as unknown as { column?: { key?: unknown } }).column?.key;
        if (key === undefined || !inRangeKeys.has(String(key))) continue;
        const rect = cell.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        top = Math.min(top, rect.top);
        left = Math.min(left, rect.left);
        bottom = Math.max(bottom, rect.bottom);
        right = Math.max(right, rect.right);
        found = true;
      }
    }
    if (!found) return null;
    return new DOMRectReadOnly(left, top, right - left, bottom - top);
  }

  /**
   * Hit-test a client point to the nearest rendered cell, returned in **view coordinates** (row =
   * `pageItems` index, col = index into the visible columns). Clamps to the nearest row/col when the
   * pointer is past the rendered edge, so a handle drag past the last row still extends. `null` only
   * when no rows are rendered. Used by the chart-range handle drag.
   */
  public cellAtPoint(clientX: number, clientY: number): { row: number; col: number } | null {
    const rows = this.#bodyRows();
    if (!rows.length) return null;
    // Nearest row by vertical distance to the row box.
    let row = rows[0];
    let rowDist = Number.POSITIVE_INFINITY;
    let sampleEl: HTMLElement | null = null;
    for (const candidate of rows) {
      const rect = candidate.el.getBoundingClientRect();
      const dist =
        clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      if (dist < rowDist) {
        rowDist = dist;
        row = candidate;
      }
      if (dist === 0) sampleEl = candidate.el;
    }
    sampleEl = sampleEl ?? row.el;
    // Nearest visible column by horizontal distance to its rendered cell.
    const visible = this.#visibleColumns();
    const keyToIndex = new Map(visible.map((column, i) => [String(column.key), i]));
    let col = 0;
    let colDist = Number.POSITIVE_INFINITY;
    const cells = sampleEl.shadowRoot?.querySelectorAll('apex-grid-cell');
    for (const cell of cells ?? []) {
      const key = (cell as unknown as { column?: { key?: unknown } }).column?.key;
      if (key === undefined) continue;
      const index = keyToIndex.get(String(key));
      if (index === undefined) continue;
      const rect = cell.getBoundingClientRect();
      const dist =
        clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
      if (dist < colDist) {
        colDist = dist;
        col = index;
      }
    }
    return { row: row.index, col };
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
    this.#endDrag();
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
   * The selection serialized as TSV (spreadsheet-pasteable). A single range is
   * one matrix; multiple Ctrl-click ranges are emitted as blocks separated by a
   * blank line. A value holding a tab, a line break or a double quote is
   * quoted, as spreadsheets do, so it pastes back as one cell.
   */
  public getSelectionTSV(): string {
    return this.getRanges()
      .map((bounds) =>
        this.#matrix(bounds)
          .map((line) =>
            line.map((value) => escapeCSVCell(value as ExportCellValue, '\t')).join('\t')
          )
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
      this.#copiedHere(tsv);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * After a copy: announce it, and remember the copied single range so an
   * immediate in-grid paste of the same text can re-offset its formulas.
   * Source row objects + column keys are captured (not view indices), so a
   * later sort/filter does not misalign them. Nothing is kept when no source
   * cell holds a formula; a multi-range copy disables formula-aware paste.
   */
  #copiedHere(tsv: string): void {
    this.host.announce(this.host.localize('rangeSelection.copied'));
    const bounds = this.#additional.length === 0 ? this.#activeBounds() : null;
    const formulas = this.#formulaController();
    this.#copied = null;
    if (!bounds || !formulas) return;
    const keys = this.#visibleColumns()
      .slice(bounds.left, bounds.right + 1)
      .map((column) => String(column.key) as keyof T & string);
    const rows = this.#dataRows(bounds.top, bounds.bottom).map(({ record }) => record);
    if (rows.some((row) => keys.some((key) => formulas.getFormula(row, key) !== undefined))) {
      this.#copied = { tsv, rows, keys, data: this.host.data };
    }
  }

  /**
   * Writes a block of TSV (rows split on `\n`, columns on `\t`, quoted fields
   * kept whole) into the grid starting at the active range's top-left cell,
   * then expands the selection to cover the written block. Lines land on data
   * rows only, skipping group headers and totals; values are coerced to the
   * target column's type. Columns the editing rules do not let the user edit
   * are skipped, and cells beyond the data/columns are clipped. No-op without
   * an active range.
   */
  public pasteText(text: string): void {
    if (!this.enabled || !text) return;
    const start = this.#activeBounds();
    if (!start) return;

    const matrix = parseTSV(text.replace(/\r\n?/g, '\n'));
    // Drop a trailing empty line (common with copied blocks).
    const tail = matrix[matrix.length - 1];
    if (matrix.length > 1 && tail.length === 1 && tail[0] === '') matrix.pop();

    const columns = this.#visibleColumns();
    const targets = this.#dataRows(start.top, Number.POSITIVE_INFINITY, matrix.length);
    let wrote = false;
    let lastRow = start.top;
    let lastCol = start.left;

    // When the clipboard still holds exactly what we copied here, re-offset the
    // source cells' formulas instead of pasting their computed values. All of
    // them are read before anything is written, so a paste that overlaps its
    // own source reads the source as it was.
    const formulas = this.#formulaController();
    const copied = formulas && this.#copied?.tsv === text ? this.#copied : null;
    const shifted =
      copied &&
      targets.map(({ record }, i) =>
        matrix[i].map((_, j) => {
          const column = columns[start.left + j];
          return column && this.#shiftFormula(copied.rows[i], copied.keys[j], record, column);
        })
      );

    // Coalesce the whole paste into one undo step.
    this.state.history.beginBatch();
    try {
      targets.forEach(({ row, record }, i) => {
        for (let j = 0; j < matrix[i].length; j += 1) {
          const colIndex = start.left + j;
          const column = columns[colIndex];
          if (!column) continue;
          // The pasted region drives the selection whether or not a given
          // cell's value actually changed.
          lastRow = Math.max(lastRow, row);
          lastCol = Math.max(lastCol, colIndex);
          const current = (record as Record<string, unknown>)[String(column.key)];
          const value = this.#coerce(matrix[i][j], column, current);
          wrote = this.#write(row, column, record, value, shifted?.[i][j]) || wrote;
        }
      });
    } finally {
      this.state.history.endBatch();
    }
    if (!wrote) return;

    this.#additional = [];
    this.#anchor = { row: start.top, col: start.left };
    this.#focus = { row: lastRow, col: lastCol };
    this.host.requestUpdate(PIPELINE);
    this.#commit();
    this.host.announce(
      this.host.localize('rangeSelection.pasted', {
        rows: matrix.length,
        cols: matrix[0]?.length ?? 0,
      })
    );
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

  /** The formula controller, when the formula module is registered on this grid. */
  #formulaController(): FormulaController<T> | undefined {
    return this.state.module<FormulaController<T>>(FORMULA_MODULE_ID);
  }

  /**
   * The 2-D value matrix for a bounds (clipped to existing rows/columns), over
   * its data rows: group headers and totals are left out.
   */
  #matrix(bounds: RangeBounds): unknown[][] {
    const columns = this.#visibleColumns().slice(bounds.left, bounds.right + 1);
    return this.#dataRows(bounds.top, bounds.bottom).map(({ record }) =>
      columns.map((column) => (record as Record<string, unknown>)[String(column.key)])
    );
  }

  /**
   * The data rows among view rows `top..bottom`, at most `limit` of them:
   * rows a feature synthesized (group headers, totals) are skipped, so paste
   * and fill never write to them nor count them as a step.
   */
  #dataRows(top: number, bottom: number, limit = Number.POSITIVE_INFINITY) {
    const items = this.host.pageItems as T[];
    const out: { row: number; record: T }[] = [];
    const last = Math.min(bottom, items.length - 1);
    for (let row = Math.max(0, top); row <= last && out.length < limit; row += 1) {
      const record = items[row];
      if (record && this.state.isDataRow(record)) out.push({ row, record });
    }
    return out;
  }

  /**
   * Writes one paste or fill cell through the edit path, so the editing rule,
   * validators, the cancellable `cellValueChanging` and undo history treat it
   * as a typed edit. A `formula` is evaluated first and its value takes that
   * same path; the formula is stored only once the value is accepted. Returns
   * `false` when the column is not editable.
   */
  #write(
    row: number,
    column: ColumnConfiguration<T>,
    record: T,
    value: unknown,
    formula: string | undefined
  ): boolean {
    const editing = this.state.editing;
    if (!editing.isEditable(column)) return false;
    const formulas = formula === undefined ? undefined : this.#formulaController();
    const key = String(column.key) as keyof T & string;
    const address = formulas?.addressFor(record, key);
    if (!formulas || !address || formula === undefined) {
      editing.applyCellEdit(row, column.key, record, value);
      return true;
    }
    // A store holding just this formula, whose write lands here instead of in
    // the row, gives the value the engine would compute (cycles included).
    let computed: unknown = null;
    new FormulaStore({
      readValue: (cell) => formulas.readValue(cell),
      isValidAddress: (cell) => formulas.isValidAddress(cell),
      writeValue: (_, result) => {
        computed = result;
      },
      functions: formulas.functions,
    }).set(address, formula);
    const result = editing.applyCellEdit(row, column.key, record, computed);
    // History records values only: an 'unchanged' value makes no entry, so
    // the formula attached here is not undoable until a formula-aware
    // history command exists.
    if (result === 'applied' || result === 'unchanged') formulas.setFormula(record, key, formula);
    return true;
  }

  /**
   * The formula on a source cell shifted to a target cell (relative references
   * move by the data-row and column distance, `$` axes stay), or `undefined`
   * when the source holds none or the target column takes no formulas, so the
   * caller writes the literal value instead.
   */
  #shiftFormula(
    sourceRow: T | undefined,
    sourceKey: string | undefined,
    targetRow: T,
    column: ColumnConfiguration<T>
  ): string | undefined {
    const formulas = this.#formulaController();
    if (!formulas || !column.allowFormula || !sourceRow || sourceKey === undefined) return;
    const key = sourceKey as keyof T & string;
    const src = formulas.getFormula(sourceRow, key);
    const from = src === undefined ? null : formulas.addressFor(sourceRow, key);
    const to = from && formulas.addressFor(targetRow, String(column.key) as keyof T & string);
    if (!src || !from || !to) return;
    return stringifyFormula(
      offsetReferences(parseFormula(src), to.row - from.row, to.col - from.col)
    );
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

  /**
   * Pasted text as a value of the column's type, the way the cell editor
   * would commit it: numeric types take a finite number (a rating clamped to
   * its stars), booleans `TRUE` or `FALSE` in any case, a select the option
   * whose value matches (else the one whose label does), and dates parse
   * with the grid's date parser into the shape the cell already stores.
   * Blank text clears a numeric, boolean or date cell to `null`; text that
   * does not parse is kept as typed, for validators to judge.
   */
  #coerce(text: string, column: ColumnConfiguration<T>, current: unknown): unknown {
    const type = column.type ?? 'string';
    const trimmed = text.trim();
    if (type === 'select') {
      // Copy writes the raw value, so a value match wins over a label that
      // happens to spell another option's value.
      const options = getSelectOptions(column as { options?: unknown[] });
      const option =
        options.find((o) => String(o.value) === trimmed) ??
        options.find((o) => o.label === trimmed);
      return option ? option.value : text;
    }
    const numeric = this.state.isNumericColumn(column);
    if (!numeric && type !== 'boolean' && type !== 'date') return text;
    if (trimmed === '') return null;
    if (numeric) {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) return text;
      return type === 'rating' ? clampRating(n, getRatingMax(column as { max?: number })) : n;
    }
    if (type === 'boolean') {
      const lower = trimmed.toLowerCase();
      return lower === 'true' ? true : lower === 'false' ? false : text;
    }
    const date = parseDate(trimmed);
    return date ? commitDateInSameShape(current, date) : text;
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

  /**
   * Continuation value for `position` (relative to the source start) of a
   * line: a linear series when two or more source values are numbers and the
   * target column is numeric, or is a plain (untyped, so `'string'`) column
   * whose source values are real numbers; numeric-looking text such as a zip
   * code is never counted on. Otherwise the source values tile unchanged.
   */
  #seriesValue(sourceLine: unknown[], position: number, column: ColumnConfiguration<T>): unknown {
    const m = sourceLine.length;
    const numbers = sourceLine.map(toNumber);
    const type = column.type ?? 'string';
    const numeric =
      this.state.isNumericColumn(column) ||
      (type === 'string' && sourceLine.every((v) => typeof v === 'number'));
    if (m >= 2 && numeric && numbers.every((n) => n !== null)) {
      const first = numbers[0] as number;
      return first + (((numbers[m - 1] as number) - first) / (m - 1)) * position;
    }
    return sourceLine[((position % m) + m) % m];
  }

  /**
   * Write the extrapolated/tiled values into the extension cells of `preview`.
   * A source cell that holds a formula is filled as an offset formula (relative
   * references shift by the data-row/column delta); everything else extrapolates
   * or tiles its literal value. Group headers and totals are neither read nor
   * written, and do not count as a step of a series.
   */
  #applyFill(source: RangeBounds, preview: RangeBounds): void {
    const columns = this.#visibleColumns();
    const vertical = preview.top < source.top || preview.bottom > source.bottom;
    const sources = this.#dataRows(source.top, source.bottom);

    // Coalesce the whole fill into one undo step.
    this.state.history.beginBatch();
    try {
      if (vertical) {
        const height = sources.length;
        // Extension rows with their offset from the first source row: below
        // the source counting on from it, above it counting back.
        const targets = [
          ...this.#dataRows(source.bottom + 1, preview.bottom).map((target, k) => ({
            ...target,
            offset: height + k,
          })),
          ...this.#dataRows(preview.top, source.top - 1)
            .reverse()
            .map((target, k) => ({ ...target, offset: -(k + 1) })),
        ];
        for (let col = source.left; col <= source.right && height; col += 1) {
          const column = columns[col];
          if (!column) continue;
          const key = String(column.key);
          const line = sources.map(({ record }) => (record as Record<string, unknown>)[key]);
          for (const { row, record, offset } of targets) {
            // The tiled source cell (same column, wrapped within the source block).
            const from = sources[((offset % height) + height) % height].record;
            this.#write(
              row,
              column,
              record,
              this.#seriesValue(line, offset, column),
              this.#shiftFormula(from, key, record, column)
            );
          }
        }
      } else {
        const width = source.right - source.left + 1;
        for (const { row, record } of sources) {
          const line: unknown[] = [];
          for (let col = source.left; col <= source.right; col += 1) {
            line.push(
              columns[col]
                ? (record as Record<string, unknown>)[String(columns[col].key)]
                : undefined
            );
          }
          for (let col = preview.left; col <= preview.right; col += 1) {
            if (col >= source.left && col <= source.right) continue;
            const column = columns[col];
            if (!column) continue;
            const offset = col - source.left;
            // The tiled source cell (same row, wrapped within the source block).
            const from = columns[source.left + (((offset % width) + width) % width)];
            this.#write(
              row,
              column,
              record,
              this.#seriesValue(line, offset, column),
              from && this.#shiftFormula(record, String(from.key), record, column)
            );
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
    // The handle is drawn at the cell's `inset-inline-end` corner, so under
    // `dir="rtl"` it sits on the physical left and the grab band has to follow
    // it — otherwise the dot and the thing you can grab are on opposite sides.
    const withinInlineEnd = isRTL('auto', cell)
      ? interaction.originalEvent.clientX <= rect.left + FILL_HANDLE_HIT
      : interaction.originalEvent.clientX >= rect.right - FILL_HANDLE_HIT;
    return withinInlineEnd && interaction.originalEvent.clientY >= rect.bottom - FILL_HANDLE_HIT;
  }

  // --- edge auto-scroll ----------------------------------------------------

  /** How close (px) to the body's top/bottom edge starts an auto-scroll. */
  static readonly #EDGE_BAND = 28;
  /** Max scroll speed (px/frame) at the deepest point of the edge band. */
  static readonly #MAX_SPEED = 24;

  /** Begin tracking the pointer for edge auto-scroll (called at drag start). */
  #beginDrag(): void {
    this.#dragPointer = null;
    globalThis.addEventListener?.('pointermove', this.#onWindowPointerMove);
  }

  /** Stop tracking and cancel any pending auto-scroll (called at drag end). */
  #endDrag(): void {
    globalThis.removeEventListener?.('pointermove', this.#onWindowPointerMove);
    this.#dragPointer = null;
    if (this.#autoScrollFrame) {
      globalThis.cancelAnimationFrame?.(this.#autoScrollFrame);
      this.#autoScrollFrame = 0;
    }
  }

  #onWindowPointerMove = (event: PointerEvent): void => {
    if (this.#mode !== 'select' && this.#mode !== 'fill') return;
    this.#dragPointer = { x: event.clientX, y: event.clientY };
    this.#ensureAutoScroll();
  };

  /** Kick off the auto-scroll rAF loop if one isn't already running. */
  #ensureAutoScroll(): void {
    if (this.#autoScrollFrame || !globalThis.requestAnimationFrame) return;
    const step = (): void => {
      this.#autoScrollFrame = 0;
      if ((this.#mode !== 'select' && this.#mode !== 'fill') || !this.#dragPointer) return;
      // Keep looping only while the pointer stays in an edge band with room to scroll.
      if (this.#autoScrollStep()) {
        this.#autoScrollFrame = globalThis.requestAnimationFrame(step);
      }
    };
    this.#autoScrollFrame = globalThis.requestAnimationFrame(step);
  }

  /**
   * One auto-scroll frame: if the pointer is inside the top/bottom edge band,
   * scroll the body and extend the selection to the furthest visible row.
   * Returns `true` while it should keep scrolling (in-band with room left).
   */
  #autoScrollStep(): boolean {
    const pointer = this.#dragPointer;
    if (!pointer) return false;
    const viewport = this.#bodyViewport();
    const band = RangeSelectionController.#EDGE_BAND;

    let dir = 0;
    let intensity = 0;
    if (pointer.y > viewport.bottom - band) {
      dir = 1;
      intensity = Math.min(1, (pointer.y - (viewport.bottom - band)) / band);
    } else if (pointer.y < viewport.top + band) {
      dir = -1;
      intensity = Math.min(1, (viewport.top + band - pointer.y) / band);
    } else {
      return false;
    }

    const scroller = this.#scrollElement();
    const before = scroller.scrollTop;
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    const delta = dir * (4 + RangeSelectionController.#MAX_SPEED * intensity);
    scroller.scrollTop = Math.max(0, Math.min(maxScroll, before + delta));

    // Extend to the furthest visible row even when we've hit the scroll limit, so
    // the selection still reaches the last/first data row.
    this.#extendToEdgeRow(dir, viewport);
    return scroller.scrollTop !== before;
  }

  /** Extend the active selection (or fill preview) to the edge-most visible row. */
  #extendToEdgeRow(dir: number, viewport: { top: number; bottom: number }): void {
    let target: number | null = null;
    for (const row of this.#bodyRows()) {
      const rect = row.el.getBoundingClientRect();
      // Skip rows entirely outside the visible body band.
      if (rect.bottom <= viewport.top || rect.top >= viewport.bottom) continue;
      if (target === null || (dir > 0 ? row.index > target : row.index < target)) {
        target = row.index;
      }
    }
    if (target === null) return;

    if (this.#mode === 'fill' && this.#fillSource) {
      const col = this.#fillPreview?.right ?? this.#fillSource.right;
      const preview = this.#computeFillPreview(this.#fillSource, { row: target, col });
      if (!this.#fillPreview || !sameBounds(this.#fillPreview, preview)) {
        this.#fillPreview = preview;
        this.#commit();
      }
      return;
    }
    if (this.#focus && this.#focus.row === target) return;
    const col = this.#focus?.col ?? this.#anchor?.col ?? 0;
    this.#focus = { row: target, col };
    this.#commit();
  }

  /** Rendered body rows (excluding pinned) with their view index. */
  #bodyRows(): { index: number; el: HTMLElement }[] {
    const pinned = this.host.pinnedRows;
    const out: { index: number; el: HTMLElement }[] = [];
    for (const row of this.host.rows) {
      const node = row as unknown as { index: number; data: T } & HTMLElement;
      if (pinned.top.includes(node.data) || pinned.bottom.includes(node.data)) continue;
      out.push({ index: node.index, el: node });
    }
    return out;
  }

  /**
   * The body viewport in client coordinates: the grid host's box minus the sticky
   * chrome (header / filter / pinned rows / paginator) that overlays its edges.
   */
  #bodyViewport(): { top: number; bottom: number } {
    const host = this.host as unknown as HTMLElement;
    const rect = host.getBoundingClientRect();
    let top = rect.top;
    let bottom = rect.bottom;
    const root = host.shadowRoot;
    if (root) {
      for (const sel of ['apex-grid-header-row', 'apex-filter-row', '[part~=pinned-top]']) {
        const el = root.querySelector(sel);
        if (el) top = Math.max(top, el.getBoundingClientRect().bottom);
      }
      for (const sel of ['[part~=pinned-bottom]', 'apex-grid-paginator']) {
        const el = root.querySelector(sel);
        if (el) bottom = Math.min(bottom, el.getBoundingClientRect().top);
      }
    }
    return { top, bottom };
  }

  /** The element that actually scrolls the body (the host, per grid CSS). */
  #scrollElement(): HTMLElement {
    const host = this.host as unknown as HTMLElement;
    if (host.scrollHeight - host.clientHeight > 1) return host;
    const virtualizer = host.shadowRoot?.querySelector('apex-virtualizer') as HTMLElement | null;
    if (virtualizer && virtualizer.scrollHeight - virtualizer.clientHeight > 1) return virtualizer;
    return host;
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
