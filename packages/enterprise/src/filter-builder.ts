import { type ColumnConfiguration, type GridLocaleKey, localize } from 'apex-grid';
import { registerComponent } from 'apex-grid/internal';
import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import {
  type AdvancedFilterCondition,
  type AdvancedFilterGroup,
  type AdvancedFilterModel,
  copyAdvancedFilter,
  defaultOperator,
  emptyAdvancedFilter,
  isNumericType,
  operandsForType,
  operatorsForType,
} from './features/advanced-filter.js';
import type { ApexGridEnterprise } from './grid-enterprise.js';

export const FILTER_BUILDER_TAG = 'apex-grid-filter-builder';

type AnyGrid = ApexGridEnterprise<Record<string, unknown>>;

/**
 * Enterprise **advanced filter builder**: a nested AND/OR visual query builder.
 * Compose conditions and sub-groups, then **Apply** to filter the grid through
 * its `applyAdvancedFilter` (client side on local data, owning column filtering
 * while active; under a server row model it is sent to the datasource as
 * `advancedFilterModel`) or **Clear** to remove it.
 *
 * A light-DOM sibling element — set its `grid` property and mount it beside the
 * grid. Pure UI on top of {@link ApexGridEnterprise.applyAdvancedFilter}.
 *
 * @element apex-grid-filter-builder
 *
 * @fires apex-advanced-filter-changed - After Apply / Clear, with `{ model }`.
 *
 * @csspart filter-builder - The panel container.
 * @csspart group - A join group.
 * @csspart join - The AND/OR toggle.
 * @csspart condition - A condition row.
 * @csspart actions - The footer button row.
 */
export class ApexGridFilterBuilder extends LitElement {
  public static get tagName(): string {
    return FILTER_BUILDER_TAG;
  }

  public static register(): void {
    registerComponent(ApexGridFilterBuilder);
  }

  public static override styles = css`
    :host {
      display: block;
      box-sizing: border-box;
      inline-size: 460px;
      font: 0.85rem/1.4 system-ui, sans-serif;
      color: #1f2328;
      background: #fff;
      border: 1px solid #d8dade;
      border-radius: 6px;
      box-shadow: 0 6px 16px rgb(0 0 0 / 12%);
      padding: 10px;
    }
    [part='group'] {
      border: 1px solid #e4e6ea;
      border-radius: 6px;
      padding: 8px;
      margin-block-start: 6px;
      background: #fbfbfc;
    }
    [part='group'][data-root] {
      margin-block-start: 0;
      border: 0;
      background: none;
      padding: 0;
    }
    [part='group-head'] {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-block-end: 6px;
    }
    [part='join'] {
      display: inline-flex;
      border: 1px solid #d0d3d7;
      border-radius: 4px;
      overflow: hidden;
    }
    [part='join'] button {
      font: inherit;
      border: 0;
      background: #fff;
      padding: 2px 10px;
      cursor: pointer;
    }
    [part='join'] button[aria-pressed='true'] {
      background: #2563eb;
      color: #fff;
    }
    [part='condition'] {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-block-start: 6px;
    }
    select,
    input {
      font: inherit;
      padding: 3px 5px;
      border: 1px solid #d0d3d7;
      border-radius: 4px;
      min-inline-size: 0;
    }
    [part='col'] {
      flex: 1 1 34%;
    }
    [part='op'] {
      flex: 1 1 34%;
    }
    [part='val'] {
      flex: 1 1 32%;
    }
    button[part='remove'] {
      border: 0;
      background: none;
      cursor: pointer;
      color: #6b7280;
      font-size: 1rem;
      line-height: 1;
      padding: 2px 4px;
    }
    [part='adders'] {
      display: flex;
      gap: 6px;
      margin-block-start: 6px;
    }
    [part='adders'] button,
    [part='actions'] button {
      font: inherit;
      padding: 3px 10px;
      border: 1px solid #d0d3d7;
      background: #fff;
      border-radius: 4px;
      cursor: pointer;
    }
    [part='actions'] {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      margin-block-start: 10px;
      border-block-start: 1px solid #eceef1;
      padding-block-start: 8px;
    }
    [part='apply'] {
      background: #2563eb !important;
      color: #fff;
      border-color: #2563eb !important;
    }
  `;

  /** The enterprise grid to filter. */
  @property({ attribute: false })
  public grid: AnyGrid | null = null;

