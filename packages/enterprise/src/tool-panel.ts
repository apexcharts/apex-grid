import { type ColumnConfiguration, type GridLocaleKey, localize } from 'apex-grid';
import { getDisplayColumns, registerComponent } from 'apex-grid/internal';
import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { AggregationFn } from './features/aggregation.js';
import type { ApexGridEnterprise } from './grid-enterprise.js';
import { GridLink } from './status-bar.js';

export const TOOL_PANEL_TAG = 'apex-grid-tool-panel';

type AnyColumn = ColumnConfiguration<Record<string, unknown>>;
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
 * mode) **Column Labels**, or use the row's toggle buttons from the keyboard.
 * The pivot-mode toggle repoints the zones at the pivot APIs. The list follows
 * the grid's display order (pinned columns first), and pin and move go through
 * `pinColumn` / `moveColumn`, so their cancellable events apply. The panel
 * re-renders whenever the grid does, so changes made elsewhere (header menu,
 * `setState`, app code, a new `localeText`) show up in it. While a pivot is
 * active it lists the grid's source fields, not the generated pivot columns.
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
    button:disabled {
      opacity: 0.4;
      cursor: default;
      background: transparent;
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

  #pivotMode = false;
  /** pivotMode was set to true and no grid has taken it yet: apply it on the next bind. */
  #pendingPivot = false;
  /** The grid willUpdate last bound; `grid` differs from it until the next update. */
  #bound: ApexGridEnterprise<Record<string, unknown>> | null | undefined;
  /** The grid's columns from its last unpivoted render (a pivot swaps in generated ones). */
  #source: AnyColumn[] | null = null;
  readonly #link = new GridLink(this);

  /**
   * When true, the zones drive the pivot APIs instead of grouping/aggregation.
   * It follows the grid (on while a column dimension is set, off once the grid
   * groups), and setting it carries the row dimension across like the toggle.
   * Set while no `grid` is bound, or in the same task as a new `grid`, it
   * carries that grid's grouping across on bind. Binding a grid otherwise takes
   * the mode from that grid alone.
   */
  public get pivotMode(): boolean {
    return this.#pivotMode;
  }

  public set pivotMode(on: boolean) {
    this.#pendingPivot = on;
    // A grid assigned in this task is not bound yet; willUpdate applies the request to it.
    if (this.grid && this.grid === this.#bound) {
      this.#setPivotMode(on);
    } else {
      this.#pivotMode = on;
      this.requestUpdate();
    }
  }

  protected override willUpdate(): void {
    const grid = this.grid;
    if (grid !== this.#bound) {
      this.#bound = grid;
      this.#link.grid = grid;
      this.#source = null;
      if (grid) {
        // Only an explicit request converts grouping; the old grid's mode never does.
        this.#pivotMode = false;
        if (this.#pendingPivot) this.#setPivotMode(true);
      }
    }
    if (!grid) return;
    // A bound grid has taken the request, so it never reaches a later bind.
    this.#pendingPivot = false;
    if (!grid.isPivoting) this.#source = grid.columns as AnyColumn[];
    if (this.#columnLabels().length) this.#pivotMode = true;
    else if (grid.groupBy?.length) this.#pivotMode = false;
  }

  /** Resolve a locale key against the bound grid's overrides (English when unbound). */
  #t = (key: GridLocaleKey): string => localize(this.grid?.localeText, key);

  // --- column helpers ------------------------------------------------------

  /** The grid's source columns, also while a pivot shows generated ones. */
  #columns(): AnyColumn[] {
    const grid = this.grid;
    if (!grid) return [];
    // `?? []` covers a grid element that is not upgraded yet.
    if (!grid.isPivoting) return (grid.columns ?? []) as AnyColumn[];
    // Bound to a grid that was already pivoting: its data fields are the sources.
    return this.#source ?? Object.keys(grid.data[0] ?? {}).map((key) => ({ key }));
  }

  #label(column: AnyColumn): string {
    return column.headerText ?? String(column.key);
  }

  #labelFor(key: string): string {
    const column = this.#columns().find((each) => String(each.key) === key);
    return column ? this.#label(column) : key;
  }

  /** The neighbour a move swaps with: the adjacent column in the same pin group. */
  #neighbour(display: AnyColumn[], index: number, direction: -1 | 1): AnyColumn | undefined {
    const next = display[index + direction];
    return next && (next.pinned ?? null) === (display[index].pinned ?? null) ? next : undefined;
  }

  // --- grouping / aggregation / pivot zones --------------------------------

  /** Row-dimension keys for the current mode (groupBy or pivotRows). */
  #groupKeys(): string[] {
    return this.#pivotMode ? (this.grid?.pivotRows ?? []) : (this.grid?.groupBy ?? []);
  }

  #setGroupKeys(next: string[]): void {
    if (!this.grid) return;
    if (this.#pivotMode) {
      this.grid.pivotRows = next;
    } else {
      this.grid.groupBy = next;
    }
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
    return this.#pivotMode ? (this.grid?.pivotValues ?? {}) : (this.grid?.aggregations ?? {});
  }

  #setValues(next: Record<string, AggregationFn[]>): void {
    if (!this.grid) return;
    if (this.#pivotMode) {
      this.grid.pivotValues = next;
    } else {
      this.grid.aggregations = next;
    }
  }

  #addToValues(key: string): void {
    const config = this.#valuesConfig();
    if (!config[key]) this.#setValues({ ...config, [key]: ['sum'] });
  }

  #removeFromValues(key: string): void {
    const next = { ...this.#valuesConfig() };
    delete next[key];
    this.#setValues(next);
  }

  /** The active column-dimension fields as an array (pivotOn may be a string or list). */
  #columnLabels(): string[] {
    const on = this.grid?.pivotOn;
    return Array.isArray(on) ? on.filter(Boolean) : on ? [on] : [];
  }

  #setColumnLabels(next: string[]): void {
    if (this.grid) this.grid.pivotOn = next.length > 1 ? next : (next[0] ?? '');
  }

  #setColumnLabel(key: string): void {
    const next = this.#columnLabels();
    if (!next.includes(key)) this.#setColumnLabels([...next, key]);
  }

  #clearColumnLabel(key: string): void {
    this.#setColumnLabels(this.#columnLabels().filter((k) => k !== key));
  }

  /** Enter/exit pivot mode, carrying the row dimension across. */
  #setPivotMode(on: boolean): void {
    if (on === this.#pivotMode) return;
    const grid = this.grid;
    if (grid && on) {
      // Keep pivot rows the grid already has unless there is grouping to carry over.
      if (grid.groupBy?.length) grid.pivotRows = grid.groupBy;
      grid.groupBy = [];
    } else if (grid) {
      grid.groupBy = grid.pivotRows;
      grid.pivotOn = '';
    }
    this.#pivotMode = on;
    this.requestUpdate();
  }

  /** The dragged column key, or `null` for anything else (such as selected page text). */
  #dropKey(event: DragEvent): string | null {
    const key = event.dataTransfer?.getData('text/plain');
    return this.#columns().some((column) => String(column.key) === key) ? key! : null;
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
            : html`<span part="zone-empty">${this.#t('toolPanel.dragColumns')}</span>`
        }
      </div>
    </div>`;
  }

  #chip(label: string, onRemove: () => void): TemplateResult {
    const name = `${this.#t('toolPanel.removeChip')} ${label}`;
    return html`<span part="chip"
      >${label}<button title=${name} aria-label=${name} @click=${onRemove}>×</button></span
    >`;
  }

  /** A row action: its accessible name is the localized label, not the glyph. */
  #action(
    part: string,
    key: GridLocaleKey,
    glyph: string,
    onClick: () => void,
    pressed?: boolean,
    disabled = false
  ): TemplateResult {
    const label = this.#t(key);
    return html`<button part=${part} title=${label} aria-label=${label} aria-pressed=${
      pressed === undefined ? nothing : String(pressed)
    } ?disabled=${disabled} @click=${onClick}>${glyph}</button>`;
  }

  protected override render() {
    const grid = this.grid;
    if (!grid) {
      return html`<div part="header">${this.#t('toolPanel.noGrid')}</div>`;
    }
    const term = this.search.trim().toLowerCase();
    const groupKeys = this.#groupKeys();
    const values = this.#valuesConfig();
    const labels = this.#columnLabels();
    // Generated pivot columns are throwaway: only the dimension toggles apply then.
    const pivoting = grid.isPivoting;
    const display = getDisplayColumns(this.#columns());

    return html`
      <div part="header">${this.#t('toolPanel.columns')}</div>
      <input
        part="search"
        type="search"
        placeholder=${this.#t('toolPanel.searchPlaceholder')}
        aria-label=${this.#t('toolPanel.searchPlaceholder')}
        .value=${this.search}
        @input=${(event: Event) => {
          this.search = (event.target as HTMLInputElement).value;
        }}
      />
      <ul part="list">
        ${display.map((column, index) => {
          const label = this.#label(column);
          if (!label.toLowerCase().includes(term)) return nothing;
          const key = String(column.key);
          const up = this.#neighbour(display, index, -1);
          const down = this.#neighbour(display, index, 1);
          // None, start, end, none: `null` (what the header menu's Unpin writes) counts as none.
          const nextPin =
            column.pinned === 'start' ? 'end' : column.pinned === 'end' ? null : 'start';
          return html`<li
            part="item"
            data-key=${key}
            draggable="true"
            @dragstart=${(event: DragEvent) => event.dataTransfer?.setData('text/plain', key)}
          >
            <label part="label">
              ${
                pivoting
                  ? nothing
                  : html`<input type="checkbox" part="visible" .checked=${!column.hidden} @change=${() =>
                      grid.updateColumns({ key, hidden: !column.hidden })} />`
              }
              <span>${label}</span>
            </label>
            <span part="actions" role="group" aria-label=${label}>
              ${
                pivoting
                  ? nothing
                  : html`${this.#action(
                      'pin',
                      'toolPanel.pinColumn',
                      column.pinned ? PIN_GLYPH[column.pinned] : '⇆',
                      () => void grid.pinColumn(key, nextPin),
                      !!column.pinned
                    )}
                    ${this.#action(
                      'up',
                      'toolPanel.moveUp',
                      '↑',
                      () => void grid.moveColumn(key, up!.key, 'before'),
                      undefined,
                      !up
                    )}
                    ${this.#action(
                      'down',
                      'toolPanel.moveDown',
                      '↓',
                      () => void grid.moveColumn(key, down!.key, 'after'),
                      undefined,
                      !down
                    )}`
              }
              ${this.#action(
                'group',
                'toolPanel.groupByColumn',
                '⊞',
                () => this.toggleGroup(key),
                groupKeys.includes(key)
              )}
              ${this.#action(
                'value',
                'toolPanel.valueColumn',
                'Σ',
                () => (values[key] ? this.#removeFromValues(key) : this.#addToValues(key)),
                !!values[key]
              )}
              ${
                this.#pivotMode
                  ? this.#action(
                      'column-label',
                      'toolPanel.columnLabelColumn',
                      '▥',
                      () =>
                        labels.includes(key)
                          ? this.#clearColumnLabel(key)
                          : this.#setColumnLabel(key),
                      labels.includes(key)
                    )
                  : nothing
              }
            </span>
          </li>`;
        })}
      </ul>

      <div part="pivot-toggle">
        <label>
          <input
            type="checkbox"
            part="pivot-mode"
            .checked=${this.#pivotMode}
            @change=${(event: Event) => {
              this.pivotMode = (event.target as HTMLInputElement).checked;
            }}
          />
          ${this.#t('toolPanel.pivotMode')}
        </label>
      </div>

      ${this.#renderZone(
        this.#pivotMode ? this.#t('toolPanel.rowGroupsPivot') : this.#t('toolPanel.rowGroups'),
        groupKeys,
        (key) => this.#addToGroups(key),
        (key) => this.#chip(this.#labelFor(key), () => this.#removeFromGroups(key))
      )}
      ${this.#renderZone(
        this.#t('toolPanel.values'),
        Object.keys(values),
        (key) => this.#addToValues(key),
        (key) =>
          this.#chip(`${this.#labelFor(key)} (${values[key].join('/')})`, () =>
            this.#removeFromValues(key)
          )
      )}
      ${
        this.#pivotMode
          ? this.#renderZone(
              this.#t('toolPanel.columnLabels'),
              labels,
              (key) => this.#setColumnLabel(key),
              (key) => this.#chip(this.#labelFor(key), () => this.#clearColumnLabel(key))
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
