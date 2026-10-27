import { virtualizerRef } from '@lit-labs/virtualizer/virtualize.js';
import { expect } from '@open-wc/testing';
import type ApexVirtualizer from '../../src/components/virtualizer.js';

/**
 * Defers the body's layout runs, which report the rendered range, by `ms`, as
 * a slower layout would. New items reach the rows only after that report, so
 * this makes any wait that relies on a microtask chain outlasting it fail.
 * Returns the restore function.
 */
export function delayRangeReports(body: ApexVirtualizer, ms: number): () => void {
  const virtualizer = (body as unknown as Record<symbol, Record<string, unknown>>)[virtualizerRef];
  const schedule = virtualizer._schedule as (method: () => void) => Promise<void>;
  expect(schedule, 'upstream _schedule').to.be.a('function');
  virtualizer._schedule = function (this: unknown, method: () => void) {
    setTimeout(() => void schedule.call(this, method), ms);
  };
  return () => {
    delete virtualizer._schedule;
  };
}
