'use client';
// GENERATED FROM custom-elements.json - do not edit by hand.
// Manifest input hash: 1f71df978323
// Regenerate with `npm run generate`.

import * as React from 'react';
import { createComponent } from '@lit/react';
import { ApexGridFilterBuilder as ApexGridFilterBuilderElement } from 'apex-grid-enterprise';
import { apexGridFilterBuilderEvents } from './events.js';

// Register the element on the client only. On the server (SSR / RSC) this is
// a no-op, so importing the wrapper in a server component neither throws nor
// pollutes the registry; the element registers before its first client render.
if (typeof window !== 'undefined') {
  ApexGridFilterBuilderElement.register();
}

/** Properties of `<apex-grid-filter-builder>` a prop can set: public fields that are not read-only. */
export type ApexGridFilterBuilderSettableProp =
  | 'grid'
  | 'model';

const ApexGridFilterBuilderComponent = createComponent({
  react: React,
  tagName: 'apex-grid-filter-builder',
  elementClass: ApexGridFilterBuilderElement,
  events: apexGridFilterBuilderEvents,
});

/** React wrapper for `<apex-grid-filter-builder>`. */
export const ApexGridFilterBuilder = ApexGridFilterBuilderComponent as React.ForwardRefExoticComponent<
  Omit<
    React.ComponentProps<typeof ApexGridFilterBuilderComponent>,
    Exclude<keyof InstanceType<typeof ApexGridFilterBuilderElement>, keyof HTMLElement | ApexGridFilterBuilderSettableProp>
  >
>;
