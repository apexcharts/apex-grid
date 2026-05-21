import type { ReactiveController } from 'lit';
import { PIPELINE } from '../internal/constants.js';
import type { GridHost, PaginationState } from '../internal/types.js';

/**
 * Default pagination state used when no `pagination` configuration is provided.
 */
export const DEFAULT_PAGINATION = Object.freeze({
  mode: 'local' as const,
  page: 0,
  pageSize: 25,
  pageSizeOptions: Object.freeze([10, 25, 50, 100]) as readonly number[],
});

/**
 * Reactive controller that owns the grid's pagination state.
 *
 * @remarks
 * Exposes a state machine for the current `page` and `pageSize`, derives `pageCount`
 * from the host's data, and emits the cancellable `pageChanging` + `pageChanged`
 * events on the grid host. Page slicing itself is performed by
 * {@link PaginationDataOperation} so the controller does not mutate `dataView`.
 */
export class PaginationController<T extends object> implements ReactiveController {
  /**
   * The current zero-based page index.
   */
  public page: number = DEFAULT_PAGINATION.page;

  /**
   * The current page size.
   */
  public pageSize: number = DEFAULT_PAGINATION.pageSize;

  constructor(protected host: GridHost<T>) {
    this.host.addController(this);
  }

  public hostConnected() {}

  /**
   * Whether pagination is enabled on the host grid.
   */
  public get enabled(): boolean {
    return Boolean(this.host.pagination?.enabled);
  }

  /**
   * The total number of records before pagination is applied.
   *
   * @remarks
   * For `'local'` mode this is the post-filter, post-sort dataset length. For `'remote'`
   * mode the consumer must supply the value via `pagination.totalItems`.
   */
  public get totalItems(): number {
    const cfg = this.host.pagination;
    if (cfg?.mode === 'remote') {
      return Math.max(0, cfg?.totalItems ?? 0);
    }
    // @ts-expect-error - protected member access
    return this.host.dataState?.length ?? 0;
  }

  /**
   * The total number of pages for the current data view and `pageSize`.
   *
   * @remarks
   * Always at least `1` so a paginator can render a sensible "1 / 1" label for empty data.
   */
  public get pageCount(): number {
    if (!this.pageSize) return 1;
    return Math.max(1, Math.ceil(this.totalItems / this.pageSize));
  }

  /**
   * Returns the resolved {@link PaginationState} for the current host.
   */
  public get state(): PaginationState {
    return {
      page: this.page,
      pageSize: this.pageSize,
      pageCount: this.pageCount,
      totalItems: this.totalItems,
    };
  }

  /**
   * Clamps a candidate `page` index into the valid `[0, pageCount - 1]` range.
   *
   * @param page - The candidate page index.
   */
  public clamp(page: number): number {
    if (!Number.isFinite(page)) return 0;
    return Math.min(Math.max(0, Math.trunc(page)), Math.max(0, this.pageCount - 1));
  }

  /**
   * Re-clamps the current page after the dataset size (or `pageSize`) changes.
   *
   * @remarks
   * Called from the grid pipeline so paging never points past the last valid page.
   * Mutates `page` in place and requests a re-render when the value changes.
   */
  public reclamp(): void {
    const next = this.clamp(this.page);
    if (next !== this.page) {
      this.page = next;
      this.host.requestUpdate();
    }
  }

  #emitChanging(nextPage: number, nextPageSize: number) {
    return this.host.emitEvent('pageChanging', {
      detail: {
        page: this.page,
        pageSize: this.pageSize,
        nextPage,
        nextPageSize,
      },
      cancelable: true,
    });
  }

  #emitChanged() {
    this.host.announce(`Page ${this.page + 1} of ${this.pageCount}`);
    return this.host.emitEvent('pageChanged', { detail: this.state });
  }

  /**
   * Navigates to `page`, emitting the cancellable `pageChanging` event first and
   * the `pageChanged` event after the pipeline has applied.
   *
   * @param page - The target zero-based page index. Out-of-range values are clamped.
   * @returns `true` if the change was applied, `false` if it was cancelled or a no-op.
   */
  public async gotoPage(page: number): Promise<boolean> {
    const next = this.clamp(page);
    if (next === this.page) return false;

    if (!this.#emitChanging(next, this.pageSize)) {
      return false;
    }

    this.page = next;
    this.host.requestUpdate(PIPELINE);
    await this.host.updateComplete;
    this.#emitChanged();
    return true;
  }

  /**
   * Sets the current page size and resets to the first page.
   *
   * @param size - The new page size. Must be a positive integer.
   * @returns `true` if the change was applied, `false` if it was cancelled or a no-op.
   */
  public async setPageSize(size: number): Promise<boolean> {
    const next = Math.max(1, Math.trunc(size));
    if (next === this.pageSize) return false;

    if (!this.#emitChanging(0, next)) {
      return false;
    }

    this.pageSize = next;
    this.page = 0;
    this.host.requestUpdate(PIPELINE);
    await this.host.updateComplete;
    this.#emitChanged();
    return true;
  }

  /**
   * Navigates to the next page if not already on the last one.
   */
  public nextPage() {
    return this.gotoPage(this.page + 1);
  }

  /**
   * Navigates to the previous page if not already on the first one.
   */
  public previousPage() {
    return this.gotoPage(this.page - 1);
  }

  /**
   * Navigates to the first page.
   */
  public firstPage() {
    return this.gotoPage(0);
  }

  /**
   * Navigates to the last page.
   */
  public lastPage() {
    return this.gotoPage(this.pageCount - 1);
  }
}
