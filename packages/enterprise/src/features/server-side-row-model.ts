import type {
  ApexCellContext,
  ColumnConfiguration,
  ColumnGroupConfiguration,
  DataPipelineConfiguration,
  FilterExpression,
  SortExpression,
} from 'apex-grid';
import type { GridFeatureModule, GridHost, RowAria, RowAriaProvider } from 'apex-grid/internal';
import { html, type ReactiveController, type TemplateResult } from 'lit';
import type { AggregationConfig } from './aggregation.js';

export const SERVER_SIDE_ROW_MODEL_MODULE_ID = 'server-side-row-model';

export const SERVER_ROWS_LOADED_EVENT = 'apex-server-rows-loaded';

/** Synthetic key of the auto group column the server-side model prepends. */
export const SSRM_GROUP_KEY = '__ssrm_group__';

/** Marks + describes a server-side group row (non-enumerable, stamped by the manager). */
const SSRM_META = Symbol('apex-grid-enterprise.ssrm');

/** Metadata stamped on rows flattened by the server-side row model. */
export interface ServerRowMeta {
  /** Group value path from the root to this row. */
  readonly path: string[];
  /** 0-based group depth. */
  readonly depth: number;
  /** Whether this is an (expandable) group row vs a leaf. */
  readonly group: boolean;
  /** Whether an expandable group is currently expanded. */
  readonly expanded: boolean;
  /** Display label (the grouped value) shown in the auto group column. */
  readonly label: string;
  /** True for a not-yet-loaded placeholder row under intra-group pagination. */
  readonly placeholder?: boolean;
}

/** Returns the server-side row metadata if `row` is flattened by the SSRM, else `undefined`. */
export function getServerRowMeta<T extends object>(row: T): ServerRowMeta | undefined {
  return row
    ? ((row as Record<symbol, unknown>)[SSRM_META] as ServerRowMeta | undefined)
    : undefined;
}

/** Parameters the grid passes to a server-side datasource request. */
export interface ServerSideGetRowsParams<T extends object> {
  /** Group value path of the parent being expanded (`[]` = top level). */
  readonly groupKeys: string[];
  /** Ordered group-by column keys. */
  readonly rowGroupCols: string[];
  /** Aggregations requested per column, e.g. `{ salary: ['sum'] }`. */
  readonly valueCols: AggregationConfig;
  /** Column-dimension fields to pivot on (empty ⇒ no pivot). */
  readonly pivotCols: string[];
  /** Whether the grid is in server-side pivot mode. */
  readonly pivotMode: boolean;
  /**
   * First child index to fetch within this level (inclusive). Present only when
   * {@link ServerSideRowModelConfig.blockSize} is set (intra-group pagination);
   * omitted for the whole-level fetch.
   */
  readonly startRow?: number;
  /** One past the last child index to fetch (exclusive). See {@link startRow}. */
  readonly endRow?: number;
  readonly sortModel: SortExpression<T>[];
  readonly filterModel: FilterExpression<T>[];
  readonly quickFilter: string;
}

/** A server-generated pivot result column (the server did the pivot; it knows the values). */
export interface PivotResultField {
  /** Synthetic column key the pivot cells are carried under. */
  readonly key: string;
  /** Column header text. */
  readonly headerText: string;
  /** Optional spanning-group id (define matching groups in {@link ServerSideGetRowsResult.pivotResultGroups}). */
  readonly group?: string;
}

/** What a server-side datasource returns for a level request. */
export interface ServerSideGetRowsResult<T extends object> {
  /**
   * Group rows (when `groupKeys.length < rowGroupCols.length`) or leaf rows. A
   * group row carries the grouped field's value plus any aggregate values under
   * their column keys.
   */
  readonly rows: T[];
  /**
   * Total number of children at this level. Required for **intra-group
   * pagination** (when {@link ServerSideRowModelConfig.blockSize} is set) so the
   * grid can size the level and render placeholders for not-yet-loaded blocks. If
   * omitted while paginating, the level is treated as "more may follow" until a
   * block returns fewer rows than `blockSize` (mirrors the infinite model). When
   * not paginating it is ignored (the single fetch returns the whole level).
   */
  readonly rowCount?: number;
  /**
   * In pivot mode, the generated value columns (the server knows the distinct
   * pivot values). Supplied on the top-level response; the grid installs them.
   */
  readonly pivotResultFields?: PivotResultField[];
  /** Optional spanning column groups over the {@link pivotResultFields}. */
  readonly pivotResultGroups?: ColumnGroupConfiguration[];
}

