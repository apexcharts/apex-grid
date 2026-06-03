# apex-grid-enterprise

Pro-licensed enterprise features for [`apex-grid`](https://www.npmjs.com/package/apex-grid).

`apex-grid-enterprise` extends the community grid and registers as
`<apex-grid-enterprise>`, layering enterprise-only features on top of everything
`apex-grid` already does. Use it as a drop-in replacement for `<apex-grid>`.

> Requires a valid license key for production use. Without one, the grid keeps
> working but renders a watermark and logs a console notice. See the licensing
> docs for details.

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
