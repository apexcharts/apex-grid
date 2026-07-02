import type { ColumnConfiguration, SortExpression } from 'apex-grid';
import type { ColumnMenuProvider, GridFeatureModule, GridHost } from 'apex-grid/internal';
import type { ReactiveController } from 'lit';
import { html, nothing, render } from 'lit';

export const CONTEXT_MENU_MODULE_ID = 'context-menu';

/** Fired on the grid before a context menu opens; cancellable, with a mutable `items` array. */
export const CONTEXT_MENU_OPENING_EVENT = 'apex-context-menu-opening';

/** Declarative config for the context menu (alternative to the boolean toggle). */
export interface ContextMenuConfig<T extends object = any> {
  /** Replace the default items: a static array or a per-target callback. */
  items?: ContextMenuItem<T>[] | ((target: ContextMenuTarget<T>) => ContextMenuItem<T>[]);
}

/** Detail of {@link CONTEXT_MENU_OPENING_EVENT}: mutate `items` (or `preventDefault()`) to customize. */
export interface ContextMenuOpeningDetail<T extends object = any> {
  readonly target: ContextMenuTarget<T>;
  items: ContextMenuItem<T>[];
}

/** Menu element augmented with the data the controller threads through render + keyboard nav. */
type MenuEl<T extends object> = HTMLElement & {
  __items?: ContextMenuItem<T>[];
  __parentButton?: HTMLElement;
};

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
export class ContextMenuController<T extends object>
  implements ReactiveController, ColumnMenuProvider
{
  /** When `false`, the feature is inert. */
  public enabled = true;
  /** Replace the default items: a static array or a per-target callback. `null` = defaults. */
  public items:
    | ContextMenuItem<T>[]
    | ((target: ContextMenuTarget<T>) => ContextMenuItem<T>[])
    | null = null;

  /** Open menus, root first; submenus pushed on top. */
  #menus: MenuEl<T>[] = [];
  #target: ContextMenuTarget<T> | null = null;

  constructor(private host: GridHost<T>) {
    host.addController(this);
  }

  public hostConnected(): void {
    const el = this.host as unknown as HTMLElement;
    el.addEventListener('contextmenu', this.#onContextMenu);
    el.addEventListener('keydown', this.#onHostKeydown);
    el.addEventListener('apex-grid-column-menu', this.#onColumnMenu as EventListener);
  }

  public hostDisconnected(): void {
    const el = this.host as unknown as HTMLElement;
    el.removeEventListener('contextmenu', this.#onContextMenu);
    el.removeEventListener('keydown', this.#onHostKeydown);
    el.removeEventListener('apex-grid-column-menu', this.#onColumnMenu as EventListener);
    this.#close();
  }

  /**
   * {@link ColumnMenuProvider}: tell the core header to show its kebab button
   * (on every column, not just sortable / resizable ones) whenever the context
   * menu is enabled, since the kebab opens this shared menu.
   */
  public providesColumnMenu(): boolean {
    return this.enabled;
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

  /**
   * Open the shared menu from a column header's kebab button. The core header
   * dispatches `apex-grid-column-menu` (with the column and the button element)
   * when its menu button is clicked; opening here means the kebab and the
   * right-click menu present exactly the same items. Calling `preventDefault()`
   * tells the core header a module owned the menu, so it skips its inline
   * fallback.
   */
  #onColumnMenu = (
    event: CustomEvent<{ column?: ColumnConfiguration<T>; anchor?: HTMLElement }>
  ): void => {
    if (!this.enabled) return;
    const column = event.detail?.column;
    const anchor = event.detail?.anchor;
    if (!column || !anchor) return;
    event.preventDefault();
    const rect = anchor.getBoundingClientRect();
    this.#openAt({ kind: 'header', column }, rect.left, rect.bottom);
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
      {
        id: 'sort-asc',
        label: this.host.localize('contextMenu.sortAsc'),
        run: () => sortBy('ascending'),
      },
      {
        id: 'sort-desc',
        label: this.host.localize('contextMenu.sortDesc'),
        run: () => sortBy('descending'),
      },
      {
        id: 'sort-clear',
        label: this.host.localize('contextMenu.clearSort'),
        run: () => this.host.clearSort(key),
      },
      {
        id: 'pin-start',
        label: this.host.localize('contextMenu.pinStart'),
        separatorBefore: true,
        run: () => this.#repin(column, 'start'),
      },
      {
        id: 'pin-end',
        label: this.host.localize('contextMenu.pinEnd'),
        run: () => this.#repin(column, 'end'),
      },
      {
        id: 'unpin',
        label: this.host.localize('contextMenu.unpin'),
        disabled: !column.pinned,
        run: () => this.#repin(column, null),
      },
      {
        id: 'hide',
        label: this.host.localize('contextMenu.hideColumn'),
        separatorBefore: true,
        run: () => this.#setHidden(column),
      },
    ];
    if (target.kind === 'cell') {
      items.push({
        id: 'copy',
        label: this.host.localize('contextMenu.copy'),
        separatorBefore: true,
        run: (t) => this.#copy(t),
      });
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

    const detail: ContextMenuOpeningDetail<T> = { target, items: this.#buildItems(target) };
    const opening = new CustomEvent<ContextMenuOpeningDetail<T>>(CONTEXT_MENU_OPENING_EVENT, {
      detail,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    (this.host as unknown as HTMLElement).dispatchEvent(opening);
    if (opening.defaultPrevented || detail.items.length === 0) {
      this.#target = null;
      return;
    }

    const menu = this.#spawnMenu(detail.items);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;
    this.#focusFirst(menu);
    document.addEventListener('pointerdown', this.#onOutside, true);
  }

  #spawnMenu(items: ContextMenuItem<T>[]): MenuEl<T> {
    const menu = document.createElement('div') as MenuEl<T>;
    menu.className = 'apex-grid-context-menu';
    menu.setAttribute('role', 'menu');
    menu.__items = items;
    document.body.appendChild(menu);
    this.#menus.push(menu);
    render(
      html`${items.map(
        (item, index) => html`${
          item.separatorBefore ? html`<div class="agcm-sep" role="separator"></div>` : nothing
        }<button
            type="button"
            role="menuitem"
            class="agcm-item"
            tabindex="-1"
            data-index=${index}
            ?disabled=${item.disabled}
            aria-haspopup=${item.submenu ? 'menu' : nothing}
            @click=${(event: Event) =>
              this.#activate(item, menu, event.currentTarget as HTMLElement)}
          >
            ${item.label}${
              item.submenu ? html`<span class="agcm-caret" aria-hidden="true">›</span>` : nothing
            }
          </button>`
      )}`,
      menu
    );
    menu.addEventListener('keydown', this.#onMenuKeydown);
    return menu;
  }

  #activate(item: ContextMenuItem<T>, menu: MenuEl<T>, button: HTMLElement): void {
    if (item.disabled) return;
    if (item.submenu?.length) this.#openSubmenu(item, menu, button);
    else this.#run(item);
  }

  #openSubmenu(item: ContextMenuItem<T>, parentMenu: MenuEl<T>, button: HTMLElement): void {
    // Collapse anything stacked above the parent, then flyout to the button's side.
    this.#closeFrom(this.#menus.indexOf(parentMenu) + 1);
    const child = this.#spawnMenu(item.submenu ?? []);
    child.__parentButton = button;
    const rect = button.getBoundingClientRect();
    const left =
      rect.right + child.offsetWidth > window.innerWidth - 4
        ? rect.left - child.offsetWidth
        : rect.right;
    const top = Math.min(rect.top, window.innerHeight - child.offsetHeight - 4);
    child.style.left = `${Math.max(4, left)}px`;
    child.style.top = `${Math.max(4, top)}px`;
    this.#focusFirst(child);
  }

  #buttonsOf(menu: MenuEl<T>): HTMLButtonElement[] {
    return [...menu.querySelectorAll<HTMLButtonElement>('.agcm-item:not([disabled])')];
  }

  #focusFirst(menu: MenuEl<T>): void {
    this.#buttonsOf(menu)[0]?.focus();
  }

  #onMenuKeydown = (event: KeyboardEvent): void => {
    const menu = event.currentTarget as MenuEl<T>;
    const buttons = this.#buttonsOf(menu);
    const active = document.activeElement as HTMLButtonElement;
    const current = buttons.indexOf(active);
    const move = (delta: number) => {
      event.preventDefault();
      const i = (((current + delta) % buttons.length) + buttons.length) % buttons.length;
      buttons[i]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        move(1);
        break;
      case 'ArrowUp':
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        buttons[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        buttons[buttons.length - 1]?.focus();
        break;
      case 'ArrowRight': {
        const item = menu.__items?.[Number(active?.dataset.index)];
        if (item?.submenu?.length) {
          event.preventDefault();
          this.#openSubmenu(item, menu, active);
        }
        break;
      }
      case 'ArrowLeft':
      case 'Escape': {
        event.preventDefault();
        const index = this.#menus.indexOf(menu);
        if (index > 0) {
          const parentButton = menu.__parentButton;
          this.#closeFrom(index);
          parentButton?.focus();
        } else {
          this.#close();
        }
        break;
      }
      case 'Tab':
        this.#close();
        break;
    }
  };

  #onOutside = (event: Event): void => {
    if (this.#menus.length && !this.#menus.some((m) => event.composedPath().includes(m))) {
      this.#close();
    }
  };

  #run(item: ContextMenuItem<T>): void {
    if (item.disabled) return;
    const target = this.#target;
    this.#close();
    if (target) item.run?.(target);
  }

  /** Tear down menus from `index` (inclusive) to the top of the stack. */
  #closeFrom(index: number): void {
    while (this.#menus.length > index) {
      const menu = this.#menus.pop()!;
      menu.removeEventListener('keydown', this.#onMenuKeydown);
      render(html``, menu);
      menu.remove();
    }
  }

  #close = (): void => {
    if (this.#menus.length) {
      this.#closeFrom(0);
      document.removeEventListener('pointerdown', this.#onOutside, true);
    }
    this.#target = null;
  };
}

/** Feature module registered on the enterprise grid. */
export const contextMenuModule: GridFeatureModule = {
  id: CONTEXT_MENU_MODULE_ID,
  create: (host) => new ContextMenuController(host),
};