/** A lazy, level-at-a-time server-side datasource. */
export interface ServerSideDataSource<T extends object> {
  getRows(
    params: ServerSideGetRowsParams<T>
  ): Promise<ServerSideGetRowsResult<T>> | ServerSideGetRowsResult<T>;
}

/** Configuration for the server-side (grouping + aggregation) row model. */
export interface ServerSideRowModelConfig<T extends object> {
  datasource: ServerSideDataSource<T>;
  /** Ordered group-by column keys. Empty ⇒ a flat server request. */
  rowGroupCols: string[];
  /** Aggregations shown on group rows, e.g. `{ salary: ['sum'] }`. */
  valueCols?: AggregationConfig;
  /**
   * Column-dimension fields for **server-side pivot**. When non-empty the grid
   * runs in pivot mode: it passes `pivotCols` + `pivotMode` to the datasource and
   * installs the {@link ServerSideGetRowsResult.pivotResultFields} the server
   * returns as the value columns.
   */
  pivotCols?: string[];
  /**
   * Children per fetched block, enabling **intra-group block pagination**: a
   * group's children load a window at a time (`startRow`/`endRow` passed to the
   * datasource) and not-yet-loaded rows render as placeholders. Omit to load all
   * of a group's children in one request (the default).
   */
  blockSize?: number;
  /** Text for the auto group column header. Default: the joined group fields. */
  groupHeaderText?: string;
}

/** Detail of {@link SERVER_ROWS_LOADED_EVENT}. */
export interface ServerRowsLoadedDetail {
  readonly rows: number;
  readonly loadedGroups: number;
}

/** The minimal grid surface the SSRM manager drives. */
export interface ServerSideHost<T extends object> {
  data: T[];
  columns: ColumnConfiguration<T>[];
  columnGroups?: ColumnGroupConfiguration[];
  quickFilter?: string;
  readonly sortExpressions: SortExpression<T>[];
  readonly filterExpressions: FilterExpression<T>[];
  dataPipelineConfiguration: DataPipelineConfiguration<T>;
  readonly shadowRoot: ShadowRoot | null;
  localize(key: string, params?: Record<string, string | number>, fallback?: string): string;
  dispatchEvent: HTMLElement['dispatchEvent'];
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function stamp<T extends object>(row: T, meta: ServerRowMeta): void {
  Object.defineProperty(row, SSRM_META, { value: meta, enumerable: false, configurable: true });
}

/** One paginated level's loaded state (children of a single parent path). */
interface SsrmLevel<T extends object> {
  /** Loaded blocks keyed by block index. */
  readonly blocks: Map<number, T[]>;
  /** Blocks currently in flight. */
  readonly loading: Set<number>;
  /** Exact child count once known (from `rowCount` or a short block). */
  total: number | undefined;
}

function emptyLevel<T extends object>(): SsrmLevel<T> {
  return { blocks: new Map(), loading: new Set(), total: undefined };
}

/** Which level + block a placeholder flat-row belongs to (for range-driven loading). */
interface SsrmSlot {
  readonly levelKey: string;
  readonly path: string[];
  readonly block: number;
}

/**
 * Enterprise feature: **server-side row model depth** — server-side grouping +
 * aggregation. Instead of holding all rows, the grid asks a
 * {@link ServerSideDataSource} for one group level at a time; expanding a group
 * lazily fetches its children (`groupKeys` = the value path), and the server
 * computes the aggregates shown on group rows.
 *
 * Implemented enterprise-side with no core change: the manager keeps the loaded
 * tree, flattens the expanded nodes into `grid.data`, and prepends an auto group
 * column whose `cellTemplate` renders indent + a chevron + the group label. A
 * short-circuit {@link DataPipelineConfiguration} keeps the client from
 * reordering (the server owns shaping); sort / filter / quick-filter changes
 * reset the tree.
 *
 * By default a group's children load in one request. Setting
 * {@link ServerSideRowModelConfig.blockSize} switches to **intra-group block
 * pagination**: each level's children load a window at a time (`startRow` /
 * `endRow` passed to the datasource, sized/driven by the body virtualizer's
 * visible range), and not-yet-loaded rows render as placeholders.
 */
export class ServerSideRowModelManager<T extends object> {
  #savedColumns: ColumnConfiguration<T>[] | null = null;
  #savedColumnGroups: ColumnGroupConfiguration[] | undefined;
  #savedPipeline: DataPipelineConfiguration<T> | undefined;
  /** Whether the server-provided pivot columns have been installed this generation. */
  #pivotColsInstalled = false;

