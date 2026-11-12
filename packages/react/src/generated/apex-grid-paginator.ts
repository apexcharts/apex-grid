'use client';
// GENERATED FROM custom-elements.json - do not edit by hand.
// Manifest input hash: 8fcdbabe359a
// Regenerate with `npm run generate`.

import * as React from 'react';
import { createComponent } from '@lit/react';
import { ApexGridPaginator as ApexGridPaginatorElement } from 'apex-grid';
import { apexGridPaginatorEvents } from '../events.js';

// Register the element on the client only. On the server (SSR / RSC) this is
// a no-op, so importing the wrapper in a server component neither throws nor
// pollutes the registry; the element registers before its first client render.
if (typeof window !== 'undefined') {
  ApexGridPaginatorElement.register();
}

/**
 * React wrapper for `<apex-grid-paginator>`.
 *
 * @deprecated Renders nothing outside `<apex-grid>`: the paginator reads its
 * state from the grid that hosts it, and the grid renders its own. Configure it
 * through the grid `pagination` prop instead. This export will be removed in
 * react-apex-grid 0.2.0.
 */
export const ApexGridPaginator = createComponent({
  react: React,
  tagName: 'apex-grid-paginator',
  elementClass: ApexGridPaginatorElement,
  events: apexGridPaginatorEvents,
});
