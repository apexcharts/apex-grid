import { consume } from '@lit/context';
import { html, LitElement, nothing } from 'lit';
import { property, queryAll } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { gridStateContext, type StateController } from '../controllers/state.js';
import type { PresentedRow } from '../internal/feature-module.js';
import { registerComponent } from '../internal/register.js';
import { GRID_ROW_TAG } from '../internal/tags.js';
import type { ActiveNode, ColumnConfiguration, Keys } from '../internal/types.js';
import { getPinEdge } from '../internal/utils.js';
import { styles } from '../styles/body-row/body-row.css.js';
import ApexGridCell from './cell.js';

/**
 * Component representing the DOM row in the Apex grid.
 */
export default class ApexGridRow<T extends object> extends LitElement {
  public static get tagName() {
    return GRID_ROW_TAG;
  }
  public static override styles = styles;

  public static register(): void {
    registerComponent(ApexGridRow, ApexGridCell);
  }

  @queryAll(ApexGridCell.tagName)
  protected _cells!: NodeListOf<ApexGridCell<T>>;

  @property({ attribute: false })
  public data!: T;

  @property({ attribute: false })
  public columns: Array<ColumnConfiguration<T>> = [];

  /** Cumulative pin offsets (px) keyed by column key. */
  @property({ attribute: false })
  public pinOffsets: Map<unknown, number> = new Map();

  public get cells() {
    return Array.from(this._cells);
  }

  @consume({ context: gridStateContext, subscribe: true })
  @property({ attribute: false })
  public state!: StateController<T>;

  @property({ attribute: false })
  public activeNode!: ActiveNode<T>;

  @property({ attribute: false, type: Number })
  public index = -1;

  /** Reflects current selection state so SCSS can highlight the row. */
  @property({ type: Boolean, reflect: true })
  public selected = false;

  /** Reflects current expansion state so SCSS can rotate the chevron. */
  @property({ type: Boolean, reflect: true })
  public expanded = false;

  /** Reflects pointer-drag state (row reorder) so SCSS can dim the source. */
  @property({ type: Boolean, reflect: true })
  public dragging = false;

  /** Reflects keyboard-grab state (row reorder) so SCSS can outline the row. */
  @property({ type: Boolean, reflect: true })
  public grabbed = false;

  /** The column key currently being edited in this row, or `null`. */
  @property({ attribute: false })
  public editingKey: Keys<T> | null = null;

  /**
   * Reactive token from {@link StateController.decorationVersion}, forwarded to
   * each cell so a decoration-only change re-renders the row's cells. Stays `0`
   * for the community grid.
   */
  @property({ attribute: false, type: Number })
  public decorationVersion = 0;

  /**
   * Reactive token from {@link EditingController.validationVersion}, forwarded to
   * each cell so a validation-only change re-renders the row's cells (toggling
   * `aria-invalid` and the inline error node). Stays `0` until the first
   * validation failure.
   */
  @property({ attribute: false, type: Number })
  public validationVersion = 0;

  /**
   * Result of the feature-module row presenter for the current update, or
   * `null` when no module renders this row full-width (the normal case).
   * Computed in {@link willUpdate} and consumed in {@link render}.
   */
  #presented: PresentedRow | null = null;

  /** Pixels the pointer must travel before a row drag engages. */
  static readonly #DRAG_THRESHOLD_PX = 4;

  #dragStartX = 0;
  #dragStartY = 0;
  #dragPointerId = -1;
  #isDragging = false;

