import { nextFrame } from '@open-wc/testing';

/** The part of the core body virtualizer the helper relies on. */
interface SettlingBody {
  settled(): Promise<void>;
}

/**
 * Waits until a grid has rendered and its body layout has settled: the grid's
 * update, then the body virtualizer's `settled()`, then two frames so row and
 * cell renders queued by the layout have landed.
 *
 * Raw upstream `layoutComplete` is deliberately not awaited. It resolves only
 * when the virtualizer's children ResizeObserver fires, so after an in-place
 * rebind that resizes nothing (`moveRow`, a sort, under slot or index keys) it
 * never resolves and the test times out. `settled()` races it against a bounded
 * wait (row recycling plan, section 3.5).
 */
export async function settle(grid: HTMLElement & { updateComplete: Promise<unknown> }) {
  await grid.updateComplete;
  const body = (grid as unknown as { scrollContainer?: SettlingBody }).scrollContainer;
  await body?.settled();
  await nextFrame();
  await nextFrame();
}
