# apex-grid-enterprise

Pro-licensed enterprise features for [`apex-grid`](https://www.npmjs.com/package/apex-grid).

`apex-grid-enterprise` extends the community grid and registers as
`<apex-grid-enterprise>`, layering enterprise-only features on top of everything
`apex-grid` already does. Use it as a drop-in replacement for `<apex-grid>`: the
configuration API, theming, and events are identical, plus the additions below.

> Requires a valid license key for production use. Without one, the grid keeps
> working but renders a watermark and logs a console notice. Set a key with
> `ApexGridEnterprise.setLicense(...)`; see [Licensing](#licensing) below.

## Enterprise features

- **[Column aggregations](#column-aggregations)**: sum / avg / min / max / count per column.
- **[Row grouping](#row-grouping)**: collapsible groups, nested to any depth, with live per-group subtotals.
- **[Pivoting](#pivoting)**: reshape rows into a cross-tab with aggregated cells.
- **[Set filter](#set-filter)**: Excel-style column value checklist with search and select-all.
- **[Columns tool panel](#columns-tool-panel)**: drag-and-drop panel for visibility, ordering, grouping, and pivot.
- **[Cell range selection & status bar](#cell-range-selection--status-bar)**: Excel-style range select with live aggregates.
- **[Excel (XLSX) export](#excel-xlsx-export)**: native-typed `.xlsx` export plus a toolbar menu entry.
- **[Master / detail grids](#master--detail-grids)**: embed a child grid in each expandable row.
- **[Integrated charts](#integrated-charts)**: render the grid's data as an ApexCharts chart.
- **[Infinite (server-side) row model](#infinite-server-side-row-model)**: stream large remote datasets, block by block.
- **[AI Toolkit](#ai-toolkit)**: natural-language grid control and read-only Q&A through a provider-agnostic adapter, with a first-class Claude reference adapter.
- **[Formulas](#formulas)**: spreadsheet-style cell formulas with relative/absolute A1 references, drag-to-fill, editor autocomplete and click-to-insert, a broad built-in function set (plus custom functions), dependency-graph recalculation, a show-formulas view, and formula-aware export.

## Install

```bash
npm install apex-grid-enterprise apex-grid lit igniteui-webcomponents
```

`apex-grid`, `lit`, and `igniteui-webcomponents` are peer dependencies shared
with the community package: install a single copy of each.

[`apexcharts`](https://www.npmjs.com/package/apexcharts) is an **optional** peer
dependency, used only by the integrated charts (`renderChart()`). It is loaded
through a dynamic `import()`, so a grid that never charts neither bundles nor
downloads it. Install it only when you chart:

```bash
npm install apexcharts
```

## Usage

```ts
import 'apex-grid-enterprise/define'; // registers the enterprise element set
```

`/define` is the batteries-included entry: it opts the grid into **every**
built-in feature module and registers the grid plus its companion elements
(`<apex-grid-enterprise>`, `<apex-grid-tool-panel>`, `<apex-grid-status-bar>`,
`<apex-grid-set-filter>`). The configuration API is identical to `apex-grid`;
see the [`apex-grid` README](https://www.npmjs.com/package/apex-grid) for column
configuration, theming, and events.

### Composing only the features you use

Importing from the package root wires in **no** feature modules by default, so
each one is tree-shaken unless you opt into it via `ApexGridEnterprise.use()`.
Call it once at startup, before registering the element:

```ts
import { ApexGridEnterprise, pivotModule, rangeSelectionModule } from 'apex-grid-enterprise';

ApexGridEnterprise.use(pivotModule, rangeSelectionModule); // only these are bundled + wired
ApexGridEnterprise.register();
```

Available modules: `aggregationModule`, `groupingModule`, `pivotModule`,
`rangeSelectionModule`. The `enterpriseModules` array is the full set (it is what
`/define` passes to `use()`). Modules a grid is not opted into add nothing to
your bundle.

---

## Column aggregations

Request sum / avg / min / max / count per column via the `aggregations` property,
then read the computed values with `getAggregations()`:

```ts
grid.aggregations = { price: ['sum', 'avg'], sold: ['sum', 'max'] };

const totals = grid.getAggregations();
// → { price: { sum: 657.92, avg: 109.65 }, sold: { sum: 347, max: 91 } }
```

`AggregationConfig` is `Record<string, AggregationFn[]>`, where `AggregationFn` is
`'sum' | 'avg' | 'min' | 'max' | 'count'`. Non-numeric values are ignored. The
same engine powers group subtotals and pivot cells, so numbers are computed
consistently everywhere.

## Row grouping

Group rows by one or more columns. Group headers render full-width with a chevron
toggle, a leaf count, and inline subtotals. Aggregates are computed over the
**filtered** leaves, so they track what is on screen.

```ts
grid.groupBy = ['region', 'department'];          // ordered; [] = no grouping
grid.aggregations = { salary: ['sum', 'avg'] };   // shown on each group header
grid.groupingOptions = { defaultExpanded: true }; // true | false | depth number

grid.expandAllGroups();
grid.collapseAllGroups();
grid.expandGroup('/EMEA/Engineering');            // stable path key
grid.getGroups();                                 // GroupRowMeta<T>[]
```

Cancellable `groupExpanding` and follow-up `groupExpanded` events fire on toggle.

## Pivoting

Reshape data into a cross-tab: pick the row dimension(s), the column to pivot on,
and the measures aggregated into each cell. Pivot columns are generated from the
data and recompute on filter. Pivoting and `groupBy` are mutually exclusive
(pivot wins).

```ts
grid.pivotRows = ['region'];            // down the left
grid.pivotOn = 'department';            // its distinct values become columns
grid.pivotValues = { salary: ['sum'] }; // measure(s) per cell (AggregationConfig)

grid.pivotOn = '';                      // disable, restoring the original columns
```

`grid.isPivoting` reflects whether a pivot view is currently active.

## Set filter

An Excel-style value checklist for a column. A standalone companion element wired
to the grid; every toggle applies immediately and composes with the grid's other
filters.

```html
<apex-grid-set-filter id="filter" column="department"></apex-grid-set-filter>
```

```ts
filter.grid = grid;                 // required
await filter.updateComplete;
filter.setSelectedTokens(['Engineering', 'Marketing']);

filter.selectAll();                 // select all values (clears the column filter)
filter.clearAll();                  // deselect all (hides every row)
filter.refresh();                   // re-read distinct values after data changes
filter.distinctValues;              // ReadonlyArray<{ token, value, label }>
filter.selectedTokens;              // string[]
```

The panel includes a search box, a `(Select all)` row, and folds empty values
(`null` / `undefined` / `''`) into a single entry. CSS parts are exposed for
styling.

## Columns tool panel

A drag-and-drop side panel that turns the advanced features into a no-code
surface: toggle column visibility, pin, reorder, and search; drag fields into
**Row Groups** / **Values** to group and aggregate; flip **Pivot mode** to drive
pivot rows, values, and column labels. Wire it to a grid and it drives the grid's
public properties directly.

```html
<apex-grid-tool-panel id="panel"></apex-grid-tool-panel>
```

```ts
document.getElementById('panel').grid = grid; // the only wiring needed
```

## Cell range selection & status bar

Excel-style cell range selection is on by default; pair it with the status bar
companion element to show live aggregates (count / sum / avg / min / max) over
the current selection.

```html
<apex-grid-status-bar id="status"></apex-grid-status-bar>
```

```ts
status.grid = grid;

grid.rangeSelection = true;         // default; HTML attribute: range-selection
grid.selectRange(/* start, end */); // programmatic selection
// the grid emits 'apex-range-changed' with the current selection stats
```

## Excel (XLSX) export

Export to a real `.xlsx` file where numbers, booleans, and `Date` values keep
their native Excel cell types. Adds an "Export XLSX" entry to the toolbar's
export menu, alongside the community grid's CSV (CSV export stays free).

```ts
const bytes = grid.exportToXLSX({ filename: 'users', sheetName: 'Users' });
// options: { filename?, sheetName?, source?, columns? }, returns Uint8Array
```

## Master / detail grids

Give each expandable row its own embedded child grid. Provide the child columns
and a (sync or async) data getter; detail grids are cached per row.

```ts
grid.masterDetail = {
  columns: [{ key: 'sku' }, { key: 'qty' }],       // or a (row) => columns fn
  getDetailData: (row) => fetchOrderLines(row.id),  // T[] | Promise<T[]>
  detailHeight: 240,                                // optional
};

grid.refreshDetail(row); // drop a row's cached detail grid to force a reload
```

## Integrated charts

Render the grid's current data as an ApexCharts chart. ApexCharts is dynamically
imported, so it only loads when a chart is actually drawn.

The chart model is derived by intent: a selected **cell range** wins, otherwise the
**grouping/pivot view**. Friendly chart types (`column`, `bar`, `line`, `area`,
`pie`, `donut`, `scatter`, `radar`, `heatmap`, `combo`, or `'auto'`) map to the
right ApexCharts shape.

```ts
const model = grid.getRangeChartModel();     // from the active cell selection
// or grid.getViewChartModel()               // from grouping / pivot only
// or grid.getChartModel()                   // selection if present, else view

const chart = grid.createRangeChart(container, {
  type: 'column',
  apexOptions: { /* deep-merged escape hatch */ },
});
```

### `<apex-grid-chart>` panel

A built-in chart panel with a type gallery that **live-redraws** as the selection or
view changes. Set its `grid` property; choose `mode="inline"` (embedded) or
`mode="dialog"` (a floating, draggable panel, the default). It renders in light DOM
(ApexCharts cannot render inside a shadow root).

```html
<apex-grid-chart mode="inline"></apex-grid-chart>
```

```ts
chart.grid = grid;
chart.source = 'selection'; // 'auto' (default) | 'selection' | 'view'
chart.type = 'column';      // gallery-switchable; 'auto' uses the recommended type
chart.theme = 'grid';       // 'grid' (sync palette to grid theme) | 'light' | 'dark'
```

The enterprise grid also adds a **"Create chart"** toolbar button that opens the
panel in a dialog. The panel and toolbar button require `<apex-grid-chart>` to be
registered (the `/define` entry does this for you).

## Infinite (server-side) row model

Stream large remote datasets without loading every row into memory. The grid
fetches fixed-size blocks on scroll and delegates sort, filter, and quick-search
to your backend.

```ts
grid.infiniteRowModel = {
  datasource: {
    async getRows({ startRow, endRow, sortModel, filterModel, quickFilter }) {
      const { rows, total } = await fetchPage(startRow, endRow, sortModel, filterModel, quickFilter);
      return { rows, rowCount: total }; // omit rowCount for "infinite" mode
    },
  },
  blockSize: 100, // default 100
};

grid.isRowLoading(row); // true for not-yet-loaded placeholder rows (render skeletons)
grid.refreshRows();     // refetch after a server-side mutation
```

The grid emits `apex-rows-loaded` (`detail: { rowCount, exact, loadedBlocks,
blockSize }`) so you can show live load status.

## AI Toolkit

Drive the grid in natural language. A prompt becomes a schema-validated state
patch that is applied through `setState()` with a one-click undo, plus a
read-only Q&A mode. The toolkit is provider-agnostic: you wire any LLM through a
tiny adapter, and a first-class Anthropic/Claude reference adapter ships in the
box. The whole toolkit is an enterprise feature; it builds on the community
grid's `getSchema()` / `setState()` foundation.

### The adapter

An `AIAdapter` is any function from a request to a response:

```ts
type AIAdapter = (request: AIRequest) => Promise<AIResponse>;
// request:  { schema, prompt, mode: 'control' | 'ask', data?, signal? }
// response: { patch?, answer? }
```

`request.schema` is the grid's `getSchema()` descriptor (columns, capabilities,
and current state), so the adapter has everything it needs to build a prompt and
a valid patch. Assign one to the grid:

```ts
import { createClaudeAdapter } from 'apex-grid-enterprise';

grid.aiAdapter = createClaudeAdapter({ endpoint: '/api/grid-ai' });
```

### Running a prompt

```ts
const result = await grid.runPrompt('group by region, then sort by revenue, highest first');
if (result.mode === 'control') {
  console.log(result.result.applied); // e.g. ['modules', 'sort']
  console.log(result.warnings);       // anything dropped, each with a reason
  result.undo();                      // one-click revert
}

// Read-only question; the grid is not changed.
const answer = await grid.runPrompt('which region has the highest average revenue?', { mode: 'ask' });
// answer.mode === 'ask'; answer.answer is the text reply
```

`runPrompt` validates the returned patch against the schema (dropping anything
out of vocabulary, with a reported reason), applies it via the defensive
`setState()`, and returns an idempotent `undo()` that restores the prior
snapshot. Ask mode never mutates the grid.

### Claude reference adapter

`createClaudeAdapter` is the bundled Anthropic/Claude adapter, with two
transports:

```ts
// Production: your backend holds the key and calls Anthropic; the browser never sees it.
grid.aiAdapter = createClaudeAdapter({ endpoint: '/api/grid-ai' });

// Development only: call Anthropic from the browser. This exposes the key to the page.
grid.aiAdapter = createClaudeAdapter({ apiKey: '...', dangerouslyAllowBrowser: true });
```

The direct transport dynamically imports `@anthropic-ai/sdk` (an optional peer
dependency), defaults to `claude-opus-4-8` (configurable), and uses tool use so
the model returns a patch shaped by the grid's schema. The proxy transport POSTs
`{ prompt, mode, schema, data }` to your endpoint, which returns
`{ patch?, answer? }`. Prefer the proxy for production: it keeps the key on the
server. Install the SDK only when you use the direct transport:

```bash
npm install @anthropic-ai/sdk
```

### Prompt panel

`<apex-grid-ai>` is a ready-made prompt UI. Bind it to a grid and it drives
`runPrompt` for you, showing what changed (with an Undo button), or the answer in
ask mode.

```html
<apex-grid-ai mode="inline"></apex-grid-ai>
```

```ts
document.querySelector('apex-grid-ai').grid = grid;
```

`mode="inline"` renders in place; `mode="dialog"` (the default) is a floating,
draggable panel. The enterprise grid also adds an **"Ask AI"** toolbar button
that opens the panel in a dialog (the `/define` entry registers the element).

### Offline mock

`createMockAdapter` is a deterministic, no-network adapter for demos and tests.
It maps a small canned vocabulary (sort, group, filter, search, reset) to patches
and answers simple data questions, with no key required.

```ts
import { createMockAdapter } from 'apex-grid-enterprise';

grid.aiAdapter = createMockAdapter();
```

### How it stays safe

The control path is guarded in layers: the model is constrained by the grid's
schema (`toJSONSchema`), anything out of vocabulary is stripped before it is
applied (each drop reported), the defensive `setState()` drops and reports the
rest, and every change is one click undoable. Ask mode is read-only.

---

## Formulas

Spreadsheet-style formulas in a cell. Mark a column `allowFormula` (and
`editable`); a cell whose edited text starts with `=` is parsed, stored, and its
computed result becomes the cell value. Because the value stays canonical in
`row[key]`, sorting, filtering, aggregation, export, and charts all keep working
on the result.

```ts
grid.columns = [
  { key: 'qty', headerText: 'Qty', type: 'number', editable: true },
  { key: 'price', headerText: 'Price', type: 'currency', editable: true },
  { key: 'total', headerText: 'Total', type: 'currency', editable: true, allowFormula: true },
];

// Type "=B1*C1" into a Total cell, or set it programmatically:
grid.setFormula(grid.data[0], 'total', '=B1*C1');
grid.getFormula(grid.data[0], 'total'); // '=B1*C1'
grid.clearFormula(grid.data[0], 'total');
grid.recalculateFormulas();
```

### References (A1 over the data)

Columns map to letters by configuration order (`A` is the first column,
including hidden ones); rows are 1-based over the source `data`. So `B2` is the
second data row, second column. References bind to the data, not the rendered
view, so a formula keeps its meaning across sort, filter, column reorder, and
paging. Ranges (`A1:B3`) expand to value lists for functions.

References are **relative** by default; a `$` fixes an axis (`$A$1` fixes both,
`$A1` the column only, `A$1` the row only). Relative references shift when a
formula is filled or pasted to another cell; absolute axes stay put. A reference
always resolves to a concrete cell, so recalculation itself is unaffected by
relative-ness.

Identity: formula attachment is durable when you set a grid `rowId` (it survives
reload through `getState` / `setState`); without one it is positional.

### Authoring

While editing a formula (after typing `=`):

- **Autocomplete**: typing a function name shows a suggestion list (built-ins +
  your custom functions). Up/Down to move, Enter/Tab or click to accept (inserts
  `NAME()` with the caret between the parentheses), Escape to dismiss.
- **Click-to-insert**: click any grid cell to insert its reference at the caret;
  Shift-click inserts an absolute `$A$1`.

**Drag-to-fill and paste** rewrite a formula's relative references by the
row/column delta to the new cell (absolute `$` axes are preserved):

```ts
// Drag the fill handle, or do it in code: copy total[0]'s formula down.
grid.selectRange({ row: 0, column: 'total' });
grid.fillTo({ row: 4, column: 'total' }); // =B1*C1 becomes =B2*C2, =B3*C3, ...
```

Copying a range and pasting it back inside the same grid re-offsets the source
formulas (a plain-text clipboard cannot carry formulas, so cross-app paste stays
literal).

### Functions

Built in:

- Math: `SUM`, `AVERAGE` (alias `AVG`), `MIN`, `MAX`, `COUNT`, `COUNTA`, `ROUND`,
  `ROUNDUP`, `ROUNDDOWN`, `ABS`, `MOD`, `POWER`, `SQRT`, `INT`, `SIGN`.
- Logical: `IF`, `AND`, `OR`, `NOT`.
- Text: `CONCAT` (alias `CONCATENATE`), `LEN`, `LEFT`, `RIGHT`, `MID`, `TRIM`,
  `UPPER`, `LOWER`.

Operators: `+ - * / ^ %`, comparisons `= <> < > <= >=`, and text concatenation
with `&`. `IF` short-circuits, so `IF(B1=0, 0, A1/B1)` is safe. Register your own:

```ts
grid.registerFormulaFunction('TAX', (args) =>
  typeof args[0] === 'number' ? args[0] * 0.2 : 0
);
// =TAX(B1)
```

### Error values

Errors are first-class cell values that render as their code and are excluded
from numeric aggregates: `#REF!` (bad reference), `#NAME?` (unknown function),
`#DIV/0!`, `#VALUE!` (type error), and `#CYCLE!` (circular reference). An error
operand propagates.

### Recalculation and persistence

Editing any referenced cell recomputes its dependents in dependency order (a
real dependency graph with cycle detection, not a full sweep); undo or redo of a
value edit recomputes too. Formulas serialize under `modules.enterprise.formulas`
in `getState()` and restore (and recompute) on `setState()`.

### Show formulas

Set `showFormulas` (the `show-formulas` attribute or the property) to display
each `allowFormula` cell's source instead of its computed value, the spreadsheet
"show formulas" view. The computed values are untouched, so turning it off
restores the normal display; a user-provided `cellTemplate` is never overridden.

```ts
grid.showFormulas = true; // reveal sources; set back to false to restore
```

### Export formulas

`exportToCSV` and `exportToXLSX` accept a `formulas` option: when set, cells that
hold a formula export their source (`=A1*B1`) rather than the computed value;
other cells export normally.

```ts
grid.exportToCSV({ filename: 'budget', formulas: true });
grid.exportToXLSX({ filename: 'budget', formulas: true });
```

### Deferred

Range+criteria functions (`SUMIF` / `COUNTIF` / `AVERAGEIF`) need a different
argument-grouping convention and are deferred to a later tier, along with array
formulas and cross-sheet references.

---

## Licensing

Licensing is offline and non-hostile: without a valid key the grid keeps working
but renders a watermark and logs a console notice, with no network calls and no
hard blocking. Set the key once (globally) before or after the grid renders:

```ts
import { ApexGridEnterprise } from 'apex-grid-enterprise';

ApexGridEnterprise.setLicense('APEX-…'); // removes the watermark on all instances
```

`LicenseManager` (re-exported from `apex-commons`) is also available for advanced
use, but `setLicense` is the supported entry point.

## See also

- [`apex-grid`](https://www.npmjs.com/package/apex-grid): the community grid with
  column configuration, virtualization, sorting, filtering, pagination, pinning,
  reordering, resizing, inline editing, selection, tree data, CSV export, theming,
  and accessibility.
