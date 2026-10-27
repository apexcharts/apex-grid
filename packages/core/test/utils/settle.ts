import { nextFrame } from '@open-wc/testing';
import type ApexVirtualizer from '../../src/components/virtualizer.js';

/** Any grid element: the free grid, a derived one, or one typed only as an element. */
type GridLike = HTMLElement & { updateComplete?: Promise<unknown>; renderRoot?: ParentNode };

/** The grid's body virtualizer, the protected `scrollContainer` or its tag in the shadow root. */
function bodyOf(grid: GridLike): ApexVirtualizer | null {
  const own = (grid as unknown as { scrollContainer?: ApexVirtualizer }).scrollContainer;
  return own ?? (grid.renderRoot ?? grid.shadowRoot)?.querySelector('apex-virtualizer') ?? null;
}

/**
 * Waits for a grid to finish rendering and laying out its body: the grid's
 * update, then the body virtualizer's `settled()`, then two frames.
 *
 * Raw `layoutComplete` is deliberately not awaited. Upstream resolves it only
 * when the ResizeObserver on the rendered rows fires, so after a render that
 * re-binds rows in place (a sort or `moveRow` under slot keys) nothing resizes
 * and the promise never resolves. `settled()` races it against a bounded
 * timeout. See plans/core/2026-10-27-row-recycling-plan.md, section 3.5.
 */
export async function settle(grid: GridLike): Promise<void> {
  await grid.updateComplete;
  await bodyOf(grid)?.settled();
  await nextFrame();
  await nextFrame();
}
