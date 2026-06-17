/**
 * Unstable, first-party extension surface for `apex-grid`.
 *
 * This entry point (`apex-grid/internal`) exposes the internals that the
 * first-party `@apexcharts/grid-enterprise` package builds on: the grid class,
 * its state controller, the component registration helper, and the feature
 * module contract. It is intentionally separate from the public `.` barrel.
 *
 * @remarks
 * No semver guarantees are made for these exports. They may change between
 * minor releases. Do not depend on them from third-party code.
 */
export { ApexGrid } from '../components/grid.js';
export { gridStateContext, StateController } from '../controllers/state.js';
export { PIPELINE } from './constants.js';
export type { ExportCellValue, ExportFormat, ExportOptions } from './export.js';
export {
  downloadBlob,
  getColumnLabel,
  resolveExportColumns,
  resolveExportRows,
  resolveExportValue,
} from './export.js';
export type {
  GridFeatureModule,
  PresentedRow,
  RowPresenter,
  RowPresenterContext,
  RowTransformer,
} from './feature-module.js';
export { isRowPresenter, isRowTransformer } from './feature-module.js';
export { registerComponent } from './register.js';
export type { ActiveNode, GridHost } from './types.js';
