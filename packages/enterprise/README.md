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
