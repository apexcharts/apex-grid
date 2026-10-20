import type { ReactiveController } from 'lit';
import type { ApexFilteredEvent } from '../components/grid.js';
import { PIPELINE } from '../internal/constants.js';
import type { ColumnConfiguration, GridHost, Keys } from '../internal/types.js';
import { asArray, getFilterOperandsFor } from '../internal/utils.js';
import { FilterState } from '../operations/filter/state.js';
import type { FilterExpression } from '../operations/filter/types.js';

export class FilterController<T extends object> implements ReactiveController {
  constructor(protected host: GridHost<T>) {
    this.host.addController(this);
  }

  public state: FilterState<T> = new FilterState();

  public get filterRow() {
    // @ts-expect-error - protected access
    return this.host.filterRow;
  }

  #emitFilteringEvent(expression: FilterExpression<T>, type: 'add' | 'modify' | 'remove') {
    return this.host.emitEvent('filtering', {
      detail: {
        key: expression.key,
        expressions: [expression],
        type,
      },
      cancelable: true,
    });
  }

  #emitFilteredEvent(detail?: ApexFilteredEvent<T>) {
    return this.host.emitEvent('filtered', { detail });
  }

  #filter(expression: FilterExpression<T> | FilterExpression<T>[]) {
    for (const expr of asArray(expression)) {
      this.state.set(expr);
    }

    this.#touched = true;
    this.host.requestUpdate(PIPELINE);
  }

  /** The filter as of the last host update, to tell a change from a reapply. */
  #applied: unknown[] = [];
  /** Set by every write to the filter state; checked at the next update. */
  #touched = false;

  public hostConnected() {}

  public hostUpdate(): void {
    if (this.#touched) {
      this.#touched = false;
      const next = snapshot(this.state);
      // A changed match set starts at its first row. The grid host owns
      // vertical scrolling (the virtualizer is not a scroller), so reset it
      // there; left alone, a deep offset is clamped to the end of a shorter
      // result. Reapplying the same filter (setState(getState()), or a
      // wrapper that assigns filterExpressions on every render) keeps the
      // position.
      if (!sameFilter(this.#applied, next)) this.host.scrollTop = 0;
      this.#applied = next;
    }
    this.filterRow?.requestUpdate();
  }

  public get(key: Keys<T>) {
    return this.state.get(key);
  }

  public reset(key?: Keys<T>) {
    key ? this.state.delete(key) : this.state.clear();
    this.#touched = true;
  }

  public setActiveColumn(column?: ColumnConfiguration<T>, triggerRect?: DOMRect) {
    const filterRow = this.filterRow;
    if (!filterRow) return;

    if (!column?.filter) {
      filterRow.active = false;
      return;
    }

    // Toggle: clicking the same column's filter while the panel is open closes it.
    if (filterRow.active && filterRow.column?.key === column.key) {
      filterRow.active = false;
      return;
    }

    filterRow.triggerRect = triggerRect ?? null;
    filterRow.column = column;
    filterRow.expression = this.getDefaultExpression(column);
    filterRow.active = true;
    this.host.requestUpdate();
  }

  public getDefaultExpression(column: ColumnConfiguration<T>) {
    const caseSensitive =
      typeof column.filter === 'boolean' ? false : Boolean(column.filter?.caseSensitive);
    const operands = getFilterOperandsFor(column);
    const keys = Object.keys(operands) as Keys<typeof operands>[];

    // XXX: Types
    return {
      key: column.key,
      condition: operands[keys[0]],
      caseSensitive,
    } as unknown as FilterExpression<T>;
  }

  public async removeAllExpressions(key: Keys<T>) {
    // Nothing to clear: no events and no announcement.
    if (!this.state.has(key)) return;
    const state = this.get(key)?.all ?? [];

    if (
      !this.host.emitEvent('filtering', {
        detail: {
          key,
          expressions: state,
          type: 'remove',
        },
        cancelable: true,
      })
    ) {
      return;
    }

    this.reset(key);
    this.#filter([]);

    await this.host.updateComplete;
    this.#announce(key, 'cleared');
    this.#emitFilteredEvent({ key, state: this.get(key)?.all ?? [] });
  }

  /** Resolves to false when nothing was removed (not applied, or cancelled). */
  public async removeExpression(expression: FilterExpression<T>) {
    const state = this.get(expression.key);
    // An expression that was never applied (the panel's draft) is a no-op.
    if (!state?.has(expression)) return false;

    if (!this.#emitFilteringEvent(expression, 'remove')) {
      return false;
    }

    state.remove(expression);

    if (state.empty) {
      this.reset(state.key);
    }

    this.#filter([]);

    await this.host.updateComplete;
    this.#announce(expression.key, 'cleared');
    this.#emitFilteredEvent({ key: expression.key, state: state.all });
    return true;
  }

  /**
   * Emits the cancelable `filtering` event for `expression` and applies it
   * when the event passes. With a `target` (the panel's draft or an applied
   * expression), `expression` is the proposed copy: it is written into
   * `target` only after the event passes, so a cancelled change leaves the
   * applied filter untouched. Resolves to false when cancelled.
   */
  public async filterWithEvent(
    expression: FilterExpression<T>,
    type: 'add' | 'modify' | 'remove',
    target = expression
  ) {
    if (!this.#emitFilteringEvent(expression, type)) {
      return false;
    }

    this.#filter(Object.assign(target, expression));

    await this.host.updateComplete;
    // Announce only on `add`: `modify` fires per keystroke while typing a
    // filter value and would flood the live region.
    if (type === 'add') this.#announce(target.key, 'applied');
    this.#emitFilteredEvent({ key: target.key, state: this.get(target.key)?.all ?? [] });
    return true;
  }

  #announce(key: Keys<T>, kind: 'applied' | 'cleared') {
    const column = this.host.getColumn(key);
    const label = column?.headerText ?? String(key);
    this.host.announce(
      this.host.localize(kind === 'applied' ? 'announce.filtered' : 'announce.filterCleared', {
        label,
      })
    );
  }

  public filter(expression: FilterExpression<T> | FilterExpression<T>[]) {
    this.#filter(
      asArray(expression).map((expr) => {
        const defaults = this.getDefaultExpression(this.host.getColumn(expr.key)!);
        // An omitted or undefined field keeps the column default, so a
        // caseSensitive: undefined from setState or an AI patch inherits the
        // column's filter.caseSensitive instead of overriding it.
        return Object.assign(defaults, expr, {
          condition: expr.condition ?? defaults.condition,
          caseSensitive: expr.caseSensitive ?? defaults.caseSensitive,
        });
      })
    );
  }
}

/**
 * The parts of every applied expression that decide the match set, flattened
 * in state order. Values are captured, so a later in-place edit of an
 * expression (the filter panel's draft) still reads as a change.
 */
function snapshot<T>(state: FilterState<T>): unknown[] {
  const out: unknown[] = [];
  for (const tree of state.values) {
    for (const e of tree) out.push(e.key, e.condition, e.searchTerm, e.criteria, e.caseSensitive);
  }
  return out;
}

function sameFilter(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (Object.is(x, y)) continue;
    if (x instanceof Date && y instanceof Date && x.getTime() === y.getTime()) continue;
    // Array terms (a set filter's values) are copied by getState and setState.
    if (Array.isArray(x) && Array.isArray(y) && sameFilter(x, y)) continue;
    return false;
  }
  return true;
}
