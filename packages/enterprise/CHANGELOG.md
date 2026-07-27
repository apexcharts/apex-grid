# Changelog — apex-grid-enterprise

All notable changes to the `apex-grid-enterprise` (pro) package are documented
here. This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
and the format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.6.1] - 2026-07-27

### Changed
- **ApexCharts 6.x support.** The optional `apexcharts` peer dependency now
  accepts `^5.15.0 || ^6.0.0` (was `^5.15.0`). ApexCharts 6.x is the current
  default install from npm, so this removes the peer conflict (and the
  `--legacy-peer-deps` workaround) for apps already on the new major, letting a
  single ApexCharts copy serve both the grid's integrated charts and any charts
  the app draws itself. The integrated-charts API surface (render,
  `updateOptions`, image export, destroy) is validated against 6.x; no config
  changes are required, and 5.x remains supported.

## [0.6.0] - 2026-07-17

Built on `apex-grid` `3.4.0` (required: this release consumes new core locale
keys). Two areas headline: a much larger integrated-charts feature set, and a
rework of the AI layer that **replaces** the 0.5.0 adapter API (breaking
changes listed below).

### Added
- **Integrated charts, expanded.**
  - **View-bound charts**: `getViewChartModel()` charts the current view on
    any grid (not just grouping / pivot) and the chart panel live-redraws as
    the grid sorts, filters, or edits.
  - **Data mapping and aggregation**: a Data popover picks the category
    column, measure columns (each with a secondary-axis toggle), and the
    aggregation (`sum`, `avg`, `count`, `min`, `max`, `median`), driving a
    `ChartDefinition`; `getChartFields()` lists mappable columns and
    `buildValueAxes()` builds a dual-axis layout.
  - **Calculated fields**: formula-defined series (`=B1/A1*100` style, A1
    letters over the numeric columns) evaluated aggregate-then-compute via the
    formula engine (`computeCalculatedSeries`, `isValidChartFormula`);
    calculated fields can sit on the secondary axis.
  - **Format popover**: per-series colors, legend / data-label / gridline
    toggles, number format (applied to the value axis), axis titles, and
    analytics overlays: trend line, forecast with optional confidence band
    (`linearTrend`, `linearForecast`, `linearForecastBand`), reference line
    and shaded reference band.
  - **Multiple charts** at once (each Create Chart opens an independent
    dialog), a **Suggested** chart type, a grouped type gallery, inline
    heading rename with auto-titles, and swap-axes.
  - **Save and restore**: per-chart `toJSON()` / `restore(config)`
    (`ChartConfig`), JSON-safe for app-owned storage.
  - **Export**: PNG / SVG download and copy-image from the panel toolbar.
  - **Entry points**: a floating Create Chart affordance over a selected
    range, Alt+F1, and a context-menu item that charts the view while
    grouping / pivot is active.
- **Formula authoring, spreadsheet-style reference entry.** While editing a
  formula: click a cell to insert its reference, drag across cells to insert
  a live `A1:C3` range (with a dashed marquee), click again to re-pick the
  reference, Shift-click for absolute, and press F4 to cycle `$` markers
  (`A1`, `$A$1`, `A$1`, `$A1`). Arrow keys always move the text caret and
  never start referencing. Errors like `#VALUE!` now render visibly in typed
  columns (core fix).
