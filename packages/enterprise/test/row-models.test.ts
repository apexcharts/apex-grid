import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  ApexGridEnterprise,
  enterpriseModules,
  getServerRowMeta,
  type InfiniteDataSource,
  type InfiniteGetRowsParams,
  type InfiniteGetRowsResult,
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

/** A promise with its settle functions, so a test decides when a request answers. */
function deferred<V>() {
  let resolve!: (value: V) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<V>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** An infinite datasource whose every request waits for the test to answer it. */
class PendingServer implements InfiniteDataSource<Row> {
  public calls: Array<{
    params: InfiniteGetRowsParams<Row>;
    answer: ReturnType<typeof deferred<InfiniteGetRowsResult<Row>>>;
  }> = [];
  getRows(params: InfiniteGetRowsParams<Row>) {
    const answer = deferred<InfiniteGetRowsResult<Row>>();
    this.calls.push({ params, answer });
    return answer.promise;
  }
  /** Answers the pending request for `startRow` with `count` rows. */
  answer(startRow: number, count: number, rowCount?: number) {
    const call = this.calls.find((c) => c.params.startRow === startRow);
    const rows = Array.from({ length: count }, (_, i) => ({
      region: 'EMEA',
      name: `R${startRow + i}`,
      salary: startRow + i,
    }));
    call!.answer.resolve({ rows, ...(rowCount === undefined ? {} : { rowCount }) });
  }
}

function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '400px';
  document.body.appendChild(node);
  return node;
}

describe('row models: lifecycle across a DOM move', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  it('keeps the server-side model running when the grid moves (ent-grid-sync-1, ent-ssrm-3)', async () => {
    const { grid, server } = await mountSsrm();
    const pipeline = grid.dataPipelineConfiguration;
    const other = sizedParent();
    other.appendChild(grid);
    await settle(grid);
    expect(String(grid.columns[0].key), 'group column after move').to.equal(SSRM_GROUP_KEY);
    expect(grid.dataPipelineConfiguration, 'server pipeline kept').to.equal(pipeline);
    grid.expandServerGroup(['EMEA']);
    await settle(grid);
    expect(getServerRowMeta(byLabel(grid, 'EMEA'))?.expanded).to.be.true;
    expect(server.calls.filter((c) => c.groupKeys[0] === 'EMEA')).to.have.length(1);
    other.remove();
  });

  it('keeps the infinite model fetching after a move, applying blocks in flight once (ent-grid-core-3, ent-irm-detail-total-7)', async () => {
    const server = new PendingServer();
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .columns=${columns}
      .infiniteRowModel=${{ datasource: server, blockSize: 50 }}
    ></apex-grid-enterprise>`);
    await settle(grid);
    expect(server.calls.map((c) => c.params.startRow)).to.eql([0, 50]);

    // Move the grid while both blocks are in flight, then answer them.
    const other = sizedParent();
    other.appendChild(grid);
    await settle(grid);
    server.answer(0, 50, 500);
    server.answer(50, 50, 500);
    await settle(grid);
    expect(grid.isRowLoading(grid.data[0]), 'block 0 applied').to.be.false;
    expect(grid.isRowLoading(grid.data[60]), 'block 1 applied').to.be.false;
    expect(server.calls, 'no block requested twice').to.have.length(2);

    // The listener is bound once: one range event asks once per block.
    const vz = grid.renderRoot.querySelector('apex-virtualizer') as HTMLElement;
    vz.dispatchEvent(Object.assign(new Event('rangeChanged'), { first: 300, last: 310 }));
    expect(server.calls.map((c) => c.params.startRow).slice(2)).to.eql([300, 350]);

    // Sort still reaches the server through the passthrough pipeline.
    expect(typeof grid.dataPipelineConfiguration?.sort).to.equal('function');
    grid.sort([{ key: 'salary', direction: 'descending' }]);
    await settle(grid);
    const last = server.calls[server.calls.length - 1].params;
    expect(last.sortModel[0]?.direction).to.equal('descending');
    other.remove();
  });

  it('clears client grouping in the update that turns the server-side model on (ent-grid-sync-2)', async () => {
    const server = new GroupServer();
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .columns=${columns}
      .data=${LEAVES.map((row) => ({ ...row }))}
      .groupBy=${['region']}
    ></apex-grid-enterprise>`);
    await settle(grid);
    grid.serverSideRowModel = { datasource: server, rowGroupCols: ['region'] };
    await settle(grid);
    expect(grid.groupBy).to.eql([]);
    expect(grid.dataView).to.have.length(4);
    expect(
      grid.dataView.every((row) => getServerRowMeta(row)?.group),
      'only server group rows'
    ).to.be.true;
  });

  it('restores columns, column groups and pipeline when turned off (ent-ssrm-10)', async () => {
    const own = { filter: ({ data }: { data: Row[] }) => data };
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .columns=${columns}
      .dataPipelineConfiguration=${own}
      .serverSideRowModel=${{ datasource: new GroupServer(), rowGroupCols: ['region'] }}
    ></apex-grid-enterprise>`);
    await settle(grid);
    expect(String(grid.columns[0].key)).to.equal(SSRM_GROUP_KEY);
    grid.serverSideRowModel = null;
    await settle(grid);
    expect(grid.columns.map((column) => String(column.key))).to.eql(['region', 'name', 'salary']);
    expect(grid.dataPipelineConfiguration).to.equal(own);
    expect(grid.columnGroups).to.equal(undefined);
  });

  it('drops a child fetch that answers after a sort reset (ent-ssrm-10)', async () => {
    const pending: Array<{
      params: ServerSideGetRowsParams<Row>;
      answer: ReturnType<typeof deferred<ServerSideGetRowsResult<Row>>>;
    }> = [];
    const datasource: ServerSideDataSource<Row> = {
      getRows(params) {
        if (!params.groupKeys.length) {
          return { rows: [{ region: 'EMEA', salary: 0 }] as unknown as Row[] };
        }
        const answer = deferred<ServerSideGetRowsResult<Row>>();
        pending.push({ params, answer });
        return answer.promise;
      },
    };
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .columns=${columns}
      .serverSideRowModel=${{ datasource, rowGroupCols: ['region'] }}
    ></apex-grid-enterprise>`);
    await settle(grid);
    grid.expandServerGroup(['EMEA']);
    await settle(grid);
    grid.sort([{ key: 'name', direction: 'ascending' }]);
    await settle(grid);
    pending[0].answer.resolve({ rows: [{ region: 'EMEA', name: 'Stale', salary: 1 }] });
    await settle(grid);
    expect(flat(grid).map((row) => row.name)).to.not.include('Stale');
    expect(getServerRowMeta(flat(grid)[0])?.expanded, 'reset collapsed the tree').to.be.false;
  });
});
