'use client';

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

/**
 * Client component: the grid mounts and renders in the browser after hydration.
 * It is imported by a Server Component (app/page.tsx); importing this module on
 * the server is a no-op (the element registers itself only in the browser).
 */
export default function UsersGrid({ users }: { users: User[] }) {
  return (
    <UserGrid
      data={users}
      columns={columns}
      style={{ height: 480 }}
      onRowSelected={(e) => {
        // e.detail is ApexRowSelectedEvent<User>
        console.log('selected', e.detail);
      }}
    />
  );
}
