'use client';
// GENERATED FROM custom-elements.json - do not edit by hand.
// Manifest input hash: 1f71df978323
// Regenerate with `npm run generate`.

import * as React from 'react';
import { createComponent } from '@lit/react';
import { ApexGridStatusBar as ApexGridStatusBarElement } from 'apex-grid-enterprise';
import { apexGridStatusBarEvents } from './events.js';

// Register the element on the client only. On the server (SSR / RSC) this is
// a no-op, so importing the wrapper in a server component neither throws nor
// pollutes the registry; the element registers before its first client render.
if (typeof window !== 'undefined') {
  ApexGridStatusBarElement.register();
}

/** Properties of `<apex-grid-status-bar>` a prop can set: public fields that are not read-only. */
export type ApexGridStatusBarSettableProp =
  | 'grid';

const ApexGridStatusBarComponent = createComponent({
  react: React,
  tagName: 'apex-grid-status-bar',
  elementClass: ApexGridStatusBarElement,
  events: apexGridStatusBarEvents,
});

/** React wrapper for `<apex-grid-status-bar>`. */
export const ApexGridStatusBar = ApexGridStatusBarComponent as React.ForwardRefExoticComponent<
  Omit<
    React.ComponentProps<typeof ApexGridStatusBarComponent>,
    Exclude<keyof InstanceType<typeof ApexGridStatusBarElement>, keyof HTMLElement | ApexGridStatusBarSettableProp>
  >
>;
