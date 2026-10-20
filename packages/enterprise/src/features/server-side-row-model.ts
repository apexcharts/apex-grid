import type {
  ApexCellContext,
  ColumnConfiguration,
  ColumnGroupConfiguration,
  DataPipelineConfiguration,
  FilterExpression,
  SortExpression,
} from 'apex-grid';
import type {
  GridFeatureModule,
  GridHost,
  RowAria,
  RowAriaProvider,
  RowTransformer,
} from 'apex-grid/internal';
import { html, type ReactiveController, type TemplateResult } from 'lit';
import type { AdvancedFilterModel } from './advanced-filter.js';
import type { AggregationConfig } from './aggregation.js';
import {
  fetchWithRetry,
  listenForRange,
  passthroughPipeline,
  type RowLoadRetryConfig,
  type ServerQueryHost,
  serverQueryKey,
} from './infinite-row-model.js';

export const SERVER_SIDE_ROW_MODEL_MODULE_ID = 'server-side-row-model';

export const SERVER_ROWS_LOADED_EVENT = 'apex-server-rows-loaded';

/** Fired on the grid when a level request rejects; see {@link ServerRowsLoadFailedDetail}. */
export const SERVER_ROWS_LOAD_FAILED_EVENT = 'apex-server-rows-load-failed';

/** Synthetic key of the auto group column the server-side model prepends. */
export const SSRM_GROUP_KEY = '__ssrm_group__';

/** Marks + describes a server-side group row (non-enumerable, stamped by the manager). */
const SSRM_META = Symbol('apex-grid-enterprise.ssrm');

/** Metadata stamped on rows flattened by the server-side row model. */
export interface ServerRowMeta {
  /**
   * Group value path from the root to this row, the `groupKeys` its children
   * are fetched with. A blank group value (`null`, `undefined` or `''`) is `''`.
   */
  readonly path: string[];
  /** 0-based group depth. */
  readonly depth: number;
  /** Whether this is an (expandable) group row vs a leaf. */
  readonly group: boolean;
  /** Whether an expandable group is currently expanded. */
  readonly expanded: boolean;
  /**
   * Display label (the grouped value) shown in the auto group column, and the
   * value the column exports. A blank value reads "(blank)" (localized).
   */
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
  /**
   * The advanced filter, or `null`; the server should apply it. Same contract
   * as `InfiniteGetRowsParams.advancedFilterModel`.
   */
  readonly advancedFilterModel: AdvancedFilterModel | null;
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
export interface ServerSideRowModelConfig<T extends object> extends RowLoadRetryConfig {
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
  /**
   * Text for the auto group column header. Default: the grouped columns'
   * `headerText` (or their keys, capitalized), joined with " / ".
   */
  groupHeaderText?: string;
}

/** Detail of {@link SERVER_ROWS_LOADED_EVENT}. */
export interface ServerRowsLoadedDetail {
  readonly rows: number;
  readonly loadedGroups: number;
}

/** Detail of {@link SERVER_ROWS_LOAD_FAILED_EVENT}. */
export interface ServerRowsLoadFailedDetail {
  /** Group value path of the level that failed (`[]` = top level). */
  readonly groupKeys: string[];
  /** First child index of the failed block, when paginating (see `blockSize`). */
  readonly startRow?: number;
  /** One past the last child index of the failed block, when paginating. */
  readonly endRow?: number;
  /** What `getRows` rejected with. */
  readonly error: unknown;
  /**
   * Whether the request is made again (see {@link RowLoadRetryConfig}). When
   * `false`, a group with no rows loaded collapses so the next expand asks
   * again; other failed rows stay placeholders until `refreshServerSide()` or
   * a sort or filter change.
   */
  readonly retrying: boolean;
}

/** The minimal grid surface the SSRM manager drives. */
export interface ServerSideHost<T extends object> extends ServerQueryHost<T> {
  data: T[];
  /** The rows the body renders (the page slice, pinned rows excluded). */
  readonly pageItems: ReadonlyArray<T>;
  readonly updateComplete: Promise<boolean>;
  columns: ColumnConfiguration<T>[];
  columnGroups?: ColumnGroupConfiguration[];
  readonly shadowRoot: ShadowRoot | null;
  localize(key: string, params?: Record<string, string | number>, fallback?: string): string;
  dispatchEvent: HTMLElement['dispatchEvent'];
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

/**
 * Stamps the meta, plus the auto group column's value (the label for a group,
 * the parent group labels for a leaf) under {@link SSRM_GROUP_KEY}, so export
 * and copy read it like any other cell. Both are non-enumerable.
 */
function stamp<T extends object>(row: T, meta: ServerRowMeta, groupValue: string): void {
  Object.defineProperties(row, {
    [SSRM_META]: { value: meta, configurable: true },
    [SSRM_GROUP_KEY]: { value: groupValue, configurable: true },
  });
}

/**
 * The level map key of a group path. A JSON array, so no group value can
 * collide with another path: not a blank value with the top level (`[]` vs
 * `[""]`) and not a value holding a `/` with a nested path.
 */
const keyOf = (path: readonly string[]): string => JSON.stringify(path);

/** Level key of the top level. */
const TOP = keyOf([]);

/** One paginated level's loaded state (children of a single parent path). */
interface SsrmLevel<T extends object> {
  /** Loaded blocks keyed by block index. */
  readonly blocks: Map<number, T[]>;
  /** Blocks currently in flight. */
  readonly loading: Set<number>;
  /** Blocks that failed for good this generation, not requested again until a reset. */
  readonly failed: Set<number>;
  /** One shared placeholder row per not-yet-loaded block, created on first use. */
  readonly placeholders: Map<number, T>;
  /** Exact child count once known (from `rowCount` or a short block). */
  total: number | undefined;
}

function emptyLevel<T extends object>(): SsrmLevel<T> {
  return {
    blocks: new Map(),
    loading: new Set(),
    failed: new Set(),
    placeholders: new Map(),
    total: undefined,
  };
}

/** Which level + block a placeholder row stands for (for range-driven loading). */
interface SsrmSlot<T extends object> {
  readonly level: SsrmLevel<T>;
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
 * passthrough {@link DataPipelineConfiguration}, which the grid installs, keeps
 * the client from reordering (the server owns shaping); sort / filter /
 * quick-filter / advanced filter changes reset the tree.
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
  readonly #pipeline = passthroughPipeline<T>(() => {
    if (this.#savedColumns) this.#detectChange();
  });
  /** Whether the server-provided pivot columns have been installed this generation. */
  #pivotColsInstalled = false;

