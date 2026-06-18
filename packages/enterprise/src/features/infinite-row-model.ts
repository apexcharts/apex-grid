import type { DataPipelineConfiguration, FilterExpression, SortExpression } from 'apex-grid';

export const ROWS_LOADED_EVENT = 'apex-rows-loaded';

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

/** Configuration for the infinite (server-side, lazy-scroll) row model. */
export interface InfiniteRowModelConfig<T extends object> {
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

/** The minimal grid surface the manager drives (avoids a circular import). */
export interface InfiniteHost<T extends object> {
  data: T[];
  quickFilter?: string;
  readonly sortExpressions: SortExpression<T>[];
  readonly filterExpressions: FilterExpression<T>[];
  dataPipelineConfiguration: DataPipelineConfiguration<T>;
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
 * loaded blocks. Client-side sort/filter are disabled via passthrough
 * {@link DataPipelineConfiguration} hooks (the server owns ordering), and the
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
  /** Generation token — bumped on reset so in-flight stale blocks are dropped. */
  #seq = 0;
  #range = { first: 0, last: 0 };
  /** Serialized sort/filter/quick-filter query — refetch when it changes. */
  #lastKey = '';
  #resetQueued = false;
  #virtualizer: HTMLElement | null = null;
  #savedPipeline: DataPipelineConfiguration<T> | undefined;

  constructor(
    private config: InfiniteRowModelConfig<T>,
    private host: InfiniteHost<T>
  ) {
    this.#blockSize = Math.max(1, config.blockSize ?? 100);
    this.#rowCount = config.initialRowCount ?? this.#blockSize;
  }

  // --- lifecycle -----------------------------------------------------------

  /** Begin server-side mode: install passthrough pipeline + initial fetch. */
  public start(): void {
    this.#savedPipeline = this.host.dataPipelineConfiguration;
    // Passthrough hooks: the server owns ordering/filtering, so the client
    // never reorders. Each hook also detects a query change (it runs on every
    // pipeline pass) and refetches — this catches header-click *and*
    // programmatic sort/filter/quick-filter alike.
    const passthrough = (params: { data: T[] }) => {
      this.#detectChange();
      return params.data;
    };
    this.host.dataPipelineConfiguration = {
      sort: passthrough,
      filter: passthrough,
      quickFilter: passthrough,
    };
    this.#lastKey = this.#stateKey();
    this.reset();
  }

  /** Tear down: remove listeners and restore the prior pipeline config. */
  public stop(): void {
    this.#virtualizer?.removeEventListener('rangeChanged', this.#onRange as EventListener);
    this.#virtualizer = null;
    this.host.dataPipelineConfiguration = this.#savedPipeline as DataPipelineConfiguration<T>;
    this.#seq += 1;
  }

  /** Attach the virtualizer range listener (idempotent; call after render). */
  public attach(): void {
    if (this.#virtualizer) return;
    const vz = this.host.shadowRoot?.querySelector('apex-virtualizer') as HTMLElement | null;
    if (!vz) return;
    this.#virtualizer = vz;
    vz.addEventListener('rangeChanged', this.#onRange as EventListener);
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
    this.#exact = false;
    this.#rowCount = this.config.initialRowCount ?? this.#blockSize;
    this.#rebuild();
    this.#loadBlock(0);
    this.#ensureBlocksForRange(this.#range.first, this.#range.last);
  }

  // --- internals -----------------------------------------------------------

  /** Serialized server query — sort + filter + quick-filter. */
  #stateKey(): string {
    const sort = this.host.sortExpressions
      .map((expr) => `${String(expr.key)}:${expr.direction}`)
      .join(',');
    const filter = this.host.filterExpressions
      .map((expr) => {
        const condition = expr.condition as { name?: string } | string;
        const name = typeof condition === 'string' ? condition : (condition?.name ?? '');
        const term = (expr as { searchTerm?: unknown }).searchTerm;
        return `${String(expr.key)}:${name}:${term === undefined ? '' : String(term)}`;
      })
      .join(',');
    return `${sort}|${filter}|${this.host.quickFilter ?? ''}`;
  }

  #detectChange(): void {
    const key = this.#stateKey();
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
      if (!this.#loaded.has(block) && !this.#loading.has(block)) this.#loadBlock(block);
    }
  }

  async #loadBlock(block: number): Promise<void> {
    if (this.#loaded.has(block) || this.#loading.has(block)) return;
    this.#loading.add(block);
    const seq = this.#seq;
    const startRow = block * this.#blockSize;

    let result: InfiniteGetRowsResult<T>;
    try {
      result = await this.config.datasource.getRows({
        startRow,
        endRow: startRow + this.#blockSize,
        sortModel: this.host.sortExpressions,
        filterModel: this.host.filterExpressions,
        quickFilter: this.host.quickFilter ?? '',
      });
    } catch {
      this.#loading.delete(block);
      return;
    }

    // A reset (sort/filter change) happened while fetching — drop this block.
    if (seq !== this.#seq) return;
    this.#loading.delete(block);
    this.#loaded.set(block, result.rows);

    if (typeof result.rowCount === 'number') {
      this.#rowCount = result.rowCount;
      this.#exact = true;
    } else if (result.rows.length < this.#blockSize) {
      // Short block ⇒ we've hit the end.
      this.#rowCount = startRow + result.rows.length;
      this.#exact = true;
    } else if (startRow + result.rows.length + this.#blockSize > this.#rowCount) {
      // Keep a trailing placeholder block so the user can scroll further.
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
