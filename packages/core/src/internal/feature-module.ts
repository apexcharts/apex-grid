import type { ReactiveController, TemplateResult } from 'lit';
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
   */
  create(host: GridHost<T>): ReactiveController;
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
