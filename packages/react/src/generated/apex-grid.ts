// GENERATED FROM custom-elements.json - do not edit by hand.
// Manifest hash: 4c9da8072cf5
// Regenerate with `npm run generate`.

import * as React from 'react';
import { createComponent } from '@lit/react';
import { ApexGrid as ApexGridElement } from 'apex-grid';
import 'apex-grid/define';
import { apexGridEvents } from '../events.js';

/**
 * React wrapper for `<apex-grid>`. This base component types `data` /
 * `columns` as `object`; use `createApexGrid<T>()` for row-typed props and events.
 */
export const ApexGrid = createComponent({
  react: React,
  tagName: 'apex-grid',
  elementClass: ApexGridElement,
  events: apexGridEvents,
});
