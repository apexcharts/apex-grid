import type { DataPipelineConfiguration, FilterExpression, SortExpression } from 'apex-grid';
import type { AdvancedFilterModel } from './advanced-filter.js';

export const ROWS_LOADED_EVENT = 'apex-rows-loaded';

/** Fired on the grid when a block request rejects; see {@link RowsLoadFailedDetail}. */
export const ROWS_LOAD_FAILED_EVENT = 'apex-rows-load-failed';

/**
 * How the infinite and server-side row models retry a `getRows` call that
 * rejects. Retries are bounded: after the last one the rows are reported
 * failed (a load-failed event with `retrying: false`) and are not requested
 * again until the next refresh, sort or filter change.
 */
export interface RowLoadRetryConfig {
  /**
   * Times a rejected request is retried. Default `2`; `0` turns retrying off.
   * Capped at `10` (so `Infinity` means 10); `NaN` uses the default.
   */
  maxRetries?: number;
  /**
   * Milliseconds before the first retry, doubled for each later one. Default
   * `1000`; a value that is not a finite number uses the default.
   */
  retryDelay?: number;
}

/**
 * Calls `request`, retrying a rejection as {@link RowLoadRetryConfig} says.
 * `failed` hears every rejection and whether another attempt follows. Gives up
 * quietly once `current()` turns false (a newer request generation). Resolves
 * to the result, or `undefined` when every attempt failed or the request went
 * stale.
 */
export async function fetchWithRetry<R>(
  request: () => Promise<R> | R,
  config: RowLoadRetryConfig,
  current: () => boolean,
  failed: (error: unknown, retrying: boolean) => void
): Promise<R | undefined> {
  const max = config.maxRetries;
  const retries = Math.min(10, Math.max(0, max === undefined || Number.isNaN(max) ? 2 : max));
  const wait = config.retryDelay;
  const delay = Number.isFinite(wait) ? Math.max(0, wait as number) : 1000;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      if (!current()) return undefined;
      const retrying = attempt < retries;
      failed(error, retrying);
      if (!retrying) return undefined;
      await new Promise((resolve) => setTimeout(resolve, delay * 2 ** attempt));
      if (!current()) return undefined;
    }
  }
}

/** The query fields a server row model sends with every request. */
export interface ServerQueryHost<T extends object> {
  quickFilter?: string;
  readonly sortExpressions: SortExpression<T>[];
  readonly filterExpressions: FilterExpression<T>[];
  readonly advancedFilterModel?: AdvancedFilterModel | null;
}

/**
 * Serialized server query (sort, filter, quick filter and advanced filter),
 * compared to decide whether to refetch. Covers every field a datasource
 * receives, including a filter's AND/OR `criteria` and `caseSensitive`, so
 * toggling either reloads. The one serializer for both server row models and
 * the grid's view signature.
 */
export function serverQueryKey<T extends object>(host: ServerQueryHost<T>): string {
  return JSON.stringify([
    host.sortExpressions.map((expr) => [expr.key, expr.direction, expr.caseSensitive]),
    host.filterExpressions.map((expr) => {
      const condition = expr.condition as { name?: string } | string | undefined;
      const term: unknown = expr.searchTerm;
      return [
        expr.key,
        typeof condition === 'string' ? condition : condition?.name,
        term !== null && typeof term === 'object' ? JSON.stringify(term) : String(term),
        expr.criteria,
        expr.caseSensitive,
      ];
    }),
    host.quickFilter ?? '',
    host.advancedFilterModel ?? null,
  ]);
}

/**
 * The pipeline a server row model runs on while it is active: every hook
 * passes the rows through (the server owns ordering and filtering) and calls
 * `onPass` first, since the hooks run on every pipeline pass and so notice a
 * header click and a programmatic sort or filter change alike.
 */
export function passthroughPipeline<T extends object>(
  onPass: () => void
): DataPipelineConfiguration<T> {
  const hook = (params: { data: T[] }) => {
    onPass();
    return params.data;
  };
  return { sort: hook, filter: hook, quickFilter: hook };
}

