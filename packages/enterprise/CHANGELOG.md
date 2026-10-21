# Changelog — apex-grid-enterprise

All notable changes to the `apex-grid-enterprise` (pro) package are documented
here. This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
and the format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- `apex-rows-load-failed` (infinite row model: `startRow`, `endRow`, `error`,
  `retrying`) and `apex-server-rows-load-failed` (server-side row model: also
  `groupKeys`) report a rejected `getRows`, with the `RowsLoadFailedDetail`,
  `ServerRowsLoadFailedDetail` and `RowLoadRetryConfig` types.
- Tool panel rows have a Values toggle, and in pivot mode a Column Labels
  toggle, so aggregations and pivot columns can be set from the keyboard.
- `advancedFilterModel` on `InfiniteGetRowsParams` and
  `ServerSideGetRowsParams` (the active advanced filter, or `null`).
- `pivotOptions.maxValueColumns` caps the generated pivot value columns
  (default 200, `Infinity` turns it off). A pivot on a high-cardinality field
  shows the first columns, announces the cut and logs one console warning,
  where it used to render every column and freeze the grid.

### Changed
- **Copy neutralises spreadsheet formulas.** Range copy (Ctrl/Cmd+C,
  `copySelection`, `getSelectionTSV`) and the context menu Copy item follow
  the core CSV rule: copied text such as `=HYPERLINK(...)` or `-note` reaches
  the clipboard as `'=HYPERLINK(...)` or `'-note`. Pasting the grid's own last
  copy back into the grid still writes the original text. Set
  `escapeFormulas = false` on the range selection controller to copy raw
  text. `exportToCSV({ formulas: true })` still writes formula sources such as
  `=A1*B1` unescaped while escaping other text.
- **Rejected `getRows` calls are retried.** Both server row models retry a
  rejected request up to `maxRetries` times (default 2, at most 10, 0 turns it
  off) after `retryDelay` milliseconds (default 1000, doubled each time).
  After the last attempt the rows stay placeholders until `refreshRows()`,
  `refreshServerSide()` or a sort or filter change, and a server group with
  nothing loaded collapses so expanding it asks again. Before, the infinite
  model asked again on every scroll over a failed block.
- Infinite and server-side row models keep working when the grid is moved in
  the DOM: sort and filter still go to the server, the group column stays, and
  blocks in flight during the move are applied. Removing the grid no longer
  stops the row model, so a request already in flight still completes.
- Server-side row model: a group whose value is null, undefined or empty
  expands to its own children and shows as "(blank)", a value containing a
  slash no longer collides with a nested path, and a NULL and an empty-string
  group from the server merge into one "(blank)" group. CSV and XLSX export
  write the auto group column and leave out rows not loaded yet; the group
  column header uses the grouped columns' `headerText`, and a flat request
  adds no empty group column.
- Turning on `serverSideRowModel` on a grid with client `groupBy` or `pivotOn`
  clears them in the same update.
- Unloaded placeholder rows of both row models, group header rows and the
  grand total row cannot be edited: `editCell` and `editRow` return false and
  `applyEdits` counts them as skipped. Fill, export and selection skip
  placeholders, and a paste drops the lines that land on them.
- **Grand total row counts every leaf.** Collapsing a group no longer lowers
  the total. While a pivot, the server-side row model or the infinite row
  model is active the row is not added (a pivot shows its own grand total),
  and `getTotals()` is empty then and when `totalRow` is unset.
- **Tool panel follows the grid.** It re-renders on changes made elsewhere
  (header menu, `setState`, app code), lists columns in display order with
  pinned columns at their ends, and moves within a pin group. Pin and move go
  through `pinColumn` and `moveColumn`, so cancelling `columnPinning` or
  `columnMoving` is honoured. While pivoting it lists the source fields, it
  opens in pivot mode on a grid that is already pivoting, and setting
  `pivotMode` from code carries the row dimension like the toggle.
  `pivotMode` is now a getter and setter.
- Status bar Sum, Avg, Min and Max refresh when values under the selection
  change (edit, paste, fill, undo, formula recalculation, new data); a burst
  of edits recomputes once.

