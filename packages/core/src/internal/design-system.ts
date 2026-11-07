import { adoptOnce } from './document-styles.js';

/**
 * A design-system add-on (`apex-grid/ignite-ui`): the rules it adds to the
 * grid's document and to each grid's shadow root.
 *
 * The grid ships no design-system code of its own. An add-on registers once
 * on import; from then on every grid adopts its rules as it connects, and the
 * grids already on the page get them right away.
 */
export interface DesignSystemStyles {
  /** The design system's id, such as `'igniteui'`. */
  readonly name: string;
  /** Rules for the grid's document, adopted after the `--ag-*` root defaults. */
  readonly documentCss: string;
  /** Adds the add-on's rules to one grid's shadow root, after the grid's own. */
  attach(grid: HTMLElement, root: ShadowRoot): void;
}

/**
 * The registry, on a versioned `globalThis` slot rather than in this module:
 * a page can hold two copies of it (the grid and the add-on bundled
 * separately, a CDN's per-file builds, two apps on one page), and an add-on
 * registered into a copy no grid reads would do nothing, with no error. The
 * family add-ons share their registries the same way.
 */
interface Registry {
  /** The registered add-on; the first registration wins. */
  styles: DesignSystemStyles | null;
  /** Every connected grid, of every copy, so a late registration reaches them too. */
  readonly grids: Set<HTMLElement>;
  /** The add-on's document sheet, per document, kept after the root defaults. */
  readonly documents: WeakMap<Document, CSSStyleSheet>;
  /** Called when an add-on registers (the enterprise companions re-read the grid's theme). */
  readonly listeners: Set<() => void>;
}

const REGISTRY_KEY = '__apex_grid_design_systems_v1__';

function registry(): Registry {
  const slot = globalThis as unknown as Record<string, Registry | undefined>;
  slot[REGISTRY_KEY] ??= {
    styles: null,
    grids: new Set(),
    documents: new WeakMap(),
    listeners: new Set(),
  };
  return slot[REGISTRY_KEY];
}

/**
 * Adopts the add-on's document rules once per document, and keeps them last:
 * a second copy of the grid adopts its own root defaults when its first grid
 * connects, and the add-on's rules (which lift some of those defaults) must
 * still come after them.
 */
function attachDocument(styles: DesignSystemStyles, doc: Document): void {
  if (
    !('adoptedStyleSheets' in doc) ||
    typeof CSSStyleSheet === 'undefined' ||
    !('replaceSync' in CSSStyleSheet.prototype)
  ) {
    adoptOnce(doc, `design-system:${styles.name}`, styles.documentCss);
    return;
  }
  const { documents } = registry();
  let sheet = documents.get(doc);
  if (!sheet) {
    const Sheet =
      (doc.defaultView as (Window & typeof globalThis) | null)?.CSSStyleSheet ?? CSSStyleSheet;
    sheet = new Sheet();
    sheet.replaceSync(styles.documentCss);
    documents.set(doc, sheet);
  }
  const adopted = doc.adoptedStyleSheets;
  if (adopted[adopted.length - 1] !== sheet) {
    doc.adoptedStyleSheets = [...adopted.filter((each) => each !== sheet), sheet];
  }
}

function attach(styles: DesignSystemStyles, grid: HTMLElement): void {
  attachDocument(styles, grid.ownerDocument);
  const root = grid.shadowRoot;
  if (root) styles.attach(grid, root);
}

/**
 * Registers a design-system add-on. The first registration wins: a second
 * import of the same add-on (or of another one) changes nothing.
 */
export function registerDesignSystem(styles: DesignSystemStyles): void {
  const reg = registry();
  if (reg.styles) return;
  reg.styles = styles;
  for (const grid of reg.grids) attach(styles, grid);
  for (const listener of reg.listeners) listener();
}

/** The id of the registered design-system add-on, or null when none is loaded. */
export function designSystemName(): string | null {
  return registry().styles?.name ?? null;
}

/**
 * Calls `listener` when a design-system add-on registers (an import after the
 * grids connected). Returns the function that stops listening.
 */
export function onDesignSystemRegistered(listener: () => void): () => void {
  const { listeners } = registry();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called by every grid as it connects, after its own document styles. */
export function connectDesignSystem(grid: HTMLElement): void {
  const reg = registry();
  reg.grids.add(grid);
  if (reg.styles) attach(reg.styles, grid);
}

/** Called by every grid as it disconnects. */
export function disconnectDesignSystem(grid: HTMLElement): void {
  registry().grids.delete(grid);
}
