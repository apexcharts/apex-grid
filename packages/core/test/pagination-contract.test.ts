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
  });
});
