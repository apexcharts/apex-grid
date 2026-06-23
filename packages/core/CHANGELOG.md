# Changelog — apex-grid

All notable changes to the `apex-grid` (community) package are documented here.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
and the format is based on [Keep a Changelog](https://keepachangelog.com/).

## [3.2.0] — 2026-06-23

Additive, backward-compatible release. The default look of `<apex-grid>` is
unchanged; the dark theme is opt-in via a new `theme` attribute.

### Added
- **Built-in dark theme.** Set `theme="dark"` on the host for a built-in slate
  dark palette — no theme to import and no `configureTheme()` call. Add `tinted`
  (`theme="tinted"` or `theme="dark tinted"`) to mix `--ag-brand` into the chrome
  surfaces so the grid wears its brand even at rest. Further `--ag-*` overrides
  still compose on top.
- **`--ag-grid-bg` token.** Host card background hook; defaults to the subtle
  light gradient and is driven by the new token-based surfaces.

### Changed
- **Multi-sort now requires Ctrl/⌘ to append a column.** With multi-sort
  enabled, a plain header click sorts by that column alone (clearing other sort
  keys); Ctrl/⌘+click appends the column as a lower-priority sort. Keyboard
  activation mirrors the modifier keys, so Ctrl/⌘+Enter is additive too.
  Previously every plain click accumulated a sort key, so a second column added
  behind a unique primary column did not change the visible order.

## [3.1.0] — 2026-06-19

Additive, backward-compatible release. The public `apex-grid` `.` / `./define`
API and the runtime behavior of `<apex-grid>` are unchanged; everything added
here is **inert for the community grid** and surfaced only on the unstable
`apex-grid/internal` subpath for the first-party `apex-grid-enterprise` package.

### Added
- **Feature-module seam.** `GridFeatureModule` contract plus a `StateController`
  module registry (`modules`, `module<C>(id)`) and a `createStateController()`
  factory override point, so a subclass can layer in extra features without
  forking core. The built-in controller set and `new StateController(host)`
  remain behavior-identical (an empty module set is a no-op).
- **Row seams** (`apex-grid/internal`): `RowTransformer.processRows()` (inject /
  reorder rows after filter → sort → tree, before pagination) and
  `RowPresenter.presentRow()` (render a row full-width, like the detail panel,
  with aria-level / expanded).
- **Cell seams** (`apex-grid/internal`): `CellDecorator.decorateCell()` (a module
  reflects `data-*` attributes onto individual cells; cells re-evaluate on a
  `decorationVersion` token bumped via `bumpDecoration()`) and
  `CellInteractionHandler.handleCellInteraction()` (the grid body forwards
  pointer down/over/up on cells to modules, gated on `modules.size` so the
  community grid pays nothing).
- Inert, variable-driven cell range / fill-handle styling in `body-cell.scss`,
  keyed off `data-range*` attributes and fully transparent until a theme sets
  the `--apex-range-*` custom properties.

### Fixed
- Row render no longer dereferences `undefined` when a row index transiently
  falls beyond the current `data` (e.g. while a server-side / infinite row model
  resizes the array on a filter or sort change); the row renders nothing for
  that frame and re-renders with the real item.

### Notes
- `apex-grid/internal` is an **unstable, first-party-only** support surface; its
  shape may change in any release. The community `.` and `./define` exports stay
  frozen.

## [3.0.1] — 2026-06-10

Documentation-only patch (no runtime or API changes).

### Documentation
- Documented the `--ag-grid-shadow` theming hook and the flat-by-default grid
  edge (1px hairline ring; opt back into the elevated card with
  `--ag-grid-shadow: var(--ag-shadow-card)`, or remove it with `none`).
- Added `@cssprop` JSDoc for the public `--ag-*` design tokens (incl.
  `--ag-grid-shadow`) and a `@csspart` entry on the grid root, so the generated
  Custom Elements Manifest / API reference list the theming surface.
- Completed the class `@fires` list — added the row- and tree-expansion events
  (`rowExpanding`, `rowExpanded`, `treeRowExpanding`, `treeRowExpanded`) and
  attached the missing `rowSelecting` event description.
- Corrected the stale "getting started" block in the `ApexGrid` JSDoc: theming
  is via `--ag-*` CSS custom properties (no `configureTheme()` / theme-CSS
  import required).
- Fixed an incorrect package name (`@apexcharts/grid-enterprise` →
  `apex-grid-enterprise`) in export JSDoc.

## [3.0.0] — 2026-06-09

### Changed
- **BREAKING: Excel (XLSX) export removed from core.** It now lives in
  [`apex-grid-enterprise`](https://www.npmjs.com/package/apex-grid-enterprise).
  Core keeps **CSV export** (`exportToCSV`). The toolbar export menu is now
  driven by a generic seam — `exportFormats` getter + `exportAs(formatId, opts)`
  — so derived grids can add formats. Migrate `grid.exportToXLSX(...)` calls by
  switching to `<apex-grid-enterprise>` (see its README).
- **Theming is now CSS-variable based.** The grid styles itself out of the box
  through `--ag-*` custom properties — no theme import or `configureTheme()`
  call is required. When `igniteui-webcomponents` is present, brand tokens
  auto-tint from its palette.
- **Neutral restyle**: grayscale chrome with brand color reserved for state and
  accents.
- **Flat grid edge by default.** The host no longer paints a heavy floating-card
  shadow; it shows a flat 1px hairline edge. Restore the prior look with
  `--ag-grid-shadow: var(--ag-shadow-card)`.

### Project
- Repository converted to an npm-workspaces monorepo; this package publishes
  from `packages/core`.

[3.2.0]: https://github.com/apexcharts/apex-grid/releases
[3.1.0]: https://github.com/apexcharts/apex-grid/releases
[3.0.1]: https://github.com/apexcharts/apex-grid/releases
[3.0.0]: https://github.com/apexcharts/apex-grid/releases
