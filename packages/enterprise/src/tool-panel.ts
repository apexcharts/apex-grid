import type { ColumnConfiguration } from 'apex-grid';
import { registerComponent } from 'apex-grid/internal';
import { css, html, LitElement } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { ApexGridEnterprise } from './grid-enterprise.js';

export const TOOL_PANEL_TAG = 'apex-grid-tool-panel';

type AnyColumn = ColumnConfiguration<Record<string, unknown>>;
type Pin = 'start' | 'end' | undefined;
const PIN_CYCLE: Pin[] = [undefined, 'start', 'end'];
const PIN_GLYPH: Record<string, string> = { start: '⇤', end: '⇥' };

/**
 * Columns tool panel — a side panel that manages the grid's columns (show/hide,
 * search, pin, reorder) and toggles row grouping per column. It reads and writes
 * the grid's reactive `columns` / `groupBy`, so every action maps to an existing
 * API. Mount it beside the grid and set its `grid` property.
 *
 * @element apex-grid-tool-panel
 */
export class ApexGridToolPanel extends LitElement {
  public static get tagName(): string {
    return TOOL_PANEL_TAG;
  }

  public static register(): void {
    registerComponent(ApexGridToolPanel);
  }

  public static override styles = css`
    :host {
      display: block;
      box-sizing: border-box;
      inline-size: 260px;
      font: 0.85rem/1.4 system-ui, sans-serif;
      color: #1f2328;
      background: #f6f7f8;
      border: 1px solid #d8dade;
      border-radius: 6px;
      overflow: auto;
    }
    [part='header'] {
      padding: 8px 10px;
      font-weight: 600;
      border-block-end: 1px solid #e4e6e9;
    }
    [part='search'] {
      inline-size: calc(100% - 20px);
      margin: 8px 10px;
      padding: 4px 6px;
      font: inherit;
      border: 1px solid #d0d3d7;
      border-radius: 4px;
    }
    [part='list'] {
      list-style: none;
      margin: 0;
      padding: 0 6px 8px;
    }
    [part='item'] {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 4px;
      border-radius: 4px;
    }
    [part='item']:hover {
      background: #eceef0;
    }
    [part='label'] {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 6px;
      min-inline-size: 0;
      cursor: pointer;
    }
    [part='label'] span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    [part='actions'] {
      display: flex;
      gap: 2px;
    }
    button {
      font: inherit;
      line-height: 1;
      padding: 2px 5px;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      cursor: pointer;
      color: #57606a;
    }
    button:hover {
      background: #dfe2e5;
    }
    button[aria-pressed='true'] {
      background: #1f6feb;
      color: #fff;
    }
  `;

  /** The grid this panel controls. */
  @property({ attribute: false })
  public grid?: ApexGridEnterprise<Record<string, unknown>>;

  @state()
  private search = '';

  #columns(): AnyColumn[] {
    return (this.grid?.columns ?? []) as AnyColumn[];
  }

  #label(column: AnyColumn): string {
    return column.headerText ?? String(column.key);
  }

  #setColumns(next: AnyColumn[]): void {
    if (!this.grid) return;
    this.grid.columns = next;
    this.requestUpdate();
  }

  #toggleVisible(key: unknown): void {
    this.#setColumns(
      this.#columns().map((column) =>
        column.key === key ? { ...column, hidden: !column.hidden } : column
      )
    );
  }

  #cyclePin(key: unknown): void {
    this.#setColumns(
      this.#columns().map((column) => {
        if (column.key !== key) return column;
        const next = PIN_CYCLE[(PIN_CYCLE.indexOf(column.pinned as Pin) + 1) % PIN_CYCLE.length];
        return { ...column, pinned: next };
      })
    );
  }

  #move(key: unknown, direction: -1 | 1): void {
    const columns = [...this.#columns()];
    const from = columns.findIndex((column) => column.key === key);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= columns.length) return;
    [columns[from], columns[to]] = [columns[to], columns[from]];
    this.#setColumns(columns);
  }

  #toggleGroup(key: unknown): void {
    if (!this.grid) return;
    const groupBy = this.grid.groupBy ?? [];
    const stringKey = String(key);
    this.grid.groupBy = groupBy.includes(stringKey)
      ? groupBy.filter((each) => each !== stringKey)
      : [...groupBy, stringKey];
    this.requestUpdate();
  }

  protected override render() {
    if (!this.grid) {
      return html`<div part="header">No grid connected</div>`;
    }
    const term = this.search.trim().toLowerCase();
    const groupBy = this.grid.groupBy ?? [];
    const columns = this.#columns().filter((column) =>
      this.#label(column).toLowerCase().includes(term)
    );

    return html`
      <div part="header">Columns</div>
      <input
        part="search"
        type="search"
        placeholder="Search columns…"
        .value=${this.search}
        @input=${(event: Event) => {
          this.search = (event.target as HTMLInputElement).value;
        }}
      />
      <ul part="list">
        ${columns.map(
          (column) => html`<li part="item" data-key=${String(column.key)}>
            <label part="label">
              <input
                type="checkbox"
                part="visible"
                .checked=${!column.hidden}
                @change=${() => this.#toggleVisible(column.key)}
              />
              <span>${this.#label(column)}</span>
            </label>
            <span part="actions">
              <button
                part="pin"
                title="Pin column"
                aria-pressed=${column.pinned ? 'true' : 'false'}
                @click=${() => this.#cyclePin(column.key)}
              >
                ${column.pinned ? PIN_GLYPH[column.pinned] : '⇆'}
              </button>
              <button part="up" title="Move up" @click=${() => this.#move(column.key, -1)}>↑</button>
              <button part="down" title="Move down" @click=${() => this.#move(column.key, 1)}>
                ↓
              </button>
              <button
                part="group"
                title="Group by this column"
                aria-pressed=${groupBy.includes(String(column.key)) ? 'true' : 'false'}
                @click=${() => this.#toggleGroup(column.key)}
              >
                ⊞
              </button>
            </span>
          </li>`
        )}
      </ul>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [TOOL_PANEL_TAG]: ApexGridToolPanel;
  }
}
