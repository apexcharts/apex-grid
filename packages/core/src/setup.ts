import { ApexGrid } from './components/grid.js';
import { adoptOnce, documentStyleOptions, hostSizingCss } from './internal/document-styles.js';

type ApexGridTheme = 'bootstrap' | 'material' | 'fluent' | 'indigo';

export interface ApexGridSetupOptions {
  /**
   * @deprecated Inert, and accepted only so existing calls keep compiling.
   *
   * The grid never shipped its own per-framework themes — it styles itself
   * entirely through `--ag-*` CSS custom properties (see the README's theming
   * section), so this option never affected its appearance. It used to forward
   * to `configureTheme()` from `igniteui-webcomponents`, which made a whole
   * component library a runtime dependency of every consumer for one
   * pass-through call. The dependency is gone and so is the forwarding.
   *
   * If you were relying on that side effect to theme your own Ignite UI
   * components, call `configureTheme()` yourself. Passing this option now warns
   * once and does nothing else; it will be removed in the next major version.
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

let themeWarned = false;

function warnThemeIsInert(): void {
  if (themeWarned) return;
  themeWarned = true;
  // biome-ignore lint/suspicious/noConsole: intentional one-shot deprecation diagnostic
  console.warn(
    '[apex-grid] `setup({ theme })` is inert and will be removed. The grid styles ' +
      'itself through `--ag-*` CSS custom properties; this option only ever forwarded ' +
      "to igniteui-webcomponents' `configureTheme()`, which is no longer a dependency. " +
      'Call `configureTheme()` directly if you need it, and drop the option.'
  );
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
 * The deprecated {@link ApexGridSetupOptions.theme} option is inert.
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
  const { theme, hostStyles = true, tokenStyles = true } = options;

  // Before registering: a grid already in the page connects during register().
  documentStyleOptions.tokens = tokenStyles;
  if (hostStyles) {
    adoptHostStyles();
  }

  ApexGrid.register();

  if (theme !== undefined) warnThemeIsInert();
}