  /**
   * Loaded state per level, keyed by the parent path (`''` = top level): a block
   * cache, in-flight blocks, and the exact total once known.
   */
  readonly #levels = new Map<string, SsrmLevel<T>>();
  readonly #expanded = new Set<string>();
  /** Placeholder-slot map for the last flatten: flat row index → its level + block. */
  #slots: Array<SsrmSlot | null> = [];
  /** Generation token; bumped on reset so stale in-flight fetches are dropped. */
  #seq = 0;
  #lastKey = '';
  #resetQueued = false;
  #virtualizer: HTMLElement | null = null;
  #range = { first: 0, last: 0 };

  constructor(
    private config: ServerSideRowModelConfig<T>,
    private host: ServerSideHost<T>
  ) {}

  /** Configured children-per-block, or `undefined` when not paginating. */
  get #blockSize(): number | undefined {
    const size = this.config.blockSize;
    return typeof size === 'number' && size > 0 ? size : undefined;
  }

  // --- lifecycle -----------------------------------------------------------

  /** Begin server-side mode: install the group column + passthrough pipeline + load the top level. */
  public start(): void {
    this.#savedColumns = this.host.columns;
    this.#savedColumnGroups = this.host.columnGroups;
    this.#savedPipeline = this.host.dataPipelineConfiguration;
    const passthrough = (params: { data: T[] }) => {
      this.#detectChange();
      return params.data;
    };
    this.host.dataPipelineConfiguration = {
      sort: passthrough,
      filter: passthrough,
      quickFilter: passthrough,
    };
    this.host.columns = this.#buildColumns();
    this.#lastKey = this.#stateKey();
    this.reset();
  }

