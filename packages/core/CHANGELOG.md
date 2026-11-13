# Changelog — apex-grid

All notable changes to the `apex-grid` (community) package are documented here.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
and the format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Sparkline columns have an accessible name: the graphic is `role="img"` and
  reads like "5 values, 12 to 23, up 92%", also with `showDelta: false`. New
  locale keys `cell.sparkline`, `cell.sparklineUp`, `cell.sparklineDown` and
  `cell.sparklineFlat` (translated in `esLocale`), and a `sparkline.label`
  column option (a string, or a function of the value and record) that
  replaces the name per column; the type `ColumnSparklineConfiguration` is
  exported. Overrides of `cell.sparkline` and `cell.chart` can use `{min}`
  and `{max}`. (#40)
- Locale keys `panel.move`, `panel.moveHint`, `panel.moved`, `panel.resize`,
  `panel.resizeHint` and `panel.resized` (translated in `esLocale`) for the
  enterprise floating panels' keyboard move and resize controls.

### Changed
- The visible sparkline delta label is `aria-hidden`, since its change is
  part of the graphic's name.
- A row that row recycling moves on a scroll step renders its new record
  synchronously, before it moves, instead of a microtask after; Lit elements
  in that row update inside the scroll render. A Lit element that overrides
  `scheduleUpdate` keeps its own schedule. Moved scroll strides measured 3 to
  6 percent slower in the recycling bench; frame times, jumps, sorts and
  filters are unchanged.

### Fixed
- With row recycling, a row moved by a scroll step now shows its new record
  before its elements reconnect, so a custom element in a cell template that
  reads its data in `connectedCallback` (a chart, a map, any widget built on
  connect) builds for the right row. Before, almost every reconnect saw the
  record of the row it was leaving. An edit kept open on a record scrolled
  away and back keeps its editor focus. The README's Row recycling section
  explains how to write a cell element that survives moves. (#39)




## [5.0.0] - 2026-11-13

A major release that removes what 4.2.0 deprecated, plus one setup option
that was due to go in the next major. Nothing else changes: an app that uses
none of the names below upgrades without edits.

### Upgrading from 4.x
- Toolbar `placeholder` or `debounce`, paginator `pageSizeLabel`: delete them.
  Set the `toolbar.searchPlaceholder` and `pagination.rowsPerPage` keys of the
  grid's `localeText` instead. The quick filter always waits 200 ms.
- A typed `localeText` object that sets `filter.filter`, `chart.placeholder`,
  `ai.answer` or a `formula.error.*` key: delete the key. None of them ever
  changed any text.
- `setup({ theme })`: delete the option. It did nothing but warn.
- Code that reads `grid.dataPipelineConfiguration` without a guard: use
  optional chaining. The type now says what the runtime always did.

### Removed
- `ApexGridToolbar`'s `placeholder` and `debounce` properties and attributes,
  and `ApexGridPaginator`'s `pageSizeLabel` property (attribute
  `page-size-label`). The grid never set them on the toolbar and paginator it
  renders.
- The locale keys `filter.filter`, `chart.placeholder`, `ai.answer`,
  `formula.error.ref`, `formula.error.name`, `formula.error.div0`,
  `formula.error.value` and `formula.error.cycle`, from `EN_LOCALE`,
  `esLocale` and `GridLocaleKey`. Nothing rendered them.
- `ApexGridSetupOptions.theme`. It has done nothing since the Ignite UI
  dependency was dropped apart from a console warning; a leftover `theme` in
  JavaScript is now ignored silently.

### Changed
- `ApexGrid.dataPipelineConfiguration` is typed as optional, matching its
  runtime default of `undefined`. Hooks are called with the same receiver as
  before.

## [4.2.0] - 2026-11-13

A minor release from the code-quality pass. The grid chrome keeps its
designed size on pages whose root font size is not 16px, the toolbar export
menu takes a filename, and a few unused properties and locale keys are
deprecated ahead of 5.0. Nothing changes at the usual 16px root.

### Added
- `apex-grid/custom-elements.json` and `apex-grid/package.json` are exported,
  so tools that read the Custom Elements Manifest (Storybook, for one) can
  import it directly. Existing import paths are unchanged.
- `exportFilename` (attribute `export-filename`, default `data`) names the file
  the toolbar export menu downloads, for CSV and, in the enterprise grid, XLSX.
  It applies to the menu only: `exportToCSV()` or `exportToXLSX()` called
  without a filename still downloads `data.*`, and a filename passed to a call
  names that call's file.
- `BadgeVariant`, `StatusVariant`, `ColumnDateFormat`, `ColumnSelectOption`
  and `ToolbarAction` can be imported as types from `apex-grid`.
- Locale keys `panel.backToGrid` and `panel.shortcutHint` (with Spanish
  translations in `esLocale`) for the enterprise floating panels.
- The README explains the DOM and scroll cost of grids with hundreds of
  columns.
- Locale keys `chart.title`, `chart.series.trend`, `chart.series.forecast`,
  `chart.series.forecastUpper`, `chart.series.forecastLower` and
  `formula.parse.*` (one per formula parse error, plus
  `formula.parse.position`), with Spanish translations in `esLocale`. The
  English defaults are the text shown before.

### Changed
- `esLocale` addresses the user in one register (usted) and calls the grid
  "tabla" everywhere; seven chart and AI hints change wording in Spanish.

### Deprecated
- The toolbar's `placeholder` and `debounce` and the paginator's
  `pageSizeLabel` properties, which the grid never sets. Use the
  `toolbar.searchPlaceholder` and `pagination.rowsPerPage` locale keys
  instead. They keep working and will be removed in 5.0.
- The unused locale keys `filter.filter`, `chart.placeholder`, `ai.answer`
  and `formula.error.ref`, `.name`, `.div0`, `.value` and `.cycle`. They
  still type check in `localeText` objects and will be removed in 5.0.
  `GridLocaleText` is now mapped over `EN_LOCALE` (it accepts the same
  objects as before), so editors mark these keys as deprecated in
  completions.

### Fixed
- The grid's chrome (toolbar, paginator, header actions, filter row, column
  menu, expand and tree toggles) is now sized in px, like its text, tokens
  and row heights. Before, it followed the page's root font size, so on a page
  with `html { font-size: 62.5% }` the 24px target sizes shrank to 15px and
  the search field to 19px around 13px text, and a larger root grew them. At
  the usual 16px root nothing changes; on any other root the chrome now keeps
  its designed size. The most common other root comes from a reader who
  raised the browser's default font size (or zooms text only): the chrome no
  longer grows with that setting, which cells and text already did not.
- The `pageChanging` docs said returning a falsy value from a listener
  cancels the change; only `event.preventDefault()` does. The
  `dataPipelineConfiguration` docs now say it is undefined until assigned.

## [4.1.0] - 2026-11-12

A new column type that draws an ApexCharts chart in every cell. Nothing
changes for grids that do not use it, and `apexcharts` is not added as a
dependency.

### Added
- `type: 'chart'`: an ApexCharts chart in every cell of a column, configured
  with the new `chart` column option (`type`, `height`, `width`, `options`,
  `label`). For an axis chart (`line`, `area`, `bar` and the rest) a
  `number[]` value is one series, with `null` entries drawn as gaps, and an
  array of `{ data }` objects is passed through as the series. A `pie`,
  `donut`, `radialBar` or `polarArea` chart takes a `number[]`, one value per
  slice or ring. The type can be set on the column or in `chart.options`,
  which takes precedence, per row too. `chart.options` merges over the
  defaults (sparkline mode, no animation, no tooltip, no toolbar, the
  grid's brand colour on axis charts and the ApexCharts palette on slices
  and rings) and takes a value typed
  `ApexOptions`; a function gives options per row.
- `setApexCharts(ApexCharts)`, exported from `apex-grid`, gives chart columns
  the constructor to draw with. Without it they use a global
  `window.ApexCharts` from a script tag, including an `async` or `defer` one
  that runs after the grid renders: the cells build on the page's `load`
  event. With neither, the cells stay empty and the grid warns once. Chart
  columns need ApexCharts 8.4.1 or later, the release that renders inside a
  shadow root. ApexCharts is not a peer dependency, so an app on an older
  release installs as before.
