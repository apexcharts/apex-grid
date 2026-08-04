# react-apex-grid + Next.js (App Router) example

A minimal reference showing `react-apex-grid` under the Next.js App Router: a
Server Component (`app/page.tsx`) renders a client grid (`app/users-grid.tsx`,
marked `'use client'`).

> This folder is a **reference**, not part of the monorepo build or CI (it sits
> outside the `packages/*` workspace glob so it does not pull `next` into the
> repo). Copy it into a Next.js app to run it.

## Run it

1. Scaffold a Next.js 15 app (or use an existing one):

   ```sh
   npx create-next-app@latest my-app --ts --app
   cd my-app
   npm install react-apex-grid apex-grid
   ```

2. Copy `app/page.tsx`, `app/users-grid.tsx`, and `app/layout.tsx` from this
   folder into your app's `app/` directory.

3. `npm run dev` and open the page. The grid renders on the client after
   hydration.

## What it demonstrates

- **`'use client'` boundary**: only `users-grid.tsx` is a client module; the
  page stays a Server Component.
- **Server safety**: importing the wrapper in a Server Component is a no-op on
  the server; the custom element registers itself only in the browser.
- **Typed usage**: `createApexGrid<User>()` gives `data: User[]`,
  `columns: ColumnConfiguration<User>[]`, and a typed `onRowSelected` detail.
