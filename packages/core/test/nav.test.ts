import {
  aTimeout,
  elementUpdated,
  expect,
  fixture,
  fixtureCleanup,
  html,
  nextFrame,
} from '@open-wc/testing';
import { sendKeys } from '@web/test-runner-commands';
import type ApexGridCell from '../src/components/cell.js';
import { ApexGrid } from '../src/components/grid.js';
import type ApexGridRow from '../src/components/row.js';
import type ApexVirtualizer from '../src/components/virtualizer.js';
import type { StateController } from '../src/controllers/state.js';
import { SENTINEL_NODE } from '../src/internal/constants.js';
import type { ColumnConfiguration } from '../src/internal/types.js';

/**
 * Keyboard navigation: per-grid state, revalidation of the active cell after
 * view changes, long jumps through the virtualized body, sticky chrome and
 * keyboard entry.
 */

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

async function mount<T extends object>(
  template: ReturnType<typeof html>,
  style: Partial<CSSStyleDeclaration> = { height: '400px', width: '600px' }
) {
  ApexGrid.register();
  const parentNode = document.createElement('div');
  Object.assign(parentNode.style, style);
  const grid = await fixture<ApexGrid<T>>(template, { parentNode });
  // An empty body never completes a layout, so the wait is bounded.
  await Promise.race([body(grid).layoutComplete, aTimeout(300)]);
  await settle(grid);
  return grid;
}

function renderedRows<T extends object>(grid: ApexGrid<T>): ApexGridRow<T>[] {
  return Array.from(body(grid).querySelectorAll('apex-grid-row')) as unknown as ApexGridRow<T>[];
}

function cellAt<T extends object>(grid: ApexGrid<T>, row: number, key: string) {
  const el = renderedRows(grid).find((r) => r.index === row);
  return el?.cells.find((c) => c.column.key === key) as ApexGridCell<T> | undefined;
}

function deepActive(): Element | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

