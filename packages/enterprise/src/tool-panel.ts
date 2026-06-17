import type { ColumnConfiguration } from 'apex-grid';
import { registerComponent } from 'apex-grid/internal';
import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { AggregationFn } from './features/aggregation.js';
import type { ApexGridEnterprise } from './grid-enterprise.js';

export const TOOL_PANEL_TAG = 'apex-grid-tool-panel';

type AnyColumn = ColumnConfiguration<Record<string, unknown>>;
type Pin = 'start' | 'end' | undefined;
const PIN_CYCLE: Pin[] = [undefined, 'start', 'end'];
const PIN_GLYPH: Record<string, string> = { start: '⇤', end: '⇥' };

/**
 * Columns tool panel — a side panel that manages the grid's columns (show/hide,
 * search, pin, reorder) and drives row grouping, aggregation, and pivoting via
 * drag-and-drop zones. It reads and writes the grid's reactive APIs
 * (`columns`, `groupBy`, `aggregations`, `pivotRows`/`pivotOn`/`pivotValues`),
 * so every action maps to an existing capability. Mount beside the grid and set
 * its `grid` property.
 *
 * Drag a column from the list into **Row Groups**, **Values**, or (in pivot
 * mode) **Column Labels**. The pivot-mode toggle repoints the zones at the
 * pivot APIs.
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
      inline-size: 270px;
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
      cursor: grab;
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
    [part='pivot-toggle'] {
      padding: 6px 10px;
      border-block-start: 1px solid #e4e6e9;
    }
    [part='zone'] {
      margin: 6px 10px;
      padding: 6px;
      border: 1px dashed #c4c8cd;
      border-radius: 5px;
      background: #fbfbfc;
    }
    [part='zone-title'] {
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: #6a737d;
      margin-block-end: 4px;
    }
    [part='chips'] {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      min-block-size: 20px;
    }
    [part='zone-empty'] {
      font-size: 0.78rem;
      color: #9aa1a8;
    }
    [part='chip'] {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 1px 4px 1px 7px;
      background: #1f6feb;
      color: #fff;
      border-radius: 10px;
      font-size: 0.78rem;
    }
    [part='chip'] button {
      color: #fff;
      padding: 0 3px;
    }
    [part='chip'] button:hover {
      background: rgba(255, 255, 255, 0.25);
    }
  `;

  /** The grid this panel controls. */
  @property({ attribute: false })
  public grid?: ApexGridEnterprise<Record<string, unknown>>;

  @state()
  private search = '';

  /** When true, the zones drive the pivot APIs instead of grouping/aggregation. */
  @state()
  public pivotMode = false;

  // --- column helpers ------------------------------------------------------

  #columns(): AnyColumn[] {
    return (this.grid?.columns ?? []) as AnyColumn[];
  }

  #label(column: AnyColumn): string {
    return column.headerText ?? String(column.key);
  }

  #labelFor(key: string): string {
    const column = this.#columns().find((each) => String(each.key) === key);
    return column ? this.#label(column) : key;
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

  // --- grouping / aggregation / pivot zones --------------------------------

  /** Row-dimension keys for the current mode (groupBy or pivotRows). */
  #groupKeys(): string[] {
    return this.pivotMode ? (this.grid?.pivotRows ?? []) : (this.grid?.groupBy ?? []);
  }

  #setGroupKeys(next: string[]): void {
    if (!this.grid) return;
    if (this.pivotMode) {
      this.grid.pivotRows = next;
    } else {
      this.grid.groupBy = next;
    }
    this.requestUpdate();
  }

  #addToGroups(key: string): void {
    const keys = this.#groupKeys();
    if (!keys.includes(key)) this.#setGroupKeys([...keys, key]);
  }

  #removeFromGroups(key: string): void {
    this.#setGroupKeys(this.#groupKeys().filter((each) => each !== key));
  }

  /** Public toggle used by the per-row group button (mode-aware). */
  public toggleGroup(key: string): void {
    if (this.#groupKeys().includes(key)) {
      this.#removeFromGroups(key);
    } else {
      this.#addToGroups(key);
    }
  }

  #valuesConfig() {
    return this.pivotMode ? (this.grid?.pivotValues ?? {}) : (this.grid?.aggregations ?? {});
  }

  #addToValues(key: string): void {
    if (!this.grid) return;
    const config = this.#valuesConfig();
    if (config[key]) return;
    const next = { ...config, [key]: ['sum'] as AggregationFn[] };
    if (this.pivotMode) {
      this.grid.pivotValues = next;
    } else {
      this.grid.aggregations = next;
    }
    this.requestUpdate();
  }

  #removeFromValues(key: string): void {
    if (!this.grid) return;
    const next = { ...this.#valuesConfig() };
    delete next[key];
    if (this.pivotMode) {
      this.grid.pivotValues = next;
    } else {
      this.grid.aggregations = next;
    }
    this.requestUpdate();
  }

  #setColumnLabel(key: string): void {
    if (!this.grid) return;
    this.grid.pivotOn = key;
    this.requestUpdate();
  }

  #clearColumnLabel(): void {
    if (!this.grid) return;
    this.grid.pivotOn = '';
    this.requestUpdate();
  }

  /** Enter/exit pivot mode, carrying the row dimension across. */
  #setPivotMode(on: boolean): void {
    if (!this.grid) return;
    if (on) {
      this.grid.pivotRows = this.grid.groupBy;
      this.grid.groupBy = [];
    } else {
      this.grid.groupBy = this.grid.pivotRows;
      this.grid.pivotOn = '';
    }
    this.pivotMode = on;
    this.requestUpdate();
  }

  #dropKey(event: DragEvent): string | null {
    return event.dataTransfer?.getData('text/plain') || null;
  }

  #renderZone(
    title: string,
    keys: string[],
    onDrop: (key: string) => void,
    renderChip: (key: string) => TemplateResult
  ) {
    return html`<div
      part="zone"
      @dragover=${(event: DragEvent) => event.preventDefault()}
      @drop=${(event: DragEvent) => {
        event.preventDefault();
        const key = this.#dropKey(event);
        if (key) onDrop(key);
      }}
    >
      <div part="zone-title">${title}</div>
      <div part="chips">
        ${
          keys.length
            ? keys.map(renderChip)
            : html`<span part="zone-empty">Drag columns here</span>`
        }
      </div>
    </div>`;
  }

  #chip(label: string, onRemove: () => void): TemplateResult {
    return html`<span part="chip"
      >${label}<button title="Remove" @click=${onRemove}>×</button></span
    >`;
  }

  protected override render() {
    if (!this.grid) {
      return html`<div part="header">No grid connected</div>`;
    }
    const term = this.search.trim().toLowerCase();
    const groupKeys = this.#groupKeys();
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
          (column) => html`<li
            part="item"
            data-key=${String(column.key)}
            draggable="true"
            @dragstart=${(event: DragEvent) =>
              event.dataTransfer?.setData('text/plain', String(column.key))}
          >
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
                aria-pressed=${groupKeys.includes(String(column.key)) ? 'true' : 'false'}
                @click=${() => this.toggleGroup(String(column.key))}
              >
                ⊞
              </button>
            </span>
          </li>`
        )}
      </ul>

      <div part="pivot-toggle">
        <label>
          <input
            type="checkbox"
            part="pivot-mode"
            .checked=${this.pivotMode}
            @change=${(event: Event) =>
              this.#setPivotMode((event.target as HTMLInputElement).checked)}
          />
          Pivot mode
        </label>
      </div>

      ${this.#renderZone(
        this.pivotMode ? 'Row Groups (pivot rows)' : 'Row Groups',
        groupKeys,
        (key) => this.#addToGroups(key),
        (key) => this.#chip(this.#labelFor(key), () => this.#removeFromGroups(key))
      )}
      ${this.#renderZone(
        'Values',
        Object.keys(this.#valuesConfig()),
        (key) => this.#addToValues(key),
        (key) =>
          this.#chip(`${this.#labelFor(key)} (${this.#valuesConfig()[key].join('/')})`, () =>
            this.#removeFromValues(key)
          )
      )}
      ${
        this.pivotMode
          ? this.#renderZone(
              'Column Labels',
              this.grid.pivotOn ? [this.grid.pivotOn] : [],
              (key) => this.#setColumnLabel(key),
              (key) => this.#chip(this.#labelFor(key), () => this.#clearColumnLabel())
            )
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [TOOL_PANEL_TAG]: ApexGridToolPanel;
  }
}
