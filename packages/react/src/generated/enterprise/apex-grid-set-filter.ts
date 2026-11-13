'use client';
// GENERATED FROM custom-elements.json - do not edit by hand.
// Manifest input hash: 1f71df978323
// Regenerate with `npm run generate`.

import * as React from 'react';
import { createComponent } from '@lit/react';
import { ApexGridSetFilter as ApexGridSetFilterElement } from 'apex-grid-enterprise';
import { apexGridSetFilterEvents } from './events.js';

// Register the element on the client only. On the server (SSR / RSC) this is
// a no-op, so importing the wrapper in a server component neither throws nor
// pollutes the registry; the element registers before its first client render.
if (typeof window !== 'undefined') {
  ApexGridSetFilterElement.register();
}

/** Properties of `<apex-grid-set-filter>` a prop can set: public fields that are not read-only. */
export type ApexGridSetFilterSettableProp =
  | 'column'
  | 'grid';

const ApexGridSetFilterComponent = createComponent({
  react: React,
  tagName: 'apex-grid-set-filter',
  elementClass: ApexGridSetFilterElement,
  events: apexGridSetFilterEvents,
});

/** React wrapper for `<apex-grid-set-filter>`. */
export const ApexGridSetFilter = ApexGridSetFilterComponent as React.ForwardRefExoticComponent<
  Omit<
    React.ComponentProps<typeof ApexGridSetFilterComponent>,
    Exclude<keyof InstanceType<typeof ApexGridSetFilterElement>, keyof HTMLElement | ApexGridSetFilterSettableProp>
  >
>;
