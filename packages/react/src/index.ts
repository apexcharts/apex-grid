export {
  type ApexGridComponent,
  type ApexGridElement,
  type ApexGridProps,
  createApexGrid,
} from './create-apex-grid.js';
/**
 * react-apex-grid: React wrappers for the apex-grid web component.
 *
 * - `ApexGrid` / `ApexGridToolbar` / `ApexGridPaginator`: generated base
 *   components (loosely typed, `data`/`columns` as `object`). Good for JS and
 *   quick usage.
 * - `createApexGrid<T>()`: the recommended path for typed apps, a row-typed
 *   `<apex-grid>` with typed props, events, and ref.
 *
 * Column, event, and configuration types come straight from `apex-grid`
 * (e.g. `import type { ColumnConfiguration } from 'apex-grid'`).
 */
export { ApexGrid, ApexGridPaginator, ApexGridToolbar } from './generated/index.js';
