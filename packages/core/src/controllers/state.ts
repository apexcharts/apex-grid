import { createContext } from '@lit/context';
import type { ReactiveController } from 'lit';
import type { GridLocaleKey, LocaleParams } from '../i18n/index.js';
import {
  type CellDecoration,
  type CellDecoratorContext,
  type CellInteraction,
  type GridFeatureModule,
  isCellDecorator,
  isCellInteractionHandler,
  isRowPresenter,
  isRowTransformer,
  isSerializableModule,
  type PresentedRow,
  type RowPresenterContext,
} from '../internal/feature-module.js';
import type { ActiveNode, GridHost } from '../internal/types.js';
import { EditingController } from './editing.js';
import { ExpansionController } from './expansion.js';
import { FilterController } from './filter.js';
import { HistoryController } from './history.js';
import { NavigationController } from './navigation.js';
import { PaginationController } from './pagination.js';
import { ReorderController } from './reorder.js';
import { ResizeController } from './resize.js';
import { RowPinController } from './row-pin.js';
import { RowReorderController } from './row-reorder.js';
import { SelectionController } from './selection.js';
import { SortController } from './sort.js';
import { TreeController } from './tree.js';

export class StateController<T extends object> implements ReactiveController {
  public sorting!: SortController<T>;
  public filtering!: FilterController<T>;
  public navigation!: NavigationController<T>;
  public resizing!: ResizeController<T>;
  public pagination!: PaginationController<T>;
  public reordering!: ReorderController<T>;
  public editing!: EditingController<T>;
  public history!: HistoryController<T>;
  public selection!: SelectionController<T>;
  public expansion!: ExpansionController<T>;
  public tree!: TreeController<T>;
  public rowPin!: RowPinController<T>;
  public rowReorder!: RowReorderController<T>;

  /**
   * Optional feature controllers contributed by {@link GridFeatureModule}s,
   * keyed by module id. Empty for the community `<apex-grid>` element; populated
   * by derived grids (e.g. `@apexcharts/grid-enterprise`) that pass modules to
   * the constructor.
   */
  public readonly modules = new Map<string, ReactiveController>();

  /**
   * Current message in the grid's polite live region. Bound by the host's
   * `renderLiveRegion()` template; mutated through {@link setAnnouncement}
   * so screen readers re-announce on every change.
   */
  public announcement = '';
  #announceToken = 0;

  /**
   * Updates the polite live region's text. Repeats are forced to fire by
   * appending a zero-width space — screen readers ignore unchanged content,
   * so two identical sort announcements wouldn't otherwise be read aloud.
   */
  public setAnnouncement(message: string): void {
    if (!message) {
      this.announcement = '';
      this.host.requestUpdate();
      return;
    }
    this.#announceToken = (this.#announceToken + 1) % 2;
    this.announcement = this.#announceToken ? message : `${message} `;
    this.host.requestUpdate();
  }

  /**
   * Resolves a built-in locale key to its display string, honoring the host
   * grid's {@link ApexGrid.localeText} overrides. Thin proxy to
   * {@link ApexGrid.localize} so components can localize via `this.state`.
   */
  public localize(key: GridLocaleKey, params?: LocaleParams, fallback?: string): string {
    return this.host.localize(key, params, fallback);
  }

  public get active() {
    return this.navigation.active;
  }

  public set active(node: ActiveNode<T>) {
    this.navigation.active = node;
  }

  public get headerRow() {
    // @ts-expect-error - Protected member access
    return this.host.headerRow;
  }

  public get scrollContainer() {
    // @ts-expect-error - Protected member access
    return this.host.scrollContainer;
  }

  public get paginator() {
    // @ts-expect-error - Protected member access
    return this.host.paginator;
  }

  public get toolbar() {
    // @ts-expect-error - Protected member access
    return this.host.toolbar;
  }

  /**
   * Cumulative pin offsets (in px) keyed by column key. Populated by the
   * {@link GridDOMController} after each layout.
   */
  public get pinOffsets(): Map<unknown, number> {
    // @ts-expect-error - Protected member access
    const dom = this.host.DOM as { pinOffsets?: Map<unknown, number> } | undefined;
    return dom?.pinOffsets ?? new Map();
  }

  constructor(
    public host: GridHost<T>,
    private extraModules: ReadonlyArray<GridFeatureModule<T>> = []
  ) {
    this.host.addController(this);
    this.init();
  }

