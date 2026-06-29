import type { GridFeatureModule } from 'apex-grid/internal';
import { aggregationModule } from './features/aggregation.js';
import { contextMenuModule } from './features/context-menu.js';
import { formulaModule } from './features/formula/index.js';
import { groupingModule } from './features/grouping.js';
import { pivotModule } from './features/pivot.js';
import { rangeSelectionModule } from './features/range-selection.js';

/**
 * Every built-in enterprise feature module, for the batteries-included path.
 * Pass to {@link ApexGridEnterprise.use} to opt into all features at once
 * (this is what `apex-grid-enterprise/define` does). Importing this array pulls
 * in every feature's code; import individual modules instead
 * (`{ pivotModule }`) to keep the rest tree-shaken.
 */
export const enterpriseModules: ReadonlyArray<GridFeatureModule> = [
  aggregationModule,
  groupingModule,
  pivotModule,
  rangeSelectionModule,
  contextMenuModule,
  formulaModule,
];
