# apex-grid-enterprise

Pro-licensed enterprise features for [`apex-grid`](https://www.npmjs.com/package/apex-grid).

`apex-grid-enterprise` extends the community grid and registers as
`<apex-grid-enterprise>`, layering enterprise-only features on top of everything
`apex-grid` already does. Use it as a drop-in replacement for `<apex-grid>`.

> Requires a valid license key for production use. Without one, the grid keeps
> working but renders a watermark and logs a console notice. Set a key with
> `ApexGridEnterprise.setLicense(...)` — see [Licensing](#licensing) below.

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

### Column aggregations

Request sum / avg / min / max / count per column via the `aggregations` property,
then read the computed values with `getAggregations()`:

```ts
grid.aggregations = { price: ['sum', 'avg'], sold: ['sum', 'max'] };

const totals = grid.getAggregations();
// → { price: { sum: 657.92, avg: 109.65 }, sold: { sum: 347, max: 91 } }
```

## Licensing

Licensing is offline and non-hostile: without a valid key the grid keeps working
but renders a watermark and logs a console notice — no network calls, no hard
blocking. Set the key once (globally) before or after the grid renders:

```ts
import { ApexGridEnterprise } from 'apex-grid-enterprise';

ApexGridEnterprise.setLicense('APEX-…'); // removes the watermark on all instances
```

`LicenseManager` (re-exported from `apex-commons`) is also available for advanced
use, but `setLicense` is the supported entry point.

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
