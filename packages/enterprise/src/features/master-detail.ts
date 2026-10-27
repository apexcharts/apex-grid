import type { ColumnConfiguration, GridExpansionConfiguration } from 'apex-grid';
import { html, type TemplateResult } from 'lit';

/** Per-master-row context handed to the detail callbacks. */
export interface MasterDetailContext<T extends object> {
  /** The master row's data. */
  readonly data: T;
  /** The view-relative index of the master row. */
  readonly rowIndex: number;
}

/**
 * Declarative master/detail configuration. Each expanded master row renders a
 * nested grid of related rows — the manager creates, caches, and (optionally
 * async-) populates that child grid for you, instead of hand-writing a
 * `detailTemplate`.
 */
export interface MasterDetailConfig<T extends object, C extends object = Record<string, unknown>> {
  /** Child-grid columns — static, or derived per master row. */
  columns: ColumnConfiguration<C>[] | ((row: T) => ColumnConfiguration<C>[]);
  /** Resolve the detail rows for a master row (sync array or a Promise). */
  getDetailData: (row: T) => C[] | Promise<C[]>;
  /**
   * Which element the detail grid uses. `'apex-grid'` (community, default) keeps
   * detail grids light + watermark-free; `'apex-grid-enterprise'` gives the
   * detail its own enterprise features.
   */
  detailTag?: 'apex-grid' | 'apex-grid-enterprise';
  /** Detail-grid block size (number = px). Defaults to `220`. */
  detailHeight?: number | string;
  /** Gate which master rows can expand. Expandable by default. */
  isExpandable?: (row: T) => boolean;
  /** Hook to set extra properties on the freshly-created detail grid. */
  configureDetail?: (grid: HTMLElement, context: MasterDetailContext<T>) => void;
}

function toCss(height: number | string): string {
  return typeof height === 'number' ? `${height}px` : height;
}

/**
 * Builds and caches the per-row detail grids for a {@link MasterDetailConfig},
 * and exposes a `detailTemplate` ready to drop into the grid's expansion config.
 *
 * The child grid is created once per master row (keyed by row identity) and
 * reused across re-renders, so its own state (its sort, for example) stays
 * with its record across a collapse/expand and a master sort. Its scroll
 * position does not: the node is detached and re-attached in both cases, and
 * a re-attached grid starts scrolled to the top. Async `getDetailData`
 * resolves into the cached grid and requests a host update; a throw or
 * rejection leaves the detail empty and is retried the next time that detail
 * is shown.
 */
export class MasterDetailManager<T extends object> {
  #cache = new WeakMap<object, HTMLElement>();
  /** Detail grids whose last `getDetailData` threw or rejected. */
  #failed = new WeakSet<HTMLElement>();

  constructor(
    private config: MasterDetailConfig<T>,
    private requestUpdate: () => void
  ) {}

  /** The expansion configuration to assign to the grid. */
  public buildExpansion(): GridExpansionConfiguration<T> {
    return {
      enabled: true,
      isExpandable: this.config.isExpandable,
      detailTemplate: (context) => this.#renderDetail(context.data, context.rowIndex),
      exportParts: ['master-detail', 'detail-grid'],
    };
  }

  /** Drop the cached detail grid for a row (e.g. to force a data refresh). */
  public invalidate(row: T): void {
    this.#cache.delete(row as object);
  }

  #renderDetail(row: T, rowIndex: number): TemplateResult {
    const grid = this.#ensureGrid(row, rowIndex);
    return html`<div part="master-detail" style="padding:8px;box-sizing:border-box">${grid}</div>`;
  }

  #ensureGrid(row: T, rowIndex: number): HTMLElement {
    const cached = this.#cache.get(row as object);
    if (cached) {
      // A failed load is retried the next time the detail is shown (expand, or scrolled back in),
      // not on every re-render of an open detail.
      if (this.#failed.has(cached) && !cached.isConnected) this.#load(row, cached);
      return cached;
    }

    const grid = document.createElement(this.config.detailTag ?? 'apex-grid') as HTMLElement & {
      columns?: unknown;
    };
    grid.setAttribute('part', 'detail-grid');
    // Only the size: the grid's own host style keeps `display: grid`.
    grid.style.blockSize = toCss(this.config.detailHeight ?? 220);

    const columns =
      typeof this.config.columns === 'function' ? this.config.columns(row) : this.config.columns;
    grid.columns = columns;
    this.config.configureDetail?.(grid, { data: row, rowIndex });

    this.#cache.set(row as object, grid);
    this.#load(row, grid);
    return grid;
  }

  /** Fill `grid` from `getDetailData`; a throw or rejection leaves it empty and marked failed. */
  #load(row: T, grid: HTMLElement & { data?: unknown }): void {
    this.#failed.delete(grid);
    const fail = () => {
      grid.data = [];
      this.#failed.add(grid);
    };
    try {
      const result = this.config.getDetailData(row);
      if (typeof (result as PromiseLike<unknown> | null)?.then !== 'function') {
        grid.data = result;
        return;
      }
      grid.data = [];
      Promise.resolve(result).then((rows) => {
        grid.data = rows;
        this.requestUpdate();
      }, fail);
    } catch {
      fail();
    }
  }
}
