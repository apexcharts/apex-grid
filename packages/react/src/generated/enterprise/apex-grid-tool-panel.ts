'use client';
// GENERATED FROM custom-elements.json - do not edit by hand.
// Manifest input hash: 1f71df978323
// Regenerate with `npm run generate`.

import * as React from 'react';
import { createComponent } from '@lit/react';
import { ApexGridToolPanel as ApexGridToolPanelElement } from 'apex-grid-enterprise';
import { apexGridToolPanelEvents } from './events.js';

// Register the element on the client only. On the server (SSR / RSC) this is
// a no-op, so importing the wrapper in a server component neither throws nor
// pollutes the registry; the element registers before its first client render.
if (typeof window !== 'undefined') {
  ApexGridToolPanelElement.register();
}

/** Properties of `<apex-grid-tool-panel>` a prop can set: public fields that are not read-only. */
export type ApexGridToolPanelSettableProp =
  | 'grid'
  | 'pivotMode';

const ApexGridToolPanelComponent = createComponent({
  react: React,
  tagName: 'apex-grid-tool-panel',
  elementClass: ApexGridToolPanelElement,
  events: apexGridToolPanelEvents,
});

/** React wrapper for `<apex-grid-tool-panel>`. */
export const ApexGridToolPanel = ApexGridToolPanelComponent as React.ForwardRefExoticComponent<
  Omit<
    React.ComponentProps<typeof ApexGridToolPanelComponent>,
    Exclude<keyof InstanceType<typeof ApexGridToolPanelElement>, keyof HTMLElement | ApexGridToolPanelSettableProp>
  >
>;
