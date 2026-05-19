import { consume } from '@lit/context';
import { html, LitElement, nothing, type PropertyValueMap } from 'lit';
import { property, queryAll } from 'lit/decorators.js';
import { map } from 'lit/directives/map.js';
import { gridStateContext, type StateController } from '../controllers/state.js';
import { partNameMap } from '../internal/part-map.js';
import { registerComponent } from '../internal/register.js';
import { GRID_HEADER_ROW_TAG } from '../internal/tags.js';
import type { ColumnConfiguration } from '../internal/types.js';
import { getPinEdge } from '../internal/utils.js';
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

  public get headers() {
    return Array.from(this._headers);
  }

  constructor() {
    super();
    this.addEventListener('click', this.#activeFilterColumn);
  }

  public override connectedCallback() {
    super.connectedCallback();
    this.setAttribute('tabindex', '0');
  }

  #activeFilterColumn(event: MouseEvent) {
    const header = event
      .composedPath()
      .filter((target) => target instanceof ApexGridHeader)
      .at(0) as ApexGridHeader<T>;

    this.state.filtering.setActiveColumn(header?.column);
  }

  protected override shouldUpdate(props: PropertyValueMap<this> | Map<PropertyKey, this>): boolean {
    for (const header of this.headers) {
      header.requestUpdate();
    }

    return super.shouldUpdate(props);
  }

  protected renderDropIndicator() {
    const state = this.state.reordering.state;
    if (!state || state.indicatorOffset === null) return nothing;
    return html`<div
      part="reorder-indicator"
      style=${`inset-inline-start:${state.indicatorOffset}px`}
    ></div>`;
  }

  protected override render() {
    const filterRow = this.state.filtering.filterRow;
    const reorderState = this.state.reordering.state;

    return html`${map(this.columns, (column, index) => {
      if (column.hidden) return nothing;
      const offset = this.pinOffsets.get(column.key);
      const pinStyle =
        column.pinned && typeof offset === 'number' ? `--apex-pin-offset:${offset}px` : '';
      const edge = getPinEdge(this.columns, index);
      const isDragSource = reorderState?.sourceKey === column.key;
      return html`<apex-grid-header
        part=${partNameMap({
          filtered: column === filterRow?.column,
          'pinned-start': column.pinned === 'start',
          'pinned-end': column.pinned === 'end',
          dragging: isDragSource,
        })}
        data-pinned=${column.pinned ?? 'none'}
        data-pin-edge=${edge ?? 'none'}
        style=${pinStyle}
        .column=${column}
      ></apex-grid-header>`;
    })}${this.renderDropIndicator()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [ApexGridHeaderRow.tagName]: ApexGridHeaderRow<object>;
  }
}