  /** Tear down: restore the prior columns + column groups + pipeline. */
  public stop(): void {
    this.#seq += 1;
    this.#virtualizer?.removeEventListener('rangeChanged', this.#onRange as EventListener);
    this.#virtualizer = null;
    if (this.#savedColumns) this.host.columns = this.#savedColumns;
    this.host.columnGroups = this.#savedColumnGroups;
    this.host.dataPipelineConfiguration = this.#savedPipeline as DataPipelineConfiguration<T>;
    this.#savedColumns = null;
    this.#savedColumnGroups = undefined;
  }

  /** Attach the virtualizer range listener for intra-group paging (idempotent; call after render). */
  public attach(): void {
    if (this.#blockSize === undefined || this.#virtualizer) return;
    const vz = this.host.shadowRoot?.querySelector('apex-virtualizer') as HTMLElement | null;
    if (!vz) return;
    this.#virtualizer = vz;
    vz.addEventListener('rangeChanged', this.#onRange as EventListener);
  }

  #pivotMode(): boolean {
    return (this.config.pivotCols?.length ?? 0) > 0;
  }

  // --- public API ----------------------------------------------------------

  /** Discard the tree and reload from the top (e.g. after a server-side mutation). */
  public refresh(): void {
    this.reset();
  }

  /** Reset the tree and reload the top level. */
  public reset(): void {
    this.#seq += 1;
    this.#levels.clear();
    this.#expanded.clear();
    this.#pivotColsInstalled = false;
    this.#levels.set('', emptyLevel<T>());
    this.#rebuild();
    void this.#loadBlock('', [], 0);
  }

  /** Whether a row is a not-yet-loaded placeholder (e.g. to render a skeleton). */
  public isPlaceholder(row: unknown): boolean {
    return getServerRowMeta(row as object)?.placeholder === true;
  }

  /** Expand a group path (loads its first block of children if needed). */
  public expand(path: string[]): void {
    const key = path.join('/');
    if (this.#expanded.has(key)) return;
    this.#expanded.add(key);
    if (!this.#levels.has(key)) {
      this.#levels.set(key, emptyLevel<T>());
      void this.#loadBlock(key, path, 0);
    }
    this.#rebuild();
  }

  /** Collapse a group path. */
  public collapse(path: string[]): void {
    if (this.#expanded.delete(path.join('/'))) this.#rebuild();
  }

  /** Toggle a group path. */
  public toggle(path: string[]): void {
    if (this.#expanded.has(path.join('/'))) this.collapse(path);
    else this.expand(path);
  }

  /** Whether a path is currently expanded. */
  public isExpanded(path: string[]): boolean {
    return this.#expanded.has(path.join('/'));
  }

  // --- internals -----------------------------------------------------------

  #buildColumns(): ColumnConfiguration<T>[] {
    const groupCol = this.#groupColumn();
    // Pivot mode: value columns come from the server's pivotResultFields (installed
    // on the top-level response), so start with just the group column.
    if (this.#pivotMode()) return [groupCol];
    // Grouping mode: show the value/detail columns; grouped fields fold into the group column.
    const grouped = new Set(this.config.rowGroupCols);
    const rest = (this.#savedColumns ?? []).filter((c) => !grouped.has(String(c.key)));
    return [groupCol, ...rest];
  }

  /** Build the group column (also used when prepending to server-provided pivot columns). */
  #groupColumn(): ColumnConfiguration<T> {
    return {
      key: SSRM_GROUP_KEY,
      headerText:
        this.config.groupHeaderText ?? this.config.rowGroupCols.map(capitalize).join(' / '),
      cellTemplate: (ctx: ApexCellContext<T>) => this.#groupCellTemplate(ctx),
    } as unknown as ColumnConfiguration<T>;
  }

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
    if (this.#resetQueued) return;
    this.#resetQueued = true;
    queueMicrotask(() => {
      this.#resetQueued = false;
      this.reset();
    });
  }

  /** Number of child rows a level currently occupies (real + trailing placeholders). */
  #levelCount(level: SsrmLevel<T>): number {
    const bs = this.#blockSize;
    // Not paginating: the single block-0 fetch holds the whole level (0 until loaded).
    if (bs === undefined) return level.blocks.get(0)?.length ?? 0;
    if (level.total !== undefined) return level.total;
    // Unknown total: extend to the highest loaded block, plus one trailing window
    // to load more, until a short block proves we've hit the end.
    if (level.blocks.size === 0) return bs; // bootstrap window (drives block 0)
    let maxEnd = 0;
    let sawShort = false;
    for (const [block, rows] of level.blocks) {
      maxEnd = Math.max(maxEnd, block * bs + rows.length);
      if (rows.length < bs) sawShort = true;
    }
    return sawShort ? maxEnd : maxEnd + bs;
  }

  /** The loaded child row at `index` within a level, or `undefined` (placeholder). */
  #rowAt(level: SsrmLevel<T>, index: number): T | undefined {
    const bs = this.#blockSize;
    if (bs === undefined) return level.blocks.get(0)?.[index];
    const block = Math.floor(index / bs);
    return level.blocks.get(block)?.[index - block * bs];
  }

  #blockOf(index: number): number {
    const bs = this.#blockSize;
    return bs === undefined ? 0 : Math.floor(index / bs);
  }

  async #loadBlock(levelKey: string, path: string[], block: number): Promise<void> {
    const level = this.#levels.get(levelKey);
    if (!level || level.blocks.has(block) || level.loading.has(block)) return;
    level.loading.add(block);
    const seq = this.#seq;
    const bs = this.#blockSize;
    let result: ServerSideGetRowsResult<T>;
    try {
      result = await this.config.datasource.getRows({
        groupKeys: path,
        rowGroupCols: this.config.rowGroupCols,
        valueCols: this.config.valueCols ?? {},
        pivotCols: this.config.pivotCols ?? [],
        pivotMode: this.#pivotMode(),
        ...(bs === undefined ? {} : { startRow: block * bs, endRow: block * bs + bs }),
        sortModel: this.host.sortExpressions,
        filterModel: this.host.filterExpressions,
        quickFilter: this.host.quickFilter ?? '',
      });
    } catch {
      level.loading.delete(block);
      return;
    }
    if (seq !== this.#seq) return; // reset happened while fetching
    level.loading.delete(block);
    level.blocks.set(block, result.rows);
    if (typeof result.rowCount === 'number') level.total = result.rowCount;
    else if (bs === undefined) level.total = result.rows.length;
    else if (result.rows.length < bs) level.total = block * bs + result.rows.length;
    // Pivot mode: install the server-generated value columns (once, from the top level).
    if (
      levelKey === '' &&
      this.#pivotMode() &&
      !this.#pivotColsInstalled &&
      result.pivotResultFields
    ) {
      this.#pivotColsInstalled = true;
      this.host.columns = [
        this.#groupColumn(),
        ...result.pivotResultFields.map(
          (field) =>
            ({
              key: field.key,
              headerText: field.headerText,
              type: 'number',
              ...(field.group ? { group: field.group } : {}),
            }) as unknown as ColumnConfiguration<T>
        ),
      ];
      this.host.columnGroups = result.pivotResultGroups;
    }
    this.#rebuild();
  }

  /** Flatten the expanded tree into `grid.data`, stamping group meta + placeholders. */
  #flatten(): T[] {
    const out: T[] = [];
    const slots: Array<SsrmSlot | null> = [];
    const levels = this.config.rowGroupCols.length;
    const walk = (levelKey: string, parentPath: string[], depth: number): void => {
      const level = this.#levels.get(levelKey);
      if (!level) return;
      const isGroupLevel = depth < levels;
      const count = this.#levelCount(level);
      for (let index = 0; index < count; index += 1) {
        const row = this.#rowAt(level, index);
        if (row === undefined) {
          out.push(this.#placeholderRow(depth, parentPath));
          slots.push({ levelKey, path: parentPath, block: this.#blockOf(index) });
          continue;
        }
        slots.push(null);
        if (isGroupLevel) {
          const value = String(
            (row as Record<string, unknown>)[this.config.rowGroupCols[depth]] ?? ''
          );
          const path = [...parentPath, value];
          const key = path.join('/');
          const expanded = this.#expanded.has(key);
          stamp(row, { path, depth, group: true, expanded, label: value });
          out.push(row);
          if (expanded) walk(key, path, depth + 1);
        } else {
          stamp(row, { path: parentPath, depth, group: false, expanded: false, label: '' });
          out.push(row);
        }
      }
    };
    walk('', [], 0);
    this.#slots = slots;
    return out;
  }

  /** A fresh placeholder row carrying just enough meta to indent + describe it. */
  #placeholderRow(depth: number, parentPath: string[]): T {
    const row = {} as T;
    stamp(row, {
      path: parentPath,
      depth,
      group: false,
      expanded: false,
      label: '',
      placeholder: true,
    });
    return row;
  }

  #onRange = (event: Event): void => {
    const range = event as Event & { first?: number; last?: number };
    this.#range = { first: range.first ?? 0, last: range.last ?? 0 };
    this.#loadRange(this.#range.first, this.#range.last);
  };

  /** Load the blocks backing any placeholder slots in the visible range. */
  #loadRange(first: number, last: number): void {
    if (this.#blockSize === undefined) return;
    const lo = Math.max(0, first);
    const hi = Math.min(this.#slots.length - 1, last);
    const seen = new Set<string>();
    for (let i = lo; i <= hi; i += 1) {
      const slot = this.#slots[i];
      if (!slot) continue;
      const id = `${slot.levelKey}#${slot.block}`;
      if (seen.has(id)) continue;
      seen.add(id);
      void this.#loadBlock(slot.levelKey, slot.path, slot.block);
    }
  }

  #rebuild(): void {
    const data = this.#flatten();
    this.host.data = data;
    // A rebuild may reveal fresh placeholders in the current window; load them.
    this.#loadRange(this.#range.first, this.#range.last);
    this.host.dispatchEvent(
      new CustomEvent<ServerRowsLoadedDetail>(SERVER_ROWS_LOADED_EVENT, {
        detail: { rows: data.length, loadedGroups: this.#levels.size - 1 },
        bubbles: true,
        composed: true,
      })
    );
  }

  #groupCellTemplate(ctx: ApexCellContext<T>): TemplateResult {
    const data = (ctx.row as { data?: T } | undefined)?.data;
    const meta = data ? getServerRowMeta(data) : undefined;
    const depth = meta?.depth ?? 0;
    if (meta?.placeholder) {
      const pad = 8 + depth * 16 + 18;
      return html`<span
        part="ssrm-placeholder"
        aria-hidden="true"
        style="display:block;margin-inline-start:${pad}px;height:10px;width:60%;border-radius:4px;background:var(--ag-ssrm-placeholder,#e9edf2);opacity:.7"
      ></span>`;
    }
    if (!meta?.group) {
      const pad = 8 + depth * 16 + 18;
      return html`<span part="ssrm-leaf" style="padding-inline-start:${pad}px"></span>`;
    }
    const indent = 8 + depth * 16;
    return html`<span
      part="ssrm-group"
      style="display:inline-flex;align-items:center;gap:6px;padding-inline-start:${indent}px"
    >
      <button
        part="ssrm-toggle"
        type="button"
        aria-label=${
          meta.expanded
            ? this.host.localize('grouping.collapseGroup')
            : this.host.localize('grouping.expandGroup')
        }
        aria-expanded=${meta.expanded ? 'true' : 'false'}
        style="display:inline-flex;align-items:center;border:0;background:none;cursor:pointer;padding:0;color:inherit"
        @click=${(event: Event) => {
          event.stopPropagation();
          this.toggle(meta.path);
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="12"
          height="12"
          aria-hidden="true"
          style="transform:rotate(${meta.expanded ? 90 : 0}deg);transition:transform .15s"
        >
          <path
            d="M9 6l6 6-6 6"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          ></path>
        </svg>
      </button>
      <span style="font-weight:600">${meta.label}</span>
    </span>`;
  }
}

/**
 * Supplies `aria-level` / `aria-expanded` to server-side group rows through the
 * core {@link RowAriaProvider} seam. Stateless: it reads {@link getServerRowMeta}
 * off each row and returns `null` for rows the SSRM does not own, so it is inert
 * unless the server-side row model is active. Registered as a feature module so
 * `state.describeRow` consults it (the SSRM manager itself is not a module).
 */
class ServerSideAriaController<T extends object> implements ReactiveController, RowAriaProvider<T> {
  constructor(host: GridHost<T>) {
    host.addController(this);
  }
  public hostConnected(): void {}
  public describeRow(row: T): RowAria | null {
    const meta = getServerRowMeta(row);
    if (!meta) return null;
    return { level: meta.depth + 1, expanded: meta.group ? meta.expanded : undefined };
  }
}

/** Feature module that gives server-side group rows their tree ARIA. */
export const serverSideRowModelModule: GridFeatureModule = {
  id: SERVER_SIDE_ROW_MODEL_MODULE_ID,
  create: (host) => new ServerSideAriaController(host),
};
