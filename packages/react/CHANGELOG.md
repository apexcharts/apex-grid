# Changelog

## Unreleased

- New entry `react-apex-grid/enterprise`: `ApexGridEnterprise`, a row-typed
  `createApexGridEnterprise<T>()`, and `ApexGridToolPanel`,
  `ApexGridStatusBar`, `ApexGridSetFilter`, `ApexGridFilterBuilder`,
  `ApexGridChart` and `ApexGridAI`, generated from the apex-grid-enterprise
  manifest. Enterprise properties are props, every community and enterprise
  event has a typed `on<Event>` handler (`onApexRangeChanged`,
  `onApexViewChanged`...), and each companion's `grid` prop takes a typed
  enterprise grid. Importing it turns on every enterprise feature module and
  registers the elements in the browser only. It replaces the hand-written
  `@lit/react` recipe the README used to show.
- `apex-grid-enterprise` (`>=0.10.0 <1.0.0`) is a new optional peer
  dependency, so a new enterprise minor does not need a new react-apex-grid.
  The root entry does not import it, so community apps install nothing new.

## 0.2.0

- Removed `ApexGridToolbar` and `ApexGridPaginator`. They rendered an empty
  element outside the grid, which renders its own toolbar and paginator;
  configure those with `showQuickFilter`, `showExport`, `pagination` and
  `toolbarActions`.
- `ApexGrid` and `createApexGrid<T>()` components accept only the grid's
  settable properties, the `theme` attribute, `on<Event>` handlers and standard
  HTML props. Read-only members such as `totalItems`, `pageCount` or
  `canUndo` and methods such as `sort` or `getState` are now TypeScript errors
  as props (passing a read-only one used to throw at runtime and unmount the
  React root). Read or call them through a ref.
- The `apex-grid` peer range is `^3.5.0 || ^4.0.0 || ^5.0.0`. The prop types
  only name properties the installed apex-grid has.

## 0.1.2

- The `apex-grid` peer range is now `^3.5.0 || ^4.0.0`. The 0.1.1 notes said
  the wrapper installs next to any apex-grid 3.x; it needs 3.5.0 or later,
  because it imports `ApexGridToolbar` and `ApexGridPaginator`, which apex-grid
  first exports in 3.5.0. An app on apex-grid 3.4.x failed to bundle; npm now
  reports the peer conflict at install time instead.
- The README and the 0.1.0 notes said enterprise features light up when the app
  also loads `apex-grid-enterprise`. They do not: these components render the
  community `<apex-grid>`, and enterprise features live on
  `<apex-grid-enterprise>`. The README now shows how to wrap the enterprise
  element with `@lit/react`, including its events and the pnpm install step.
- `theme` is now a typed prop on `ApexGrid` and on `createApexGrid<T>()`
  components, so `theme="dark"` compiles. At runtime it was already set as the
  `theme` attribute.
- `ApexGridToolbar` and `ApexGridPaginator` are deprecated. They render nothing
  outside the grid, which renders its own toolbar and paginator (configure them
  with `showQuickFilter`, `showExport` and `pagination`). They will be removed
  in 0.2.0.
- The row-typed `on<Event>` props of `createApexGrid<T>()` now come from the
  same generated prop-to-event map as the runtime wiring. Every prop name is
  unchanged.
- Build and tests: the build clears `dist/` first, `npm test` checks that
  importing the package in Node with no DOM registers no element, and
  `npm run typecheck` checks the `createApexGrid<T>()` row typing. An unrelated
  apex-grid documentation change no longer marks the generated wrappers out of
  date.

## 0.1.1

The stable release of 0.1.1-beta.1, now under the `latest` npm tag.

- The `apex-grid` peer range is `^3.4.0 || ^4.0.0`, so the wrapper installs
  next to apex-grid 3.x or 4.x. (Corrected later: it needs apex-grid 3.5.0 or
  later; the range is now `^3.5.0 || ^4.0.0`.) The wrapper code is unchanged
  from 0.1.0, and the 4.0 properties such as `rowRecycling` pass through like
  any other.

## 0.1.1-beta.1

Pre-release, published under the `next` npm tag.

- The `apex-grid` peer range accepts the 4.0 line (`^3.4.0 || ^4.0.0-beta.1`),
  so the wrapper installs next to apex-grid 4.0.0-beta.1 without a peer
  conflict. The wrapper code is unchanged, and the new `rowRecycling` property
  passes through like any other.

## 0.1.0

Initial release.

- `createApexGrid<T>()` factory plus the base `ApexGrid`, `ApexGridToolbar`, and
  `ApexGridPaginator` React components, generated from apex-grid's Custom
  Elements Manifest.
- Typed props (`data: T[]`, `columns: ColumnConfiguration<T>[]`), declarative
  `on<Event>` handlers whose detail is generic over `T`, and a `ref` typed as
  `ApexGrid<T>`.
- SSR / Next.js App Router support: `'use client'` entry points and client-only
  element registration (importing the wrapper in a Server Component is a no-op).
- Enterprise features activate automatically when the consumer also loads
  `apex-grid-enterprise`; this wrapper is tier-agnostic. (Corrected later: the
  components render the community grid only; see the README for the enterprise
  recipe.)
