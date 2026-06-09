import { consume } from '@lit/context';
import { html, LitElement, nothing } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { gridStateContext, type StateController } from '../controllers/state.js';
import { renderIcon } from '../internal/icons.js';
import { registerComponent } from '../internal/register.js';
import { GRID_TOOLBAR_TAG } from '../internal/tags.js';
import { styles } from '../styles/toolbar/toolbar.css.js';

/**
 * Toolbar shown above the grid's header row. Hosts opt-in toolbar features
 * such as the quick-filter (global search) input and the export menu.
 *
 * @element apex-grid-toolbar
 *
 * @csspart toolbar - The toolbar's container element.
 * @csspart toolbar-search - The quick-filter input wrapper.
 * @csspart search-field - The bordered field containing the icon + input.
 * @csspart search-icon - The leading search icon.
 * @csspart search-input - The text input itself.
 * @csspart toolbar-actions - The trailing actions area (right side).
 * @csspart export-trigger - The export menu trigger button.
 * @csspart export-menu - The dropdown menu containing export options.
 * @csspart export-menu-item - A single menu item inside the export dropdown.
 */
export default class ApexGridToolbar<T extends object> extends LitElement {
  public static get tagName() {
    return GRID_TOOLBAR_TAG;
  }

  public static override styles = styles;

  /**
   * Registers the `<apex-grid-toolbar>` element. Idempotent.
   */
  public static register() {
    registerComponent(ApexGridToolbar);
  }

  @consume({ context: gridStateContext, subscribe: true })
  @property({ attribute: false })
  public state!: StateController<T>;

  /**
   * The current quick-filter value, mirrored from {@link ApexGrid.quickFilter}.
   */
  @property({ type: String })
  public value = '';

  /**
   * The placeholder rendered in the search input.
   */
  @property({ type: String })
  public placeholder = 'Search…';

  /**
   * Debounce window (ms) before {@link ApexGrid.quickFilter} updates.
   */
  @property({ type: Number, attribute: 'debounce' })
  public debounce = 200;

  /** Whether to render the quick-filter input. Driven by the parent grid. */
  @property({ attribute: false, type: Boolean })
  public showQuickFilter = true;

  /** Whether to render the export menu trigger. Driven by the parent grid. */
  @property({ attribute: false, type: Boolean })
  public showExport = false;

  /** Optional override filename (without extension) for exports. */
  @property({ attribute: false, type: String })
  public exportFilename = 'data';

  @query('input')
  protected input!: HTMLInputElement;

  @query('[part="export-trigger"]')
  protected exportTrigger!: HTMLButtonElement;

  @query('[part="export-menu"]')
  protected exportMenuEl!: HTMLElement;

  @state()
  protected exportMenuOpen = false;

  #debounceHandle: ReturnType<typeof setTimeout> | null = null;

  public override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('pointerdown', this.#handleOutsidePointer, true);
    document.addEventListener('keydown', this.#handleDocumentKey, true);
  }

  public override disconnectedCallback(): void {
    document.removeEventListener('pointerdown', this.#handleOutsidePointer, true);
    document.removeEventListener('keydown', this.#handleDocumentKey, true);
    if (this.#debounceHandle) {
      clearTimeout(this.#debounceHandle);
      this.#debounceHandle = null;
    }
    super.disconnectedCallback();
  }

  #emit(value: string) {
    this.dispatchEvent(
      new CustomEvent<string>('apex-quick-filter', {
        detail: value,
        bubbles: true,
        composed: true,
      })
    );
  }

  #handleInput = (event: Event) => {
    event.stopPropagation();
    const next = (event.target as HTMLInputElement).value ?? '';
    if (this.#debounceHandle) clearTimeout(this.#debounceHandle);

    if (this.debounce <= 0) {
      this.#emit(next);
      return;
    }

    this.#debounceHandle = setTimeout(() => {
      this.#debounceHandle = null;
      this.#emit(next);
    }, this.debounce);
  };

  #handleKeydown = (event: KeyboardEvent) => {
    // Don't let arrow keys bubble into the grid navigation controller.
    event.stopPropagation();
    if (event.key === 'Escape' && this.input.value) {
      event.preventDefault();
      this.input.value = '';
      if (this.#debounceHandle) {
        clearTimeout(this.#debounceHandle);
        this.#debounceHandle = null;
      }
      this.#emit('');
    }
  };

  #toggleExportMenu = (event?: Event) => {
    event?.stopPropagation();
    this.exportMenuOpen = !this.exportMenuOpen;
  };

