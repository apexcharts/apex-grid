import type { ReactiveController } from 'lit';
import { PIPELINE } from '../internal/constants.js';
import type { GridHost, Keys } from '../internal/types.js';
import { getDisplayColumns } from '../internal/utils.js';
import { retainPresent } from './expansion.js';

/**
 * Default pixel indentation per depth level for the tree group column.
 */
export const DEFAULT_TREE_INDENT = 20;

/** Sentinel value used to mark synthesized parents (those that exist only as a path segment, with no backing row). */
const SYNTHESIZED = Symbol('synthesized-tree-row');

/** Joins path segments into a node key; a character no segment is expected to hold. */
const PATH_SEPARATOR = '\0';

/**
 * Internal tree node. Built from the flat data + `getDataPath` callback;
 * lives only for the duration of one pipeline pass.
 */
interface TreeNode<T extends object> {
  /** The backing row when one exists at this path, else `null` (synthesized parent). */
  data: T | null;
  /** Path segments from root to this node. */
  path: readonly string[];
  /** `path.join(PATH_SEPARATOR)`, the stable string identity for synthesized nodes. */
  key: string;
  depth: number;
  parent: TreeNode<T> | null;
  children: TreeNode<T>[];
}

/** Path key to record lookup over one data array, valid while that array is unchanged. */
interface RecordIndex<T extends object> {
  data: ReadonlyArray<T>;
  length: number;
  getDataPath: (row: T) => readonly string[];
  byKey: Map<string, T>;
}

/**
 * Tree metadata exposed to renderers. One entry per row that ends up in the
 * flat output.
 */
export interface TreeRowMeta {
  depth: number;
  hasChildren: boolean;
  /** Stable key for the row (path-joined string). Useful for keyed reconciliation. */
  key: string;
  /** Last path segment — used as the group-column label for synthesized parents. */
  label: string;
}

/**
 * Reactive controller backing tree (nested-row) data.
 *
 * @remarks
 * Tree mode keeps the data array flat. Each row's hierarchy is derived from a
 * user-supplied `getDataPath` callback (AG Grid's "tree data" pattern). The
 * controller:
 *
 *  1. Builds an in-memory tree from the post-sort, post-filter rows.
 *  2. Synthesizes parent nodes for any path level that lacks a backing row.
 *  3. Walks the tree honouring the current expansion set and emits a flat
 *     list of rows in display order.
 *  4. Records per-row metadata (depth, hasChildren) that the cell renderer
 *     reads to draw the chevron + indentation.
 *
 * Expansion state is split into two sets: `expanded` for rows that have
 * backing data (keyed by reference, so it survives sort/filter), and
 * `expandedKeys` for synthesized parents (keyed by their path string). Both
 * follow a data refresh: entries whose row or path left the data are dropped,
 * and `defaultExpanded` applies only to parents not seen before.
 */
export class TreeController<T extends object> implements ReactiveController {
  public expanded: Set<T> = new Set();
  public expandedKeys: Set<string> = new Set();

  #meta = new WeakMap<T, TreeRowMeta>();
  /** Synthesized parent placeholder rows so consumers still get a `T`-shaped object. */
  #syntheticRows = new Map<string, T>();
  /** Whether `defaultExpanded` has been applied once for the current data set. */
  #defaultsApplied = false;
  /** Parents `defaultExpanded` has already been weighed for, by row and by path. */
  #seenParents = new WeakSet<T>();
  #seenKeys = new Set<string>();
  /** Set on a data change: the next build over the whole data prunes stale path keys. */
  #reconcilePending = false;
  /** Most recently built root node. Used to walk the full tree for expand-all. */
  #lastRoot: TreeNode<T> | null = null;
  /** The first record per path key in `host.data`, built once per data array when needed. */
  #records: RecordIndex<T> | null = null;

  constructor(protected host: GridHost<T>) {
    this.host.addController(this);
  }

