import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  ApexGridEnterprise,
  enterpriseModules,
  getServerRowMeta,
  type ServerSideDataSource,
  type ServerSideGetRowsParams,
  type ServerSideGetRowsResult,
  type ServerSideRowModelConfig,
  SSRM_GROUP_KEY,
} from '../src/index.js';

interface Row {
  region: string | null;
  name: string;
  salary: number;
}

const LEAVES: Row[] = [
  { region: 'EMEA', name: 'Ava', salary: 100 },
  { region: 'AMER', name: 'Liam', salary: 110 },
  { region: null, name: 'Zed', salary: 50 },
  { region: 'A/B', name: 'Slash', salary: 10 },
];

const columns: ColumnConfiguration<Row>[] = [
  { key: 'region', headerText: 'Sales region' },
  { key: 'name' },
  { key: 'salary', type: 'number' },
];

/** Groups `LEAVES` by region like a SQL GROUP BY (NULL is its own group) and records calls. */
class GroupServer implements ServerSideDataSource<Row> {
  public calls: ServerSideGetRowsParams<Row>[] = [];
  getRows(params: ServerSideGetRowsParams<Row>): ServerSideGetRowsResult<Row> {
    this.calls.push(params);
    if (params.groupKeys.length < params.rowGroupCols.length) {
      const regions = [...new Set(LEAVES.map((row) => row.region))];
      return { rows: regions.map((region) => ({ region, salary: 0 })) as unknown as Row[] };
    }
    const key = params.groupKeys[0];
    return { rows: LEAVES.filter((row) => String(row.region ?? '') === key) };
  }
}

async function settle(grid: ApexGridEnterprise<Row>) {
  await grid.updateComplete;
  await nextFrame();
  await nextFrame();
  await grid.updateComplete;
}

