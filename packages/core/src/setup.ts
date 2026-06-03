import { configureTheme } from 'igniteui-webcomponents';
import { ApexGrid } from './components/grid.js';

type ApexGridTheme = 'bootstrap' | 'material' | 'fluent' | 'indigo';

export interface ApexGridSetupOptions {
  /**
   * Ignite UI theme to activate. The matching theme CSS file
   * (`igniteui-webcomponents/themes/<variant>/<theme>.css`) must still be
   * imported by the consumer — there is no portable way to dynamically
   * import a CSS file across bundlers.
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
 * One-call convenience: registers `<apex-grid>`, configures the Ignite UI
 * theme, and adopts a default host stylesheet so the virtualizer has a
 * bounded height.
 *
 * @remarks
 * This is an **additive** alternative to the manual three-import setup
 * (`apex-grid/define` + `configureTheme()` + host CSS). It does NOT
 * import the Ignite theme CSS file for you — that import is consumer
 * responsibility because dynamic CSS imports are not portable across
 * bundlers. So the full setup with `setup()` is:
 *
 * ```ts
 * import { setup } from 'apex-grid';
 * import 'igniteui-webcomponents/themes/light/bootstrap.css';
 *
 * setup({ theme: 'bootstrap' });
 * ```
 *
 * Idempotent — safe to call more than once. Host styles are adopted
 * only on the first call. For full manual control use
 * `import 'apex-grid/define'` and configure the theme yourself; this
 * helper is a shortcut, not a replacement.
 *
 * @example
 * ```ts
 * import { setup } from 'apex-grid';
 * import 'igniteui-webcomponents/themes/light/bootstrap.css';
 * setup({ theme: 'bootstrap' });
 * ```
 *
 * @example Opt out of injected host styles:
 * ```ts
 * setup({ theme: 'material', hostStyles: false });
 * ```
 */
export function setup(options: ApexGridSetupOptions = {}): void {
  const { theme = 'bootstrap', hostStyles = true } = options;

  ApexGrid.register();
  configureTheme(theme);

  if (hostStyles) {
    adoptHostStyles();
  }
}