/** Elements in the body that are in the tab order (exactly one is the roving model). */
function bodyTabStops<T extends object>(grid: ApexGrid<T>): number {
  let stops = body(grid).tabIndex === 0 ? 1 : 0;
  for (const row of renderedRows(grid)) {
    for (const cell of row.cells) if ((cell as HTMLElement).tabIndex === 0) stops++;
  }
  return stops;
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
    expect(activeOf(b)).to.deep.equal({ column: 'id', row: 0 });
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

describe('The active cell is revalidated after view changes', () => {
  it('a filter that drops the active row clamps it to the last row', async () => {
    const grid = await mount<Row>(
      html`<apex-grid .data=${makeRows(10)} .columns=${COLUMNS}></apex-grid>`
    );
    cellAt(grid, 6, 'name')!.click();
    await settle(grid);
    expect(bodyTabStops(grid)).to.equal(1);

    grid.filter({ key: 'id', condition: 'lessThan', searchTerm: 2 } as never);
    await settle(grid);
    expect(grid.pageItems.length).to.equal(2);
    expect(activeOf(grid)).to.deep.equal({ column: 'name', row: 1 });
    expect(bodyTabStops(grid), 'one body tab stop after the filter').to.equal(1);
    expect(cellAt(grid, 1, 'name')!.tabIndex).to.equal(0);
  });

  it('emptying the data clears the active cell and gives the tab stop back to the body', async () => {
    const grid = await mount<Row>(
      html`<apex-grid .data=${makeRows(10)} .columns=${COLUMNS}></apex-grid>`
    );
    cellAt(grid, 3, 'id')!.click();
    await settle(grid);
    grid.data = [];
    await settle(grid);
    expect(internals(grid).stateController.active).to.equal(SENTINEL_NODE);
    expect(body(grid).tabIndex).to.equal(0);
  });

  it('ArrowDown on an empty grid leaves no active cell', async () => {
    const grid = await mount<Row>(html`<apex-grid .data=${[]} .columns=${COLUMNS}></apex-grid>`);
    press(body(grid), 'ArrowDown');
    press(body(grid), 'PageDown');
    press(body(grid), 'End', { ctrlKey: true });
    await settle(grid);
    expect(internals(grid).stateController.active).to.equal(SENTINEL_NODE);
    expect(body(grid).tabIndex).to.equal(0);
  });

  it('hiding the active column moves to the nearest visible column', async () => {
    const grid = await mount<Row>(
      html`<apex-grid .data=${makeRows(10)} .columns=${COLUMNS}></apex-grid>`
    );
    cellAt(grid, 2, 'name')!.click();
    await settle(grid);
    grid.updateColumns({ key: 'name', hidden: true });
    await settle(grid);
    expect(activeOf(grid).row).to.equal(2);
    expect(['id', 'age']).to.include(activeOf(grid).column);
    expect(bodyTabStops(grid)).to.equal(1);
  });

  it('ArrowLeft / ArrowRight do not throw when every column is hidden', async () => {
    const grid = await mount<Row>(
      html`<apex-grid .data=${makeRows(10)} .columns=${COLUMNS}></apex-grid>`
    );
    cellAt(grid, 0, 'id')!.click();
    await settle(grid);
    grid.updateColumns(COLUMNS.map((c) => ({ key: c.key, hidden: true })));
    await settle(grid);
    expect(() => {
      press(body(grid), 'ArrowRight');
      press(body(grid), 'ArrowLeft');
      press(body(grid), 'Home');
      press(body(grid), 'End');
    }).to.not.throw();
    await settle(grid);
    expect(internals(grid).stateController.active).to.equal(SENTINEL_NODE);
  });
});

describe('Keyboard entry', () => {
  it('the first arrow key after tabbing into the body activates the first cell', async () => {
    const grid = await mount<Row>(
      html`<apex-grid .data=${makeRows(10)} .columns=${COLUMNS}></apex-grid>`
    );
    body(grid).focus();
    press(body(grid), 'ArrowDown');
    await settle(grid);
    expect(activeOf(grid)).to.deep.equal({ column: 'id', row: 0 });
    await waitFor(() => deepActive() === cellAt(grid, 0, 'id'));
    expect(deepActive()).to.equal(cellAt(grid, 0, 'id'));
  });

  it('ArrowRight on entry also lands on the first cell', async () => {
    const grid = await mount<Row>(
      html`<apex-grid .data=${makeRows(10)} .columns=${COLUMNS}></apex-grid>`
    );
    body(grid).focus();
    press(body(grid), 'ArrowRight');
    await settle(grid);
    expect(activeOf(grid)).to.deep.equal({ column: 'id', row: 0 });
  });

  it('the entry cell takes the tab stop, so Shift+Tab leaves the body', async () => {
    const sortable = COLUMNS.map((c) => ({ ...c, sort: true }));
    const grid = await mount<Row>(
      html`<apex-grid .data=${makeRows(100)} .columns=${sortable}></apex-grid>`,
      { height: '400px', width: '500px' }
    );
    body(grid).focus();
    press(body(grid), 'ArrowDown');
    const cell = () => cellAt(grid, 0, 'id')!;
    await waitFor(() => deepActive() === cell());
    await settle(grid);
    expect(cell().active, 'the entry cell renders as active').to.be.true;
    expect(cell().tabIndex).to.equal(0);
    expect(body(grid).tabIndex).to.equal(-1);
    expect(bodyTabStops(grid)).to.equal(1);

    await sendKeys({ press: 'Shift+Tab' });
    await settle(grid);
    const outside = deepActive();
    expect(outside?.tagName, 'focus left the body').to.not.equal('APEX-GRID-CELL');
    expect(outside).to.not.equal(body(grid));

    await sendKeys({ press: 'Tab' });
    await settle(grid);
    expect(deepActive()).to.equal(cell());
  });

  it('End and PageDown on entry move from the first cell', async () => {
    const grid = await mount<Row>(
      html`<apex-grid .data=${makeRows(100)} .columns=${COLUMNS}></apex-grid>`
    );
    body(grid).focus();
    press(body(grid), 'End');
    await settle(grid);
    expect(activeOf(grid)).to.deep.equal({ column: 'age', row: 0 });

    fixtureCleanup();
    const other = await mount<Row>(
      html`<apex-grid .data=${makeRows(100)} .columns=${COLUMNS}></apex-grid>`
    );
    body(other).focus();
    press(body(other), 'PageDown');
    await settle(other);
    expect(activeOf(other).column).to.equal('id');
    expect(activeOf(other).row).to.be.greaterThan(0);
  });
});

describe('Long jumps through the virtualized body', () => {
  const tall = () =>
    mount<Row>(html`<apex-grid .data=${makeRows(300)} .columns=${COLUMNS}></apex-grid>`);

  it('Ctrl+End renders the last row and focuses its last cell', async () => {
    const grid = await tall();
    cellAt(grid, 0, 'id')!.click();
    await settle(grid);
    press(body(grid), 'End', { ctrlKey: true });
    await waitFor(() => deepActive() === cellAt(grid, 299, 'age'));
    expect(renderedRows(grid).length, 'rows rendered').to.be.greaterThan(0);
    expect(renderedRows(grid).map((r) => r.index)).to.include(299);
    expect(deepActive()).to.equal(cellAt(grid, 299, 'age'));
  });

  it('Ctrl+Home from the bottom renders the first row and focuses it', async () => {
    const grid = await tall();
    cellAt(grid, 0, 'id')!.click();
    await settle(grid);
    press(body(grid), 'End', { ctrlKey: true });
    await waitFor(() => deepActive() === cellAt(grid, 299, 'age'));
    press(deepActive()!, 'Home', { ctrlKey: true });
    await waitFor(() => deepActive() === cellAt(grid, 0, 'id'));
    expect(renderedRows(grid).map((r) => r.index)).to.include(0);
    expect(deepActive()).to.equal(cellAt(grid, 0, 'id'));
    expect((grid as unknown as HTMLElement).scrollTop).to.equal(0);
  });

  it('PageDown moves by the rows that fit in the viewport', async () => {
    const grid = await mount<Row>(
      html`<apex-grid .data=${makeRows(200)} .columns=${COLUMNS}></apex-grid>`,
      { height: '1200px', width: '600px' }
    );
    cellAt(grid, 0, 'id')!.click();
    await settle(grid);
    const rowHeight = renderedRows(grid)[0].offsetHeight;
    const host = grid as unknown as HTMLElement;
    press(body(grid), 'PageDown');
    await settle(grid);
    const step = activeOf(grid).row;
    // Some 30 rows fit a 1200px grid; the old fixed step was 10.
    expect(step).to.be.greaterThan(10);
    expect(step).to.be.below(Math.ceil(host.clientHeight / rowHeight));
  });

  it('scrolling the active row away keeps focus in the grid and one tab stop', async () => {
    const grid = await mount<Row>(
      html`<apex-grid .data=${makeRows(2000)} .columns=${COLUMNS}></apex-grid>`
    );
    const cell = cellAt(grid, 0, 'id')!;
    cell.click();
    await settle(grid);
    expect(deepActive()).to.equal(cell);

    const host = grid as unknown as HTMLElement;
    host.scrollTop = 20000;
    await waitFor(() => !renderedRows(grid).some((r) => r.index === 0));
    await settle(grid);
    expect(deepActive(), 'focus moved to the scroll container').to.equal(body(grid));
    expect(body(grid).tabIndex).to.equal(0);
    expect(bodyTabStops(grid)).to.equal(1);

    press(body(grid), 'ArrowDown');
    await waitFor(() => deepActive() === cellAt(grid, 1, 'id'));
    expect(activeOf(grid)).to.deep.equal({ column: 'id', row: 1 });
    expect(deepActive()).to.equal(cellAt(grid, 1, 'id'));
  });
});

describe('Keyboard scrolling clears the sticky chrome', () => {
  it('ArrowUp does not park the active row under the sticky header', async () => {
    const grid = await mount<Row>(
      html`<apex-grid .data=${makeRows(2000)} .columns=${COLUMNS}></apex-grid>`
    );
    (grid as unknown as HTMLElement).scrollTop = 3000;
    await settle(grid, 4);
    const header = grid.renderRoot.querySelector('apex-grid-header-row') as HTMLElement;
    const headerBottom = header.getBoundingClientRect().bottom;
    const first = renderedRows(grid)
      .filter((r) => r.getBoundingClientRect().top >= headerBottom - 0.5)
      .sort((x, y) => x.getBoundingClientRect().top - y.getBoundingClientRect().top)[0];
    (first.cells[0] as HTMLElement).click();
    await settle(grid);
    press(body(grid), 'ArrowUp');
    await settle(grid);
    press(body(grid), 'ArrowUp');
    await settle(grid);

    const node = activeOf(grid);
    const top = cellAt(grid, node.row, String(node.column))!.getBoundingClientRect().top;
    expect(top).to.be.at.least(header.getBoundingClientRect().bottom - 1);
  });

  it('ArrowLeft does not park the active cell under a start-pinned column', async () => {
    type Wide = Record<string, number>;
    const cols = Array.from({ length: 30 }, (_, i) => ({
      key: `c${i}`,
      width: '150px',
      ...(i === 0 ? { pinned: 'start' as const } : {}),
    }));
    const rows = Array.from({ length: 50 }, (_, r) =>
      Object.fromEntries(cols.map((c, i) => [c.key, r * 100 + i]))
    );
    const grid = await mount<Wide>(html`<apex-grid .data=${rows} .columns=${cols}></apex-grid>`, {
      height: '400px',
      width: '800px',
    });
    (grid as unknown as HTMLElement).scrollLeft = 1500;
    await settle(grid, 4);
    const row = renderedRows(grid)[0];
    const pinnedRight = (row.cells[0] as HTMLElement).getBoundingClientRect().right;
    const target = (row.cells.slice(1) as HTMLElement[])
      .filter((c) => c.getBoundingClientRect().left >= pinnedRight - 0.5)
      .sort((x, y) => x.getBoundingClientRect().left - y.getBoundingClientRect().left)[0];
    target.click();
    await settle(grid);
    press(body(grid), 'ArrowLeft');
    await settle(grid);
    press(body(grid), 'ArrowLeft');
    await settle(grid);

    const node = activeOf(grid);
    const left = cellAt(grid, node.row, String(node.column))!.getBoundingClientRect().left;
    const edge = (renderedRows(grid)[0].cells[0] as HTMLElement).getBoundingClientRect().right;
    expect(left).to.be.at.least(edge - 1);
  });
});

describe('Keyboard scroll insets do not outlive the keyboard scroll', () => {
  const sortable = COLUMNS.map((c) => ({ ...c, sort: true }));

  async function scrolledByKeyboard() {
    const grid = await mount<Row>(
      html`<apex-grid .data=${makeRows(500)} .columns=${sortable}></apex-grid>`,
      { height: '400px', width: '500px' }
    );
    cellAt(grid, 0, 'id')!.click();
    await settle(grid);
    for (let i = 0; i < 30; i++) {
      press(deepActive()!, 'ArrowDown');
      await settle(grid, 1);
    }
    await waitFor(() => deepActive() === cellAt(grid, 30, 'id'));
    await settle(grid);
    const host = grid as unknown as HTMLElement;
    expect(host.scrollTop, 'the body scrolled').to.be.greaterThan(0);
    expect(host.style.scrollPadding, 'no padding left on the host').to.equal('');
    return { grid, host };
  }

  function headerButton<T extends object>(grid: ApexGrid<T>): HTMLButtonElement {
    const headerRow = grid.renderRoot.querySelector('apex-grid-header-row')!;
    const header = headerRow.shadowRoot!.querySelector('apex-grid-header')!;
    return header.shadowRoot!.querySelector('button')!;
  }

  it('focusing a header button after keyboard navigation leaves the body scroll alone', async () => {
    const { grid, host } = await scrolledByKeyboard();
    const before = host.scrollTop;
    headerButton(grid).focus();
    await settle(grid);
    expect(host.scrollTop).to.equal(before);
  });

  it('Shift+Tab from the active cell to the header leaves the body scroll alone', async () => {
    const { grid, host } = await scrolledByKeyboard();
    const before = host.scrollTop;
    await sendKeys({ press: 'Shift+Tab' });
    await settle(grid);
    expect(deepActive()).to.not.equal(cellAt(grid, 30, 'id'));
    expect(host.scrollTop).to.equal(before);
  });
});