/** The block of rows the grid is asking the datasource to fetch. */
export interface InfiniteGetRowsParams<T extends object> {
  /** First row index to fetch (inclusive). */
  readonly startRow: number;
  /** One past the last row index to fetch (exclusive). */
  readonly endRow: number;
  /** Current sort model (server should order by this). */
  readonly sortModel: SortExpression<T>[];
  /** Current filter model (server should filter by this). */
  readonly filterModel: FilterExpression<T>[];
  /** Current quick-filter (global search) term. */
  readonly quickFilter: string;
  /**
   * The advanced filter (`grid.applyAdvancedFilter`, the filter builder), or
   * `null`. A server row model sends it here instead of filtering the loaded
   * rows, so the server should apply it. On client data it replaces the column
   * filters while applied, so a server matching that ignores `filterModel`
   * when this is set. The exported `filterRows` evaluates it the way the grid
   * does on client data.
   */
  readonly advancedFilterModel: AdvancedFilterModel | null;
}

/** What the datasource returns for a block request. */
export interface InfiniteGetRowsResult<T extends object> {
  /** The rows for the requested block. */
  readonly rows: T[];
  /**
   * Total row count for the current query, if known. Omit for "infinite" mode:
   * the model keeps a trailing placeholder block and finalizes the count when a
   * block returns fewer rows than {@link InfiniteRowModelConfig.blockSize}.
   */
  readonly rowCount?: number;
}

/** A lazy block-loading datasource. */
export interface InfiniteDataSource<T extends object> {
  getRows(
    params: InfiniteGetRowsParams<T>
  ): Promise<InfiniteGetRowsResult<T>> | InfiniteGetRowsResult<T>;
}

/**
 * Configuration for the infinite (server-side, lazy-scroll) row model. A
 * rejected block is retried as {@link RowLoadRetryConfig} says.
 */
export interface InfiniteRowModelConfig<T extends object> extends RowLoadRetryConfig {
  /** The block-loading datasource. */
  datasource: InfiniteDataSource<T>;
  /** Rows per fetched block. Default `100`. */
  blockSize?: number;
  /** Initial row-count estimate before the first block resolves. Default `blockSize`. */
  initialRowCount?: number;
}

/** Detail of the {@link ROWS_LOADED_EVENT} fired on the grid. */
export interface RowsLoadedDetail {
  /** Current total (known or estimated). */
  readonly rowCount: number;
  /** Whether `rowCount` is the exact total (vs a scroll-ahead estimate). */
  readonly exact: boolean;
  /** Number of blocks currently cached. */
  readonly loadedBlocks: number;
  /** Rows per block. */
  readonly blockSize: number;
}

/** Detail of the {@link ROWS_LOAD_FAILED_EVENT} fired on the grid. */
export interface RowsLoadFailedDetail {
  /** First row index of the failed block (inclusive). */
  readonly startRow: number;
  /** One past the last row index of the failed block (exclusive). */
  readonly endRow: number;
  /** What `getRows` rejected with. */
  readonly error: unknown;
  /**
   * Whether the block is requested again (see {@link RowLoadRetryConfig}). When
   * `false` its rows stay placeholders until `refreshRows()` or a sort or
   * filter change.
   */
  readonly retrying: boolean;
}

/** The minimal grid surface the manager drives (avoids a circular import). */
export interface InfiniteHost<T extends object> extends ServerQueryHost<T> {
  data: T[];
  readonly shadowRoot: ShadowRoot | null;
  addEventListener: HTMLElement['addEventListener'];
  removeEventListener: HTMLElement['removeEventListener'];
  dispatchEvent: HTMLElement['dispatchEvent'];
}

/** A range event from the body virtualizer. */
interface RangeEvent extends Event {
  first: number;
  last: number;
}

