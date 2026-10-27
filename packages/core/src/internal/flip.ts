import type { GridHost } from './types.js';

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

/** Animation id of a vertical (row) FLIP. */
export const FLIP_ID_Y = 'apex-flip-y';
/** Animation id of a horizontal (column) FLIP. */
export const FLIP_ID_X = 'apex-flip-x';
/** Animation id of a FLIP that may move on both axes. */
export const FLIP_ID_BOTH = 'apex-flip';

type FlipAxis = 'x' | 'y' | 'both';

const FLIP_IDS: Record<FlipAxis, string> = { x: FLIP_ID_X, y: FLIP_ID_Y, both: FLIP_ID_BOTH };

/**
 * FLIP animations started and not yet finished or cancelled, across every
 * grid on the page. A row re-bound to another record cancels its running
 * FLIP only while this is non-zero, so ordinary scroll re-binds pay nothing.
 */
let flipsInFlight = 0;

/** Whether any FLIP animation is running right now. */
export function hasFlipsInFlight(): boolean {
  return flipsInFlight > 0;
}

/** Cancels the running FLIP animations with `id` on `element` (not its subtree). */
export function cancelFlips(element: Element, id: string): void {
  for (const animation of element.getAnimations()) {
    if (animation.id === id) animation.cancel();
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Starts one FLIP on `element`, tagged with the axis id and counted in
 * {@link hasFlipsInFlight} until it finishes or is cancelled.
 */
function animateFlip(element: HTMLElement, dx: number, dy: number, axis: FlipAxis): void {
  // `composite: 'add'` stacks our delta on top of any inline transform
  // (e.g. the virtualizer's `translate(0, Ypx)` on row elements).
  const animation = element.animate(
    [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
    {
      id: FLIP_IDS[axis],
      duration: FLIP_DURATION_MS,
      easing: FLIP_EASING,
      composite: 'add',
    }
  );
  flipsInFlight++;
  let counted = true;
  const done = () => {
    if (!counted) return;
    counted = false;
    flipsInFlight--;
  };
  animation.addEventListener('finish', done);
  animation.addEventListener('cancel', done);
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
export function playFlip(entries: ReadonlyArray<FlipEntry>, axis: FlipAxis = 'both') {
  if (prefersReducedMotion() || entries.length === 0) return;

  for (const { element, rect: oldRect } of entries) {
    if (!element.isConnected) continue;
    const newRect = element.getBoundingClientRect();
    const dx = axis === 'y' ? 0 : oldRect.left - newRect.left;
    const dy = axis === 'x' ? 0 : oldRect.top - newRect.top;
    if (Math.abs(dx) < MIN_DELTA_PX && Math.abs(dy) < MIN_DELTA_PX) continue;
    animateFlip(element, dx, dy, axis);
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

/** What {@link settleRowsForFlip} needs of the grid; the first two are protected there. */
interface FlipSettleHost {
  pipelineSettled(): Promise<void>;
  scrollContainer?: { rendered(): Promise<void> } | null;
  rows: ReadonlyArray<UpdatableElement>;
}

/**
 * Waits until the rows can be measured for a row FLIP's "Last" rects, after
 * a sort or a row move: the pipeline run it started and the grid's render of
 * the result, then the body's rows render (new items reach the rows only once
 * the layout reports the range) and update. Rows outside the body (pinned
 * rows) are awaited too. Sort and row reorder both use this one wait.
 */
export async function settleRowsForFlip<T extends object>(host: GridHost<T>): Promise<void> {
  const grid = host as unknown as FlipSettleHost;
  await grid.pipelineSettled();
  await grid.scrollContainer?.rendered();
  await awaitChildUpdates(grid.rows);
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
 *
 * @remarks
 * A FLIP of the same axis still running on an element is cancelled before
 * its new rect is measured, so a quick second move replaces the first
 * rather than stacking on it. Motion stays continuous: the captured "First"
 * rect already includes the cancelled animation's offset.
 */
export function playKeyedFlip<K>(
  before: ReadonlyArray<KeyedFlipEntry<K>>,
  resolveElement: (key: K) => HTMLElement | null,
  axis: FlipAxis = 'both'
) {
  if (prefersReducedMotion() || before.length === 0) return;

  for (const { key, rect: oldRect } of before) {
    const element = resolveElement(key);
    if (!element?.isConnected) continue;
    if (flipsInFlight > 0) cancelFlips(element, FLIP_IDS[axis]);
    const newRect = element.getBoundingClientRect();
    const dx = axis === 'y' ? 0 : oldRect.left - newRect.left;
    const dy = axis === 'x' ? 0 : oldRect.top - newRect.top;
    if (Math.abs(dx) < MIN_DELTA_PX && Math.abs(dy) < MIN_DELTA_PX) continue;
    animateFlip(element, dx, dy, axis);
  }
}
