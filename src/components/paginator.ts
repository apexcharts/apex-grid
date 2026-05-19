import { consume } from '@lit/context';
import { IgcIconComponent } from 'igniteui-webcomponents';
import { html, LitElement, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { gridStateContext, type StateController } from '../controllers/state.js';
import { registerComponent } from '../internal/register.js';
import { GRID_PAGINATOR_TAG } from '../internal/tags.js';
import { styles } from '../styles/paginator/paginator.css.js';

/**
 * Pagination toolbar rendered beneath the grid body.
 *
 * @remarks
 * Drives {@link PaginationController} on the host grid. The component is purely
 * presentational — page transitions go through the controller so they emit the
 * cancellable `pageChanging` event and the post-update `pageChanged` event.
 *
 * @element apex-grid-paginator
 *
 * @csspart paginator - The root container.
 * @csspart paginator-size - The page-size selector wrapper.
 * @csspart paginator-info - The "1–25 of 100" status label.
 * @csspart paginator-controls - The first/prev/next/last button cluster.
 * @csspart paginator-page - The "Page X of N" status label.
 */
export default class ApexGridPaginator<T extends object> extends LitElement {
  public static get tagName() {
    return GRID_PAGINATOR_TAG;
  }

  public static override styles = styles;

  /**
   * Registers the `<apex-grid-paginator>` element and its dependencies. Idempotent.
   */
  public static register() {
    registerComponent(ApexGridPaginator, IgcIconComponent);
  }

  @consume({ context: gridStateContext, subscribe: true })
  @property({ attribute: false })
  public state!: StateController<T>;

  /**
   * The page-size choices rendered in the rows-per-page selector.
   *
   * @remarks
   * Defaults to `[10, 25, 50, 100]`.
   */
  @property({ attribute: false })
  public pageSizeOptions: number[] = [10, 25, 50, 100];

  /**
   * Accessible label for the rows-per-page selector.
   */
  @property({ type: String, attribute: 'page-size-label' })
  public pageSizeLabel = 'Rows per page';

  protected get controller() {
    return this.state.pagination;
  }

  #handleSizeChange = (event: Event) => {
    event.stopPropagation();
    const next = Number((event.target as HTMLSelectElement).value);
    if (Number.isFinite(next)) {
      this.controller.setPageSize(next);
    }
  };

  protected renderSizeSelect() {
    const current = this.controller.pageSize;
    return html`
      <label part="paginator-size">
        <span class="visually-hidden">${this.pageSizeLabel}</span>
        <select
          aria-label=${this.pageSizeLabel}
          .value=${String(current)}
          @change=${this.#handleSizeChange}
        >
          ${this.pageSizeOptions.map(
            (size) =>
              html`<option .value=${String(size)} ?selected=${size === current}>${size}</option>`
          )}
        </select>
      </label>
    `;
  }

  protected renderInfo() {
    const { page, pageSize, totalItems } = this.controller.state;
    if (totalItems === 0) {
      return html`<span part="paginator-info" aria-live="polite">0 of 0</span>`;
    }
    const start = page * pageSize + 1;
    const end = Math.min(totalItems, (page + 1) * pageSize);
    return html`<span part="paginator-info" aria-live="polite">${start}–${end} of ${totalItems}</span>`;
  }

  protected renderButton(opts: {
    id: string;
    icon: string;
    label: string;
    disabled: boolean;
    onClick: () => void;
  }) {
    return html`<button
      part="paginator-button"
      id=${opts.id}
      type="button"
      aria-label=${opts.label}
      title=${opts.label}
      ?disabled=${opts.disabled}
      @click=${opts.onClick}
    >
      <igc-icon name=${opts.icon} collection="internal" aria-hidden="true"></igc-icon>
    </button>`;
  }

  #handleControlsKeydown = (event: KeyboardEvent) => {
    // Keep arrow-key navigation inside the paginator instead of bubbling into the grid.
    if (
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight' ||
      event.key === 'ArrowUp' ||
      event.key === 'ArrowDown'
    ) {
      event.stopPropagation();
    }
  };

  protected renderControls() {
    const { page, pageCount, totalItems } = this.controller.state;
    const onFirst = page <= 0 || totalItems === 0;
    const onLast = page >= pageCount - 1 || totalItems === 0;

    return html`
      <div
        part="paginator-controls"
        role="group"
        aria-label="Pagination controls"
        @keydown=${this.#handleControlsKeydown}
      >
        ${this.renderButton({
          id: 'first',
          icon: 'page-first',
          label: 'Go to first page',
          disabled: onFirst,
          onClick: () => this.controller.firstPage(),
        })}
        ${this.renderButton({
          id: 'previous',
          icon: 'page-previous',
          label: 'Go to previous page',
          disabled: onFirst,
          onClick: () => this.controller.previousPage(),
        })}
        <span part="paginator-page" aria-live="polite">${page + 1} / ${pageCount}</span>
        ${this.renderButton({
          id: 'next',
          icon: 'page-next',
          label: 'Go to next page',
          disabled: onLast,
          onClick: () => this.controller.nextPage(),
        })}
        ${this.renderButton({
          id: 'last',
          icon: 'page-last',
          label: 'Go to last page',
          disabled: onLast,
          onClick: () => this.controller.lastPage(),
        })}
      </div>
    `;
  }

  protected override render() {
    if (!this.state) return nothing;
    return html`
      <div part="paginator" role="navigation" aria-label="Grid pagination">
        ${this.renderSizeSelect()} ${this.renderInfo()} ${this.renderControls()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [ApexGridPaginator.tagName]: ApexGridPaginator<object>;
  }
}
