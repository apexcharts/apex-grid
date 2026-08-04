# react-apex-grid

React wrappers for [`apex-grid`](https://www.npmjs.com/package/apex-grid), the
framework-agnostic web component data grid. You get declarative `on<Event>`
handlers, full TypeScript types for props and events, and a `ref` typed to the
grid element, all generated from the element's Custom Elements Manifest.

Enterprise features light up automatically when the consumer also loads
`apex-grid-enterprise` alongside; this wrapper is tier-agnostic and holds no
license gate.

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

`ApexGrid` (and `ApexGridToolbar`, `ApexGridPaginator`) are the loosely typed
base wrappers: `data` / `columns` are typed as `object`. Good for JavaScript or
quick usage.

```tsx
import { ApexGrid } from 'react-apex-grid';

<ApexGrid data={rows} columns={columns} style={{ height: 480 }} />;
```

Column, event, and configuration types all come from `apex-grid` directly:

```ts
import type { ColumnConfiguration, ApexRowSelectedEvent } from 'apex-grid';
```

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
