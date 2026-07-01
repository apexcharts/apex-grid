import { consume } from '@lit/context';
import { html, LitElement, nothing } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { gridStateContext, type StateController } from '../controllers/state.js';
import type { GridLocaleKey } from '../i18n/index.js';
import { DEFAULT_COLUMN_CONFIG } from '../internal/constants.js';
import { renderIcon } from '../internal/icons.js';
import { registerComponent } from '../internal/register.js';
import { GRID_FILTER_ROW_TAG } from '../internal/tags.js';
import type { ColumnConfiguration } from '../internal/types.js';
import { getFilterOperandsFor } from '../internal/utils.js';
import { watch } from '../internal/watch.js';
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

  /** Bounding rect of the filter icon that opened this panel. Used for positioning. */
  @property({ attribute: false })
  public triggerRect: DOMRect | null = null;

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

  #applyCondition(key: OperandKeys<T[typeof this.column.key]>) {
    // XXX: Types
    this.expression.condition = (getFilterOperandsFor(this.column) as any)[key] as FilterOperation<
      T[keyof T]
    >;

    if (this.input?.value || this.expression.condition.unary) {
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
    const path = event.composedPath();

    // Close the condition dropdown if clicking outside it.
    if (this.dropdownOpen) {
      if (!path.includes(this.dropdown) && !path.includes(this.conditionElement)) {
        this.dropdownOpen = false;
      }
      return;
    }

    // Close the whole panel if clicking outside it.
    if (this.active && !path.includes(this)) {
      this.active = false;
    }
  };

  #handleDocumentKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;

    if (this.dropdownOpen) {
      event.stopPropagation();
      this.dropdownOpen = false;
      this.conditionElement?.focus();
      return;
    }

    if (this.active) {
      event.stopPropagation();
      this.active = false;
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
        if (this.input) this.input.value = '';
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
    this.#setDefaultExpression();
    this.requestUpdate();
  }

  #openDropdownList = () => {
    this.dropdownOpen = !this.dropdownOpen;
  };

  public override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('pointerdown', this.#handleOutsidePointer, true);
    document.addEventListener('keydown', this.#handleDocumentKey, true);
  }

  public override disconnectedCallback(): void {
    document.removeEventListener('pointerdown', this.#handleOutsidePointer, true);
    document.removeEventListener('keydown', this.#handleDocumentKey, true);
    super.disconnectedCallback();
  }

  @watch('active', { waitUntilFirstUpdate: true })
  protected async activeChanged() {
    if (this.active && this.triggerRect) {
      const panelWidth = 240;
      const viewportWidth = window.innerWidth;
      let left = this.triggerRect.left;
      // Clamp so the panel doesn't overflow the right edge of the viewport.
      if (left + panelWidth > viewportWidth - 8) {
        left = Math.max(8, viewportWidth - panelWidth - 8);
      }
      this.style.setProperty('--fp-top', `${this.triggerRect.bottom + 4}px`);
      this.style.setProperty('--fp-left', `${left}px`);
      this.setAttribute('data-active', '');
      await this.updateComplete;
      this.input?.select();
    } else {
      this.removeAttribute('data-active');
      this.style.removeProperty('--fp-top');
      this.style.removeProperty('--fp-left');
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
        this.input?.focus();
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
        aria-label=${this.state.localize('filter.removeFilter')}
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
        ${renderIcon('refresh')} ${this.state.localize('filter.reset')}
      </button>
      <button
        id="close"
        type="button"
        part="action"
        @click=${() => {
          this.active = false;
        }}
      >
        ${renderIcon('close')} ${this.state.localize('filter.close')}
      </button>
    `;
  }

  protected renderDropdown() {
    return html`<ul
      part="dropdown"
      role="listbox"
      aria-label=${this.state.localize('filter.conditionList')}
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
            ${renderIcon(key)}<span
              >${this.state.localize(
                `filter.operator.${key}` as GridLocaleKey,
                undefined,
                operand?.label ?? key
              )}</span
            >
          </li>
        `
      )}
    </ul>`;
  }

  protected renderDropdownTarget() {
    const conditionLabel = this.state.localize(
      `filter.operator.${this.condition.name}` as GridLocaleKey,
      undefined,
      (this.condition as FilterOperation<T>).label ?? this.condition.name
    );
    return html`<button
      id="condition"
      type="button"
      part="condition-trigger"
      aria-label=${this.state.localize('filter.changeCondition')}
      aria-haspopup="listbox"
      aria-expanded=${this.dropdownOpen ? 'true' : 'false'}
      @click=${this.#openDropdownList}
    >
      <span>${conditionLabel}</span>
      ${renderIcon('chevron-down')}
    </button>`;
  }

  protected renderActiveState() {
    const hasChips = Boolean(this.filterController.get(this.column.key)?.length);
    return html`
      <div part="panel">
        <div part="condition-row">
          ${this.renderDropdownTarget()}
          ${this.renderDropdown()}
        </div>
        ${
          !this.condition.unary
            ? html`<div part="panel-input-row">
              <input
                part="filter-input"
                type="text"
                .value=${(this.expression?.searchTerm as string) ?? ''}
                placeholder=${this.state.localize('filter.inputPlaceholder')}
                @input=${this.#handleInput}
                @keydown=${this.#handleKeydown}
              />
            </div>`
            : nothing
        }
        ${hasChips ? html`<div part="chips-row">${this.renderActiveChips()}</div>` : nothing}
        <div part="panel-footer">${this.renderFilterActions()}</div>
      </div>
    `;
  }

  protected override render() {
    return html`${this.active ? this.renderActiveState() : nothing}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [ApexFilterRow.tagName]: ApexFilterRow<object>;
  }
}
