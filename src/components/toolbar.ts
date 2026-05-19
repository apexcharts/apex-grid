import { consume } from '@lit/context';
import { IgcIconComponent, IgcInputComponent } from 'igniteui-webcomponents';
import { html, LitElement } from 'lit';
import { property, query } from 'lit/decorators.js';
import { gridStateContext, type StateController } from '../controllers/state.js';
import { registerComponent } from '../internal/register.js';
import { GRID_TOOLBAR_TAG } from '../internal/tags.js';
import { styles } from '../styles/toolbar/toolbar.css.js';

/**
 * Toolbar shown above the grid's header row. Hosts the quick-filter (global search) input.
 *
 * @element apex-grid-toolbar
 *
 * @csspart toolbar - The toolbar's container element.
 * @csspart toolbar-search - The quick-filter input wrapper.
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
    registerComponent(ApexGridToolbar, IgcIconComponent, IgcInputComponent);
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

  @query(IgcInputComponent.tagName)
  protected input!: IgcInputComponent;

  #debounceHandle: ReturnType<typeof setTimeout> | null = null;

  public override disconnectedCallback(): void {
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

  #handleInput = (event: CustomEvent<string>) => {
    event.stopPropagation();
    const next = event.detail ?? '';
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

  protected override render() {
    return html`
      <div part="toolbar" role="toolbar" aria-label="Grid toolbar">
        <div part="toolbar-search">
          <igc-input
            outlined
            type="search"
            role="searchbox"
            aria-label=${this.placeholder}
            placeholder=${this.placeholder}
            .value=${this.value}
            @igcInput=${this.#handleInput}
            @keydown=${this.#handleKeydown}
          >
            <igc-icon
              slot="prefix"
              name="search"
              collection="internal"
              aria-hidden="true"
            ></igc-icon>
          </igc-input>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [ApexGridToolbar.tagName]: ApexGridToolbar<object>;
  }
}
