'use client';
// GENERATED FROM custom-elements.json - do not edit by hand.
// Manifest hash: 4c9da8072cf5
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

/** React wrapper for `<apex-grid-paginator>`. */
export const ApexGridPaginator = createComponent({
  react: React,
  tagName: 'apex-grid-paginator',
  elementClass: ApexGridPaginatorElement,
  events: apexGridPaginatorEvents,
});
