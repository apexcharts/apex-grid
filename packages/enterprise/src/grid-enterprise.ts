import {
  ApexGrid,
  type GridFeatureModule,
  registerComponent,
  StateController,
} from 'apex-grid/internal';

/** Custom-element tag for the enterprise grid. */
export const ENTERPRISE_TAG = 'apex-grid-enterprise';

/**
 * Feature modules layered onto the enterprise grid via the core extension seam.
 * Empty for now — the first feature (and license enforcement) lands in the next
 * phase. Kept as a module-level constant so it is shared across instances.
 */
const ENTERPRISE_MODULES: ReadonlyArray<GridFeatureModule> = [];

/**
 * Pro-licensed grid. Extends the community {@link ApexGrid} and registers as
 * `<apex-grid-enterprise>`, reusing the full grid template/DOM and layering in
 * enterprise-only feature modules through `createStateController()`.
 *
 * With no modules registered yet it renders identically to `<apex-grid>`.
 */
export class ApexGridEnterprise<T extends object> extends ApexGrid<T> {
  public static override get tagName(): string {
    return ENTERPRISE_TAG;
  }

  /**
   * Registers `<apex-grid-enterprise>` and the grid's internal dependencies.
   * Idempotent. Reuses {@link ApexGrid.register} for the shared sub-components
   * (rows, header, paginator, toolbar, …), then defines the enterprise element.
   */
  public static override register(): void {
    ApexGrid.register();
    registerComponent(ApexGridEnterprise);
  }

  protected override createStateController(): StateController<T> {
    return new StateController<T>(this, ENTERPRISE_MODULES as ReadonlyArray<GridFeatureModule<T>>);
  }
}
