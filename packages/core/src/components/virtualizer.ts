import { LitVirtualizer } from '@lit-labs/virtualizer/LitVirtualizer.js';
import type { PropertyValues } from 'lit';
import { registerComponent } from '../internal/register.js';
import { GRID_BODY } from '../internal/tags.js';

/**
 * Attribute the upstream virtualizer stamps on the spacer element it appends in
 * scroller mode. It is not a rendered row, so it is skipped when asking whether
 * the body rendered anything.
 */
const SIZER_ATTRIBUTE = 'virtualizer-sizer';

/**
 * Re-measure attempts allowed per geometry change. A grid that still renders
 * nothing after this many tries has a cause we cannot fix by re-measuring, so
 * we stop rather than spin.
 */
const MAX_RECOVERY_ATTEMPTS = 3;

export default class ApexVirtualizer extends LitVirtualizer {
  /**
   * Watches the host's intersection with the window, which is the one input to
   * the upstream viewport measurement that has no invalidation signal of its
   * own. See the note on `#observeViewport`.
   */
  #viewportObserver: IntersectionObserver | null = null;

  /**
   * Height of the host's last observed intersection with the window: the
   * viewport height the layout should be working from. Zero means an empty
   * range is the *correct* render and there is nothing to recover.
   */
  #visibleHeight = 0;

  #pendingCheck = 0;

  #recoveryAttempts = 0;

  public static get tagName() {
    return GRID_BODY;
  }

  public static register(): void {
    registerComponent(ApexVirtualizer);
  }

  // The virtualizer used to own vertical scrolling, which made it a scroll container
  // and broke `position: sticky` for body cells in pinned columns (cells would anchor
  // to the virtualizer instead of the horizontally-scrolling grid host). With
  // `scroller = false` the grid host owns both axes, so headers and pinned body cells
  // share a single sticky containing block.
  public override scroller = false;

  public override connectedCallback() {
    // Nothing may be awaited before this call. The upstream virtualizer is only
    // created (and reconnected) from the element's own Lit update cycle, which
    // `super.connectedCallback()` is what starts. Deferring it past an await on
    // any virtualizer state deadlocks on a reconnect: the promise waits for a
    // layout that waits for the update that this call would have scheduled.
    super.connectedCallback();
    this.setAttribute('tabindex', '0');
    this.#observeViewport();
  }

  public override disconnectedCallback() {
    this.#viewportObserver?.disconnect();
    this.#viewportObserver = null;
    // Geometry is meaningless while detached; the observer re-reports on connect.
    this.#visibleHeight = 0;
    if (this.#pendingCheck) {
      cancelAnimationFrame(this.#pendingCheck);
      this.#pendingCheck = 0;
    }
    super.disconnectedCallback();
  }

  protected override updated(changed: PropertyValues) {
    super.updated(changed);
    this.#scheduleViewportCheck();
  }

  /**
   * The upstream virtualizer derives its viewport from the intersection of the
   * host, its clipping ancestors and the window, and clears the rendered range
   * outright when that intersection is zero-height, while still sizing the
   * scroll extent from the full item count. A grid that is laid out while it
   * sits outside the window (an iframe not yet sized by its host page, a panel
   * still settling, content above it that has not finished loading) therefore
   * ends up reporting a correct row count and scroll extent with no rows in it.
   *
   * That state is not self-correcting, because the only invalidation signals
   * upstream listens for are `ResizeObserver` size changes and scroll events:
   * an element that *moves* into view, or a window that resizes around a
   * fixed-size host, fires neither. The grid then stays empty until something
   * unrelated forces a re-render, which is why the failure reads as a race and
   * heals on the first interaction.
   *
   * `IntersectionObserver` fires on exactly the missing signal, so it is what
   * arms the recovery check.
   *
   * @see https://github.com/apexcharts/apex-grid/issues/31
   */
  #observeViewport(): void {
    if (this.#viewportObserver || typeof IntersectionObserver === 'undefined') return;
    this.#viewportObserver = new IntersectionObserver((entries) => {
      this.#visibleHeight = entries.at(-1)?.intersectionRect.height ?? 0;
      // Fresh geometry, so the attempt budget starts over.
      this.#recoveryAttempts = 0;
      this.#scheduleViewportCheck();
    });
    this.#viewportObserver.observe(this);
  }

  #scheduleViewportCheck(): void {
    // Healthy path: one element lookup and out, no frame scheduled.
    if (this.#pendingCheck || !this.isConnected) return;
    if (!this.items?.length || this.#hasRenderedRows()) return;
    // Two frames, matching what the virtualizer itself waits before calling a
    // layout settled. Checking sooner would flag a first paint still in flight.
    this.#pendingCheck = requestAnimationFrame(() => {
      this.#pendingCheck = requestAnimationFrame(() => {
        this.#pendingCheck = 0;
        this.#recoverIfStale();
      });
    });
  }

  #recoverIfStale(): void {
    if (!this.isConnected) return;

    const items = this.items;
    if (!Array.isArray(items) || items.length === 0) return;

    if (this.#hasRenderedRows()) {
      this.#recoveryAttempts = 0;
      return;
    }

    // No visible slice means rendering nothing is correct: the grid is scrolled
    // out of view, inside a collapsed panel, or hidden. Leave it alone.
    if (this.#visibleHeight <= 0) return;
    if (this.#recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) return;

    this.#recoveryAttempts++;
    // Re-assigning `items` with a new array identity is the public lever that
    // makes the virtualizer re-run its layout, and so re-measure the viewport.
    // Unlike a synthetic scroll event it cannot disturb a pending
    // `scrollIntoView`, which the layout holds as a pin until a real scroll.
    this.items = items.slice();
  }

  #hasRenderedRows(): boolean {
    for (let child = this.firstElementChild; child; child = child.nextElementSibling) {
      if (!child.hasAttribute(SIZER_ATTRIBUTE)) return true;
    }
    return false;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [ApexVirtualizer.tagName]: ApexVirtualizer;
  }
}
