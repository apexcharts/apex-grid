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
export { viewIndexer } from '../controllers/history.js';
export { gridStateContext, StateController } from '../controllers/state.js';
export {
  clampRating,
  commitDateInSameShape,
  getColumnTypeRenderer,
  getRatingMax,
  getSelectOptions,
  parseDate,
} from './column-types.js';
export { PIPELINE } from './constants.js';
export type { ExportCellValue, ExportFormat, ExportOptions } from './export.js';
export {
  downloadBlob,
  escapeCSVCell,
  getColumnLabel,
  resolveExportColumns,
  resolveExportRows,
  resolveExportValue,
} from './export.js';
export type {
  CellDecoration,
  CellDecorator,
  CellDecoratorContext,
  CellInteraction,
  CellInteractionHandler,
  CellInteractionKind,
  ColumnMenuProvider,
  CoordinateLabeler,
  GridFeatureModule,
  PresentedRow,
  RowAria,
  RowAriaProvider,
  RowPresenter,
  RowPresenterContext,
  RowTransformer,
  SerializableModule,
} from './feature-module.js';
export {
  isCellDecorator,
  isCellInteractionHandler,
  isColumnMenuProvider,
  isCoordinateLabeler,
  isRowAriaProvider,
  isRowPresenter,
  isRowTransformer,
  isSerializableModule,
} from './feature-module.js';
export { registerComponent } from './register.js';
export type {
  ColumnLayoutState,
  FilterStateSnapshot,
  GetStateOptions,
  GridState,
  RowRef,
  SetStateOptions,
  SortStateSnapshot,
} from './state-snapshot.js';
export {
  applyColumnLayout,
  deserializeFilter,
  mergeColumnLayout,
  resolveFilterOperand,
  resolveRowRefs,
  serializeColumnLayout,
  serializeFilter,
  serializeRowRefs,
  serializeSort,
} from './state-snapshot.js';
export type { ActiveNode, ColumnConfiguration, GridHost, Keys, ToolbarAction } from './types.js';
export { getDisplayColumns } from './utils.js';
