import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import { ApexGrid } from '../src/components/grid.js';
import type ApexGridPaginator from '../src/components/paginator.js';
import type { ColumnConfiguration } from '../src/internal/types.js';

type Row = { id: number; name: string };

const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Row ${i + 1}` }));

const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', headerText: 'Id', type: 'number' },
  { key: 'name', headerText: 'Name' },
];

async function settle(grid: ApexGrid<Row>) {
  await grid.updateComplete;
  await nextFrame();
  await grid.updateComplete;
  const pager = paginatorOf(grid);
  await pager?.updateComplete;
  await nextFrame();
}

async function mount(props: Partial<ApexGrid<Row>> = {}, style = 'height: 300px; width: 480px') {
  ApexGrid.register();
  const grid = await fixture<ApexGrid<Row>>(
    html`<apex-grid style=${style} .columns=${columns} .data=${rows(8)}></apex-grid>`
  );
  Object.assign(grid, props);
  await settle(grid);
  return grid;
}

function paginatorOf(grid: ApexGrid<Row>) {
  return grid.renderRoot.querySelector('apex-grid-paginator') as ApexGridPaginator<Row> | null;
}

function pagerPart(grid: ApexGrid<Row>, name: string) {
  return paginatorOf(grid)!.renderRoot.querySelector<HTMLElement>(`[part~="${name}"]`)!;
}

describe('Pagination contract', () => {
  afterEach(() => fixtureCleanup());

  describe('pipeline hook removal (core-types-4, gh-33, core-grid-props-5)', () => {
    it('a pagination hook is no longer part of DataPipelineConfiguration', async () => {
      let calls = 0;
      const grid = await mount({
        pagination: { enabled: true, pageSize: 3 },
        dataPipelineConfiguration: {
          // @ts-expect-error - the pagination hook was removed from the type
          pagination: () => {
            calls++;
            return [];
          },
        },
      });
      await grid.gotoPage(1);
      expect(calls).to.equal(0);
      expect(grid.pageItems.map((row) => row.id)).to.deep.equal([4, 5, 6]);
    });
  });

  describe('totalItems (gh-34, core-toolbar-paginator-5, core-grid-props-4)', () => {
    it('local mode: the post-filter, post-sort count, the same in every place', async () => {
      const grid = await mount({ pagination: { enabled: true, pageSize: 3 } });
      grid.quickFilter = 'Row';
      await settle(grid);
      const details: number[] = [];
      grid.addEventListener('pageChanged', (e) => details.push(e.detail.totalItems));
      await grid.gotoPage(1);
      await settle(grid);
      expect(grid.totalItems).to.equal(8);
      expect(details).to.deep.equal([8]);
      expect(pagerPart(grid, 'paginator-info').textContent?.trim()).to.equal('4-6 of 8');
    });

    it('remote mode: the pagination.totalItems you supplied, and no slicing', async () => {
      const grid = await mount({
        pagination: { enabled: true, mode: 'remote', pageSize: 5, totalItems: 50 },
      });
      expect(grid.totalItems).to.equal(50);
      expect(grid.pageCount).to.equal(10);
      expect(grid.pageItems.length).to.equal(8);
      const details: number[] = [];
      grid.addEventListener('pageChanged', (e) => details.push(e.detail.totalItems));
      await grid.gotoPage(3);
      expect(details).to.deep.equal([50]);
    });

    it('pinned rows do not count toward the pages, so no trailing page is empty', async () => {
      const grid = await mount({
        pagination: { enabled: true, pageSize: 4 },
        rowPinning: { enabled: true },
      });
      for (const row of grid.data.slice(0, 4)) await grid.pinRow(row, 'top');
      await settle(grid);
      expect(grid.pageCount).to.equal(1);
      expect(grid.totalItems).to.equal(4);
      expect(grid.pageItems.map((row) => row.id)).to.deep.equal([5, 6, 7, 8]);
      expect(pagerPart(grid, 'paginator-info').textContent?.trim()).to.equal('1-4 of 4');
      await grid.lastPage();
      expect(grid.pageItems.length).to.equal(4);
    });

    it('21 rows, one pinned, page size 10: two pages and the last one has rows', async () => {
      const grid = await mount({
        pagination: { enabled: true, pageSize: 10 },
        rowPinning: { enabled: true },
        data: rows(21),
      });
      await grid.pinRow(grid.data[0], 'top');
      await settle(grid);
      expect(grid.pageCount).to.equal(2);
      await grid.lastPage();
      expect(grid.pageItems.length).to.equal(10);
    });

    it('pinning a row on the last page moves to the new last page', async () => {
      const grid = await mount({
        pagination: { enabled: true, pageSize: 10 },
        rowPinning: { enabled: true },
        data: rows(21),
      });
      await grid.lastPage();
      expect(grid.page).to.equal(2);
      grid.pinRow(grid.data[0], 'top');
      await settle(grid);
      expect(grid.page).to.equal(1);
      expect(grid.pageCount).to.equal(2);
      expect(grid.pageItems.length).to.equal(10);
      expect(pagerPart(grid, 'paginator-page').textContent?.trim()).to.equal('2 / 2');
    });

    it('turning row pinning back on clamps a page past the new last page', async () => {
      const grid = await mount({
        pagination: { enabled: true, pageSize: 10 },
        rowPinning: { enabled: true },
        data: rows(21),
      });
      grid.pinRow(grid.data[0], 'top');
      grid.rowPinning = { enabled: false };
      await settle(grid);
      await grid.lastPage();
      expect(grid.page).to.equal(2);
      grid.rowPinning = { enabled: true };
      await settle(grid);
      expect(grid.page).to.equal(1);
      expect(grid.pageItems.length).to.equal(10);
    });

    it('without pagination totalItems still counts the pinned rows', async () => {
      const grid = await mount({ rowPinning: { enabled: true }, data: rows(21) });
      grid.pinRow(grid.data[0], 'top');
      await settle(grid);
      expect(grid.totalItems).to.equal(21);
      expect(grid.pageItems.length).to.equal(20);
    });
  });

  describe('paginator and toolbar behaviour', () => {
    it('core-toolbar-paginator-2: page changes do not rerun the data pipeline', async () => {
      let sorts = 0;
      let filters = 0;
      const grid = await mount({
        pagination: { enabled: true, pageSize: 2 },
        dataPipelineConfiguration: {
          sort: ({ data }) => {
            sorts++;
            return data;
          },
          filter: ({ data }) => {
            filters++;
            return data;
          },
        },
      });
      sorts = 0;
      filters = 0;
      await grid.gotoPage(1);
      await grid.nextPage();
      await grid.setPageSize(3);
      await grid.lastPage();
      expect(sorts, 'sort hook').to.equal(0);
      expect(filters, 'filter hook').to.equal(0);
      expect(grid.pageItems.map((row) => row.id)).to.deep.equal([7, 8]);
      expect(grid.rows.map((row) => row.data.id)).to.deep.equal([7, 8]);
    });

    it('core-toolbar-paginator-9: pageChanged reports each applied change', async () => {
      const grid = await mount({ pagination: { enabled: true, pageSize: 2 } });
      const pages: number[] = [];
      grid.addEventListener('pageChanged', (e) => pages.push(e.detail.page));
      const a = grid.nextPage();
      const b = grid.nextPage();
      await Promise.all([a, b]);
      expect(pages).to.deep.equal([1, 2]);
    });

    it('sweep-accessibility-6: a page change is announced once, by the grid', async () => {
      const grid = await mount({ pagination: { enabled: true, pageSize: 3 } });
      const pager = paginatorOf(grid)!;
      expect(pager.renderRoot.querySelectorAll('[aria-live]').length).to.equal(0);
      await grid.nextPage();
      await settle(grid);
      const region = grid.renderRoot.querySelector('[part="live-region"]')!;
      expect(region.textContent?.trim()).to.equal('Page 2 of 3');
    });
  });
});
