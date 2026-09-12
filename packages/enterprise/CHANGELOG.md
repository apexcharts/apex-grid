# Changelog — apex-grid-enterprise

All notable changes to the `apex-grid-enterprise` (pro) package are documented
here. This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
and the format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.7.0] - 2026-09-12

Built on `apex-grid` 3.5.0. Everything new is opt-in and
`<apex-grid-enterprise>` stays a drop-in replacement for `<apex-grid>`. The
headline additions are pivoting v2, an advanced filter builder, a server-side
row model with real depth, and a live chart range handle.

### Added
- **Pivoting v2.** Opt-in grand total and subtotals (`pivotOptions`), spanning
  column headers built on core column groups, multi-field `pivotOn`
  (`string | string[]`), and expandable nested row groups
  (`pivotOptions.expandable`) under one auto group column with indent and
  chevrons, where each parent carries its subtree aggregate. Column width and
  pin state carry across a re-pivot. `getPivotColumnGroups()`,
  `getPivotMeta()` and `PIVOT_GROUP_KEY` are exposed, and the surface is
  localized (en, es).
- **Advanced filter builder.** A nested AND / OR visual query builder as
  `<apex-grid-filter-builder>`, backed by a pure, DOM-free model and evaluator
  that reuses the existing operand tables. `applyAdvancedFilter()`,
  `clearAdvancedFilter()` and `advancedFilterModel` evaluate client-side through
  the `dataPipelineConfiguration.filter` hook, so there is no core change;
  while a model is active it owns column filtering. Localized (en, es).
- **Server-side row model depth.** A lazy, level-at-a-time row model alongside
  the flat infinite one: the grid asks a `ServerSideDataSource` for one group
  level at a time and fetches a group's children on expand, with the server
  computing the aggregates shown on group rows. Configured through
  `serverSideRowModel` (datasource, `rowGroupCols`, `valueCols`) with
  `expandServerGroup` / `collapseServerGroup` / `refreshServerSide` /
  `isServerSideRowModel`. Server-side pivot via `pivotCols`, where the server
  returns `pivotResultFields` and the grid installs them as the value columns.
  Opt-in intra-group block pagination via `blockSize` windows a group's
  children, rendering unloaded rows as placeholders and fetching blocks as the
  virtualizer scrolls into them, with `grid.isRowLoading` covering them. Group
  rows carry `aria-level` and `aria-expanded`. Mutually exclusive with
  `infiniteRowModel` and with client-side `groupBy` / `pivotOn`, since the
  server owns shaping. Module count goes from 6 to 7.
- **In-grid chart range handle.** Charting a selection used to take a snapshot
  and forget where it came from. The source range now stays outlined in the grid
  with a bottom-right drag handle, and pulling it resizes the range and live
  redraws the linked chart. The outline is drawn on `document.body`, like the
  chart affordance and dialogs, so the grid never clips it, and it is torn down
  when the chart closes or the grid disconnects.
- **`grid.totalRow`**, a grand-total row over the whole view. Row grouping
  totals a group's leaves and pivot has its own grand total, but a flat or
  grouped grid had no way to answer "what is the sum of this column".
  Configured with the same `AggregationConfig` as everything else, positionable
  top or bottom, and it follows filtering, so a filtered grid totals what it
  shows. Group-header rows are excluded.
- **Shift+Arrow range extension.** Range selection was pointer-only. Shift with
  the arrow keys now grows and shrinks the focus corner, Shift+Home / End reach
  the row edges, and adding Ctrl/Cmd reaches the grid corners, with the anchor
  staying put. This was the highest item left on the 2026-07 accessibility
  audit's backlog.

### Changed
- **ApexCharts 7.x support.** The optional `apexcharts` peer dependency now
  accepts `^5.15.0 || ^6.0.0 || ^7.0.0` (was `^5.15.0 || ^6.0.0`). ApexCharts
  7.x is the current default install from npm, so the previous range had gone
  stale in exactly the way 0.6.1 fixed for 6.x: an app on the new major sees
  `npm ls` report the peer as invalid, and one that also depends on a package
  requiring 7.x (`apexstock` 0.5.x does) has no satisfiable resolution at all.
  The entire ApexCharts surface the integrated charts touch is four calls, the
  constructor plus `render()`, `updateOptions()`, `dataURI()` and `destroy()`,
  and the full enterprise suite (539 tests, the four chart test files included)
  passes identically against 5.16.0 and 7.1.0. No config changes are required
  and 5.x remains supported.

  The `apexcharts` **devDependency** stays on `^5.15.0` deliberately: CI tests
  the floor of the supported range, so the oldest supported major is the one
  continuously exercised.
- **`apex-grid` dependency raised to `^3.5.0`** and **`apex-commons` to
  `^0.7.0`**.
- **The licence watermark is painted by `apex-commons`' `Watermark`** instead of
  a private copy of the overlay. Same z-index and inset, plus tamper-resistant
  styling the copy did not have. The documented `license-watermark` CSS part is
  preserved, stamped onto the shared node.
- **The Ignite UI peer dependency is gone**, following core dropping it. See the
  `apex-grid` 3.5.0 entry.

### Fixed
- **A forged licence key could permanently lift the watermark.** Verification is
  asynchronous while the watermark decision is synchronous, so a well-formed
  forgery read as valid, removed the watermark, and was never re-checked once
  the signature verdict flipped. The grid now subscribes to
  `LicenseManager.onChange` and re-reconciles, so the watermark returns a
  microtask later.
- **In RTL, the range fill handle and the chart-range handle were grabbable on
  the wrong side.** Both are drawn at the cell's `inset-inline-end` corner, so
  they already mirrored to the physical left, while the grab band still tested
  the physical right.

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