  public hostConnected() {
    this.host.addEventListener('cellValueChanged', this.#dropRecords);
  }

  public hostDisconnected() {
    this.host.removeEventListener('cellValueChanged', this.#dropRecords);
  }

  /** An edit writes through to the record in place and may change its path. */
  #dropRecords = () => {
    this.#records = null;
  };

  /** Whether tree mode is enabled at the grid level. */
  public get enabled(): boolean {
    return Boolean(this.host.tree?.enabled && this.host.tree?.getDataPath);
  }

  /** The configured indentation, in pixels, per depth level. */
  public get childIndent(): number {
    return this.host.tree?.childIndent ?? DEFAULT_TREE_INDENT;
  }

  /**
   * The column key that displays the chevron + indentation. Resolves to the
   * configured `groupColumnKey`, falling back to the first visible data column.
   */
  public get groupColumnKey(): Keys<T> | undefined {
    const configured = this.host.tree?.groupColumnKey;
    if (configured) return configured;
    const displayed = getDisplayColumns(this.host.columns).find((column) => !column.hidden);
    return displayed?.key;
  }

  public isGroupColumn(key: Keys<T>): boolean {
    return this.enabled && this.groupColumnKey === key;
  }

  /**
   * Per-row metadata. Populated as a side effect of {@link process}; reading
   * before the first pipeline pass returns `undefined`.
   */
  public getMeta(row: T): TreeRowMeta | undefined {
    return this.#meta.get(row);
  }

  public getDepth(row: T): number {
    return this.#meta.get(row)?.depth ?? 0;
  }

  public hasChildren(row: T): boolean {
    return Boolean(this.#meta.get(row)?.hasChildren);
  }

  public isSynthesized(row: T): boolean {
    return (row as { [SYNTHESIZED]?: boolean })[SYNTHESIZED] === true;
  }

  /** Group-column label override for synthesized parent rows. */
  public getLabel(row: T): string | null {
    if (!this.isSynthesized(row)) return null;
    return this.#meta.get(row)?.label ?? null;
  }

  public isExpanded(row: T): boolean {
    if (this.isSynthesized(row)) {
      const key = this.#meta.get(row)?.key;
      return key ? this.expandedKeys.has(key) : false;
    }
    return this.expanded.has(row);
  }

  /** Toggles the expansion state of a tree row. */
  public async toggleRow(row: T): Promise<boolean> {
    if (!this.enabled) return false;
    if (!this.hasChildren(row)) return false;
    const wasExpanded = this.isExpanded(row);
    return wasExpanded ? this.collapseRow(row) : this.expandRow(row);
  }

  public async expandRow(row: T): Promise<boolean> {
    if (!this.enabled) return false;
    if (!this.hasChildren(row)) return false;
    if (this.isExpanded(row)) return true;
    return this.#commit((nextData, nextKeys) => {
      if (this.isSynthesized(row)) {
        const key = this.#meta.get(row)?.key;
        if (key) nextKeys.add(key);
      } else {
        nextData.add(row);
      }
    });
  }