  protected init() {
    this.sorting = new SortController(this.host);
    this.filtering = new FilterController(this.host);
    this.navigation = new NavigationController(this.host);
    this.resizing = new ResizeController(this.host);
    this.pagination = new PaginationController(this.host);
    this.reordering = new ReorderController(this.host);
    this.history = new HistoryController(this.host);
    this.editing = new EditingController(this.host, this.history);
    this.selection = new SelectionController(this.host);
    this.expansion = new ExpansionController(this.host);
    this.tree = new TreeController(this.host);
    this.rowPin = new RowPinController(this.host);
    this.rowReorder = new RowReorderController(this.host);

    for (const module of this.extraModules) {
      if (this.modules.has(module.id)) continue;
      this.modules.set(module.id, module.create(this.host, this));
    }
  }

  /**
   * Look up a feature controller contributed by a {@link GridFeatureModule},
   * by its module id. Returns `undefined` when no such module is registered.
   */
  public module<C extends ReactiveController>(id: string): C | undefined {
    return this.modules.get(id) as C | undefined;
  }

  /**
   * Runs the post-pipeline row transforms contributed by feature modules
   * implementing {@link RowTransformer}, in registration order. Returns the
   * input unchanged when no such module is registered — the community grid path
   * is a no-op pass-through.
   */
  public applyModuleTransforms(rows: T[]): T[] {
    let result = rows;
    for (const controller of this.modules.values()) {
      if (isRowTransformer<T>(controller)) {
        result = controller.processRows(result);
      }
    }
    return result;
  }

  /**
   * Asks feature modules implementing {@link RowPresenter} whether they render
   * the given row as full-width custom content (e.g. a group header). Returns
   * the first non-null result, or `null` when no module owns the row.
   */
  public presentRow(row: T, ctx: RowPresenterContext<T>): PresentedRow | null {
    for (const controller of this.modules.values()) {
      if (isRowPresenter<T>(controller)) {
        const presented = controller.presentRow(row, ctx);
        if (presented) return presented;
      }
    }
    return null;
  }

  /**
   * Monotonic token bumped by {@link bumpDecoration} whenever module-driven cell
   * decoration changes. Forwarded down to each cell as a reactive property so a
   * decoration-only change (e.g. dragging a selection range) re-renders cells
   * without re-running the data pipeline. Always `0` for the community grid.
   */
  #decorationVersion = 0;

  public get decorationVersion(): number {
    return this.#decorationVersion;
  }

  /**
   * Signals that {@link CellDecorator} output may have changed. Bumps the
   * {@link decorationVersion} and requests a host update so cells re-run their
   * decoration. Called by feature modules after mutating decoration state.
   */
  public bumpDecoration(): void {
    this.#decorationVersion += 1;
    this.host.requestUpdate();
  }

  /**
   * Collects per-cell decoration contributed by feature modules implementing
   * {@link CellDecorator}, merging their attribute maps (later modules win on a
   * key clash). Returns `null` when no module decorates the cell — the community
   * grid path, where each cell applies nothing.
   */
  public decorateCell(ctx: CellDecoratorContext<T>): CellDecoration | null {
    let attributes: Record<string, string | null | undefined> | null = null;
    for (const controller of this.modules.values()) {
      if (isCellDecorator<T>(controller)) {
        const decoration = controller.decorateCell(ctx);
        if (decoration) {
          attributes ??= {};
          Object.assign(attributes, decoration.attributes);
        }
      }
    }
    return attributes ? { attributes } : null;
  }

  /**
   * Forwards a body-cell pointer interaction to every feature module that
   * implements {@link CellInteractionHandler}. No-op for the community grid
   * (no modules); the grid only calls this when modules are registered.
   */
  public handleCellInteraction(interaction: CellInteraction<T>): void {
    for (const controller of this.modules.values()) {
      if (isCellInteractionHandler<T>(controller)) {
        controller.handleCellInteraction(interaction);
      }
    }
  }

  /**
   * Collects per-module snapshot state from feature controllers implementing
   * {@link SerializableModule}, keyed by module id. Returns an empty object for
   * the community grid (no modules). Used by `ApexGrid.getState`.
   */
  public serializeModuleState(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [id, controller] of this.modules) {
      if (isSerializableModule(controller)) {
        out[id] = controller.serializeState();
      }
    }
    return out;
  }

  /**
   * Dispatches previously-serialized state back to the matching feature modules
   * (by id) that implement {@link SerializableModule}. Missing ids and unknown
   * modules are ignored. Used by `ApexGrid.setState`.
   */
  public restoreModuleState(data: Record<string, unknown> | undefined): void {
    if (!data) return;
    for (const [id, controller] of this.modules) {
      if (isSerializableModule(controller) && Object.hasOwn(data, id)) {
        controller.restoreState(data[id]);
      }
    }
  }

  public hostConnected() {}

  public hostUpdate(): void {
    this.headerRow?.requestUpdate();
    this.scrollContainer?.requestUpdate();
    this.paginator?.requestUpdate();
    this.toolbar?.requestUpdate();
  }
}

export const gridStateContext = createContext<StateController<any>>('gridStateController');
