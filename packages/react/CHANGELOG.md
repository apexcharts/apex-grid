# Changelog

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
