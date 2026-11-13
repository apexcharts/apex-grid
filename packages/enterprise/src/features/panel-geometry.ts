import { type GridLocaleKey, type GridLocaleText, localize } from 'apex-grid';
import { html, nothing, type ReactiveController, type ReactiveControllerHost } from 'lit';

/** One arrow key press moves or resizes a panel this many pixels. */
export const PANEL_STEP = 10;
/** Shift+Arrow moves or resizes a panel this many pixels. */
export const PANEL_STEP_LARGE = 50;
/** A panel is never resized below this width, from the keyboard or with the grip. */
export const PANEL_MIN_WIDTH = 240;
/** A panel is never resized below this height, from the keyboard or with the grip. */
export const PANEL_MIN_HEIGHT = 120;
/** Quiet time after the last key before the new position or size is announced. */
const ANNOUNCE_DELAY = 500;

const ARROWS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** What the floating panel lends the helper, read when needed (the grid can change). */
export interface PanelGeometryOptions {
  /** The fixed-position panel box (`[part="panel"]`), or null before it renders. */
  panelBox(): HTMLElement | null;
  /** The locale overrides to read the controls' strings from. */
  localeText(): GridLocaleText | undefined;
  /** The grid's polite announcer, or null when the panel is not bound to a grid. */
  announcer(): { announce(message: string): void } | null;
  /** Whether the panel floats (dialog mode). An inline panel drops any move or resize. */
  floating(): boolean;
}

interface PointerTrack {
  pointerId: number;
  x: number;
  y: number;
  rect: DOMRect;
}

/** The arrow key's (dx, dy) in screen pixels, or null for any other key or a modifier chord. */
function arrowDelta(event: KeyboardEvent): readonly [number, number] | null {
  const unit = ARROWS[event.key];
  if (!unit || event.altKey || event.ctrlKey || event.metaKey) return null;
  const step = event.shiftKey ? PANEL_STEP_LARGE : PANEL_STEP;
  return [unit[0] * step, unit[1] * step];
}

/** `value` within [min, max]; when the range is empty (max < min), min wins. */
const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

/** The layout viewport a fixed panel is placed in, without scrollbars. */
function viewport(): { width: number; height: number } {
  const doc = document.documentElement;
  return { width: doc.clientWidth || innerWidth, height: doc.clientHeight || innerHeight };
}

const isRtl = (el: Element): boolean => getComputedStyle(el).direction === 'rtl';

/**
 * A computed max size in px. A percentage is a share of `basis` (the viewport, which a fixed
 * panel's percentages resolve against); `none` or anything else not numeric is `basis` itself.
 */
function cssPx(value: string, basis: number): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return basis;
  return value.trim().endsWith('%') ? (n / 100) * basis : n;
}

/** The inline styles a move or a resize leaves on the panel box. */
const PLACEMENT = ['left', 'top', 'right', 'bottom', 'width', 'height'] as const;

/**
 * Switch the panel from its CSS corner anchor (`inset: auto 24px 24px auto`) to an explicit
 * left/top, so a move or a resize grows it from a fixed top-left. Returns its box.
 */
function pin(panel: HTMLElement): DOMRect {
  const rect = panel.getBoundingClientRect();
  panel.style.left = `${rect.left}px`;
  panel.style.top = `${rect.top}px`;
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
  return rect;
}

/** Place the panel's top-left at (left, top), kept wholly inside the viewport. */
function moveTo(panel: HTMLElement, rect: DOMRect, left: number, top: number): void {
  const vp = viewport();
  panel.style.left = `${clamp(left, 0, vp.width - rect.width)}px`;
  panel.style.top = `${clamp(top, 0, vp.height - rect.height)}px`;
}

/**
 * Size the panel to (width, height) from the grip's corner. The grip is in the inline-end corner:
 * bottom-right in LTR, where the top-left stays put, and bottom-left in RTL, where the right edge
 * does. The size stays within the panel's CSS max size, the {@link PANEL_MIN_WIDTH} /
 * {@link PANEL_MIN_HEIGHT} floor, and the room left to the viewport edge.
 */
