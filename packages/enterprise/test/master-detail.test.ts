import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { ApexGridEnterprise, type MasterDetailConfig } from '../src/index.js';

interface Item {
  sku: string;
  qty: number;
}
interface Order {
  id: number;
  customer: string;
  items: Item[];
}

const orders: Order[] = [
  {
    id: 1,
    customer: 'Acme',
    items: [
      { sku: 'A-1', qty: 2 },
      { sku: 'A-2', qty: 5 },
    ],
  },
  { id: 2, customer: 'Globex', items: [{ sku: 'B-1', qty: 1 }] },
];
const columns: ColumnConfiguration<Order>[] = [
  { key: 'id', type: 'number', headerText: 'ID' },
  { key: 'customer', headerText: 'Customer' },
];
const detailColumns: ColumnConfiguration<Item>[] = [
  { key: 'sku', headerText: 'SKU' },
  { key: 'qty', type: 'number', headerText: 'Qty' },
];

function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '600px';
  return node;
}

function deepQueryAll(root: ShadowRoot | Element, selector: string): Element[] {
  const out: Element[] = [];
  const visit = (node: ShadowRoot | Element) => {
    for (const el of node.querySelectorAll(selector)) out.push(el);
    for (const el of node.querySelectorAll('*')) if (el.shadowRoot) visit(el.shadowRoot);
  };
  visit(root);
  return out;
}

/** The nested detail grids currently rendered (community `<apex-grid>` children). */
function detailGrids(grid: ApexGridEnterprise<Order>): Array<HTMLElement & { data?: unknown }> {
  return deepQueryAll(grid.shadowRoot!, 'apex-grid') as Array<HTMLElement & { data?: unknown }>;
}

/** Poll up to `tries` animation frames until `predicate` holds. */
async function waitFor(predicate: () => boolean, tries = 30): Promise<void> {
  for (let i = 0; i < tries && !predicate(); i += 1) await nextFrame();
}

async function mount(config: MasterDetailConfig<Order>) {
  const grid = await fixture<ApexGridEnterprise<Order>>(
    html`<apex-grid-enterprise
      .data=${orders}
      .columns=${columns}
      .masterDetail=${config}
    ></apex-grid-enterprise>`,
    { parentNode: sizedParent() }
  );
  await grid.updateComplete;
  // The virtualizer paints body rows asynchronously; wait for the first cells.
  await waitFor(() => deepQueryAll(grid.shadowRoot!, 'apex-grid-cell').length > 0);
  return grid;
}

async function settle(grid: ApexGridEnterprise<Order>) {
  await grid.updateComplete;
  await nextFrame();
  await nextFrame();
}

describe('Master/detail', () => {
  before(() => ApexGridEnterprise.register());
  afterEach(() => fixtureCleanup());

  it('enables expansion and renders a nested detail grid on expand', async () => {
    const grid = await mount({ columns: detailColumns, getDetailData: (order) => order.items });
    expect(grid.expansion?.enabled, 'expansion auto-enabled').to.be.true;

    await grid.expandRow(orders[0]);
    await settle(grid);
    await waitFor(() => detailGrids(grid).length > 0);

    const panel = deepQueryAll(grid.shadowRoot!, '[part="master-detail"]');
    expect(panel.length, 'detail panel rendered').to.be.greaterThan(0);

    const grids = detailGrids(grid);
    expect(grids.length, 'a nested grid rendered').to.equal(1);
    const childData = (grids[0] as unknown as { data: Item[] }).data;
    expect(childData.map((item) => item.sku)).to.eql(['A-1', 'A-2']);
    expect(childData.map((item) => item.qty)).to.eql([2, 5]);
    const childColumns = (grids[0] as unknown as { columns: Array<{ key: string }> }).columns;
    expect(childColumns.map((column) => column.key)).to.eql(['sku', 'qty']);
  });

  it('populates the detail grid from async detail data', async () => {
    const grid = await mount({
      columns: detailColumns,
      getDetailData: (order) => Promise.resolve(order.items),
    });
    await grid.expandRow(orders[0]);
    await waitFor(() => {
      const grids = detailGrids(grid);
      const data = (grids[0] as unknown as { data?: Item[] } | undefined)?.data;
      return grids.length > 0 && Array.isArray(data) && data.length === orders[0].items.length;
    });

    const grids = detailGrids(grid);
    expect(grids.length).to.equal(1);
    expect((grids[0] as unknown as { data: Item[] }).data.map((item) => item.sku)).to.eql([
      'A-1',
      'A-2',
    ]);
  });

  it('runs configureDetail for the created grid with its master context', async () => {
    const calls: Array<{ row: Order; rowIndex: number }> = [];
    const grid = await mount({
      columns: detailColumns,
      getDetailData: (order) => order.items,
      configureDetail: (_grid, ctx) => calls.push({ row: ctx.data, rowIndex: ctx.rowIndex }),
    });
    await grid.expandRow(orders[1]);
    await waitFor(() => calls.length > 0);

    expect(calls.length).to.equal(1);
    expect(calls[0].row).to.equal(orders[1]);
  });

  it('gates expansion with isExpandable', async () => {
    const grid = await mount({
      columns: detailColumns,
      getDetailData: (order) => order.items,
      isExpandable: (order) => order.id === 1,
    });
    const expanded = await grid.expandRow(orders[1]); // id 2 -> not expandable
    await settle(grid);
    expect(expanded).to.be.false;
    expect(detailGrids(grid).length).to.equal(0);
  });

  it('caches the detail grid per row across collapse + re-expand', async () => {
    const calls: Order[] = [];
    const grid = await mount({
      columns: detailColumns,
      getDetailData: (order) => order.items,
      configureDetail: (_grid, ctx) => calls.push(ctx.data),
    });

    await grid.expandRow(orders[0]);
    await waitFor(() => calls.length > 0);
    await grid.collapseRow(orders[0]);
    await settle(grid);
    await grid.expandRow(orders[0]);
    await settle(grid);
    await waitFor(() => detailGrids(grid).length > 0);

    // The grid is built once and reused — configureDetail ran a single time.
    expect(calls.filter((row) => row === orders[0]).length).to.equal(1);
  });
});
