import { consume } from '@lit/context';
import { html, LitElement, nothing, type PropertyValueMap } from 'lit';
import { property, queryAll } from 'lit/decorators.js';
import { ref } from 'lit/directives/ref.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import { gridStateContext, type StateController } from '../controllers/state.js';
import { partNameMap } from '../internal/part-map.js';
import { registerComponent } from '../internal/register.js';
import { GRID_HEADER_ROW_TAG } from '../internal/tags.js';
import type { ColumnConfiguration } from '../internal/types.js';
import { columnLetter, getPinEdge } from '../internal/utils.js';
import { styles } from '../styles/header-row/header-row.base.css.js';
import ApexGridHeader from './header.js';

export default class ApexGridHeaderRow<T extends object> extends LitElement {
  public static get tagName() {
    return GRID_HEADER_ROW_TAG;
  }
  public static override styles = styles;

  public static register(): void {
    registerComponent(ApexGridHeaderRow, ApexGridHeader);
  }

  @queryAll(ApexGridHeader.tagName)
  protected _headers!: NodeListOf<ApexGridHeader<T>>;

  @consume({ context: gridStateContext, subscribe: true })
  @property({ attribute: false })
  public state!: StateController<T>;

  @property({ attribute: false })
  public columns: Array<ColumnConfiguration<T>> = [];

  /** Cumulative pin offsets (px) keyed by column key. */
  @property({ attribute: false })
  public pinOffsets: Map<unknown, number> = new Map();

  /** Reveal the spreadsheet coordinates (row-number header spacer + column letters). */
  @property({ attribute: false })
  public coordinateHints = false;

  public get headers() {
    return Array.from(this._headers);
  }

  public override connectedCallback() {
    super.connectedCallback();
    this.setAttribute('tabindex', '0');
    this.setAttribute('role', 'row');
    this.setAttribute('aria-rowindex', '1');
  }

  protected override updated(): void {
    // The column header is row 1, or row 2 when a group header row precedes it.
    const depth = this.state?.host?.columnGroupDepth ?? 0;
    this.setAttribute('aria-rowindex', String(depth + 1));
  }

  protected override shouldUpdate(props: PropertyValueMap<this> | Map<PropertyKey, this>): boolean {
    for (const header of this.headers) {
      header.requestUpdate();
    }

    return super.shouldUpdate(props);
  }

  /**
   * Header cell for the built-in expansion (chevron) column. Renders an
   * "expand all" toggle that expands every row in the current view, or
   * collapses every expanded row when at least one is open.
   */
  protected renderExpansionHeader() {
    const expansion = this.state?.expansion;
    if (!expansion?.showToggleColumn) return nothing;
    const someExpanded = expansion.expanded.size > 0;
    const handleClick = (event: MouseEvent) => {
      event.stopPropagation();
      if (someExpanded) {
        void expansion.collapseAll();
      } else {
        void expansion.expandAll();
      }
    };
    const selection = this.state?.selection;
    const colindex = selection?.showCheckboxColumn ? 2 : 1;
    return html`<div
      part="expansion-header"
      role="columnheader"
      aria-colindex=${colindex}
      data-pinned="start"
    >
      <button
        type="button"
        part="expansion-toggle"
        aria-label=${
          someExpanded
            ? this.state.localize('header.collapseAll')
            : this.state.localize('header.expandAll')
        }
        aria-expanded=${someExpanded ? 'true' : 'false'}
        @click=${handleClick}
      >
        <svg
          part="expansion-chevron"
          viewBox="0 0 24 24"
          aria-hidden="true"
          width="14"
          height="14"
          style=${someExpanded ? 'transform: rotate(90deg)' : ''}
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

  /**
   * Header cell for the built-in selection (checkbox) column. Renders a
   * "select all on this page" checkbox in multi-select mode; nothing in
   * single-select mode (selecting all rows isn't meaningful there).
   */
  /**
   * Corner spacer aligning the header with the body's leading row-number gutter
   * (formula coordinate hints). Shows a small "#" glyph.
   */
  protected renderRowNumberHeader() {
    if (!this.coordinateHints) return nothing;
    return html`<div part="row-number-header" data-pinned="start" aria-hidden="true">#</div>`;
  }

