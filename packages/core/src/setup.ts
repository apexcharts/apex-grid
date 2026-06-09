import { configureTheme } from 'igniteui-webcomponents';
import { ApexGrid } from './components/grid.js';

type ApexGridTheme = 'bootstrap' | 'material' | 'fluent' | 'indigo';

export interface ApexGridSetupOptions {
  /**
   * @deprecated The grid no longer ships per-framework themes — it styles
   * itself entirely through `--ag-*` CSS custom properties (see the README's
   * theming section). This option does **not** affect the grid's appearance;
   * it only forwards to igniteui-webcomponents' `configureTheme()` for apps
   * that embed the grid alongside igniteui components. When set, the grid
   * still auto-tints from the igniteui palette via its `--ig-*` fallbacks.
   * Omit it and customize via CSS variables instead. Will be removed in a
   * future major version.
   *
   * @defaultValue 'bootstrap'
   */
  theme?: ApexGridTheme;

  /**
   * Whether to adopt a default host stylesheet that sets `height: 100%`
   * with a `min-height: 240px` fallback. Set to `false` if you want to
   * provide your own host sizing.
   *
   * @defaultValue true
   */
  hostStyles?: boolean;
}

const HOST_CSS = 'apex-grid { height: 100%; min-height: 240px; }';
let hostStylesInjected = false;

function adoptHostStyles(): void {
  if (hostStylesInjected || typeof document === 'undefined') return;

  if ('adoptedStyleSheets' in Document.prototype && 'replaceSync' in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(HOST_CSS);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } else {
    const style = document.createElement('style');
    style.setAttribute('data-apex-grid', 'host-styles');
    style.textContent = HOST_CSS;
    document.head.appendChild(style);
  }

  hostStylesInjected = true;
}

/**
 * One-call convenience: registers `<apex-grid>` and adopts a default host
 * stylesheet so the virtualizer has a bounded height. The grid is styled
 * out-of-the-box via `--ag-*` CSS custom properties — no theme import needed.
 *
 * @remarks
 * This is an **additive** alternative to the manual setup
 * (`import 'apex-grid/define'` + host CSS). Idempotent — safe to call more
 * than once; host styles are adopted only on the first call.
 *
 * Customize the look by overriding `--ag-*` CSS variables (see the README).
 * The deprecated {@link ApexGridSetupOptions.theme} option only forwards to
 * igniteui-webcomponents and does not change the grid's appearance.
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
  const { theme, hostStyles = true } = options;

  ApexGrid.register();

  // Deprecated: only forwards to igniteui when a consumer explicitly opts in.
  // The grid styles itself via `--ag-*` variables regardless.
  if (theme !== undefined) {
    configureTheme(theme);
  }

  if (hostStyles) {
    adoptHostStyles();
  }
}
