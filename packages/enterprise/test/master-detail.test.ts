import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration, GridExpansionConfiguration } from 'apex-grid';
import {
  ApexGridAI,
  ApexGridChart,
  ApexGridEnterprise,
  enterpriseModules,
  type MasterDetailConfig,
} from '../src/index.js';

// No render animation: its async callbacks can outlive a removed chart.
(window as unknown as { Apex?: unknown }).Apex = { chart: { animations: { enabled: false } } };

// A type alias (not an interface) so it fits the default Record<string, unknown> detail row type.
type Item = {
  sku: string;
  qty: number;
};
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
const detailColumns: ColumnConfiguration<Record<string, unknown>>[] = [
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

/**
 * Detach `element`, let a frame and a task pass (so nothing treats it as a same-task move), then
 * attach it to `parent` (its old parent by default) and wait for it to update.
 */
async function reconnect(element: HTMLElement, parent = element.parentNode as ParentNode) {
  element.remove();
  await nextFrame();
  await new Promise((resolve) => setTimeout(resolve));
  parent.appendChild(element);
  await (element as HTMLElement & { updateComplete?: Promise<unknown> }).updateComplete;
  await nextFrame();
}

type EnterpriseDetail = ApexGridEnterprise<Item>;

/** The nested enterprise detail grids currently rendered. */
function enterpriseDetails(grid: ApexGridEnterprise<Order>): EnterpriseDetail[] {
  return deepQueryAll(grid.shadowRoot!, 'apex-grid-enterprise') as EnterpriseDetail[];
}

const chartDialogs = () => document.body.querySelectorAll('apex-grid-chart');

/** Open a Create chart dialog from `grid`'s toolbar. */
function createChart(grid: ApexGridEnterprise<never>) {
  grid.toolbarActions.find((action) => action.id === 'create-chart')!.run();
}

const activeNode = (grid: HTMLElement) =>
  (grid as unknown as { stateController: { active: { column: string; row: number } } })
    .stateController.active;

function bodyOf(grid: HTMLElement) {
  return grid.shadowRoot!.querySelector('apex-virtualizer') as HTMLElement;
}

describe('Master/detail', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridChart.register();
    ApexGridAI.register();
  });
  afterEach(() => {
    for (const el of chartDialogs()) el.remove();
    for (const el of document.body.querySelectorAll('apex-grid-ai')) el.remove();
    for (const el of document.body.querySelectorAll('[part^="chart-range-"]')) el.remove();
    fixtureCleanup();
  });

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

  it('lets ::part() style the detail panel and the detail grid', async () => {
    const style = document.createElement('style');
    style.textContent =
      'apex-grid-enterprise::part(master-detail),apex-grid-enterprise::part(detail-grid){outline:3px solid rgb(1, 2, 3)}';
    document.head.append(style);
    try {
      const grid = await mount({ columns: detailColumns, getDetailData: (order) => order.items });
      await grid.expandRow(orders[0]);
      await settle(grid);
      for (const part of ['master-detail', 'detail-grid']) {
        const [el] = deepQueryAll(grid.shadowRoot!, `[part="${part}"]`);
        expect(el, `${part} rendered`).to.exist;
        expect(getComputedStyle(el as HTMLElement).outlineColor, part).to.equal('rgb(1, 2, 3)');
      }
    } finally {
      style.remove();
    }
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

  it('logs no [apex-grid] warning when a detail grid renders', async () => {
    // biome-ignore lint/suspicious/noConsole: spying on the misconfiguration warning
    const original = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      const grid = await mount({ columns: detailColumns, getDetailData: (order) => order.items });
      await grid.expandRow(orders[0]);
      await settle(grid);
      await waitFor(() => detailGrids(grid).length > 0);
      await settle(grid);
      grid.refreshDetail(orders[0]);
      await settle(grid);
      await waitFor(() => detailGrids(grid).length > 0);
      await settle(grid);
      expect(detailGrids(grid)[0].style.display).to.equal('');
    } finally {
      console.warn = original;
    }
    expect(warnings.filter((line) => line.includes('[apex-grid]'))).to.eql([]);
  });

  describe('enterprise detail grids across a detach', () => {
    const many: Order[] = Array.from({ length: 200 }, (_, i) => ({
      id: i + 1,
      customer: `C${i + 1}`,
      items: [
        { sku: `S-${i}-a`, qty: 1 },
        { sku: `S-${i}-b`, qty: 2 },
        { sku: `S-${i}-c`, qty: 3 },
      ],
    }));

    async function mountEnterpriseDetail() {
      const grid = await fixture<ApexGridEnterprise<Order>>(
        html`<apex-grid-enterprise
          style="height:500px"
          .data=${many}
          .columns=${columns}
          .masterDetail=${
            {
              columns: detailColumns,
              getDetailData: (order: Order) => order.items,
              detailTag: 'apex-grid-enterprise',
            } as MasterDetailConfig<Order>
          }
        ></apex-grid-enterprise>`,
        { parentNode: sizedParent() }
      );
      await grid.updateComplete;
      await waitFor(() => deepQueryAll(grid.shadowRoot!, 'apex-grid-cell').length > 0);
      await grid.expandRow(many[0]);
      await settle(grid);
      await waitFor(() => enterpriseDetails(grid).length > 0);
      const detail = enterpriseDetails(grid)[0];
      await detail.updateComplete;
      await waitFor(() => deepQueryAll(detail.shadowRoot!, 'apex-grid-cell').length > 0);
      return { grid, detail };
    }

    async function assertWorking(detail: EnterpriseDetail) {
      await waitFor(() => deepQueryAll(detail.shadowRoot!, 'apex-grid-cell').length > 0);
      expect(
        detail.renderRoot.querySelector('[part~="license-watermark"]'),
        'watermark repainted'
      ).to.not.equal(null);
      const cell = deepQueryAll(detail.shadowRoot!, 'apex-grid-cell')[0] as HTMLElement;
      cell.click();
      await detail.updateComplete;
      const start = activeNode(detail).row;
      bodyOf(detail).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true })
      );
      await detail.updateComplete;
      expect(activeNode(detail).row, 'keyboard navigation moves').to.equal(start + 1);
    }

    it('a detached and re-attached detail grid keeps its chart dialog and still works', async () => {
      const { detail } = await mountEnterpriseDetail();
      createChart(detail as unknown as ApexGridEnterprise<never>);
      await nextFrame();
      const dialog = chartDialogs()[0] as ApexGridChart;
      expect(dialog?.isConnected).to.equal(true);

      await reconnect(detail);
      expect(dialog.isConnected, 'dialog back after re-attach').to.equal(true);
      expect(dialog.open).to.equal(true);
      expect(chartDialogs().length).to.equal(1);
      await assertWorking(detail);
    });

    it('scrolling the master past an expanded row and back keeps the detail working', async () => {
      const { grid, detail } = await mountEnterpriseDetail();
      createChart(detail as unknown as ApexGridEnterprise<never>);
      await nextFrame();
      const dialog = chartDialogs()[0] as ApexGridChart;

      grid.scrollTop = 4000;
      await waitFor(() => !detail.isConnected);
      await settle(grid);
      await new Promise((resolve) => setTimeout(resolve));
      expect(detail.isConnected, 'detail scrolled out').to.equal(false);
      expect(dialog.isConnected, 'dialog hidden with its grid').to.equal(false);

      grid.scrollTop = 0;
      await waitFor(() => detail.isConnected);
      await settle(grid);
      expect(detail.isConnected, 'detail back').to.equal(true);
      expect(dialog.isConnected, 'dialog back with its grid').to.equal(true);
      expect(dialog.open).to.equal(true);
      expect(chartDialogs().length).to.equal(1);
      await assertWorking(detail);
    });

    it('a top-level grid detached for a while gets its chart dialog back', async () => {
      const { grid } = await mountEnterpriseDetail();
      createChart(grid as unknown as ApexGridEnterprise<never>);
      await nextFrame();
      const dialog = chartDialogs()[0] as ApexGridChart;
      const parent = grid.parentNode as ParentNode;
      grid.remove();
      await nextFrame();
      expect(dialog.isConnected).to.equal(false);
      parent.appendChild(grid);
      await grid.updateComplete;
      expect(dialog.isConnected, 'restored on a later re-attach').to.equal(true);
    });

    it('a charted range outline leaves and returns with its grid', async () => {
      const { grid } = await mountEnterpriseDetail();
      grid.selectRange({ row: 2, column: 'id' }, { row: 4, column: 'customer' });
      grid.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'F1', altKey: true, bubbles: true, cancelable: true })
      );
      await nextFrame();
      const outlines = () => document.body.querySelectorAll('[part="chart-range-outline"]');
      expect(outlines().length, 'outline drawn').to.equal(1);
      const parent = grid.parentNode as ParentNode;
      grid.remove();
      await nextFrame();
      expect(outlines().length, 'outline off the page with its grid').to.equal(0);
      expect(chartDialogs().length).to.equal(0);
      parent.appendChild(grid);
      await grid.updateComplete;
      expect(outlines().length, 'outline back').to.equal(1);
      expect(chartDialogs().length).to.equal(1);
    });

    it('an Ask AI request cut off by a detach shows no error when the dialog returns', async () => {
      const { grid } = await mountEnterpriseDetail();
      let fail: Error | null = null;
      // A request that only settles when it is aborted, or with `fail` once that is set.
      (grid as unknown as { runPrompt: unknown }).runPrompt = (
        _prompt: string,
        options: { signal: AbortSignal }
      ) =>
        fail
          ? Promise.reject(fail)
          : new Promise((_resolve, reject) => {
              options.signal.addEventListener('abort', () =>
                reject(new DOMException('The operation was aborted.', 'AbortError'))
              );
            });
      grid.toolbarActions.find((action) => action.id === 'ask-ai')!.run();
      await nextFrame();
      const dialog = document.body.querySelector('apex-grid-ai') as ApexGridAI;
      await dialog.updateComplete;
      const send = async () => {
        const input = dialog.renderRoot.querySelector('[part="input"]') as HTMLTextAreaElement;
        input.value = 'sort by id';
        input.dispatchEvent(new Event('input'));
        await dialog.updateComplete;
        (dialog.renderRoot.querySelector('[part="send"]') as HTMLButtonElement).click();
        await dialog.updateComplete;
      };
      const error = () => dialog.renderRoot.querySelector('[part="error"]');

      await send();
      expect(dialog.renderRoot.querySelector('[part="notice"]'), 'request in flight').to.not.equal(
        null
      );
      await reconnect(grid);
      await dialog.updateComplete;
      expect(dialog.isConnected, 'dialog back with its grid').to.equal(true);
      expect(error(), 'no abort message after the park').to.equal(null);

      // A real failure still shows.
      fail = new Error('boom');
      await send();
      await dialog.updateComplete;
      expect(error()?.textContent).to.contain('boom');
    });
  });
});
