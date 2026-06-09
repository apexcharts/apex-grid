# apex-grid-enterprise

Pro-licensed enterprise features for [`apex-grid`](https://www.npmjs.com/package/apex-grid).

`apex-grid-enterprise` extends the community grid and registers as
`<apex-grid-enterprise>`, layering enterprise-only features on top of everything
`apex-grid` already does. Use it as a drop-in replacement for `<apex-grid>`.

> Requires a valid license key for production use. Without one, the grid keeps
> working but renders a watermark and logs a console notice. See the licensing
> docs for details.

## Enterprise features

- **Column aggregations** — sum / avg / min / max / count per column via the
  `aggregations` property and `getAggregations()`.
- **Excel (XLSX) export** — `grid.exportToXLSX({ filename, sheetName, source, columns })`,
  and an "Export XLSX" entry added to the toolbar's export menu (alongside the
  community grid's CSV). Numbers, booleans, and `Date` values keep their native
  Excel cell types. _(Moved here from the community package in apex-grid v3; CSV
  export stays free.)_

```ts
import 'apex-grid-enterprise/define';

const grid = document.querySelector('apex-grid-enterprise');
grid.exportToXLSX({ filename: 'users', sheetName: 'Users' });
```

## Install

```bash
npm install apex-grid-enterprise apex-grid lit igniteui-webcomponents
```

`apex-grid`, `lit`, and `igniteui-webcomponents` are peer dependencies shared
with the community package — install a single copy of each.

## Usage

```ts
import 'apex-grid-enterprise/define'; // registers <apex-grid-enterprise>
```

The configuration API is identical to `apex-grid`; see the `apex-grid` README
for column configuration, theming, and events.
