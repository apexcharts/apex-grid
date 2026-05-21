import { consume } from '@lit/context';
import { html, LitElement, nothing } from 'lit';
import { property, queryAll } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { gridStateContext, type StateController } from '../controllers/state.js';
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

  /** The column key currently being edited in this row, or `null`. */
  @property({ attribute: false })
  public editingKey: Keys<T> | null = null;

  public override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('exportparts', 'cell');
    this.setAttribute('role', 'row');
  }

  /**
   * The number of "chrome" rows (header + filter) above the body. Used to
   * derive `aria-rowindex` from {@link index}. Set by the parent grid.
   */
  @property({ attribute: false, type: Number })
  public ariaRowOffset = 1;

  protected override willUpdate() {
    this.selected = Boolean(this.state?.selection.isSelected(this.data));
    this.expanded = Boolean(this.state?.expansion.isExpanded(this.data));
    this.setAttribute('aria-rowindex', String(this.index + this.ariaRowOffset + 1));
    if (this.state?.selection.enabled) {
      this.setAttribute('aria-selected', this.selected ? 'true' : 'false');
    } else {
      this.removeAttribute('aria-selected');
    }
    if (this.state?.expansion.enabled) {
      this.setAttribute('aria-expanded', this.expanded ? 'true' : 'false');
    } else {
      this.removeAttribute('aria-expanded');
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
