import type { ReactiveController } from 'lit';
import type { GridHost } from './types.js';

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
