import {
  aTimeout,
  elementUpdated,
  expect,
  fixture,
  fixtureCleanup,
  html,
  nextFrame,
} from '@open-wc/testing';
import type ApexGridCell from '../src/components/cell.js';
import { ApexGrid } from '../src/components/grid.js';
import type ApexGridRow from '../src/components/row.js';
import type ApexVirtualizer from '../src/components/virtualizer.js';
import type { StateController } from '../src/controllers/state.js';
import type { ColumnConfiguration } from '../src/internal/types.js';

/** Keyboard navigation: per-grid state. */

type Row = { id: number; name: string; age: number };
const makeRows = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: i, name: `n${i}`, age: 20 + (i % 50) }));
const COLUMNS: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number' },
  { key: 'name' },
  { key: 'age', type: 'number' },
];

type Internals<T extends object> = {
  scrollContainer: ApexVirtualizer;
  stateController: StateController<T>;
};
const internals = <T extends object>(grid: ApexGrid<T>) => grid as unknown as Internals<T>;
const activeOf = <T extends object>(grid: ApexGrid<T>) => ({
  ...internals(grid).stateController.active,
});
const body = <T extends object>(grid: ApexGrid<T>) => internals(grid).scrollContainer;

async function settle(grid: HTMLElement, frames = 3) {
  await elementUpdated(grid);
  for (let i = 0; i < frames; i++) await nextFrame();
}

function renderedRows<T extends object>(grid: ApexGrid<T>): ApexGridRow<T>[] {
  return Array.from(body(grid).querySelectorAll('apex-grid-row')) as unknown as ApexGridRow<T>[];
}

function cellAt<T extends object>(grid: ApexGrid<T>, row: number, key: string) {
  const el = renderedRows(grid).find((r) => r.index === row);
  return el?.cells.find((c) => c.column.key === key) as ApexGridCell<T> | undefined;
}

function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, composed: true, ...init })
  );
}

const waitFor = async (check: () => boolean, ms = 1000) => {
  const end = performance.now() + ms;
  while (!check() && performance.now() < end) await aTimeout(16);
  return check();
};

afterEach(() => fixtureCleanup());

describe('Navigation state is per grid', () => {
  async function twoGrids(editing = false) {
    ApexGrid.register();
    const wrap = await fixture<HTMLDivElement>(html`<div style="display:flex;gap:8px">
      <apex-grid id="a" style="height:300px;width:380px" .data=${makeRows(10)} .columns=${COLUMNS}></apex-grid>
      <apex-grid
        id="b"
        style="height:300px;width:380px"
        .editing=${editing ? { enabled: true } : undefined}
        .data=${makeRows(10)}
        .columns=${COLUMNS.map((c) => ({ ...c, editable: true }))}
      ></apex-grid>
    </div>`);
    const a = wrap.querySelector('#a') as ApexGrid<Row>;
    const b = wrap.querySelector('#b') as ApexGrid<Row>;
    await settle(a);
    await settle(b);
    await waitFor(() => renderedRows(a).length > 0 && renderedRows(b).length > 0);
    return { a, b };
  }

  it('a key in one grid does not continue from the cell active in another grid', async () => {
    const { a, b } = await twoGrids();
    cellAt(a, 5, 'name')!.click();
    await settle(a);
    expect(activeOf(a)).to.deep.equal({ column: 'name', row: 5 });

    press(body(b), 'ArrowDown');
    await settle(b);
    // Moves from B's own (empty) origin, not from A's cell.
    expect(activeOf(b)).to.deep.equal({ column: 'id', row: 1 });
    expect(activeOf(a), 'grid A keeps its own cell').to.deep.equal({ column: 'name', row: 5 });
  });

  it('removing one grid does not reset the active cell of another', async () => {
    const { a, b } = await twoGrids();
    cellAt(b, 1, 'age')!.click();
    await settle(b);
    a.remove();
    await settle(b);
    press(body(b), 'ArrowDown');
    await settle(b);
    expect(activeOf(b)).to.deep.equal({ column: 'age', row: 2 });
  });

  it('Enter still opens the editor after another grid disconnects', async () => {
    const { a, b } = await twoGrids(true);
    const cell = cellAt(b, 1, 'name')!;
    cell.click();
    await settle(b);
    a.remove();
    await settle(b);
    press(cell, 'Enter');
    await settle(b);
    expect(cell.hasAttribute('editing')).to.equal(true);
  });
});
