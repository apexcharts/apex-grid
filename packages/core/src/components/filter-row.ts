import { consume } from '@lit/context';
import { html, LitElement, nothing } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { gridStateContext, type StateController } from '../controllers/state.js';
import { DEFAULT_COLUMN_CONFIG } from '../internal/constants.js';
import { renderIcon } from '../internal/icons.js';
import { registerComponent } from '../internal/register.js';
import { GRID_FILTER_ROW_TAG } from '../internal/tags.js';
import type { ColumnConfiguration } from '../internal/types.js';
import { getDisplayColumns, getFilterOperandsFor, getPinEdge } from '../internal/utils.js';
import { watch } from '../internal/watch.js';
import type { FilterExpressionTree } from '../operations/filter/tree.js';
import type { FilterExpression, FilterOperation, OperandKeys } from '../operations/filter/types.js';
import { styles } from '../styles/filter-row/filter-row.css.js';

type ExpressionChipProps<T> = {
  expression: FilterExpression<T>;
  selected: boolean;
  onRemove: (e: Event) => Promise<void>;
  onSelect: (e: Event) => Promise<void>;
};

export default class ApexFilterRow<T extends object> extends LitElement {
  public static get tagName() {
    return GRID_FILTER_ROW_TAG;
  }

  public static override styles = styles;

  public static register() {
    registerComponent(ApexFilterRow);
  }

  @consume({ context: gridStateContext, subscribe: true })
  @property({ attribute: false })
  public state!: StateController<T>;

  protected get isNumeric() {
    return this.column.type === 'number';
  }

  protected get filterController() {
    return this.state.filtering;
  }

  protected get condition() {
    return this.expression.condition as FilterOperation<T>;
  }

  @property({ attribute: false })
  public active = false;

  @query('input')
  public input!: HTMLInputElement;

  @query('#condition')
  public conditionElement!: HTMLElement;

  @query('[part~="dropdown"]')
  public dropdown!: HTMLElement;

  @state()
  protected dropdownOpen = false;

  @property({ attribute: false })
  public column: ColumnConfiguration<T> = DEFAULT_COLUMN_CONFIG as ColumnConfiguration<T>;

  @property({ attribute: false })
  public expression!: FilterExpression<T>;

