import { expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { ApexGridAI, ApexGridChart, ApexGridEnterprise, enterpriseModules } from '../src/index.js';
import { settle } from './settle.js';

// Restore by address (row recycling plan, 5.4 item 6): the context menu, the
// AI dialog and the chart dialog put focus back where it was when they close.
// A body cell is a slot, not a record: a sort or a long scroll while the
// overlay is open can move its record elsewhere (row keys) or give the same
// element another record (slot keys). Focus then returns to the grid's
// active cell, or the body when that row is not rendered, never to a cell
// standing at another address. A cell still at its address comes back into
// view; the body fallback does not scroll.

interface Row {
  name: string;
  value: number;
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'name', type: 'string', headerText: 'Name', sort: true },
  { key: 'value', type: 'number', headerText: 'Value', sort: true },
];

function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `r${String(i).padStart(3, '0')}`,
    value: i,
  }));
}

type Grid = ApexGridEnterprise<Row>;
type Cell = HTMLElement & {
  column: { key: unknown };
  row: HTMLElement & { index: number; data: Row };
};

interface Internals {
  scrollContainer: HTMLElement;
  stateController: { active: { row: number; column: unknown } };
}

const internals = (grid: Grid) => grid as unknown as Internals;

async function mount(count: number): Promise<Grid> {
  const parent = document.createElement('div');
  parent.style.height = '400px';
  const grid = await fixture<Grid>(
    html`<apex-grid-enterprise .data=${rows(count)} .columns=${columns}></apex-grid-enterprise>`,
    { parentNode: parent }
  );
  await settle(grid);
  return grid;
}

function cellAt(grid: Grid, index: number, key: keyof Row): Cell {
  const row = grid.rows.find((r) => r.index === index);
  const cell = row?.cells.find((c) => String(c.column.key) === key);
  if (!cell) throw new Error(`row ${index} is not rendered`);
  return cell as unknown as Cell;
}

function deepActive(): Element | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

/** Whether `element` lies inside the grid's visible box. */
function inView(grid: Grid, element: Element): boolean {
  const box = element.getBoundingClientRect();
  const view = grid.getBoundingClientRect();
  return box.top >= view.top && box.bottom <= view.bottom;
}

/** Click a body cell: it becomes the active cell and takes focus. */
async function activate(grid: Grid, index: number): Promise<Cell> {
  const cell = cellAt(grid, index, 'name');
  cell.click();
  await settle(grid);
  expect(deepActive(), 'the clicked cell has focus').to.equal(cell);
  return cell;
}

/** Focus is on the grid's active cell (its roving tab stop), not some other cell. */
function expectOnActiveCell(grid: Grid): void {
  const focused = deepActive() as Cell | null;
  const active = internals(grid).stateController.active;
  expect(focused?.localName, 'focus is on a body cell').to.equal('apex-grid-cell');
  expect(focused!.row.index, 'the active row').to.equal(active.row);
  expect(focused!.column.key, 'the active column').to.equal(active.column);
  expect(focused!.tabIndex, 'the roving tab stop').to.equal(0);
  expect(focused!.row.data, 'the record at that address').to.equal(grid.pageItems[active.row]);
}

interface Overlay {
  name: string;
  open(grid: Grid, cell: Cell): Promise<void>;
  close(): Promise<void>;
}

const contextMenu: Overlay = {
  name: 'context menu',
  async open(_grid, cell) {
    cell.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F10',
        shiftKey: true,
        bubbles: true,
        composed: true,
        cancelable: true,
      })
    );
    expect(document.querySelector('.apex-grid-context-menu'), 'menu open').to.exist;
  },
  async close() {
    document
      .querySelector('.apex-grid-context-menu')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  },
};

let panel: ApexGridAI | ApexGridChart | null = null;

const aiDialog: Overlay = {
  name: 'AI dialog',
  async open(grid) {
    const ai = document.createElement('apex-grid-ai') as ApexGridAI;
    ai.mode = 'dialog';
    ai.grid = grid as unknown as ApexGridAI['grid'];
    document.body.appendChild(ai);
    panel = ai;
    ai.show();
    await ai.updateComplete;
    expect(ai.matches(':focus-within'), 'focus moved into the dialog').to.be.true;
  },
  async close() {
    panel!.close();
  },
};

const chartDialog: Overlay = {
  name: 'chart dialog',
  async open(grid) {
    const chart = document.createElement('apex-grid-chart') as ApexGridChart;
    chart.mode = 'dialog';
    chart.grid = grid as never;
    document.body.appendChild(chart);
    panel = chart;
    chart.show();
    await chart.updateComplete;
    await chart.updateComplete;
    expect(chart.matches(':focus-within'), 'focus moved into the dialog').to.be.true;
  },
  async close() {
    panel!.close();
  },
};

describe('Focus return after the rows re-bind (restore by address)', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridAI.register();
    ApexGridChart.register();
  });
  afterEach(() => {
    for (const m of document.querySelectorAll('.apex-grid-context-menu')) m.remove();
    panel?.remove();
    panel = null;
    fixtureCleanup();
  });

  for (const overlay of [contextMenu, aiDialog, chartDialog]) {
    describe(overlay.name, () => {
      it('a sort while open: focus returns to the active cell, not the moved record', async () => {
        const grid = await mount(6);
        const opener = await activate(grid, 0);
        const record = opener.row.data;
        await overlay.open(grid, opener);

        grid.sort({ key: 'name', direction: 'descending' });
        await settle(grid);
        expect(grid.pageItems.indexOf(record), 'the record moved').to.equal(5);
        const before = grid.scrollTop;

        await overlay.close();
        await settle(grid);
        expectOnActiveCell(grid);
        expect(grid.scrollTop, 'no scroll jump').to.equal(before);
      });

      it('a short scroll while open: focus returns to the opener and brings it into view', async () => {
        const grid = await mount(300);
        const opener = await activate(grid, 2);
        await overlay.open(grid, opener);

        // The opener's row stays rendered (in the overhang), out of view.
        const height = opener.row.getBoundingClientRect().height;
        grid.scrollTop = Math.round(height * 12);
        await settle(grid);
        expect(grid.scrollTop, 'the grid scrolled').to.be.greaterThan(0);
        expect(opener.row.index, 'the opener is still at its address').to.equal(2);
        expect(inView(grid, opener), 'the opener is out of view').to.be.false;

        await overlay.close();
        await settle(grid);
        expect(deepActive(), 'focus is on the opener').to.equal(opener);
        expectOnActiveCell(grid);
        expect(inView(grid, opener), 'the opener is back in view').to.be.true;
      });

      it('a long scroll while open: focus returns to the body, never another record', async () => {
        const grid = await mount(300);
        const opener = await activate(grid, 2);
        await overlay.open(grid, opener);

        // Far enough that row 2 leaves the rendered range and, under slot
        // keys, its element comes back as row 130.
        const height = opener.row.getBoundingClientRect().height;
        grid.scrollTop = Math.round(height * 126);
        await settle(grid);
        expect(
          grid.rows.some((r) => r.index === 2),
          'row 2 left the range'
        ).to.be.false;
        const before = grid.scrollTop;

        await overlay.close();
        await settle(grid);
        expect(deepActive(), 'focus is on the grid body').to.equal(internals(grid).scrollContainer);
        expect(grid.scrollTop, 'no scroll jump').to.equal(before);
      });
    });
  }
});
