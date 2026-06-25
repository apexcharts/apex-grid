import type { ColumnConfiguration, SortExpression } from 'apex-grid';
import type { GridFeatureModule, GridHost } from 'apex-grid/internal';
import type { ReactiveController } from 'lit';
import { html, render } from 'lit';

export const CONTEXT_MENU_MODULE_ID = 'context-menu';

/** What was right-clicked: a body cell (with its row) or a column header. */
export interface ContextMenuTarget<T extends object> {
  readonly kind: 'cell' | 'header';
  readonly column: ColumnConfiguration<T>;
  /** The row record (cell targets only). */
  readonly row?: T;
  /** Row index within `pageItems` (cell targets only). */
  readonly rowIndex?: number;
}

/** A single context-menu entry. Provide `submenu` for a nested menu, or `run` for a leaf. */
export interface ContextMenuItem<T extends object = any> {
  id: string;
  label: string;
  run?: (target: ContextMenuTarget<T>) => void;
  disabled?: boolean;
  submenu?: ContextMenuItem<T>[];
  /** Render a divider before this item. */
  separatorBefore?: boolean;
}

const MENU_STYLE_ID = 'apex-grid-context-menu-style';
const MENU_CSS = `
.apex-grid-context-menu {
  position: fixed;
  z-index: 12000;
  min-inline-size: 180px;
  padding: 4px;
  background: #fff;
  border: 1px solid #d8dade;
  border-radius: 6px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.16);
  font: 0.8rem/1.4 system-ui, sans-serif;
  color: #1f2328;
}
.apex-grid-context-menu .agcm-item {
  display: block;
  inline-size: 100%;
  text-align: start;
  font: inherit;
  padding: 6px 10px;
  border: none;
  background: none;
  border-radius: 4px;
  cursor: pointer;
}
.apex-grid-context-menu .agcm-item:hover:not([disabled]),
.apex-grid-context-menu .agcm-item:focus-visible {
  background: #f1f3f5;
  outline: none;
}
.apex-grid-context-menu .agcm-item[disabled] {
  opacity: 0.45;
  cursor: default;
}
.apex-grid-context-menu .agcm-sep {
  block-size: 1px;
  margin: 4px 2px;
  background: #eef0f4;
}`;

