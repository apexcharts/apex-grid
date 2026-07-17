import type { ReactiveController } from 'lit';
import type ApexGridRow from '../components/row.js';
import { NAVIGATION_STATE, SENTINEL_NODE } from '../internal/constants.js';
import { GRID_ROW_TAG } from '../internal/tags.js';
import type { ActiveNode, ColumnConfiguration, GridHost, Keys } from '../internal/types.js';
import { getDisplayColumns } from '../internal/utils.js';

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

  protected state = NAVIGATION_STATE;
  protected _active = SENTINEL_NODE;

  protected get nextNode() {
    const node = this.state.get('current')!;
    return node === SENTINEL_NODE
      ? { column: this.firstColumn, row: 0 }
      : ({ ...node } as ActiveNode<T>);
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

  protected getPreviousColumn(key: Keys<T>): Keys<T> {
    const columns = this.visibleColumns;
    const idx = columns.findIndex((column) => column.key === key);
    return columns[Math.max(idx - 1, 0)].key;
  }

  protected getNextColumn(key: Keys<T>): Keys<T> {
    const columns = this.visibleColumns;
    const idx = columns.findIndex((column) => column.key === key);
    return columns[Math.min(idx + 1, columns.length - 1)].key;
  }

  protected scrollToCell(node: ActiveNode<T>) {
    const row = Array.from(this.virtualizer.querySelectorAll(GRID_ROW_TAG)).find(
      (row) => (row as unknown as ApexGridRow<T>).index === node.row
    ) as unknown as ApexGridRow<T>;

    if (row) {
      row.cells
        .find((cell) => cell.column.key === node.column)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }

  protected findActiveCell() {
    const row = Array.from(this.virtualizer.querySelectorAll(GRID_ROW_TAG)).find(
      (el) => (el as unknown as ApexGridRow<T>).index === this.active.row
    ) as unknown as ApexGridRow<T> | undefined;
    return row?.cells.find((cell) => cell.column.key === this.active.column);
  }

  /**
   * Moves real DOM focus to the active cell (the grid body's roving tab stop),
   * so screen readers track keyboard navigation. Waits for the host render to
   * commit the cell's `active` state, then retries once on the next frame to
   * cover virtualizer re-materialization after a long jump. No-op while no
   * cell is active (the scroll container keeps focus as the entry point).
   */
  public focusActiveCell(): void {
    const node = this.state.get('current');
    if (!node || node === SENTINEL_NODE) return;
    void (async () => {
      await this.host.updateComplete;
      let cell = this.findActiveCell();
      if (!cell) {
        await new Promise(requestAnimationFrame);
        cell = this.findActiveCell();
      }
      cell?.focus({ preventScroll: true });
    })();
  }

  public get active() {
    return this._active as ActiveNode<T>;
  }

  public set active(node: ActiveNode<T>) {
    this._active = node;
    this.state.set('previous', this._active);
    this.state.set('current', node);
    this.host.requestUpdate();
  }

  constructor(protected host: GridHost<T>) {
    this.host.addController(this);
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
    this.virtualizer.element(0)?.scrollIntoView({ block: 'nearest' });
    this.scrollToCell(this.active);
  }

  /** Ctrl/Cmd+End moves to the last cell of the grid. */
  protected ctrlEnd() {
    const row = Math.max(0, this.host.pageItems.length - 1);
    const last = this.visibleColumns.at(-1)?.key ?? this.firstColumn;
    this.active = { column: last, row } as ActiveNode<T>;
    this.virtualizer.element(row)?.scrollIntoView({ block: 'nearest' });
    this.scrollToCell(this.active);
  }

  /**
   * Rows per Page Up/Down step, derived from the host viewport and the height
   * of a rendered row (fallback: 10 rows when nothing is measurable yet).
   */
  protected pageStep(): number {
    const rowEl = this.virtualizer.element(this.nextNode.row) as HTMLElement | undefined;
    const rowHeight = rowEl?.offsetHeight || 0;
    const viewport = (this.host as unknown as HTMLElement).clientHeight || 0;
    if (!rowHeight || !viewport) return 10;
    const rows = Math.floor(viewport / rowHeight) - 1;
    return rows > 0 ? rows : 10;
  }

  protected pageUp() {
    const next = this.nextNode;
    this.active = Object.assign(next, { row: Math.max(0, next.row - this.pageStep()) });
    this.virtualizer.element(this.active.row)?.scrollIntoView({ block: 'nearest' });
  }

  protected pageDown() {
    const next = this.nextNode;
    this.active = Object.assign(next, {
      row: Math.min(this.host.pageItems.length - 1, next.row + this.pageStep()),
    });
    this.virtualizer.element(this.active.row)?.scrollIntoView({ block: 'nearest' });
  }

  protected arrowDown() {
    const next = this.nextNode;

    this.active = Object.assign(next, {
      row: Math.min(next.row + 1, this.host.pageItems.length - 1),
    });
    this.virtualizer.element(next.row)?.scrollIntoView({ block: 'nearest' });
  }

  protected arrowUp() {
    const next = this.nextNode;
    this.active = Object.assign(next, { row: Math.max(0, next.row - 1) });
    this.virtualizer.element(next.row)?.scrollIntoView({ block: 'nearest' });
  }

  protected arrowLeft() {
    const next = this.nextNode;
    this.active = Object.assign(next, { column: this.getPreviousColumn(next.column) });
    this.scrollToCell(this.active);
  }

  protected arrowRight() {
    const next = this.nextNode;
    this.active = Object.assign(next, { column: this.getNextColumn(next.column) });
    this.scrollToCell(this.active);
  }

  protected toggleSelection() {
    // Space on the focused grid toggles selection of the active row.
    // No-op when selection is disabled or there's no active row.
    const data = this.host.pageItems[this.active.row] as T | undefined;
    if (!data) return;
    void this.host.toggleRowSelection(data);
  }

  public hostConnected() {}

  public hostDisconnected() {
    this.active = SENTINEL_NODE as ActiveNode<T>;
    this.state = NAVIGATION_STATE;
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
    const node = this.state.get('current');
    if (!node || node === SENTINEL_NODE) return false;
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
          const next = reorder.moveGrabbed(event.key === 'ArrowDown' ? 1 : -1);
          if (next >= 0) {
            this.active = Object.assign(this.nextNode, { row: next });
            this.virtualizer.element(next)?.scrollIntoView({ block: 'nearest' });
          }
          return true;
        }
        case ' ':
        case 'Enter':
          event.preventDefault();
          reorder.drop();
          return true;
        case 'Escape':
          event.preventDefault();
          reorder.cancelGrab();
          return true;
        default:
          return false;
      }
    }

    if (event.key === ' ' && this.active.row >= 0) {
      event.preventDefault();
      return reorder.grab(this.active.row);
    }
    return false;
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
        if (event.key === 'Home') {
          this.ctrlHome();
        } else {
          this.ctrlEnd();
        }
        this.focusActiveCell();
        return;
      }
    }
    if (this.handleEditKey(event)) return;
    if (this.handlers.has(event.key)) {
      event.preventDefault();
      this.handlers.get(event.key)!.call(this);
      // Real focus follows the active cell so AT tracks the movement.
      this.focusActiveCell();
    }
  }
}
