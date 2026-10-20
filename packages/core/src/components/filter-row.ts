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
    return this.state.isNumericColumn(this.column);
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
    return this.filterController.removeExpression(expression);
  }

  #isApplied(expression: FilterExpression<T>) {
    return Boolean(this.filterController.get(expression.key)?.has(expression));
  }

  /**
   * Proposes `change` to `expression` through the cancelable `filtering`
   * event: `add` while the expression is the draft, `modify` once it is
   * applied. The expression itself changes only when the event passes.
   */
  #commit(expression: FilterExpression<T>, change: Record<string, unknown>) {
    return this.filterController.filterWithEvent(
      { ...expression, ...change } as FilterExpression<T>,
      this.#isApplied(expression) ? 'modify' : 'add',
      expression
    );
  }

  async #applyCondition(key: OperandKeys<T[typeof this.column.key]>) {
    const expression = this.expression;
    // XXX: Types
    const condition = (getFilterOperandsFor(this.column) as any)[key] as FilterOperation<
      T[keyof T]
    >;
    const term = expression.searchTerm;

    if (condition.unary || (term != null && term !== '')) {
      await this.#commit(expression, { condition });
    } else if (!this.#isApplied(expression) || (await this.#removeExpression(expression))) {
      // A binary condition without a term filters nothing yet: it stays the
      // draft until a term is typed, and an applied unary filter is dropped.
      expression.condition = condition;
    }

    this.requestUpdate();
  }

  #selectOption(target: HTMLElement | null) {
    if (!target) return;
    const value = target.dataset.value as OperandKeys<T[typeof this.column.key]>;
    this.#applyCondition(value);
    this.dropdownOpen = false;
    this.input?.focus();
  }

  #handleDropdownItemClick = (event: Event) => {
    event.stopPropagation();
    this.#selectOption((event.target as HTMLElement).closest<HTMLElement>('[data-value]'));
  };

  #dropdownOptions(): HTMLElement[] {
    return Array.from(this.dropdown?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
  }

  /** Moves focus into the dropdown, landing on the selected (or first) option. */
  #focusDropdownOption() {
    requestAnimationFrame(() => {
      const options = this.#dropdownOptions();
      (options.find((option) => option.matches('[aria-selected="true"]')) ?? options[0])?.focus();
    });
  }

  /** ArrowDown on the condition trigger opens the listbox and focuses into it. */
  #handleTriggerKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'Down') return;
    event.preventDefault();
    event.stopPropagation();
    this.dropdownOpen = true;
    this.#focusDropdownOption();
  };

  /** Listbox keyboard pattern: arrows/Home/End rove, Enter/Space pick. */
  #handleDropdownKeydown = (event: KeyboardEvent) => {
    const options = this.#dropdownOptions();
    const current = options.findIndex((option) => option.matches(':focus'));
    switch (event.key) {
      case 'ArrowDown':
      case 'Down':
        event.preventDefault();
        event.stopPropagation();
        options[Math.min(current + 1, options.length - 1)]?.focus();
        return;
      case 'ArrowUp':
      case 'Up':
        event.preventDefault();
        event.stopPropagation();
        options[Math.max(current - 1, 0)]?.focus();
        return;
      case 'Home':
        event.preventDefault();
        event.stopPropagation();
        options[0]?.focus();
        return;
      case 'End':
        event.preventDefault();
        event.stopPropagation();
        options[options.length - 1]?.focus();
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        event.stopPropagation();
        this.#selectOption(options[current] ?? null);
        return;
      default:
        return;
    }
  };

  /** The filter button of the open column, found live so the panel tracks it. */
  #trigger() {
    return this.state.headerRow?.headers
      .find((header) => header.column.key === this.column.key)
      ?.renderRoot.querySelector('[part~="filter-btn"]');
  }

  /** Whether an event came from the panel or from the button that opened it. */
  #fromPanel(event: Event) {
    const path = event.composedPath();
    const trigger = this.#trigger();
    return path.includes(this) || (!!trigger && path.includes(trigger));
  }

  #handleOutsidePointer = (event: PointerEvent) => {
    const path = event.composedPath();

    // Close the condition dropdown if clicking outside it.
    if (this.dropdownOpen) {
      if (!path.includes(this.dropdown) && !path.includes(this.conditionElement)) {
        this.dropdownOpen = false;
      }
      return;
    }

    // Close the whole panel if clicking outside it. A press on the open
    // column's filter button is left to its click, which toggles the panel.
    if (this.active && !this.#fromPanel(event)) {
      this.active = false;
    }
  };

  #handleDocumentKey = (event: KeyboardEvent) => {
    // Escape belongs to whatever has focus outside the panel. With focus on
    // the page itself (a click on panel chrome drops it there) nobody else
    // owns it, so it still closes the panel.
    const origin = event.composedPath()[0];
    const unowned = origin === document.body || origin === document.documentElement;
    if (event.key !== 'Escape' || !this.active || !(unowned || this.#fromPanel(event))) return;

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

  async #handleInput(event: Event) {
    event.stopPropagation();

    const raw = (event.target as HTMLInputElement).value ?? '';
    const value = this.isNumeric ? Number.parseFloat(raw) : raw;
    const shouldUpdate = this.isNumeric ? !Number.isNaN(value as number) : !!value;
    const expression = this.expression;

    // A cancelled change leaves the typed text alone: the chip shows the
    // term still in effect, and resetting the input would fight the user.
    if (shouldUpdate) {
      await this.#commit(expression, { searchTerm: value });
    } else if (
      (!this.#isApplied(expression) || (await this.#removeExpression(expression))) &&
      raw === '' &&
      !this.#isApplied(expression)
    ) {
      // An emptied input leaves a draft with no term, as the input shows.
      // A partial number ('-', '.') keeps the old term so the value binding
      // does not wipe the typed character, and an input event that applied
      // the expression again while the removal settled keeps its term.
      expression.searchTerm = undefined;
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
    if (this.active) this.#listenForMoves(true);
  }

  public override disconnectedCallback(): void {
    document.removeEventListener('pointerdown', this.#handleOutsidePointer, true);
    document.removeEventListener('keydown', this.#handleDocumentKey, true);
    this.#listenForMoves(false);
    super.disconnectedCallback();
  }

  /** Keeps the panel under its trigger while the page or the grid scrolls or resizes. */
  #listenForMoves(on: boolean) {
    const method = on ? 'addEventListener' : 'removeEventListener';
    // Scroll does not bubble or cross shadow roots: capture the page's
    // scrollers on window and listen on the grid, which scrolls itself.
    window[method]('scroll', this.#position, true);
    window[method]('resize', this.#position);
    this.state?.host[method]('scroll', this.#position);
  }

  #position = () => {
    const rect = this.#trigger()?.getBoundingClientRect() ?? this.triggerRect;
    if (!rect) return;
    // Measured, so a root font size other than 16px still clamps correctly.
    const width = this.offsetWidth;
    const viewportWidth = window.innerWidth;
    let left = rect.left;
    // Clamp so the panel doesn't overflow the right edge of the viewport.
    if (left + width > viewportWidth - 8) {
      left = Math.max(8, viewportWidth - width - 8);
    }
    this.style.setProperty('--fp-top', `${rect.bottom + 4}px`);
    this.style.setProperty('--fp-left', `${left}px`);
  };

  /** Switching the open panel to another column moves it under that column. */
  @watch('triggerRect', { waitUntilFirstUpdate: true })
  protected triggerChanged() {
    if (this.active) this.#position();
  }

  @watch('active', { waitUntilFirstUpdate: true })
  protected async activeChanged() {
    this.#listenForMoves(this.active);
    if (this.active) {
      this.setAttribute('data-active', '');
      this.#position();
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
      await this.#commit(expression, { criteria: expression.criteria === 'and' ? 'or' : 'and' });
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
      @keydown=${this.#handleDropdownKeydown}
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
      @keydown=${this.#handleTriggerKeydown}
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