  #setDefaultExpression() {
    this.expression = this.filterController.getDefaultExpression(this.column);
  }

  #removeExpression(expression: FilterExpression<T>) {
    this.filterController.removeExpression(expression);
  }

  async #show() {
    this.active = true;

    await this.updateComplete;
    this.input?.select();
  }

  #applyCondition(key: OperandKeys<T[typeof this.column.key]>) {
    // XXX: Types
    this.expression.condition = (getFilterOperandsFor(this.column) as any)[key] as FilterOperation<
      T[keyof T]
    >;

    if (this.input.value || this.expression.condition.unary) {
      this.filterController.filterWithEvent(this.expression, 'modify');
    }

    this.requestUpdate();
  }

  #handleDropdownItemClick = (event: Event) => {
    event.stopPropagation();
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-value]');
    if (!target) return;
    const value = target.dataset.value as OperandKeys<T[typeof this.column.key]>;
    this.#applyCondition(value);
    this.dropdownOpen = false;
    this.input?.focus();
  };

  #handleOutsidePointer = (event: PointerEvent) => {
    if (!this.dropdownOpen) return;
    const path = event.composedPath();
    if (path.includes(this.dropdown) || path.includes(this.conditionElement)) return;
    this.dropdownOpen = false;
  };

  #handleDocumentKey = (event: KeyboardEvent) => {
    if (this.dropdownOpen && event.key === 'Escape') {
      event.stopPropagation();
      this.dropdownOpen = false;
      this.conditionElement?.focus();
    }
  };

  #handleInput(event: Event) {
    event.stopPropagation();

    const raw = (event.target as HTMLInputElement).value ?? '';
    const value = this.isNumeric ? Number.parseFloat(raw) : raw;
    const shouldUpdate = this.isNumeric ? !Number.isNaN(value as number) : !!value;
    const type = this.filterController.get(this.expression.key)?.has(this.expression)
      ? 'modify'
      : 'add';

    if (shouldUpdate) {
      this.expression.searchTerm = value as any;

      this.filterController.filterWithEvent(this.expression, type);
    } else {
      this.#removeExpression(this.expression);
    }

    this.requestUpdate();
  }

  #handleKeydown(event: KeyboardEvent) {
    event.stopPropagation();

    switch (event.key) {
      case 'Enter':
        this.input.value = '';
        this.#setDefaultExpression();
        return;
      case 'Escape':
        this.active = false;
        return;
      default:
        return;
    }
  }

  #handleResetClick() {
    this.filterController.removeAllExpressions(this.column.key);
    this.requestUpdate();
  }

  #openDropdownList = () => {
    this.dropdownOpen = !this.dropdownOpen;
  };

  public override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'row');
    this.setAttribute('aria-rowindex', '2');
    document.addEventListener('pointerdown', this.#handleOutsidePointer, true);
    document.addEventListener('keydown', this.#handleDocumentKey, true);
  }

  public override disconnectedCallback(): void {
    document.removeEventListener('pointerdown', this.#handleOutsidePointer, true);
    document.removeEventListener('keydown', this.#handleDocumentKey, true);
    super.disconnectedCallback();
  }

  protected override updated(): void {
    // The filter row follows the column header, shifted down by an optional
    // group header row above it.
    const depth = this.state?.host?.columnGroupDepth ?? 0;
    this.setAttribute('aria-rowindex', String(depth + 2));
  }

  @watch('active', { waitUntilFirstUpdate: true })
  protected activeChanged() {
    this.style.display = this.active ? 'flex' : '';

    if (!this.active) {
      this.column = DEFAULT_COLUMN_CONFIG as ColumnConfiguration<T>;
    }

    this.state.host.requestUpdate();
  }

  #chipCriteriaFor(expression: FilterExpression<T>) {
    return async (e: Event) => {
      e.stopPropagation();

      expression.criteria = expression.criteria === 'and' ? 'or' : 'and';
      this.filterController.filterWithEvent(expression, 'modify');
      this.requestUpdate();
    };
  }

  #chipSelectFor(expression: FilterExpression<T>) {
    return async (e: Event) => {
      e.stopPropagation();
      this.expression = expression;
      await this.updateComplete;
      this.input?.select();
    };
  }

  #chipRemoveFor(expression: FilterExpression<T>) {
    return async (e: Event) => {
      e.stopPropagation();
      this.#removeExpression(expression);

      if (this.active && this.expression === expression) {
        this.#setDefaultExpression();
        await this.updateComplete;
        this.input.focus();
      }

      this.requestUpdate();
    };
  }

  protected renderCriteriaButton(expr: FilterExpression<T>, index: number) {
    return index
      ? html`<button
          type="button"
          part="criteria"
          @click=${this.#chipCriteriaFor(expr)}
        >
          ${expr.criteria}
        </button>`
      : nothing;
  }

  protected renderExpressionChip(props: ExpressionChipProps<T>) {
    const { name, unary } = props.expression.condition as FilterOperation<T>;
    const { searchTerm: term } = props.expression;

    return html`<div
      part="expression-chip"
      ?selected=${props.selected}
    >
      <button
        part="chip-body"
        type="button"
        @click=${props.onSelect}
      >
        ${renderIcon(name)}
        <span>${unary ? name : term}</span>
      </button>
      <button
        part="chip-remove"
        type="button"
        aria-label="Remove filter"
        @click=${props.onRemove}
      >
        ${renderIcon('close')}
      </button>
    </div>`;
  }

  protected renderActiveChips() {
    const state = this.filterController.get(this.column.key);

    return !state
      ? nothing
      : Array.from(state).map((expression, idx) => {
          const props: ExpressionChipProps<T> = {
            expression,
            selected: this.expression === expression,
            onRemove: this.#chipRemoveFor(expression),
            onSelect: this.#chipSelectFor(expression),
          };

          return html`${this.renderCriteriaButton(expression, idx)}${this.renderExpressionChip(
            props
          )}`;
        });
  }

  protected renderFilterActions() {
    return html`
      <button
        id="reset"
        type="button"
        part="action"
        @click=${this.#handleResetClick}
      >
        ${renderIcon('refresh')} Reset
      </button>
      <button
        id="close"
        type="button"
        part="action"
        @click=${() => {
          this.active = false;
        }}
      >
        ${renderIcon('close')} Close
      </button>
    `;
  }

  protected renderDropdown() {
    return html`<ul
      part="dropdown"
      role="listbox"
      aria-label="Filter condition"
      ?hidden=${!this.dropdownOpen}
      @click=${this.#handleDropdownItemClick}
    >
      ${Object.entries(getFilterOperandsFor(this.column)).map(
        ([key, operand]) => html`
          <li
            part="dropdown-item"
            role="option"
            tabindex="-1"
            data-value=${key}
            aria-selected=${this.condition.name === key}
            ?selected=${this.condition.name === key}
          >
            ${renderIcon(key)}<span>${operand?.label ?? key}</span>
          </li>
        `
      )}
    </ul>`;
  }

  protected renderDropdownTarget() {
    return html`<button
      id="condition"
      type="button"
      part="condition-trigger"
      aria-label="Change filter condition"
      aria-haspopup="listbox"
      aria-expanded=${this.dropdownOpen ? 'true' : 'false'}
      @click=${this.#openDropdownList}
    >
      ${renderIcon(this.condition.name)}
    </button>`;
  }

  protected renderInputArea() {
    return html`<div part="filter-field">
      ${this.renderDropdownTarget()}
      <input
        part="filter-input"
        type="text"
        .value=${ifDefined(this.expression.searchTerm as string | undefined) as string}
        placeholder="Add filter value"
        ?readonly=${this.condition.unary}
        @input=${this.#handleInput}
        @keydown=${this.#handleKeydown}
      />
      ${this.renderDropdown()}
    </div>`;
  }

  protected renderActiveState() {
    return html`<div part="active-state">
      <div part="filter-row-input">${this.renderInputArea()}</div>
      <div part="filter-row-filters">${this.renderActiveChips()}</div>
      <div part="filter-row-actions">${this.renderFilterActions()}</div>
    </div> `;
  }

  protected renderInactiveChips(column: ColumnConfiguration<T>, state: FilterExpressionTree<T>) {
    return Array.from(state).map((expression, idx) => {
      const props: ExpressionChipProps<T> = {
        expression,
        selected: false,
        onRemove: this.#chipRemoveFor(expression),
        onSelect: async (e: Event) => {
          e.stopPropagation();
          this.column = column;
          this.expression = expression;
          this.#show();
        },
      };

      return html`${this.renderCriteriaButton(expression, idx)}${this.renderExpressionChip(props)}`;
    });
  }

  protected renderFilterState(column: ColumnConfiguration<T>) {
    const state = this.filterController.get(column.key);

    const partial = state && state.length < 3;
    const hidden = state && state.length >= 3;

    const open = () => {
      this.column = column;
      this.#setDefaultExpression();
      this.#show();
    };

    const count = hidden ? html`<span part="filter-chip-count">${state.length}</span>` : nothing;
    const chip = html`<button
      part="filter-chip"
      type="button"
      data-column=${column.key}
      @click=${open}
    >
      ${renderIcon('filter')}<span>Filter</span>${count}
    </button>`;

    return partial ? this.renderInactiveChips(column, state) : chip;
  }

  protected renderInactiveState() {
    const pinOffsets = this.state.pinOffsets;
    const displayColumns = getDisplayColumns(this.state.host.columns);
    // Reserve a track to align with the row's selection checkbox column.
    const selectionPlaceholder = this.state.selection.showCheckboxColumn
      ? html`<div part="filter-row-preview" data-pinned="start"></div>`
      : nothing;
    // And another for the row's expansion chevron column.
    const expansionPlaceholder = this.state.expansion.showToggleColumn
      ? html`<div part="filter-row-preview" data-pinned="start"></div>`
      : nothing;

    return html`${selectionPlaceholder}${expansionPlaceholder}${displayColumns.map(
      (column, index) => {
        if (column.hidden) return nothing;
        const offset = pinOffsets.get(column.key);
        const pinStyle =
          column.pinned && typeof offset === 'number' ? `--apex-pin-offset:${offset}px` : '';
        const edge = getPinEdge(displayColumns, index);
        return html`<div
          part="filter-row-preview"
          data-pinned=${column.pinned ?? 'none'}
          data-pin-edge=${edge ?? 'none'}
          style=${pinStyle}
        >
          ${column.filter ? this.renderFilterState(column) : nothing}
        </div>`;
      }
    )}`;
  }

  protected override render() {
    return html`${this.active ? this.renderActiveState() : this.renderInactiveState()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [ApexFilterRow.tagName]: ApexFilterRow<object>;
  }
}
