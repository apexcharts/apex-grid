import { expect, fixture, fixtureCleanup, html, nextFrame, waitUntil } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  ApexGridEnterprise,
  enterpriseModules,
  groupingModule,
  type InfiniteGetRowsParams,
  isTotalRow,
  type ServerSideDataSource,
  type ServerSideGetRowsParams,
  type ServerSideGetRowsResult,
  totalRowModule,
} from '../src/index.js';

interface Row {
  id: number;
  region: string;
  team: string;
  amount: number;
}

const data: Row[] = [
  { id: 1, region: 'East', team: 'A', amount: 10 },
  { id: 2, region: 'East', team: 'B', amount: 20 },
  { id: 3, region: 'West', team: 'A', amount: 30 },
  { id: 4, region: 'West', team: 'B', amount: 40 },
];
const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number' },
  { key: 'region' },
  { key: 'team' },
  { key: 'amount', type: 'number' },
];

function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '600px';
  return node;
}

async function settle<T extends object>(grid: ApexGridEnterprise<T>) {
  for (let i = 0; i < 3; i += 1) {
    await grid.updateComplete;
    await nextFrame();
  }
}

async function mount(rows: Row[] = data) {
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise
      .data=${rows.map((row) => ({ ...row }))}
      .columns=${columns}
    ></apex-grid-enterprise>`,
    { parentNode: sizedParent() }
  );
  await settle(grid);
  await waitUntil(() => grid.rows.length > 0, 'body rows never rendered');
  return grid;
}

describe('grand-total row totals', () => {
  before(() => {
    // The total row registered before grouping: the documented opt-in path
    // with individual modules, in the order that used to group the total row.
    ApexGridEnterprise.use(totalRowModule, groupingModule);
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  describe('covers every leaf', () => {
    it('keeps the leaves of a collapsed group', async () => {
      const grid = await mount();
      grid.aggregations = { amount: ['sum'] };
      grid.groupBy = ['region'];
      grid.totalRow = { aggregations: { amount: ['sum'] } };
      await settle(grid);
      expect(grid.getTotals().amount?.sum, 'all expanded').to.equal(100);

      const east = grid.getGroups().find((group) => group.value === 'East');
      grid.collapseGroup(east!.key);
      await settle(grid);
      expect(grid.getTotals().amount?.sum, 'East collapsed').to.equal(100);

      grid.collapseAllGroups();
      await settle(grid);
      expect(grid.getTotals().amount?.sum, 'all collapsed').to.equal(100);
    });

    it('keeps the leaves under a collapsed nested group', async () => {
      const grid = await mount();
      grid.groupBy = ['region', 'team'];
      grid.groupingOptions = { defaultExpanded: false };
      grid.totalRow = { aggregations: { amount: ['sum', 'count'] } };
      await settle(grid);
      expect(grid.getTotals().amount).to.eql({ sum: 100, count: 4 });

      const west = grid.getGroups().find((group) => group.value === 'West' && group.depth === 0);
      grid.expandGroup(west!.key);
      await settle(grid);
      expect(grid.getTotals().amount).to.eql({ sum: 100, count: 4 });
    });

    it('totals the rows on every page, not just the page shown', async () => {
      const grid = await mount();
      grid.pagination = { enabled: true, pageSize: 2 };
      grid.totalRow = { aggregations: { amount: ['sum'] } };
      await settle(grid);
      expect(grid.getTotals().amount?.sum).to.equal(100);
    });

    it('follows the filter', async () => {
      const grid = await mount();
      grid.totalRow = { aggregations: { amount: ['sum'] } };
      grid.quickFilter = 'West';
      await settle(grid);
      expect(grid.getTotals().amount?.sum).to.equal(70);
    });
  });

  describe('placement', () => {
    it('stays outside the groups whatever the module registration order', async () => {
      const grid = await mount();
      grid.groupBy = ['region'];
      grid.totalRow = { aggregations: { amount: ['sum'] } };
      await settle(grid);
      const view = grid.dataView;
      expect(view.filter(isTotalRow)).to.have.length(1);
      expect(isTotalRow(view[view.length - 1]), 'last row').to.be.true;
      expect(grid.getGroups().map((group) => group.value)).to.eql(['East', 'West']);
      expect(grid.getTotals().amount?.sum).to.equal(100);
    });

    it('holds the top slot through sort and grouping', async () => {
      const grid = await mount();
      grid.totalRow = { aggregations: { amount: ['sum'] }, position: 'top' };
      grid.sort({ key: 'amount', direction: 'descending' });
      await settle(grid);
      expect(isTotalRow(grid.dataView[0])).to.be.true;
      expect((grid.dataView[1] as Row).amount).to.equal(40);

      grid.groupBy = ['region'];
      await settle(grid);
      expect(isTotalRow(grid.dataView[0])).to.be.true;
      expect(grid.dataView.filter(isTotalRow)).to.have.length(1);
    });
  });

  describe('stays out of the data', () => {
    it('is not written by a CSV export of the view', async () => {
      const grid = await mount();
      grid.totalRow = { aggregations: { amount: ['sum'] } };
      await settle(grid);
      const csv = grid.exportToCSV({ filename: '', bom: false }) as string;
      const lines = csv.split('\r\n').filter((line) => line.length > 0);
      expect(lines).to.have.length(data.length + 1);
      expect(
        lines.some((line) => /^,+$/.test(line)),
        'no blank record'
      ).to.be.false;
    });
  });

  describe('goes inert where it cannot total', () => {
    it('renders no second grand total while a pivot is active', async () => {
      const grid = await mount();
      grid.totalRow = { aggregations: { amount: ['sum'] } };
      await settle(grid);
      expect(grid.dataView.some(isTotalRow)).to.be.true;

      grid.pivotRows = ['region'];
      grid.pivotValues = { amount: ['sum'] };
      grid.pivotOn = 'team';
      await settle(grid);
      expect(grid.isPivoting).to.be.true;
      expect(grid.dataView.some(isTotalRow), 'no total row while pivoting').to.be.false;
      expect(grid.getTotals()).to.eql({});

      grid.pivotOn = '';
      await settle(grid);
      expect(grid.isPivoting).to.be.false;
      expect(grid.dataView.some(isTotalRow), 'back after the pivot').to.be.true;
      expect(grid.getTotals().amount?.sum).to.equal(100);
    });

    it('keeps the total when a pivot config passes the rows through', async () => {
      const grid = await mount();
      grid.totalRow = { aggregations: { amount: ['sum'] } };
      grid.pivotRows = ['region'];
      grid.pivotValues = { amount: [] };
      grid.pivotOn = 'team';
      await settle(grid);
      // No value specs, so the pivot renders the raw rows and no grand total.
      expect(grid.dataView.filter((row) => !isTotalRow(row))).to.have.length(data.length);
      expect(grid.dataView.filter(isTotalRow)).to.have.length(1);
      expect(grid.getTotals().amount?.sum).to.equal(100);
    });

    it('renders nothing under the infinite row model', async () => {
      const grid = await fixture<ApexGridEnterprise<Row>>(
        html`<apex-grid-enterprise
          .columns=${columns}
          .totalRow=${{ aggregations: { amount: ['sum'] } }}
          .infiniteRowModel=${{
            blockSize: 2,
            datasource: {
              getRows: (params: InfiniteGetRowsParams<Row>) =>
                Promise.resolve({
                  rows: data.slice(params.startRow, params.endRow),
                  rowCount: 6,
                }),
            },
          }}
        ></apex-grid-enterprise>`,
        { parentNode: sizedParent() }
      );
      for (let i = 0; i < 3; i += 1) {
        await settle(grid);
        await Promise.resolve();
      }
      expect(grid.data.length, 'sized to the server row count').to.equal(6);
      expect(grid.dataView.some(isTotalRow)).to.be.false;
      expect(grid.getTotals()).to.eql({});
    });

    it('renders nothing under the server-side row model', async () => {
      const server: ServerSideDataSource<Row> = {
        getRows: (_params: ServerSideGetRowsParams<Row>): ServerSideGetRowsResult<Row> => ({
          rows: [
            { region: 'East', amount: 30 },
            { region: 'West', amount: 70 },
          ] as Row[],
        }),
      };
      const grid = await fixture<ApexGridEnterprise<Row>>(
        html`<apex-grid-enterprise
          .columns=${columns}
          .totalRow=${{ aggregations: { amount: ['sum'] } }}
          .serverSideRowModel=${{ datasource: server, rowGroupCols: ['region'] }}
        ></apex-grid-enterprise>`,
        { parentNode: sizedParent() }
      );
      await settle(grid);
      expect(grid.isServerSideRowModel).to.be.true;
      expect(grid.data.length, 'top level loaded').to.equal(2);
      expect(grid.dataView.some(isTotalRow)).to.be.false;
      expect(grid.getTotals()).to.eql({});
    });

    it('comes back when the infinite row model is switched off', async () => {
      const grid = await fixture<ApexGridEnterprise<Row>>(
        html`<apex-grid-enterprise
          .columns=${columns}
          .totalRow=${{ aggregations: { amount: ['sum'] } }}
          .infiniteRowModel=${{
            blockSize: 2,
            datasource: {
              getRows: (params: InfiniteGetRowsParams<Row>) =>
                Promise.resolve({
                  rows: data.slice(params.startRow, params.endRow),
                  rowCount: data.length,
                }),
            },
          }}
        ></apex-grid-enterprise>`,
        { parentNode: sizedParent() }
      );
      for (let i = 0; i < 3; i += 1) {
        await settle(grid);
        await Promise.resolve();
      }
      expect(grid.data.map((row) => row.amount)).to.eql([10, 20, 30, 40]);
      expect(grid.dataView.some(isTotalRow)).to.be.false;

      // No data assignment: switching the mode off alone must bring it back.
      grid.infiniteRowModel = null;
      await settle(grid);
      expect(grid.dataView.filter(isTotalRow), 'back after the mode is off').to.have.length(1);
      expect(grid.getTotals().amount?.sum).to.equal(100);
    });

    it('comes back when the server-side row model is switched off', async () => {
      const server: ServerSideDataSource<Row> = {
        getRows: (): ServerSideGetRowsResult<Row> => ({
          rows: [
            { region: 'East', amount: 30 },
            { region: 'West', amount: 70 },
          ] as Row[],
        }),
      };
      const grid = await fixture<ApexGridEnterprise<Row>>(
        html`<apex-grid-enterprise
          .columns=${columns}
          .totalRow=${{ aggregations: { amount: ['sum'] } }}
          .serverSideRowModel=${{ datasource: server, rowGroupCols: ['region'] }}
        ></apex-grid-enterprise>`,
        { parentNode: sizedParent() }
      );
      await settle(grid);
      expect(grid.data.length, 'top level loaded').to.equal(2);
      expect(grid.dataView.some(isTotalRow)).to.be.false;

      grid.serverSideRowModel = null;
      await settle(grid);
      expect(grid.isServerSideRowModel).to.be.false;
      expect(grid.dataView.filter(isTotalRow), 'back after the mode is off').to.have.length(1);
      expect(grid.getTotals().amount?.sum).to.equal(100);
    });

    it('runs an async pipeline hook once per pivot toggle', async () => {
      let calls = 0;
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const pipeline = {
        sort: async ({ data: rows }: { data: Row[] }) => {
          calls += 1;
          await wait(20);
          return rows;
        },
      };
      const grid = await fixture<ApexGridEnterprise<Row>>(
        html`<apex-grid-enterprise
          .data=${data.map((row) => ({ ...row }))}
          .columns=${columns}
          .dataPipelineConfiguration=${pipeline}
          .totalRow=${{ aggregations: { amount: ['sum'] } }}
        ></apex-grid-enterprise>`,
        { parentNode: sizedParent() }
      );
      const idle = async () => {
        await settle(grid);
        await wait(100);
        await settle(grid);
      };
      await idle();

      calls = 0;
      grid.pivotOn = 'team';
      grid.pivotRows = ['region'];
      grid.pivotValues = { amount: ['sum'] };
      await idle();
      expect(calls, 'pivot on').to.equal(1);
      expect(grid.dataView.some(isTotalRow)).to.be.false;

      calls = 0;
      grid.pivotOn = '';
      await idle();
      expect(calls, 'pivot off').to.equal(1);
      expect(grid.dataView.filter(isTotalRow)).to.have.length(1);
      expect(grid.getTotals().amount?.sum).to.equal(100);
    });

    it('empties getTotals when the row is switched off', async () => {
      const grid = await mount();
      grid.totalRow = { aggregations: { amount: ['sum'] } };
      await settle(grid);
      expect(grid.getTotals().amount?.sum).to.equal(100);

      grid.totalRow = null;
      await settle(grid);
      expect(grid.getTotals(), 'unset').to.eql({});

      grid.totalRow = { aggregations: { amount: ['sum'] } };
      await settle(grid);
      grid.totalRow = { aggregations: {} };
      await settle(grid);
      expect(grid.getTotals(), 'empty config').to.eql({});
    });
  });
});
