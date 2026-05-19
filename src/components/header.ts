import { consume } from '@lit/context';
import { html, LitElement, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { gridStateContext, type StateController } from '../controllers/state.js';
import {
  MIN_COL_RESIZE_WIDTH,
  SORT_ICON_ASCENDING,
  SORT_ICON_DESCENDING,
} from '../internal/constants.js';
import { renderIcon } from '../internal/icons.js';
import { partNameMap } from '../internal/part-map.js';
import { registerComponent } from '../internal/register.js';
import { GRID_HEADER_TAG } from '../internal/tags.js';
import type { ApexHeaderContext, ColumnConfiguration } from '../internal/types.js';
import { styles } from '../styles/header-cell/header-cell.css.js';

export default class ApexGridHeader<T extends object> extends LitElement {
  public static get tagName() {
    return GRID_HEADER_TAG;
  }

  public static override styles = styles;

  public static register(): void {
    registerComponent(ApexGridHeader);
  }

  protected get context(): ApexHeaderContext<T> {
    return {
      parent: this,
      column: this.column,
    };
  }

  protected get isSortable() {
    return Boolean(this.column.sort);
  }

  protected get resizeController() {
    return this.state.resizing;
  }

  protected get reorderController() {
    return this.state.reordering;
  }

  protected get isDraggable() {
    return Boolean(this.state?.reordering?.isDraggable(this.column));
  }

  @consume({ context: gridStateContext, subscribe: true })
  @property({ attribute: false })
  public state!: StateController<T>;

  @property({ attribute: false })
  public column!: ColumnConfiguration<T>;

  #addResizeEventHandlers() {
    const config: AddEventListenerOptions = { once: true };

    this.addEventListener(
      'gotpointercapture',
      () => {
        this.resizeController.indicatorActive = true;
      },
      config
    );
    this.addEventListener('lostpointercapture', this.#handlePointerLost, config);
    this.addEventListener('pointerup', (e) => this.releasePointerCapture(e.pointerId), config);
    this.addEventListener('pointermove', this.#handleResize);
  }

  #handleClick(e: Event) {
    e.stopPropagation();
    this.state.sorting.sortFromHeaderClick(this.column);
  }

  #handleResize = ({ clientX }: PointerEvent) => {
    const { left } = this.getBoundingClientRect();
    const width = Math.max(clientX - left, MIN_COL_RESIZE_WIDTH);
    const x = this.offsetLeft + width;

    this.resizeController.resize(this.column, width, x);
  };

  #handleResizeStart(ev: PointerEvent) {
    const { target, pointerId } = ev;

    ev.preventDefault();

    this.#addResizeEventHandlers();
    this.resizeController.start(this);

    (target as HTMLElement).setPointerCapture(pointerId);
  }

  #handlePointerLost = () => {
    this.resizeController.indicatorActive = false;
    this.removeEventListener('pointermove', this.#handleResize);
    this.resizeController.stop();
  };

  #handleAutosize = () => this.resizeController.autosize(this.column, this);

  #handleDragStart = (event: DragEvent) => {
    if (!this.isDraggable) {
      event.preventDefault();
      return;
    }
    this.setAttribute('data-dragging', '');
    event.dataTransfer?.setData('text/plain', String(this.column.key));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
    this.reorderController.start(this.column.key);
  };

  #handleDragEnd = () => {
    this.removeAttribute('data-dragging');
    this.reorderController.end();
  };

  #handleDragOver = (event: DragEvent) => {
    const state = this.reorderController.state;
    if (!state) return;
    const source = this.state.host.getColumn(state.sourceKey);
    if (!source || !this.reorderController.canDrop(source, this.column)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.reorderController.over(this.column, event.clientX, this.getBoundingClientRect());
  };

  #handleDragLeave = () => {
    this.reorderController.clearTarget();
  };

  #handleDrop = (event: DragEvent) => {
    if (!this.reorderController.state) return;
    event.preventDefault();
    this.reorderController.drop();
  };

  protected override updated() {
    // Sync the HTMLElement.draggable attribute every update so we react to
    // both the grid-level `columnReordering` flag arriving via context AND
    // per-column `reorderable: false` opt-outs at runtime.
    const next = this.isDraggable;
    if (this.draggable !== next) {
      this.draggable = next;
    }
  }

  public override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('dragstart', this.#handleDragStart);
    this.addEventListener('dragend', this.#handleDragEnd);
    this.addEventListener('dragover', this.#handleDragOver);
    this.addEventListener('dragleave', this.#handleDragLeave);
    this.addEventListener('drop', this.#handleDrop);
  }

  public override disconnectedCallback(): void {
    this.removeEventListener('dragstart', this.#handleDragStart);
    this.removeEventListener('dragend', this.#handleDragEnd);
    this.removeEventListener('dragover', this.#handleDragOver);
    this.removeEventListener('dragleave', this.#handleDragLeave);
    this.removeEventListener('drop', this.#handleDrop);
    super.disconnectedCallback();
  }

  protected renderSortPart() {
    const state = this.state.sorting.state.get(this.column.key);
    const idx = Array.from(this.state.sorting.state.values()).indexOf(state!);
    const attr = this.state.host.sortConfiguration.multiple
      ? idx > -1
        ? idx + 1
        : nothing
      : nothing;
    const icon = state
      ? state.direction === 'ascending'
        ? SORT_ICON_ASCENDING
        : SORT_ICON_DESCENDING
      : SORT_ICON_ASCENDING;

    return state || this.isSortable
      ? html`<span
          part=${partNameMap({ action: true, sorted: !!state?.direction })}
          draggable="false"
          data-sort-index=${attr === nothing ? '' : (attr as number)}
          @click=${this.isSortable ? this.#handleClick : nothing}
        >
          ${renderIcon(icon, {
            part: partNameMap({ 'sorting-action': !!state }),
          })}
        </span>`
      : nothing;
  }

  protected renderContentPart() {
    const defaultContent = this.column.headerText ?? this.column.key;
    const template = this.column.headerTemplate;

    return html`
      <span part="title">
        <span>${template ? template(this.context) : html`${defaultContent}`}</span>
      </span>
    `;
  }

  protected renderResizePart() {
    return this.column.resizable
      ? html`<span
          part="resizable"
          draggable="false"
          @dblclick=${this.#handleAutosize}
          @pointerdown=${this.#handleResizeStart}
        ></span>`
      : nothing;
  }

  protected override render() {
    return html`
      <div
        part=${partNameMap({
          content: true,
          sortable: this.isSortable,
          resizing: this.resizeController.indicatorActive,
        })}
      >
        ${this.renderContentPart()}
        <div part="actions">${this.renderSortPart()}</div>
      </div>
      ${this.renderResizePart()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [ApexGridHeader.tagName]: ApexGridHeader<object>;
  }
}
