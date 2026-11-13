'use client';
// GENERATED FROM custom-elements.json - do not edit by hand.
// Manifest input hash: 3c881a4c3d5f
// Regenerate with `npm run generate`.

import * as React from 'react';
import { createComponent } from '@lit/react';
import { ApexGrid as ApexGridElement } from 'apex-grid';
import { apexGridEvents } from '../events.js';

// Register the element on the client only. On the server (SSR / RSC) this is
// a no-op, so importing the wrapper in a server component neither throws nor
// pollutes the registry; the element registers before its first client render.
if (typeof window !== 'undefined') {
  ApexGridElement.register();
}

/** Properties of `<apex-grid>` a prop can set: public fields that are not read-only. */
export type ApexGridSettableProp =
  | 'autoGenerate'
  | 'columnGroups'
  | 'columnMenu'
  | 'columnReordering'
  | 'columnSeparator'
  | 'columns'
  | 'coordinateHints'
  | 'data'
  | 'dataPipelineConfiguration'
  | 'designSystem'
  | 'editing'
  | 'expandedRows'
  | 'expansion'
  | 'exportFilename'
  | 'filterExpressions'
  | 'localeText'
  | 'page'
  | 'pageSize'
  | 'pagination'
  | 'quickFilter'
  | 'rowId'
  | 'rowPinning'
  | 'rowRecycling'
  | 'rowReordering'
  | 'selectedRows'
  | 'selection'
  | 'showExport'
  | 'showHeader'
  | 'showQuickFilter'
  | 'sortConfiguration'
  | 'sortExpressions'
  | 'tokens'
  | 'tree';

/** Attributes `<apex-grid>` documents without a property; React sets them as attributes. */
export interface ApexGridAttributeProps {
  /**
   * Space-separated theme flags. `dark` opts into the built-in dark palette;
   * `tinted` mixes `--ag-brand` into the chrome surfaces. Combine as
   * `theme="dark tinted"`. With the `apex-grid/ignite-ui` add-on a grid without
   * `dark` or `light` follows the Ignite UI variant, and `light` keeps it
   * light.
   */
  theme?: string;
}

const ApexGridComponent = createComponent({
  react: React,
  tagName: 'apex-grid',
  elementClass: ApexGridElement,
  events: apexGridEvents,
});

/**
 * React wrapper for `<apex-grid>`. This base component types `data` /
 * `columns` as `object`; use `createApexGrid<T>()` for row-typed props and events.
 */
export const ApexGrid = ApexGridComponent as React.ForwardRefExoticComponent<
  Omit<
    React.ComponentProps<typeof ApexGridComponent>,
    Exclude<keyof InstanceType<typeof ApexGridElement>, keyof HTMLElement | ApexGridSettableProp>
  > & ApexGridAttributeProps
>;
