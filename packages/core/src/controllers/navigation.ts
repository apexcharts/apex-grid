import type { ReactiveController } from 'lit';
import type ApexGridRow from '../components/row.js';
import { NAVIGATION_STATE, SENTINEL_NODE } from '../internal/constants.js';
import { GRID_ROW_TAG } from '../internal/tags.js';
import type { ActiveNode, GridHost, Keys } from '../internal/types.js';
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

  protected home() {
    this.active = Object.assign(this.nextNode, { row: 0 });
    this.virtualizer.element(this.active.row)?.scrollIntoView({ block: 'nearest' });
  }

  protected end() {
    this.active = Object.assign(this.nextNode, { row: this.host.pageItems.length - 1 });
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
    }
    if (this.handlers.has(event.key)) {
      event.preventDefault();
      this.handlers.get(event.key)!.call(this);
    }
  }
}
