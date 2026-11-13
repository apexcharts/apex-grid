import { expect } from '@open-wc/testing';
import type { ApexGridEventMap, ColumnConfiguration, SortExpression } from 'apex-grid';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ApexGridEventProps, apexGridEvents } from '../src/events.js';
import {
  ApexGrid,
  type ApexGridElement,
  type ApexGridProps,
  createApexGrid,
} from '../src/index.js';

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

/**
 * Compile-only: every settable property and attribute is a prop, while
 * getter-only members and methods are not. React assigns each prop to the
 * element, so a getter-only prop throws during commit and a method prop
 * replaces the method on the instance.
 */
export function settablePropsCompile(users: User[]): ReactNode {
  const columns: ColumnConfiguration<User>[] = [{ key: 'id' }];
  // A method's own value, so each method case fails only for being a method.
  const grid = document.createElement('apex-grid') as unknown as ApexGridElement<User>;
  return (
    <>
      <UserGrid
        data={users}
        columns={columns}
        pagination={{ pageSize: 10 }}
        rowRecycling={false}
        exportFilename="users"
        localeText={{}}
        theme="dark"
        rowId={(row) => row.id}
        page={2}
        quickFilter="a"
        sortExpressions={[]}
        selectedRows={users}
        className="grid"
        style={{ height: 300 }}
        key="k"
      />
      <ApexGrid data={[]} pagination={{ pageSize: 10 }} rowRecycling exportFilename="x" />
      {/* Getter-only members. */}
      {/* @ts-expect-error hasColumnGroups is getter-only */}
      <UserGrid hasColumnGroups={false} />
      {/* @ts-expect-error columnGroupDepth is getter-only */}
      <UserGrid columnGroupDepth={1} />
      {/* @ts-expect-error rows is getter-only */}
      <UserGrid rows={[]} />
      {/* @ts-expect-error dataView is getter-only */}
      <UserGrid dataView={users} />
      {/* @ts-expect-error displayColumns is getter-only */}
      <UserGrid displayColumns={columns} />
      {/* @ts-expect-error totalItems is getter-only */}
      <UserGrid totalItems={500} />
      {/* @ts-expect-error pageItems is getter-only */}
      <UserGrid pageItems={users} />
      {/* @ts-expect-error pageCount is getter-only */}
      <UserGrid pageCount={4} />
      {/* @ts-expect-error editingCell is getter-only */}
      <UserGrid editingCell={{ rowIndex: 0, columnKey: 'id' }} />
      {/* @ts-expect-error editingRow is getter-only */}
      <UserGrid editingRow={0} />
      {/* @ts-expect-error canUndo is getter-only */}
      <UserGrid canUndo />
      {/* @ts-expect-error canRedo is getter-only */}
      <UserGrid canRedo />
      {/* @ts-expect-error pinnedRows is getter-only */}
      <UserGrid pinnedRows={{ top: [], bottom: [] }} />
      {/* @ts-expect-error exportFormats is getter-only */}
      <UserGrid exportFormats={[]} />
      {/* @ts-expect-error toolbarActions is getter-only */}
      <UserGrid toolbarActions={[]} />
      {/* @ts-expect-error totalItems is getter-only on the base component too */}
      <ApexGrid totalItems={500} />
      {/* @ts-expect-error canUndo is getter-only on the base component too */}
      <ApexGrid canUndo />
      {/* Methods. */}
      {/* @ts-expect-error sort is a method */}
      <UserGrid sort={grid.sort} />
      {/* @ts-expect-error filter is a method */}
      <UserGrid filter={grid.filter} />
      {/* @ts-expect-error getState is a method */}
      <UserGrid getState={grid.getState} />
      {/* @ts-expect-error undo is a method */}
      <UserGrid undo={grid.undo} />
      {/* @ts-expect-error exportToCSV is a method */}
      <UserGrid exportToCSV={grid.exportToCSV} />
      {/* @ts-expect-error localize is a method */}
      <UserGrid localize={grid.localize} />
      {/* @ts-expect-error requestUpdate is an inherited element method */}
      <UserGrid requestUpdate={grid.requestUpdate} />
      {/* @ts-expect-error sort is a method on the base component too */}
      <ApexGrid sort={grid.sort} />
      {/* @ts-expect-error gotoPage is a method on the base component too */}
      <ApexGrid gotoPage={grid.gotoPage} />
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
  it('exports only the grid wrapper and the typed factory', async () => {
    // The toolbar and paginator read their state from the grid that hosts
    // them, so a standalone wrapper rendered an empty element.
    const entry = await import('../src/index.js');
    expect(Object.keys(entry).sort()).to.deep.equal(['ApexGrid', 'createApexGrid']);
  });

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
