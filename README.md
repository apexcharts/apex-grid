# Apex Grid

[![Node.js CI](https://github.com/apexcharts/apex-grid/actions/workflows/node.js.yml/badge.svg?branch=main)](https://github.com/apexcharts/apex-grid/actions/workflows/node.js.yml)
[![Coverage Status](https://coveralls.io/repos/github/apexcharts/apex-grid/badge.svg?branch=main)](https://coveralls.io/github/apexcharts/apex-grid?branch=main)
[![npm](https://img.shields.io/npm/v/apex-grid.svg)](https://www.npmjs.com/package/apex-grid)

A Lit-based, framework-agnostic web component data grid. Ships as a single custom
element `<apex-grid>` with a rich, opt-in feature set and full TypeScript types.

This repository is a monorepo containing the community grid and its commercial
enterprise extension.

## Packages

| Package | npm | Description |
| --- | --- | --- |
| [`apex-grid`](packages/core) | [![npm](https://img.shields.io/npm/v/apex-grid.svg)](https://www.npmjs.com/package/apex-grid) | The community grid: virtualization, sorting, filtering, pagination, pinning, reordering, resizing, inline editing, selection, master/detail, tree data, CSV export, theming, and accessibility. **Free and open source.** |
| [`apex-grid-enterprise`](packages/enterprise) | [![npm](https://img.shields.io/npm/v/apex-grid-enterprise.svg)](https://www.npmjs.com/package/apex-grid-enterprise) | A drop-in `<apex-grid-enterprise>` that layers pro-licensed features on top: column aggregations, row grouping, pivoting, set filter, Excel (XLSX) export, cell range selection, integrated charts, tool panel, status bar, master/detail grids, and the server-side row model. **Requires a license key for production.** |

## Quick start

```bash
npm install apex-grid lit
```

```ts
import { setup } from 'apex-grid';
import 'apex-grid/define';

setup(); // registers <apex-grid> and adopts the default host stylesheet
```

See the [`apex-grid` README](packages/core/README.md) for the full configuration
API, theming, and events, and the
[`apex-grid-enterprise` README](packages/enterprise/README.md) for the enterprise
features and licensing.

## Development

```bash
npm install        # install workspace dependencies
npm run build      # build core, then enterprise
npm test           # run unit tests across packages
npm run e2e        # run Playwright end-to-end tests
```

## License

`apex-grid` is released under the license in
[packages/core/LICENSE](packages/core/LICENSE). `apex-grid-enterprise` is
commercial software; see its [README](packages/enterprise/README.md#licensing)
for details.
