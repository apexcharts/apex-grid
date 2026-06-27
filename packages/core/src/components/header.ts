import { consume } from '@lit/context';
import { html, LitElement, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { gridStateContext, type StateController } from '../controllers/state.js';
import { MIN_COL_RESIZE_WIDTH } from '../internal/constants.js';
import { renderSortArrows } from '../internal/icons.js';
import { partNameMap } from '../internal/part-map.js';
import { registerComponent } from '../internal/register.js';
import { GRID_HEADER_TAG } from '../internal/tags.js';
import type { ApexHeaderContext, ColumnConfiguration } from '../internal/types.js';
import { styles } from '../styles/header-cell/header-cell.css.js';

/** Pixels of pointer travel before a hold turns into a drag — avoids
 * accidental drags on click. */
const DRAG_THRESHOLD_PX = 4;

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
    // Sort affordances are hidden while a manual row order is active (F5):
    // sorting and manual order are mutually exclusive.
    return Boolean(this.column.sort) && !this.state?.rowReorder?.hasManualOrder;
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

  /** 1-based column index passed in by the parent header row for `aria-colindex`. */
  @property({ attribute: false, type: Number })
  public colindex = 0;

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

  #handleClick(e: MouseEvent) {
    e.stopPropagation();
    // Ctrl/Cmd+click appends to a multi-column sort; a plain click sorts by
    // this column alone. Keyboard activation (Enter/Space) fires a click whose
    // modifier flags mirror the keys held, so Ctrl/Cmd+Enter is additive too.
    this.state.sorting.sortFromHeaderClick(this.column, e.ctrlKey || e.metaKey);
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
    // Resize takes priority over reorder — stop the event so the header's
    // pointerdown listener doesn't also start arming a drag.
    ev.stopPropagation();

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

  // --- Reorder (pointer-driven) ------------------------------------------

  #dragStartX = 0;
  #dragStartY = 0;
  #dragPointerId = -1;
  #isDragging = false;

  #handleReorderPointerDown = (event: PointerEvent) => {
    if (!this.isDraggable) return;
    if (event.button !== 0) return;
    // Skip if the user grabbed an interactive sub-part of the header — the
    // resize handle or the sort/action icons. Those have their own handlers
    // and should not arm a drag.
    const path = event.composedPath();
    const target = path[0];
    if (target instanceof Element && target.closest?.('[part~="resizable"], [part~="action"]')) {
      return;
    }
    this.#dragStartX = event.clientX;
    this.#dragStartY = event.clientY;
    this.#dragPointerId = event.pointerId;
    this.addEventListener('pointermove', this.#handleReorderPointerMove);
    this.addEventListener('pointerup', this.#handleReorderPointerUp);
    this.addEventListener('pointercancel', this.#handleReorderPointerUp);
  };

  #handleReorderPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== this.#dragPointerId) return;
    if (!this.#isDragging) {
      const dx = event.clientX - this.#dragStartX;
      const dy = event.clientY - this.#dragStartY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      // Threshold crossed — start the drag in earnest.
      this.#isDragging = true;
      this.setPointerCapture(event.pointerId);
      this.setAttribute('data-dragging', '');
      const rect = this.getBoundingClientRect();
      const label = this.column.headerText ?? String(this.column.key);
      this.reorderController.start(
        this.column.key,
        rect,
        this.#dragStartX,
        this.#dragStartY,
        label
      );
    }
    this.reorderController.move(event.clientX, event.clientY);
  };

  #handleReorderPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.#dragPointerId) return;
    this.removeEventListener('pointermove', this.#handleReorderPointerMove);
    this.removeEventListener('pointerup', this.#handleReorderPointerUp);
    this.removeEventListener('pointercancel', this.#handleReorderPointerUp);
    try {
      if (this.hasPointerCapture(event.pointerId)) {
        this.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* capture was already released */
    }
    if (this.#isDragging) {
      this.#isDragging = false;
      this.removeAttribute('data-dragging');
      this.reorderController.end();
    }
    this.#dragPointerId = -1;
  };

  protected override updated() {
    // Mirror the column's data type onto the host so the header label can match
    // the body cell alignment by default (numeric/currency cells right-align,
    // so their headers should too). Kept in sync on every update because the
    // column config can change at runtime (reorder, reconfigure).
    this.setAttribute('data-cell-type', this.column.type ?? 'string');
    // Reflect reorderability as an attribute so SCSS can show the grab
    // cursor only on columns that can actually be dragged. Tracks both the
    // grid-level `columnReordering` flag (arriving via context) and the
    // per-column `reorderable: false` opt-out at runtime.
    if (this.isDraggable) {
      this.setAttribute('data-reorderable', '');
    } else {
      this.removeAttribute('data-reorderable');
    }
    // aria-colindex stays in sync with the parent header row's numbering.
    if (this.colindex > 0) {
      this.setAttribute('aria-colindex', String(this.colindex));
    }
    // aria-sort communicates current sort direction for this column to AT.
    if (this.isSortable) {
      const sort = this.state?.sorting.state.get(this.column.key);
      const dir = sort?.direction;
      this.setAttribute(
        'aria-sort',
        dir === 'ascending' ? 'ascending' : dir === 'descending' ? 'descending' : 'none'
      );
    } else {
      this.removeAttribute('aria-sort');
    }
  }

  public override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'columnheader');
    this.addEventListener('pointerdown', this.#handleReorderPointerDown);
  }

  public override disconnectedCallback(): void {
    this.removeEventListener('pointerdown', this.#handleReorderPointerDown);
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
    const direction = state?.direction ?? 'none';

    const label =
      state?.direction === 'ascending'
        ? 'Sorted ascending. Activate to sort descending.'
        : state?.direction === 'descending'
          ? 'Sorted descending. Activate to clear sort.'
          : 'Not sorted. Activate to sort ascending.';

    return state || this.isSortable
      ? this.isSortable
        ? html`<button
            type="button"
            part=${partNameMap({ action: true, sorted: !!state?.direction })}
            data-sort-active=${direction}
            data-sort-index=${attr === nothing ? '' : (attr as number)}
            aria-label=${label}
            @click=${this.#handleClick}
          >
            ${renderSortArrows()}
          </button>`
        : html`<span
            part=${partNameMap({ action: true, sorted: !!state?.direction })}
            data-sort-active=${direction}
            data-sort-index=${attr === nothing ? '' : (attr as number)}
            aria-hidden="true"
          >
            ${renderSortArrows()}
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