  public async collapseRow(row: T): Promise<boolean> {
    if (!this.enabled) return false;
    if (!this.isExpanded(row)) return true;
    return this.#commit((nextData, nextKeys) => {
      if (this.isSynthesized(row)) {
        const key = this.#meta.get(row)?.key;
        if (key) nextKeys.delete(key);
      } else {
        nextData.delete(row);
      }
    });
  }

  /** Expands every parent in the current tree. */
  public async expandAll(): Promise<boolean> {
    if (!this.enabled) return false;
    const root = this.#lastRoot;
    if (!root) return false;
    return this.#commit((nextData, nextKeys) => {
      const visit = (node: TreeNode<T>) => {
        if (node !== root && node.children.length > 0) {
          if (node.data) nextData.add(node.data);
          else nextKeys.add(node.key);
        }
        for (const child of node.children) visit(child);
      };
      visit(root);
    });
  }

  /** Collapses every currently-expanded row. */
  public async collapseAll(): Promise<boolean> {
    if (!this.enabled) return false;
    if (this.expanded.size === 0 && this.expandedKeys.size === 0) return true;
    return this.#commit((nextData, nextKeys) => {
      nextData.clear();
      nextKeys.clear();
    });
  }

  /**
   * Pipeline entry point. Called by {@link DataOperationsController.apply}
   * after sort/filter/quickFilter. Builds the tree, applies the configured
   * defaults the first time we see this data, and returns rows in
   * display-order with any synthesized parents inserted.
   */
  public process(input: ReadonlyArray<T>): T[] {
    if (!this.enabled) return input as T[];

    const getDataPath = this.host.tree!.getDataPath;
    const root = this.#buildTree(input, getDataPath);
    this.#lastRoot = root;

    // Apply defaultExpanded once per data set, to parents not seen before.
    const applyDefaults = !this.#defaultsApplied;
    this.#defaultsApplied = true;
    // Only a build over the whole data knows which path keys are gone.
    const reconcile = this.#reconcilePending && input.length >= (this.host.data?.length ?? 0);
    if (reconcile) this.#reconcilePending = false;

    this.#refreshMeta(root, applyDefaults, reconcile);
    return this.#flatten(root);
  }

  /**
   * Replaces the expansion state wholesale. Used by `ApexGrid.setState` to
   * restore a snapshot. Sets both the backing-row set and the synthesized-parent
   * key set directly (no `treeRowExpanding`/`treeRowExpanded` events), marks
   * `defaultExpanded` as already applied so the next pipeline pass treats the
   * restored state as authoritative, and re-runs the pipeline.
   */
  public restoreExpansion(expanded: Iterable<T>, expandedKeys: Iterable<string>): void {
    this.expanded = new Set(expanded);
    this.expandedKeys = new Set(expandedKeys);
    this.#defaultsApplied = true;
    this.host.requestUpdate(PIPELINE);
  }

  /**
   * Reconciles the expansion state with replaced data. Called from the data
   * watcher when the input array is replaced wholesale: expanded rows that
   * left the data are dropped now, stale path keys on the next full build,
   * and the next pass applies `defaultExpanded` to parents not seen before.
   */
  public resetForDataChange(): void {
    this.#defaultsApplied = false;
    this.#reconcilePending = true;
    this.#records = null;
    this.expanded = retainPresent(this.expanded, this.host.data ?? []);
  }

  // --- internals ---------------------------------------------------------

  #buildTree(rows: ReadonlyArray<T>, getDataPath: (row: T) => readonly string[]): TreeNode<T> {
    const root: TreeNode<T> = {
      data: null,
      path: [],
      key: '',
      depth: -1,
      parent: null,
      children: [],
    };
    const byKey = new Map<string, TreeNode<T>>();
    byKey.set('', root);
    /** Levels first reached as an ancestor, which may still lack a record. */
    const intermediate: TreeNode<T>[] = [];

    for (const row of rows) {
      const fullPath = getDataPath(row);
      if (!fullPath || fullPath.length === 0) continue;

      let parent = root;
      for (let i = 0; i < fullPath.length; i++) {
        const sub = fullPath.slice(0, i + 1);
        const key = sub.join(PATH_SEPARATOR);
        let node = byKey.get(key);
        if (!node) {
          node = {
            data: null,
            path: sub,
            key,
            depth: i,
            parent,
            children: [],
          };
          byKey.set(key, node);
          parent.children.push(node);
          if (i < fullPath.length - 1) intermediate.push(node);
        }
        if (i === fullPath.length - 1) {
          // The terminal segment is the actual record. If we previously
          // saw a child path that synthesized this level, attach the data
          // now.
          node.data = row;
        }
        parent = node;
      }
    }

    this.#adoptFilteredAncestors(rows, intermediate, getDataPath);
    return root;
  }

  /**
   * Gives an ancestor level its own record when a filter removed that record
   * but kept a descendant. Otherwise the ancestor renders as a blank
   * placeholder with an expansion state of its own, so the match sits under a
   * collapsed level the user had opened. Runs only when the input is a
   * filtered subset of the data and some ancestor level lacks a record; the
   * lookup costs one pass over the data per data array (and after a cell
   * edit), then a map hit per level, so filter keystrokes and expand clicks
   * stay O(visible).
   */
  #adoptFilteredAncestors(
    rows: ReadonlyArray<T>,
    intermediate: ReadonlyArray<TreeNode<T>>,
    getDataPath: (row: T) => readonly string[]
  ): void {
    if ((this.host.data?.length ?? 0) <= rows.length) return;
    for (const node of intermediate) {
      if (!node.data) node.data = this.#recordAt(node.key, getDataPath) ?? null;
    }
  }

  /**
   * The first record in `host.data` whose path joins to `key`. A hit is
   * checked against the record's current path, since a path can change in
   * place without a new data array; a stale hit rebuilds the index once.
   */
  #recordAt(key: string, getDataPath: (row: T) => readonly string[]): T | undefined {
    const record = this.#recordsByKey(getDataPath).get(key);
    if (!record || getDataPath(record)?.join(PATH_SEPARATOR) === key) return record;
    this.#records = null;
    return this.#recordsByKey(getDataPath).get(key);
  }

  /**
   * The first record per path key in `host.data`. Built on first use and
   * kept while the data array, its length and `getDataPath` are unchanged
   * and no cell edit was applied.
   */
  #recordsByKey(getDataPath: (row: T) => readonly string[]): Map<string, T> {
    const data = this.host.data ?? [];
    const cached = this.#records;
    if (
      cached?.data === data &&
      cached.length === data.length &&
      cached.getDataPath === getDataPath
    ) {
      return cached.byKey;
    }
    const byKey = new Map<string, T>();
    for (const row of data) {
      const path = getDataPath(row);
      if (!path?.length) continue;
      const key = path.join(PATH_SEPARATOR);
      if (!byKey.has(key)) byKey.set(key, row);
    }
    this.#records = { data, length: data.length, getDataPath, byKey };
    return byKey;
  }

  /**
   * Records fresh metadata for every node, both synthesized and backed, since
   * depth or hasChildren may change between passes (rows reordered, a filter
   * dropped a descendant). The same walk weighs `defaultExpanded` for parents
   * seen for the first time and, on a reconciling pass, drops the path keys
   * and placeholders of synthesized parents that left the data.
   */
  #refreshMeta(root: TreeNode<T>, applyDefaults: boolean, reconcile: boolean): void {
    const setting = applyDefaults ? this.host.tree?.defaultExpanded : undefined;
    const expandToDepth =
      setting === true ? Number.POSITIVE_INFINITY : typeof setting === 'number' ? setting : -1;
    const liveKeys = reconcile ? new Set<string>() : null;
    const visit = (node: TreeNode<T>) => {
      if (node !== root) {
        const meta: TreeRowMeta = {
          depth: node.depth,
          hasChildren: node.children.length > 0,
          key: node.key,
          label: node.path[node.path.length - 1] ?? '',
        };
        if (node.data) {
          this.#meta.set(node.data, meta);
          if (meta.hasChildren && !this.#seenParents.has(node.data)) {
            this.#seenParents.add(node.data);
            if (node.depth <= expandToDepth) this.expanded.add(node.data);
          }
        } else {
          this.#meta.set(this.#placeholder(node.key), meta);
          liveKeys?.add(node.key);
          if (!this.#seenKeys.has(node.key)) {
            this.#seenKeys.add(node.key);
            if (node.depth <= expandToDepth) this.expandedKeys.add(node.key);
          }
        }
      }
      for (const child of node.children) visit(child);
    };
    visit(root);

    if (liveKeys) {
      for (const key of this.expandedKeys) if (!liveKeys.has(key)) this.expandedKeys.delete(key);
      for (const key of this.#seenKeys) if (!liveKeys.has(key)) this.#seenKeys.delete(key);
      for (const key of this.#syntheticRows.keys()) {
        if (!liveKeys.has(key)) this.#syntheticRows.delete(key);
      }
    }
  }

  /**
   * The placeholder row of a synthesized parent, stable per path so callers
   * can hold on to it. It carries the SYNTHESIZED marker.
   */
  #placeholder(key: string): T {
    let placeholder = this.#syntheticRows.get(key);
    if (!placeholder) {
      placeholder = Object.create(null) as T;
      Object.defineProperty(placeholder, SYNTHESIZED, { value: true, enumerable: false });
      this.#syntheticRows.set(key, placeholder);
    }
    return placeholder;
  }

  #flatten(root: TreeNode<T>): T[] {
    const out: T[] = [];
    const walk = (node: TreeNode<T>) => {
      if (node !== root) out.push(node.data ?? this.#placeholder(node.key));
      const expanded =
        node === root ||
        (node.data ? this.expanded.has(node.data) : this.expandedKeys.has(node.key));
      if (expanded) {
        for (const child of node.children) walk(child);
      }
    };
    walk(root);
    return out;
  }

  async #commit(mutate: (nextData: Set<T>, nextKeys: Set<string>) => void): Promise<boolean> {
    const nextData = new Set(this.expanded);
    const nextKeys = new Set(this.expandedKeys);
    mutate(nextData, nextKeys);

    const dataChanged =
      nextData.size !== this.expanded.size || [...nextData].some((row) => !this.expanded.has(row));
    const keysChanged =
      nextKeys.size !== this.expandedKeys.size ||
      [...nextKeys].some((key) => !this.expandedKeys.has(key));
    if (!dataChanged && !keysChanged) return true;

    const added: T[] = [];
    const removed: T[] = [];
    for (const row of nextData) if (!this.expanded.has(row)) added.push(row);
    for (const row of this.expanded) if (!nextData.has(row)) removed.push(row);

    const proceed = this.host.emitEvent('treeRowExpanding', {
      detail: {
        added,
        removed,
        current: Array.from(this.expanded),
        next: Array.from(nextData),
      },
      cancelable: true,
    });
    if (!proceed) return false;

    this.expanded = nextData;
    this.expandedKeys = nextKeys;
    // Re-run the pipeline so the flat output reflects the new expansion set.
    this.host.requestUpdate(PIPELINE);

    this.host.emitEvent('treeRowExpanded', {
      detail: { added, removed, expanded: Array.from(this.expanded) },
    });
    return true;
  }
}