- **Formulas stay on their rows.** Reordering rows with `applyToData`,
  deleting rows, or reloading data with a `rowId` moves each formula with its
  row and shifts its relative references, instead of recomputing at the old
  positions and overwriting other rows. Without a `rowId`, a new row object at
  a formula's old position keeps the formula only while it still holds the
  value the formula computed there; otherwise the new value is kept and the
  formula is dropped. References to other rows shift like a fill; they do not
  follow the row they pointed at.
- **Formula state honours `rowId` and `allowFormula`.** `getState` and
  `setState` key formulas by `rowId`, and formulas saved with a `rowId` record
  their data index (a new `origin` field). `getState` saves only formulas in
  `allowFormula` columns; `setState` restores only into them, leaves formulas
  that code set on other columns in place, and reports each skipped or
  malformed entry in `SetStateResult.warnings` instead of throwing (with
  `strict`, the first one throws before any stored formula changes). The fill
  handle and paste copy the value into a column without `allowFormula`.
- **Coordinate hints match what formulas read.** In grids with
  `allowFormula` columns the row gutter numbers rows by their position in
  data (it no longer renumbers after sorting, filtering or paging), pinned
  rows show their number, and header letters skip hidden columns and keep
  their letter after a column move.
- `cellValueChanged` events raised by formula recalculation report `rowIndex`
  as the view index, or -1 when the row is off the page, like any other edit.
- **Advanced filter: currency and progress columns filter as numbers**, with
  number operators and a number input in the builder, like the core filter
  row. A saved model that used a text operator such as `contains` on such a
  column no longer applies that condition; the builder shows it as a disabled
  choice until a number operator is picked.
- **Advanced filter honours a column's `filter.caseSensitive`**, so the
  builder and the filter row of one grid agree.
- The filter builder's Apply, and `applyAdvancedFilter`, keep a copy of the
  model: later edits in the open builder, or to the object passed in, take
  effect only on the next apply. The `apex-advanced-filter-changed` event
  detail is its own copy.
- A filter builder attached to a grid that already has an advanced filter
  opens with that filter, and a condition on a column hidden after it was
  applied keeps its column, operators and input type.
- **Paste and fill now need editing on the target column.** Range paste
  (Ctrl/Cmd+V, `pasteText`) and the fill handle (drag or `fillTo`) write only
  cells the user could edit by hand: `editing.enabled` on the grid and
  `editable: true` on the column. A read-only grid or column is no longer
  changed. Apps that pasted or filled without editing configured must turn it
  on for the columns that should accept it.
- Pasted text is stored as the column type, the way the cell editor commits
  it: numbers for number, currency and progress columns, a rating clamped to
  its stars, the matching option for a select (by value, then by label),
  `TRUE` or `FALSE` in any case for booleans, and dates in the shape the cell
  already holds. An empty pasted cell clears a typed cell to `null` instead of
  storing an empty string.
- Formula paste and fill go through the same path as typed edits: validators
  run on the computed value, `cellValueChanging` can cancel them, and with
  `editing.history` one undo reverts the whole paste or fill.
- Copy quotes a value holding a tab, a line break or a double quote, the way
  spreadsheets do, and paste reads quoted cells, so multi-line text survives a
  round trip within the grid or to and from a spreadsheet. Plain values copy
  exactly as before.
- Fill extends a number series only in numeric columns and in untyped columns
  that hold real numbers; text that looks numeric, such as a zip code `02139`,
  is copied unchanged.
- **Grouping keys.** Equal dates group together even when each row holds its
  own `Date` object. Rows whose value is `null`, `undefined` or `''` share one
  (Blank) group. Group keys are now unique: a value containing `/` is escaped
  (`A/B` becomes `//A%2FB`), a literal `(blank)` value gets its own key, and a
  date with milliseconds keys by its ISO instant. Every other value keeps the
  key earlier releases wrote, so saved expand and collapse state still
  restores the same groups.
- Collapse all and expand all survive `getState` and `setState` through a new
  optional `groupDefaultExpanded` state field; older snapshots restore as
  before. `groupingOptions.defaultExpanded` is applied only when its value
  changes, so a later `groupBy` or `aggregations` change, or a framework
  passing an equal inline `groupingOptions` on every render, no longer undoes
  collapse all. Call `expandAllGroups()` to re-expand.
