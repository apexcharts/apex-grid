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
 * events on the grid host. The page slice itself is read from
 * {@link ApexGrid.pageItems}, so the controller never mutates `dataView`.
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
   * The number of rows paged through (see {@link ApexGrid.totalItems}).
   *
   * @remarks
   * For `'local'` mode this is the post-filter, post-sort row count; with pagination
   * enabled it leaves out the pinned rows, so it counts the rows {@link ApexGrid.pageItems}
   * slices. For `'remote'` mode the consumer supplies the value via `pagination.totalItems`.
   */
  public get totalItems(): number {
    const cfg = this.host.pagination;
    if (cfg?.mode === 'remote') {
      return Math.max(0, cfg?.totalItems ?? 0);
    }
    // @ts-expect-error - protected member access
    return (this.enabled ? this.host.bodyRows : this.host.dataState)?.length ?? 0;
  }

  /**
   * The total number of pages for the current data view and `pageSize`.
   *
   * @remarks
   * Always at least `1` so a paginator can render a sensible "1 / 1" label for empty data.
   */
  public get pageCount(): number {
    return this.state.pageCount;
  }

  /**
   * Returns the resolved {@link PaginationState} for the current host.
   */
  public get state(): PaginationState {
    return this.#stateFor(this.page, this.pageSize);
  }

  /** The state for `page` and `pageSize` over the rows the grid holds now. */
  #stateFor(page: number, pageSize: number): PaginationState {
    const totalItems = this.totalItems;
    const pageCount = pageSize ? Math.max(1, Math.ceil(totalItems / pageSize)) : 1;
    return { page, pageSize, pageCount, totalItems };
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

  /**
   * Applies `page` and `pageSize`, then fires `pageChanged` for that change
   * once it rendered. The detail is this change, not whatever page a later
   * call moved to meanwhile, so two unawaited calls report two pages. In
   * local mode the body slice is read from {@link ApexGrid.pageItems} on
   * render, so the data pipeline does not rerun; in remote mode it does, so
   * a pipeline hook that fetches the page by `grid.page` sees the new page.
   */
  async #apply(page: number, pageSize: number): Promise<void> {
    this.page = page;
    this.pageSize = pageSize;
    // Row recycling re-binds the focused row to the new page's record, so
    // focus moves to the body rather than stay on the same slot.
    // @ts-expect-error - protected member access
    const parked = this.host.stateController.navigation.parkFocus() as (() => Promise<void>) | null;
    this.host.requestUpdate(this.host.pagination?.mode === 'remote' ? PIPELINE : undefined);
    try {
      // @ts-expect-error - protected member access
      await this.host.pipelineSettled();
    } finally {
      if (parked) void parked();
    }
    const detail = this.#stateFor(page, pageSize);
    this.host.announce(
      this.host.localize('announce.page', { page: page + 1, total: detail.pageCount })
    );
    this.host.emitEvent('pageChanged', { detail });
  }

  /**
   * Navigates to `page`, emitting the cancellable `pageChanging` event first and
   * the `pageChanged` event after the change rendered.
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

    await this.#apply(next, this.pageSize);
    return true;
  }

  /**
   * Moves to the first page as part of a change already confirmed (a new
   * quick filter), so without `pageChanging`; fires `pageChanged` once the
   * pipeline settled when the page actually moved.
   */
  public async resetPage(): Promise<void> {
    if (this.page !== 0) await this.#apply(0, this.pageSize);
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

    await this.#apply(0, next);
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
