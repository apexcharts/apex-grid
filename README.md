<h1 align="center">Apex Grid</h1>

<p align="center">
  A fast, framework-agnostic data grid built as a web component, for dashboards, admin tools, and data-heavy UIs.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/apex-grid"><img src="https://img.shields.io/npm/v/apex-grid.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/apex-grid"><img src="https://img.shields.io/npm/dm/apex-grid.svg" alt="downloads"></a>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-ready-3178C6?logo=typescript&logoColor=white">
  <a href="packages/core/LICENSE.md"><img alt="License" src="https://img.shields.io/badge/license-Revenue--based-blue"></a>
  <a href="https://github.com/apexcharts/apex-grid/actions/workflows/node.js.yml"><img src="https://github.com/apexcharts/apex-grid/actions/workflows/node.js.yml/badge.svg?branch=main" alt="Node.js CI"></a>
  <a href="https://coveralls.io/github/apexcharts/apex-grid?branch=main"><img src="https://coveralls.io/repos/github/apexcharts/apex-grid/badge.svg?branch=main" alt="Coverage Status"></a>
</p>

<p align="center">
  <a href="packages/core/README.md">Documentation</a> ·
  <a href="packages/enterprise/README.md">Enterprise</a> ·
  <a href="packages/react/README.md">React</a> ·
  <a href="#license">License</a>
</p>

## Why Apex Grid