- Aggregations (group headers, total row, pivot) skip `NaN` and `Infinity`
  cells and count numeric strings, the rule the status bar uses, so one `NaN`
  cell no longer shows `NaN` for sum, avg, min or max. A column of numeric
  strings now sums to its real total instead of 0.
- **Formula results that change.** A `Date` cell reads as its epoch
  milliseconds in arithmetic, comparisons and text (`=A1+86400000` is one day
  later); any other object reads as `#VALUE!`. A blank cell equals `""`, `0`
  and `FALSE`, so `=A1=""` and `=A1=0` are TRUE for an empty `A1`. The `%`
  operator follows the MOD rule, taking the sign of the divisor (`=-7%3` is 2,
  was -1). A result that is not a finite number is `#VALUE!`, so
  `=POWER(0,-1)` and `=10^308*10` no longer write `Infinity`. A range of more
  than one cell passed to a fixed-argument function such as `ROUND`, `ABS` or
  `LEFT` is `#VALUE!` instead of feeding later cells in as extra arguments.
  Numbers turned into text keep 15 significant digits (`=(0.1+0.2)&" kg"` is
  `0.3 kg`), and text reads as a number only when it is a plain decimal, so
  `0x10` or `1e999` is `#VALUE!`.
- Filling or pasting a formula up or left past row 1 or column A, or moving a
  formula's row above the references it reads, writes `#REF!` for the
  references that leave the sheet instead of pointing them at row 1 or
  column A.
- Custom functions whose names contain digits, underscores or dots (`LOG10`,
  `VAT_RATE`, `STDEV.S`) can be called from formulas, and
  `registerFormulaFunction` throws a `TypeError` for a name no formula could
  call, including `IF`, `TRUE` and `FALSE`. Formulas accept exponent notation
  such as `2E5`. Formula error positions count from the text as typed,
  including the leading `=`.
- **Server row models receive the advanced filter.** With `infiniteRowModel`
  or `serverSideRowModel`, the advanced filter (filter builder Apply,
  `applyAdvancedFilter`) is sent to `getRows` as `advancedFilterModel`, and
  applying or clearing it reloads from the first block. The grid no longer
  filters the partly loaded rows on the client, which hid unloaded rows and
  never reached the server, so a datasource must now apply the model itself
  (the exported `filterRows` evaluates it the way the grid does).
- The grid owns `dataPipelineConfiguration` while the advanced filter or a
  server row model runs and composes them over the app's own configuration.
  An app assignment made while a server row model runs is kept and takes
  effect when the row model stops, instead of disabling it.
- Range selection acts on Escape, Ctrl/Cmd+C, Ctrl/Cmd+V and Shift+Arrow only
  when the key comes from the grid's own body: not from a cell editor
  (including custom editors), a control inside a cell, a master/detail child
  grid, or a key another handler already handled.
- Shift+ArrowLeft and Shift+ArrowRight follow the arrow on screen in
  right-to-left grids, keyboard range extension scrolls the moving corner
  into view, and dragging a range past the left or right edge scrolls the
  columns.
- **Chart series colors fill from the palette.** A `format.colors` list
  shorter than the series count colors the remaining series from
  `apexOptions.colors` or the theme palette instead of repeating the list
  (three series with `colors: ['#ff0000']` used to draw all three red).
- Trend line and forecast are ignored for horizontal bars and the other chart
  types they do not apply to, and the Format popover hides those controls; a
  saved bar chart with a trend line used to render as vertical columns.
- In the chart's empty state the toolbar shows only the Data control.
- AI rule engine: the first command word in a prompt wins, so a column label
  such as Group Name or Order Status no longer triggers grouping or a sort.
  Reset and undo run only as whole commands: "clear all filters" clears the
  column filters and the quick filter (keeping sort and grouping), "reset
  sort" clears the sort, and "go back to page 1" paginates instead of undoing.
- AI rule engine: a condition a column cannot express is reported with a
  note instead of applying the column's first operand, and removing rows by
  starts with or ends with reports that it cannot be expressed.