function resizeTo(panel: HTMLElement, rect: DOMRect, width: number, height: number): void {
  const vp = viewport();
  const css = getComputedStyle(panel);
  const rtl = css.direction === 'rtl';
  const room = rtl ? rect.right : vp.width - rect.left;
  const w = clamp(width, PANEL_MIN_WIDTH, Math.min(cssPx(css.maxWidth, vp.width), room));
  const h = clamp(
    height,
    PANEL_MIN_HEIGHT,
    Math.min(cssPx(css.maxHeight, vp.height), vp.height - rect.top)
  );
  panel.style.width = `${w}px`;
  panel.style.height = `${h}px`;
  if (rtl) panel.style.left = `${rect.right - w}px`;
}

/**
 * Move and resize for a floating (dialog) panel, shared by the chart and Ask AI panels: a pointer
 * drag on the header, a "Move panel" control in the header that takes the arrow keys, and a
 * "Resize panel" grip in the inline-end bottom corner that takes the arrow keys and a pointer drag.
 * Arrows step {@link PANEL_STEP}px, Shift+Arrow {@link PANEL_STEP_LARGE}px; Left and Right follow
 * the screen in RTL too. The panel stays inside the viewport. After a burst of keys the new
 * position or size is announced once, through the grid's announcer, or a live region in the panel
 * when it has no grid.
 */
export class PanelGeometry implements ReactiveController {
  readonly #host: ReactiveControllerHost;
  readonly #options: PanelGeometryOptions;
  #move: PointerTrack | null = null;
  #resize: PointerTrack | null = null;
  #timer = 0;
  /** A move or a resize left inline placement on the panel box. */
  #placed = false;
  /** The last announcement when the panel has no grid, rendered into its own live region. */
  #status = '';

  constructor(host: ReactiveControllerHost, options: PanelGeometryOptions) {
    this.#host = host;
    this.#options = options;
    host.addController(this);
  }

  public hostDisconnected(): void {
    this.cancel();
  }

  /** A panel that stops floating (dialog to inline) sheds its moved position and size. */
  public hostUpdated(): void {
    if (!this.#placed || this.#options.floating()) return;
    const panel = this.#options.panelBox();
    if (!panel) return;
    for (const prop of PLACEMENT) panel.style.removeProperty(prop);
    this.#placed = false;
    this.cancel();
  }

  /** Drop a pending announcement and any drag in progress (the panel closed). */
  public cancel(): void {
    clearTimeout(this.#timer);
    this.#timer = 0;
    this.#move = null;
    this.#resize = null;
  }

  /** {@link pin} the panel, remembering that it now carries inline placement. */
  #pin(panel: HTMLElement): DOMRect {
    this.#placed = true;
    return pin(panel);
  }

  #t(key: GridLocaleKey, params?: Record<string, number>): string {
    return localize(this.#options.localeText(), key, params);
  }

  /** Begin a pointer drag on `event`'s target: capture it and remember where it started. */
  #track(event: PointerEvent): PointerTrack | null {
    const panel = this.#options.panelBox();
    // Only the primary button drags: a right-button press opens a menu, not a move.
    if (!panel || event.button !== 0) return null;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    return {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      rect: this.#pin(panel),
    };
  }

  // --- move ----------------------------------------------------------------

  /** Header `pointerdown`: start dragging the panel. */
  public onHeaderPointerDown = (event: PointerEvent): void => {
    this.#move = this.#track(event);
  };

  public onHeaderPointerMove = (event: PointerEvent): void => {
    const drag = this.#move;
    const panel = this.#options.panelBox();
    if (!drag || event.pointerId !== drag.pointerId || !panel) return;
    const { rect } = drag;
    moveTo(panel, rect, rect.left + event.clientX - drag.x, rect.top + event.clientY - drag.y);
  };

