'use client';
// GENERATED FROM custom-elements.json - do not edit by hand.
// Manifest input hash: 1f71df978323
// Regenerate with `npm run generate`.

import * as React from 'react';
import { createComponent } from '@lit/react';
import { ApexGridChart as ApexGridChartElement } from 'apex-grid-enterprise';
import { apexGridChartEvents } from './events.js';

// Register the element on the client only. On the server (SSR / RSC) this is
// a no-op, so importing the wrapper in a server component neither throws nor
// pollutes the registry; the element registers before its first client render.
if (typeof window !== 'undefined') {
  ApexGridChartElement.register();
}

/** Properties of `<apex-grid-chart>` a prop can set: public fields that are not read-only. */
export type ApexGridChartSettableProp =
  | 'apexOptions'
  | 'crossFilter'
  | 'definition'
  | 'format'
  | 'grid'
  | 'heading'
  | 'height'
  | 'mode'
  | 'open'
  | 'source'
  | 'staticModel'
  | 'theme'
  | 'type';

const ApexGridChartComponent = createComponent({
  react: React,
  tagName: 'apex-grid-chart',
  elementClass: ApexGridChartElement,
  events: apexGridChartEvents,
});

/** React wrapper for `<apex-grid-chart>`. */
export const ApexGridChart = ApexGridChartComponent as React.ForwardRefExoticComponent<
  Omit<
    React.ComponentProps<typeof ApexGridChartComponent>,
    Exclude<keyof InstanceType<typeof ApexGridChartElement>, keyof HTMLElement | ApexGridChartSettableProp>
  >
>;
