import { LitVirtualizer } from '@lit-labs/virtualizer/LitVirtualizer.js';
import { html, type PropertyValues } from 'lit';
import { property } from 'lit/decorators.js';
import { registerComponent } from '../internal/register.js';
import { GRID_BODY } from '../internal/tags.js';
import { type RowMode, virtualizedRows, virtualizeRows } from './virtualize-rows.js';

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

/** Set once the window listener is in place: one per loaded copy of the grid. */
let loopNoticeQuieted = false;

/**
 * Rows whose text wraps change height while the grid resizes or scrolls, and
 * the upstream virtualizer answers each measurement by resizing its own host
 * within the same round of resize observations (it also keeps observing the
 * rows it drops, which then report from outside the document). The browser
 * defers those observations to the next frame, where the layout settles, and
 * reports the deferral as an error on the window: Safari logs it, Chrome hands
 * it to page error listeners and error monitoring. It is benign, so the first
 * grid to connect cancels that message (and the older "loop limit exceeded"
 * wording) for the window and keeps it from the listeners added after it
 * (listeners added earlier still see it). Every other error is left alone.
 *
 * @see https://github.com/apexcharts/apex-grid/issues/32
 */
export function quietResizeObserverLoopNotice(): void {
  if (loopNoticeQuieted) return;
  loopNoticeQuieted = true;
  window.addEventListener('error', (event) => {
    if (String((event as ErrorEvent).message).includes('ResizeObserver loop')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  });
}

/** Space, in px, that sticky chrome covers on each side of the scrollport. */
export interface ScrollInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** `scrollIntoView` options plus the sticky chrome to keep the target clear of. */
export type RevealOptions = ScrollIntoViewOptions & { insets?: ScrollInsets };

/** Longest wait for the layout to settle after a scroll to an unrendered row. */
const SETTLE_TIMEOUT_MS = 250;

/** Estimated scrolls to an unrendered row before giving up on rendering it. */
const MAX_REVEAL_ATTEMPTS = 4;

/**
 * How the item branch keys its rows. `'item'` is upstream's default (the
 * record itself). `'spike'` keys by slot, `index % 128`, so a rebind reuses
 * the row elements in place: the measured reference the slot reconciler
 * replaced, kept for the benchmark.
 *
 * @internal Benchmark-only. Not public API.
 */
export type RowKeying = 'item' | 'spike';

/** Number of slots the spike key cycles through. */
const SPIKE_SLOTS = 128;

const spikeKey = (_item: unknown, index: number) => index % SPIKE_SLOTS;

/**
 * Scrolls `el` into view as if `scroller` had `insets` as its scroll-padding.
 * The padding is set only for the duration of the call. Left in place, the
 * browser would apply it to every later scroll into view, including focus
 * moving onto the sticky chrome itself (a header button, the paginator),
 * which sits inside the padding and would drag the body along.
 */
export function revealWithin(
  scroller: HTMLElement | null,
  el: Element,
  { insets, ...options }: RevealOptions
): void {
  const style = insets && scroller?.style;
  const previous = style ? style.scrollPadding : '';
  if (style) {
    const { top, right, bottom, left } = insets;
    style.scrollPadding = `${top}px ${right}px ${bottom}px ${left}px`;
  }
  el.scrollIntoView(options);
  if (style) style.scrollPadding = previous;
}

export default class ApexVirtualizer extends LitVirtualizer {
  /**
   * Row keying every body built afterwards starts with. Anything other than
   * `'spike'` leaves upstream's item key untouched.
   *
   * @internal Benchmark-only, for its spike reference mode. Not public API.
   */
  public static rowKeying: RowKeying = 'item';

  /**
   * How rows map to elements: `'item'` keys each row by its record,
   * `'slot'` re-binds row elements by position (the grid's `rowRecycling`).
   * A switch rebuilds the rendered rows once.
   *
   * @internal Set by the grid. Not public API.
   */
  @property({ attribute: false })
  public rowMode: RowMode = 'item';

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

  /** Item indexes currently rendered, as last reported by `rangeChanged`. */
  #first = -1;
  #last = -1;

  /**
   * The latest scroll asked of {@link element}. A reveal deferred until the
   * layout settles runs only while it is still the latest, so a slow settle
   * cannot pull the body back from a newer jump.
   */
  #reveal = 0;

  constructor() {
    super();
    // The upstream constructor has just assigned its default key, so the
    // switch has to be applied per instance, after it.
    if (ApexVirtualizer.rowKeying === 'spike') this.keyFunction = spikeKey;
    // Rows re-render only after every `rangeChanged` listener has run (see
    // `dispatchEvent`), so the range is current before they do.
    this.addEventListener('rangeChanged', (event) => {
      const { first, last } = event as Event & { first: number; last: number };
      this.#first = first;
      this.#last = last;
    });
  }

  /** Upstream's own render, with the body's fork of its directive. */
  public override render() {
    const { items, renderItem, keyFunction, layout, scroller, rowMode: mode } = this;
    return html`${virtualizeRows({ items, renderItem, keyFunction, layout, scroller, mode })}`;
  }

  /**
   * Holds the rows' re-render until every `rangeChanged` listener has run, so
   * a listener sees the rows of the previous range whatever its registration
   * order. The grid's `bodyRangeChanged` relies on this: it reads which index
   * the focused row showed before the range moved.
   */
  public override dispatchEvent(event: Event): boolean {
    const rows = event.type === 'rangeChanged' ? virtualizedRows(this) : undefined;
    return rows ? rows.holdRender(() => super.dispatchEvent(event)) : super.dispatchEvent(event);
  }

  /**
   * Upstream's promise, which settles only from its children ResizeObserver.
   * A render that re-binds rows in place (a sort or a move under slot keys)
   * resizes nothing, so it would never settle; when nothing has happened for
   * two frames since the last render, the rows directive settles it instead.
   * Anything else is left to upstream untouched.
   */
  public override get layoutComplete(): Promise<void> | undefined {
    const promise = super.layoutComplete;
    if (promise) virtualizedRows(this)?.armLayoutComplete(this.isUpdatePending);
    return promise;
  }

  /**
   * Resolves once the rows reflect this element's latest state: a pending
   * update, the render it leads to (new items render a few microtasks later,
   * once the layout reports the range) and every rendered row's own update.
   *
   * @internal For the row FLIP settle step. Not public API.
   */
  public async rendered(): Promise<void> {
    if (this.isUpdatePending) await this.updateComplete;
    if (!this.isConnected) return;
    await virtualizedRows(this)?.rendered();
  }

  /**
   * Resolves once the layout has settled, or after a bounded wait when no
   * layout is pending (upstream `layoutComplete` only settles on a layout).
   */
  public settled(): Promise<void> {
    const layout = this.layoutComplete;
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, SETTLE_TIMEOUT_MS));
    return layout ? Promise.race([layout.catch(() => undefined), timeout]) : timeout;
  }

  /** Whether the item at `index` is in the rendered range. */
  public isRendered(index: number): boolean {
    return index >= 0 && index >= this.#first && index <= this.#last;
  }

  /**
   * Scroll handle for item `index`, rendered or not.
   *
   * Upstream scrolls an unrendered item into view by pinning the layout to it,
   * and that pin path assumes the window is the scroller: with the grid host
   * scrolling (`scroller = false`) it overshoots every item once the host has
   * scrolled, leaving the body empty at the maximum scroll offset. An
   * unrendered item is instead reached with a real scroll of the host, to its
   * estimated offset, which the layout then follows like any user scroll.
   */
  public override element(
    index: number
  ): { scrollIntoView: (options?: RevealOptions) => void } | undefined {
    const target = index === Number.POSITIVE_INFINITY ? this.items.length - 1 : index;
    if (!super.element(target)) return undefined;
    return {
      scrollIntoView: (options: RevealOptions = {}) => {
        const reveal = ++this.#reveal;
        const row = this.#renderedChild(target);
        if (row) revealWithin(this.#scroller(), row, options);
        else this.#scrollToUnrendered(target, options, reveal);
      },
    };
  }

  #renderedChild(index: number): HTMLElement | null {
    if (!this.isRendered(index)) return null;
    for (let child = this.firstElementChild; child; child = child.nextElementSibling) {
      if ((child as Element & { index?: number }).index === index) return child as HTMLElement;
    }
    return null;
  }

  /** The nearest ancestor that scrolls this element (the grid host). */
  #scroller(): HTMLElement | null {
    let node: Node | null = this.parentNode;
    while (node) {
      if (node instanceof ShadowRoot) {
        node = node.host;
      } else {
        if (node instanceof HTMLElement && getComputedStyle(node).overflowY !== 'visible') {
          return node;
        }
        node = node.parentNode;
      }
    }
    return null;
  }

  /** The scroll that reaches an unrendered item, until it has revealed it or given up. */
  #revealing: Promise<void> = Promise.resolve();

  /**
   * Resolves once the latest scroll to an unrendered item (see
   * {@link element}) has rendered and revealed it, or given up.
   */
  public revealed(): Promise<void> {
    return this.#revealing;
  }

  #scrollToUnrendered(index: number, options: RevealOptions, reveal: number): void {
    const scroller = this.#scroller();
    if (!scroller || !this.items.length) return;
    this.#revealing = this.#chase(scroller, index, options, reveal);
  }

  /**
   * Scrolls to the estimated offset of item `index` until the item is
   * rendered, then aligns the real row. Each estimate starts from the rows
   * rendered by then, so a miss is corrected from where the last scroll
   * landed. Stops when a newer scroll has been asked for.
   */
  async #chase(
    scroller: HTMLElement,
    index: number,
    options: RevealOptions,
    reveal: number
  ): Promise<void> {
    for (let attempt = 0; attempt < MAX_REVEAL_ATTEMPTS; attempt++) {
      const top = this.#estimateScroll(scroller, index, options);
      if (top === null) return;
      scroller.scrollTo({ top, behavior: options.behavior });
      await this.settled();
      if (reveal !== this.#reveal) return;
      const row = this.#renderedChild(index);
      if (row) {
        revealWithin(scroller, row, options);
        return;
      }
    }
  }

  /**
   * The scroll offset that brings unrendered item `index` into view as
   * `options` asks, or `null` when no scroll is needed or possible.
   *
   * The upstream layout sizes this element to its estimate of the total
   * extent, so the average item size matches its own estimates for items it
   * has not measured. That average can be stale (rows that grew after they
   * were measured, an expanded detail panel), so it is applied only across
   * the gap from the nearest rendered row, whose position is real: an item
   * just past the rendered range lands where the layout will draw it, and a
   * scroll never jumps back past a correct position.
   */
  #estimateScroll(scroller: HTMLElement, index: number, options: RevealOptions): number | null {
    const size = this.offsetHeight / this.items.length;
    if (!size) return null;

    const padStart = options.insets?.top ?? 0;
    const padEnd = options.insets?.bottom ?? 0;
    const viewport = scroller.clientHeight - padStart - padEnd;
    const base = scroller.getBoundingClientRect().top + scroller.clientTop - scroller.scrollTop;
    const offsetOf = (el: Element) => el.getBoundingClientRect().top - base;

    const after = index > this.#last ? this.#renderedChild(this.#last) : null;
    const before = index < this.#first ? this.#renderedChild(this.#first) : null;
    let start: number;
    if (after) {
      start = offsetOf(after) + after.offsetHeight + (index - this.#last - 1) * size;
    } else if (before) {
      start = offsetOf(before) - (this.#first - index) * size;
    } else {
      start = offsetOf(this) + index * size;
    }
    const end = start + size;
    const current = scroller.scrollTop;

    switch (options.block ?? 'start') {
      case 'start':
        return start - padStart;
      case 'end':
        return end - padStart - viewport;
      case 'center':
        return (start + end) / 2 - padStart - viewport / 2;
      default:
        if (start < current + padStart) return start - padStart;
        if (end > current + padStart + viewport) return end - padStart - viewport;
        return null;
    }
  }

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
