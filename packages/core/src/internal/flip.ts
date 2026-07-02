/**
 * Lightweight FLIP (First / Last / Invert / Play) helpers for animating
 * element re-positioning during column reorder + row sort.
 *
 * @remarks
 * Uses the Web Animations API with `composite: 'add'` so the FLIP delta
 * stacks ON TOP of whatever inline `transform` the virtualizer already set
 * on row elements — without `'add'` our keyframe would clobber the
 * virtualizer's `translate(...)` and rows would jump to the origin before
 * settling.
 *
 * Respects `prefers-reduced-motion: reduce` and bails out entirely when the
 * user has opted out of motion.
 */

const FLIP_DURATION_MS = 220;
const FLIP_EASING = 'cubic-bezier(0.2, 0, 0.2, 1)';
const MIN_DELTA_PX = 0.5;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * One element to FLIP, captured at its "first" (pre-mutation) position.
 */
export interface FlipEntry {
  element: HTMLElement;
  rect: DOMRect;
}

/**
 * Plays the FLIP animation for every captured element by computing the
 * delta against its current (post-mutation) bounding rect and animating it
 * back to identity.
 *
 * @param entries - Elements captured by {@link captureRect}.
 * @param axis - `'x'` for horizontal motion (column reorder), `'y'` for
 * vertical motion (row sort), `'both'` for diagonal motion if either axis
 * could move.
 */
export function playFlip(entries: ReadonlyArray<FlipEntry>, axis: 'x' | 'y' | 'both' = 'both') {
  if (prefersReducedMotion() || entries.length === 0) return;

  for (const { element, rect: oldRect } of entries) {
    if (!element.isConnected) continue;
    const newRect = element.getBoundingClientRect();
    const dx = axis === 'y' ? 0 : oldRect.left - newRect.left;
    const dy = axis === 'x' ? 0 : oldRect.top - newRect.top;
    if (Math.abs(dx) < MIN_DELTA_PX && Math.abs(dy) < MIN_DELTA_PX) continue;

    // `composite: 'add'` stacks our delta on top of any inline transform
    // (e.g. the virtualizer's `translate(0, Ypx)` on row elements).
    element.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      {
        duration: FLIP_DURATION_MS,
        easing: FLIP_EASING,
        composite: 'add',
      }
    );
  }
}

/**
 * Convenience: capture a rect for an element, returning a {@link FlipEntry}.
 */
export function captureRect(element: HTMLElement): FlipEntry {
  return { element, rect: element.getBoundingClientRect() };
}

/**
 * A subset of `LitElement` needed for {@link awaitChildUpdates}.
 */
interface UpdatableElement {
  updateComplete: Promise<unknown>;
}

/**
 * Awaits a set of child elements' `updateComplete` promises.
 *
 * @remarks
 * The grid's `updateComplete` only resolves the grid's own update — child
 * components (header row, body rows, cells) schedule their updates one
 * microtask later. FLIP needs every relevant child to have its new DOM
 * committed before computing the "Last" rect; without this wait the
 * captured-before and measured-after rects match and the animation
 * silently no-ops.
 */
export async function awaitChildUpdates(
  elements: ReadonlyArray<UpdatableElement | null | undefined>
) {
  await Promise.all(
    elements.filter((el): el is UpdatableElement => el != null).map((el) => el.updateComplete)
  );
}

/**
 * Keyed FLIP entry — pairs an arbitrary identity key with a captured rect.
 *
 * @remarks
 * Used for row sort animation: the virtualizer recycles `<apex-grid-row>`
 * DOM elements so the same element holds different row data before and
 * after a sort. We capture rects keyed by row data identity, then resolve
 * the new DOM element after the sort via the `resolveElement` callback.
 */
export interface KeyedFlipEntry<K> {
  key: K;
  rect: DOMRect;
}

/**
 * Plays a FLIP animation against elements located by key after a DOM
 * mutation has settled. Used for row sort, where DOM elements get recycled
 * across the mutation and can only be found by data identity.
 *
 * @param before - Rects captured before the mutation, keyed by data
 * identity (or any other stable key).
 * @param resolveElement - Function that returns the current DOM element
 * representing `key`, or `null` if the keyed row is no longer in view.
 * @param axis - Same semantics as {@link playFlip}.
 */
export function playKeyedFlip<K>(
  before: ReadonlyArray<KeyedFlipEntry<K>>,
  resolveElement: (key: K) => HTMLElement | null,
  axis: 'x' | 'y' | 'both' = 'both'
) {
  if (prefersReducedMotion() || before.length === 0) return;

  for (const { key, rect: oldRect } of before) {
    const element = resolveElement(key);
    if (!element?.isConnected) continue;
    const newRect = element.getBoundingClientRect();
    const dx = axis === 'y' ? 0 : oldRect.left - newRect.left;
    const dy = axis === 'x' ? 0 : oldRect.top - newRect.top;
    if (Math.abs(dx) < MIN_DELTA_PX && Math.abs(dy) < MIN_DELTA_PX) continue;

    element.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      {
        duration: FLIP_DURATION_MS,
        easing: FLIP_EASING,
        composite: 'add',
      }
    );
  }
}
