'use client';

/**
 * react-apex-grid/enterprise: React wrappers for apex-grid-enterprise.
 *
 * - `ApexGridEnterprise`: the generated base component for
 *   `<apex-grid-enterprise>` (loosely typed, `data`/`columns` as `object`).
 * - `createApexGridEnterprise<T>()`: the row-typed enterprise grid, with typed
 *   props, community and enterprise events, and ref.
 * - `ApexGridToolPanel`, `ApexGridStatusBar`, `ApexGridSetFilter`,
 *   `ApexGridFilterBuilder`, `ApexGridChart`, `ApexGridAI`: the companion
 *   elements, each bound to a grid through its `grid` prop.
 *
 * Importing this entry opts the grid into every enterprise feature module and
 * registers the seven elements in the browser, as `apex-grid-enterprise/define`
 * does; on the server it registers nothing.
 */

export {
  ApexGridAI,
  ApexGridChart,
  ApexGridEnterprise,
  ApexGridFilterBuilder,
  ApexGridSetFilter,
  ApexGridStatusBar,
  ApexGridToolPanel,
} from '../generated/enterprise/index.js';
export {
  type ApexGridEnterpriseComponent,
  type ApexGridEnterpriseElement,
  type ApexGridEnterpriseProps,
  createApexGridEnterprise,
} from './create-apex-grid-enterprise.js';