- Locale keys for a chart cell's accessible name: `cell.chart`
  (`'{count} values, {first} to {last}'`), `cell.chartOne`,
  `cell.chartPoints`, `cell.chartPointsOne`, `cell.chartSeries` and
  `cell.chartSeriesUnnamed`, with Spanish strings in `esLocale`. The numbers
  follow the column's `locale`.
- Exports for typed code: `ChartColumnOptions`, `ColumnChartConfiguration`,
  the `ApexGridCellChart` element and its `ChartCellState`, and the
  `ApexChartsConstructor` and `ApexChartsInstanceLike` shapes.
- `npm run bench:chart` in `packages/core`, the benchmark behind the figures
  below.

A chart cell keeps one chart for its element's whole life and re-points it
with `updateSeries` when a recycled row hands it another record, so a sort or
a scroll never shows one row's chart on another. It destroys the chart only
once the element has really left the page, because the virtualizer moves rows
far more often than it removes them. Per-row options re-point with
`updateOptions`, and build a new chart when a row's options leave out a key
the previous row's set, set `yaxis` or change `chart.type`, so no row keeps
another row's target line, axis or chart type. The chart stays out of the
accessibility tree, and the cell element is `role="img"` with a label naming
what it shows, so a grid of charts adds no tab stops.

Measured with `npm run bench:chart` (apexcharts 8.8.1, headless Chromium,
2026-11-12), 1,000 rows with 46 charts at first paint, then one scroll to the
bottom and back: the chart column built 82 more charts, with no long tasks
during the scroll, and at the end every rendered row drew its own data. A
cell template that builds on connect, wrapped in `keyed(ctx.data, ...)`,
built 3,079 more with 14 long tasks; without `keyed` it built 1,306 more, and
at the end every rendered row drew another row's data.

### Changed
- Build: the `apex-commons` dev dependency (the Ignite UI token SCSS) moves
  to `^0.11.0`. The shipped bundle is byte-identical.

## [4.0.1] - 2026-11-10

A patch for the Ignite UI add-on. Without `apex-grid/ignite-ui` nothing
changes.

### Fixed
- With the add-on, the grid's card and rows take the Ignite UI theme's
  surface (`--ig-surface-base` on Ignite UI 7.5, else `--ig-surface-500`).
  Before, a grid on a dark theme painted its own slate `#0f172a`, a
  blue-tinted block on the theme's neutral page. The alternate-row, hover and
  tinted washes mix from the new surface. A light theme whose surface is not
  white (Bootstrap `#f8f9fa`, Indigo `#f8f8fa`) now shows it too.
- A grid whose mode differs from the theme's variant (`theme="light"` under a
  dark theme, `theme="dark"` under a light one) keeps its built-in surface, as
  it keeps its built-in text and lines. An `--ag-surface`, `--ag-dark-surface`
  or `--apx-surface` you set still wins, and `design-system="off"` and
  `tokens="off"` turn the step off with the rest of the add-on.
- On a theme with no raised surface (every Ignite UI 7.4 theme), the
  header, toolbar and paginator are the theme's surface moved slightly
  toward its text, a neutral step apart from the card. Before, a dark
  theme kept the built-in slate `#1e2532`, a blue-tinted header over the
  neutral card, and on light Bootstrap and Indigo the built-in `#f8f9fb`
  header would have matched the new off-white card. On light Material and
  Fluent the header moves from `#f8f9fb` to a neutral `#fbfbfb`. The
  theme's `--ig-surface-raised` (Ignite UI 7.5) and an
  `--ag-surface-elevated` or `--ag-dark-surface-elevated` you set still
  win.
- On those dark themes the enterprise popups (filter builder, set filter,
  AI panel, tool panel, status bar) take the same derived header colour,
  so the tool panel and status bar beside the grid match its header as
  they did in 4.0.0. The theme's `--ig-surface-overlay` (Ignite UI 7.5)
  and an `--ag-dark-overlay` you set still win.

## [4.0.0] - 2026-11-09

The first stable 4.0 release, now under the `latest` npm tag. The code is
4.0.0-beta.3's. This entry lists what to check when upgrading from 3.6.0;
the three pre-release sections below have the details.

Changes that can break existing code:

- **Body rows are recycled by default** (`rowRecycling`). A row element and
  its cells can show another record after a scroll, sort or filter. Set
  `rowRecycling = false` (or `row-recycling="false"`) to keep record-keyed
  rows, or read `ctx.data` in templates instead of `ctx.row`.
- **The grid role moved off the host** to the inner `[part~="table"]`
  element, with `aria-rowcount`, `aria-colcount`, `aria-multiselectable` and
  the accessible name.
- **An Ignite UI theme does nothing until you import `apex-grid/ignite-ui`.**
  In 3.x the grid took the brand colour and font from an Ignite UI theme on
  the page by itself. `--ag-font` has no root default any more.
- **Pagination:** pinned rows no longer count toward `totalItems` and the
  pages, a local page change no longer calls custom sort and filter hooks,
  and `DataPipelineConfiguration.pagination` and the `'pagination'` value of
  `DataPipelineParams.type` are removed.
- **`min()` and `max()` fail a value that is not a number.**
- **Smaller type and DOM changes:** `ctx.data` is a required field of the
  cell context, `ApexGridPaginator.pageSizeOptions` is `readonly number[]`,
  the paginator's previous button id is `prev`, and the protected
  `ApexGrid.headerRowCount` and `ApexGridHeaderRow.renderDragGhost` are gone.

New in 4.0: `showHeader`, `selection.isRowSelectable`, the compact
paginator, `::part()` for every paginator and toolbar part, `ctx.data`,
opt-in Ignite UI theming with the family `--apx-*` tokens, input method
(IME) support, numbers typed in full width or with the locale's grouping,
and locale keys for the text that stayed English.

## [4.0.0-beta.3] - 2026-11-09

A third pre-release of 4.0.0, under the `next` npm tag. Japanese (and any
IME) input works in the cell editor, the filter panel and the quick filter,
numbers typed in full width or with the column locale's grouping read as
numbers, and the text that stayed English whatever `localeText` said moves
into locale keys. One behaviour change against 4.0.0-beta.2: `min()` and
`max()` now fail a value that is not a number (see Changed).

### Added
- Locale keys for text that used to be English whatever `localeText` said:
  `toolbar.exportCsv` (the CSV export menu item), `filter.and` / `filter.or`
  (the filter panel's join toggles), `cell.rating` (a rating's accessible name,
  `{value} of {max}`), `cell.true` / `cell.false` (a boolean cell's accessible
  name) and `validation.required`, `validation.min`, `validation.max` and
  `validation.pattern` (the built-in validators' default messages). The
  dictionary also gains the keys `apex-grid-enterprise` reads for its filter
  builder (`filterBuilder.true` / `filterBuilder.false`) and header menu
  (`contextMenu.groupBy`, `contextMenu.ungroupAll`, `contextMenu.expandGroups`,
  `contextMenu.collapseGroups`). Each English default is the text shown
  before, and `esLocale` translates them all.
- `ValidatorContext.localize(key, params?)`, which resolves a locale key
  through the grid's `localeText`. The built-in validators read their default
  messages through it, and a custom validator can too.

### Changed
- `min()` and `max()` fail a value that is not a number. Before, `'abc'` (or
  any text `Number()` could not read) passed both.

### Fixed
- Typing Japanese, Chinese or Korean with an input method (IME) no longer
  trips the grid. The Enter, Escape and Tab that confirm or cancel a
  conversion are left to the IME: they do not commit or cancel a cell edit,
  close the filter panel or clear the quick filter. The filter panel and the
  quick filter apply the text once the conversion ends, instead of filtering
  by the unconverted kana on every keystroke, and a quick filter search still
  waiting out its debounce is dropped when a conversion starts, so it cannot
  overwrite the reading being typed. Typing without an IME filters as before.
- A number typed in the filter panel, or checked by `min()` and `max()`, is
  read as a person writes it: full-width digits and signs (`１２３`, `－５`),
  grouping and the decimal separator of the column's `locale` (or the runtime
  locale), and a leading or trailing `¥`, `$`, `€`, `円` or the column
  currency's symbol. Before, `１２３` did not filter at all and `1,000`
  filtered by 1. A plain ASCII decimal reads as before in every locale, and
  text that was not a number before (`12.5%`, `10²`) still is not. The column
  `locale` now applies to number parsing on every numeric column, not only to
  currency display. The filter panel keeps the text as typed while it reads
  it, so typing `1,234,567` or `1.234,5` key by key is not rewritten to the
  number read so far.
