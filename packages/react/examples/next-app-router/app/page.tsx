import UsersGrid from './users-grid';

// Server Component. It renders a client component (UsersGrid); the wrapper is
// never executed on the server, so this page does not need `'use client'`.
export default function Page() {
  const users = [
    { id: 1, name: 'Ada Lovelace', email: 'ada@example.com' },
    { id: 2, name: 'Alan Turing', email: 'alan@example.com' },
    { id: 3, name: 'Grace Hopper', email: 'grace@example.com' },
  ];

  return (
    <main style={{ padding: 24 }}>
      <h1>react-apex-grid + Next.js (App Router)</h1>
      <UsersGrid users={users} />
    </main>
  );
}
