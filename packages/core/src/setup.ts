import { ApexGrid } from './components/grid.js';
import { adoptOnce, documentStyleOptions, hostSizingCss } from './internal/document-styles.js';

export interface ApexGridSetupOptions {
  /**
   * Whether to adopt a default host stylesheet that sets `height: 100%`
   * with a `min-height: 240px` fallback. Set to `false` if you want to
   * provide your own host sizing.
   *
   * @defaultValue true
   */
  hostStyles?: boolean;

  /**
   * Whether the grid adopts its `--ag-*` token defaults into the document, on
   * `:where(:root)` (zero specificity, so any value you set wins). They are what
   * make `var(--ag-*)` readable from your own CSS. Set to `false` if you manage
   * your own CSS, and load `apex-grid/tokens.css` (or your own values) instead.
   * The grid renders the same either way: it carries the same defaults as
   * fallbacks.
   *
   * @defaultValue true
   */
  tokenStyles?: boolean;
}

function adoptHostStyles(): void {
  if (typeof document === 'undefined') return;
  // Every grid adopts the sizing into the root it connects in (a page sheet
  // never reaches a grid inside a shadow root); the page gets it right away so
  // a grid already parsed into the document is sized before it connects.
  documentStyleOptions.hostSizing = true;
  adoptOnce(document, `host:${ApexGrid.tagName}`, hostSizingCss(ApexGrid.tagName));
}

/**
 * One-call convenience: registers `<apex-grid>` and adopts a default host
 * stylesheet so the virtualizer has a bounded height. The grid is styled
 * out of the box through `--ag-*` CSS custom properties, with no theme import.
 *
 * @remarks
 * This is an **additive** alternative to the manual setup
 * (`import 'apex-grid/define'` + host CSS). Idempotent: safe to call more
 * than once; host styles are adopted only on the first call.
 *
 * Customize the look by overriding `--ag-*` CSS variables (see the README).
 *
 * @example
 * ```ts
 * import { setup } from 'apex-grid';
 * setup();
 * ```
 *
 * @example Opt out of injected host styles:
 * ```ts
 * setup({ hostStyles: false });
 * ```
 */
export function setup(options: ApexGridSetupOptions = {}): void {
  const { hostStyles = true, tokenStyles = true } = options;

  // Before registering: a grid already in the page connects during register().
  documentStyleOptions.tokens = tokenStyles;
  if (hostStyles) {
    adoptHostStyles();
  }

  ApexGrid.register();
}
