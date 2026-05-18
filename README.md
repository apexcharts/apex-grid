# Apex Grid

[![Node.js CI](https://github.com/apexcharts/apexgrid/actions/workflows/node.js.yml/badge.svg)](https://github.com/apexcharts/apexgrid/actions/workflows/node.js.yml)
[![Coverage Status](https://coveralls.io/repos/github/apexcharts/apexgrid/badge.svg?branch=master)](https://coveralls.io/github/apexcharts/apexgrid?branch=master)

A Lit-based web component data grid with sorting, filtering, row virtualization, column resizing, and a templating API. Ships as a single custom element: `<apex-grid>`.

---

## Quick Start (one call)

If you don't need fine-grained control, `setup()` handles registration, theme configuration, and host sizing in a single call. You still import the Ignite UI theme CSS file yourself (bundlers can't dynamically import CSS portably):

```ts
import { setup } from 'apex-grid';
import 'igniteui-webcomponents/themes/light/bootstrap.css';

setup({ theme: 'bootstrap' });
```

That's it — `<apex-grid>` is registered, the theme is active, and a default host stylesheet (`height: 100%; min-height: 240px`) is adopted. Render the element and bind `.data` / `.columns` as below.

Prefer manual control? Use the four-step setup below instead — `setup()` is additive, not required.

---

## Getting Started (manual, four steps)

If you'd rather not use `setup()`, the four steps below are what `setup()` does under the hood. Skipping any one of them produces a grid that "runs" but renders broken-looking (no borders, no filter UI, or only a few collapsed rows).

### 1. Install

```bash
npm install apex-grid lit
```

`igniteui-webcomponents` ships as a transitive dependency — no separate install.

### 2. Register the custom element

Once, anywhere at app startup:

```ts
import 'apex-grid/define';
```

Equivalent long form:

```ts
import { ApexGrid } from 'apex-grid';
ApexGrid.register();
```

Without this, `<apex-grid>` is an inert unknown element.

### 3. Load a theme — required for styled UI

The grid's filter dropdowns and sort indicators come from `igniteui-webcomponents`. You must both **import the theme CSS** and **call `configureTheme()`**:

```ts
import { configureTheme } from 'igniteui-webcomponents';
import 'igniteui-webcomponents/themes/light/bootstrap.css';

configureTheme('bootstrap'); // 'bootstrap' | 'material' | 'fluent' | 'indigo'
```

For dark mode, swap `light` → `dark` in the import path. The name passed to `configureTheme()` must match the CSS file you imported.

### 4. Size the host

The grid uses `@lit-labs/virtualizer`, which requires a **bounded height** on the host. Without it, the virtualizer collapses to its natural content height (~150px) and only a few rows are visible regardless of how much data you pass.

```css
apex-grid {
  height: 480px;   /* any explicit pixel height; % works if the parent has a height */
}
```

> [!TIP]
> If you'd rather not write this rule yourself, `import 'apex-grid/styles.css'`
> ships a default that sets `height: 100%` with a `min-height: 240px` fallback.

> [!IMPORTANT]
> **Do not set `display` on `<apex-grid>`.** The component declares
> `:host { display: grid }` internally for its track layout (header / filter / body).
> Any consumer rule that sets `display` (including `display: block`, `display: flex`)
> overrides this and collapses the grid. If you accidentally do this, the grid emits
> a `console.warn` at startup pointing you here.

### 5. Render the grid

```ts
import { html, render } from 'lit';
import 'apex-grid/define';
import { configureTheme } from 'igniteui-webcomponents';
import 'igniteui-webcomponents/themes/light/bootstrap.css';
import type { ColumnConfiguration } from 'apex-grid';

configureTheme('bootstrap');

type User = { id: number; name: string; age: number; subscribed: boolean };

const data: User[] = [
  { id: 1, name: 'Ada Lovelace', age: 36, subscribed: true },
  { id: 2, name: 'Carl Sagan', age: 62, subscribed: false },
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

### What success looks like

When all four steps are in place you should see:

- **Visible borders** between rows and columns
- **Sort arrows** (↕) next to each header (because `sort: true`)
- A **filter row** below the headers with a "Filter" chip per column (because `filter: true`)
- **Hover state** on rows
- **Smooth scrolling** — DevTools shows only ~20 `<apex-grid-row>` elements at any time, no matter how many rows are in `data` (virtualization)

### Troubleshooting

| What you see | Likely cause |
|---|---|
| Bare table, no borders, no filter UI | Step 3 — theme CSS not imported or `configureTheme()` not called |
| Only ~3 rows visible regardless of data size | Step 4 — host has no bounded height, **or** consumer CSS sets `display` on `<apex-grid>` (check console for the warning) |
| `<apex-grid>` is empty / blank tag in DOM | Step 2 — element not registered |
| `columns` shown as literal `[object Object]` | `columns=` used as an attribute; must be a property — use `.columns=${...}` in Lit, `[columns]=` in Angular, `:columns.prop=` in Vue, `el.columns = ...` in vanilla JS |

---

## API Surface (quick reference)

- `<apex-grid>` — custom element tag.
- `ApexGrid<T>` — exported class. Use for `ApexGrid.register()` and for types.
- Properties (set via property binding, not attributes):
  - `data: T[]`
  - `columns: ColumnConfiguration<T>[]`
  - `autoGenerate` (attr `auto-generate`)
  - `sortConfiguration`, `dataPipelineConfiguration`
  - `sortExpressions`, `filterExpressions` (get/set)
- Methods: `sort()`, `filter()`, `clearSort()`, `clearFilter()`, `getColumn()`, `updateColumns()`.
- Events (UI-initiated only — programmatic `sort()` / `filter()` are silent): `sorting`, `sorted`, `filtering`, `filtered`.

Full type reference is generated via TypeDoc in `dist/`.

---

## Local Development

1. Clone the repository.
2. `npm install`
3. `npm start` — opens the demo at `demo/index.html` with Vite.
4. `npm test` — runs the Web Test Runner suite.

## Releasing

Releases are automated by [.github/workflows/publish.yml](.github/workflows/publish.yml):

1. Bump `"version"` in [package.json](package.json) (this is the single source of truth — the build injects it into `dist/package.json`).
2. Commit with a message that starts with `release:` and contains the version, e.g. `release: 1.2.0` or `release: 1.2.0-rc.1`.
3. Push to `master`.

The workflow then:

- Verifies `package.json` matches the commit message.
- Runs `npm ci && npm run build`.
- Publishes `dist/` to npm with `--provenance` (OIDC trusted publishing — no token in secrets).
- Pre-release versions (containing `-`) publish under the `next` dist-tag; stable versions under `latest`.
- Creates a `vX.Y.Z` git tag and a GitHub Release with auto-generated notes.

Any push whose head commit does not start with `release:` is a no-op for this workflow.