- `getSchema` marks rating and progress columns aggregatable, as the
  aggregation engine already treats them.
- **AI filters add to the active filters.** An AI filter replaces only a
  filter on the same column instead of clearing the others, so a compound
  prompt keeps every clause ("clear all filters" still clears).
- AI undo restores only what the AI turn changed: formulas, ranges and later
  view or column changes are kept, and the "undo" prompt passes over turns
  that changed nothing. AI column prompts and an `applyState` patch with a
  partial `columns` list keep the column order, widths and other pins (a list
  naming every column is still the full layout), and `pinned: null` unpins.
- **Formula entry runs the edit pipeline.** A formula entered in the formula
  editor is judged by the column validators and the cancellable
  `cellValueChanging` on its computed value, dispatches one
  `cellValueChanged`, is staged with the row in row editing mode, and is
  undoable; a validator that rejects error values now rejects such a formula.
- Context menu sorts replace the current sort like a header click and fire
  `sorting` and `sorted`; the sort items are omitted on columns that are not
  sortable and while a manual row order is active; menu pins go through
  `pinColumn`, so `columnPinning` and `columnPinned` fire.
- A right-click inside a text field of a cell editor keeps the browser's menu.
- A custom AI tool that throws becomes a warning and the applied steps can
  still be undone; the analyze tool refuses a malformed query; AI `pivotOn`
  accepts several fields; `AIResult.skipped` lists only slices a step asked
  for that were not applied.
- **Create chart and Ask AI appear only when their panels are registered.**
  Without `<apex-grid-chart>` the toolbar Create chart button, the floating
  chart button, Alt+F1 and the Chart range menu entry are not offered, and
  without `<apex-grid-ai>` the Ask AI button is not shown. The `/define`
  entry registers both, so its users see no change.
- **Formula export uses file coordinates.** `exportToCSV({ formulas: true })`
  writes references that point at the cells of the file (below the header, in
  the exported order): `=A1*B1` on the first data row is written `=A2*B2`. A
  formula that reads a cell the export leaves out or reorders, or calls a
  registered custom function, exports its value. Exported formulas use the
  spreadsheet spelling (`MOD`, `AVERAGE`, `CONCAT` over a range).
  `exportToXLSX({ formulas: true })` writes real formula cells with their
  computed value.
- Charts of a pivot view use the row labels and leave subtotal and total rows
  out, and cross-filter charts detect numeric columns from their values.
- Set filter: toggling, Select all and Clear filter change only its own
  condition, so other `and` conditions on the column stay; the selection is
  saved by `getState()` and restored by `setState()`; a column with very many
  values lists the first 1000 and asks to search.
- Chart dialog: Escape inside an open popover closes only that popover; the
  Format and Data popovers are named groups instead of menus; snapshot charts
  ignore selection and view changes, and live charts no longer redraw on
  selection changes.
- **Pivot columns follow the data.** Pivoting on several fields creates
  columns only for value combinations that occur, so a hierarchy such as
  category then subcategory no longer produces mostly empty columns. Columns
  are ordered by value: numbers and dates in order, then text with numeric
  collation (item2 before item10), blanks last.
- **Pivot headers use the source columns.** Row dimension and measure headers
  take the source column's `headerText`, and the function name is the long
  localized one, so `salary (avg)` reads `Salary (Average)`. Headers follow
  `localeText` changes, and a measure from a currency column keeps its
  currency format. Code or tests that match on pivot header text need
  updating.
- An empty pivot intersection shows a blank cell for avg, min and max (count
  and sum stay 0). Charting the pivot view still plots those cells as 0.
- Chart dialogs and charted range outlines stay with their grid: they leave
  the page while the grid is detached (an enterprise detail grid whose master
  row scrolls out, for example) and come back when it is attached again,
  instead of closing for good. The Ask AI dialog follows the same rule; a
  request it had in flight is cancelled without an error.

### Fixed
- **Integrated charts show cell text as text.** Categories and series names
  in the legend and tooltip are escaped, so a cell holding markup can no
  longer run script when it is charted. Ordinary labels such as `<18`,
  `a < b` or `R&D` look exactly as before. A `legend.formatter`,
  `tooltip.x.formatter` or tooltip title formatter passed through
  `apexOptions` still wins and must escape its own output.
