import type { ReactiveController, TemplateResult } from 'lit';
// Type-only import — erased at runtime, so this does not create a runtime
// import cycle with `controllers/state.ts` (which imports the guards below).
import type { StateController } from '../controllers/state.js';
import type { ColumnConfiguration, GridHost } from './types.js';

/**
 * Extension point for layering optional features onto the grid without baking
 * them into the community build.
 *
 * A feature module contributes a {@link ReactiveController} that is constructed
 * alongside the grid's built-in controllers (see {@link StateController}). It is
 * the seam used by the first-party `@apexcharts/grid-enterprise` package; it is
 * intentionally minimal and additive so the community `<apex-grid>` element is
 * unaffected (it registers zero modules).
 *
 * @remarks This API lives under the unstable `apex-grid/internal` entry point.
 */
export interface GridFeatureModule<T extends object = any> {
  /**
   * Stable identifier, e.g. `'grouping'`. Used to de-duplicate modules and to
   * look the controller up later via {@link StateController.module}.
   */
  readonly id: string;

  /**
   * Construct the feature's controller. The controller is expected to register
   * itself with the host (typically `host.addController(this)` in its
   * constructor), exactly like the built-in controllers.
   *
   * @param host  The grid host the controller drives.
   * @param state The owning {@link StateController}, passed so a module can
   *   coordinate with cross-cutting grid state (e.g. request a cell-decoration
   *   refresh via {@link StateController.bumpDecoration} or look up a peer
   *   module). Modules that don't need it may ignore the argument.
   */
  create(host: GridHost<T>, state: StateController<T>): ReactiveController;
}

/**
 * Optional capability a feature module's controller may implement to transform
 * the row set *after* the built-in pipeline (filter → sort → tree) and *before*
 * pagination is sliced at render time. Lets a module inject or reorder rows —
 * e.g. synthesized group-header rows — in the rendered `dataView`.
 *
 * Controllers that don't implement this are skipped, so the community grid
 * (which registers no modules) is unaffected.
 *
 * @remarks Unstable; part of `apex-grid/internal`.
 */
export interface RowTransformer<T extends object = any> {
  /** Return the transformed rows. Must not mutate the input array in place. */
  processRows(rows: ReadonlyArray<T>): T[];
}

/** Runtime type-guard for {@link RowTransformer}. */
export function isRowTransformer<T extends object>(
  controller: unknown
): controller is RowTransformer<T> {
  return (
    typeof controller === 'object' &&
    controller !== null &&
    typeof (controller as RowTransformer<T>).processRows === 'function'
  );
}

/** Per-row context handed to a {@link RowPresenter}. */
export interface RowPresenterContext<T extends object = any> {
  /** The grid's visible columns (post-reorder/visibility). */
  readonly columns: ReadonlyArray<ColumnConfiguration<T>>;
  /** Index of the row within the current page/view. */
  readonly rowIndex: number;
}

/**
 * A module-rendered, full-width row. Rendered inside a container that spans all
 * columns (`grid-column: 1 / -1`), mirroring the master-detail panel pattern.
 */
export interface PresentedRow {
  /** Template rendered inside the full-width container. */
  readonly content: TemplateResult;
  /** Optional 1-based `aria-level` applied to the row element. */
  readonly level?: number;
  /** Optional `aria-expanded` for the row element; omit for non-expandable rows. */
  readonly expanded?: boolean;
  /** Shadow part for the container element; defaults to `group-row`. */
  readonly part?: string;
}

/**
 * Optional capability a feature module's controller may implement to render
 * specific rows as full-width custom content (e.g. group headers) instead of
 * the normal cell grid. Returns `null` for rows the module does not own.
 *
 * @remarks Unstable; part of `apex-grid/internal`.
 */
export interface RowPresenter<T extends object = any> {
  presentRow(row: T, ctx: RowPresenterContext<T>): PresentedRow | null;
}