  /**
   * Empty corner spacer aligning the header with the body's leading grip-handle
   * column. Rendered only in row-reorder handle mode.
   */
  protected renderReorderHandleHeader() {
    if (!this.state?.rowReorder?.showHandleColumn) return nothing;
    return html`<div part="reorder-handle-header" data-pinned="start" aria-hidden="true"></div>`;
  }

  protected renderSelectionHeader() {
    const selection = this.state?.selection;
    if (!selection?.showCheckboxColumn) return nothing;
    if (selection.mode === 'single') {
      // Reserve the track so cells below line up — but no select-all
      // affordance in single-row-selection mode.
      return html`<div part="selection-header" data-pinned="start"></div>`;
    }
    const allChecked = selection.allSelected();
    const indeterminate = selection.someSelected();
    const syncIndeterminate = (el: Element | undefined) => {
      if (el instanceof HTMLInputElement) {
        el.indeterminate = indeterminate;
      }
    };
    const handleChange = (event: Event) => {
      const checked = (event.target as HTMLInputElement).checked;
      if (checked) {
        void selection.selectAll();
      } else {
        void selection.clear();
      }
    };
    return html`<div
      part="selection-header"
      role="columnheader"
      aria-colindex="1"
      data-pinned="start"
    >
      <input
        type="checkbox"
        part="selection-checkbox"
        aria-label=${this.state.localize('header.selectAll')}
        .checked=${allChecked}
        ${ref(syncIndeterminate)}
        @change=${handleChange}
      />
    </div>`;
  }

  /**
   * Floating "ghost" element that follows the cursor while a header is
   * being dragged. Positioned via `position: fixed` so it escapes the
   * header row's sticky containing block and follows the viewport.
   */
  protected renderDragGhost() {
    const state = this.state.reordering.state;
    if (!state) return nothing;
    return html`<div
      part="drag-ghost"
      style=${styleMap({
        left: `${state.ghostX}px`,
        top: `${state.ghostY}px`,
        width: `${state.ghostWidth}px`,
        height: `${state.ghostHeight}px`,
      })}
    >
      ${state.label}
    </div>`;
  }

  protected override render() {
    const reorderState = this.state.reordering.state;

    // Track aria-colindex across the auto chrome columns (selection + expansion)
    // and the data columns so the same numbering is consistent across rows.
    let colCursor = 0;
    if (this.state?.selection.showCheckboxColumn) colCursor++;
    if (this.state?.expansion.showToggleColumn) colCursor++;
    // Spreadsheet column letter index: counts only visible data columns (A = the
    // first one), independent of the aria/chrome numbering above.
    let coordCol = 0;

    // Keyed by column.key so the same `<apex-grid-header>` DOM element
    // follows its column across a live reorder swap — critical for pointer
    // capture to stay bound to the dragged column as it moves.
    return html`${this.renderRowNumberHeader()}${this.renderReorderHandleHeader()}${this.renderSelectionHeader()}${this.renderExpansionHeader()}${repeat(
      this.columns,
      (column) => String(column.key),
      (column, index) => {
        if (column.hidden) return nothing;
        const offset = this.pinOffsets.get(column.key);
        const pinStyle =
          column.pinned && typeof offset === 'number' ? `--apex-pin-offset:${offset}px` : '';
        const edge = getPinEdge(this.columns, index);
        const isDragSource = reorderState?.sourceKey === column.key;
        const ariaColindex = ++colCursor;
        const coordinateLetter = this.coordinateHints ? columnLetter(coordCol) : '';
        coordCol += 1;
        return html`<apex-grid-header
          part=${partNameMap({
            filtered: this.state.filtering.state.has(column.key),
            'pinned-start': column.pinned === 'start',
            'pinned-end': column.pinned === 'end',
            dragging: isDragSource,
          })}
          data-pinned=${column.pinned ?? 'none'}
          data-pin-edge=${edge ?? 'none'}
          style=${pinStyle}
          .column=${column}
          .colindex=${ariaColindex}
          .coordinateLetter=${coordinateLetter}
        ></apex-grid-header>`;
      }
    )}${this.renderDragGhost()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [ApexGridHeaderRow.tagName]: ApexGridHeaderRow<object>;
  }
}
