import { expect } from '@open-wc/testing';
import type { ApexGridEventMap, ColumnConfiguration, SortExpression } from 'apex-grid';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ApexGridEventProps, apexGridEvents } from '../src/events.js';
import { ApexGrid, type ApexGridProps, createApexGrid } from '../src/index.js';

interface User {
  id: number;
  name: string;
}

const UserGrid = createApexGrid<User>();

// --- Type-level checks ------------------------------------------------------
// `npm run typecheck` compiles this file (the package tsconfig includes test/),
// so a regression in the row-type binding fails CI before any browser runs.

type Equal<A, B> = (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2
  ? true
  : false;
function assertType<_T extends true>(): void {}

/** The event a typed `on<Event>` prop's handler receives. */
type HandlerEvent<P extends keyof ApexGridEventProps> = Parameters<
  NonNullable<ApexGridProps<User>[P]>
>[0];

// Every runtime-wired handler prop is typed against the event it is wired to,
// with the row type carried through: one naming rule for runtime and types.
assertType<Equal<keyof ApexGridEventProps, keyof typeof apexGridEvents>>();
assertType<
  {
    [P in keyof ApexGridEventProps]: Equal<
      HandlerEvent<P>,
      ApexGridEventMap<User>[ApexGridEventProps[P]]
    >;
  }[keyof ApexGridEventProps]
>();
// No event in the element's map is left without a handler prop.
assertType<Equal<ApexGridEventProps[keyof ApexGridEventProps], keyof ApexGridEventMap<User>>>();
assertType<Equal<HandlerEvent<'onRowSelected'>['detail']['added'], User[]>>();
assertType<Equal<HandlerEvent<'onSorted'>['detail'], SortExpression<User>>>();

/** Compile-only: exercises the props in JSX, never rendered. */
export function typedPropsCompile(users: User[]): ReactNode {
  const columns: ColumnConfiguration<User>[] = [{ key: 'id' }, { key: 'name' }];
  return (
    <>
      <UserGrid
        data={users}
        columns={columns}
        theme="dark tinted"
        onRowSelected={(e) => {
          assertType<Equal<typeof e.detail.added, User[]>>();
        }}
      />
      {/* @ts-expect-error data is User[], so a row with a string id is rejected */}
      <UserGrid data={[{ id: 'x', name: 'a' }]} />
      {/* @ts-expect-error a column key must be a key of User */}
      <UserGrid columns={[{ key: 'email' }]} />
      <ApexGrid theme="dark" />
    </>
  );
}

// --- Runtime checks ---------------------------------------------------------

function tick(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
}

async function render(node: ReactNode): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(node);
  await tick();
  return { container, root };
}

describe('react-apex-grid (audit batch react)', () => {
  it('passes the attribute-only theme prop through as the theme attribute', async () => {
    const { container, root } = await render(
      <>
        <ApexGrid theme="dark" style={{ height: 200 }} />
        <UserGrid theme="dark tinted" data={[]} style={{ height: 200 }} />
      </>
    );
    const [base, typed] = container.querySelectorAll('apex-grid');
    expect(base.getAttribute('theme')).to.equal('dark');
    expect(typed.getAttribute('theme')).to.equal('dark tinted');
    root.unmount();
    container.remove();
  });

  it('wires each typed handler prop to the event the shared map names', async () => {
    const seen: string[] = [];
    const { container, root } = await render(
      <UserGrid
        data={[{ id: 1, name: 'a' }]}
        style={{ height: 200 }}
        onRowSelected={(e) => seen.push(`rowSelected:${e.detail.added.length}`)}
        onSorted={(e) => seen.push(`sorted:${String(e.detail.key)}`)}
      />
    );
    const el = container.querySelector('apex-grid')!;
    el.dispatchEvent(new CustomEvent('rowSelected', { detail: { added: [{}], removed: [] } }));
    el.dispatchEvent(new CustomEvent('sorted', { detail: { key: 'name' } }));
    await tick();
    expect(seen).to.deep.equal(['rowSelected:1', 'sorted:name']);
    root.unmount();
    container.remove();
  });
});