- **AI, deterministic first.** `grid.runPrompt()` / `grid.previewPrompt()`
  run offline through a rule-based engine (no key, no network): compound
  commands, order-agnostic filters, first-class abstention ("I couldn't map
  that"), and a read-only analytics layer that answers data questions
  ("who earns the most", "average salary by department"). An LLM is an
  optional escalation via `grid.aiReasoner = createClaudeReasoner(...)` or
  `createLLMReasoner({ complete })`. `<apex-grid-ai>` gains a source badge
  (rule vs AI), a Preview mode, and a transcript.
- **Range selection**: holding a drag at the top / bottom edge auto-scrolls
  and keeps extending the selection.
- **Accessibility**: dialogs and menus restore focus on close, the status bar
  is a polite live region, set-filter options are label-wrapped, and the tool
  panel search is labelled (part of the core 3.4.0 a11y pass).

### Breaking (AI adapter API replaced)
The 0.5.0 adapter API is removed with no back-compat layer:
- Removed exports: `AIAdapter`, `AIRequest`, `AIResponse`,
  `createClaudeAdapter`, `ClaudeAdapterConfig`, `createMockAdapter`,
  `MockAdapterOptions`, `MockRule`.
- Removed grid property: `aiAdapter` (use `aiReasoner`; the rule engine now
  runs with no reasoner set, so `runPrompt` no longer rejects without one).
- Reshaped: `AIResult` is now `{ plan, applied, skipped, warnings, undo }`
  (`undo()` returns `void`); `RunPromptOptions` adds `maxDataRows`.
- Moved (same names, import from the package root as before): `sanitizePatch`,
  `AIMode`, `ClaudeClient`, `ClaudeMessage`, `buildAskRequest`,
  `buildControlRequest`, `extractAnswer`, `extractPatch`.
- Core locale key `ai.noAdapter` was removed; new `ai.*` keys cover the
  abstention, preview, source-badge, and history strings.

## [0.5.0] - 2026-07-02

A large additive release built on `apex-grid` `3.3.0`. Everything is opt-in and
`<apex-grid-enterprise>` stays a drop-in replacement for `<apex-grid>`.

### Added
- **Formula engine (spreadsheet formulas).** Mark a column `allowFormula` and its
  cells accept `=` formulas through an injected formula editor. A1 references are
  positional over the grid data (stable across sort, filter, and paging), with a
  dependency graph, cycle detection, and topological recalculation. Ships a
  function library and Excel-style error values (`#DIV/0!`, `#REF!`, `#VALUE!`,
  and so on). Formulas participate in `getState()` / `setState()` and are
  localized.
  - **References and authoring.** Relative and absolute (`$`) references; drag-fill
    and paste that rewrite references; function-name autocomplete; and
    click-to-insert of a clicked cell's reference.
  - **Reference highlighting.** While a formula cell is edited, each referenced
    cell is highlighted in the grid in its own color, and spreadsheet coordinates
    (a row-number gutter plus A / B / C column letters) are shown by default for
    grids with `allowFormula` columns, so entering a formula never shifts the
    layout.
  - **Show formulas** toggle (reveal the source instead of the computed value) and
    **Export formulas** to CSV.
- **AI Toolkit.** An `<apex-grid-ai>` prompt panel plus an "Ask AI" toolbar entry.
  `runPrompt(...)` runs a natural-language prompt against a pluggable adapter
  contract, with a Claude reference adapter (proxy and dev-key modes) and an
  offline mock. The grid's JSON schema is emitted for the model, and the UI is
  localized.
- **Context menu (and header column menu).** A right-click menu, also opened from
  each column header's kebab (three-dot) button, via the `contextMenu` config
  (enabled by default, `context-menu="false"` to disable, or supply custom
  `items`). Built-in actions: sort, pin, hide, copy (cells), the grouping actions
  (group by column, un-group all, expand / collapse all groups) when the grouping
  module is present, and a "Chart range" submenu that charts the current
  selection. The kebab and the right-click menu share the same items. An
  `apex-context-menu-opening` event allows per-target tweaks.
- **Integrated charts v2.** Opt-in chart modules, range charting, and an
  `<apex-grid-chart>` panel.
  - **Cross-filtering.** Set `crossFilter` on `<apex-grid-chart>` so clicking a
    chart category filters the grid to that value (click again to clear), using a
    type-independent equality operation.

### Changed
- **`apex-grid` dependency raised to `^3.3.0`.** The formula coordinates use
  core's `coordinateHints`, and the enterprise features build on the 3.3.0 core
  seams.

### Fixed
- The chart panel refits its container on resize, and chart dialog accessibility
  was polished.

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

[0.5.0]: https://github.com/apexcharts/apex-grid/releases
[0.2.1]: https://github.com/apexcharts/apex-grid/releases
[0.2.0]: https://github.com/apexcharts/apex-grid/releases
[0.1.1]: https://github.com/apexcharts/apex-grid/releases
[0.1.0]: https://github.com/apexcharts/apex-grid/releases
