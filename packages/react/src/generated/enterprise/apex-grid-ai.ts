'use client';
// GENERATED FROM custom-elements.json - do not edit by hand.
// Manifest input hash: 1f71df978323
// Regenerate with `npm run generate`.

import * as React from 'react';
import { createComponent } from '@lit/react';
import { ApexGridAI as ApexGridAIElement } from 'apex-grid-enterprise';
import { apexGridAIEvents } from './events.js';

// Register the element on the client only. On the server (SSR / RSC) this is
// a no-op, so importing the wrapper in a server component neither throws nor
// pollutes the registry; the element registers before its first client render.
if (typeof window !== 'undefined') {
  ApexGridAIElement.register();
}

/** Properties of `<apex-grid-ai>` a prop can set: public fields that are not read-only. */
export type ApexGridAISettableProp =
  | 'grid'
  | 'mode'
  | 'open';

const ApexGridAIComponent = createComponent({
  react: React,
  tagName: 'apex-grid-ai',
  elementClass: ApexGridAIElement,
  events: apexGridAIEvents,
});

/** React wrapper for `<apex-grid-ai>`. */
export const ApexGridAI = ApexGridAIComponent as React.ForwardRefExoticComponent<
  Omit<
    React.ComponentProps<typeof ApexGridAIComponent>,
    Exclude<keyof InstanceType<typeof ApexGridAIElement>, keyof HTMLElement | ApexGridAISettableProp>
  >
>;
