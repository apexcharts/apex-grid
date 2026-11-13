# react-apex-grid

React wrappers for [`apex-grid`](https://www.npmjs.com/package/apex-grid), the
framework-agnostic web component data grid. You get declarative `on<Event>`
handlers, full TypeScript types for props and events, and a `ref` typed to the
grid element, all generated from the element's Custom Elements Manifest.

The wrappers render the community `<apex-grid>` element. For the enterprise
grid, see [Using apex-grid-enterprise](#using-apex-grid-enterprise).

## Install

```sh
npm install react-apex-grid apex-grid
```

`react`, `react-dom`, and `apex-grid` are peer dependencies.

## Usage

The grid needs a bounded height (the virtualizer collapses without one). Pass it
through `style` or `className` like any React prop.

### Typed (recommended)

`createApexGrid<T>()` returns a component typed to your row shape `T`: `data` is
`T[]`, `columns` is `ColumnConfiguration<T>[]`, and every event detail is generic
over `T`.

```tsx
import { createApexGrid } from 'react-apex-grid';
import type { ColumnConfiguration } from 'apex-grid';

interface User {
  id: number;
  name: string;
  email: string;
}

const UserGrid = createApexGrid<User>();

const columns: ColumnConfiguration<User>[] = [
  { key: 'id' },
  { key: 'name' },
  { key: 'email' },
];

export function Users({ users }: { users: User[] }) {
  return (
    <UserGrid
      data={users}
      columns={columns}
      style={{ height: 480 }}
      onRowSelected={(e) => {
        // e.detail is ApexRowSelectedEvent<User>
        console.log(e.detail);
      }}
      onSorted={(e) => console.log(e.detail)}
    />
  );
}
```

### Base component

`ApexGrid` is the loosely typed base wrapper: `data` / `columns` are typed as
`object`. Good for JavaScript or quick usage.

```tsx
import { ApexGrid } from 'react-apex-grid';

<ApexGrid data={rows} columns={columns} style={{ height: 480 }} />;
```

The grid renders its own toolbar and paginator; configure them through its
props (`showQuickFilter`, `showExport`, `pagination`).

Column, event, and configuration types all come from `apex-grid` directly:

```ts
import type { ColumnConfiguration, ApexRowSelectedEvent } from 'apex-grid';
```

## Using apex-grid-enterprise

The components in this package render the community `<apex-grid>`. Loading
`apex-grid-enterprise` does not change them: enterprise features live on a
separate element, `<apex-grid-enterprise>`, so `ApexGrid` and
`createApexGrid<T>()` stay community grids. Wrap the enterprise element with
`@lit/react`, the same way this package wraps the community one:

```sh
npm install apex-grid-enterprise apex-grid @lit/react
```

Install `@lit/react` as a dependency of your app even though `react-apex-grid`
already depends on it: strict installers (pnpm by default) do not let your code
import a dependency of a dependency.

```tsx
'use client';

import { createComponent, type EventName } from '@lit/react';
import { ApexGridEnterprise, type ApexGridEnterpriseEventMap } from 'apex-grid-enterprise';
// Opts into every enterprise feature module and registers the enterprise
// elements (the grid, tool panel, status bar, set filter, chart panel...).
import 'apex-grid-enterprise/define';
import * as React from 'react';

export interface Employee {
  id: number;
  name: string;
  department: string;
}

type Events = ApexGridEnterpriseEventMap<Employee>;

export const EnterpriseGrid = createComponent({
  react: React,
  tagName: 'apex-grid-enterprise',
  // The element class typed to your row shape, so `data`, `columns` and the
  // event details are checked against Employee.
  elementClass: ApexGridEnterprise as new () => ApexGridEnterprise<Employee>,
  events: {
    // Community events: list the ones you handle, named as on ApexGrid.
    onRowSelected: 'rowSelected' as EventName<Events['rowSelected']>,
    onSorted: 'sorted' as EventName<Events['sorted']>,
    // Enterprise events.
    onViewChanged: 'apex-view-changed' as EventName<Events['apex-view-changed']>,
    onRangeChanged: 'apex-range-changed' as EventName<Events['apex-range-changed']>,
    onContextMenuOpening: 'apex-context-menu-opening' as EventName<
      Events['apex-context-menu-opening']
    >,
    onRowsLoaded: 'apex-rows-loaded' as EventName<Events['apex-rows-loaded']>,
    onRowsLoadFailed: 'apex-rows-load-failed' as EventName<Events['apex-rows-load-failed']>,
    onServerRowsLoaded: 'apex-server-rows-loaded' as EventName<Events['apex-server-rows-loaded']>,
    onServerRowsLoadFailed: 'apex-server-rows-load-failed' as EventName<
      Events['apex-server-rows-load-failed']
    >,
  },
});
```

Every enterprise property is then a prop, set on the element as a property:

```tsx
<EnterpriseGrid
  data={employees}
  columns={[{ key: 'name' }, { key: 'department' }]}
  groupBy={['department']}
  style={{ height: 480 }}
  onRangeChanged={(e) => console.log(e.detail)}
/>
```

Set the license once at startup with `ApexGridEnterprise.setLicense(key)` (see
the `apex-grid-enterprise` README). Keep the wrapper in a client component; on
the server, importing `apex-grid-enterprise/define` evaluates without a DOM, and
the grid renders on the client after hydration.

## Using with Ignite UI

With `apex-grid` 4.0.0 or later, the grid can follow an Ignite UI theme on
the page. Import the core's add-on once, anywhere in the app:

```ts
import 'apex-grid/ignite-ui';
```

Every grid then follows the Ignite UI theme the page loads. A grid whose
`theme` attribute has neither `dark` nor `light` follows the theme's variant,
light or dark; `theme="light"` or `theme="dark"` keeps that mode. The card and row surfaces take the theme's
surface (apex-grid 4.0.1 and later). The add-on needs no extra license key. Without it the grid
reads no `--ig-*` token; the `--ag-*` and family `--apx-*` tokens work either
way. The add-on is an ES module entry, so load it through your bundler (there
is no script-tag build).

To turn it off for one grid, pass the element's switches as props:

```tsx
// Ignite UI colours and font off (the Ignite UI variant still picks the mode)
<ApexGrid designSystem={false} data={rows} columns={columns} style={{ height: 480 }} />;

// Family --apx-* tokens and Ignite UI both off, for the grid and its content
<ApexGrid tokens={false} data={rows} columns={columns} style={{ height: 480 }} />;
```

They reflect as `design-system="off"` and `tokens="off"`, and both are typed
from the element, like every other prop. Ranking, the tokens the theme reaches
and the root-default note are in the `apex-grid` README (Customize the look).

## Next.js / server-side rendering

The wrapper is a **client component** and the package's entry points are marked
`'use client'`. The grid renders on the client after hydration; there is no
server-rendered grid markup in this release (no declarative shadow DOM).

- **App Router.** Import the grid inside a client component (a file with
  `'use client'` at the top). Importing it in a Server Component is a no-op on
  the server: the element registers itself only in the browser, so nothing
  throws and the registry stays clean.
- **Pages Router / other SSR.** Same rule: the component mounts and renders
  client-side after hydration.

```tsx
'use client';

import { createApexGrid } from 'react-apex-grid';
import type { ColumnConfiguration } from 'apex-grid';

interface Row {
  id: number;
  name: string;
}

const Grid = createApexGrid<Row>();

export default function DataGrid({ rows }: { rows: Row[] }) {
  const columns: ColumnConfiguration<Row>[] = [{ key: 'id' }, { key: 'name' }];
  return <Grid data={rows} columns={columns} style={{ height: 480 }} />;
}
```

## Vue and Angular

Vue 3 and Angular 15+ consume the `apex-grid` web component natively; see the
framework guides rather than a wrapper package.
