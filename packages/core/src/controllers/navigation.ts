import type { ReactiveController } from 'lit';
import type ApexGridRow from '../components/row.js';
import { revealWithin, type ScrollInsets } from '../components/virtualizer.js';
import { SENTINEL_NODE } from '../internal/constants.js';
import { GRID_ROW_TAG } from '../internal/tags.js';
import type { ActiveNode, ColumnConfiguration, GridHost, Keys } from '../internal/types.js';
import { getDisplayColumns, isRTL } from '../internal/utils.js';

/** Keys that move the active cell relative to where it is. */
const RELATIVE_KEYS = new Set([
  'ArrowDown',
  'ArrowUp',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

export class NavigationController<T extends object> implements ReactiveController {
  protected handlers = new Map(
    Object.entries({
      ArrowDown: this.arrowDown,
      ArrowUp: this.arrowUp,
      ArrowLeft: this.arrowLeft,
      ArrowRight: this.arrowRight,
      Home: this.home,
      End: this.end,
      PageUp: this.pageUp,
      PageDown: this.pageDown,
      ' ': this.toggleSelection,
    })
  );

  protected get virtualizer() {
    // @ts-expect-error - Protected member access
    return this.host.scrollContainer;
  }

  /**
   * The active cell of this grid. Instance state on purpose: every grid on a
   * page, including one nested in another grid's detail panel, keeps its own.
   */
  protected _active = SENTINEL_NODE as ActiveNode<T>;

  protected get nextNode() {
    return this._active === SENTINEL_NODE
      ? ({ column: this.firstColumn, row: 0 } as ActiveNode<T>)
      : ({ ...this._active } as ActiveNode<T>);
  }

  protected get columns(): Array<{ key: Keys<T>; hidden?: boolean }> {
    return getDisplayColumns(this.host.columns) as unknown as Array<{
      key: Keys<T>;
      hidden?: boolean;
    }>;
  }

  protected get visibleColumns() {
    return this.columns.filter((column) => !column.hidden);
  }

  protected get firstColumn(): Keys<T> {
    const first = this.visibleColumns.at(0);
    return (first?.key ?? (this.host.columns[0]?.key as Keys<T>)) as Keys<T>;
  }

  /** Whether there is any cell to move to: a body row and a visible column. */
  protected get navigable(): boolean {
    return this.host.pageItems.length > 0 && this.visibleColumns.length > 0;
  }

  protected getPreviousColumn(key: Keys<T>): Keys<T> {
    const columns = this.visibleColumns;
    const idx = columns.findIndex((column) => column.key === key);
    return columns[Math.max(idx - 1, 0)]?.key ?? key;
  }

  protected getNextColumn(key: Keys<T>): Keys<T> {
    const columns = this.visibleColumns;
    const idx = columns.findIndex((column) => column.key === key);
    return columns[Math.min(idx + 1, columns.length - 1)]?.key ?? key;
  }

  /** The rendered body row at `index`, when the virtualizer has it in the DOM. */
  protected findRow(index: number) {
    return Array.from(this.virtualizer.querySelectorAll(GRID_ROW_TAG)).find(
      (row) => (row as unknown as ApexGridRow<T>).index === index
    ) as unknown as ApexGridRow<T> | undefined;
  }

  /**
   * The element that stands for `node` in the DOM: the cell, or for a row a
   * feature module renders full width (a group header, a total row) the
   * row's single focus target, whatever the column.
   */
  protected findCell(node: ActiveNode<T>): HTMLElement | undefined {
    const row = this.findRow(node.row);
    if (!row) return undefined;
    return (
      row.presentedCell ??
      (row.cells.find((cell) => cell.column.key === node.column) as HTMLElement | undefined)
    );
  }

  protected scrollToCell(node: ActiveNode<T>) {
    const cell = this.findCell(node);
    if (cell) {
      revealWithin(this.host as unknown as HTMLElement, cell, {
        block: 'nearest',
        inline: 'nearest',
        insets: this.scrollInsets(),
      });
    }
  }

  /** Scrolls body row `index` into view, rendered or not. */
  protected scrollToRow(index: number) {
    this.virtualizer
      .element(index)
      ?.scrollIntoView({ block: 'nearest', insets: this.scrollInsets() });
  }

  /** The cell {@link revealCell} last asked for, so a late reveal yields to a newer one. */
  #revealing: ActiveNode<T> | null = null;

  /**
   * Scrolls the cell at `node` into view clear of the sticky chrome without
   * moving the active cell: the cell itself when it is rendered, else its row
   * first and the cell once the virtualizer has rendered it. For a feature
   * that moves something other than the active cell with the keyboard (range
   * extension), so it scrolls the way arrow navigation does.
   */
  public revealCell(node: ActiveNode<T>): void {
    this.#revealing = node;
    if (this.findCell(node)) {
      this.scrollToCell(node);
      return;
    }
    this.scrollToRow(node.row);
    void this.virtualizer.settled().then(() => {
      if (this.#revealing === node) this.scrollToCell(node);
    });
  }

  /**
   * Whether ArrowLeft or ArrowRight steps towards the end of the column
   * order: ArrowRight in a left-to-right grid, ArrowLeft in a right-to-left
   * one. The rule every inline arrow key on this grid follows.
   */
  public towardsInlineEnd(key: string): boolean {
    return isRTL(this.host as unknown as Element) === (key === 'ArrowLeft');
  }

  /**
   * How much of the scroll container's scrollport the sticky chrome covers
   * (toolbar, headers and the pinned-top band above, the pinned-bottom band
   * and the paginator below, pinned columns on either side). Keyboard scrolls
   * use it as scroll-padding, so a row or cell the keyboard moves to is never
   * parked underneath that chrome. Measured right before each keyboard scroll
   * because any of those bands can change size between key presses. Public
   * so a feature scrolling the body itself (drag auto-scroll) measures the
   * same chrome.
   */
  public scrollInsets(): ScrollInsets {
    const host = this.host as unknown as HTMLElement;
    const root = host.shadowRoot;
    if (!root) return { top: 0, right: 0, bottom: 0, left: 0 };
    const box = host.getBoundingClientRect();
    const top = box.top + host.clientTop;
    const left = box.left + host.clientLeft;
    const bottom = top + host.clientHeight;
    const right = left + host.clientWidth;

    let insetTop = 0;
    for (const el of root.querySelectorAll('apex-grid-header-row, [part~="pinned-top"]')) {
      insetTop = Math.max(insetTop, el.getBoundingClientRect().bottom - top);
    }
    let insetBottom = 0;
    for (const el of root.querySelectorAll('apex-grid-paginator, [part~="pinned-bottom"]')) {
      insetBottom = Math.max(insetBottom, bottom - el.getBoundingClientRect().top);
    }

    let insetLeft = 0;
    let insetRight = 0;
    const headerRow = root.querySelector('apex-grid-header-row');
    const pinned = headerRow?.shadowRoot?.querySelectorAll(
      '[data-pinned="start"], [data-pinned="end"]'
    );
    if (pinned?.length) {
      const rtl = isRTL(host);
      for (const el of pinned) {
        const rect = el.getBoundingClientRect();
        const atLeft = (el.getAttribute('data-pinned') === 'start') !== rtl;
        if (atLeft) insetLeft = Math.max(insetLeft, rect.right - left);
        else insetRight = Math.max(insetRight, right - rect.left);
      }
    }

    const clamp = (inset: number) => Math.max(0, Math.round(inset));
    return {
      top: clamp(insetTop),
      right: clamp(insetRight),
      bottom: clamp(insetBottom),
      left: clamp(insetLeft),
    };
  }

  /**
   * Moves real DOM focus to the active cell (the grid body's roving tab stop),
   * so screen readers track keyboard navigation. Waits for the host render to
   * commit the cell's `active` state and, when the cell is not in the DOM yet
   * (a long jump), for the virtualizer to finish laying out the new range.
   * No-op while no cell is active (the scroll container keeps focus as the
   * entry point).
   *
   * @param reveal - also scroll the cell into view once it exists, for jumps
   * whose target row was not rendered when the scroll started.
   */
  public focusActiveCell(reveal = false): void {
    const node = this._active;
    if (node === SENTINEL_NODE) return;
    void (async () => {
      await this.host.updateComplete;
      let cell = this.findCell(node);
      if (!cell) {
        await this.virtualizer.settled();
        cell = this.findCell(node);
      }
      if (!cell) {
        await new Promise(requestAnimationFrame);
        cell = this.findCell(node);
      }
      // The user moved on while this was waiting: leave focus to the newer move.
      if (!cell || this._active !== node) return;
      if (reveal) this.scrollToCell(node);
      cell.focus({ preventScroll: true });
    })();
  }

  public get active() {
    return this._active;
  }

  public set active(node: ActiveNode<T>) {
    this._active = node;
    this.host.requestUpdate();
  }

  constructor(protected host: GridHost<T>) {
    this.host.addController(this);
  }

  /**
   * Keeps the active cell pointing at something that exists. Runs before
   * every grid render, so after a data swap, sort, filter, page change or a
   * column hide or reorder the active node is clamped to the last row and the
   * nearest visible column, or cleared when there is nothing left to point
   * at (no rows, no visible columns). Without it a stale node names a cell
   * that is never rendered, which leaves the body with no tab stop.
   */
  public hostUpdate() {
    const node = this._active;
    if (node === SENTINEL_NODE) return;
    const count = this.host.pageItems.length;
    if (!count || !this.visibleColumns.length) {
      this._active = SENTINEL_NODE as ActiveNode<T>;
      return;
    }
    const row = Math.min(node.row, count - 1);
    const column = this.#nearestVisibleColumn(node.column);
    if (row !== node.row || column !== node.column) {
      this._active = { column, row } as ActiveNode<T>;
    }
  }

  /** `key` when it is visible, else the closest visible column in display order. */
  #nearestVisibleColumn(key: Keys<T>): Keys<T> {
    const columns = this.columns;
    const index = columns.findIndex((column) => column.key === key);
    if (index < 0) return this.firstColumn;
    for (let distance = 0; distance < columns.length; distance++) {
      for (const at of [index + distance, index - distance]) {
        const column = columns[at];
        if (column && !column.hidden) return column.key;
      }
    }
    return this.firstColumn;
  }

  /** The active row is one a feature module renders full width (no cells). */
  protected isPresentedRow(index: number): boolean {
    const data = this.host.pageItems[index];
    if (!data) return false;
    // @ts-expect-error - protected member access
    const state = this.host.stateController as {
      presentRow(row: T, ctx: { columns: ColumnConfiguration<T>[]; rowIndex: number }): unknown;
    };
    return state.presentRow(data, { columns: this.host.columns, rowIndex: index }) !== null;
  }

  /** Home moves to the first cell in the row (ARIA grid pattern). */
  protected home() {
    this.active = Object.assign(this.nextNode, { column: this.firstColumn });
    this.scrollToCell(this.active);
  }

  /** End moves to the last cell in the row (ARIA grid pattern). */
  protected end() {
    const last = this.visibleColumns.at(-1)?.key ?? this.firstColumn;
    this.active = Object.assign(this.nextNode, { column: last });
    this.scrollToCell(this.active);
  }

  /** Ctrl/Cmd+Home moves to the first cell of the grid. */
  protected ctrlHome() {
    this.active = { column: this.firstColumn, row: 0 } as ActiveNode<T>;
    this.scrollToRow(0);
  }

  /** Ctrl/Cmd+End moves to the last cell of the grid. */
  protected ctrlEnd() {
    const row = this.host.pageItems.length - 1;
    const last = this.visibleColumns.at(-1)?.key ?? this.firstColumn;
    this.active = { column: last, row } as ActiveNode<T>;
    this.scrollToRow(row);
  }

  /**
   * Rows per Page Up/Down step: the rows that fit in the part of the
   * scrollport the sticky chrome leaves visible, minus one so the row the
   * user was on stays in view. Falls back to 10 when nothing is measurable.
   */
  protected pageStep(): number {
    const host = this.host as unknown as HTMLElement;
    let rowHeight = 0;
    for (const row of this.virtualizer.querySelectorAll(GRID_ROW_TAG)) {
      const height = (row as HTMLElement).offsetHeight;
      // The shortest rendered row: an expanded detail panel is not a row height.
      if (height > 0 && (!rowHeight || height < rowHeight)) rowHeight = height;
    }
    const { top, bottom } = this.scrollInsets();
    const viewport = host.clientHeight - top - bottom;
    if (!rowHeight || viewport <= 0) return 10;
    return Math.max(1, Math.floor(viewport / rowHeight) - 1);
  }

  protected pageUp() {
    const next = this.nextNode;
    this.active = Object.assign(next, { row: Math.max(0, next.row - this.pageStep()) });
    this.scrollToRow(this.active.row);
  }

  protected pageDown() {
    const next = this.nextNode;
    this.active = Object.assign(next, {
      row: Math.min(this.host.pageItems.length - 1, next.row + this.pageStep()),
    });
    this.scrollToRow(this.active.row);
  }

  protected arrowDown() {
    const next = this.nextNode;
    this.active = Object.assign(next, {
      row: Math.min(next.row + 1, this.host.pageItems.length - 1),
    });
    this.scrollToRow(next.row);
  }

  protected arrowUp() {
    const next = this.nextNode;
    this.active = Object.assign(next, { row: Math.max(0, next.row - 1) });
    this.scrollToRow(next.row);
  }

  protected arrowLeft() {
    this.#moveInline('ArrowLeft');
  }

  protected arrowRight() {
    this.#moveInline('ArrowRight');
  }

  /**
   * Moves the active cell one column in a *physical* direction.
   *
   * ArrowLeft and ArrowRight name screen directions, not column order, so under
   * `dir="rtl"` the column to the left is the *next* one and the mapping onto
   * previous/next inverts ({@link towardsInlineEnd}). Everything else about
   * navigation is order-based and needs no direction awareness.
   */
  #moveInline(key: 'ArrowLeft' | 'ArrowRight') {
    const next = this.nextNode;
    const column = this.towardsInlineEnd(key)
      ? this.getNextColumn(next.column)
      : this.getPreviousColumn(next.column);
    this.active = Object.assign(next, { column });
    this.scrollToCell(this.active);
  }

  protected toggleSelection() {
    // Space on the focused grid toggles selection of the active row.
    // No-op when selection is disabled, there's no active row, or the row is
    // module-rendered (a group header or total row is not a data row).
    const data = this.host.pageItems[this._active.row] as T | undefined;
    if (!data || this.isPresentedRow(this._active.row)) return;
    void this.host.toggleRowSelection(data);
  }

  public hostConnected() {}

  public hostDisconnected() {
    this.active = SENTINEL_NODE as ActiveNode<T>;
  }

  protected get editing() {
    // @ts-expect-error - protected member access
    return this.host.stateController.editing as
      | {
          enabled: boolean;
          isEditable(column: ColumnConfiguration<T>): boolean;
          editCell(rowIndex: number, columnKey: Keys<T>): Promise<boolean>;
        }
      | undefined;
  }

  /**
   * Enter / F2 on the active cell opens its editor (the keyboard path into
   * edit mode). Returns `true` when the event was consumed.
   */
  protected handleEditKey(event: KeyboardEvent): boolean {
    if (event.key !== 'Enter' && event.key !== 'F2') return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (this._active === SENTINEL_NODE || this.isPresentedRow(this._active.row)) return false;
    const editing = this.editing;
    if (!editing?.enabled) return false;
    const column = this.host.getColumn(this.active.column);
    if (!column || !editing.isEditable(column)) return false;
    event.preventDefault();
    void editing.editCell(this.active.row, this.active.column);
    return true;
  }

  protected get rowReorder() {
    // @ts-expect-error - protected member access
    return this.host.stateController.rowReorder as
      | {
          enabled: boolean;
          isGrabbing: boolean;
          grabbed: T | null;
          grab(rowIndex: number): boolean;
          moveGrabbed(direction: -1 | 1): number;
          drop(): void;
          cancelGrab(): void;
        }
      | undefined;
  }

  /**
   * Keyboard row reorder: Space grabs the active row, arrows move it, Space /
   * Enter drops, Escape cancels. Returns `true` when the event was consumed.
   * Only active when `rowReordering.enabled` (so it never shadows Space-to-select
   * on grids without reordering).
   */
  protected handleReorderKey(event: KeyboardEvent): boolean {
    const reorder = this.rowReorder;
    if (!reorder?.enabled) return false;

    if (reorder.isGrabbing) {
      switch (event.key) {
        case 'ArrowUp':
        case 'ArrowDown': {
          event.preventDefault();
          const row = reorder.grabbed;
          const next = reorder.moveGrabbed(event.key === 'ArrowDown' ? 1 : -1);
          if (next >= 0 && row) {
            this.active = Object.assign(this.nextNode, { row: next });
            this.scrollToRow(next);
            this.#followRecord(row);
          }
          return true;
        }
        case ' ':
        case 'Enter':
          event.preventDefault();
          reorder.drop();
          return true;
        case 'Escape': {
          event.preventDefault();
          const row = reorder.grabbed;
          reorder.cancelGrab();
          if (row) this.#followRecord(row);
          return true;
        }
        default:
          return false;
      }
    }

    if (event.key === ' ' && this.active.row >= 0 && !this.isPresentedRow(this.active.row)) {
      event.preventDefault();
      return reorder.grab(this.active.row);
    }
    return false;
  }

  /**
   * After a keyboard grab moves `record` (or Escape puts it back), puts the
   * active row on the record's view index and real focus on its cell, once
   * the re-run pipeline has rendered. The move re-renders the rows, which
   * can drop focus or leave it on an element now showing another record.
   * Yields when the active cell changed in the meantime (a newer key).
   */
  #followRecord(record: T): void {
    const node = this._active;
    // @ts-expect-error - protected member access
    void (this.host.pipelineSettled() as Promise<void>).then(() => {
      if (this._active !== node || node === SENTINEL_NODE) return;
      const row = this.host.pageItems.indexOf(record);
      if (row < 0) return;
      if (row !== node.row) {
        this.active = { ...node, row };
        this.scrollToRow(row);
      }
      this.focusActiveCell();
    });
  }

  public navigate(event: KeyboardEvent) {
    if (this.handleReorderKey(event)) return;
    // Undo / redo: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y. Only fires when the
    // grid body (not an open editor) has focus, so a text editor's native undo
    // is never hijacked.
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        this.host.undo();
        return;
      }
      if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        this.host.redo();
        return;
      }
      // Ctrl/Cmd+Home / Ctrl/Cmd+End jump to the grid corners (ARIA grid pattern).
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        if (!this.navigable) return;
        if (event.key === 'Home') {
          this.ctrlHome();
        } else {
          this.ctrlEnd();
        }
        // The target row is often outside the rendered window, so the cell is
        // revealed (horizontally too) once the virtualizer has rendered it.
        this.focusActiveCell(true);
        return;
      }
    }
    if (this.handleEditKey(event)) return;
    if (RELATIVE_KEYS.has(event.key)) {
      event.preventDefault();
      if (!this.navigable) return;
      // Entering the body with the keyboard (Tab lands on the scroll
      // container, no cell active yet): an arrow, Home or Page Up activates
      // the first cell instead of moving past it. End and Page Down still
      // move, starting from that first cell.
      if (this._active === SENTINEL_NODE) {
        // Through the setter: the render it requests moves the tab stop
        // from the body to the cell.
        this.active = { column: this.firstColumn, row: 0 } as ActiveNode<T>;
        if (event.key !== 'End' && event.key !== 'PageDown') {
          this.scrollToRow(0);
          this.focusActiveCell(true);
          return;
        }
      }
    }
    if (this.handlers.has(event.key)) {
      event.preventDefault();
      this.handlers.get(event.key)!.call(this);
      // Real focus follows the active cell so AT tracks the movement.
      this.focusActiveCell();
    }
  }
}
