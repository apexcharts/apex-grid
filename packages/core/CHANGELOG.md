# Changelog — apex-grid

All notable changes to the `apex-grid` (community) package are documented here.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
and the format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- **`rowRecycling`** (attribute `row-recycling`), experimental and off by
  default. With it on, a scroll, sort or filter re-binds the rendered body rows
  to the records now in view instead of building new rows, which makes jumps
  and sorts cheaper on large grids. Cell, editor and detail templates must then
  derive what they render from their context on each render and read
  `ctx.data` for the record; leave it off for templates that keep state in the
  elements they create. Detail panel content follows its record, and a grid
  created inside a `detailTemplate` keeps its own setting.
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
