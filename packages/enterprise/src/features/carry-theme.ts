import { onDesignSystemRegistered } from 'apex-grid/internal';
import type { ReactiveController, ReactiveControllerHost } from 'lit';

/**
 * Theme hand-off for the overlays the enterprise grid mounts on `document.body`
 * (the context menu, the charted-range outline, the chart dialog).
 *
 * They live on the body so the grid's scroll and overflow never clip them, but
 * that also puts them outside the grid's cascade: a theme set on the grid, on
 * an ancestor of it, or on the shadow host of a web component it renders in
 * never reaches them, so they painted fixed light colours over a dark grid.
 *
 * The grid resolves every `--ag-*` token into a private `--_ag-*` copy on its
 * host. Copying the resolved copies onto the overlay when it opens gives it the
 * grid's exact theme, wherever that theme was set. The overlay styles read
 * `var(--_ag-*, <the colour they always had>)`, so an overlay opened without a
 * grid looks as it always did.
 */

/** The tokens the overlays read. */
const CARRIED = [
  'surface',
  'surface-elevated',
  'row-hover',
  'text',
  'text-body',
  'text-muted',
  'text-subtle',
  'text-on-brand',
  'border',
  'hairline',
  'pin-line',
  'brand',
  'brand-strong',
  'brand-soft',
  'risk',
  // The font: unset unless the grid follows a design system (`apex-grid/ignite-ui`), so the
  // overlays keep their own font without it.
  'overlay-font',
] as const;

/**
 * Copy the grid's resolved theme tokens onto an overlay element.
 *
 * @param grid The grid host the overlay belongs to.
 * @param overlay The element mounted outside the grid.
 */
export function carryGridTheme(grid: unknown, overlay: HTMLElement): void {
  if (!(grid instanceof Element) || typeof getComputedStyle !== 'function') return;
  const computed = getComputedStyle(grid);
  for (const name of CARRIED) {
    const value = computed.getPropertyValue(`--_ag-${name}`).trim();
    if (value) overlay.style.setProperty(`--_ag-${name}`, value);
  }
}

/**
 * The popup tokens (`--_ag-overlay`, `-text`, `-muted`, `-line`, `-hover`,
 * `-accent`, `-font`), which the grid resolves from `--ag-overlay` and
 * `--ag-overlay-text` (dark grids: `--ag-dark-overlay*`) and, with the
 * `apex-grid/ignite-ui` add-on, from the Ignite UI theme. Unset by default, so
 * each popup keeps its own built-in colours.
 */
const OVERLAY = [
  'overlay',
  'overlay-text',
  'overlay-muted',
  'overlay-line',
  'overlay-hover',
  'overlay-accent',
  'overlay-font',
] as const;

/**
 * Copy the bound grid's popup tokens onto a companion element mounted beside
 * the grid (filter builder, set filter, AI panel, tool panel, status bar).
 * What was carried before is dropped first, so a grid whose popup tokens go
 * unset again (a theme change) gives the companion back its own colours.
 *
 * @param grid The grid the companion is bound to.
 * @param el The companion element.
 */
export function carryOverlayTheme(grid: unknown, el: HTMLElement): void {
  for (const name of OVERLAY) el.style.removeProperty(`--_ag-${name}`);
  if (!(grid instanceof Element) || typeof getComputedStyle !== 'function') return;
  const computed = getComputedStyle(grid);
  for (const name of OVERLAY) {
    const value = computed.getPropertyValue(`--_ag-${name}`).trim();
    if (value) el.style.setProperty(`--_ag-${name}`, value);
  }
}

/** The grid attributes its theme depends on. */
const GRID_ATTRIBUTES = ['theme', 'design-system', 'tokens', 'class', 'style'];

/** The ancestor attributes a page switches its theme with. */
const ANCESTOR_ATTRIBUTES = ['class', 'style', 'theme', 'data-theme'];

/**
 * Calls `onChange`, at most once a frame, when the theme `grid` resolves can have changed:
 *
 * - an attribute of the grid (`theme`, `design-system`, `tokens`, `class`, `style`);
 * - a theme attribute of an ancestor, across shadow boundaries, up to the root element;
 * - a stylesheet added, removed or edited in a shadow root above the grid or in the document's
 *   `<head>` (a theme swap), and a `<link>` loading;
 * - a design-system add-on registering (`apex-grid/ignite-ui` imported late).
 *
 * The grid follows all of these through CSS; what copies its resolved tokens (the companions
 * beside it, the chart panel) needs this to follow too. Returns the function that stops watching.
 */
export function watchGridTheme(grid: Element, onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined' || typeof requestAnimationFrame !== 'function') {
    return () => {};
  }
  let frame = 0;
  const schedule = () => {
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      onChange();
    });
  };
  const observer = new MutationObserver(schedule);
  observer.observe(grid, { attributes: true, attributeFilter: GRID_ATTRIBUTES });
  for (let node = grid.parentNode; node; ) {
    if (node instanceof ShadowRoot) {
      observer.observe(node, { childList: true });
      node = node.host;
    } else {
      if (node instanceof Element) {
        observer.observe(node, { attributes: true, attributeFilter: ANCESTOR_ATTRIBUTES });
      }
      node = node.parentNode;
    }
  }
  const doc = grid.ownerDocument;
  if (doc.head) {
    observer.observe(doc.head, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['href', 'media', 'disabled'],
    });
  }
  doc.addEventListener('load', schedule, true);
  const stopListening = onDesignSystemRegistered(schedule);
  return () => {
    observer.disconnect();
    doc.removeEventListener('load', schedule, true);
    stopListening();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };
}

/**
 * Keeps a companion's popup tokens in step with its `grid`: carried as it connects, after each
 * render, and when the grid's theme changes ({@link watchGridTheme}: a theme swap, the grid's
 * `theme` attribute, a late `apex-grid/ignite-ui` import). The host adds it with `addController`.
 */
export class OverlayTheme implements ReactiveController {
  #watched: unknown = null;
  #stop: (() => void) | null = null;

  constructor(private readonly host: ReactiveControllerHost & HTMLElement & { grid?: unknown }) {}

  public hostConnected(): void {
    this.#sync();
  }

  public hostUpdated(): void {
    this.#sync();
  }

  public hostDisconnected(): void {
    this.#unwatch();
  }

  #sync(): void {
    const grid = this.host.grid;
    if (grid !== this.#watched) {
      this.#unwatch();
      if (grid instanceof Element) {
        this.#watched = grid;
        this.#stop = watchGridTheme(grid, () => carryOverlayTheme(this.host.grid, this.host));
      }
    }
    carryOverlayTheme(grid, this.host);
  }

  #unwatch(): void {
    this.#stop?.();
    this.#stop = null;
    this.#watched = null;
  }
}
