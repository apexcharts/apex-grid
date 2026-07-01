import { consume } from '@lit/context';
import { html, LitElement, nothing } from 'lit';
import { property, queryAll } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { RowGhostInit } from '../controllers/row-reorder.js';
import { gridStateContext, type StateController } from '../controllers/state.js';
import type { PresentedRow } from '../internal/feature-module.js';
import { registerComponent } from '../internal/register.js';
import { GRID_ROW_TAG } from '../internal/tags.js';
import type { ActiveNode, ColumnConfiguration, Keys } from '../internal/types.js';
import { getPinEdge } from '../internal/utils.js';
import { styles } from '../styles/body-row/body-row.css.js';
import ApexGridCell from './cell.js';

/** The six-dot grip drawn inside the row-reorder drag handle. */
const GRIP_ICON = html`<svg
  part="reorder-grip"
  viewBox="0 0 16 16"
  width="16"
  height="16"
  aria-hidden="true"
>
  <circle cx="6" cy="3.5" r="1.25" />
  <circle cx="10" cy="3.5" r="1.25" />
  <circle cx="6" cy="8" r="1.25" />
  <circle cx="10" cy="8" r="1.25" />
  <circle cx="6" cy="12.5" r="1.25" />
  <circle cx="10" cy="12.5" r="1.25" />
</svg>`;

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

  /** Reveal the spreadsheet row-number gutter cell (transient formula coordinate hint). */
  @property({ type: Boolean })
  public coordinateHints = false;

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

  #dragStartX = 0;
  #dragStartY = 0;

  /**
   * Arms a row drag. In handle mode only the grip starts one; in whole-row mode
   * a press anywhere except an interactive sub-part does. The move / up plumbing
   * lives on the grid host (see {@link RowReorderController.armPointerDrag}), so
   * a live-swap that recycles this row's DOM can't break the gesture.
   */
  #handleReorderPointerDown = (event: PointerEvent) => {
    const reorder = this.state?.rowReorder;
    if (!reorder?.enabled || event.button !== 0 || !this.data) return;
    // Pinned rows are not reorder sources (F4 scope).
    if (this.state.rowPin.isPinned(this.data)) return;

    const path = event.composedPath();
    const onHandle = path.some(
      (node) =>
        node instanceof Element && (node.getAttribute?.('part') ?? '').includes('reorder-handle')
    );

    if (reorder.handleMode) {
      // Handle mode: only the grip starts a drag. The rest of the row stays free
      // for selection / editing / text selection.
      if (!onHandle) return;
      // Own the gesture: keep the grid's body handler from treating the press as
      // a cell interaction, and suppress native text/element drag-selection.
      event.preventDefault();
      event.stopPropagation();
    } else {
      // Whole-row mode: a drag begins anywhere except an interactive sub-part
      // (editor, checkbox, button).
      const target = path[0];
      if (
        target instanceof Element &&
        target.closest?.('input, button, a, select, textarea, [data-apex-editor]')
      ) {
        return;
      }
    }

    this.#dragStartX = event.clientX;
    this.#dragStartY = event.clientY;
    // The controller snapshots the ghost the instant the drag engages (the row
    // is still in place then), seeded from the original press point.
    reorder.armPointerDrag(
      this.data,
      () => this.#captureGhost(this.#dragStartX, this.#dragStartY),
      event
    );
  };

  /**
   * Snapshots the row's visible cells (text, width, alignment) and bounding rect
   * so the controller can paint a faithful floating ghost. Invoked once, at the
   * moment the drag engages.
   */
  #captureGhost(clientX: number, clientY: number): RowGhostInit {
    const rect = this.getBoundingClientRect();
    const cells = this.cells.map((cell) => {
      const el = cell as unknown as HTMLElement;
      return {
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        width: el.getBoundingClientRect().width,
        align: getComputedStyle(el).textAlign,
      };
    });
    return { rect, clientX, clientY, cells };
  }

  public override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('exportparts', 'cell');
    this.setAttribute('role', 'row');
    this.addEventListener('pointerdown', this.#handleReorderPointerDown);
  }

  public override disconnectedCallback(): void {
    this.removeEventListener('pointerdown', this.#handleReorderPointerDown);
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

  /**
   * Leading row-number gutter cell (transient spreadsheet coordinate hint). Shown
   * only while `coordinateHints` is on; pinned rows render an empty spacer (their
   * band-local index is not a meaningful A1 row number) so the track stays
   * aligned. Presentational: the accessible row index is `aria-rowindex`.
   */
  protected renderRowNumber() {
    if (!this.coordinateHints) return nothing;
    const pinned = Boolean(this.state?.rowPin?.isPinned(this.data));
    return html`<div part="row-number-cell" data-pinned="start" aria-hidden="true">
      ${pinned ? nothing : html`<span part="row-number">${this.index + 1}</span>`}
    </div>`;
  }

  /**
   * Leading drag-handle (grip) cell. Rendered only in handle mode; pinned rows
   * get an empty spacer so the grid track stays aligned. The cell is
   * presentational (`aria-hidden`) — the accessible reorder path is the keyboard
   * grab flow, not this pointer affordance.
   */
  protected renderReorderHandle() {
    const reorder = this.state?.rowReorder;
    if (!reorder?.showHandleColumn) return nothing;
    const draggable = !this.state?.rowPin?.isPinned(this.data);
    return html`<div part="reorder-handle-cell" data-pinned="start" aria-hidden="true">
      ${draggable ? html`<span part="reorder-handle">${GRIP_ICON}</span>` : nothing}
    </div>`;
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
        aria-label=${
          expanded ? this.state.localize('row.collapse') : this.state.localize('row.expand')
        }
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
    return html`<div part="detail-panel" role="region" aria-label=${this.state.localize('row.detail')}>${content}</div>`;
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
        aria-label=${this.state.localize('row.select')}
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
      ${this.renderRowNumber()}
      ${this.renderReorderHandle()}
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
