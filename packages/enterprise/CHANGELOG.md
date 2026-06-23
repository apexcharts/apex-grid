# Changelog — apex-grid-enterprise

All notable changes to the `apex-grid-enterprise` (pro) package are documented
here. This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
and the format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.2.1] — 2026-06-23

Documentation-only patch (no runtime, API, or dependency changes).

### Documentation
- Expanded the package README with full feature coverage (row grouping,
  pivoting, integrated charts, tool panel, range selection / status bar,
  spreadsheet editing, set filter, master / detail, infinite row model).

## [0.2.0] — 2026-06-19

First feature release on top of the new `apex-grid` `3.1.0` module seams.
Everything is additive — `<apex-grid-enterprise>` stays a drop-in replacement
for `<apex-grid>`.

### Added
- **Row grouping** — `groupBy` with nested, expandable group headers and
  per-group aggregates computed over the filtered leaves.
- **Pivoting** — `pivotOn` / `pivotRows` / `pivotValues`; distinct
  column-dimension values expand into dynamic columns of computed aggregates.
  (Grouping and pivoting are mutually exclusive.)
- **Integrated charts** — `getChartModel()` / `renderChart()` chart the group /
  pivot aggregates with **ApexCharts** (dynamically imported) into a
  caller-supplied container.
- **Columns tool panel** — `<apex-grid-tool-panel>` sibling element: per-column
  show/hide, pin cycle, reorder, and search, plus drag-and-drop **Row Groups /
  Values / Column Labels** zones and a grouping ⇄ pivot mode toggle.
- **Cell range selection** — click-drag / shift-click range with a perimeter
  box; Ctrl/⌘-click adds disjoint ranges; exposes bounds, TSV, and
  count / sum / avg / min / max stats; fires `apex-range-changed`. Toggle via
  the `range-selection` attribute.
- **Status bar** — `<apex-grid-status-bar>` sibling element showing live
  selection aggregates.
- **Spreadsheet editing** — clipboard copy (Ctrl/⌘+C) and paste (Ctrl/⌘+V,
  `pasteText`, coerced to the column type), plus a drag **fill handle**
  (`fillTo` — numeric ranges extrapolate a linear series, otherwise tile).
- **Set filter** — `<apex-grid-set-filter>`: Excel-style distinct-value
  checklist with search and (Select all); composes with other filters through
  the grid's public `filter()` / `clearFilter()`.
- **Master / detail** — declarative embedded detail grids via the `masterDetail`
  config (`columns` + `getDetailData(row)`, sync or async); `refreshDetail(row)`.
- **Infinite (server-side) row model** — `infiniteRowModel = { datasource,
  blockSize }` lazily fetches fixed-size blocks from
  `datasource.getRows({ startRow, endRow, sortModel, filterModel, quickFilter })`
  as the user scrolls and pushes sort / filter / quick-filter to the server.
  `isRowLoading(row)`, `refreshRows()`; fires `apex-rows-loaded`.

### Changed
- **`apex-grid` dependency raised to `^3.1.0`** — these features build on the
  row / cell module seams added in that release.

## [0.1.1] — 2026-06-10

Documentation-only patch (no runtime or API changes).

### Documentation
- README: added a licensing example (`ApexGridEnterprise.setLicense(key)`) and a
  column-aggregations example (`aggregations` property + `getAggregations()`
  result shape); removed the dangling "licensing docs" reference.
- JSDoc: added `@element apex-grid-enterprise`, documented the
  `license-watermark` CSS part, and noted that all `apex-grid` events are
  inherited.

## [0.1.0] — 2026-06-09

Initial release. Pro-licensed grid that extends the community
[`apex-grid`](https://www.npmjs.com/package/apex-grid) and registers as
`<apex-grid-enterprise>` — a drop-in replacement for `<apex-grid>`.

### Added
- **Licensing** (offline, non-hostile): `ApexGridEnterprise.setLicense(key)`.
  Without a valid key the grid keeps working but renders a watermark and logs a
  console notice. Re-exports `LicenseManager` from `apex-commons`.
- **Column aggregations** — sum / avg / min / max / count per column via the
  `aggregations` property and `getAggregations()`.
- **Excel (XLSX) export** — `exportToXLSX({ filename, sheetName, source, columns })`
  plus an "Export XLSX" entry in the toolbar export menu. Numbers, booleans, and
  `Date` values keep their native Excel cell types. (Moved here from the
  community package in apex-grid v3; CSV export stays free in core.)

### Dependencies
- `apex-grid` `^3.0.0`, `apex-commons` `^0.1.0`. Peer deps: `lit`, `@lit/context`,
  `igniteui-webcomponents` (shared single copy with core).

[0.2.1]: https://github.com/apexcharts/apex-grid/releases
[0.2.0]: https://github.com/apexcharts/apex-grid/releases
[0.1.1]: https://github.com/apexcharts/apex-grid/releases
[0.1.0]: https://github.com/apexcharts/apex-grid/releases