async function mountSsrm(config: Partial<ServerSideRowModelConfig<Row>> = {}) {
  const server = new GroupServer();
  const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
    .columns=${columns}
    .serverSideRowModel=${{ datasource: server, rowGroupCols: ['region'], ...config }}
  ></apex-grid-enterprise>`);
  await settle(grid);
  return { grid, server };
}

const flat = (grid: ApexGridEnterprise<Row>) => grid.data as Row[];
const byLabel = (grid: ApexGridEnterprise<Row>, label: string) =>
  flat(grid).find((row) => getServerRowMeta(row)?.label === label)!;

describe('row models: server-side group keys, columns and placeholders', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  it('expands a blank group without walking the top level again (ent-ssrm-1)', async () => {
    const { grid, server } = await mountSsrm();
    expect(flat(grid)).to.have.length(4);
    const blank = flat(grid).find((row) => row.region === null)!;
    expect(getServerRowMeta(blank)?.path).to.eql(['']);
    expect(getServerRowMeta(blank)?.label, 'blank label').to.equal('(blank)');

    grid.expandServerGroup(['']);
    await settle(grid);

    const rows = flat(grid);
    const emea = rows.find((row) => row.region === 'EMEA')!;
    expect(getServerRowMeta(emea)?.group, 'EMEA still a group').to.be.true;
    expect(getServerRowMeta(emea)?.depth).to.equal(0);
    expect(new Set(rows).size, 'no duplicate row objects').to.equal(rows.length);
    expect(server.calls.some((c) => c.groupKeys.length === 1 && c.groupKeys[0] === '')).to.be.true;
    expect(rows.map((row) => row.name).filter(Boolean)).to.eql(['Zed']);
  });

  it('keeps a value with a slash apart from a nested path (ent-ssrm-1)', async () => {
    // Two levels: the path 'A' > 'B' must not share a key with the value 'A/B'.
    const datasource: ServerSideDataSource<Row> = {
      getRows(params) {
        const [region, name] = params.groupKeys;
        if (region === undefined) {
          return { rows: [{ region: 'A' }, { region: 'A/B' }] as unknown as Row[] };
        }
        if (name === undefined) return { rows: [{ region, name: 'B' }] as unknown as Row[] };
        return { rows: [{ region, name, salary: 1 }] };
      },
    };
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .columns=${columns}
      .serverSideRowModel=${{ datasource, rowGroupCols: ['region', 'name'] }}
    ></apex-grid-enterprise>`);
    await settle(grid);
    grid.expandServerGroup(['A']);
    await settle(grid);
    grid.expandServerGroup(['A', 'B']);
    await settle(grid);
    const rows = flat(grid);
    expect(getServerRowMeta(byLabel(grid, 'A/B'))?.expanded, "'A/B' left collapsed").to.be.false;
    expect(new Set(rows).size, 'no duplicate row objects').to.equal(rows.length);
    expect(rows.map((row) => getServerRowMeta(row)?.label || row.name)).to.eql([
      'A',
      'B',
      'B',
      'A/B',
    ]);
  });

  it('shows a NULL and an empty group from the server as one blank group (ent-ssrm-1)', async () => {
    const calls: string[][] = [];
    const blanks: Row[] = [
      { region: null, name: 'Zed', salary: 1 },
      { region: '', name: 'Empty', salary: 2 },
    ];
    const datasource: ServerSideDataSource<Row> = {
      getRows(params) {
        calls.push(params.groupKeys);
        if (!params.groupKeys.length) {
          return {
            rows: [{ region: null }, { region: '' }, { region: 'EMEA' }] as unknown as Row[],
          };
        }
        return { rows: blanks.filter((row) => (row.region ?? '') === params.groupKeys[0]) };
      },
    };
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .columns=${columns}
      .serverSideRowModel=${{ datasource, rowGroupCols: ['region'] }}
    ></apex-grid-enterprise>`);
    await settle(grid);
    const label = (row: Row) => getServerRowMeta(row)?.label || row.name;
    expect(flat(grid).map(label)).to.eql(['(blank)', 'EMEA']);

    grid.expandServerGroup(getServerRowMeta(flat(grid)[0])!.path);
    await settle(grid);
    const rows = flat(grid);
    expect(new Set(rows).size, 'no duplicate row objects').to.equal(rows.length);
    expect(rows.map(label)).to.eql(['(blank)', 'Zed', 'Empty', 'EMEA']);
    expect(calls.filter((keys) => keys.length === 1)).to.eql([['']]);
  });

  it('exports the group labels and the parent groups of leaves (ent-ssrm-2)', async () => {
    const { grid } = await mountSsrm();
    grid.expandServerGroup(['EMEA']);
    await settle(grid);
    const csv = grid.exportToCSV({ filename: '' }) as string;
    const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).to.equal('Sales region,name,salary');
    expect(lines[1]).to.equal('EMEA,,0');
    expect(lines[2]).to.equal('EMEA,Ava,100');
    expect(lines[3]).to.equal('AMER,,0');
    expect(lines).to.include('(blank),,0');
  });

  it('names the group column after the grouped columns, and adds none when flat (ent-ssrm-8, ent-ssrm-9)', async () => {
    const { grid } = await mountSsrm();
    expect(grid.columns[0].headerText).to.equal('Sales region');
    fixtureCleanup();
    const { grid: flatGrid } = await mountSsrm({ rowGroupCols: [] });
    expect(flatGrid.columns.map((column) => String(column.key))).to.eql([
      'region',
      'name',
      'salary',
    ]);
    expect(flatGrid.columns.map((column) => String(column.key))).to.not.include(SSRM_GROUP_KEY);
  });
});

describe('row models: server-side block paging', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  const TOTAL = 1000;
  const pagedRows: Row[] = Array.from({ length: TOTAL }, (_, i) => ({
    region: 'EMEA',
    name: `P${i}`,
    salary: i,
  }));

  async function mountPaged() {
    const windows: number[] = [];
    const datasource: ServerSideDataSource<Row> = {
      getRows(params) {
        const start = params.startRow ?? 0;
        windows.push(start);
        return { rows: pagedRows.slice(start, params.endRow ?? TOTAL), rowCount: TOTAL };
      },
    };
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .columns=${columns}
      .serverSideRowModel=${{ datasource, rowGroupCols: [], blockSize: 10 }}
    ></apex-grid-enterprise>`);
    await settle(grid);
    return { grid, windows };
  }

  it('shares one placeholder row per unloaded block, kept across rebuilds (ent-ssrm-7)', async () => {
    const { grid } = await mountPaged();
    const before = flat(grid);
    expect(grid.isRowLoading(before[500])).to.be.true;
    expect(before[500], 'one row for the block').to.equal(before[505]);
    expect(before[500], 'another block, another row').to.not.equal(before[510]);
    // Loading another block rebuilds the view; the unloaded block keeps its row.
    const vz = grid.renderRoot.querySelector('apex-virtualizer') as HTMLElement;
    vz.dispatchEvent(Object.assign(new Event('rangeChanged'), { first: 700, last: 709 }));
    await settle(grid);
    expect(grid.isRowLoading(flat(grid)[700]), 'block 70 loaded').to.be.false;
    expect(flat(grid)[500]).to.equal(before[500]);
  });

  it('loads the blocks of the shown page, not of page 0 (ent-ssrm-6)', async () => {
    const { grid, windows } = await mountPaged();
    grid.pagination = { enabled: true };
    grid.pageSize = 10;
    await settle(grid);
    grid.page = 50;
    await settle(grid);
    const vz = grid.renderRoot.querySelector('apex-virtualizer') as HTMLElement;
    const range = Object.assign(new Event('rangeChanged'), { first: 0, last: 9 });
    vz.dispatchEvent(range);
    await settle(grid);
    expect(windows, 'block of rows 500 to 509 requested').to.include(500);
    expect(
      grid.pageItems.every((row) => !grid.isRowLoading(row)),
      'page rows loaded'
    ).to.be.true;
    expect(grid.pageItems[0].name).to.equal('P500');
  });
});
