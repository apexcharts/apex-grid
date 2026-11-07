/**
 * `apex-grid/ignite-ui`: the Ignite UI add-on.
 *
 * Import it once and every grid on the page follows the Ignite UI theme the
 * page loads: brand, text, lines, header and popup surfaces, state colours,
 * font, light or dark. Without it the grid reads no `--ig-*` token, and an
 * Ignite UI stylesheet changes nothing.
 *
 * ```ts
 * import 'apex-grid/ignite-ui';
 * ```
 *
 * - It works in CSS: each grid adopts the add-on's rules into its shadow root
 *   (a page stylesheet cannot reach them), so there is no separate `.css` file.
 *   A grid connected before the import takes them at once.
 * - Ranking: an `--ag-*` token you set wins, then the family `--apx-*` tokens,
 *   then Ignite UI, then the built-in values.
 * - Mode: a grid without `theme="dark"` or `theme="light"` follows the Ignite UI
 *   variant (`--ig-theme-variant`); `theme="light"` keeps a grid light.
 * - Per grid: `design-system="off"` (`designSystem = false`) turns the Ignite
 *   UI colours and font off (the variant still picks the mode); `tokens="off"`
 *   (`tokens = false`) turns off the family tokens and Ignite UI, variant
 *   included.
 * - While it is loaded, the `--ag-*` tokens that follow Ignite UI leave the root
 *   defaults (as `--ag-brand` and `--ag-font` always have), so page CSS that
 *   reads one gives its own fallback.
 * - Other Apex products take their own add-on (`apexcharts/features/ignite-ui`,
 *   `apextree/ignite-ui`, ...). The enterprise chart panel reads the theme
 *   itself only when the page also imports the ApexCharts one.
 * - It registers on a shared `globalThis` slot, so it reaches every grid even
 *   when the grid and this add-on come from separately built bundles.
 */
import { registerDesignSystem } from './internal/design-system.js';
import { IGNITE_UI_STYLES } from './internal/ignite-ui.js';

registerDesignSystem(IGNITE_UI_STYLES);
