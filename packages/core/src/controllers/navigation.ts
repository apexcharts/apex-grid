import type { ReactiveController } from 'lit';
import type ApexGridRow from '../components/row.js';
import { revealWithin, type ScrollInsets } from '../components/virtualizer.js';
import { SENTINEL_NODE } from '../internal/constants.js';
import { GRID_BODY, GRID_CELL_TAG, GRID_ROW_TAG } from '../internal/tags.js';
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

/** The focused element, through every open shadow root on the way down. */
function deepActiveElement(): Element | null {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

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
    void this.#focusActive(reveal);
  }

  /** {@link focusActiveCell}, settling once the focus moved or was given up. */
  async #focusActive(reveal = false): Promise<void> {
    const node = this._active;
    if (node === SENTINEL_NODE) return;
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
    // An estimated scroll missed the row (stale size estimates): wait for the
    // virtualizer's corrected scrolls to render it.
    if (!cell && this._active === node) {
      await this.virtualizer.revealed();
      cell = this.findCell(node);
    }
    // The user moved on while this was waiting: leave focus to the newer move.
    if (!cell || this._active !== node) return;
    if (reveal) this.scrollToCell(node);
    cell.focus({ preventScroll: true });
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
   * Whether this grid's body holds focus: the body itself, one of its cells
   * or an editor in one, not a grid nested in a detail panel. Tracked from
   * the body's focus events ({@link focusEntered}, {@link focusLeft}). A
   * focus loss a re-bind caused (it removed the focused editor while a
   * reconcile is running) keeps it until that reconcile has run, so it can
   * put focus back under row recycling. Any other loss clears it: a click
   * elsewhere, the window losing focus, a template removing its own focused
   * element, the grid leaving the document. Focus is never taken back once
   * it left the grid.
   */
  public get ownsFocus(): boolean {
    return this.#ownsFocus;
  }

  #ownsFocus = false;

  /** The record the focused row showed when focus arrived, for the reconcile. */
  #focusedRecord: T | null = null;

  /**
   * The element that lost focus to nowhere in this task, until a microtask
   * tells a removal (no longer in the document) from a blur (still there).
   */
  #blurred: Element | null = null;

  /**
   * An element that lost focus by moving into another row with its record
   * while a reconcile was running, for the reconcile to focus again.
   */
  #moved: Element | null = null;

  /** Bumped by every {@link reconcileFocus}, so only the latest one acts. */
  #reconcile = 0;

  /** The token of the reconcile still to run, or 0 when none is. */
  #reconciling = 0;

  /** Set while a page change holds focus in the body (see {@link parkFocus}). */
  #parked: { record: T | null } | null = null;

  /** Set while this controller focuses the body itself, which must not forward. */
  #focusingBody = false;

  /** A focused grid's active cell when it was detached, until it is re-attached. */
  #detached: { node: ActiveNode<T> } | null = null;

  /**
   * Whether focus arriving on the body itself should move on to the active
   * cell (the roving tab stop). Not while a page change holds focus in the
   * body, or while this controller puts it there.
   */
  public get forwardsBodyFocus(): boolean {
    return !this.#parked && !this.#focusingBody;
  }

  /**
   * Focus arrived in the body. `owned` is whether the event is this grid's
   * rather than a nested grid's (the grid's `ownsEvent`).
   */
  public focusEntered(event: FocusEvent, owned: boolean): void {
    this.#blurred = null;
    this.#moved = null;
    this.#ownsFocus = owned;
    this.#focusedRecord = owned ? (this.#locate(event.composedPath()[0])?.row?.data ?? null) : null;
  }

  /**
   * Focus left something in the body. Focus moving to another element is
   * followed by its `focusin`, which sets {@link ownsFocus} again when that
   * element is this body's. Focus going nowhere is a blur when the element
   * is still in the document a microtask later, and a removal otherwise. A
   * removal keeps {@link ownsFocus} only while a reconcile is running, which
   * then decides; with none, nothing would repair it, so a later reconcile
   * must not either.
   */
  public focusLeft(event: FocusEvent, owned: boolean): void {
    if (!owned) return;
    if (event.relatedTarget) {
      this.#ownsFocus = false;
      return;
    }
    const target = event.composedPath()[0] as Element;
    const from = this.#locate(target)?.row;
    this.#blurred = target;
    queueMicrotask(() => {
      if (this.#blurred !== target) return;
      this.#blurred = null;
      if (!this.#reconciling) {
        this.#ownsFocus = false;
        return;
      }
      if (!target.isConnected) return;
      // Still in the document but in another row: a detail panel's content
      // followed its record there (see DetailRoots in row.ts), which the
      // browser treats as a blur. The reconcile puts focus back on it.
      const to = this.#locate(target)?.row;
      if (to && to !== from) this.#moved = target;
      else this.#ownsFocus = false;
    });
  }

  /**
   * Row recycling: after the rows re-render, puts focus back in the body when
   * the render took it away. A re-bind keeps every row element in place, so
   * focus usually stays where it was, on the cell at the active position; it
   * is lost only when the focused element left the document (an editor whose
   * slot now shows another record) or stands on a row that now shows another
   * record without being active. Then focus goes to the edited record's
   * editor when it is rendered, else the active cell when its row is, else
   * the body. Acts only while the body owns focus, so it never takes focus
   * back from outside the grid or off a nested grid. A loss it leaves
   * unrepaired clears {@link ownsFocus}.
   */
  public reconcileFocus(): void {
    if (!this.#ownsFocus || !this.host.rowRecycling) return;
    const token = ++this.#reconcile;
    this.#reconciling = token;
    void (async () => {
      try {
        // A range change commits its rows right after its listeners return.
        await Promise.resolve();
        await this.virtualizer.rendered();
        if (token !== this.#reconcile || this.#parked) return;
        if (!this.#ownsFocus || !this.host.isConnected) return;
        const focused = deepActiveElement();
        if (focused && focused !== document.body) {
          const at = this.#locate(focused);
          if (!at?.row) return;
          const active = this._active;
          const onActive =
            at.row.index === active.row && (!at.cell || at.cell.column.key === active.column);
          if (onActive || at.row.data === this.#focusedRecord) return;
        }
        await this.#restoreFocus();
      } finally {
        if (token === this.#reconcile) {
          this.#reconciling = 0;
          this.#moved = null;
          // A page change decides once its pipeline has run (parkFocus).
          if (!this.#parked && this.#lost()) this.#ownsFocus = false;
        }
      }
    })();
  }

  /**
   * Focus on what moved with the focused record (a detail panel's input),
   * else the edited record's editor, else the active cell, else the body.
   */
  async #restoreFocus(): Promise<void> {
    const moved = this.#moved;
    this.#moved = null;
    if (moved?.isConnected && moved instanceof HTMLElement) {
      const at = this.#locate(moved);
      if (at?.row && at.row.data === this.#focusedRecord) {
        moved.focus({ preventScroll: true });
        return;
      }
    }
    const edit = this.editing?.activeCell;
    const row = edit && this.#renderedRows().find((each) => each.data === edit.data);
    const cell = row?.cells.find((each) => each.column.key === edit?.columnKey);
    if (cell) {
      await cell.updateComplete;
      const editor = cell.shadowRoot?.querySelector<HTMLElement>('input, [data-apex-editor]');
      if (this.#lost()) (editor ?? cell).focus({ preventScroll: true });
      return;
    }
    if (this._active !== SENTINEL_NODE && this.virtualizer.isRendered(this._active.row)) {
      await this.#focusActive();
      return;
    }
    this.#focusBody();
  }

  /**
   * Row recycling: a page change re-binds every row to the new page's
   * records, so a focused cell would stay focused on another record. Holds
   * focus in the body across the change: the body does not forward focus to
   * the active cell, and the post-render reconcile waits. Returns what to
   * call once the change has run its pipeline: focus then moves to the body
   * unless it rests on an editor or on a cell still showing the record it
   * showed before. Returns `null`, holding nothing, without row recycling or
   * while the body does not own focus.
   */
  public parkFocus(): (() => Promise<void>) | null {
    if (!this.host.rowRecycling || !this.#ownsFocus) return null;
    const at = this.#locate(deepActiveElement());
    const park = { record: at?.row?.data ?? null };
    this.#parked = park;
    return async () => {
      await this.virtualizer.rendered();
      if (this.#parked !== park) return;
      this.#parked = null;
      if (!this.#ownsFocus || !this.host.isConnected) return;
      const focused = deepActiveElement();
      if (focused && focused !== document.body) {
        const now = this.#locate(focused);
        if (!now?.row) return;
        if (now.cell && (now.cell as HTMLElement & { editing?: boolean }).editing) return;
        if (now.row.data === park.record) return;
      }
      this.#focusBody();
    };
  }

  /** Focuses the body itself, without its forward to the active cell. */
  #focusBody(): void {
    this.#focusingBody = true;
    try {
      (this.virtualizer as HTMLElement).focus({ preventScroll: true });
    } finally {
      this.#focusingBody = false;
    }
  }

  /** Whether focus has gone nowhere. */
  #lost(): boolean {
    const focused = deepActiveElement();
    return !focused || focused === document.body;
  }

  #renderedRows(): ApexGridRow<T>[] {
    return Array.from(
      this.virtualizer.querySelectorAll(GRID_ROW_TAG)
    ) as unknown as ApexGridRow<T>[];
  }

  /**
   * Where `el` stands in this grid's body: the row and cell holding it, or
   * neither for the body itself. `null` when it is not in this body, which
   * includes a grid nested in one of its rows (its own body comes first on
   * the way up).
   */
  #locate(
    el: EventTarget | null
  ): { row?: ApexGridRow<T>; cell?: ApexGridRow<T>['cells'][number] } | null {
    const body = this.virtualizer as Element | null;
    if (!body) return null;
    let row: ApexGridRow<T> | undefined;
    let cell: ApexGridRow<T>['cells'][number] | undefined;
    let node = el instanceof Node ? el : null;
    while (node) {
      if (node === body) return { row, cell };
      if (node instanceof Element) {
        const name = node.localName;
        if (name === GRID_BODY) return null;
        if (!cell && name === GRID_CELL_TAG) cell = node as unknown as typeof cell;
        if (!row && name === GRID_ROW_TAG) row = node as unknown as ApexGridRow<T>;
      }
      node = node instanceof ShadowRoot ? node.host : node.parentNode;
    }
    return null;
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
    // An open edit follows its record when a sort, filter or data change
    // moves it (the editing controller updates its index after this render).
    // The active cell on it goes along when the record stays in the rendered
    // rows, so the keyboard carries on from the edited cell once the edit
    // closes. A record moved out of view leaves the active cell in place,
    // where the user is looking.
    const edit = this.editing?.activeCell;
    if (edit && node.row === edit.rowIndex && node.column === edit.columnKey) {
      const index = this.host.pageItems.indexOf(edit.data);
      if (index >= 0 && index !== edit.rowIndex && this.virtualizer.isRendered(index)) {
        this._active = { column: node.column, row: index } as ActiveNode<T>;
        return;
      }
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

  public hostConnected() {
    const detached = this.#detached;
    this.#detached = null;
    if (detached) this.#refocusAfterMove(detached.node);
  }

  public hostDisconnected() {
    // A grid moved while its body held focus: under row recycling the master
    // row showing this grid's record changes on a master sort, and the
    // detail node follows its record into another row. The browser dropped
    // focus just before (`#blurred`); a re-attach within this task restores
    // the active cell and focus. Anything later is a removal, as before.
    const moved = this.#blurred !== null && this.host.rowRecycling;
    const detached = moved ? { node: this._active } : null;
    this.active = SENTINEL_NODE as ActiveNode<T>;
    this.#detached = detached;
    // A grid out of the document holds no focus: a re-attach later (a kept
    // alive tab or route) must not take focus on its next sort or scroll.
    if (!detached) this.#ownsFocus = false;
    if (detached) {
      setTimeout(() => {
        if (this.#detached !== detached) return;
        this.#detached = null;
        this.#ownsFocus = false;
      });
    }
  }

  /**
   * Restores the active cell a moved grid had and focuses it (the body when
   * no cell was active, or its row is not rendered), unless something else
   * took focus in the meantime.
   */
  #refocusAfterMove(node: ActiveNode<T>): void {
    if (node !== SENTINEL_NODE) this.active = node;
    void (async () => {
      await this.host.updateComplete;
      if (!this.#lost() || this._active !== node || !this.host.isConnected) return;
      const cell = node === SENTINEL_NODE ? undefined : this.findCell(node);
      // The body forwards to the active cell once the rows have rendered.
      (cell ?? (this.virtualizer as HTMLElement)).focus({ preventScroll: true });
    })();
  }

  protected get editing() {
    // @ts-expect-error - protected member access
    return this.host.stateController.editing as
      | {
          activeCell: { data: T; columnKey: Keys<T>; rowIndex: number } | null;
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