  /**
   * The editable root group. An empty builder given a `grid` that already has
   * an advanced filter starts from a copy of `grid.advancedFilterModel`.
   * Edits stay in this draft until Apply, which hands the grid a snapshot.
   *
   * The draft is read from the grid only when `grid` is set. A filter applied
   * or cleared from code later (an async state restore, say) is not shown
   * here, and the next Apply replaces it: set `model` to a copy of
   * `grid.advancedFilterModel` after such a change to keep them in step.
   */
  @property({ attribute: false })
  public model: AdvancedFilterModel = emptyAdvancedFilter();

  #t = (key: GridLocaleKey, fallback: string): string =>
    localize(this.grid?.localeText, key) || fallback;

  /** The columns a new condition can pick (visible ones). */
  #columns(): Array<ColumnConfiguration<Record<string, unknown>>> {
    return (this.grid?.columns ?? []).filter((column) => !column.hidden && column.key != null);
  }

  /** Any grid column by key, hidden ones included, as the evaluator resolves it. */
  #column(key: string): ColumnConfiguration<Record<string, unknown>> | undefined {
    return this.grid?.columns.find((column) => column.key != null && String(column.key) === key);
  }

  #columnType(key: string) {
    return this.#column(key)?.type;
  }

  #newCondition(): AdvancedFilterCondition {
    const first = this.#columns()[0];
    const key = first ? String(first.key) : '';
    return { kind: 'condition', column: key, operator: defaultOperator(first?.type), value: '' };
  }

  #addCondition(group: AdvancedFilterGroup): void {
    group.children.push(this.#newCondition());
    this.requestUpdate();
  }

  #addGroup(group: AdvancedFilterGroup): void {
    group.children.push({ kind: 'group', join: 'and', children: [this.#newCondition()] });
    this.requestUpdate();
  }

  #remove(parent: AdvancedFilterGroup, index: number): void {
    parent.children.splice(index, 1);
    this.requestUpdate();
  }

  #setColumn(condition: AdvancedFilterCondition, key: string): void {
    condition.column = key;
    condition.operator = defaultOperator(this.#columnType(key));
    condition.value = '';
    this.requestUpdate();
  }

  #apply(): void {
    // A snapshot, so later edits to the draft wait for the next Apply.
    const applied = copyAdvancedFilter(this.model);
    this.grid?.applyAdvancedFilter(applied);
    // The event gets its own copy: a listener that keeps or binds the detail
    // (a controlled builder writing it back to model) must not get a handle
    // on the filter the grid applies.
    this.#emit(copyAdvancedFilter(applied));
  }

  #clear(): void {
    this.model = emptyAdvancedFilter();
    this.grid?.clearAdvancedFilter();
    this.#emit(emptyAdvancedFilter());
  }

  #emit(model: AdvancedFilterModel): void {
    this.dispatchEvent(
      new CustomEvent('apex-advanced-filter-changed', {
        detail: { model },
        bubbles: true,
        composed: true,
      })
    );
  }

  #renderCondition(
    condition: AdvancedFilterCondition,
    parent: AdvancedFilterGroup,
    index: number
  ): TemplateResult {
    const current = this.#column(condition.column);
    const type = current?.type;
    const operators = operatorsForType(type);
    // A condition on a hidden column keeps showing that column.
    const choices = current?.hidden ? [...this.#columns(), current] : this.#columns();
    const operand = operandsForType(type)[condition.operator];
    const unary = operand?.unary ?? false;

    return html`<div part="condition">
      <select
        part="col"
        aria-label=${this.#t('filterBuilder.column' as GridLocaleKey, 'Column')}
        .value=${condition.column}
        @change=${(e: Event) => this.#setColumn(condition, (e.target as HTMLSelectElement).value)}
      >
        ${choices.map(
          (column) =>
            html`<option
              value=${String(column.key)}
              .selected=${live(String(column.key) === condition.column)}
            >
              ${column.headerText ?? String(column.key)}
            </option>`
        )}
      </select>
      <select
        part="op"
        aria-label=${this.#t('filterBuilder.operator' as GridLocaleKey, 'Operator')}
        @change=${(e: Event) => {
          condition.operator = (e.target as HTMLSelectElement).value;
          this.requestUpdate();
        }}
      >
        ${
          // An operator this type does not offer (a saved model) shows as
          // itself, so the select does not pretend it is the first option.
          operand
            ? nothing
            : html`<option value=${condition.operator} disabled .selected=${live(true)}>
                ${condition.operator}
              </option>`
        }
        ${
          // Selection follows the model on each option, not via the select's
          // value: that commits before a column switch rewrites the options
          // in place, so it would land on whatever now sits at the old index.
          operators.map(
            (op) =>
              html`<option value=${op.name} .selected=${live(op.name === condition.operator)}>
              ${op.label}
            </option>`
          )
        }
      </select>
      ${
        unary
          ? nothing
          : type === 'boolean'
            ? html`<select
                part="val"
                aria-label=${this.#t('filterBuilder.value' as GridLocaleKey, 'Value')}
                .value=${String(condition.value ?? 'true')}
                @change=${(e: Event) => {
                  condition.value = (e.target as HTMLSelectElement).value;
                  this.requestUpdate();
                }}
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>`
            : html`<input
                part="val"
                type=${isNumericType(type) ? 'number' : 'text'}
                aria-label=${this.#t('filterBuilder.value' as GridLocaleKey, 'Value')}
                .value=${String(condition.value ?? '')}
                @input=${(e: Event) => {
                  condition.value = (e.target as HTMLInputElement).value;
                }}
              />`
      }
      <button
        part="remove"
        type="button"
        aria-label=${this.#t('filterBuilder.remove' as GridLocaleKey, 'Remove')}
        title=${this.#t('filterBuilder.remove' as GridLocaleKey, 'Remove')}
        @click=${() => this.#remove(parent, index)}
      >
        ✕
      </button>
    </div>`;
  }

  #renderGroup(
    group: AdvancedFilterGroup,
    parent: AdvancedFilterGroup | null,
    index: number
  ): TemplateResult {
    const isRoot = parent === null;
    const setJoin = (join: 'and' | 'or') => {
      group.join = join;
      this.requestUpdate();
    };
    return html`<div part="group" ?data-root=${isRoot}>
      <div part="group-head">
        <span part="join" role="group">
          <button
            type="button"
            aria-pressed=${group.join === 'and' ? 'true' : 'false'}
            @click=${() => setJoin('and')}
          >
            ${this.#t('filterBuilder.and' as GridLocaleKey, 'AND')}
          </button>
          <button
            type="button"
            aria-pressed=${group.join === 'or' ? 'true' : 'false'}
            @click=${() => setJoin('or')}
          >
            ${this.#t('filterBuilder.or' as GridLocaleKey, 'OR')}
          </button>
        </span>
        ${
          isRoot
            ? nothing
            : html`<button
                part="remove"
                type="button"
                aria-label=${this.#t('filterBuilder.removeGroup' as GridLocaleKey, 'Remove group')}
                title=${this.#t('filterBuilder.removeGroup' as GridLocaleKey, 'Remove group')}
                @click=${() => parent && this.#remove(parent, index)}
              >
                ✕
              </button>`
        }
      </div>
      ${group.children.map((child, i) =>
        child.kind === 'group'
          ? this.#renderGroup(child, group, i)
          : this.#renderCondition(child, group, i)
      )}
      <div part="adders">
        <button type="button" @click=${() => this.#addCondition(group)}>
          + ${this.#t('filterBuilder.addCondition' as GridLocaleKey, 'Condition')}
        </button>
        <button type="button" @click=${() => this.#addGroup(group)}>
          + ${this.#t('filterBuilder.addGroup' as GridLocaleKey, 'Group')}
        </button>
      </div>
    </div>`;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    const applied = this.grid?.advancedFilterModel;
    if (changed.has('grid') && applied && !this.model.children.length) {
      this.model = copyAdvancedFilter(applied);
    }
  }

  protected override render() {
    return html`<div part="filter-builder">
      ${this.#renderGroup(this.model, null, 0)}
      <div part="actions">
        <button part="clear" type="button" @click=${() => this.#clear()}>
          ${this.#t('filterBuilder.clear' as GridLocaleKey, 'Clear')}
        </button>
        <button part="apply" type="button" @click=${() => this.#apply()}>
          ${this.#t('filterBuilder.apply' as GridLocaleKey, 'Apply')}
        </button>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [FILTER_BUILDER_TAG]: ApexGridFilterBuilder;
  }
}
