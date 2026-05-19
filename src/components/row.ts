import { html, LitElement, nothing } from 'lit';
import { property, queryAll } from 'lit/decorators.js';
import { map } from 'lit/directives/map.js';
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

  @property({ attribute: false })
  public activeNode!: ActiveNode<T>;

  @property({ attribute: false, type: Number })
  public index = -1;

  /** The column key currently being edited in this row, or `null`. */
  @property({ attribute: false })
  public editingKey: Keys<T> | null = null;

  public override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('exportparts', 'cell');
  }

  protected override render() {
    const { column: key, row: index } = this.activeNode;

    return html`
      ${map(this.columns, (column, colIndex) => {
        if (column.hidden) return nothing;
        const offset = this.pinOffsets.get(column.key);
        const pinStyle =
          column.pinned && typeof offset === 'number' ? `--apex-pin-offset:${offset}px` : '';
        const edge = getPinEdge(this.columns, colIndex);
        const editing = this.editingKey === column.key;
        return html`<apex-grid-cell
          part="cell"
          data-pinned=${column.pinned ?? 'none'}
          data-pin-edge=${edge ?? 'none'}
          style=${pinStyle}
          .active=${key === column.key && index === this.index}
          .editing=${editing}
          .column=${column}
          .row=${this as ApexGridRow<T>}
          .value=${this.data[column.key]}
        ></apex-grid-cell>`;
      })}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [ApexGridRow.tagName]: ApexGridRow<object>;
  }
}
