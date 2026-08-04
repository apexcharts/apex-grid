'use client';
// GENERATED FROM custom-elements.json - do not edit by hand.
// Manifest hash: 4c9da8072cf5
// Regenerate with `npm run generate`.

import * as React from 'react';
import { createComponent } from '@lit/react';
import { ApexGridToolbar as ApexGridToolbarElement } from 'apex-grid';
import { apexGridToolbarEvents } from '../events.js';

// Register the element on the client only. On the server (SSR / RSC) this is
// a no-op, so importing the wrapper in a server component neither throws nor
// pollutes the registry; the element registers before its first client render.
if (typeof window !== 'undefined') {
  ApexGridToolbarElement.register();
}

/** React wrapper for `<apex-grid-toolbar>`. */
export const ApexGridToolbar = createComponent({
  react: React,
  tagName: 'apex-grid-toolbar',
  elementClass: ApexGridToolbarElement,
  events: apexGridToolbarEvents,
});
