import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration, GridExpansionConfiguration } from 'apex-grid';
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

  describe('turning master/detail off', () => {
    it('stops expanding rows and renders no detail when set to null', async () => {
      const grid = await mount({ columns: detailColumns, getDetailData: (order) => order.items });
      await grid.expandRow(orders[0]);
      await settle(grid);
      await waitFor(() => detailGrids(grid).length > 0);
      expect(detailGrids(grid).length).to.equal(1);

      grid.masterDetail = null;
      await settle(grid);
      // Assert on primitives: a failing compare of a closure hangs the runner's serializer.
      expect(typeof grid.expansion?.detailTemplate, 'no detail template left').to.equal(
        'undefined'
      );
      expect(grid.expansion?.enabled ?? false, 'expansion off').to.be.false;
      expect(detailGrids(grid).length, 'expanded row renders no detail').to.equal(0);
      expect(await grid.expandRow(orders[1]), 'other rows not expandable').to.be.false;
    });

    it("restores the app's own expansion config it replaced", async () => {
      const own: GridExpansionConfiguration<Order> = {
        enabled: true,
        detailTemplate: () => html`<span class="own-detail">own</span>`,
      };
      const grid = await mount({ columns: detailColumns, getDetailData: (order) => order.items });
      grid.masterDetail = null;
      await settle(grid);
      grid.expansion = own;
      grid.masterDetail = { columns: detailColumns, getDetailData: (order) => order.items };
      await settle(grid);
      expect(grid.expansion === own).to.be.false;
      // Switching configs keeps the app's config as the one to restore.
      grid.masterDetail = { columns: detailColumns, getDetailData: () => [] };
      await settle(grid);
      grid.masterDetail = null;
      await settle(grid);
      expect(grid.expansion === own, 'own config restored').to.be.true;
    });

    it('leaves an expansion config the app set while master/detail was on', async () => {
      const grid = await mount({ columns: detailColumns, getDetailData: (order) => order.items });
      const own: GridExpansionConfiguration<Order> = { enabled: true, detailTemplate: () => 'x' };
      grid.expansion = own;
      await settle(grid);
      grid.masterDetail = null;
      await settle(grid);
      expect(grid.expansion === own, 'own config kept').to.be.true;
    });
  });

  describe('failed detail loads', () => {
    let unhandled: unknown[] = [];
    const onUnhandled = (event: PromiseRejectionEvent) => {
      unhandled.push(event.reason);
      event.preventDefault();
    };
    beforeEach(() => {
      unhandled = [];
      window.addEventListener('unhandledrejection', onUnhandled);
    });
    afterEach(() => window.removeEventListener('unhandledrejection', onUnhandled));

    async function expandAgain(grid: ApexGridEnterprise<Order>, row: Order) {
      await grid.collapseRow(row);
      await settle(grid);
      await grid.expandRow(row);
      await settle(grid);
    }

    const rowsOf = (grid: ApexGridEnterprise<Order>) => {
      const data = (detailGrids(grid)[0] as unknown as { data?: unknown } | undefined)?.data;
      return Array.isArray(data) ? (data as Item[]) : undefined;
    };

    it('handles a rejected getDetailData and retries on the next expand', async () => {
      let calls = 0;
      const grid = await mount({
        columns: detailColumns,
        getDetailData: (order) => {
          calls += 1;
          return calls === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(order.items);
        },
      });
      await grid.expandRow(orders[0]);
      await settle(grid);
      await waitFor(() => detailGrids(grid).length > 0);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled.length, 'no unhandled rejection').to.equal(0);
      expect(rowsOf(grid)?.length, 'empty detail after a failure').to.equal(0);
      await settle(grid);
      expect(calls, 'a failure is not retried while the detail stays open').to.equal(1);

      await expandAgain(grid, orders[0]);
      await waitFor(() => rowsOf(grid)?.length === orders[0].items.length);
      expect(calls).to.equal(2);
      expect(rowsOf(grid)?.map((item) => item.sku)).to.eql(['A-1', 'A-2']);
    });

    it('handles a getDetailData that throws, and retries on the next expand', async () => {
      let calls = 0;
      const grid = await mount({
        columns: detailColumns,
        getDetailData: (order) => {
          calls += 1;
          if (calls === 1) throw new Error('bad row');
          return order.items;
        },
      });
      await grid.expandRow(orders[0]);
      await settle(grid);
      await waitFor(() => detailGrids(grid).length > 0);
      expect(rowsOf(grid)?.length).to.equal(0);
      await expandAgain(grid, orders[0]);
      await waitFor(() => rowsOf(grid)?.length === orders[0].items.length);
      expect(calls).to.equal(2);
    });

    it('resolves a thenable that is not a native Promise', async () => {
      const grid = await mount({
        columns: detailColumns,
        getDetailData: (order) =>
          ({
            // biome-ignore lint/suspicious/noThenProperty: a hand-rolled thenable is the case under test
            then: (resolve: (rows: Item[]) => void) => resolve(order.items),
          }) as unknown as Promise<Item[]>,
      });
      await grid.expandRow(orders[0]);
      await waitFor(() => rowsOf(grid)?.length === orders[0].items.length);
      expect(rowsOf(grid)?.map((item) => item.sku)).to.eql(['A-1', 'A-2']);
    });
  });
});
