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
import { ApexGrid } from '../src/components/grid.js';
import type ApexVirtualizer from '../src/components/virtualizer.js';
import type { StateController } from '../src/controllers/state.js';
import type { ColumnConfiguration } from '../src/internal/types.js';

/**
 * `showHeader = false` (GitHub #35): the header rows leave the layout and the
 * paint, stay in the accessibility tree, never take keyboard focus, and the
 * sort, filter, widths and page come back unchanged when the header returns.
 */

type Row = { region: string; sales: number };
const ROWS: Row[] = [
  { region: 'East', sales: 120 },
  { region: 'West', sales: 80 },
  { region: 'North', sales: 95 },
  { region: 'South', sales: 60 },
];
const COLUMNS: ColumnConfiguration<Row>[] = [
  { key: 'region', headerText: 'Region', sort: true, filter: true, resizable: true },
  { key: 'sales', headerText: 'Sales', type: 'number', sort: true, filter: true },
];

type Internals = { scrollContainer: ApexVirtualizer; stateController: StateController<Row> };
const internals = (grid: ApexGrid<Row>) => grid as unknown as Internals;
const shadow = (grid: ApexGrid<Row>) => grid.renderRoot as ShadowRoot;
const headerRow = (grid: ApexGrid<Row>) =>
  shadow(grid).querySelector<HTMLElement>('apex-grid-header-row')!;
const groupHeaderRow = (grid: ApexGrid<Row>) =>
  shadow(grid).querySelector<HTMLElement>('apex-grid-group-header-row');
const bodyRows = (grid: ApexGrid<Row>) =>
  Array.from(shadow(grid).querySelectorAll<HTMLElement>('apex-virtualizer apex-grid-row'));
const headerCells = (grid: ApexGrid<Row>) =>
  Array.from(headerRow(grid).shadowRoot!.querySelectorAll<HTMLElement>('apex-grid-header'));

async function settle(grid: HTMLElement, frames = 4) {
  await elementUpdated(grid);
  for (let i = 0; i < frames; i++) await nextFrame();
}

async function mount(
  template: ReturnType<typeof html>,
  style: Partial<CSSStyleDeclaration> = { height: '120px', width: '360px' }
) {
  ApexGrid.register();
  const parentNode = document.createElement('div');
  Object.assign(parentNode.style, style);
  const grid = await fixture<ApexGrid<Row>>(template, { parentNode });
  await Promise.race([internals(grid).scrollContainer.layoutComplete, aTimeout(300)]);
  await settle(grid);
  return grid;
}

const plain = () =>
  mount(html`<apex-grid
    style="height: 120px; min-height: 0; width: 360px"
    .data=${ROWS.map((r) => ({ ...r }))}
    .columns=${COLUMNS.map((c) => ({ ...c }))}
  ></apex-grid>`);

/** Rows whose whole box is inside the grid's client box. */
function rowsInView(grid: ApexGrid<Row>) {
  const box = grid.getBoundingClientRect();
  const bottom = box.top + grid.clientTop + grid.clientHeight;
  return bodyRows(grid).filter((row) => row.getBoundingClientRect().bottom <= bottom + 0.5).length;
}

function deepActive(): Element | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

/** Whether `node` sits in `container`'s light or shadow subtree. */
function within(node: Node | null, container: Element): boolean {
  let current: Node | null = node;
  while (current) {
    if (current === container) return true;
    current = current.parentNode ?? (current instanceof ShadowRoot ? current.host : null);
  }
  return false;
}

afterEach(() => fixtureCleanup());

