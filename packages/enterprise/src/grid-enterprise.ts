import { LicenseManager } from 'apex-commons';
import {
  ApexGrid,
  type GridFeatureModule,
  registerComponent,
  StateController,
} from 'apex-grid/internal';
import { html, nothing } from 'lit';
import {
  AGGREGATION_MODULE_ID,
  type AggregationConfig,
  type AggregationController,
  type AggregationResults,
  aggregationModule,
} from './features/aggregation.js';

/** Custom-element tag for the enterprise grid. */
export const ENTERPRISE_TAG = 'apex-grid-enterprise';

/**
 * Feature modules layered onto the enterprise grid via the core extension seam.
 * Kept as a module-level constant so it is shared across instances.
 */
const ENTERPRISE_MODULES: ReadonlyArray<GridFeatureModule> = [aggregationModule];

// Repeating diagonal watermark shown when no valid license is set. Rendered in
// the grid's shadow DOM as a non-interactive overlay (absolute + inset:0 covers
// the full scroll area without disturbing the grid layout).
const WATERMARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">' +
  '<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" ' +
  'font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif" ' +
  'font-size="16" font-weight="600" fill="rgba(134,134,134,0.16)" ' +
  'transform="rotate(-35,160,100)">apex-grid-enterprise</text></svg>';
const WATERMARK_STYLE = [
  'position:absolute',
  'inset:0',
  'pointer-events:none',
  'user-select:none',
  'z-index:10000',
  `background-image:url("data:image/svg+xml,${encodeURIComponent(WATERMARK_SVG)}")`,
  'background-repeat:repeat',
].join(';');

/**
 * Pro-licensed grid. Extends the community {@link ApexGrid} and registers as
 * `<apex-grid-enterprise>`, reusing the full grid template/DOM and layering in
 * enterprise-only feature modules through `createStateController()`.
 *
 * Licensing follows the non-hostile, offline model: without a valid key set via
 * {@link ApexGridEnterprise.setLicense} the grid keeps working but renders a
 * watermark and logs a console notice.
 */
export class ApexGridEnterprise<T extends object> extends ApexGrid<T> {
  /** Live instances, so {@link setLicense} can refresh watermarks on the fly. */
  static #instances = new Set<ApexGridEnterprise<any>>();

  /**
   * Per-column aggregation request (sum/avg/min/max/count). Read on demand by
   * {@link getAggregations}.
   */
  public aggregations: AggregationConfig = {};

  public static override get tagName(): string {
    return ENTERPRISE_TAG;
  }

  /**
   * Registers `<apex-grid-enterprise>` and the grid's internal dependencies.
   * Idempotent. Reuses {@link ApexGrid.register} for the shared sub-components,
   * then defines the enterprise element.
   */
  public static override register(): void {
    ApexGrid.register();
    registerComponent(ApexGridEnterprise);
  }

  /**
   * Sets the global ApexCharts license key. Without a valid key the grid renders
   * with a watermark. Validation is offline (no network).
   */
  public static setLicense(key: string): void {
    LicenseManager.setLicense(key);
    for (const grid of ApexGridEnterprise.#instances) {
      grid.requestUpdate();
    }
  }

  public override connectedCallback(): void {
    super.connectedCallback();
    ApexGridEnterprise.#instances.add(this);
  }

  public override disconnectedCallback(): void {
    ApexGridEnterprise.#instances.delete(this);
    super.disconnectedCallback();
  }

  /** Computes the configured {@link aggregations} over the grid's data. */
  public getAggregations(): AggregationResults {
    const controller = this.stateController.module<AggregationController<T>>(AGGREGATION_MODULE_ID);
    return controller ? controller.compute(this.data, this.aggregations) : {};
  }

  protected override createStateController(): StateController<T> {
    return new StateController<T>(this, ENTERPRISE_MODULES as ReadonlyArray<GridFeatureModule<T>>);
  }

  protected override render() {
    return html`${super.render()}${this.#renderWatermark()}`;
  }

  #renderWatermark() {
    if (LicenseManager.isLicenseValid()) {
      return nothing;
    }
    return html`<div part="license-watermark" aria-hidden="true" style=${WATERMARK_STYLE}></div>`;
  }
}
