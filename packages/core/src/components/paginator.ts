import { consume } from '@lit/context';
import { html, LitElement, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { DEFAULT_PAGINATION } from '../controllers/pagination.js';
import { gridStateContext, type StateController } from '../controllers/state.js';
import { renderIcon } from '../internal/icons.js';
import { registerComponent } from '../internal/register.js';
import { GRID_PAGINATOR_TAG } from '../internal/tags.js';
import { styles } from '../styles/paginator/paginator.css.js';

/**
 * Pagination toolbar rendered beneath the grid body.
 *
 * @remarks
 * Drives {@link PaginationController} on the host grid. The component is purely
 * presentational: page transitions go through the controller so they emit the
 * cancellable `pageChanging` event and the post-update `pageChanged` event.
 *
 * It never clips its controls: when the bar is too narrow it drops the page
 * size selector first, then the first and last buttons, so previous and next
 * stay reachable. `pagination.paginator: 'compact'` always uses that narrow
 * layout. The grid re-exports every part, so `apex-grid::part(name)` styles it.
 *
 * @element apex-grid-paginator
 *
 * @csspart paginator - The root container.
 * @csspart paginator-size - The page-size selector wrapper.
 * @csspart paginator-info - The "1-25 of 100" status label.
 * @csspart paginator-controls - The first/prev/next/last button cluster.
 * @csspart paginator-page - The "page / count" status label.
 * @csspart paginator-button - Each of the first, previous, next and last buttons.
 * @csspart paginator-first - The first page button (also `paginator-button`).
 * @csspart paginator-prev - The previous page button (also `paginator-button`).
 * @csspart paginator-next - The next page button (also `paginator-button`).
 * @csspart paginator-last - The last page button (also `paginator-button`).
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
    registerComponent(ApexGridPaginator);
  }

  @consume({ context: gridStateContext, subscribe: true })
  @property({ attribute: false })
  public state!: StateController<T>;

  /**
   * The page-size choices rendered in the rows-per-page selector.
   *
   * @remarks
   * Defaults to `[10, 25, 50, 100]`, also when empty. A current page size missing
   * from the list is listed too, so the selector always shows the size in force.
   */
  @property({ attribute: false })
  public pageSizeOptions: readonly number[] = DEFAULT_PAGINATION.pageSizeOptions;

  /**
   * Accessible label for the rows-per-page selector.
   *
   * @remarks
   * When unset, falls back to the grid's localized `pagination.rowsPerPage`
   * text (see {@link ApexGrid.localeText}).
   */
  @property({ type: String, attribute: 'page-size-label' })
  public pageSizeLabel?: string;

  #resizeObserver?: ResizeObserver;

  public override connectedCallback(): void {
    super.connectedCallback();
    this.#resizeObserver ??= new ResizeObserver(() => this.#fit());
    this.#resizeObserver.observe(this);
  }

  public override disconnectedCallback(): void {
    this.#resizeObserver?.disconnect();
    super.disconnectedCallback();
  }

  protected override updated(): void {
    // Selected here, after the options rendered, so a size just added to the
    // list is found and a refused pick is undone.
    const select = this.renderRoot.querySelector('select');
    if (select) select.value = String(this.controller.pageSize);
    // The grid re-renders the paginator on each of its updates: measure only
    // when the text or the layout option changed (the observer covers resizes).
    const bar = this.renderRoot.querySelector('[part=paginator]');
    const key = `${this.state?.host.pagination?.paginator}|${bar?.textContent}`;
    if (key !== this.#fitKey) {
      this.#fitKey = key;
      this.#fit();
    }
  }

  #fitKey = '';

  /**
   * Drops what the bar has no room for, least needed first: the page size
   * selector (step 1), then the first and last buttons (step 2, the compact
   * layout, where the summary may also shorten), so previous and next always
   * stay reachable. The steps are CSS rules keyed on `data-fit`. Hiding them
   * does not change the bar's height, so the resize observer does not loop.
   */
  #fit(): void {
    const bar = this.renderRoot.querySelector<HTMLElement>('[part=paginator]');
    let step = this.state?.host.pagination?.paginator === 'compact' ? 2 : 0;
    while (bar) {
      // Written only on a change, so a render that keeps the layout restyles nothing.
      if (bar.dataset.fit !== `${step}`) bar.dataset.fit = `${step}`;
      if (step > 1 || bar.scrollWidth <= bar.clientWidth) break;
      step++;
    }
  }

  protected get controller() {
    return this.state.pagination;
  }

  protected get sizeLabel() {
    return this.pageSizeLabel ?? this.state.localize('pagination.rowsPerPage');
  }

  #handleSizeChange = (event: Event) => {
    event.stopPropagation();
    const next = Number((event.target as HTMLSelectElement).value);
    if (Number.isFinite(next)) {
      this.controller.setPageSize(next);
    }
    // A cancelled change leaves the page size as it was: render again so the
    // selector shows the size in force (see updated), not the refused one.
    this.requestUpdate();
  };

  protected renderSizeSelect() {
    const current = this.controller.pageSize;
    const listed = this.pageSizeOptions.length
      ? this.pageSizeOptions
      : DEFAULT_PAGINATION.pageSizeOptions;
    const options = [...listed];
    if (!listed.includes(current)) {
      // Before the first larger size: an ascending list stays ascending and a
      // custom order is kept.
      const at = listed.findIndex((size) => size > current);
      options.splice(at < 0 ? options.length : at, 0, current);
    }
    return html`
      <label part="paginator-size">
        <span class="visually-hidden">${this.sizeLabel}</span>
        <select aria-label=${this.sizeLabel} @change=${this.#handleSizeChange}>
          ${options.map((size) => html`<option .value=${String(size)}>${size}</option>`)}
        </select>
      </label>
    `;
  }

  protected renderInfo() {
    // The grid's live region announces a page change; this summary stays quiet
    // so a screen reader hears it once.
    const { page, pageSize, totalItems } = this.controller.state;
    const start = page * pageSize + 1;
    const end = Math.min(totalItems, (page + 1) * pageSize);
    return html`<span part="paginator-info"
      >${
        totalItems
          ? this.state.localize('pagination.summary', { start, end, total: totalItems })
          : this.state.localize('pagination.summaryEmpty')
      }</span
    >`;
  }

  protected renderButton(opts: {
    /** `first`, `prev`, `next` or `last`; also names the button's own part (`paginator-first`). */
    id: string;
    icon: string;
    label: string;
    disabled: boolean;
    onClick: () => void;
  }) {
    return html`<button
      part="paginator-button paginator-${opts.id}"
      id=${opts.id}
      type="button"
      aria-label=${opts.label}
      title=${opts.label}
      ?disabled=${opts.disabled}
      @click=${opts.onClick}
    >
      ${renderIcon(opts.icon)}
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
        aria-label=${this.state.localize('pagination.controls')}
        @keydown=${this.#handleControlsKeydown}
      >
        ${this.renderButton({
          id: 'first',
          icon: 'page-first',
          label: this.state.localize('pagination.firstPage'),
          disabled: onFirst,
          onClick: () => this.controller.firstPage(),
        })}
        ${this.renderButton({
          id: 'prev',
          icon: 'page-previous',
          label: this.state.localize('pagination.previousPage'),
          disabled: onFirst,
          onClick: () => this.controller.previousPage(),
        })}
        <span part="paginator-page">${page + 1} / ${pageCount}</span>
        ${this.renderButton({
          id: 'next',
          icon: 'page-next',
          label: this.state.localize('pagination.nextPage'),
          disabled: onLast,
          onClick: () => this.controller.nextPage(),
        })}
        ${this.renderButton({
          id: 'last',
          icon: 'page-last',
          label: this.state.localize('pagination.lastPage'),
          disabled: onLast,
          onClick: () => this.controller.lastPage(),
        })}
      </div>
    `;
  }

  protected override render() {
    if (!this.state) return nothing;
    return html`
      <div part="paginator" role="navigation" aria-label=${this.state.localize('pagination.label')}>
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