- A filter chip for a condition with no value shows the operator's
  `filter.operator.*` label ("Not empty") instead of its id (`notEmpty`).
- The `localeText` and `esLocale` examples import from `apex-grid`, not
  `@apexcharts/grid`.

## [4.0.0-beta.2] - 2026-11-08

A second pre-release of 4.0.0, under the `next` npm tag. It adds opt-in
Ignite UI theming (`apex-grid/ignite-ui`) and the family `--apx-*` tokens.
Breaking against 4.0.0-beta.1 and 3.x: an Ignite UI stylesheet no longer
re-tints the brand or replaces the font until you import the add-on, and
`--ag-font` has no root default any more (see Changed and Fixed).

### Added
- **`apex-grid/ignite-ui`, the Ignite UI add-on.** `import 'apex-grid/ignite-ui'`
  once and every grid on the page follows the Ignite UI theme the page loads:
  brand, text and muted text, gridlines and the pinned-column edge, the header
  (`--ig-surface-raised`, Ignite UI 7.5 and later), state colours, font and the
  enterprise popups (`--ig-surface-overlay` on 7.5 and later). A grid without
  `theme="dark"` or `theme="light"` follows the Ignite UI variant, live, with
  a JS fallback where the browser has no container style queries;
  `theme="light"` keeps a grid light. Ranking: an `--ag-*` token you set, then
  the family `--apx-*` tokens, then Ignite UI, then the built-in values. Per
  grid, `design-system="off"` turns the Ignite UI colours and font off (the
  variant still picks the mode) and `tokens="off"` turns off the family tokens
  and Ignite UI, variant included (both also as the reflected `designSystem`
  and `tokens` properties). It registers on a shared `globalThis` slot, so it
  reaches the grids of a separately built bundle too. While the add-on is
  loaded, the tokens that follow Ignite UI (text, lines, surfaces, header,
  state colours, pinned edge) leave the root defaults, so page CSS that reads
  one needs its own fallback. It adds about 2.5 KB gzip to an app, and only
  where it is imported.
- **The family `--apx-*` tokens** shared by every Apex product: `--apx-accent`
  (brand), `--apx-fore` (text), `--apx-grid` (gridlines, row borders, header
  separator), `--apx-surface` (card and row background), `--apx-font-family`
  and `--apx-radius-factor`, each ranked below the matching `--ag-*` token.
  The text, line and surface root defaults are now written as their family
  chain (`--ag-text: var(--apx-fore, #111827)` in `:where(:root)` and
  `apex-grid/tokens.css`), so they follow a family token set on `:root`.
- `--apx-radius-factor` scales `--ag-radius`, `--ag-radius-sm` and
  `--ag-radius-xs` while it is set. Unset or 1, every radius is unchanged
  (a multi-value radius too, without a factor); the pill stays round.
- `tokens="off"` (or `grid.tokens = false`) keeps one grid, and the content it
  renders, off the family tokens, with or without the add-on. Without the
  add-on, an `--apx-fore`, `--apx-grid` or `--apx-surface` set on `:root` still
  reaches that grid through the root defaults, which resolve there.
- `--ag-overlay` and `--ag-overlay-text` (dark grids: `--ag-dark-overlay`,
  `--ag-dark-overlay-text`) colour the `apex-grid-enterprise` popups. They have
  no default: unset, each popup keeps its built-in colours.

### Changed
- **Breaking: the grid no longer reads Ignite UI tokens by itself.** Before,
  an Ignite UI theme on the page re-tinted the brand (`--ig-primary-500`,
  `--ig-primary-700`) and replaced the font (`--ig-font-family`) with no
  import. Now an Ignite UI stylesheet changes nothing until you import
  `apex-grid/ignite-ui`, which brings the brand and font back along with the
  rest of the theme.
- The grid now follows the family `--apx-*` tokens (above). A page that sets
  them for its charts, on `:root` for example, sees the grid follow them too.
  Set the matching `--ag-*` tokens to keep the grid as it was, or set the
  family tokens on the elements they are meant for.

### Fixed
- An explicit `--ag-font` now wins over the family and Ignite UI fonts, the
  same order the brand tokens use. Before, an Ignite UI theme on the page
  replaced the grid font even when `--ag-font` was set on the grid itself. The
  default Inter stack is unchanged. To keep the family and Ignite UI fonts
  reachable, `--ag-font` no longer has a root default (it is gone from
  `:where(:root)` and `apex-grid/tokens.css`), so page CSS that reads
  `var(--ag-font)` needs its own fallback, as with `--ag-brand`.

## [4.0.0-beta.1] - 2026-10-29

A pre-release of 4.0.0, published under the `next` npm tag for trying out
before it becomes `latest`. It is a major version because these changes can
break existing code:

- **Body rows are recycled by default** (`rowRecycling`). A row element and
  its cells can show another record after a scroll, sort or filter, so a
  template that keeps state in the elements it creates, or code that holds
  `grid.rows` elements or `ctx.row` across an `await`, can see another
  record. Set `rowRecycling = false` (or `row-recycling="false"`) to keep
  record-keyed rows.
- **The grid role moved off the host.** `role`, `aria-rowcount`,
  `aria-colcount`, `aria-multiselectable` and the accessible name are on the
  inner `[part~="table"]` element.
- **Types removed:** `DataPipelineConfiguration.pagination` and the
  `'pagination'` value of `DataPipelineParams.type`.
- **Pagination:** pinned rows no longer count toward `totalItems` and the
  pages, and a local page change no longer calls custom sort and filter hooks.
- **Smaller type and DOM changes:** `ctx.data` is a required field of the cell
  context, `ApexGridPaginator.pageSizeOptions` is `readonly number[]`, the
  paginator's previous button id is `prev`, and the protected
  `ApexGrid.headerRowCount` and `ApexGridHeaderRow.renderDragGhost` are gone.

See Changed and Removed for the details and for other changes apps may notice.

### Added
- The `ai.cancelled` locale key (English and Spanish), used by the enterprise
  Ask AI panel.
- The `chart.rangeResized` locale key (English and Spanish), announced when an
  enterprise charted range is resized from the keyboard.