/** Runtime type-guard for {@link RowPresenter}. */
export function isRowPresenter<T extends object>(
  controller: unknown
): controller is RowPresenter<T> {
  return (
    typeof controller === 'object' &&
    controller !== null &&
    typeof (controller as RowPresenter<T>).presentRow === 'function'
  );
}

/** Per-cell context handed to a {@link CellDecorator}. */
export interface CellDecoratorContext<T extends object = any> {
  /** The row's backing data (or a synthesized row object). */
  readonly row: T;
  /** Index of the row within the current page/view (matches `host.pageItems`). */
  readonly rowIndex: number;
  /** The cell's column configuration. */
  readonly column: ColumnConfiguration<T>;
  /** The cell's resolved value (`row[column.key]`). */
  readonly value: unknown;
}

/**
 * A set of host attributes a module asks the cell to reflect on itself. This is
 * the only thing a {@link CellDecorator} returns — styling is expressed by
 * keying CSS off these attributes (the cell ships an inert, variable-driven
 * `:host([data-range])` style; enterprise themes it via inheriting custom
 * properties).
 */
export interface CellDecoration {
  /**
   * Attributes to set on the decorated cell host. Use a `data-*` namespace
   * (e.g. `data-range`) so decoration never collides with the cell's built-in
   * reflected attributes (`active`, `editing`, `data-pinned`, …). A `null`/
   * `undefined` value removes the attribute. Attributes set on a previous
   * update that are absent here are removed automatically.
   */
  readonly attributes: Readonly<Record<string, string | null | undefined>>;
}

/**
 * Optional capability a feature module's controller may implement to decorate
 * individual cells with extra host attributes during the cell's own render
 * lifecycle — e.g. flagging the cells inside a selected range. Consulted per
 * cell via {@link StateController.decorateCell}; controllers that don't
 * implement it are skipped, so the community grid is unaffected.
 *
 * @remarks Unstable; part of `apex-grid/internal`.
 */
export interface CellDecorator<T extends object = any> {
  /** Return decoration for this cell, or `null` to leave it undecorated. */
  decorateCell(ctx: CellDecoratorContext<T>): CellDecoration | null;
}

/** Runtime type-guard for {@link CellDecorator}. */
export function isCellDecorator<T extends object>(
  controller: unknown
): controller is CellDecorator<T> {
  return (
    typeof controller === 'object' &&
    controller !== null &&
    typeof (controller as CellDecorator<T>).decorateCell === 'function'
  );
}

/** The kind of pointer interaction forwarded from a body cell. */
export type CellInteractionKind = 'down' | 'over' | 'up';

/** A pointer interaction on a body cell, forwarded to feature modules. */
export interface CellInteraction<T extends object = any> {
  /** `down` on press, `over` while the pointer moves across cells, `up` on release. */
  readonly kind: CellInteractionKind;
  /** The cell's row data. */
  readonly row: T;
  /** Index of the row within the current page/view (matches `host.pageItems`). */
  readonly rowIndex: number;
  /** The cell's column configuration. */
  readonly column: ColumnConfiguration<T>;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  /** The originating pointer event (e.g. to call `preventDefault`). */
  readonly originalEvent: PointerEvent;
}

/**
 * Optional capability a feature module's controller may implement to receive
 * pointer interactions on body cells (press / drag-over / release) — the seam a
 * range-selection feature uses to track a drag. The grid forwards interactions
 * only when at least one feature module is registered, so the community grid
 * pays nothing.
 *
 * @remarks Unstable; part of `apex-grid/internal`.
 */
export interface CellInteractionHandler<T extends object = any> {
  handleCellInteraction(interaction: CellInteraction<T>): void;
}

/** Runtime type-guard for {@link CellInteractionHandler}. */
export function isCellInteractionHandler<T extends object>(
  controller: unknown
): controller is CellInteractionHandler<T> {
  return (
    typeof controller === 'object' &&
    controller !== null &&
    typeof (controller as CellInteractionHandler<T>).handleCellInteraction === 'function'
  );
}
