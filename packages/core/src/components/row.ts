import { consume } from '@lit/context';
import { html, LitElement, nothing } from 'lit';
import { property, queryAll } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
import { live } from 'lit/directives/live.js';
import { repeat } from 'lit/directives/repeat.js';
import { captureRowGhost, type RowGhostInit } from '../controllers/row-reorder.js';
import { gridStateContext, type StateController } from '../controllers/state.js';
import type { PresentedRow } from '../internal/feature-module.js';
import { cancelFlips, FLIP_ID_Y, hasFlipsInFlight } from '../internal/flip.js';
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
 * Every part a row renders in its own shadow root. Rows live in the grid's
 * shadow root, so the row's `exportparts` is the whole surface that
 * `apex-grid::part(...)` can reach; a part missing here cannot be styled.
 * `group-row` is the default container part of a module-rendered row.
 */
const ROW_PARTS =
  'cell,row-number-cell,row-number,reorder-handle-cell,reorder-handle,reorder-grip,selection-cell,selection-checkbox,expansion-cell,expansion-toggle,expansion-chevron,detail-panel,group-row';

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

  /**
   * The single focus target of a row a feature module renders full width (a
   * group header, a total row), or `null` for a normal cell-rendered row.
   * Keyboard navigation lands here, whatever the active column, so the body
   * keeps a tab stop on rows that render no cells.
   */
  public get presentedCell(): HTMLElement | null {
    return this.#presented
      ? this.renderRoot.querySelector<HTMLElement>('[data-presented-cell]')
      : null;
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
   * Reactive token from {@link StateController.dataVersion}, forwarded to each
   * cell so a pipeline run (edit, data change, tree toggle) refreshes the row's
   * ARIA and the cells that read their row. Stays `0` for pinned rows.
   */
  @property({ attribute: false })
  public dataVersion = 0;

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

    // The controller snapshots the ghost the instant the drag engages, seeded
    // from the original press point, from whichever row renders the pressed
    // record then. This row may show another record by that time (a re-bind),
    // so its own snapshot declines once it does.
    const data = this.data;
    const { clientX, clientY } = event;
    reorder.armPointerDrag(
      data,
      () => (this.data === data ? this.#captureGhost(clientX, clientY) : null),
      event
    );
  };

  /**
   * Snapshots the row's visible cells (text, width, alignment) and bounding rect
   * so the controller can paint a faithful floating ghost.
   */
  #captureGhost(clientX: number, clientY: number): RowGhostInit {
    return captureRowGhost(this, this.cells as unknown as Element[], clientX, clientY);
  }

  public override connectedCallback(): void {
    super.connectedCallback();
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

  /** The record this element rendered last, to spot a re-bind to another one. */
  #renderedData: T | undefined;

  protected override willUpdate() {
    // A row FLIP moves the record it was started for. Re-bound to another
    // record mid-flight, the element would carry that motion over to the new
    // one, so it stops. Checked only while a FLIP runs: scroll re-binds pay
    // nothing.
    if (this.data !== this.#renderedData) {
      if (this.#renderedData !== undefined && hasFlipsInFlight()) cancelFlips(this, FLIP_ID_Y);
      this.#renderedData = this.data;
    }
    this.setAttribute('aria-rowindex', String(this.index + this.ariaRowOffset + 1));
    // Zebra parity from the row index, not the DOM position (body-row.scss).
    this.toggleAttribute('data-alt', this.index % 2 === 1);

    // Ask feature modules whether this row is rendered full-width (e.g. an
    // enterprise group header). When one owns it, the row is not a selectable
    // data row — it carries its own level/expanded semantics and skips the
    // selection/tree aria below.
    this.#presented = this.state
      ? this.state.presentRow(this.data, { columns: this.columns, rowIndex: this.index })
      : null;
    this.#syncExportParts();
    if (this.#presented) {
      // Data-row state does not apply, and an element re-bound from a data
      // row (a pinned band, a recycled body slot) must not carry it over.
      // `dragging` and `grabbed` are bound by record on every render.
      this.selected = false;
      this.expanded = false;
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

    const selection = this.state?.selection;
    this.selected = Boolean(selection?.isSelected(this.data));
    this.expanded = Boolean(this.state?.expansion.isExpanded(this.data));
    // The grid pattern marks selectable rows with aria-selected; a row that
    // cannot be selected (`isRowSelectable`) omits it rather than claiming
    // an unselected state the user cannot change, unless it is still
    // selected (it can be deselected).
    if (selection?.enabled && (this.selected || selection.isSelectable(this.data))) {
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
      // A module may attach tree/expansion ARIA to a normal cell-rendered row
      // (e.g. pivoting's expandable parent rows, which keep their value cells).
      const aria = this.state?.describeRow(this.data, {
        columns: this.columns,
        rowIndex: this.index,
      });
      if (aria) {
        if (typeof aria.level === 'number') {
          this.setAttribute('aria-level', String(aria.level));
        } else {
          this.removeAttribute('aria-level');
        }
        if (typeof aria.expanded === 'boolean') {
          this.setAttribute('aria-expanded', aria.expanded ? 'true' : 'false');
        } else {
          this.removeAttribute('aria-expanded');
        }
      } else {
        this.removeAttribute('aria-level');
        // Only a row that can open (or is open) is announced as collapsible,
        // and only under the treegrid role: a grid row may not carry
        // aria-expanded, so this follows the same rule as the role.
        if (
          this.state?.hierarchical &&
          (this.expanded || this.state.expansion.canExpand(this.data))
        ) {
          this.setAttribute('aria-expanded', this.expanded ? 'true' : 'false');
        } else {
          this.removeAttribute('aria-expanded');
        }
      }
    }
  }

  /**
   * Re-exports the row's own parts plus the ones a module declares for the
   * content it renders here: a presented row's container part and
   * {@link PresentedRow.exportParts}, or the expansion config's
   * `exportParts` for the detail panel content. Re-run on every update, so a
   * row element the virtualizer reuses for another record drops the parts of
   * the one it showed before.
   */
  #syncExportParts() {
    // Runs on every row update, scroll recycling included, so the common
    // case (no extra parts) builds no arrays.
    const presented = this.#presented;
    const own = presented?.part?.split(' ').join(',');
    const list = presented ? presented.exportParts : this.state?.host.expansion?.exportParts;
    let value = ROW_PARTS;
    if (own) value += `,${own}`;
    if (list?.length) value += `,${list.join(',')}`;
    if (this.getAttribute('exportparts') !== value) {
      this.setAttribute('exportparts', value);
    }
  }

  /**
   * Leading row-number gutter cell (transient spreadsheet coordinate hint). Shown
   * only while `coordinateHints` is on. A feature module that addresses the data
   * (the enterprise formula engine) supplies the label, so it matches what a
   * reference reads; otherwise it is the view position, and pinned rows render
   * an empty spacer (their band-local index is not a meaningful row number) so
   * the track stays aligned. Presentational: the accessible row index is
   * `aria-rowindex`.
   */
  protected renderRowNumber() {
    if (!this.coordinateHints) return nothing;
    let label: string | number | null | undefined = this.state?.rowCoordinate(this.data);
    if (label === undefined) {
      label = this.state?.rowPin?.isPinned(this.data) ? null : this.index + 1;
    }
    return html`<div part="row-number-cell" data-pinned="start" aria-hidden="true">
      ${label === null ? nothing : html`<span part="row-number">${label}</span>`}
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
        aria-expanded=${canExpand ? String(expanded) : nothing}
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
    // A row owns only cells, so the panel is one cell across the whole row.
    // The content is keyed by record: a row element re-bound to another
    // record (a pinned band, a recycled body slot) builds fresh detail DOM
    // rather than showing the previous record's (a typed input, a nested
    // grid's sort). A row that keeps its record keeps its detail DOM.
    const detail = keyed(this.data, content);
    return html`<div
      part="detail-panel"
      role="gridcell"
      aria-colindex="1"
      aria-colspan=${this.state.colCount}
    >
      <div role="region" aria-label=${this.state.localize('row.detail')}>${detail}</div>
    </div>`;
  }

  protected renderSelectionCell(colindex: number) {
    const selection = this.state?.selection;
    if (!selection?.showCheckboxColumn) return nothing;
    // Shift extends a range from the anchor and Ctrl or Cmd toggles one row
    // without moving it (multiple mode only). Shared by the checkbox and the
    // cell around it, so both give the same result for the same gesture.
    // Returns false for a plain click, which the checkbox toggles itself.
    const modifierToggle = (event: MouseEvent): boolean => {
      if (selection.mode !== 'multiple') return false;
      if (event.shiftKey) {
        void selection.rangeToggle(this.data);
      } else if (event.ctrlKey || event.metaKey) {
        void selection.additiveToggle(this.data);
      } else {
        return false;
      }
      return true;
    };
    // The native `change` carries no modifier keys (they ride on the click
    // above), so it covers plain clicks and Space on a focused checkbox. The
    // click has already flipped `checked`; a `rowSelecting` listener that
    // cancels leaves the row as it was without a re-render, so write the
    // real state back once the selection has decided.
    const handleChange = (event: Event) => {
      const input = event.target as HTMLInputElement;
      const cell = input.parentElement;
      const focused =
        this.renderRoot instanceof ShadowRoot && this.renderRoot.activeElement === input;
      // The record clicked, captured before the await: by the time the
      // selection settles this row may show another record, whose state its
      // own render (the live `.checked` binding below) already wrote.
      const record = this.data;
      void selection.toggleRow(record).then(async () => {
        if (this.data === record) input.checked = selection.isSelected(record);
        // A rejected row that was still selected loses its checkbox once
        // deselected. Keep focus in its cell rather than letting it fall to
        // the body, where the grid's keys no longer reach.
        if (!focused || !cell) return;
        await this.updateComplete;
        if (input.isConnected) return;
        cell.tabIndex = -1;
        cell.addEventListener('blur', () => cell.removeAttribute('tabindex'), { once: true });
        cell.focus({ preventScroll: true });
      });
    };
    const handleClick = (event: MouseEvent) => {
      // Keeps checkbox clicks from bubbling to the cell's forwarder below and
      // to app click listeners on the grid (the grid's own body handler runs
      // in the capture phase and ignores this target).
      event.stopPropagation();
      // A modifier click is handled here, so cancel the native toggle.
      if (modifierToggle(event)) event.preventDefault();
    };
    // The checkbox itself is 14x14, well under the 24x24 WCAG 2.2 AA minimum
    // (2.5.8), and growing it would make a chunky box out of a deliberately
    // small mark. Instead the whole cell is the target: a click anywhere in it
    // acts like a click on the checkbox, modifiers included, which is both
    // compliant and what people expect of a selection column. Clicks that land
    // on the checkbox are left alone, or the forward would toggle twice and
    // cancel out.
    const forwardToCheckbox = (event: MouseEvent) => {
      if (event.target instanceof HTMLInputElement || modifierToggle(event)) return;
      (event.currentTarget as HTMLElement)
        .querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.click();
    };
    // A row `isRowSelectable` rejects keeps the cell (the columns stay
    // aligned) but no control, as the controller refuses to select it; a
    // still-selected one keeps its checkbox so it can be deselected. `live`
    // checks against the box itself: a click flips it before the binding
    // knows, so a row re-bound in the same render to a record with the old
    // binding value would otherwise keep the clicked state.
    const checkbox =
      this.selected || selection.isSelectable(this.data)
        ? html`<input
          type="checkbox"
          part="selection-checkbox"
          aria-label=${this.state.localize('row.select')}
          .checked=${live(this.selected)}
          @click=${handleClick}
          @change=${handleChange}
        />`
        : nothing;
    return html`<div
      part="selection-cell"
      role="gridcell"
      aria-colindex=${colindex}
      data-pinned="start"
      @click=${forwardToCheckbox}
    >
      ${checkbox}
    </div>`;
  }

  protected override render() {
    // Full-width module-rendered row (e.g. a group header): render the module's
    // content spanning all columns, like the master-detail panel, and skip the
    // normal selection/expansion/cell grid.
    if (this.#presented) {
      return html`<div
        part=${this.#presented.part ?? 'group-row'}
        role="gridcell"
        aria-colindex="1"
        aria-colspan=${Math.max(1, this.state.colCount)}
        tabindex=${this.activeNode?.row === this.index ? 0 : -1}
        data-presented-cell
        style="grid-column: 1 / -1"
      >
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
            .record=${this.data}
            .value=${this.data[column.key]}
            .colindex=${ariaColindex}
            .rowIndex=${this.index}
            .decorationVersion=${this.decorationVersion}
            .dataVersion=${this.dataVersion}
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
