# Apex Grid

[![Node.js CI](https://github.com/apexcharts/apex-grid/actions/workflows/node.js.yml/badge.svg?branch=main)](https://github.com/apexcharts/apex-grid/actions/workflows/node.js.yml)
[![Coverage Status](https://coveralls.io/repos/github/apexcharts/apex-grid/badge.svg?branch=main)](https://coveralls.io/github/apexcharts/apex-grid?branch=main)
[![npm](https://img.shields.io/npm/v/apex-grid.svg)](https://www.npmjs.com/package/apex-grid)

A Lit-based, framework-agnostic web component data grid. Ships as a single custom element `<apex-grid>` with a rich, opt-in feature set and full TypeScript types.

## Features

- **Row virtualization** via `@lit-labs/virtualizer`: only ~20 rows in the DOM at any time, regardless of dataset size.
- **Sorting**: single or multi-column, tri-state (asc / desc / none), per-column comparers.
- **Filtering**: per-column filter chips with string / number / boolean / date operands, plus a quick-filter (global search) input.
- **Pagination**: local slicing or remote mode with a `pageChanging` / `pageChanged` event pair; built-in `<apex-grid-paginator>`.
- **Column pinning**: pin to start or end; visual reordering only, source `columns` array is preserved.
- **Column reordering**: drag-and-drop with per-column opt-out, constrained to the column's pinning group.
- **Column resizing**: pointer-driven, with a min-width safeguard.
- **Column groups**: spanning multi-level headers over a flat `columns` array, respecting pin regions.
- **Inline editing**: cell or row mode, click or double-click trigger, per-column opt-in.
- **Cell validation**: declarative per-column `validators` (built-ins plus custom), surfaced with `aria-invalid` and an event.
- **Undo / redo**: opt-in history for cell edits, with keyboard shortcuts (Ctrl/Cmd+Z, etc.).
- **Row selection**: single or multiple, optional checkbox column, full programmatic API.
- **Row pinning**: sticky top / bottom bands rendered outside the virtualizer.
- **Row drag-reorder**: pointer and keyboard reordering with a manual order, mutually exclusive with sorting.
- **Row expansion (master-detail)**: opt-in chevron column with a `detailTemplate`.
- **Tree data (nested rows)**: `getDataPath` pattern over a flat array.
- **State & persistence**: `getState()` / `setState()` snapshot round-trip, a `stateChanged` event, and a `getSchema()` capability descriptor.
- **Localization (i18n)**: override any built-in string via `localeText`; bundled dictionaries (e.g. `esLocale`).
- **CSV export**: programmatic method plus an optional toolbar dropdown. (Excel/XLSX export is in `apex-grid-enterprise`.)
- **Toolbar**: opt-in `<apex-grid-toolbar>` with debounced quick filter and export menu.
- **Templating**: slot-based templates for cells, headers, editors, and detail panels.
- **Theming**: styled out-of-the-box; fully customizable through `--ag-*` CSS custom properties (no theme import or build step). Auto-matches an `igniteui-webcomponents` host app when one is present.
- **Accessibility**: WCAG 2.2 AA semantics (`role="grid"` / `role="treegrid"`, `aria-rowcount`, `aria-colcount`, focus + keyboard navigation).
- **Provenance-signed npm releases** with OIDC trusted publishing.

---

## Quick Start

### One-call setup

```ts
import { setup } from 'apex-grid';

setup();
```

That single call registers `<apex-grid>` and adopts a default host stylesheet (`height: 100%; min-height: 240px`). The grid is styled out-of-the-box; no theme CSS import is required.

### Render the grid

```ts
import { html, render } from 'lit';
import 'apex-grid/define';
import type { ColumnConfiguration } from 'apex-grid';

type User = { id: number; name: string; age: number; subscribed: boolean };

const data: User[] = [
  { id: 1, name: 'Ada Lovelace', age: 36, subscribed: true },
  { id: 2, name: 'Carl Sagan',   age: 62, subscribed: false },
  { id: 3, name: 'Grace Hopper', age: 85, subscribed: true },
];

const columns: ColumnConfiguration<User>[] = [
  { key: 'id',         type: 'number',  headerText: 'ID',         width: '80px',  sort: true, filter: true },
  { key: 'name',       type: 'string',  headerText: 'Name',       width: '240px', sort: true, filter: true },
  { key: 'age',        type: 'number',  headerText: 'Age',        width: '100px', sort: true, filter: true },
  { key: 'subscribed', type: 'boolean', headerText: 'Subscribed', width: '140px', sort: true, filter: true },
];

render(
  html`<apex-grid .data=${data} .columns=${columns}></apex-grid>`,
  document.getElementById('app')!,
);
```

```html
<style>
  apex-grid { height: 480px; }
</style>
<div id="app"></div>
```

---

## Manual setup (four steps)

If you'd rather not use `setup()`, this is what it does under the hood. Skipping any step produces a grid that "runs" but renders broken (no borders, no filter UI, or only a few collapsed rows).

### 1. Install

```bash
npm install apex-grid lit
```

`igniteui-webcomponents` ships as a transitive dependency; no separate install.

### 2. Register the custom element

```ts
import 'apex-grid/define';
```

Equivalent long form:

```ts
import { ApexGrid } from 'apex-grid';
ApexGrid.register();
```

Without this, `<apex-grid>` is an inert unknown element.

### 3. (Optional) Customize the look

The grid is styled out-of-the-box; there is no theme to import. Customize it by overriding the `--ag-*` CSS custom properties on `apex-grid` (or any ancestor); a one-line brand override cascades to every tint:

```css
apex-grid {
  --ag-brand: #7c3aed;        /* selection, focus, accents */
  --ag-brand-strong: #6d28d9; /* hover / pressed */
  --ag-radius: 12px;          /* outer card radius */
  --ag-row-h: 40px;           /* row height */
}
```

See [`src/styles/_tokens.scss`](src/styles/_tokens.scss) for the full token list (brand, surfaces, text, semantic state colors, typography, spacing, motion).

**Grid edge / shadow.** By default the grid shows a flat 1px hairline edge (no drop shadow). Control it with the `--ag-grid-shadow` hook, an opt-in override that is not one of the `_tokens.scss` defaults:

```css
apex-grid { --ag-grid-shadow: var(--ag-shadow-card); } /* elevated floating-card look */
apex-grid { --ag-grid-shadow: none; }                  /* remove the edge entirely */
```

If you embed the grid alongside `igniteui-webcomponents`, the brand tokens automatically re-tint from the igniteui palette (`--ig-primary-500`); no configuration needed.

### 4. Size the host

`@lit-labs/virtualizer` requires a **bounded height**. Without one, the virtualizer collapses to its natural content height (~150px) and only a few rows ever render.

```css
apex-grid {
  height: 480px;   /* any explicit pixel height; % works if the parent has a height */
}
```

> [!TIP]
> `import 'apex-grid/styles.css'` ships a default rule that sets `height: 100%` with a `min-height: 240px` fallback.

> [!IMPORTANT]
> **Do not set `display` on `<apex-grid>`.** The component declares `:host { display: grid }` internally for its track layout (header / filter / body). Any consumer rule that sets `display` (including `block`, `flex`, `inline-block`) collapses the grid. If you accidentally do this, the grid emits a one-shot `console.warn` at startup pointing here.

### What success looks like

With the element registered and the host sized, you should see:

- **Visible borders** between rows and columns.
- **Sort arrows** (↕) next to each header when `sort: true`.
- A **filter row** below the headers with a "Filter" chip per column when `filter: true`.
- **Hover state** on rows.
- **Smooth scrolling**: DevTools shows only ~20 `<apex-grid-row>` elements at any time.

### Troubleshooting

| What you see | Likely cause |
|---|---|
| Want a different look / brand color | Step 3: override the `--ag-*` CSS variables |
| Only ~3 rows visible regardless of data size | Step 4: no bounded height, **or** consumer CSS sets `display` on `<apex-grid>` (check console for the warning) |
| `<apex-grid>` blank tag in DOM | Step 2: element not registered |
| Columns shown as literal `[object Object]` | `columns=` used as an attribute; must be a **property** (`.columns=${...}` in Lit, `[columns]=` in Angular, `:columns.prop=` in Vue, `el.columns = ...` in vanilla JS) |

---

## Features in depth

Each feature below is fully opt-in: you only pay for what you turn on. Snippets assume `const grid = document.querySelector('apex-grid')!`.

### Sorting

```ts
const columns = [
  { key: 'name', sort: true },                            // UI sort + tri-state
  { key: 'age',  sort: { direction: 'desc' } },           // initial state
];

grid.sortConfiguration = { multiple: true, triState: true };
grid.sort({ key: 'age', direction: 'asc' });
grid.clearSort();                                          // or grid.clearSort('age')
```

When `multiple` is enabled, a plain header click sorts by that column alone; hold Ctrl/Cmd and click to append additional columns as lower-priority sort keys. Events: `sorting` (cancellable), `sorted`.

### Filtering

```ts
const columns = [
  { key: 'name', filter: true },                          // UI filter chip
  { key: 'age',  filter: true, type: 'number' },          // operands by type
];

import { StringOperands } from 'apex-grid';
grid.filter({ key: 'name', condition: StringOperands.contains, searchTerm: 'Ada' });
grid.clearFilter();
```

Operand classes: `StringOperands`, `NumberOperands`, `BooleanOperands`. Events: `filtering` (cancellable), `filtered`.

### Quick filter (global search)

```ts
grid.showQuickFilter = true;       // renders the toolbar input
grid.quickFilter = 'ada';          // or: await grid.setQuickFilter('ada')
```

Custom matcher via `dataPipelineConfiguration.quickFilter`. Events: `quickFilterChanging` (cancellable), `quickFilterChanged`. Attribute: `show-quick-filter`, `quick-filter`.

### Pagination

```ts
grid.pagination = {
  enabled: true,
  pageSize: 25,
  pageSizeOptions: [10, 25, 50, 100],
};

await grid.gotoPage(2);
await grid.setPageSize(50);
grid.nextPage(); grid.previousPage(); grid.firstPage(); grid.lastPage();
```

Remote mode:

```ts
grid.pagination = { enabled: true, mode: 'remote', pageSize: 25, totalItems: 1280 };
grid.addEventListener('pageChanged', async (e) => {
  grid.data = await fetchPage(e.detail.page, e.detail.pageSize);
});
```

Properties: `page`, `pageSize`, `pageCount`, `totalItems`, `pageItems`. Events: `pageChanging` (cancellable), `pageChanged`.

### Column pinning

```ts
const columns = [
  { key: 'id',   pinned: 'start' },
  { key: 'name' },
  { key: 'actions', pinned: 'end' },
];

await grid.pinColumn('name', 'start');
await grid.unpinColumn('name');                 // or pinColumn('name', null)
```

The source `columns` array is **not** reordered; only the visual render order changes. Read `grid.displayColumns` for the render order. Events: `columnPinning` (cancellable), `columnPinned`.

### Column reordering

```html
<apex-grid column-reordering></apex-grid>
```

Or programmatic:

```ts
await grid.moveColumn('email', 'name', 'after');
```

Per-column opt-out: `{ key: 'id', reorderable: false }`. Reordering is constrained to the column's own pinning group (start / unpinned / end). Events: `columnMoving` (cancellable), `columnMoved`. Attribute: `column-reordering`.

### Column groups (spanning headers)

```ts
const columns = [
  { key: 'first', group: 'name' },
  { key: 'last',  group: 'name' },
  { key: 'city',  group: 'address' },
  { key: 'zip',   group: 'address' },
];
grid.columnGroups = [
  { id: 'name',    headerText: 'Name' },
  { id: 'address', headerText: 'Address' },
];
```

A spanning header row renders above the column headers. `columns` stays flat, so width / pinning / resize / reorder are unaffected; membership is by reference (`column.group` points at a `columnGroups` entry). A group's members must be contiguous within one pin region (non-contiguous groups warn and skip the spanning cell); ungrouped columns get a blank spacer. Member reordering is confined to its group.

### Inline editing

```ts
const columns = [
  { key: 'name', editable: true },
  { key: 'age',  editable: true, type: 'number' },
];

grid.editing = { enabled: true, mode: 'cell', trigger: 'doubleClick' };

await grid.editCell(0, 'name');
await grid.commitEdit();
grid.cancelEdit();
```

`mode: 'row'` puts all editable cells in the row into edit together. Properties: `editingCell`, `editingRow`. Events: `cellValueChanging` (cancellable), `cellValueChanged`, plus `rowEditStarted` / `rowEditEnded` in row mode.

### Cell validation

```ts
import { required, min, max, pattern, custom } from 'apex-grid';

const columns = [
  { key: 'name',  editable: true, validators: [required('Name is required')] },
  { key: 'age',   editable: true, type: 'number', validators: [min(18), max(99)] },
  { key: 'email', editable: true, validators: [pattern(/^[^@\s]+@[^@\s]+$/, 'Invalid email')] },
];
```

Validators run inside the commit path, before the cancellable `cellValueChanging` gate. A failure keeps the editor open, marks the cell (`aria-invalid` + an error message node), and fires `cellValidationFailed { key, rowIndex, data, value, errors }`. Built-ins: `required`, `min`, `max`, `pattern`, `custom`, or any `(value, ctx) => string | null`. In row mode all pending cells are validated atomically (no partial write); enterprise paste / fill validate per cell.

### Undo / redo

```ts
grid.editing = { enabled: true, mode: 'cell', history: { enabled: true } };

grid.undo();          // or Ctrl/Cmd+Z
grid.redo();          // or Ctrl/Cmd+Shift+Z / Ctrl+Y
grid.clearHistory();
grid.canUndo; grid.canRedo;
```

Opt in via `editing.history`. Every committed cell edit is recorded (single, row-mode, and enterprise paste / fill collapse to one step). Keyboard shortcuts work while the grid body has focus, so an open editor's native undo is untouched. The stack holds 100 commands by default (`history: { enabled: true, stackSize: 200 }`). Event: `historyChanged { canUndo, canRedo }`.

### Row selection

```ts
grid.selection = { enabled: true, mode: 'multiple', showCheckboxColumn: true };

await grid.selectRow(data[0]);
await grid.toggleRowSelection(data[1]);
await grid.selectAllRows();
await grid.clearSelection();
grid.selectedRows;                  // snapshot
grid.selectedRows = [data[2]];      // replace selection (goes through `rowSelecting`)
```

Events: `rowSelecting` (cancellable), `rowSelected`.

### Row pinning (top / bottom)

```ts
grid.rowPinning = { enabled: true };

grid.pinRow(data[0], 'top');
grid.pinRow(data[5], 'bottom');
grid.unpinRow(data[0]);
grid.pinnedRows;                    // { top: T[], bottom: T[] }
```

Pinned rows render in sticky top / bottom bands outside the virtualizer and are lifted out of the scrollable set (no duplication). Selection and styling work by row reference. Events: `rowPinning` (cancellable), `rowPinned`.

### Row drag-reorder

```ts
grid.rowReordering = { enabled: true };   // add applyToData: true to splice grid.data in place

grid.moveRow(0, 4, 'after');
```

Drag any row, or use the keyboard: focus a row, **Space** to grab, **Arrow** keys to move, **Space / Enter** to drop, **Esc** to cancel. The grid holds a manual order that is mutually exclusive with sorting (applying a sort clears it). By default the app persists the order via the `rowMoved` event; set `applyToData: true` to splice `grid.data` directly. Events: `rowMoving` (cancellable), `rowMoved { from, to, data }`.

### Row expansion (master-detail)

```ts
grid.expansion = {
  enabled: true,
  detailTemplate: ({ data }) => html`<order-summary .order=${data}></order-summary>`,
  isExpandable: (row) => row.hasDetails,
};

await grid.expandRow(data[0]);
await grid.toggleRowExpansion(data[0]);
await grid.expandAllRows();
await grid.collapseAllRows();
grid.expandedRows;                  // snapshot
```

Events: `rowExpanding` (cancellable), `rowExpanded`.

### Tree data (nested rows)

The data array stays **flat**. The grid derives the hierarchy from a `getDataPath(row)` callback that returns the path from root to that row, the flat-array "tree data" pattern.

```ts
type Person = { id: number; name: string; title: string; path: string[] };

const data: Person[] = [
  { id: 1, name: 'Adrian',  title: 'CEO',     path: ['Adrian'] },
  { id: 2, name: 'Bryan',   title: 'VP Eng',  path: ['Adrian', 'Bryan'] },
  { id: 3, name: 'Cara',    title: 'Manager', path: ['Adrian', 'Bryan', 'Cara'] },
];

grid.tree = {
  enabled: true,
  getDataPath: (row) => row.path,
  defaultExpanded: 1,              // boolean | number, depth to expand
  groupColumnKey: 'name',          // which column shows the chevron + indent
  childIndent: 20,                 // px per depth level
};

await grid.toggleTreeRow(data[0]);
await grid.expandAllTreeRows();
```

Methods: `toggleTreeRow`, `expandTreeRow`, `collapseTreeRow`, `expandAllTreeRows`, `collapseAllTreeRows`, `isTreeRowExpanded`. Events: `treeRowExpanding` (cancellable), `treeRowExpanded`. When tree mode is active, the host element advertises `role="treegrid"`.

### CSV export

Programmatic:

```ts
grid.exportToCSV();                                            // downloads data.csv
grid.exportToCSV({ filename: 'users', source: 'selected' });
const text = grid.exportToCSV({ filename: '' });               // no download, returns the string
```

`source` can be `'view'` (default, post-filter/post-sort), `'page'`, `'selected'`, or `'all'`. Per-column opt-out: `{ key: 'secret', exportable: false }`.

> **XLSX (Excel) export** moved to [`apex-grid-enterprise`](https://www.npmjs.com/package/apex-grid-enterprise) in v3. `<apex-grid-enterprise>` adds `grid.exportToXLSX(...)` and an "Export XLSX" entry to this same toolbar menu. CSV stays free.

Toolbar dropdown:

```html
<apex-grid show-export></apex-grid>
```

Renders a download icon in the toolbar's trailing actions area; the menu has an "Export CSV" entry (the enterprise grid adds "Export XLSX"). Toolbar `exportFilename` overrides the default `data` filename. Attribute: `show-export`.

### Toolbar

Rendered automatically above the header row when at least one of `show-quick-filter` or `show-export` is on. CSS parts:

| Part | What |
|---|---|
| `toolbar` | Root container |
| `toolbar-search` | Quick-filter input wrapper |
| `search-field` | The bordered input field |
| `search-icon`, `search-input` | Leading icon, input element |
| `toolbar-actions` | Trailing actions area |
| `export-trigger` | Export menu button |
| `export-menu` | Dropdown panel |
| `export-menu-item` | Menu item |

Search input has a `debounce` attribute (default `200`ms).

### Theming

The grid styles itself through `--ag-*` CSS custom properties; override them on `apex-grid` (or any ancestor) to rebrand; see [`src/styles/_tokens.scss`](src/styles/_tokens.scss) for the full list. When `igniteui-webcomponents` is present, the brand tokens auto-tint from its palette.

Style with CSS parts on the grid, paginator, and toolbar:

```css
apex-grid::part(paginator) { background: var(--surface-2); }
apex-grid-toolbar::part(search-input) { font-family: var(--font-mono); }
```

### State & persistence

`getState()` returns a JSON-safe snapshot of the grid's restorable view and `setState()` applies one back. The snapshot covers column layout (order, width, pinning, visibility), sort, filter, quick filter, pagination, selection, expansion, tree expansion, pinned rows, the manual drag-reorder order, and any feature-module state (enterprise grouping / pivot / aggregation / ranges). Functions and templates are never serialized: sort comparers, filter condition functions, and cell/header/editor templates re-bind from the live `columns` config on restore (filter conditions are captured by operand name).

```js
// Save and restore a view.
localStorage.setItem('view', JSON.stringify(grid.getState()));
grid.setState(JSON.parse(localStorage.getItem('view')));

// Persist automatically: stateChanged fires (debounced) after every settled
// change, and only while something is listening.
grid.addEventListener('stateChanged', (e) =>
  localStorage.setItem('view', JSON.stringify(e.detail.state))
);
```

**Row identity.** Selection, expansion, pinned rows, and the manual order are captured as row references. Set `grid.rowId = (row) => row.id` for durable references that survive a data reload; without it, rows are referenced by position (index), which round-trips within a session but not across a reload.

**`setState` is defensive.** It is meant to accept persisted-and-possibly-stale blobs and AI output, so it never throws on bad input (unless you pass `{ strict: true }`): unknown columns / operands are dropped, out-of-range pages clamped, unresolvable rows skipped, and a wrong snapshot `version` applied best-effort. It returns a `SetStateResult` (`{ applied, skipped, warnings }`) so you can see exactly what happened. `setState` is partial: pass only the slices you want to change.

**`getSchema()`** returns a machine-readable description of the grid (columns + data types, available sort directions and filter operands per column, grid-level capabilities) with the current state embedded. It is the contract an AI layer feeds an LLM and validates a patch against, but it equally drives a view-editor UI or documentation.

See [`demo/state-persistence.html`](../../demo/state-persistence.html) for a save / restore / live-snapshot example.

---

## API Reference

### Properties

| Property | Type | Default | Notes |
|---|---|---|---|
| `data` | `T[]` | `[]` | Source records (property only) |
| `columns` | `ColumnConfiguration<T>[]` | `[]` | Column configuration (property only) |
| `autoGenerate` | `boolean` | `false` | Infer columns from `data[0]` keys. Attr `auto-generate` |
| `sortConfiguration` | `GridSortConfiguration` | `{ multiple, triState }` | |
| `dataPipelineConfiguration` | `DataPipelineConfiguration<T>` |  | Custom sort/filter/pagination hooks |
| `pagination` | `PaginationConfiguration` |  | |
| `quickFilter` | `string` | `''` | Attr `quick-filter` |
| `showQuickFilter` | `boolean` | `false` | Attr `show-quick-filter` |
| `showExport` | `boolean` | `false` | Attr `show-export` |
| `columnReordering` | `boolean` | `false` | Attr `column-reordering` |
| `columnGroups` | `ColumnGroupConfiguration[]` |  | Spanning header groups (`column.group` references an `id`) |
| `editing` | `GridEditingConfiguration` |  | Includes `history` for undo/redo; per-column `validators` |
| `selection` | `GridSelectionConfiguration` |  | |
| `expansion` | `GridExpansionConfiguration<T>` |  | |
| `tree` | `GridTreeConfiguration<T>` |  | |
| `rowPinning` | `GridRowPinningConfiguration` |  | `{ enabled }` |
| `rowReordering` | `GridRowReorderingConfiguration` |  | `{ enabled, applyToData? }` |
| `rowId` | `(row: T) => string \| number` |  | Durable row identity for `getState` / `setState` |
| `localeText` | `GridLocaleText` |  | Override map for built-in strings (e.g. `esLocale`) |
| `canUndo`, `canRedo` | `boolean` |  | Get (history) |
| `sortExpressions` | `SortExpression<T>[]` |  | Get/set |
| `filterExpressions` | `FilterExpression<T>[]` |  | Get/set |
| `selectedRows` | `T[]` |  | Get/set |
| `expandedRows` | `T[]` |  | Get/set |
| `page`, `pageSize`, `pageCount`, `totalItems` | `number` |  | |
| `pageItems` | `readonly T[]` |  | Currently rendered slice |
| `dataView` | `readonly T[]` |  | Post-filter, post-sort |
| `displayColumns` | `readonly ColumnConfiguration<T>[]` |  | Render order (pinned start → unpinned → pinned end) |
| `editingCell` | `{ rowIndex, columnKey } \| null` |  | |
| `editingRow` | `number \| null` |  | Row-mode only |

### Methods

```ts
sort(expr): void
filter(expr): void
clearSort(key?): void
clearFilter(key?): void
setQuickFilter(value): Promise<boolean>

getColumn(keyOrIndex): ColumnConfiguration<T> | undefined
updateColumns(columns): void
pinColumn(key, 'start' | 'end' | null): Promise<boolean>
unpinColumn(key): Promise<boolean>
moveColumn(fromKey, toKey, 'before' | 'after'): Promise<boolean>

gotoPage(page): Promise<boolean>
setPageSize(size): Promise<boolean>
nextPage(); previousPage(); firstPage(); lastPage()

editCell(rowIndex, columnKey): Promise<boolean>
editRow(rowIndex): Promise<boolean>
commitEdit(): Promise<boolean>
cancelEdit(): void

selectRow(row); deselectRow(row); toggleRowSelection(row)
selectAllRows(); clearSelection(); isRowSelected(row)

expandRow(row); collapseRow(row); toggleRowExpansion(row)
expandAllRows(); collapseAllRows(); isRowExpanded(row)

toggleTreeRow(row); expandTreeRow(row); collapseTreeRow(row)
expandAllTreeRows(); collapseAllTreeRows(); isTreeRowExpanded(row)

pinRow(row, 'top' | 'bottom'); unpinRow(row)   // pinnedRows getter
moveRow(from, to, 'before' | 'after')

undo(); redo(); clearHistory()                 // canUndo / canRedo getters

localize(key, params?, fallback?): string      // resolve a locale string

exportToCSV(options?): string
exportAs(formatId, options?): void   // toolbar dispatch; 'csv' (community), 'xlsx' (enterprise)

getState(options?): GridState
setState(state, options?): SetStateResult   // partial + defensive; never throws unless { strict: true }
getSchema(): GridSchema                      // machine-readable capability descriptor
```

### Events

All events bubble and are composed across shadow boundaries. Names ending in `-ing` are cancellable.

| Event | Cancellable | Detail |
|---|---|---|
| `sorting` / `sorted` | yes / no | `SortExpression<T>[]` |
| `filtering` / `filtered` | yes / no | `FilterExpression<T>[]` |
| `quickFilterChanging` / `quickFilterChanged` | yes / no | `{ value, nextValue? }` |
| `pageChanging` / `pageChanged` | yes / no | `{ page, pageSize, pageCount, totalItems }` |
| `columnPinning` / `columnPinned` | yes / no | `{ key, previous, next }` / `{ key, pinned }` |
| `columnMoving` / `columnMoved` | yes / no | `{ key, fromIndex, toKey, position }` / `{ key, fromIndex, toIndex }` |
| `cellValueChanging` / `cellValueChanged` | yes / no | `{ row, column, value, newValue }` |
| `cellValidationFailed` | no | `{ key, rowIndex, data, value, errors }` |
| `rowEditStarted` / `rowEditEnded` | no / no | row context |
| `historyChanged` | no | `{ canUndo, canRedo }` |
| `rowSelecting` / `rowSelected` | yes / no | `{ added, removed }` |
| `rowPinning` / `rowPinned` | yes / no | `{ row, position }` |
| `rowMoving` / `rowMoved` | yes / no | `{ from, to, data }` |
| `rowExpanding` / `rowExpanded` | yes / no | row context |
| `treeRowExpanding` / `treeRowExpanded` | yes / no | row context |
| `stateChanged` | no | `{ state }` (debounced; only while listened) |

Programmatic `sort()` / `filter()` calls are silent; only UI-initiated changes emit `sorting` / `filtering`.

### Attributes

`auto-generate`, `quick-filter`, `show-quick-filter`, `show-export`, `column-reordering`.

### CSS parts

| Component | Parts |
|---|---|
| `<apex-grid-toolbar>` | `toolbar`, `toolbar-search`, `search-field`, `search-icon`, `search-input`, `toolbar-actions`, `export-trigger`, `export-menu`, `export-menu-item` |
| `<apex-grid-paginator>` | `paginator`, `paginator-size`, `paginator-info`, `paginator-controls`, `paginator-page` |
| `<apex-grid-cell>` | `cell`, `editor` |

---

## Framework integration

`<apex-grid>` is a standard custom element. Bind properties (not attributes) for `data` / `columns`:

| Framework | Syntax |
|---|---|
| Lit | `<apex-grid .data=${data} .columns=${columns}>` |
| Angular | `<apex-grid [data]="data" [columns]="columns">` (use `CUSTOM_ELEMENTS_SCHEMA`) |
| Vue | `<apex-grid :data.prop="data" :columns.prop="columns">` |
| React (19+) | `<apex-grid data={data} columns={columns}>` |
| Vanilla | `el.data = data; el.columns = columns;` |

---

## Local development

```bash
git clone https://github.com/apexcharts/apex-grid.git
cd apex-grid
npm install
npm start             # demo at http://localhost:5173
npm test              # web-test-runner
npm run lint
npm run build         # builds dist/ + custom-elements.json + typedoc
```

## Releasing

Releases are automated by [.github/workflows/publish.yml](.github/workflows/publish.yml):

1. Bump `"version"` in [package.json](package.json), the single source of truth. The build injects it into `dist/package.json`.
2. Commit with a message starting with `release:` and the same version, e.g. `release: 2.0.0` or `release: 2.0.0-rc.1`.
3. Push to `main`.

The workflow then verifies the version triple-match, runs lint + tests + build, publishes `dist/` to npm with `--provenance` (OIDC trusted publishing, no token in secrets), and creates a `vX.Y.Z` git tag and GitHub Release with auto-generated notes. Pre-release versions (containing `-`) publish under the `next` dist-tag; stable versions under `latest`.

Any push whose head commit does not start with `release:` is a no-op for the workflow.

## License

See [LICENSE](LICENSE).