/**
 * Enterprise feature: **infinite (server-side) row model**. Instead of holding
 * all rows in `data`, the grid lazily fetches fixed-size blocks from a
 * {@link InfiniteDataSource} as the user scrolls, and pushes sort / filter /
 * quick-filter changes to the server.
 *
 * Implementation: the manager keeps a block cache and rebuilds `grid.data` as a
 * placeholder array of the (known or estimated) total length, patching in
 * loaded blocks. Client-side sort/filter are disabled via the passthrough
 * `pipeline`, which the grid installs (the server owns ordering), and the
 * body virtualizer's `rangeChanged` event drives which blocks to fetch — so the
 * feature needs no core change.
 */
export class InfiniteRowModelManager<T extends object> {
  readonly #blockSize: number;
  readonly #placeholder: T = Object.freeze({}) as T;

  #rowCount: number;
  #exact = false;
  readonly #loaded = new Map<number, T[]>();
  readonly #loading = new Set<number>();
  /** Blocks that failed for good this generation, not requested again until a reset. */
  readonly #failed = new Set<number>();
  #started = false;
  /** Generation token — bumped on reset so in-flight stale blocks are dropped. */
  #seq = 0;
  #range = { first: 0, last: 0 };
  /** Serialized sort/filter/quick-filter query — refetch when it changes. */
  #lastKey = '';
  #resetQueued = false;
  #virtualizer: HTMLElement | null = null;
  readonly #pipeline = passthroughPipeline<T>(() => {
    if (this.#started) this.#detectChange();
  });

  constructor(
    private config: InfiniteRowModelConfig<T>,
    private host: InfiniteHost<T>
  ) {
    this.#blockSize = Math.max(1, config.blockSize ?? 100);
    this.#rowCount = config.initialRowCount ?? this.#blockSize;
  }

  // --- lifecycle -----------------------------------------------------------

  /** Begin server-side mode: initial fetch. The grid then installs `pipeline`. */
  public start(): void {
    this.#started = true;
    this.#lastKey = serverQueryKey(this.host);
    this.reset();
  }

  /**
   * Tear down: drop in-flight blocks and remove the listener. The grid then
   * puts back the pipeline it composes without this model.
   */
  public stop(): void {
    this.#seq += 1;
    this.#loading.clear();
    this.#virtualizer?.removeEventListener('rangeChanged', this.#onRange as EventListener);
    this.#virtualizer = null;
    this.#started = false;
  }

  /**
   * The passthrough pipeline while started, else `null`. Its hooks refetch on
   * a query change and do nothing more once the model stopped.
   */
  public get pipeline(): DataPipelineConfiguration<T> | null {
    return this.#started ? this.#pipeline : null;
  }

  /** Attach the virtualizer range listener (idempotent; call after render). */
  public attach(): void {
    this.#virtualizer = listenForRange(this.host, this.#virtualizer, this.#onRange);
  }

  // --- public API ----------------------------------------------------------

  /** Whether a row is an unloaded placeholder (e.g. to render a skeleton). */
  public isPlaceholder(row: unknown): boolean {
    return row === this.#placeholder;
  }

  /** Discard the cache and refetch from the top (e.g. after a server-side mutation). */
  public refresh(): void {
    this.reset();
  }

  /** Reset cache + counts and reload the first block and the visible range. */
  public reset(): void {
    this.#seq += 1;
    this.#loaded.clear();
    this.#loading.clear();
    this.#failed.clear();
    this.#exact = false;
    this.#rowCount = this.config.initialRowCount ?? this.#blockSize;
    this.#rebuild();
    this.#loadBlock(0);
    this.#ensureBlocksForRange(this.#range.first, this.#range.last);
  }

  // --- internals -----------------------------------------------------------

  #detectChange(): void {
    const key = serverQueryKey(this.host);
    if (key === this.#lastKey) return;
    this.#lastKey = key;
    this.#scheduleReset();
  }

  #scheduleReset(): void {
    if (this.#resetQueued) return;
    this.#resetQueued = true;
    queueMicrotask(() => {
      this.#resetQueued = false;
      this.reset();
    });
  }

  #onRange = (event: RangeEvent): void => {
    this.#range = { first: event.first, last: event.last };
    this.#ensureBlocksForRange(event.first, event.last);
  };

  #ensureBlocksForRange(first: number, last: number): void {
    const firstBlock = Math.floor(Math.max(0, first) / this.#blockSize);
    // Prefetch one block past the visible window.
    const lastBlock = Math.floor(Math.max(first, last) / this.#blockSize) + 1;
    for (let block = firstBlock; block <= lastBlock; block += 1) {
      if (this.#exact && block * this.#blockSize >= this.#rowCount) break;
      void this.#loadBlock(block);
    }
  }

  async #loadBlock(block: number): Promise<void> {
    if (this.#loaded.has(block) || this.#loading.has(block) || this.#failed.has(block)) return;
    this.#loading.add(block);
    const seq = this.#seq;
    const current = () => seq === this.#seq;
    const startRow = block * this.#blockSize;
    const endRow = startRow + this.#blockSize;

    const result = await fetchWithRetry(
      () =>
        this.config.datasource.getRows({
          startRow,
          endRow,
          sortModel: this.host.sortExpressions,
          filterModel: this.host.filterExpressions,
          quickFilter: this.host.quickFilter ?? '',
          advancedFilterModel: this.host.advancedFilterModel ?? null,
        }),
      this.config,
      current,
      (error, retrying) =>
        this.host.dispatchEvent(
          new CustomEvent<RowsLoadFailedDetail>(ROWS_LOAD_FAILED_EVENT, {
            detail: { startRow, endRow, error, retrying },
            bubbles: true,
            composed: true,
          })
        )
    );

    // A reset (sort/filter change, refresh, stop) happened while fetching: drop
    // this block and leave #loading alone, it belongs to the newer generation.
    if (!current()) return;
    this.#loading.delete(block);
    if (!result) {
      this.#failed.add(block);
      return;
    }
    this.#loaded.set(block, result.rows);

    if (typeof result.rowCount === 'number') {
      this.#rowCount = result.rowCount;
      this.#exact = true;
    } else if (result.rows.length < this.#blockSize) {
      // Short block ⇒ we've hit the end.
      this.#rowCount = startRow + result.rows.length;
      this.#exact = true;
    } else if (!this.#exact && startRow + result.rows.length + this.#blockSize > this.#rowCount) {
      // Keep a trailing placeholder block so the user can scroll further. A full
      // block answering after the short last one must not grow the exact count.
      this.#rowCount = startRow + result.rows.length + this.#blockSize;
    }

    this.#rebuild();
  }

  /** Rebuild `grid.data` as a placeholder array with the loaded blocks patched in. */
  #rebuild(): void {
    const data = new Array<T>(this.#rowCount).fill(this.#placeholder);
    for (const [block, rows] of this.#loaded) {
      const base = block * this.#blockSize;
      for (let j = 0; j < rows.length && base + j < this.#rowCount; j += 1) {
        data[base + j] = rows[j];
      }
    }
    this.host.data = data;
    this.host.dispatchEvent(
      new CustomEvent<RowsLoadedDetail>(ROWS_LOADED_EVENT, {
        detail: {
          rowCount: this.#rowCount,
          exact: this.#exact,
          loadedBlocks: this.#loaded.size,
          blockSize: this.#blockSize,
        },
        bubbles: true,
        composed: true,
      })
    );
  }
}

/**
 * Binds `listener` to the host's body virtualizer and returns that element,
 * moving the listener when the element changed. Shared by both server row
 * models, so a re-render never leaves the listener on a stale element and a
 * repeated call never adds it twice.
 */
export function listenForRange(
  host: { readonly shadowRoot: ShadowRoot | null },
  current: HTMLElement | null,
  listener: (event: never) => void
): HTMLElement | null {
  const vz = host.shadowRoot?.querySelector('apex-virtualizer') as HTMLElement | null;
  if (!vz || vz === current) return current;
  current?.removeEventListener('rangeChanged', listener as EventListener);
  vz.addEventListener('rangeChanged', listener as EventListener);
  return vz;
}