- Min and max aggregations (total row, grouped aggregates, pivot values,
  `getAggregations`), grouping with a very large expanded group, AI questions
  about the minimum, maximum or range of a column, and formulas over very
  large ranges such as `=SUM(A1:A200000)` no longer throw on more than about
  120k values.
- Writing a literal over a formula cell by paste, fill, `applyEdits`, undo or
  redo replaces the formula, as typing in the editor already did.
- An app listener that edits a cell while formulas recalculate updates that
  cell's dependents; `clearFormula` refreshes show formulas and emits
  `stateChanged` even when nothing depends on the cleared cell.
- With show formulas on, cells without a formula keep their column type
  rendering, and formula sources read left to right in RTL grids.
- Formulas that read a `Date` cell no longer throw a `TypeError`.
- `ROUND`, `ROUNDUP` and `ROUNDDOWN` round in decimal: `=ROUNDUP(0.07,2)` is
  0.07 and `=ROUND(1.005,2)` is 1.01.
- A custom function that throws shows `#VALUE!` in its cell instead of
  stopping recalculation.
- Typing a very large range such as `=SUM(A1:J1000000)` on a small grid no
  longer freezes the page: only cells that exist are read, and the part past
  the data still gives `#REF!`.
- `setState` with a malformed `groupExpand` (null, a number or an array)
  reports a warning, or throws in strict mode before applying anything,
  instead of throwing after `groupBy` and `aggregations` were already applied.
- Paste, fill and copy skip group header rows and the grand total row, and an
  in-grid formula paste onto a range that overlaps its source reads the
  source formulas as they were before the paste.
- Keyboard copy and paste work where the async Clipboard API is unavailable,
  such as an http origin: the grid uses the browser's copy and paste events.
  Inside a cell editor the keys keep their usual text behaviour.
- Infinite row model: when blocks answer out of order, the exact row count
  from the last block is kept, so no placeholder rows stay at the end.
- Server-side row model with `blockSize`: rows on a local page past the first,
  or after pinned rows, load instead of staying placeholders.
- Both server row models refetch when only a filter's AND/OR criteria or
  `caseSensitive` changes.
- Status bar and tool panel keep working after being moved in the DOM, switch
  language with the grid's `localeText`, and no longer throw when bound to a
  grid that is not upgraded yet.
- Tool panel icon buttons are announced by their localized label, dropping
  text that is not a column key onto a zone is ignored, and the first pin
  click on a column whose `pinned` is null pins it to the start.
- Starting and stopping the advanced filter, the infinite row model and the
  server-side row model in any order no longer brings back a stopped row
  model or drops an advanced filter the grid still reports.
- An advanced filter on a numeric field works while pivoting.
- A cancelled pointer or removing the grid from the page ends a range or fill
  drag without applying it, `selectRange` and Shift+Arrow drop an abandoned
  fill preview, a click in a pinned row no longer selects the body row at the
  same position, and `setState` with malformed ranges skips them instead of
  throwing.
- Picking one series color in the chart Format popover no longer turns the
  other series white, and the swatches show the drawn colors; saved configs
  with blank color slots draw the palette instead of white.
- Toggling a chart measure keeps calculated fields on the secondary axis, a
  fractional, negative or very large forecast no longer freezes the chart,
  author `apexOptions.chart.events` merge with the cross filter handler, the
  Data and Format selects follow `restore()`, and an all-numeric grid offers
  a None category.
