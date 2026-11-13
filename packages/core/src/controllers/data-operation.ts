import type { ReactiveController } from 'lit';
import { isDefined } from '../internal/is-defined.js';
import type { GridHost } from '../internal/types.js';
import FilterDataOperation from '../operations/filter.js';
import QuickFilterDataOperation from '../operations/quick-filter.js';
import SortDataOperation from '../operations/sort.js';
import type { StateController } from './state.js';

export class DataOperationsController<T extends object> implements ReactiveController {
  protected sorting = new SortDataOperation<T>();
  protected filtering = new FilterDataOperation<T>();
  protected quickFiltering = new QuickFilterDataOperation<T>();

  constructor(protected host: GridHost<T>) {
    this.host.addController(this);
  }

  public hostConnected() {}

  /** The app's quick filter hook, or `undefined` for the built-in matcher. */
  protected get customQuickFilter() {
    return this.host.dataPipelineConfiguration?.quickFilter;
  }

  /** The app's filter hook, or `undefined` for the built-in column filter. */
  protected get customFilter() {
    return this.host.dataPipelineConfiguration?.filter;
  }

  /** The app's sort hook, or `undefined` for the built-in sort. */
  protected get customSort() {
    return this.host.dataPipelineConfiguration?.sort;
  }

  /**
   * Applies the quick-filter (global search), column-filter, and sort steps of the
   * data pipeline.
   *
   * @remarks
   * The returned dataset is the full post-filter, post-sort view. Pagination is
   * intentionally not applied here so callers can derive `totalItems` and the
   * paginator's `pageCount` from a stable value. The grid slices the page for
   * the virtualizer at render time.
   */
  public async apply(data: T[], state: StateController<T>) {
    const { filtering, sorting } = state;
    let transformed: T[];

    const quickFilterTerm = (this.host.quickFilter ?? '').trim();
    // Each hook is read at its own step, so a configuration swapped while an
    // earlier hook is awaited applies to the steps after it. Each hook is still
    // called with this controller as `this`, so a hook written as a method
    // that reads `this.host` keeps working.
    const quickFilterHook = this.customQuickFilter;
    transformed = isDefined(quickFilterHook)
      ? await quickFilterHook.call(this, { data, grid: this.host, type: 'quickFilter' })
      : quickFilterTerm
        ? this.quickFiltering.apply(data, quickFilterTerm, this.host.columns)
        : data;

    const filterHook = this.customFilter;
    transformed = isDefined(filterHook)
      ? await filterHook.call(this, { data: transformed, grid: this.host, type: 'filter' })
      : this.filtering.apply(transformed, filtering.state);

    const sortHook = this.customSort;
    transformed = isDefined(sortHook)
      ? await sortHook.call(this, { data: transformed, grid: this.host, type: 'sort' })
      : this.sorting.apply(transformed, sorting.state);

    // Manual row order (drag-reorder) is applied after sort. Identity
    // pass-through when no manual order is active, so the natural order is
    // untouched.
    transformed = state.rowReorder.apply(transformed);

    // Tree mode flattens the post-sort rows according to the current
    // expansion set. Disabled is a no-op pass-through, so flat tables keep
    // their existing behaviour untouched.
    if (state.tree.enabled) {
      transformed = state.tree.process(transformed);
    }

    // Feature modules (e.g. enterprise row grouping) may inject or reorder rows
    // after the built-in pipeline, before pagination slices the page. With no
    // modules registered this is an identity pass-through, so the community
    // `<apex-grid>` behaviour is unchanged.
    transformed = state.applyModuleTransforms(transformed);

    return transformed;
  }
}