- **`showHeader`** (attribute `show-header="false"`) leaves out the column
  header row, the column group row and the filter panel, so a short grid such as
  a dashboard tile gives that room to the data rows. Screen readers still
  announce the column names, and sort, filter, column widths and the page come
  back unchanged when the header returns. While it is hidden, resizing, the
  column menu, drag reorder and the header filter button are unavailable.
  ([#35](https://github.com/apexcharts/apex-grid/issues/35))
- **`selection.isRowSelectable(row)`** keeps chosen rows out of selection,
  such as a pinned total row. Such a row shows no checkbox, and clicks, Shift
  and Ctrl clicks, Space, Select all, `selectRow` and `setState` all skip it;
  the header checkbox counts only selectable rows. Rows stay selectable by
  default, pinned rows included.
  ([#38](https://github.com/apexcharts/apex-grid/issues/38))
- `pagination.paginator: 'compact'` draws the small paginator: summary,
  previous, page / count, next.
  ([#36](https://github.com/apexcharts/apex-grid/issues/36))
- `apex-grid::part()` reaches every paginator and toolbar part
  (`paginator-host`, `paginator`, `paginator-size`, `paginator-info`,
  `paginator-controls`, `paginator-page`, `paginator-button`, `toolbar-host`,
  `toolbar`, `toolbar-search`, `search-input`, `toolbar-actions`, `export`,
  `export-menu` and the rest), and each paginator button also carries its own
  part: `paginator-first`, `paginator-prev`, `paginator-next` or
  `paginator-last`. ([#37](https://github.com/apexcharts/apex-grid/issues/37))
- **`ctx.data` in cell and editor templates.** The context handed to a
  `cellTemplate` or an `editorTemplate` carries `data`, the record the cell
  was rendered for. It stays that record after an `await`, while `ctx.row`
  and `ctx.parent` are elements that a pinned row band can later re-bind to
  another record. A `cellTemplate`'s `ctx.commit` writes to `ctx.data`. An
  editor's `ctx.commit` still commits the cell in edit when it is called.

### Changed
- **Body rows are now recycled by default** (new `rowRecycling` property,
  default `true`). A scroll, sort or filter re-binds the rendered row elements
  to the records now in view instead of building new rows, which makes long
  jumps and sorts cheaper on large grids. A row element, and its cells, can
  therefore show another record later. Cell and editor templates should
  derive what they render from their context on each render, read
  `ctx.data` for the record, and not hold `ctx.row` or `ctx.parent` across an
  `await`; a template that keeps element state can wrap itself in
  `keyed(ctx.data, ...)`. What you might notice: a template that keeps state
  in the elements it creates (an input's typed value, a third-party widget)
  can show it on another record after a scroll or a sort, and code that holds
  `grid.rows` elements across a scroll or a sort finds them showing other
  records. To keep record-keyed rows, set `grid.rowRecycling = false` (or the
  `row-recycling="false"` attribute). Detail panel content follows its record
  and keeps its DOM state across a scroll, a sort or a `moveRow`, so detail
  templates need no change; a grid created inside a `detailTemplate` keeps its
  own setting.
- **The grid role and its row counts moved from the `<apex-grid>` host to an
  inner element** exposed as part `table`: `role` (`grid` or `treegrid`),
  `aria-rowcount`, `aria-colcount`, `aria-multiselectable` and the accessible
  name. It holds only the header rows and the body, so the toolbar, paginator,
  filter panel and live region are no longer read as table content, and every
  default grid passes the axe `aria-required-children` rule. Code or tests
  that read these from the host should query
  `grid.shadowRoot.querySelector('[part~="table"]')`. The layout is unchanged.
- An `aria-label` or `aria-labelledby` on the host still names the grid, and
  `aria-describedby` becomes its description. References are resolved when the
  grid renders: if the referenced element is added later, set the attribute
  again.
- The grid uses the `treegrid` role whenever rows carry levels or expand: tree
  data, master-detail with a detail template, and the enterprise row grouping,
  expandable pivot and server-side grouping.
- `pageItems` keeps the same array between updates while nothing that shapes
  it changes. Apps that compared it by identity now see a new array only when
  the body rows change.
- The column header row is no longer a Tab stop.
- **The built-in column menu opens in the top layer** where the browser supports
  the Popover API: pinned rows, the paginator and the grid's edge no longer
  cover or clip it, it stays on its header cell through any scroll or layout
  change, and it closes when its column scrolls out of the grid. It can now
  extend outside the grid's box.
- The column drag ghost renders at the grid root, so it stays above the column
  group header and pinned top rows, and `apex-grid::part(drag-ghost)` now
  reaches it.
- `--filtering-header-background` applies to every filtered header, pinned and
  dragged ones included, as a layer over the header's own background, and
  filtered headers get the same hover highlight as other headers.
- The paginator follows `--header-background` and group header labels follow
  `--header-text-color`, like the rest of the header area. The paginator text
  size follows `--ag-fs-cell-secondary`, and the filter count badge uses
  `--ag-text-on-brand` and `--ag-fw-semibold`. Default rendering is unchanged.
- Forced colors (Windows High Contrast): checkboxes are drawn by the browser in
  system colours, so apps that styled them through parts see the native
  checkbox in that mode only.
- With pagination, pinned rows no longer count toward the pages: `totalItems`,
  `pageCount`, the paginator summary and the `pageChanged` detail count the
  rows the pager pages through, and pinning a row on the last page moves to the
  new last page. Without pagination `totalItems` still counts every row.
- A local page or page size change no longer reruns sorting, filtering and the
  rest of the pipeline, so custom sort and filter hooks are no longer called on
  a local page change. Remote mode still reruns it.
- `pageChanged` reports the change that was applied, so two quick
  `nextPage()` calls report page 2 and then page 3.
- A page change is announced once ("Page X of N"); the paginator summary and
  page label are no longer live regions.
- The first grid on a page adds one window `error` listener that cancels
  "ResizeObserver loop" messages and hides them from listeners added after it.
  Listeners registered before the first grid still receive them. Every other
  error is untouched. ([#32](https://github.com/apexcharts/apex-grid/issues/32))
- `totalItems` is described one way everywhere: the post-filter, post-sort
  row count, and in remote mode the `pagination.totalItems` you supply, the
  number of rows the server holds for the current filter.
  ([#34](https://github.com/apexcharts/apex-grid/issues/34))
- Type and DOM details for code that builds on the grid's internals:
  `BaseApexCellContext.data` is required, so code that builds a cell context
  by hand must supply it; `ApexGridPaginator.pageSizeOptions` is typed
  `readonly number[]`; the paginator's previous button has the id `prev`
  (it was `previous`) inside its shadow root; and the protected
  `ApexGrid.headerRowCount` and `ApexGridHeaderRow.renderDragGhost` were
  removed, which affects subclasses only.
- The `@lit-labs/virtualizer` dependency is pinned to exactly `2.1.1` (it was
  `~2.1.0`). The grid body builds on parts of that package that are not public
  API, so a newer version arrives only with a grid release that has been
  checked against it.

### Removed
- **Breaking (types):** `DataPipelineConfiguration.pagination` and the
  `'pagination'` value of `DataPipelineParams.type`. The hook was documented
  but never called, so no runtime behaviour changes; TypeScript code that sets
  it stops compiling. For server paging use `pagination.mode: 'remote'`, fetch
  the page on `pageChanged` and keep `pagination.totalItems` current.
  ([#33](https://github.com/apexcharts/apex-grid/issues/33))

### Fixed
- `aria-rowcount` no longer counts the floating filter panel as a row, and a
  pinned top row no longer shares its `aria-rowindex` with the first body row.
- The master-detail panel sits in a full-width gridcell, and `aria-expanded` is
  set only on rows and toggle buttons that can expand. Turning expansion off or
  removing the detail template no longer leaves it on rows.
- Announcing the same message twice in a row (two identical `grid.announce()`
  calls, for example) is read out again by screen readers.
- Invalid cells no longer set an `aria-errormessage` that pointed at an
  unreachable id. The inline alert message is unchanged.
- Range and formula reference highlights on a pinned column no longer let
  scrolled cells show through it.
- Alternating row stripes follow the row index, so they no longer flip or
  flicker while you scroll.
- In the dark theme the default, muted and gold badges are readable and the
  progress bar track is visible. The light theme is unchanged.
- The selected row accent bar sits on the leading edge in right to left
  layouts, including a left to right grid nested in a right to left one.
- Forced colors: checked and indeterminate checkboxes no longer look unchecked;
  in a selected row the cell text, row number, reorder grip and chevrons take
  the selection text colour; an editor opened in a selected row uses the
  system field colours; a keyboard-grabbed row shows an outline.
- The paginator no longer clips its controls in a narrow grid: it drops the
  rows per page selector, then the first and last buttons, so previous and next
  stay reachable. ([#36](https://github.com/apexcharts/apex-grid/issues/36))
- Grids whose cell text wraps no longer raise "ResizeObserver loop completed
  with undelivered notifications" while they resize or scroll.
  ([#32](https://github.com/apexcharts/apex-grid/issues/32))
- With row pinning and pagination, no trailing page is left empty.
- A `pageSize` missing from `pageSizeOptions` now appears in the rows per
  page selector and is selected.
- A page size change or quick filter cancelled through `pageChanging` or
  `quickFilterChanging` no longer leaves the selector or search box showing
  the refused value.
- **Pinned rows no longer show the previous row's state.** When a pinned row
  element switches to another record (a row above it is unpinned, say), it no
  longer keeps the previous record's staged row edit value, validation error,
  expanded state, detail panel content or selection checkbox state, even when
  both records hold the same cell value.
- A `cellTemplate` that calls `ctx.commit` after an `await` writes to the
  record it was rendered for, even if the rows changed in the meantime.
- Moving a keyboard grabbed row with the arrow keys keeps focus on that row
  instead of dropping it to the page, and Escape puts the active cell and
  focus back on the row at its original position.
- The floating ghost of a row drag shows the row's cell text. It showed empty
  cells before.
- An editor rendered again for an edit already in progress (its row scrolled
  back into view, for example) no longer scrolls the grid or selects the typed
  draft when it takes focus.
- With an async `dataPipelineConfiguration` hook, moving a row with
  `moveRow`, a keyboard grab or a drag animates the rows into their new places.
  They jumped there without the animation before.
- A jump to a row far outside the view that is still waiting for the body to
  finish scrolling no longer runs after a newer jump, so two quick jumps end on
  the second row instead of snapping back to the first.
- A pinned row that switches to another record no longer animates from the
  previous record's look: its selected wash, expand chevron, checkbox and
  progress bars show the new record's state at once.
- An image cell whose URL changes (a pinned row switching records, an edit of
  the URL) renders a new `<img>`, so the previous picture no longer stays on
  screen while the new one loads.
- Arrow and Page keys in a grid whose rows grew after they were first shown
  (detail panels expanded, wrapped text) keep the active cell in view and
  focused. A quick run of key presses could leave it unrendered, with focus on
  the body or on a cell of another record, until the next click.
- When a sort, a filter or a data change moves the record of an open cell
  edit to another row that is still in view, the active cell moves with it, so
  the keyboard carries on from the edited cell once the edit closes. It used to
  stay on the old row, which then showed another record.

### Performance
- Scrolling no longer re-renders the rows that stay in view; only the rows that
  scroll in render.
- A grid with a pinned row or a page slice no longer rescans the whole view on
  every key press or click.
- Grids without feature modules skip the per-cell decoration step, and grids
  with modules no longer check every module on each row and cell render.

## [3.6.0] - 2026-10-21

A quality release built from a full code-quality audit, plus `--ag-*` tokens
that reach the grid from any ancestor (shadow roots included). No exported
symbol was removed or renamed. A few documented contracts now hold where they
did not: `sorted`, `filtered`, `pageChanged` and `quickFilterChanged` fire after
the pipeline run they caused, and a row move on a sorted grid clears the sort.
See Changed for what apps may notice.

### Added
- **`--ag-*` tokens set on any ancestor now reach the grid**, including the
  shadow host of a web component the grid renders in, however deep. Set a
  theme once on your own host element and every grid inside follows it. See
  "Changed" for how the defaults moved to make this work.
- **Dark-mode inputs `--ag-dark-*`** (`--ag-dark-surface`, `--ag-dark-text`,
  `--ag-dark-hairline`, `--ag-dark-shadow-card`, …) for every colour
  `theme="dark"` changes. Dark grids read these instead of the light inputs,
  so a light palette set on a shared ancestor never puts a white surface under
  the dark theme's light text. Sizing, typography, motion, the brand and the
  base state colours stay shared by both modes.
- **`apex-grid/tokens.css`**: the token defaults as a plain stylesheet, for
  server rendering or for apps that opt out of the adopted sheet.
- **`setup({ tokenStyles: false })`** skips adopting the token defaults into
  the document.
- **`applyEdits()` entries can name their row by record**: `{ row, column,
  value }` alongside the positional `{ rowIndex, column, value }`. A record
  reaches rows on other pages, pinned rows and rows under a collapsed tree
  parent, so `grid.selectedRows.map((row) => ({ row, column, value }))` now
  edits the whole selection; with `rowIndex` such rows were skipped. Events
  and validators for those rows see `rowIndex` -1.
- **`ApexGrid.ownsEvent(event)`** tells whether an event came from this grid
  or from a grid nested in one of its master-detail panels. The grid uses it
  so cells of a nested grid no longer drive the outer one (clicks, Space
  selection, Ctrl+Z, pointer drags).
- `CSVExportOptions.escapeFormulas` (default `true`), see the change below.
- Locale keys `toolPanel.valueColumn` and `toolPanel.columnLabelColumn` for the
  enterprise tool panel, in English and Spanish.
- Locale key `chart.mapCategoryNone` (English "None", Spanish "Ninguna") for
  the enterprise chart panel's Category select.
- Locale key `setFilter.more` for the enterprise set filter's list cap, in
  English and Spanish.
- `expansion.exportParts` lists parts inside your `detailTemplate` content
  for the row to re-export, so `apex-grid::part(name)` can style them.
- Locale key `pivot.columnsTruncated` for the enterprise pivot column cap, in
  English and Spanish.
- `rowMoving` and `rowMoved` carry `position` (`'before'` or `'after'`) and
  `toIndex`, the view index the row lands at, next to `from`, `to` and
  `data`.

### Changed
- **Token defaults moved from the grid host to the document root.** The grid
  used to declare every `--ag-*` default on its own host, and a declaration on
  an element always beats an inherited value, so tokens set on an ancestor
  never reached it (only `--ig-primary-500` did, through the brand fallback).
  The defaults now sit on `:where(:root)`, adopted into the document through
  `adoptedStyleSheets` when the first grid connects (no `<style>` element, so
  no CSP nonce), and the grid resolves them into private copies on its host.
  Reading tokens keeps working: `var(--ag-surface)` resolves to the default
  anywhere on the page, and `apex-grid { --ag-grid-shadow:
  var(--ag-shadow-card); }` still gives the card shadow. Changes to look for:
  - `var(--ag-brand)` and `var(--ag-brand-strong)` have no root default, so an
    Ignite UI palette set on any ancestor keeps tinting the grid. Page CSS
    reading them needs its own fallback.
  - Derived tokens (`--ag-brand-soft`, `--ag-brand-softer`, `--ag-brand-line`,
    `--ag-row-hover`, `--ag-surface-alt`) are mixed on the grid host so they
    follow a brand set lower down. They still accept an override but have no
    root default to read.
  - A value set on an element above a dark grid (`--ag-surface`, …) no longer
    applies to it; set `--ag-dark-surface` and the other `--ag-dark-*` inputs.
    A value set on the dark grid element itself is now ignored the same way.
    On a dark grid, use `--ag-grid-shadow: var(--ag-dark-shadow-card)` for the
    card shadow recipe.
  - `theme="tinted"` mixes the brand into the surface, gridline and
    muted-text values in effect (yours, if you set them) instead of replacing
    them. Its row separators stay the brand alone, so a tinted grid ignores
    `--ag-border` and `--ag-dark-border`, including on the grid element itself.
    The default tinted look is unchanged.
- **CSV export neutralises spreadsheet formulas.** A text cell or header that
  starts with `=`, `+`, `-`, `@`, a tab or a carriage return is written with a
  leading apostrophe, so a spreadsheet opening the file shows it as text
  instead of running it. Numbers are untouched, and so is text that is a plain
  signed decimal such as `-5` or `+1.5`. Other text with a leading sign gains
  the apostrophe too: a lone `-`, a phone number such as `+44 20 7946 0958`,
  `-1,234.50`, or formatter output such as `-$5.00`. Pass
  `exportToCSV({ escapeFormulas: false })` for the old output.
- **An open editor stays on the record it was opened for** when the data,
  sort, filter or page changes while editing; before, it could jump to another
  row and Enter wrote into the wrong record. The edit is cancelled when its
  record leaves the view (removed, filtered out or replaced by a copy).
  `editingCell`, `editingRow` and the `rowIndex` of the edit events are -1 when
  the edited record is in a pinned row or on another page.
- **Row mode edits the staged row.** Cells of the row in edit show their staged
  values, validators receive the staged row as `ctx.data` (a copy of the
  record with the staged values applied), and a row commit re-validates the
  row's other editable cells. A checkbox click, or any `cellTemplate` calling
  `ctx.commit`, joins the row edit instead of writing straight to the record,
  so `cancelEdit()` rolls it back.
- **After tabbing into the grid body, the first arrow, Home or Page Up key
  activates the first cell** instead of moving past it (ArrowDown lands on
  row 0). Page Up and Page Down move by the rows that fit in the body instead
  of a fixed 10.
- **Tree data under a filter shows the ancestors of a match as their own
  rows** (selectable and exportable, not matching the filter themselves)
  instead of blank placeholders, and matches under a non-matching parent are
  no longer hidden.
- **Replacing `grid.data` prunes tree and detail expansion** of rows that left
  the data, so `getState()` no longer lists rows that are gone.
- **Exports write booleans as the checkbox shows them**: true only for
  `true`, so strings such as `'false'` or `'yes'` and the number 1 export as
  false. **Currency and progress columns export as numbers**, like number and
  rating columns; text that is not a number exports as an empty cell.
- **Replacing `grid.data` with new records clears the undo history** (and
  fires `historyChanged`). Undo used to replay onto the old, detached records:
  nothing changed on screen, yet `cellValueChanged` fired for a row the grid no
  longer held. New data that keeps the edited records, such as an appended
  row, keeps its history, and so do in-place edits. A subclass that keeps
  records outside `data` (a row model that drops collapsed rows and restores
  the same objects) overrides the protected `historyRecords()` to keep their
  history too.
- **`cellValueChanged` from undo or redo reports `rowIndex` -1 when the
  record is pinned or on another page**, instead of the index it had when
  edited (which could name a different row). Listeners that read `rowIndex`
  from a replayed change should identify the row by the event's `data`.
- `applyEdits()` skips an entry whose `rowIndex` is negative or fractional,
  as it already skipped one past the end of the page. 3.5.0 counted a negative
  index from the end of the page and rounded a fraction down.
- **`sortExpressions` and `filterExpressions` replace the current sort or filter
  instead of merging into it**, as documented and as `setState` already did;
  `[]`, `null` or `undefined` clears it. Apps that assigned one expression at a
  time to build up a multi-column sort or filter should assign the full list (or
  call `sort()` / `filter()`, which still add). The assigned list applies at the
  next update, against the columns as they are then, so a template may bind it
  before `columns`; reading it back before that returns what was assigned. Sort
  entries for an unknown column or with an unknown direction are dropped with a
  console warning (an omitted direction still sorts ascending).
- **`currency`, `rating` and `progress` columns filter as numbers**, as their
  type docs already said. The filter panel offers the number conditions (Equals,
  Greater than, Less than and so on) and reads the typed value as a number, and
  `getSchema()` lists the number operands for these columns. A saved state or
  `filter()` call that names a text condition such as `contains` on one of them
  is now dropped with a console warning; in 3.5.0 those conditions threw inside
  the pipeline and filtered nothing. Feature modules read the rule through
  `StateController.isNumericColumn(column)`.
- Feature modules can reveal a cell, read the inline direction of an arrow key
  under RTL and read the scroll insets through the grid's navigation
  controller (`revealCell`, `towardsInlineEnd`, `scrollInsets`), so the
  enterprise range selection follows core navigation instead of a copy.
- **Cell templates run again after each data pipeline run.** A column
  `cellTemplate` is called for every visible row, body and pinned, after each
  pipeline run (sort, filter, quick filter, edit, tree toggle), so a template
  that reads other fields of its row stays current. Keep templates light;
  plain and typed cells are not re-rendered by this.
- Start-pinned columns freeze after the leading checkbox, expansion, reorder
  grip and row-number columns instead of at the grid edge. The grid sets
  `--apex-chrome-offset-row-number`, `--apex-chrome-offset-reorder`,
  `--apex-chrome-offset-selection` and `--apex-chrome-offset-expansion` on the
  host and no longer writes `--scrollbar-offset` inline (the stylesheet
  default stays).
- A decoration-only change (range selection, formula reference highlight)
  updates cell attributes without re-rendering cell content. For feature
  modules, `bumpDecoration` now only re-applies `CellDecorator` attributes;
  request a pipeline run when content must change.
- Feature modules can attach a command to a cell edit and its undo step, and
  read the header's sortable rule through `SortController.isSortable`.
- Pressing on interactive content in a `headerTemplate` (an input, select,
  textarea, button, link or editable element) no longer starts a column drag.
- When a `columnMoving` listener cancels a live swap, the event is raised once
  per target crossing instead of on every pointer move.
- The filter panel's `filtering` event carries a proposed copy of the
  expression for panel edits, and the change is applied only after the event
  is not cancelled. Escape pressed outside the panel is no longer swallowed.
- Switching an applied Empty or Not empty filter to a condition that needs a
  value removes the filter (with a cancellable remove) until a value is typed.
- `getState()` and `setState()` copy array filter terms, and feature modules
  can register a filter operand by name (`registerFilterOperand` on
  `apex-grid/internal`) so a saved filter that uses it restores.
- **`sorted`, `filtered`, `pageChanged` and `quickFilterChanged` fire after
  the pipeline run they caused.** With an asynchronous
  `dataPipelineConfiguration` hook, listeners now read the new rows and
  totals. With synchronous hooks they still fire in the same task, after the
  re-render of the new rows. The server-side and infinite row models fetch
  outside the pipeline, so with them these events can still fire before the
  new block arrives.
- `setQuickFilter` (and the toolbar search box) fires `pageChanged` and
  announces the page when it moves the grid back to the first page. Setting
  the `quickFilter` property or calling `setState` stays silent.
- Every part a row renders can be styled with `apex-grid::part()`:
  selection, expansion, detail panel, row number and reorder parts, and the
  parts of rows a module renders. Before, only `cell` was reachable, so
  existing `::part()` rules for these names now take effect.
- **Moving a row on a sorted grid clears the sort** and keeps the moved order,
  so the sort indicator goes away on the first move and `getState` never
  reports a sort and a row order together. Before, an `applyToData` move was
  undone by the re-sort.
- A move that leaves the row where it is (`moveRow(0, 1, 'before')`, for
  example) returns `false` and fires no `rowMoving` or `rowMoved`.
- Escape after keyboard grab steps restores the original order (and
  `grid.data` with `applyToData`, and any sort) and fires `rowMoved` for the
  way back, so a persisted order stays in sync.

### Fixed
- **`setup()` host sizing reaches grids inside a shadow root.** The
  `min-height: 240px` default was adopted into the page only, which never
  styles an element inside a shadow root. Each grid now adopts it into the
  root it connects in, and for its own tag name, so `<apex-grid-enterprise>`
  gets it too.
- **ArrowDown and ArrowUp in the toolbar's export menu move focus again.** The
  menu looked up the focused item through `document.activeElement`, which is
  the grid's host because the menu lives in the grid's shadow root, so focus
  never moved past the first item.
- **Text filter conditions no longer throw on a cell that is not a string.**
  Contains, Starts with, Equals and the rest read `null` and `undefined` as
  empty text and match numbers, dates and other values on their text. In 3.5.0
  one such cell (an optional field left empty, a Date in a date column) made
  the filter apply nothing and stopped later sorts until it was removed.
- `OperandKeys` offers the text operand names for a field whose type is not
  number, string or boolean (a `Date`, for example), matching what the grid
  applies, instead of accepting the value type itself as a condition. A
  nullable or optional field keeps the names of its type (`number | null`
  still takes the number names only), and a field typed `unknown`, such as
  every field of a `Record<string, unknown>` row, keeps every operand name.
- **Number range conditions no longer match an empty cell.** Greater than, Less
  than and their or equal forms read `null`, and an empty string from CSV or
  JSON data, as 0, so Less than 20 included rows with no value. Empty now
  matches those cells instead.
- **OR filter criteria are evaluated per column.** An OR on one column no longer
  cancels the OR conditions of other columns, so `(city is Paris OR Oslo) AND
  (id is 3 OR 99)` keeps the matching rows instead of none, and a column left
  with only OR conditions (after removing its first chip) filters again instead
  of keeping every row.
- A filter entry without `caseSensitive` (from `setState`, `filter()` or an AI
  patch) keeps the column's `filter.caseSensitive` instead of turning case
  sensitivity off.
- Removing a filter that is not applied, such as typing `-` or `.` first into a
  number filter, or clearing a column that has no filter, no longer fires
  `filtering` and `filtered` or announces that the filter was cleared.
- When the filter changes (a condition or term is added, edited or removed, or
  the filter is cleared), the grid scrolls back to its first row. The reset
  targeted an element that does not scroll, so a deep scroll offset was clamped
  to the end of the shorter result and the first matches sat above the fold.
  Reapplying the same filter, such as `setState(getState())` or assigning an
  equal `filterExpressions` list on every render, keeps the scroll position.
- **A batch of edits made inside another undoes as one step.** A
  `cellValueChanged` listener that calls `applyEdits()` during a row commit,
  a bulk edit or a paste no longer splits it, so one undo reverts all of it.
- Undoing or redoing a large batch reads the view once instead of once per
  cell.
- `applyEdits()` shows the invalid state of its cells when every edit in the
  batch is rejected by a validator, without waiting for another render.
- `pattern()` validators with a global (`g`) or sticky (`y`) RegExp give the
  same result every time; repeated valid values no longer alternate between
  passing and failing.
- Editing a pinned row edits the pinned record; a checkbox or double-click in
  a pinned row used to act on a body row. In row mode a cancelled
  `cellValueChanging` aborts the whole row before anything is written.
- Keyboard navigation keeps its position per grid: an arrow key in one grid no
  longer continues from a cell clicked in another, and removing a grid no
  longer resets the others. The active cell follows filters, sorting, paging,
  data changes and hidden columns, so the body always keeps one tab stop.
- Ctrl+End and Ctrl+Home on large grids render the target rows and keep focus
  on the target cell, and keyboard moves no longer leave the active cell
  hidden behind the sticky header, pinned rows or pinned columns. Full-width
  rows from feature modules (group headers, total rows) take keyboard focus.
- Tree data with `defaultExpanded` keeps a parent the user collapsed when
  `grid.data` is reassigned. Two rows with the same path are both shown, and
  `treeRowExpanding` and `treeRowExpanded` list parents that exist only as a
  path segment.
- Exported dates stored as `'YYYY-MM-DD'` strings carry the calendar day the
  grid shows; west of UTC they were written one day early. An invalid `Date`
  exports as an empty cell instead of throwing (CSV) or writing a value the
  spreadsheet app reports as corrupt (XLSX).
- Exporting with source `'selected'` writes rows in the order the grid shows
  them, followed by selected rows the view hides.
- Date and currency cells reuse their `Intl` formatters, so re-renders and
  large exports no longer build one per cell; a malformed locale, currency or
  date format falls back to a default instead of failing every cell.
- Sparkline cells no longer show a misleading 0% delta when the series starts
  at zero, and never print -0%.
- A `cellTemplate` that reads other fields of its row updates after an inline
  edit, `applyEdits`, paste, fill or a data change, in body and pinned rows.
- The tree data chevron and `aria-expanded` follow every expand and collapse,
  including `expandTreeRow` and `collapseTreeRow`.
- Range selection highlights stay on the selected positions after a sort,
  filter or expand moves rows.
- With the row-number gutter, reorder grip, selection or expansion column
  shown, a horizontal scroll no longer stacks those cells or a start-pinned
  column on top of each other, in LTR and RTL.
- Column group headers sit over their member columns when the reorder grip or
  the row-number gutter is shown, and the group row's cells over pinned and
  leading columns stay frozen on horizontal scroll.
- Pinned columns inside a CSS-scaled container no longer overlap on
  horizontal scroll.
- A header drag toward later columns (rightward, or leftward with
  `dir="rtl"`) keeps following the pointer after the first swap and always
  ends on release, including a release outside the header or a lost release.
- Column autosize no longer throws when group header, total or loading rows
  are rendered.
- With `dir="rtl"` the column resize guide is drawn on the dragged edge.
- The filter panel: a cancelled change really leaves the filter unchanged, a
  condition picked on a fresh panel is reported and announced as an add, the
  filter icon of the open column closes it with a mouse, the panel stays under
  its column on scroll, resize and keyboard column switches, and it no longer
  runs off screen when the root font size is not 16px.
- `setState(getState())` keeps the scroll position when the filter holds an
  array term, and the filter panel chip lists such a term's values.
- With an asynchronous pipeline hook, a slower earlier run no longer
  overwrites the rows of a newer quick filter, filter or sort, and a run
  replaced before it finishes no longer holds back the newer one's calls and
  events.
- A `quickFilterChanging` listener that assigns `grid.quickFilter` (to trim
  the input, for example) keeps its value, and `quickFilterChanged` reports
  it. A substitute equal to the current filter changes nothing and
  `setQuickFilter` returns `false`.
- Changing `grid.tree` after the first render (turning tree mode on or off,
  or changing `getDataPath` or `defaultExpanded`) rebuilds the rows.
- `grid.data` set to `null` or `undefined` (a framework prop that is still
  loading) shows an empty grid and reads back as `[]`, instead of throwing
  and keeping the previous rows.
- `moveColumn` no longer fires `columnMoving` for a move that changes nothing.
- Shift+click and Ctrl or Cmd+click beside the checkbox in the selection cell
  do the same range or additive selection as on the checkbox itself.
- When a `rowSelecting` listener cancels the change, the row and select-all
  checkboxes show the real selection state instead of staying checked.
- Moving a row while a column filter or the quick filter is active keeps every
  hidden row in its place, in the manual order and in `grid.data` with
  `applyToData`. Before, hidden rows were pushed to the end.
- Replacing `grid.data` carries the manual row order and row pins onto the
  new rows (by `rowId` when set, otherwise rows that left the data are
  dropped). New rows can be move targets, a reload no longer disables
  reordering and header sorting, and the pinned band no longer shows a stale
  copy of a reloaded row.
- A row drag ends when the pointer is released or cancelled anywhere on the
  page, or when a move arrives with no button held, and a grid removed
  mid-drag drops its ghost.
- With `rowPinning.enabled` set to `false`, `pinnedRows` and the aria row
  counts no longer report pinned rows and those rows get their reorder grip
  back. The pins are kept for when pinning is turned back on.

## [3.5.0] - 2026-09-12

A feature and accessibility release. No exported symbol was removed or renamed.
Two consumer-visible changes are listed under Changed and Removed: the Ignite UI
dependencies are gone, and `setup({ theme })` is now inert.

### Added
- **Right-to-left support.** `dir="rtl"` on the grid or any ancestor mirrors it
  completely. Direction is read from the computed style rather than the `dir`
  attribute, so an inherited direction works. The stylesheets were already
  written in logical properties; what changed is the code that reasoned in
  physical pixels or physical key names: ArrowLeft / ArrowRight map onto
  previous / next column by inline order, column resize takes width off the
  inline-start edge, and column reorder flips its midpoint comparison. (The
  enterprise range and chart-range handles had a matching fix; see that
  package's 0.7.0 entry.)
- **`grid.applyEdits(edits)`**, a programmatic batch write. Previously the only
  write path was `editCell` + `commitEdit`, which drives the editor, so a bulk
  write meant a thousand undo entries and a thousand re-renders. Each write still
  emits cancellable `cellValueChanging` then `cellValueChanged` and still runs
  the column's validators, while the batch lands as one undo step and one
  pipeline run. It returns a tally rather than a count, splitting `applied` from
  `unchanged`, `invalid`, `cancelled` and `skipped`, since "nothing changed" and
  "everything was rejected" are different answers. Out-of-range rows and
  non-editable columns are skipped rather than thrown on, so a partially stale
  batch still applies what it can.
- **Reduced-motion support.** Every transition now routes through one of the
  `--ag-dur-*` tokens, and those zero under `prefers-reduced-motion: reduce`:
  24 transitions across 9 stylesheets go instant with their end states
  unchanged. The JS-driven row reorder and expansion animations already bailed
  out.
- **Forced-colors support.** Forced colors paints no `box-shadow`, and the grid
  leaned on inset shadows for exactly the indicators that matter most, so in
  Windows High Contrast a keyboard user had no visible cursor and no visible
  selection. The active-cell ring, invalid-cell ring, selected-row bar and every
  toolbar and filter focus ring are restated as outlines, which forced colors
  recolours rather than drops and which sit outside layout, so nothing shifts.
- **The Custom Elements Manifest is now authoritative for `<apex-grid>`.** The
  element was missing from `custom-elements.json` entirely: no `tagName`, not
  flagged `customElement`, and zero named events. It now resolves
  `customElement`, `tagName`, all 29 `ApexGridEventMap` events, the `theme`
  attribute and the public `@property` fields, and a build-time drift check
  fails the build when any of them diverge. This is what the new
  `react-apex-grid` wrapper package generates from, and what editor tooling
  reads for completions.

### Changed
- **Target sizes meet WCAG 2.2 AA 2.5.8 (24x24).** The selection cell and the
  select-all header cell forward clicks to their checkbox rather than growing a
  deliberately small 14x14 mark. The header sort / filter / menu buttons reach
  24x24 through the invisible chip that already expanded them, so the visible
  16px box and the packed header layout are unchanged and nothing paints at
  rest. **Paginator buttons grow from 22 to 24, which makes the paginator bar
  2px taller.** The range fill handle stays a 10px grab band, now documented as
  a criterion-permitted exception rather than a gap: it is reachable through
  controls that do meet 24x24, and its position at the range corner is
  essential to what it means.
- **`setup({ theme })` is inert and warns once.** It only ever forwarded to
  Ignite UI's `configureTheme()`, which was already documented as not affecting
  the grid's appearance. It still compiles, so no consumer code breaks; the
  warning is there because silently dropping the forwarding would leave an
  Ignite UI host app unthemed with no clue why.

### Removed
- **The `igniteui-webcomponents` and `igniteui-theming` dependencies.** Core
  carried the first as a runtime dependency and enterprise as a peer, so every
  consumer installed a whole component library (plus `@floating-ui`) for one
  inert pass-through. The grid registers no Ignite UI element.
  `igniteui-theming` was a Sass dependency for exactly one function, `rem()`,
  now reimplemented locally with the same conversion, and it emitted 55 Sass
  deprecation warnings per build. Five packages leave the lockfile, and the
  compiled CSS is 3,718 bytes smaller with every `rem()` output byte-identical.
- **The `--igx-*` custom-property level.** Every colour rule resolved through
  three levels and the first never fired: `--igx-*` is the igniteui-angular
  naming convention, not the web-components one, so it was dead indirection in
  front of the two levels that work. `--ag-*` overrides and the unprefixed
  semantic variables behave exactly as before. The `--ig-primary-*` and
  `--ig-font-family` hooks stay, since those are what an Ignite UI theme
  actually sets and reading a variable with a default costs nothing when absent.

### Fixed
- **A grid could settle with zero rendered rows at first paint**, silently,
  while reporting a correct `ariaRowCount` and a correctly sized scroll region
  ([#31](https://github.com/apexcharts/apex-grid/issues/31)). The virtualizer
  derives its viewport from the intersection of the body, its clipping ancestors
  and the window, and clears the rendered range when that intersection is
  zero-height while still sizing the scroll extent from the full item count. It
  could not recover, because the only invalidation signals it listens for are
  size changes and scroll events: a body that moves into view, or a window that
  resizes around a fixed-size host, fires neither. An iframe sized by its host
  page after load hits this, as does content above the grid that is still
  settling. The body now watches its own intersection with the window and
  re-measures when it gains a visible slice with nothing rendered, bounded to
  three attempts per geometry change and skipped entirely when there is no
  visible slice.
- **A grid moved to another parent left its body permanently stale**, still
  rendering the old rows after `data` was reassigned. The body awaited
  virtualizer state before calling `super.connectedCallback()`, which deadlocks
  on a reconnect: the promise waits on a layout that only runs once the update
  cycle that call starts.

## [3.4.0] - 2026-07-17

An accessibility-focused release. The public module API is unchanged (no
exported symbol was added, removed, or renamed); two keyboard and editing
behaviors changed, listed under Changed below.

### Added
- **Keyboard editing and navigation.** Enter or F2 opens the active cell's
  editor (previously editing was pointer-only); PageUp / PageDown move by a
  viewport page; Ctrl/Cmd+Home and Ctrl/Cmd+End jump to the grid's first and
  last cell.
- **Roving-tabindex focus model.** The active cell is the grid body's single
  tab stop, so real focus follows arrow-key navigation and screen readers
  track cell-to-cell movement. Keyboard-driven commit or cancel returns focus
  to the cell.
- **Localized live-region announcements** for sorting, filtering, selection,
  paging, row pinning, row reorder, expansion, and undo / redo, plus localized
  header control labels and sort-state descriptions. New locale keys under
  `announce.*` and `header.*`, along with `grid.label` and `editor.rating`
  (English and Spanish).
- The grid host now applies a localized `aria-label` ("Data grid") unless the
  author sets `aria-label` / `aria-labelledby`, and reflects
  `aria-multiselectable` when multi-row selection is enabled.
- **Locale keys for the enterprise chart panel** (`chart.*`) and the reworked
  enterprise AI surface (`ai.*`). Inert in the community grid.
- **Error-value rendering.** A spreadsheet-style error value (an object with a
  `#...` code, such as the enterprise formula engine's `#VALUE!`) now renders
  as its code in typed (number / currency) columns instead of being coerced to
  `NaN` and showing an empty cell.

### Changed
- **Home / End now move within the row** (first / last cell of the active
  row), matching the common data-grid convention; previously they jumped to
  the first / last row. Use Ctrl/Cmd+Home / Ctrl/Cmd+End for the grid corners.
- **Clearing a number or currency editor commits `null`, not `NaN`.** An empty
  or unparseable numeric input previously wrote `NaN` into the row.

### Removed
- The `ai.noAdapter` locale key (the enterprise AI adapter API it supported
  was replaced; see the `apex-grid-enterprise` 0.6.0 changelog). If you
  overrode this key in `localeText`, remove it.

## [3.3.0] - 2026-07-02

A large, additive, backward-compatible release. The public `.` / `./define` API
stays compatible and existing grids keep working. A couple of default behaviors
changed: numeric and currency columns now left-align (previously their values
right-aligned), and a column menu / filter button now appear on sortable /
filterable columns.

### Added
- **State snapshots: `getState()` / `setState()`.** Serialize and restore the
  grid's state (such as sort, filter, columns, pagination, selection, and
  expansion) as a plain, JSON-safe object. `setState()` is defensive: it
  validates the incoming shape and returns a result report instead of throwing
  on unexpected input.
- **`getSchema()`.** A capability descriptor for the grid's columns and features,
  intended for tooling and AI integrations.
- **`stateChanged` event.** Fires when a state-bearing operation changes, so a
  host can persist or react to grid state.
- **Internationalization.** A `localeText` override map plus a bundled Spanish
  (`es`) locale; every built-in string (core, and the enterprise features) is
  localizable.
- **Declarative cell validation.** Per-column validators reject invalid edits,
  reflect `data-invalid` on the cell, surface an inline error message, and block
  the commit.
- **Undo / redo** for cell-data edits, backed by a history controller.
- **Row pinning.** Pin rows to sticky top and / or bottom bands that stay in view
  while the body scrolls.
- **Row drag-reorder.** Reorder rows by dragging, applied as a manual-order
  pipeline step. A six-dot grip handle shows by default (`rowReordering.handle`,
  default `true`) and dragging lifts a full-row floating ghost. Two modes are
  supported: handle mode (only the grip starts a drag, so the rest of the row
  stays free for selection and editing) and whole-row mode (`handle: false`,
  drag from anywhere on the row).
- **Column groups.** Spanning header groups above the column header row.
- **Spreadsheet coordinate hints.** Set `coordinateHints` (reflected as the
  `coordinate-hints` attribute) to reveal a leading row-number gutter
  (1, 2, 3, and so on) and A / B / C column-letter header chips, so cell
  references are discoverable.
- **Header column menu and per-column filter button.** A kebab (three-dot)
  button opens a column menu; the built-in items are Sort Ascending / Descending
  and Autosize Column, and a feature module can supply the menu through the new
  `ColumnMenuProvider` seam (so `apex-grid-enterprise` fills it with pin / hide /
  group / chart actions). The kebab shows on sortable or resizable columns, or
  whenever a module provides a menu, and is always visible (not hover-only); set
  the new `columnMenu` property to `false` to hide it. Filterable columns also
  show a filter button that opens the filter panel.
- **Column separators.** A persistent vertical divider now shows on every
  column header's trailing edge, not just the frozen-column pin edges. On
  columns that opt into resizing the divider doubles as the resize handle (it
  takes the `col-resize` cursor and can be dragged). On by default; set
  `columnSeparator` to `false` (reflected as the `column-separator` attribute)
  to hide them. The line's color and vertical inset are themeable via
  `--ag-header-separator` / `--header-separator-color` and
  `--apex-header-separator-inset`.
- **`allowFormula` column flag.** Inert in the community grid; the seam the
  `apex-grid-enterprise` formula editor builds on.

### Changed
- **Numeric and currency columns left-align by default**, matching the common
  data-grid default. Previously their values right-aligned; now the header label
  and the column values both sit at the leading edge, like every other column.
  Digits still use tabular figures so they stay vertically consistent.
- **Filtering opens in a floating panel** from the header filter button, instead
  of an always-present inline filter row.
- Theming refinements: design-token tweaks and a crisp 1px frozen-column
  pin-edge line.

### Fixed
- Range-selection drag now tracks through `pointermove`, so a drag that leaves
  and re-enters the grid stays accurate.

### Internal
- Cell writes funnel through a single `applyCellEdit` choke point, so undo / redo,
  validation, and (in enterprise) formula recalculation share one write path.
  `apex-grid/internal` also gained the seams the enterprise coordinate, formula,
  and column-menu (`ColumnMenuProvider`) features build on.

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

[3.3.0]: https://github.com/apexcharts/apex-grid/releases
[3.2.0]: https://github.com/apexcharts/apex-grid/releases
[3.1.0]: https://github.com/apexcharts/apex-grid/releases
[3.0.1]: https://github.com/apexcharts/apex-grid/releases
[3.0.0]: https://github.com/apexcharts/apex-grid/releases
