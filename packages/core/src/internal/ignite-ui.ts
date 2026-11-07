import { styles as shadowStyles } from '../styles/ignite-ui/ignite-ui.css.js';
import { styles as darkVariantStyles } from '../styles/ignite-ui/ignite-ui-dark.css.js';
import { styles as documentStyles } from '../styles/ignite-ui/ignite-ui-document.css.js';
import type { DesignSystemStyles } from './design-system.js';

/**
 * The Ignite UI add-on's rules (`apex-grid/ignite-ui`).
 *
 * Each grid's shadow root adopts one sheet per document: the grid's token
 * chains with the Ignite UI steps (`styles/ignite-ui/ignite-ui.scss`), then
 * the rules for a dark Ignite UI variant (`ignite-ui-dark.scss`) inside
 * `@container style(--ig-theme-variant: dark)`, so every grid follows the
 * variant in effect where it sits, and follows a theme swap live.
 *
 * A browser without container style queries on custom properties drops that
 * rule. There the sheet holds the dark rules outright while the document's
 * variant is dark, and is rewritten when it changes: the add-on re-reads the
 * variant as grids connect, when the document's `<head>` or the root's and
 * body's attributes change, and when a stylesheet loads.
 */

const VARIANT = '--ig-theme-variant';

type StyleRoot = Document | ShadowRoot;

/** Whether the browser applies `@container style()` to custom properties; null: not probed yet. */
let styleQueries: boolean | null = null;

/**
 * Overrides the style-query probe.
 *
 * @internal Test-only: `false` runs the fallback in a browser that has style
 * queries, `null` probes again.
 */
export function setStyleQuerySupport(value: boolean | null): void {
  styleQueries = value;
  for (const doc of sheets.keys()) {
    if (!supportsStyleQueries(doc)) watch(doc);
    refresh(doc);
  }
}

/**
 * Probes container style queries: a host carrying a custom property, and a
 * shadow child styled only when a style query on that property matches.
 */
function probe(doc: Document): boolean {
  const host = doc.createElement('div');
  const parent = doc.body ?? doc.documentElement;
  if (!parent || typeof host.attachShadow !== 'function') return false;
  host.style.setProperty('--_ag-probe', 'on');
  const shadow = host.attachShadow({ mode: 'open' });
  const Sheet = sheetConstructor(doc);
  const sheet = new Sheet();
  sheet.replaceSync('@container style(--_ag-probe: on) { i { --_ag-probe-hit: on; } }');
  shadow.adoptedStyleSheets = [sheet];
  const child = doc.createElement('i');
  shadow.append(child);
  parent.append(host);
  const hit = getComputedStyle(child).getPropertyValue('--_ag-probe-hit').trim() === 'on';
  host.remove();
  return hit;
}

function sheetConstructor(doc: Document): typeof CSSStyleSheet {
  return (doc.defaultView as (Window & typeof globalThis) | null)?.CSSStyleSheet ?? CSSStyleSheet;
}

function supportsStyleQueries(doc: Document): boolean {
  styleQueries ??= probe(doc);
  return styleQueries;
}

/** The document's variant, for the fallback: read where Ignite UI themes declare it. */
function documentVariant(doc: Document): string {
  const root = doc.documentElement;
  return root ? getComputedStyle(root).getPropertyValue(VARIANT).trim() : '';
}

/** The shadow-root sheet's text for one document. */
function cssFor(doc: Document): string {
  const base = shadowStyles.cssText;
  const dark = darkVariantStyles.cssText;
  if (supportsStyleQueries(doc)) return `${base}@container style(${VARIANT}: dark){${dark}}`;
  return documentVariant(doc) === 'dark' ? `${base}${dark}` : base;
}

interface SheetEntry {
  sheet: CSSStyleSheet;
  /** The text the sheet holds, so an unchanged rewrite is skipped. */
  css: string;
}

/** One constructed sheet per document: a sheet adopts only into its own document's roots. */
const sheets = new Map<Document, SheetEntry>();

function refresh(doc: Document): void {
  const entry = sheets.get(doc);
  if (!entry) return;
  const css = cssFor(doc);
  if (css === entry.css) return;
  entry.css = css;
  entry.sheet.replaceSync(css);
}

/** The documents the fallback watches. */
const watched = new WeakSet<Document>();

/** Fallback only: re-reads the variant when the document's theme can have changed. */
function watch(doc: Document): void {
  if (watched.has(doc)) return;
  watched.add(doc);
  const update = () => refresh(doc);
  const observer = new MutationObserver(update);
  if (doc.head) {
    observer.observe(doc.head, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['href', 'media', 'disabled'],
    });
  }
  for (const el of [doc.documentElement, doc.body]) {
    if (el)
      observer.observe(el, {
        attributes: true,
        attributeFilter: ['class', 'style', 'theme', 'data-theme'],
      });
  }
  // A `<link>` swap is seen before its sheet loads; read the variant again then.
  doc.addEventListener('load', update, true);
}

function sheetFor(doc: Document): CSSStyleSheet {
  let entry = sheets.get(doc);
  if (!entry) {
    const css = cssFor(doc);
    const Sheet = sheetConstructor(doc);
    entry = { sheet: new Sheet(), css };
    entry.sheet.replaceSync(css);
    sheets.set(doc, entry);
    if (!supportsStyleQueries(doc)) watch(doc);
  } else if (!supportsStyleQueries(doc)) {
    refresh(doc);
  }
  return entry.sheet;
}

function adoptInto(root: StyleRoot, sheet: CSSStyleSheet): void {
  if (!('adoptedStyleSheets' in root)) return;
  if (root.adoptedStyleSheets.includes(sheet)) return;
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
}

/** The add-on as the grid registers it. */
export const IGNITE_UI_STYLES: DesignSystemStyles = Object.freeze({
  name: 'igniteui',
  documentCss: documentStyles.cssText,
  attach(grid: HTMLElement, root: ShadowRoot): void {
    if (typeof CSSStyleSheet === 'undefined' || !('replaceSync' in CSSStyleSheet.prototype)) return;
    adoptInto(root, sheetFor(grid.ownerDocument));
  },
});