- **One custom element**: `<apex-grid>` works in React, Angular, Vue, Lit, or plain HTML, with no framework adapter required
- **Row virtualization**: only the visible rows are in the DOM, whatever the size of the dataset
- **Batteries included**: sorting, filtering, quick search, pagination, column pinning, reordering, resizing and groups, inline editing with validation, undo / redo, row selection, pinning, drag-reorder, master / detail, tree data, and CSV export
- **TypeScript-first**: full type definitions ship with the package, and column configuration is typed to your row shape
- **Styled out of the box**: no theme import or build step; restyle anything through `--ag-*` CSS custom properties
- **Accessible**: WCAG 2.2 AA grid semantics with full keyboard navigation and screen reader announcements
- **Localizable**: override any built-in string through `localeText`, or use a bundled dictionary
- **State round-trip**: `getState()` / `setState()` snapshots, a `stateChanged` event, and a `getSchema()` capability descriptor
- **Provenance-signed releases** published to npm with OIDC trusted publishing
- **Free for most users**: see [License](#license)

## Packages

This repository is a monorepo containing the community grid, its commercial enterprise extension, and the React wrapper.

| Package | npm | Description |
| --- | --- | --- |
| [`apex-grid`](packages/core) | [![npm](https://img.shields.io/npm/v/apex-grid.svg)](https://www.npmjs.com/package/apex-grid) | The community grid, with everything listed above. |
| [`apex-grid-enterprise`](packages/enterprise) | [![npm](https://img.shields.io/npm/v/apex-grid-enterprise.svg)](https://www.npmjs.com/package/apex-grid-enterprise) | A drop-in `<apex-grid-enterprise>` that adds the [enterprise features](#enterprise-features--licensing). **Requires a license key for production.** |
| [`react-apex-grid`](packages/react) | [![npm](https://img.shields.io/npm/v/react-apex-grid.svg)](https://www.npmjs.com/package/react-apex-grid) | React components for `<apex-grid>`, its toolbar, and its paginator, with typed props, `on<Event>` handlers, and a typed `ref`. |

## Install

```bash
npm install apex-grid lit
```

## Quick start

```js
import { setup } from 'apex-grid';

setup(); // registers <apex-grid> and adopts the default host stylesheet

const grid = document.querySelector('apex-grid');

grid.columns = [
  { key: 'name', type: 'string', headerText: 'Name', sort: true, filter: true },
  { key: 'age', type: 'number', headerText: 'Age', sort: true, filter: true },
  { key: 'subscribed', type: 'boolean', headerText: 'Subscribed' },
];

grid.data = [
  { name: 'Ada Lovelace', age: 36, subscribed: true },
  { name: 'Carl Sagan', age: 62, subscribed: false },
  { name: 'Grace Hopper', age: 85, subscribed: true },
];
```

```html
<apex-grid style="height: 480px"></apex-grid>
```

The grid needs a bounded height, since the virtualizer sizes its viewport from the host. See the [`apex-grid` README](packages/core/README.md) for the full configuration API, theming, events, and troubleshooting.

## Framework integration

Official:

- **React**: [react-apex-grid](packages/react), with typed props and events, plus Next.js App Router support

Any other framework uses the custom element directly. Bind `data` and `columns` as properties, not attributes:

| Framework | Syntax |
| --- | --- |
| Lit | `<apex-grid .data=${data} .columns=${columns}>` |
| Angular | `<apex-grid [data]="data" [columns]="columns">` (use `CUSTOM_ELEMENTS_SCHEMA`) |
| Vue | `<apex-grid :data.prop="data" :columns.prop="columns">` |
| React (19+) | `<apex-grid data={data} columns={columns}>` |
| Vanilla | `el.data = data; el.columns = columns;` |

## Enterprise features & licensing

`apex-grid-enterprise` registers `<apex-grid-enterprise>`, a drop-in replacement for `<apex-grid>` with the same configuration API, theming, and events, plus:

- **Column aggregations** with an optional grand-total row
- **Row grouping**, nested to any depth, with live per-group subtotals
- **Pivoting** with spanning headers, totals, and expandable row groups
- **Set filter** and an **advanced filter builder**
- **Columns tool panel** for visibility, ordering, grouping, and pivot
- **Cell range selection** with a live **status bar**
- **Excel (XLSX) export** with native cell types
- **Master / detail grids**: a child grid inside each expandable row
- **Integrated charts**: chart the grid's data with ApexCharts, live-bound to sort, filter, and edit
- **Context menu** with built-in and custom items
- **Server-side row model**: stream large remote datasets block by block, with server-side grouping and aggregation
- **Formulas**: spreadsheet-style cell formulas with A1 references, drag-to-fill, and dependency-graph recalculation
- **AI Toolkit**: natural-language grid control and read-only Q&A on a deterministic offline engine, with optional LLM escalation

```bash
npm install apex-grid-enterprise apex-grid lit
```

```js
import { ApexGridEnterprise } from 'apex-grid-enterprise';
import 'apex-grid-enterprise/define'; // registers every enterprise feature and companion element

ApexGridEnterprise.setLicense('APEX-xxxxxxxx'); // set once; applies to every instance
```

Without a valid key the enterprise grid keeps working (**trial mode**, for evaluation) but renders a watermark and logs a console notice. Licensing is offline: no network calls and no hard blocking. Keys are shared across the whole Apex family, so one customer key works for every Apex product. Get a license at [apexcharts.com/pricing](https://apexcharts.com/pricing).

See the [`apex-grid-enterprise` README](packages/enterprise/README.md) for every feature in depth.

## Browser support

Apex Grid works in all modern evergreen browsers (Chrome, Firefox, Safari, Edge).

## Documentation

- [`apex-grid`](packages/core/README.md): setup, every feature, and the full API reference (properties, methods, events, CSS parts)
- [`apex-grid-enterprise`](packages/enterprise/README.md): enterprise features and licensing
- [`react-apex-grid`](packages/react/README.md): React usage, typed grids, and Next.js
- Changelogs: [core](packages/core/CHANGELOG.md) · [enterprise](packages/enterprise/CHANGELOG.md) · [react](packages/react/CHANGELOG.md)

## Contributing

```bash
npm install        # install workspace dependencies
npm run dev        # start the demo
npm run build      # build core, then enterprise, then react
npm test           # run unit tests across packages
npm run e2e        # run Playwright end-to-end tests
```

## License

`apex-grid` and `react-apex-grid` use a **$2M threshold license**:

- **Free** for individuals, and organizations with **under $2M USD in annual revenue, operating budget, funding, or equivalent financial resources**, including commercial use. No registration required.
- **Commercial license required** once you, your parent company, affiliates, or any entity under common control reach $2M USD or more on any of those measures.
- **OEM license required** to embed the grid in a product or platform used by other people, whatever your size.

`apex-grid-enterprise` is commercial software with **no free tier**: the $2M threshold does not apply to it, and it needs a **Premium** license or higher whatever your size. Without a key it renders a trial watermark, for evaluation only.

Full terms: [apex-grid](packages/core/LICENSE.md) · [apex-grid-enterprise](packages/enterprise/LICENSE.md) · [react-apex-grid](packages/react/LICENSE.md) · [apexcharts.com/license](https://apexcharts.com/license)

## Contact

- Issues, bugs & questions: [GitHub Issues](https://github.com/apexcharts/apex-grid/issues)
- Email: info@apexcharts.com
