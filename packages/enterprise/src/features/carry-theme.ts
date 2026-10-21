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