- AI rule engine: operators are no longer read inside column names ("where
  discount > 5") or values ("Overdue", "Hanover"); range phrasing ("high to
  low", "z to a") sets the sort direction; filler words after filter stay
  out of the value; column names with hyphens, apostrophes, #, %, /, . or
  accented letters resolve; negations keep their meaning; column mentions
  match whole words and an empty header never matches; rating and progress
  columns count as numeric.
- AI analytics: an "in X" scope is found in every row, not only the first 50;
  a numeric scope binds to the column named next to it; "at least" and "most
  common" no longer change the metric; under the highest-score routing policy
  the rule engine competes with its grounded plan confidence; "it" refers to
  the columns of a previous analytics answer or LLM state change.
- Opening the formula editor on a cell and leaving it unchanged no longer
  rewrites the value, a typed literal is read by the column type (text such
  as 00123 stays text, booleans and dates keep their type), and a literal
  over a formula that a validator or a cancelled `cellValueChanging` rejects
  keeps the formula.
- Formula suggestions and the parse error paint above the following rows and
  follow scrolling, moving the caret dismisses the suggestions, the input is
  announced as a combobox, and a formula grid inside a master-detail panel no
  longer blocks clicks on the parent grid.
- The context menu of a master-detail child grid acts on that grid, a
  right-click on a pinned row targets that row's record, and pressing the
  header kebab again closes its menu (with `aria-expanded` set while open).
- `context-menu="false"` and `range-selection="false"` turn those features
  off as documented.
- The "export as csv" and "export to excel" AI prompts export from the grid,
  "page size 50 and go to page 3" keeps the new page size, AI answers skip
  blank cells and match keywords as whole words, and under a server row
  model they count only loaded rows.
- Paste and fill compute a formula's value with ranges clipped to the sheet,
  matching the value the stored formula then computes.
- XLSX export of very large grids no longer fails with an invalid string
  length error, and an invalid date is written as an empty cell.
- An open Ask AI dialog closes when its grid is removed (and stays open when
  the grid is only moved).
- Set filter: `refresh()` and a freshly mounted panel show the values the
  applied filter keeps instead of everything checked, and Date values are
  listed in date order with distinct labels.
- Chart cross-filter: clicking another category switches the filter instead
  of stacking it, clearing it keeps your own filters on that column, and
  rebinding the chart releases the old grid's filter.
- Chart heading rename: leaving it unchanged keeps the automatic title,
  Escape cancels, Tab stays in the dialog, and Enter, Space or F2 start it.
- A chart panel moved in the page keeps drawing, removing one mid-draw no
  longer reports an error, and drag-selecting or dragging the range handle no
  longer rescans the whole view per cell.
- Setting `masterDetail` back to `null` turns master-detail off: rows stop
  being expandable and the `expansion` config the grid had before is restored
  (one the app set in the meantime is left alone).
- A `getDetailData` that rejects, throws or returns a thenable is handled: no
  unhandled rejection, the detail shows empty and the data is requested again
  the next time that detail is shown.
- Master-detail no longer logs the `[apex-grid] Host display has been
  overridden` warning when a row expands.
- `::part()` rules for the group header (`group-header`, `group-label` and
  the rest), total row (`total-row-content`, `total-row-label`,
  `total-row-values`, `total-row-value`) and master-detail (`master-detail`,
  `detail-grid`) parts now apply.
- In expandable pivot mode, equal dates and all blank values (null, empty,
  missing) form one node each, and flat mode shows the localized blank label.
- A field hidden in the flat view is no longer hidden when it becomes a pivot
  row dimension.
- Pivot subtotals no longer fail with a RangeError when one row group holds
  more than about 120,000 rows.

### Performance
- Range formulas index their precedents instead of one key per cell, so a
  share of total or running total filled down no longer builds a graph that
  grows with the square of the row count, and a full recalculation signals a
  bound chart once.
- Advanced filter evaluation compiles the model once per run instead of per
  row.
- Aggregations collect count, sum, min and max in one pass per column instead
  of one reduction per function.
- Range selection stats and cell decoration no longer build a string key per
  selected cell or rebuild the display columns per rendered cell.
- Pivot views read every row once per run instead of once per value column,
  and a data assignment while pivoting requests one pipeline run instead of
  three.

## [0.7.1] - 2026-10-09

### Changed
- **ApexCharts 8 installs next to the grid without a peer conflict.** The
  optional `apexcharts` peer range is now `^5.15.0 || ^6.0.0 || ^7.0.0 || ^8.0.0`.
  No code change: the integrated charts (bar, line, area, pie, donut) all stay
  in the ApexCharts 8 default bundle.

### Fixed
- The licence text no longer describes a free Community tier, which
  ApexGrid Enterprise does not have: it is licensed from the Premium plan.
  The file is renamed `LICENSE.md` so GitHub renders it.

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
