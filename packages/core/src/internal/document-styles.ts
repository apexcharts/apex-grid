import { styles as documentTokens } from '../styles/document-tokens.css.js';

/**
 * Stylesheets the grid places outside its own shadow root, adopted once per
 * document (or shadow root) as the first grid connects there.
 *
 * - The public `--ag-*` token defaults on `:where(:root)`. They make
 *   `var(--ag-*)` readable anywhere on the page while staying overridable from
 *   any ancestor. Adopted into the grid's document, which every grid inherits
 *   from however deep its shadow roots nest. Opt out with
 *   `setup({ tokenStyles: false })` (and load `apex-grid/tokens.css`, or your
 *   own values, instead).
 * - The `setup()` host sizing (`height: 100%; min-height: 240px`). A page
 *   stylesheet never reaches a grid inside a shadow root, so this one goes into
 *   the root the grid actually lives in, for that grid's own tag name.
 *
 * Both use `adoptedStyleSheets` (CSP-safe: no `<style>` element, no nonce).
 */
export const documentStyleOptions = {
  /** Adopt the `--ag-*` root defaults. Turned off by `setup({ tokenStyles: false })`. */
  tokens: true,
  /** Adopt the host sizing sheet. Turned on by `setup()` (`hostStyles`). */
  hostSizing: false,
};

type StyleRoot = Document | ShadowRoot;

const adopted = new WeakMap<StyleRoot, Set<string>>();

// Node types rather than `instanceof`, which fails for an iframe's nodes.
const isDocument = (node: Node): node is Document => node.nodeType === 9;
const isShadowRoot = (node: Node): node is ShadowRoot => node.nodeType === 11 && 'host' in node;

function supportsAdoption(root: StyleRoot): boolean {
  return (
    'adoptedStyleSheets' in root &&
    typeof CSSStyleSheet !== 'undefined' &&
    'replaceSync' in CSSStyleSheet.prototype
  );
}

/** Adopts `cssText` into `root` once per `key`. */
export function adoptOnce(root: StyleRoot, key: string, cssText: string): void {
  const keys = adopted.get(root) ?? new Set<string>();
  if (keys.has(key)) return;
  keys.add(key);
  adopted.set(root, keys);

  const doc = isDocument(root) ? root : root.ownerDocument;
  if (supportsAdoption(root)) {
    // A sheet must be constructed by the document it is adopted into (an
    // iframe's grid lives in the iframe's document, with its own constructor).
    const Sheet =
      (doc.defaultView as (Window & typeof globalThis) | null)?.CSSStyleSheet ?? CSSStyleSheet;
    const sheet = new Sheet();
    sheet.replaceSync(cssText);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  } else {
    const style = doc.createElement('style');
    style.setAttribute('data-apex-grid', key);
    style.textContent = cssText;
    (isDocument(root) ? root.head : root).appendChild(style);
  }
}

/** The `setup()` host sizing rule for one grid tag name. */
export function hostSizingCss(tagName: string): string {
  return `${tagName} { height: 100%; min-height: 240px; }`;
}

/** Called by every grid as it connects. */
export function adoptGridDocumentStyles(grid: HTMLElement): void {
  if (documentStyleOptions.tokens) {
    adoptOnce(grid.ownerDocument, 'tokens', documentTokens.cssText);
  }
  if (documentStyleOptions.hostSizing) {
    const root = grid.getRootNode();
    if (isDocument(root) || isShadowRoot(root)) {
      adoptOnce(root, `host:${grid.localName}`, hostSizingCss(grid.localName));
    }
  }
}
