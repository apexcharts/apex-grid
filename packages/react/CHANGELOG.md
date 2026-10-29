# Changelog

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
  `apex-grid-enterprise`; this wrapper is tier-agnostic.
