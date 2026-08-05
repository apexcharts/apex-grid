export { LicenseManager } from 'apex-commons';
export { AI_TAG, ApexGridAI } from './ai-panel.js';
export { ApexGridChart, CHART_TAG, type ChartConfig, type ChartSource } from './chart-panel.js';
export {
  type AdvancedFilterCondition,
  type AdvancedFilterGroup,
  type AdvancedFilterJoin,
  type AdvancedFilterModel,
  type AdvancedFilterNode,
  defaultOperator,
  emptyAdvancedFilter,
  filterRows,
  isEmptyModel,
  operandsForType,
  operatorsForType,
} from './features/advanced-filter.js';
export type {
  AggregationConfig,
  AggregationFn,
  AggregationResults,
} from './features/aggregation.js';
export { aggregationModule } from './features/aggregation.js';
// AI reasoning layer: GridApi facade, ContextBuilder, Memory, tools + executor,
// the rule engine, and the engine + router behind grid.runPrompt / previewPrompt.
export * from './features/ai/index.js';
export type { JSONSchema, StatePatch } from './features/ai-schema.js';
export { toJSONSchema } from './features/ai-schema.js';
export {
  buildValueAxes,
  type CalculatedField,
  type ChartAggregation,
  type ChartDefinition,
  type ChartField,
  type ChartFormat,
  type ChartModel,
  type ChartSeries,
  type ChartType,
  chartModelToApexOptions,
  formatToApexOptions,
  linearForecast,
  linearForecastBand,
  linearTrend,
  type RenderChartOptions,
  recommendChartType,
} from './features/chart.js';
export { computeCalculatedSeries, isValidChartFormula } from './features/chart-calc.js';
export {
  CONTEXT_MENU_OPENING_EVENT,
  type ContextMenuConfig,
  type ContextMenuItem,
  type ContextMenuOpeningDetail,
  type ContextMenuTarget,
  contextMenuModule,
} from './features/context-menu.js';
export {
  type CellAddress,
  type CellValue,
  createFunctionRegistry,
  evaluate,
  FORMULA_EDITOR_TAG,
  FORMULA_MODULE_ID,
  FormulaCellEditor,
  type FormulaContext,
  type FormulaController,
  FormulaError,
  type FormulaErrorCode,
  type FormulaFn,
  formulaModule,
  parseFormula,
  type RangeAddress,
} from './features/formula/index.js';
export type { GroupRowMeta } from './features/grouping.js';
export { groupingModule } from './features/grouping.js';
export type {
  InfiniteDataSource,
  InfiniteGetRowsParams,
  InfiniteGetRowsResult,
  InfiniteRowModelConfig,
  RowsLoadedDetail,
} from './features/infinite-row-model.js';
export { ROWS_LOADED_EVENT } from './features/infinite-row-model.js';
export type { MasterDetailConfig, MasterDetailContext } from './features/master-detail.js';
export {
  getPivotMeta,
  PIVOT_GROUP_KEY,
  type PivotOptions,
  type PivotRowKind,
  type PivotRowMeta,
  pivotModule,
} from './features/pivot.js';
export type {
  RangeBounds,
  RangeChangedDetail,
  RangeStats,
} from './features/range-selection.js';
export { RANGE_CHANGED_EVENT, rangeSelectionModule } from './features/range-selection.js';
export type { XLSXExportOptions } from './features/xlsx.js';
export { ApexGridFilterBuilder, FILTER_BUILDER_TAG } from './filter-builder.js';
export { ApexGridEnterprise, ENTERPRISE_TAG, VIEW_CHANGED_EVENT } from './grid-enterprise.js';
// Aggregate of every built-in feature module, for the batteries-included path.
export { enterpriseModules } from './modules.js';
export { ApexGridSetFilter, SET_FILTER_TAG } from './set-filter.js';
export { ApexGridStatusBar, STATUS_BAR_TAG } from './status-bar.js';
export { ApexGridToolPanel, TOOL_PANEL_TAG } from './tool-panel.js';