  #closeExportMenu(returnFocus = false) {
    if (!this.exportMenuOpen) return;
    this.exportMenuOpen = false;
    if (returnFocus) {
      // Return focus to the trigger so keyboard users don't lose their place.
      requestAnimationFrame(() => this.exportTrigger?.focus());
    }
  }

  #handleOutsidePointer = (event: PointerEvent) => {
    if (!this.exportMenuOpen) return;
    const path = event.composedPath();
    if (path.includes(this.exportTrigger) || path.includes(this.exportMenuEl)) return;
    this.#closeExportMenu();
  };

  #handleDocumentKey = (event: KeyboardEvent) => {
    if (!this.exportMenuOpen) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.#closeExportMenu(true);
    }
  };

  #handleExport = (formatId: string) => {
    this.#closeExportMenu();
    const grid = this.state?.host;
    if (!grid) return;
    grid.exportAs(formatId, { filename: this.exportFilename });
  };

  /** Lets keyboard users land in the menu when it opens via arrow-down. */
  #handleTriggerKeydown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'Down') {
      event.preventDefault();
      if (!this.exportMenuOpen) this.exportMenuOpen = true;
      requestAnimationFrame(() => {
        const first = this.exportMenuEl?.querySelector<HTMLElement>('[role="menuitem"]');
        first?.focus();
      });
    }
  };

  #handleMenuKeydown = (event: KeyboardEvent) => {
    const items = Array.from(
      this.exportMenuEl?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
    );
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown' || event.key === 'Down') {
      event.preventDefault();
      items[(current + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp' || event.key === 'Up') {
      event.preventDefault();
      items[(current - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      // Tab closes the menu so focus moves naturally to the next focusable.
      this.#closeExportMenu();
    }
  };

  protected renderQuickFilter() {
    if (!this.showQuickFilter) return nothing;
    return html`<div part="toolbar-search">
      <label part="search-field">
        ${renderIcon('search', { part: 'search-icon' })}
        <input
          part="search-input"
          type="search"
          role="searchbox"
          aria-label=${this.placeholder}
          placeholder=${this.placeholder}
          .value=${this.value}
          @input=${this.#handleInput}
          @keydown=${this.#handleKeydown}
        />
      </label>
    </div>`;
  }

  protected renderExportMenu() {
    if (!this.showExport) return nothing;
    const open = this.exportMenuOpen;
    return html`<div part="export">
      <button
        type="button"
        part="export-trigger"
        aria-label="Export"
        aria-haspopup="menu"
        aria-expanded=${open ? 'true' : 'false'}
        @click=${this.#toggleExportMenu}
        @keydown=${this.#handleTriggerKeydown}
      >
        ${renderIcon('download', { part: 'export-icon' })}
        ${renderIcon('chevron-down', { part: 'export-caret' })}
      </button>
      <ul
        part="export-menu"
        role="menu"
        aria-label="Export options"
        ?hidden=${!open}
        @keydown=${this.#handleMenuKeydown}
      >
        ${(this.state?.host?.exportFormats ?? []).map(
          (format) => html`<li role="none">
            <button
              type="button"
              role="menuitem"
              part="export-menu-item"
              tabindex="-1"
              @click=${() => this.#handleExport(format.id)}
            >
              ${format.label}
            </button>
          </li>`
        )}
      </ul>
    </div>`;
  }

  protected override render() {
    return html`
      <div part="toolbar" role="toolbar" aria-label="Grid toolbar">
        ${this.renderQuickFilter()}
        <div part="toolbar-actions">${this.renderExportMenu()}</div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [ApexGridToolbar.tagName]: ApexGridToolbar<object>;
  }
}