  #handleReorderPointerDown = (event: PointerEvent) => {
    const reorder = this.state?.rowReorder;
    if (!reorder?.enabled || event.button !== 0 || !this.data) return;
    // Pinned rows are not reorder sources (F4 scope).
    if (this.state.rowPin.isPinned(this.data)) return;
    // Don't arm a drag from an interactive sub-part (editor, checkbox, button).
    const target = event.composedPath()[0];
    if (
      target instanceof Element &&
      target.closest?.('input, button, a, select, textarea, [data-apex-editor]')
    ) {
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
    const reorder = this.state.rowReorder;
    if (!this.#isDragging) {
      const dx = event.clientX - this.#dragStartX;
      const dy = event.clientY - this.#dragStartY;
      if (Math.hypot(dx, dy) < ApexGridRow.#DRAG_THRESHOLD_PX) return;
      this.#isDragging = true;
      this.setPointerCapture(event.pointerId);
      reorder.startDrag(this.data);
    }
    reorder.dragOver(event.clientY);
  };

  #handleReorderPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.#dragPointerId) return;
    this.removeEventListener('pointermove', this.#handleReorderPointerMove);
    this.removeEventListener('pointerup', this.#handleReorderPointerUp);
    this.removeEventListener('pointercancel', this.#handleReorderPointerUp);
    try {
      if (this.hasPointerCapture(event.pointerId)) this.releasePointerCapture(event.pointerId);
    } catch {
      /* capture was already released */
    }
    if (this.#isDragging) {
      this.#isDragging = false;
      this.state.rowReorder.endDrag();
    }
    this.#dragPointerId = -1;
  };

  public override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('exportparts', 'cell');
    this.setAttribute('role', 'row');
    this.addEventListener('pointerdown', this.#handleReorderPointerDown);
  }

  public override disconnectedCallback(): void {
    this.removeEventListener('pointerdown', this.#handleReorderPointerDown);
    this.removeEventListener('pointermove', this.#handleReorderPointerMove);
    this.removeEventListener('pointerup', this.#handleReorderPointerUp);
    this.removeEventListener('pointercancel', this.#handleReorderPointerUp);
    super.disconnectedCallback();
  }

  /**
   * The number of "chrome" rows (header + filter) above the body. Used to
   * derive `aria-rowindex` from {@link index}. Set by the parent grid.
   */
  @property({ attribute: false, type: Number })
  public ariaRowOffset = 1;

  protected override willUpdate() {
    this.setAttribute('aria-rowindex', String(this.index + this.ariaRowOffset + 1));

    // Ask feature modules whether this row is rendered full-width (e.g. an
    // enterprise group header). When one owns it, the row is not a selectable
    // data row — it carries its own level/expanded semantics and skips the
    // selection/tree aria below.
    this.#presented = this.state
      ? this.state.presentRow(this.data, { columns: this.columns, rowIndex: this.index })
      : null;
    if (this.#presented) {
      this.selected = false;
      this.removeAttribute('aria-selected');
      if (typeof this.#presented.level === 'number') {
        this.setAttribute('aria-level', String(this.#presented.level));
      } else {
        this.removeAttribute('aria-level');
      }
      if (typeof this.#presented.expanded === 'boolean') {
        this.setAttribute('aria-expanded', this.#presented.expanded ? 'true' : 'false');
      } else {
        this.removeAttribute('aria-expanded');
      }
      return;
    }

    this.selected = Boolean(this.state?.selection.isSelected(this.data));
    this.expanded = Boolean(this.state?.expansion.isExpanded(this.data));
    if (this.state?.selection.enabled) {
      this.setAttribute('aria-selected', this.selected ? 'true' : 'false');
    } else {
      this.removeAttribute('aria-selected');
    }

    // Tree mode reports aria-level (1-based depth) and aria-expanded for
    // parent rows; expansion mode shares the same attribute on detail-panel
    // rows. Tree wins when both are enabled since it's the more structural
    // semantic (the row represents a tree node).
    const tree = this.state?.tree;
    const treeMeta = tree?.enabled ? tree.getMeta(this.data) : undefined;
    if (treeMeta) {
      this.setAttribute('aria-level', String(treeMeta.depth + 1));
      if (treeMeta.hasChildren) {
        this.setAttribute('aria-expanded', tree!.isExpanded(this.data) ? 'true' : 'false');
      } else {
        this.removeAttribute('aria-expanded');
      }
    } else {
      this.removeAttribute('aria-level');
      if (this.state?.expansion.enabled) {
        this.setAttribute('aria-expanded', this.expanded ? 'true' : 'false');
      } else {
        this.removeAttribute('aria-expanded');
      }
    }
  }

  protected renderExpansionToggle(colindex: number) {
    const expansion = this.state?.expansion;
    if (!expansion?.showToggleColumn) return nothing;
    const canExpand = expansion.canExpand(this.data) || expansion.isExpanded(this.data);
    const expanded = this.expanded;
    const handleClick = (event: MouseEvent) => {
      event.stopPropagation();
      if (!canExpand) return;
      void expansion.toggleRow(this.data);
    };
    return html`<div
      part="expansion-cell"
      role="gridcell"
      aria-colindex=${colindex}
      data-pinned="start"
    >
      <button
        type="button"
        part="expansion-toggle"
        aria-label=${expanded ? 'Collapse row' : 'Expand row'}
        aria-expanded=${expanded ? 'true' : 'false'}
        ?disabled=${!canExpand}
        @click=${handleClick}
      >
        <svg
          part="expansion-chevron"
          viewBox="0 0 24 24"
          aria-hidden="true"
          width="14"
          height="14"
        >
          <path
            d="M9 6l6 6-6 6"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>`;
  }

  protected renderDetailPanel() {
    const expansion = this.state?.expansion;
    if (!expansion?.isExpanded(this.data)) return nothing;
    const template = this.state.host.expansion?.detailTemplate;
    if (typeof template !== 'function') return nothing;
    const content = template({
      data: this.data,
      rowIndex: this.index,
      parent: this.state.host,
    });
    return html`<div part="detail-panel" role="region" aria-label="Row detail">${content}</div>`;
  }

  protected renderSelectionCell(colindex: number) {
    if (!this.state?.selection.showCheckboxColumn) return nothing;
    const selected = this.selected;
    const handleChange = (event: Event) => {
      const mouseEvent = event as Event & {
        shiftKey?: boolean;
        ctrlKey?: boolean;
        metaKey?: boolean;
      };
      // The native `change` event on a checkbox doesn't expose modifier keys
      // — they're carried on the preceding `click`. We handle Shift/Ctrl in
      // the click listener below; the change handler covers keyboard toggles
      // (Space on a focused checkbox) which always behave as plain toggles.
      void mouseEvent;
      this.state.selection.toggleRow(this.data);
    };
    const handleClick = (event: MouseEvent) => {
      // Prevent the click from bubbling to the grid's body click handler
      // (which would otherwise re-target the active cell to a non-existent
      // selection column).
      event.stopPropagation();
      if (event.shiftKey && this.state.selection.mode === 'multiple') {
        event.preventDefault();
        void this.state.selection.rangeToggle(this.data);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && this.state.selection.mode === 'multiple') {
        event.preventDefault();
        void this.state.selection.additiveToggle(this.data);
        return;
      }
      // Plain click: let the default checkbox toggle proceed; `change` will
      // commit the new state via `toggleRow`.
    };
    return html`<div
      part="selection-cell"
      role="gridcell"
      aria-colindex=${colindex}
      data-pinned="start"
    >
      <input
        type="checkbox"
        part="selection-checkbox"
        aria-label="Select row"
        .checked=${selected}
        @click=${handleClick}
        @change=${handleChange}
      />
    </div>`;
  }

  protected override render() {
    // Full-width module-rendered row (e.g. a group header): render the module's
    // content spanning all columns, like the master-detail panel, and skip the
    // normal selection/expansion/cell grid.
    if (this.#presented) {
      return html`<div part=${this.#presented.part ?? 'group-row'} style="grid-column: 1 / -1">
        ${this.#presented.content}
      </div>`;
    }

    // A row index can transiently fall beyond the current data — e.g. while a
    // server-side / infinite row model resizes `data` on a filter or sort
    // change, the virtualizer may render a stale index for a frame. Render
    // nothing until the real item arrives, rather than dereferencing undefined.
    if (this.data == null) return nothing;

    const { column: key, row: index } = this.activeNode;

    // Track aria-colindex (1-based) across the auto chrome columns and the
    // data columns. Selection comes first, then expansion, then data.
    let colCursor = 0;
    const selectionCol = this.state?.selection.showCheckboxColumn ? ++colCursor : 0;
    const expansionCol = this.state?.expansion.showToggleColumn ? ++colCursor : 0;

    // Keyed by column.key so the same `<apex-grid-cell>` follows its
    // column through a reorder swap — required for the column-reorder FLIP
    // animation in ReorderController to track motion per cell.
    return html`
      ${this.renderSelectionCell(selectionCol)}
      ${this.renderExpansionToggle(expansionCol)}
      ${repeat(
        this.columns,
        (column) => String(column.key),
        (column, colIndex) => {
          if (column.hidden) return nothing;
          const offset = this.pinOffsets.get(column.key);
          const pinStyle =
            column.pinned && typeof offset === 'number' ? `--apex-pin-offset:${offset}px` : '';
          const edge = getPinEdge(this.columns, colIndex);
          const editing = this.editingKey === column.key;
          const ariaColindex = ++colCursor;
          return html`<apex-grid-cell
            part="cell"
            data-pinned=${column.pinned ?? 'none'}
            data-pin-edge=${edge ?? 'none'}
            data-cell-type=${column.type ?? 'string'}
            style=${pinStyle}
            .active=${key === column.key && index === this.index}
            .editing=${editing}
            .column=${column}
            .row=${this as ApexGridRow<T>}
            .value=${this.data[column.key]}
            .colindex=${ariaColindex}
            .decorationVersion=${this.decorationVersion}
            .validationVersion=${this.validationVersion}
          ></apex-grid-cell>`;
        }
      )}
      ${this.renderDetailPanel()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [ApexGridRow.tagName]: ApexGridRow<object>;
  }
}