  /** `pointerup` / `pointercancel` / `lostpointercapture` on the header end the drag. */
  public onHeaderPointerUp = (event: PointerEvent): void => {
    if (this.#move?.pointerId === event.pointerId) this.#move = null;
  };

  #onMoveKeydown = (event: KeyboardEvent): void => {
    const delta = arrowDelta(event);
    const panel = this.#options.panelBox();
    if (!delta || !panel) return;
    event.preventDefault();
    const rect = this.#pin(panel);
    moveTo(panel, rect, rect.left + delta[0], rect.top + delta[1]);
    this.#announceSoon(() => {
      const now = panel.getBoundingClientRect();
      return this.#t('panel.moved', { x: Math.round(now.left), y: Math.round(now.top) });
    });
  };

  // --- resize --------------------------------------------------------------

  #onGripPointerDown = (event: PointerEvent): void => {
    this.#resize = this.#track(event);
  };

  #onGripPointerMove = (event: PointerEvent): void => {
    const drag = this.#resize;
    const panel = this.#options.panelBox();
    if (!drag || event.pointerId !== drag.pointerId || !panel) return;
    const dx = event.clientX - drag.x;
    const { rect } = drag;
    // The grip is on the left in RTL: dragging it left grows the panel.
    const width = rect.width + (isRtl(panel) ? -dx : dx);
    resizeTo(panel, rect, width, rect.height + event.clientY - drag.y);
  };

  #onGripPointerUp = (event: PointerEvent): void => {
    if (this.#resize?.pointerId === event.pointerId) this.#resize = null;
  };

  #onResizeKeydown = (event: KeyboardEvent): void => {
    const delta = arrowDelta(event);
    const panel = this.#options.panelBox();
    if (!delta || !panel) return;
    event.preventDefault();
    const rect = this.#pin(panel);
    // Left and Right move the grip on screen, so on the RTL (left-hand) grip Left grows the panel.
    const dw = isRtl(panel) ? -delta[0] : delta[0];
    resizeTo(panel, rect, rect.width + dw, rect.height + delta[1]);
    this.#announceSoon(() => {
      const now = panel.getBoundingClientRect();
      return this.#t('panel.resized', {
        width: Math.round(now.width),
        height: Math.round(now.height),
      });
    });
  };

  // --- announce ------------------------------------------------------------

  /** Announce once the keys stop, reading the position or size only then. */
  #announceSoon(message: () => string): void {
    clearTimeout(this.#timer);
    this.#timer = window.setTimeout(() => {
      this.#timer = 0;
      // A panel closed (hidden) or removed since the last key has nothing left to report.
      const panel = this.#options.panelBox();
      if (!panel?.isConnected || panel.getClientRects().length === 0) return;
      const text = message();
      const announcer = this.#options.announcer();
      if (announcer) {
        announcer.announce(text);
      } else {
        this.#status = text;
        this.#host.requestUpdate();
      }
    }, ANNOUNCE_DELAY);
  }

  // --- render --------------------------------------------------------------

  /** The header's "Move panel" control. Its pointer drag is the header's, which it sits in. */
  public renderMoveHandle() {
    return html`<button
      part="move-handle"
      type="button"
      aria-label=${this.#t('panel.move')}
      aria-description=${this.#t('panel.moveHint')}
      @keydown=${this.#onMoveKeydown}
    >
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" fill="currentColor">
        <circle cx="4" cy="2" r="1.2" /><circle cx="8" cy="2" r="1.2" />
        <circle cx="4" cy="6" r="1.2" /><circle cx="8" cy="6" r="1.2" />
        <circle cx="4" cy="10" r="1.2" /><circle cx="8" cy="10" r="1.2" />
      </svg>
    </button>`;
  }

  /**
   * The "Resize panel" grip for the inline-end bottom corner, plus the live region that speaks
   * for a panel with no grid.
   */
  public renderResizeHandle() {
    return html`<button
        part="resize-handle"
        type="button"
        aria-label=${this.#t('panel.resize')}
        aria-description=${this.#t('panel.resizeHint')}
        @keydown=${this.#onResizeKeydown}
        @pointerdown=${this.#onGripPointerDown}
        @pointermove=${this.#onGripPointerMove}
        @pointerup=${this.#onGripPointerUp}
        @pointercancel=${this.#onGripPointerUp}
        @lostpointercapture=${this.#onGripPointerUp}
      >
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <path d="M9 3 3 9M9 6 6 9" stroke="currentColor" stroke-width="1.2" fill="none" />
        </svg>
      </button>
      ${
        this.#options.announcer()
          ? nothing
          : html`<span
              data-panel-announcer
              aria-live="polite"
              style="position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap"
              >${this.#status}</span
            >`
      }`;
  }
}
