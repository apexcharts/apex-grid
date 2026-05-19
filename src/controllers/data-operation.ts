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

  protected get hasCustomSort() {
    return isDefined(this.host.dataPipelineConfiguration?.sort);
  }

  protected get hasCustomFilter() {
    return isDefined(this.host.dataPipelineConfiguration?.filter);
  }

  protected get hasCustomQuickFilter() {
    return isDefined(this.host.dataPipelineConfiguration?.quickFilter);
  }

  protected get customFilter() {
    return this.host.dataPipelineConfiguration!.filter!;
  }

  protected get customSort() {
    return this.host.dataPipelineConfiguration!.sort!;
  }

  protected get customQuickFilter() {
    return this.host.dataPipelineConfiguration!.quickFilter!;
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
    transformed = this.hasCustomQuickFilter
      ? await this.customQuickFilter({ data, grid: this.host, type: 'quickFilter' })
      : quickFilterTerm
        ? this.quickFiltering.apply(data, quickFilterTerm, this.host.columns)
        : data;

    transformed = this.hasCustomFilter
      ? await this.customFilter({ data: transformed, grid: this.host, type: 'filter' })
      : this.filtering.apply(transformed, filtering.state);

    transformed = this.hasCustomSort
      ? await this.customSort({ data: transformed, grid: this.host, type: 'sort' })
      : this.sorting.apply(transformed, sorting.state);

    return transformed;
  }
}
