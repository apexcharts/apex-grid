import {
  type FilterExpression,
  type FilterOperation,
  type GridLocaleKey,
  type LocaleParams,
  localize,
} from 'apex-grid';
import { registerComponent, registerFilterOperand } from 'apex-grid/internal';
import { css, html, LitElement, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { ApexGridEnterpriseHost } from './grid-enterprise.js';

export const SET_FILTER_TAG = 'apex-grid-set-filter';

/** Stable token for blank cells (null / undefined / empty string). */
const BLANK_TOKEN = '\u0000blank';

/** Most options rendered at once; a search narrows the rest. */
const MAX_RENDERED = 1000;

/** A distinct value option in the checklist. */
interface SetFilterValue {
  /** The raw value (used for the membership test). */
  readonly value: unknown;
  /** Display label. */
  readonly label: string;
  /** Stable identity used for selection + membership. */
  readonly token: string;
}

function tokenOf(value: unknown): string {
  return value === null || value === undefined || value === '' ? BLANK_TOKEN : String(value);
}

function labelOf(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(Blanks)';
  if (value instanceof Date) {
    // The token keeps the time of day, so the label does too unless it is
    // midnight: two timestamps on one day never share a label.
    const midnight = value.getHours() + value.getMinutes() + value.getSeconds() === 0;
    return midnight ? value.toLocaleDateString() : value.toLocaleString();
  }
  return String(value);
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return labelOf(a).localeCompare(labelOf(b));
}

const NO_TOKENS: ReadonlySet<string> = new Set();
/** Token set per `searchTerm` array, built once per expression, not per row. */
const tokenSets = new WeakMap<object, ReadonlySet<string>>();

/** The selected tokens of a set expression's `searchTerm` (a `string[]`). */
function tokenSet(term: unknown): ReadonlySet<string> {
  if (!Array.isArray(term)) return NO_TOKENS;
  let tokens = tokenSets.get(term);
  if (!tokens) {
    tokens = new Set(term.map(String));
    tokenSets.set(term, tokens);
  }
  return tokens;
}

/** Whether `term` selects `token`; a string term (typed in the filter row) is one token. */
function selects(term: unknown, token: string): boolean {
  return typeof term === 'string' ? term === token : tokenSet(term).has(token);
}

/**
 * The set filter's membership condition. A row passes when its value's token
 * is in the expression's `searchTerm`, the selected tokens as a `string[]`.
 * Stateless, so the expression serializes through `getState()` as
 * `{ operand: 'set', searchTerm: [...] }` and `setState()` restores it.
 */
const SET_CONDITION: FilterOperation<unknown> = {
  name: 'set',
  unary: false,
  logic: (value, term) => selects(term, tokenOf(value)),
};
registerFilterOperand(SET_CONDITION);

function isSetExpression(expression: FilterExpression<any>, key: string): boolean {
  const condition = expression.condition as FilterOperation<unknown> | string;
  const name = typeof condition === 'string' ? condition : condition?.name;
  return expression.key === key && name === SET_CONDITION.name;
}

/**
 * Excel-style **set filter**: a per-column checklist of the column's distinct
 * values. Unchecking values hides their rows. Pure UI on top of the grid's
 * public filter API: it applies a value-membership expression (operand
 * `'set'`, the selected tokens as its `searchTerm`) via `grid.filter()`, and
 * a toggle replaces only that expression, so the column's other `'and'`
 * conditions stay applied. An `'or'` condition on the column would let
 * unchecked values through, so applying a selection clears the column's
 * other conditions when it has one; one added after the selection is applied
 * still passes its rows.
 *
 * Mount it (typically in a header popover) and set its `grid` + `column`
 * properties. Toggling an option applies the filter live. The checked state
 * follows the set expression applied to the column (a value it does not list,
 * including one new since it was applied, is unchecked, as its rows are
 * hidden, and "(Select all)" stays partial while a selection is applied);
 * call `refresh()` after the data or the filter changes.
 *
 * @element apex-grid-set-filter
 *
 * @csspart set-filter - The panel container.
 * @csspart search - The search input.
 * @csspart select-all - The "(Select all)" row.
 * @csspart list - The scrollable options list.
 * @csspart option - A single value row.
 * @csspart option-label - The `<label>` wrapping an option's checkbox + text.
 * @csspart checkbox - An option's checkbox.
 * @csspart label - An option's label.
 * @csspart more - The row asking to search when more options match than are shown.
 * @csspart actions - The footer button row.
 * @csspart clear - The "Clear filter" button.
 */
export class ApexGridSetFilter extends LitElement {
  public static get tagName(): string {
    return SET_FILTER_TAG;
  }

  public static register(): void {
    registerComponent(ApexGridSetFilter);
  }

  public static override styles = css`
    :host {
      display: block;
      box-sizing: border-box;
      inline-size: 230px;
      font: 0.85rem/1.4 system-ui, sans-serif;
      color: #1f2328;
      background: #fff;
      border: 1px solid #d8dade;
      border-radius: 6px;
      box-shadow: 0 6px 16px rgb(0 0 0 / 12%);
    }
    [part='search'] {
      box-sizing: border-box;
      inline-size: calc(100% - 16px);
      margin: 8px;
      padding: 4px 6px;
      font: inherit;
      border: 1px solid #d0d3d7;
      border-radius: 4px;
    }
    [part='list'] {
      list-style: none;
      margin: 0;
      padding: 0 4px 4px;
      max-block-size: 220px;
      overflow: auto;
    }
    [part~='select-all'] {
      border-block-end: 1px solid #eceef1;
      font-weight: 600;
    }
    [part~='option'] {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 3px 6px;
      border-radius: 4px;
      cursor: pointer;
    }
    [part~='option']:hover {
      background: #f3f4f6;
    }
    [part='option-label'] {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 7px;
      min-inline-size: 0;
      cursor: pointer;
    }
    [part='label'] {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    [part='actions'] {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      padding: 6px 8px;
      border-block-start: 1px solid #eceef1;
    }
    [part='clear'] {
      font: inherit;
      padding: 3px 10px;
      border: 1px solid #d0d3d7;
      background: #fff;
      border-radius: 4px;
      cursor: pointer;
    }
    [part='clear']:hover {
      background: #f3f4f6;
    }
    [part='empty'],
    [part='more'] {
      padding: 8px;
      opacity: 0.6;
    }
  `;

  /** The enterprise grid to filter. */
  @property({ attribute: false })
  public grid: ApexGridEnterpriseHost | null = null;

  /** The column key whose distinct values are listed. */
  @property({ type: String })
  public column = '';

  @state()
  private search = '';

  /** Distinct values for the current column, computed from `grid.data`. */
  private values: SetFilterValue[] = [];

  /** Tokens currently checked (kept = passes the filter). */
  private checked = new Set<string>();

  /** Whether a set expression is applied to the column. */
  #applied = false;

  /** Lowercased label per entry of `values`, matched by the search. */
  #searchKeys: string[] = [];

  /** Resolve a locale key against the bound grid's overrides (English when unbound). */
  #t = (key: GridLocaleKey, params?: LocaleParams): string =>
    localize(this.grid?.localeText, key, params);

  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('grid') || changed.has('column')) this.#computeValues();
  }

  /** Distinct values listed for the active column. */
  public get distinctValues(): ReadonlyArray<SetFilterValue> {
    return this.values;
  }

  /** Tokens of the currently selected (checked) values. */
  public get selectedTokens(): string[] {
    return [...this.checked];
  }

  /**
   * Re-read the distinct values and the applied set filter from the grid
   * (call after the data or the filter changes).
   */
  public refresh(): void {
    this.#computeValues();
    this.requestUpdate();
  }

  /** Select every value (removes the set filter's own condition). */
  public selectAll(): void {
    this.checked = new Set(this.values.map((value) => value.token));
    this.#apply();
  }

  /** Deselect every value (filters the column to nothing). */
  public clearAll(): void {
    this.checked = new Set();
    this.#apply();
  }

  /** Select exactly the given value tokens (unknown tokens are ignored), then apply. */
  public setSelectedTokens(tokens: Iterable<string>): void {
    const valid = new Set(this.values.map((value) => value.token));
    this.checked = new Set([...tokens].filter((token) => valid.has(token)));
    this.#apply();
  }

  #computeValues(): void {
    const grid = this.grid;
    const key = this.column;
    if (!grid || !key) {
      this.values = [];
      this.#searchKeys = [];
      this.checked = new Set();
      this.#applied = false;
      return;
    }
    const seen = new Map<string, unknown>();
    for (const row of grid.data as ReadonlyArray<Record<string, unknown>>) {
      const raw = row[key];
      const token = tokenOf(raw);
      if (!seen.has(token)) seen.set(token, raw);
    }
    this.values = [...seen.entries()]
      .sort((a, b) => compareValues(a[1], b[1]))
      .map(([token, value]) => ({ token, value, label: labelOf(value) }));
    this.#searchKeys = this.values.map((value) => value.label.toLowerCase());
    // Checked = passes the set expressions applied to the column (all of them
    // when there is none), so the panel never claims a value its rows hide:
    // one the applied selection does not list, new since then or not, stays
    // unchecked.
    const applied = grid.filterExpressions.filter((each) => isSetExpression(each, key));
    this.checked = new Set(
      this.values
        .map((value) => value.token)
        .filter((token) => applied.every((each) => selects(each.searchTerm, token)))
    );
    this.#applied = applied.length > 0;
  }

  #toggle(token: string, checked: boolean): void {
    if (checked) this.checked.add(token);
    else this.checked.delete(token);
    this.#apply();
  }

  /**
   * Build + apply (or clear) the membership filter for the current selection,
   * replacing only the column's set expression: its other conditions (filter
   * row, filter builder, code) stay applied, unless one of them is an `'or'`
   * condition, which would let unchecked values through, so they are cleared.
   */
  #apply(): void {
    const grid = this.grid;
    const key = this.column;
    if (!grid || !key) return;

    let next = grid.filterExpressions.filter(
      (each) => each.key === key && !isSetExpression(each, key)
    );
    this.#applied = this.checked.size < this.values.length;
    if (this.#applied) {
      if (next.some((each) => each.criteria === 'or')) next = [];
      const searchTerm = this.values
        .filter((value) => this.checked.has(value.token))
        .map((value) => value.token);
      next.push({ key, condition: SET_CONDITION, searchTerm } as unknown as (typeof next)[number]);
    }
    grid.clearFilter(key);
    if (next.length) grid.filter(next);
    this.requestUpdate();
    this.dispatchEvent(
      new CustomEvent('apex-set-filter-changed', {
        detail: { column: key, selected: [...this.checked] },
        bubbles: true,
        composed: true,
      })
    );
  }

  #visibleValues(): SetFilterValue[] {
    const query = this.search.trim().toLowerCase();
    if (!query) return this.values;
    return this.values.filter((_, index) => this.#searchKeys[index].includes(query));
  }

  protected override render() {
    const matches = this.#visibleValues();
    // A capped list keeps a high-cardinality column responsive; the search
    // reaches the rest, and select-all and the filter still cover every value.
    const visible = matches.length > MAX_RENDERED ? matches.slice(0, MAX_RENDERED) : matches;
    // An applied selection that lists every current value still hides values
    // added later, so select-all reads as partial until it is cleared.
    const allChecked =
      this.values.length > 0 && this.checked.size === this.values.length && !this.#applied;
    const noneChecked = this.checked.size === 0;

    return html`<div part="set-filter">
      <input
        part="search"
        type="text"
        placeholder=${this.#t('setFilter.searchPlaceholder')}
        aria-label=${this.#t('setFilter.searchPlaceholder')}
        .value=${this.search}
        @input=${(event: Event) => {
          this.search = (event.target as HTMLInputElement).value;
        }}
      />
      <ul part="list">
        ${
          this.values.length === 0
            ? html`<li part="empty">${this.#t('setFilter.noValues')}</li>`
            : html`<li part="option select-all">
                <label part="option-label">
                  <input
                    part="checkbox"
                    type="checkbox"
                    .checked=${allChecked}
                    .indeterminate=${!allChecked && !noneChecked}
                    @change=${(event: Event) =>
                      (event.target as HTMLInputElement).checked
                        ? this.selectAll()
                        : this.clearAll()}
                  />
                  <span part="label">${this.#t('setFilter.selectAll')}</span>
                </label>
              </li>
              ${visible.map((value) => {
                const display =
                  value.token === BLANK_TOKEN ? this.#t('setFilter.blanks') : value.label;
                return html`<li part="option" data-token=${value.token}>
                  <label part="option-label">
                    <input
                      part="checkbox"
                      type="checkbox"
                      .checked=${this.checked.has(value.token)}
                      @change=${(event: Event) =>
                        this.#toggle(value.token, (event.target as HTMLInputElement).checked)}
                    />
                    <span part="label" title=${display}>${display}</span>
                  </label>
                </li>`;
              })}
              ${
                visible.length < matches.length
                  ? html`<li part="more">
                      ${this.#t('setFilter.more', { shown: visible.length, total: matches.length })}
                    </li>`
                  : nothing
              }`
        }
      </ul>
      ${
        this.values.length > 0
          ? html`<div part="actions">
            <button part="clear" type="button" @click=${() => this.selectAll()}>
              ${this.#t('setFilter.clearFilter')}
            </button>
          </div>`
          : nothing
      }
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SET_FILTER_TAG]: ApexGridSetFilter;
  }
}
