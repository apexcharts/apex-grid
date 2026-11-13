'use client';
// GENERATED FROM custom-elements.json - do not edit by hand.
// Manifest input hash: 1f71df978323
// Regenerate with `npm run generate`.

import * as React from 'react';
import { createComponent } from '@lit/react';
import { ApexGridEnterprise as ApexGridEnterpriseElement, enterpriseModules } from 'apex-grid-enterprise';
import { apexGridEnterpriseEvents } from './events.js';

// Register the element on the client only. On the server (SSR / RSC) this is
// a no-op, so importing the wrapper in a server component neither throws nor
// pollutes the registry; the element registers before its first client render.
if (typeof window !== 'undefined') {
  ApexGridEnterpriseElement.use(...enterpriseModules);
  ApexGridEnterpriseElement.register();
}

/** Properties of `<apex-grid-enterprise>` a prop can set: public fields that are not read-only. */
export type ApexGridEnterpriseSettableProp =
  | 'aggregations'
  | 'aiEngine'
  | 'aiReasoner'
  | 'autoGenerate'
  | 'columnGroups'
  | 'columnMenu'
  | 'columnReordering'
  | 'columnSeparator'
  | 'columns'
  | 'contextMenu'
  | 'coordinateHints'
  | 'data'
  | 'dataPipelineConfiguration'
  | 'designSystem'
  | 'editing'
  | 'expandedRows'
  | 'expansion'
  | 'exportFilename'
  | 'filterExpressions'
  | 'groupBy'
  | 'groupingOptions'
  | 'infiniteRowModel'
  | 'localeText'
  | 'masterDetail'
  | 'page'
  | 'pageSize'
  | 'pagination'
  | 'pivotOn'
  | 'pivotOptions'
  | 'pivotRows'
  | 'pivotValues'
  | 'quickFilter'
  | 'rangeSelection'
  | 'rowId'
  | 'rowPinning'
  | 'rowRecycling'
  | 'rowReordering'
  | 'selectedRows'
  | 'selection'
  | 'serverSideRowModel'
  | 'showExport'
  | 'showFormulas'
  | 'showHeader'
  | 'showQuickFilter'
  | 'sortConfiguration'
  | 'sortExpressions'
  | 'tokens'
  | 'totalRow'
  | 'tree';

/** Attributes `<apex-grid-enterprise>` documents without a property; React sets them as attributes. */
export interface ApexGridEnterpriseAttributeProps {
  /**
   * Space-separated theme flags. `dark` opts into the built-in dark palette;
   * `tinted` mixes `--ag-brand` into the chrome surfaces. Combine as
   * `theme="dark tinted"`. With the `apex-grid/ignite-ui` add-on a grid without
   * `dark` or `light` follows the Ignite UI variant, and `light` keeps it
   * light.
   */
  theme?: string;
}

const ApexGridEnterpriseComponent = createComponent({
  react: React,
  tagName: 'apex-grid-enterprise',
  elementClass: ApexGridEnterpriseElement,
  events: apexGridEnterpriseEvents,
});

/**
 * React wrapper for `<apex-grid-enterprise>`. This base component types `data` /
 * `columns` as `object`; use `createApexGridEnterprise<T>()` for row-typed props and events.
 */
export const ApexGridEnterprise = ApexGridEnterpriseComponent as React.ForwardRefExoticComponent<
  Omit<
    React.ComponentProps<typeof ApexGridEnterpriseComponent>,
    Exclude<keyof InstanceType<typeof ApexGridEnterpriseElement>, keyof HTMLElement | ApexGridEnterpriseSettableProp>
  > & ApexGridEnterpriseAttributeProps
>;