  /**
   * Loaded state per level, keyed by the parent path (`''` = top level): a block
   * cache, in-flight blocks, and the exact total once known.
   */
  readonly #levels = new Map<string, SsrmLevel<T>>();
  readonly #expanded = new Set<string>();
  /** The level + block each placeholder row stands for. */
  #slots = new WeakMap<object, SsrmSlot<T>>();
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

  /**
   * Begin server-side mode: install the group column + load the top level. The
   * grid then installs `pipeline`.
   */
  public start(): void {
    this.#savedColumns = this.host.columns;
    this.#savedColumnGroups = this.host.columnGroups;
    this.host.columns = this.#buildColumns();
    this.#lastKey = serverQueryKey(this.host);
    this.reset();
  }

  /**
   * Tear down: restore the prior columns + column groups (the grid puts back
   * the pipeline). Restores nothing when the manager never started (or already
   * stopped).
   */
  public stop(): void {
    this.#seq += 1;
    this.#virtualizer?.removeEventListener('rangeChanged', this.#onRange as EventListener);
    this.#virtualizer = null;
    if (!this.#savedColumns) return;
    this.host.columns = this.#savedColumns;
    this.host.columnGroups = this.#savedColumnGroups;
    this.#savedColumns = null;
    this.#savedColumnGroups = undefined;
  }

  /**
   * The passthrough pipeline while started, else `null`. Its hooks refetch on
   * a query change and do nothing more once the model stopped.
   */
  public get pipeline(): DataPipelineConfiguration<T> | null {
    return this.#savedColumns ? this.#pipeline : null;
  }

  /** Attach the virtualizer range listener for intra-group paging (idempotent; call after render). */
  public attach(): void {
    if (this.#blockSize === undefined) return;
    this.#virtualizer = listenForRange(this.host, this.#virtualizer, this.#onRange);
  }

  #pivotMode(): boolean {
    return (this.config.pivotCols?.length ?? 0) > 0;
  }

  // --- public API ----------------------------------------------------------

  /** Every row the model holds in its block cache, including rows of collapsed groups. */
  public *cachedRecords(): Iterable<T> {
    for (const level of this.#levels.values())
      for (const block of level.blocks.values()) yield* block;
  }

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
    this.#levels.set(TOP, emptyLevel<T>());
    this.#rebuild();
    void this.#loadBlock(TOP, [], 0);
  }

  /** Whether a row is a not-yet-loaded placeholder (e.g. to render a skeleton). */
  public isPlaceholder(row: unknown): boolean {
    return getServerRowMeta(row as object)?.placeholder === true;
  }

  /** Expand a group path (loads its first block of children if needed). */
  public expand(path: string[]): void {
    const key = keyOf(path);
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
    if (this.#expanded.delete(keyOf(path))) this.#rebuild();
  }

  /** Toggle a group path. */
  public toggle(path: string[]): void {
    if (this.isExpanded(path)) this.collapse(path);
    else this.expand(path);
  }

  /** Whether a path is currently expanded. */
  public isExpanded(path: string[]): boolean {
    return this.#expanded.has(keyOf(path));
  }

  // --- internals -----------------------------------------------------------

  #buildColumns(): ColumnConfiguration<T>[] {
    // Pivot mode: value columns come from the server's pivotResultFields (installed
    // on the top-level response), so start with just the group column.
    if (this.#pivotMode()) return this.#groupColumns();
    // Grouping mode: show the value/detail columns; grouped fields fold into the group column.
    const grouped = new Set(this.config.rowGroupCols);
    const rest = (this.#savedColumns ?? []).filter((c) => !grouped.has(String(c.key)));
    return [...this.#groupColumns(), ...rest];
  }

  /**
   * The auto group column, or none for a flat request (no `rowGroupCols`).
   * Also used when prepending to server-provided pivot columns.
   */
  #groupColumns(): ColumnConfiguration<T>[] {
    const { rowGroupCols, groupHeaderText } = this.config;
    if (!rowGroupCols.length) return [];
    const header = (key: string) =>
      this.#savedColumns?.find((column) => String(column.key) === key)?.headerText ??
      capitalize(key);
    return [
      {
        key: SSRM_GROUP_KEY,
        headerText: groupHeaderText ?? rowGroupCols.map(header).join(' / '),
        cellTemplate: (ctx: ApexCellContext<T>) => this.#groupCellTemplate(ctx),
      } as unknown as ColumnConfiguration<T>,
    ];
  }

  #detectChange(): void {
    const key = serverQueryKey(this.host);
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
    if (!level || level.blocks.has(block) || level.loading.has(block) || level.failed.has(block))
      return;
    level.loading.add(block);
    const seq = this.#seq;
    const current = () => seq === this.#seq;
    const bs = this.#blockSize;
    const span = bs === undefined ? {} : { startRow: block * bs, endRow: block * bs + bs };
    const result = await fetchWithRetry(
      () =>
        this.config.datasource.getRows({
          groupKeys: path,
          rowGroupCols: this.config.rowGroupCols,
          valueCols: this.config.valueCols ?? {},
          pivotCols: this.config.pivotCols ?? [],
          pivotMode: this.#pivotMode(),
          ...span,
          sortModel: this.host.sortExpressions,
          filterModel: this.host.filterExpressions,
          quickFilter: this.host.quickFilter ?? '',
          advancedFilterModel: this.host.advancedFilterModel ?? null,
        }),
      this.config,
      current,
      (error, retrying) =>
        this.host.dispatchEvent(
          new CustomEvent<ServerRowsLoadFailedDetail>(SERVER_ROWS_LOAD_FAILED_EVENT, {
            detail: { groupKeys: path, ...span, error, retrying },
            bubbles: true,
            composed: true,
          })
        )
    );
    if (!current()) return; // reset happened while fetching
    level.loading.delete(block);
    if (!result) {
      if (levelKey !== TOP && level.blocks.size === 0) {
        // Nothing of the group loaded: collapse it so the next expand asks again.
        this.#levels.delete(levelKey);
        this.#expanded.delete(levelKey);
        this.#rebuild();
      } else {
        level.failed.add(block);
      }
      return;
    }
    level.blocks.set(block, result.rows);
    if (typeof result.rowCount === 'number') level.total = result.rowCount;
    else if (bs === undefined) level.total = result.rows.length;
    else if (result.rows.length < bs) level.total = block * bs + result.rows.length;
    // Pivot mode: install the server-generated value columns (once, from the top level).
    if (
      levelKey === TOP &&
      this.#pivotMode() &&
      !this.#pivotColsInstalled &&
      result.pivotResultFields
    ) {
      this.#pivotColsInstalled = true;
      this.host.columns = [
        ...this.#groupColumns(),
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
    const levels = this.config.rowGroupCols.length;
    const blank = this.host.localize('grouping.blank');
    const walk = (
      levelKey: string,
      parentPath: string[],
      parentLabel: string,
      depth: number
    ): void => {
      const level = this.#levels.get(levelKey);
      if (!level) return;
      const isGroupLevel = depth < levels;
      const count = this.#levelCount(level);
      // Expansion keys already shown at this level: a server that returns
      // both a NULL and an '' group (or any value twice) gets one group,
      // since both are fetched with the same groupKeys.
      const shown = new Set<string>();
      for (let index = 0; index < count; index += 1) {
        const row = this.#rowAt(level, index);
        if (row === undefined) {
          out.push(this.#placeholderRow(level, levelKey, parentPath, depth, this.#blockOf(index)));
          continue;
        }
        if (isGroupLevel) {
          // null, undefined and '' are one blank group, fetched with the key ''.
          const value = String(
            (row as Record<string, unknown>)[this.config.rowGroupCols[depth]] ?? ''
          );
          const label = value === '' ? blank : value;
          const path = [...parentPath, value];
          const key = keyOf(path);
          if (shown.has(key)) continue;
          shown.add(key);
          const expanded = this.#expanded.has(key);
          stamp(row, { path, depth, group: true, expanded, label }, label);
          out.push(row);
          if (expanded) {
            walk(key, path, parentLabel ? `${parentLabel} / ${label}` : label, depth + 1);
          }
        } else {
          stamp(
            row,
            { path: parentPath, depth, group: false, expanded: false, label: '' },
            parentLabel
          );
          out.push(row);
        }
      }
    };
    walk(TOP, [], '', 0);
    return out;
  }

  /**
   * The placeholder row for a not-yet-loaded block of a level: one shared row
   * per block (every unloaded child of it has the same meta), so a rebuild
   * allocates nothing for unloaded rows and keeps their identity.
   */
  #placeholderRow(
    level: SsrmLevel<T>,
    levelKey: string,
    path: string[],
    depth: number,
    block: number
  ): T {
    let row = level.placeholders.get(block);
    if (!row) {
      row = {} as T;
      const meta = { path, depth, group: false, expanded: false, label: '', placeholder: true };
      stamp(row, meta, '');
      level.placeholders.set(block, row);
      this.#slots.set(row, { level, levelKey, path, block });
    }
    return row;
  }

  #onRange = (event: Event): void => {
    const range = event as Event & { first?: number; last?: number };
    this.#range = { first: range.first ?? 0, last: range.last ?? 0 };
    this.#loadRange();
  };

  /**
   * Load the blocks behind the placeholders in the visible range. The range
   * indexes the rendered rows (`pageItems`: a page slice without pinned rows),
   * not `data`, so each placeholder row says which level and block it is.
   */
  #loadRange(): void {
    if (this.#blockSize === undefined) return;
    const { first, last } = this.#range;
    for (const row of this.host.pageItems.slice(Math.max(0, first), last + 1)) {
      const slot = this.#slots.get(row);
      // A placeholder of a level a reset replaced is not this generation's.
      if (slot && this.#levels.get(slot.levelKey) === slot.level) {
        void this.#loadBlock(slot.levelKey, slot.path, slot.block);
      }
    }
  }

  #rebuild(): void {
    const data = this.#flatten();
    this.host.data = data;
    // A rebuild may reveal fresh placeholders in the current window; load them
    // once the grid has rendered the new rows.
    if (this.#blockSize !== undefined) void this.host.updateComplete.then(() => this.#loadRange());
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
class ServerSideAriaController<T extends object>
  implements ReactiveController, RowAriaProvider<T>, RowTransformer<T>
{
  constructor(private host: GridHost<T>) {
    host.addController(this);
  }
  public hostConnected(): void {}
  /** Rows pass through untouched; the controller is a transformer only to claim placeholders. */
  public processRows(rows: ReadonlyArray<T>): T[] {
    return rows as T[];
  }
  /**
   * A not-yet-loaded placeholder row (of this model, or of the infinite row
   * model through the grid's `isRowLoading`) is no record: selection, export,
   * fill and editing skip it, and paste drops the line that lands on it.
   */
  public isSyntheticRow(row: T): boolean {
    return (this.host as { isRowLoading?(row: T): boolean }).isRowLoading?.(row) === true;
  }
  public describeRow(row: T): RowAria | null {
    const meta = getServerRowMeta(row);
    if (!meta) return null;
    return { level: meta.depth + 1, expanded: meta.group ? meta.expanded : undefined };
  }
}

/**
 * Feature module that gives server-side group rows their tree ARIA, and
 * marks the not-yet-loaded rows of both the server-side and the infinite row
 * model as no record, so selection, export, fill and editing leave them alone
 * and paste drops the line that lands on one. An app that opts into modules
 * one by one needs it for the infinite row model too: without it an unloaded
 * infinite row counts as a record. `apex-grid-enterprise/define` and
 * `enterpriseModules` include it.
 */
export const serverSideRowModelModule: GridFeatureModule = {
  id: SERVER_SIDE_ROW_MODEL_MODULE_ID,
  create: (host) => new ServerSideAriaController(host),
};