describe('showHeader', () => {
  it('is a property, true by default, and show-header="false" turns it off', async () => {
    const grid = await plain();
    expect('showHeader' in ApexGrid.prototype).to.be.true;
    expect(grid.showHeader).to.be.true;

    grid.setAttribute('show-header', 'false');
    expect(grid.showHeader).to.be.false;
    grid.removeAttribute('show-header');
    expect(grid.showHeader).to.be.true;
    grid.setAttribute('show-header', '');
    expect(grid.showHeader).to.be.true;
  });

  it('hands the header room to the rows in a 120 px grid', async () => {
    const grid = await plain();
    const withHeader = rowsInView(grid);
    expect(headerRow(grid).getBoundingClientRect().height).to.be.greaterThan(20);

    grid.showHeader = false;
    await settle(grid);

    const top = grid.getBoundingClientRect().top + grid.clientTop;
    const first = bodyRows(grid).find((row) => (row as unknown as { index: number }).index === 0)!;
    expect(first.getBoundingClientRect().top - top, 'first row starts at the top').to.be.at.most(
      0.5
    );
    expect(rowsInView(grid)).to.be.greaterThan(withHeader);

    // Nothing of the header is hit at the spot it used to occupy.
    const left = grid.getBoundingClientRect().left + 20;
    const hit = shadow(grid).elementFromPoint(left, top + 5);
    expect(hit === headerRow(grid), 'header takes no pointer').to.be.false;
    expect(getComputedStyle(headerRow(grid)).clipPath).to.not.equal('none');

    grid.showHeader = true;
    await settle(grid);
    expect(rowsInView(grid)).to.equal(withHeader);
  });

  it('keeps the column header row in the accessibility tree', async () => {
    const grid = await plain();
    const table = shadow(grid).querySelector<HTMLElement>('[part~="table"]')!;
    const rowcount = table.getAttribute('aria-rowcount');
    const firstIndex = bodyRows(grid)[0].getAttribute('aria-rowindex');

    grid.showHeader = false;
    await settle(grid);

    const row = headerRow(grid);
    expect(within(row, table), 'header row stays inside the grid role').to.be.true;
    expect(row.getAttribute('role')).to.equal('row');
    expect(row.getAttribute('aria-rowindex')).to.equal('1');
    expect(row.hasAttribute('aria-hidden')).to.be.false;
    expect(row.inert).to.be.false;
    expect(getComputedStyle(row).display).to.not.equal('none');
    expect(getComputedStyle(row).visibility).to.equal('visible');
    // The column names stay exposed; only the controls leave the tree.
    const names = headerCells(grid).map((cell) => {
      expect(cell.getAttribute('role')).to.equal('columnheader');
      expect(getComputedStyle(cell).visibility).to.equal('visible');
      const title = cell.shadowRoot!.querySelector<HTMLElement>('[part~="title"]')!;
      expect(getComputedStyle(title).visibility).to.equal('visible');
      const actions = cell.shadowRoot!.querySelector<HTMLElement>('[part~="actions"]')!;
      expect(getComputedStyle(actions).visibility).to.equal('hidden');
      return title.textContent!.trim();
    });
    expect(names).to.deep.equal(['Region', 'Sales']);
    expect(table.getAttribute('aria-rowcount')).to.equal(rowcount);
    expect(bodyRows(grid)[0].getAttribute('aria-rowindex')).to.equal(firstIndex);
  });

  it('leaves the header out of the tab order and arrow keys never enter it', async () => {
    ApexGrid.register();
    const wrap = await fixture<HTMLDivElement>(html`<div>
      <button id="before">before</button>
      <apex-grid
        style="height: 200px; width: 360px"
        .showHeader=${false}
        .selection=${{ enabled: true, mode: 'multiple', showCheckboxColumn: true }}
        .data=${ROWS.map((r) => ({ ...r }))}
        .columns=${COLUMNS.map((c) => ({ ...c }))}
      ></apex-grid>
    </div>`);
    const grid = wrap.querySelector('apex-grid') as ApexGrid<Row>;
    await Promise.race([internals(grid).scrollContainer.layoutComplete, aTimeout(300)]);
    await settle(grid);

    wrap.querySelector<HTMLButtonElement>('#before')!.focus();
    await sendKeys({ press: 'Tab' });
    await settle(grid);
    expect(within(deepActive(), grid), 'Tab moved into the grid').to.be.true;
    expect(within(deepActive(), headerRow(grid)), 'Tab skipped the header').to.be.false;

    // From the first body row ArrowUp stays in the body.
    const body = internals(grid).scrollContainer;
    body.focus();
    await sendKeys({ press: 'ArrowDown' });
    await settle(grid);
    expect(internals(grid).stateController.active.row).to.equal(0);
    await sendKeys({ press: 'ArrowUp' });
    await settle(grid);
    expect(internals(grid).stateController.active.row).to.equal(0);
    expect(within(deepActive(), headerRow(grid))).to.be.false;

    // Shift+Tab from the body skips the header too.
    await sendKeys({ press: 'Shift+Tab' });
    await settle(grid);
    expect(within(deepActive(), headerRow(grid)), 'Shift+Tab skipped the header').to.be.false;
  });

  it('keeps sort, filter, widths and the page across a hide and show', async () => {
    const grid = await mount(
      html`<apex-grid
        style="height: 300px; width: 360px"
        .pagination=${{ enabled: true, pageSize: 2 }}
        .data=${ROWS.map((r) => ({ ...r }))}
        .columns=${COLUMNS.map((c) => ({ ...c }))}
      ></apex-grid>`,
      { height: '300px', width: '360px' }
    );
    grid.sort({ key: 'sales', direction: 'descending' });
    grid.filter({ key: 'region', condition: 'contains', searchTerm: 't' } as never);
    await settle(grid);
    grid.page = 1;
    await settle(grid);

    const widths = headerCells(grid).map((cell) => cell.getBoundingClientRect().width);
    const sort = JSON.stringify(grid.sortExpressions);
    const filter = JSON.stringify(grid.filterExpressions);
    const page = grid.page;
    const items = grid.pageItems.map((r) => r.region);
    expect(items.length).to.be.greaterThan(0);

    grid.showHeader = false;
    await settle(grid);
    expect(grid.page).to.equal(page);
    expect(grid.pageItems.map((r) => r.region)).to.deep.equal(items);
    // The header still tells assistive technology the sort.
    expect(headerCells(grid)[1].getAttribute('aria-sort')).to.equal('descending');

    grid.showHeader = true;
    await settle(grid);
    expect(JSON.stringify(grid.sortExpressions)).to.equal(sort);
    expect(JSON.stringify(grid.filterExpressions)).to.equal(filter);
    expect(grid.page).to.equal(page);
    expect(grid.pageItems.map((r) => r.region)).to.deep.equal(items);
    expect(headerCells(grid).map((cell) => cell.getBoundingClientRect().width)).to.deep.equal(
      widths
    );
    expect(headerCells(grid)[1].getAttribute('aria-sort')).to.equal('descending');
  });

  it('takes the group header and the filter panel with it and closes up the sticky bands', async () => {
    const data = ROWS.map((r) => ({ ...r }));
    const grid = await mount(
      html`<apex-grid
        style="height: 300px; width: 360px"
        show-quick-filter
        .rowPinning=${{ enabled: true }}
        .columnGroups=${[{ id: 'all', headerText: 'All' }]}
        .data=${data}
        .columns=${COLUMNS.map((c) => ({ ...c, group: 'all' }))}
      ></apex-grid>`,
      { height: '300px', width: '360px' }
    );
    grid.pinRow(data[0], 'top');
    await settle(grid);
    expect(shadow(grid).querySelector('apex-filter-row')).to.exist;

    grid.showHeader = false;
    await settle(grid);

    expect(shadow(grid).querySelector('apex-filter-row'), 'filter panel goes').to.be.null;
    const group = groupHeaderRow(grid)!;
    expect(group, 'group header row stays for assistive technology').to.exist;
    expect(group.getAttribute('role')).to.equal('row');
    expect(getComputedStyle(group).clipPath).to.not.equal('none');

    const toolbar = shadow(grid).querySelector<HTMLElement>('apex-grid-toolbar')!;
    const band = shadow(grid).querySelector<HTMLElement>('[part~="pinned-top"]')!;
    expect(grid.style.getPropertyValue('--apex-row-top-pinned')).to.equal(
      `${toolbar.offsetHeight}px`
    );
    expect(
      Math.abs(band.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom)
    ).to.be.at.most(0.5);

    grid.showHeader = true;
    await settle(grid);
    expect(shadow(grid).querySelector('apex-filter-row'), 'filter panel returns').to.exist;
    const header = headerRow(grid);
    expect(getComputedStyle(header).clipPath).to.equal('none');
    expect(
      Math.abs(band.getBoundingClientRect().top - header.getBoundingClientRect().bottom)
    ).to.be.at.most(0.5);
  });

  it('closes an open column menu when the header hides', async () => {
    const grid = await plain();
    const cell = headerCells(grid)[0] as HTMLElement & { renderRoot: ShadowRoot };
    cell.renderRoot.querySelector<HTMLElement>('[part~="menu-btn"]')!.click();
    await settle(grid);
    const menu = () => cell.renderRoot.querySelector<HTMLElement>('[part="col-menu"]');
    expect(menu(), 'menu opened').to.exist;

    grid.showHeader = false;
    await settle(grid);
    await elementUpdated(cell);
    expect(menu(), 'menu closed with the header').to.be.null;

    grid.showHeader = true;
    await settle(grid);
    cell.renderRoot.querySelector<HTMLElement>('[part~="menu-btn"]')!.click();
    await settle(grid);
    expect(menu(), 'menu opens again').to.exist;
  });
});
