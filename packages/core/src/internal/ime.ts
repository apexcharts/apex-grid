/**
 * IME composition guard for the grid's text-entry surfaces.
 *
 * While an input method (Japanese, Chinese, Korean) composes text, the keys
 * that confirm or cancel the conversion arrive as ordinary keydowns: Enter
 * picks a candidate and Escape backs out of it. Those keys belong to the IME,
 * so a commit / cancel / close handler on a text control must leave them
 * alone, and an `input` event fired mid-composition carries unconverted text
 * that must not be applied yet.
 *
 * Browsers mark these events differently, so {@link isComposing} checks all
 * three signals:
 * - `event.isComposing`, set on keydown and input during a composition;
 * - `keyCode === 229`, which Chrome and Edge on Windows send for keys the IME
 *   consumes, and which Safari sends for the conversion-confirming Enter that
 *   it dispatches after `compositionend`;
 * - a per-element flag kept from `compositionstart` / `compositionend`, for an
 *   event that has no `isComposing` field at all.
 *
 * A keydown or input that says `isComposing: false` is believed over the
 * flag: a browser drops a composition without `compositionend` when script
 * writes the control's value mid-conversion, and a flag left set by that
 * would swallow every Enter, Escape and keystroke until the control blurs.
 */

/** Text controls (an event's original target) with a composition in progress. */
const composing = new WeakSet<EventTarget>();

let tracking = false;

const originOf = (event: Event): EventTarget | null => event.composedPath()[0] ?? event.target;

const onStart = (event: Event) => {
  const origin = originOf(event);
  if (origin) composing.add(origin);
};

const onEnd = (event: Event) => {
  const origin = originOf(event);
  if (origin) composing.delete(origin);
};

/**
 * Starts tracking composition sessions document-wide, for the per-element
 * fallback of {@link isComposing}. Composition events are composed, so one
 * capturing listener on the document sees those of text controls inside
 * shadow roots too. Idempotent, and inert without a document (SSR).
 */
export function trackCompositions(): void {
  if (tracking || typeof document === 'undefined') return;
  tracking = true;
  document.addEventListener('compositionstart', onStart, true);
  document.addEventListener('compositionend', onEnd, true);
  // A control that loses focus mid-composition may never see its end.
  document.addEventListener('focusout', onEnd, true);
}

/**
 * Whether `event` (a keydown, an input or any event a text control fires) is
 * part of an IME composition, and so belongs to the input method rather than
 * to the grid's own key handling.
 */
export function isComposing(event: Event): boolean {
  const own = (event as Partial<KeyboardEvent | InputEvent>).isComposing;
  if (own) return true;
  if ((event as KeyboardEvent).keyCode === 229) return true;
  if (typeof own === 'boolean') return false;
  const origin = originOf(event);
  return origin !== null && composing.has(origin);
}