function ensureStyle(): void {
  if (document.getElementById(MENU_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = MENU_STYLE_ID;
  style.textContent = MENU_CSS;
  document.head.appendChild(style);
}

/**
 * Enterprise feature: a right-click **context menu** on cells and headers. Listens for `contextmenu`
 * (and Shift+F10 / the Menu key) on the grid host, resolves the target column/row from the event's
 * `composedPath()`, and shows a keyboard-navigable menu portaled to `document.body`.
 *
 * Default items: sort asc/desc/clear, pin start/end/unpin, hide column, and copy (cells). Override
 * via {@link items}. Opt in with `ApexGridEnterprise.use(contextMenuModule)` (the `/define` entry
 * includes it).
 */
export class ContextMenuController<T extends object> implements ReactiveController {
  /** When `false`, the feature is inert. */
  public enabled = true;
  /** Replace the default items: a static array or a per-target callback. `null` = defaults. */
  public items:
    | ContextMenuItem<T>[]
    | ((target: ContextMenuTarget<T>) => ContextMenuItem<T>[])
    | null = null;

  #menu: HTMLElement | null = null;
  #target: ContextMenuTarget<T> | null = null;
  #current: ContextMenuItem<T>[] = [];

  constructor(private host: GridHost<T>) {
    host.addController(this);
  }

  public hostConnected(): void {
    const el = this.host as unknown as HTMLElement;
    el.addEventListener('contextmenu', this.#onContextMenu);
    el.addEventListener('keydown', this.#onHostKeydown);
  }

  public hostDisconnected(): void {
    const el = this.host as unknown as HTMLElement;
    el.removeEventListener('contextmenu', this.#onContextMenu);
    el.removeEventListener('keydown', this.#onHostKeydown);
    this.#close();
  }

  #onContextMenu = (event: MouseEvent): void => {
    if (!this.enabled) return;
    const resolved = this.#resolve(event);
    if (!resolved) return;
    event.preventDefault();
    this.#openAt(resolved.target, event.clientX, event.clientY);
  };

  #onHostKeydown = (event: KeyboardEvent): void => {
    if (!this.enabled) return;
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    const resolved = this.#resolve(event);
    if (!resolved) return;
    event.preventDefault();
    const rect = resolved.element.getBoundingClientRect();
    this.#openAt(resolved.target, rect.left, rect.bottom);
  };

  /** Resolve the cell/header (and its element) from an event's composed path. */
  #resolve(event: Event): { target: ContextMenuTarget<T>; element: HTMLElement } | null {
    for (const node of event.composedPath()) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.localName === 'apex-grid-cell') {
        const cell = node as unknown as {
          column?: ColumnConfiguration<T>;
          row?: { index?: number };
        };
        if (!cell.column) return null;
        const rowIndex = cell.row?.index;
        const row = typeof rowIndex === 'number' ? (this.host.pageItems[rowIndex] as T) : undefined;
        return { target: { kind: 'cell', column: cell.column, row, rowIndex }, element: node };
      }
      if (node.localName === 'apex-grid-header') {
        const header = node as unknown as { column?: ColumnConfiguration<T> };
        if (!header.column) return null;
        return { target: { kind: 'header', column: header.column }, element: node };
      }
    }
    return null;
  }

  #buildItems(target: ContextMenuTarget<T>): ContextMenuItem<T>[] {
    if (typeof this.items === 'function') return this.items(target);
    if (this.items) return this.items;
    return this.defaultItems(target);
  }

  /** The built-in items for a target. Exposed so a custom `items` callback can extend them. */
  public defaultItems(target: ContextMenuTarget<T>): ContextMenuItem<T>[] {
    const column = target.column;
    const key = column.key;
    const sortBy = (direction: 'ascending' | 'descending') =>
      this.host.sort([{ key, direction }] as unknown as SortExpression<T>[]);
    const items: ContextMenuItem<T>[] = [
      { id: 'sort-asc', label: 'Sort ascending', run: () => sortBy('ascending') },
      { id: 'sort-desc', label: 'Sort descending', run: () => sortBy('descending') },
      { id: 'sort-clear', label: 'Clear sort', run: () => this.host.clearSort(key) },
      {
        id: 'pin-start',
        label: 'Pin to start',
        separatorBefore: true,
        run: () => this.#repin(column, 'start'),
      },
      { id: 'pin-end', label: 'Pin to end', run: () => this.#repin(column, 'end') },
      {
        id: 'unpin',
        label: 'Unpin',
        disabled: !column.pinned,
        run: () => this.#repin(column, null),
      },
      {
        id: 'hide',
        label: 'Hide column',
        separatorBefore: true,
        run: () => this.#setHidden(column),
      },
    ];
    if (target.kind === 'cell') {
      items.push({ id: 'copy', label: 'Copy', separatorBefore: true, run: (t) => this.#copy(t) });
    }
    return items;
  }

  #repin(column: ColumnConfiguration<T>, pinned: 'start' | 'end' | null): void {
    this.host.columns = this.host.columns.map((c) => (c.key === column.key ? { ...c, pinned } : c));
  }

  #setHidden(column: ColumnConfiguration<T>): void {
    this.host.columns = this.host.columns.map((c) =>
      c.key === column.key ? { ...c, hidden: true } : c
    );
  }

  #copy(target: ContextMenuTarget<T>): void {
    if (target.row == null) return;
    const value = (target.row as Record<string, unknown>)[String(target.column.key)];
    void navigator.clipboard?.writeText?.(value == null ? '' : String(value));
  }

  // --- menu rendering ------------------------------------------------------

  #openAt(target: ContextMenuTarget<T>, x: number, y: number): void {
    ensureStyle();
    this.#close();
    this.#target = target;
    this.#current = this.#buildItems(target);
    const menu = document.createElement('div');
    menu.className = 'apex-grid-context-menu';
    menu.setAttribute('role', 'menu');
    document.body.appendChild(menu);
    this.#menu = menu;
    this.#renderItems();

    // Clamp into the viewport.
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;

    this.#focusItem(0);
    document.addEventListener('pointerdown', this.#onOutside, true);
    menu.addEventListener('keydown', this.#onMenuKeydown);
  }

  #renderItems(): void {
    if (!this.#menu) return;
    render(
      html`${this.#current.map(
        (item) => html`${
          item.separatorBefore ? html`<div class="agcm-sep" role="separator"></div>` : ''
        }<button
            type="button"
            role="menuitem"
            class="agcm-item"
            tabindex="-1"
            ?disabled=${item.disabled}
            @click=${() => this.#run(item)}
          >
            ${item.label}
          </button>`
      )}`,
      this.#menu
    );
  }

  #buttons(): HTMLButtonElement[] {
    return this.#menu
      ? [...this.#menu.querySelectorAll<HTMLButtonElement>('.agcm-item:not([disabled])')]
      : [];
  }

  #focusItem(index: number): void {
    const buttons = this.#buttons();
    if (!buttons.length) return;
    const i = ((index % buttons.length) + buttons.length) % buttons.length;
    buttons[i]?.focus();
  }

  #onMenuKeydown = (event: KeyboardEvent): void => {
    const buttons = this.#buttons();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.#focusItem(current + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.#focusItem(current - 1);
        break;
      case 'Home':
        event.preventDefault();
        this.#focusItem(0);
        break;
      case 'End':
        event.preventDefault();
        this.#focusItem(buttons.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        this.#close();
        break;
      case 'Tab':
        this.#close();
        break;
    }
  };

  #onOutside = (event: Event): void => {
    if (this.#menu && !event.composedPath().includes(this.#menu)) this.#close();
  };

  #run(item: ContextMenuItem<T>): void {
    if (item.disabled) return;
    const target = this.#target;
    this.#close();
    if (target) item.run?.(target);
  }

  #close = (): void => {
    if (!this.#menu) return;
    this.#menu.removeEventListener('keydown', this.#onMenuKeydown);
    document.removeEventListener('pointerdown', this.#onOutside, true);
    render(html``, this.#menu);
    this.#menu.remove();
    this.#menu = null;
    this.#target = null;
  };
}

/** Feature module registered on the enterprise grid. */
export const contextMenuModule: GridFeatureModule = {
  id: CONTEXT_MENU_MODULE_ID,
  create: (host) => new ContextMenuController(host),
};
