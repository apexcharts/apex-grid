import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  ApexGridEnterprise,
  enterpriseModules,
  getServerRowMeta,
  type InfiniteDataSource,
  type InfiniteGetRowsParams,
  type InfiniteGetRowsResult,
  ROWS_LOAD_FAILED_EVENT,
  ROWS_LOADED_EVENT,
  type RowsLoadedDetail,
  type RowsLoadFailedDetail,
  SERVER_ROWS_LOAD_FAILED_EVENT,
  type ServerRowsLoadFailedDetail,
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

  it('keeps placeholders out of export (ent-ssrm-2, sweep-editing-state-2)', async () => {
    const { grid } = await mountPaged();
    const loaded = flat(grid).filter((row) => !grid.isRowLoading(row));
    expect(loaded.length).to.be.below(TOTAL);
    const csv = grid.exportToCSV({ filename: '' }) as string;
    // The header plus the loaded rows: no blank lines for placeholders.
    expect(csv.split('\r\n')).to.have.length(loaded.length + 1);
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

describe('row models: counts and query keys', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  async function mountInfinite(server: InfiniteDataSource<Row>, blockSize = 100) {
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .columns=${columns}
      .infiniteRowModel=${{ datasource: server, blockSize }}
    ></apex-grid-enterprise>`);
    await settle(grid);
    return grid;
  }

  it('keeps the exact end-of-data count when an earlier block answers late (ent-irm-detail-total-1)', async () => {
    const server = new PendingServer();
    const grid = await mountInfinite(server);
    const events: RowsLoadedDetail[] = [];
    (grid as EventTarget).addEventListener(ROWS_LOADED_EVENT, (event) =>
      events.push((event as CustomEvent<RowsLoadedDetail>).detail)
    );
    expect(server.calls.map((c) => c.params.startRow)).to.eql([0, 100]);
    server.answer(100, 50); // the short last block first
    await settle(grid);
    server.answer(0, 100);
    await settle(grid);
    const last = events[events.length - 1];
    expect(last.rowCount, 'rowCount in last apex-rows-loaded').to.equal(150);
    expect(last.exact).to.be.true;
    expect(grid.data).to.have.length(150);
    expect(
      grid.data.some((row) => grid.isRowLoading(row)),
      'no placeholders left'
    ).to.be.false;
  });

  /** Two conditions on one column, then the AND/OR chip flipped to OR. */
  async function toggleCriteria(grid: ApexGridEnterprise<Row>) {
    const conditions = (criteria: 'and' | 'or') => [
      { key: 'name' as const, condition: 'contains' as const, searchTerm: 'a' },
      { key: 'name' as const, condition: 'contains' as const, searchTerm: 'v', criteria },
    ];
    grid.filter(conditions('and'));
    await settle(grid);
    grid.clearFilter('name');
    grid.filter(conditions('or'));
    await settle(grid);
  }

  it('refetches infinite rows when only the AND/OR criteria change (ent-irm-detail-total-8)', async () => {
    const calls: InfiniteGetRowsParams<Row>[] = [];
    const grid = await mountInfinite({
      getRows(params) {
        calls.push(params);
        return { rows: [], rowCount: 0 };
      },
    });
    await toggleCriteria(grid);
    const last = calls[calls.length - 1];
    expect(last.filterModel.map((expr) => expr.criteria ?? 'and')).to.eql(['and', 'or']);
  });

  it('refetches server-side rows when only the AND/OR criteria change (ent-ssrm-5)', async () => {
    const { grid, server } = await mountSsrm();
    await toggleCriteria(grid);
    const last = server.calls[server.calls.length - 1];
    expect(last.filterModel.map((expr) => expr.criteria ?? 'and')).to.eql(['and', 'or']);
  });
});

describe('row models: rejected getRows', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  const block = (startRow: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      region: 'EMEA',
      name: `R${startRow + i}`,
      salary: startRow + i,
    }));

  async function mountInfinite(
    getRows: InfiniteDataSource<Row>['getRows'],
    retry: { maxRetries?: number; retryDelay?: number }
  ) {
    const failures: RowsLoadFailedDetail[] = [];
    const parent = document.createElement('div');
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise
        .columns=${columns}
        @apex-rows-load-failed=${(event: CustomEvent<RowsLoadFailedDetail>) =>
          failures.push(event.detail)}
        .infiniteRowModel=${{ datasource: { getRows }, blockSize: 100, ...retry }}
      ></apex-grid-enterprise>`,
      { parentNode: parent }
    );
    await settle(grid);
    return { grid, failures };
  }

  it('reports a rejected block and retries it a bounded number of times (ent-irm-detail-total-9)', async () => {
    let attempts = 0;
    const { grid, failures } = await mountInfinite(
      (params) => {
        if (params.startRow === 0) {
          attempts += 1;
          if (attempts === 1) throw new Error('offline');
        }
        return { rows: block(params.startRow, 100), rowCount: 300 };
      },
      { maxRetries: 1, retryDelay: 0 }
    );
    await settle(grid);
    expect(failures).to.have.length(1);
    expect(failures[0]).to.include({ startRow: 0, endRow: 100, retrying: true });
    expect(String(failures[0].error)).to.equal('Error: offline');
    expect(attempts).to.equal(2);
    expect(grid.isRowLoading(grid.data[0]), 'loaded on the retry').to.be.false;
  });

  it('stops asking for a block that failed for good until a refresh', async () => {
    const asked: number[] = [];
    let fail = true;
    const { grid, failures } = await mountInfinite(
      (params) => {
        asked.push(params.startRow);
        if (fail && params.startRow === 0) return Promise.reject(new Error('down'));
        return { rows: block(params.startRow, 100), rowCount: 300 };
      },
      { maxRetries: 0 }
    );
    expect(failures.map((f) => [f.startRow, f.retrying])).to.eql([[0, false]]);
    const vz = grid.renderRoot.querySelector('apex-virtualizer') as HTMLElement;
    vz.dispatchEvent(Object.assign(new Event('rangeChanged'), { first: 0, last: 10 }));
    vz.dispatchEvent(Object.assign(new Event('rangeChanged'), { first: 0, last: 10 }));
    await settle(grid);
    expect(
      asked.filter((row) => row === 0),
      'not asked again while scrolling'
    ).to.have.length(1);
    fail = false;
    grid.refreshRows();
    await settle(grid);
    expect(asked.filter((row) => row === 0)).to.have.length(2);
    expect(grid.isRowLoading(grid.data[0])).to.be.false;
  });

  it('ignores a rejection from an older request generation', async () => {
    const server = new PendingServer();
    const failures: RowsLoadFailedDetail[] = [];
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .columns=${columns}
      .infiniteRowModel=${{ datasource: server, blockSize: 100, maxRetries: 0 }}
    ></apex-grid-enterprise>`);
    (grid as EventTarget).addEventListener(ROWS_LOAD_FAILED_EVENT, (event) =>
      failures.push((event as CustomEvent<RowsLoadFailedDetail>).detail)
    );
    await settle(grid);
    grid.refreshRows();
    expect(server.calls.map((c) => c.params.startRow)).to.eql([0, 100, 0, 100]);
    server.calls[0].answer.reject(new Error('stale'));
    await settle(grid);
    expect(failures, 'no event for a stale request').to.have.length(0);
    // The fresh block 0 is still in flight, so a range event does not ask a third time.
    const vz = grid.renderRoot.querySelector('apex-virtualizer') as HTMLElement;
    vz.dispatchEvent(Object.assign(new Event('rangeChanged'), { first: 0, last: 10 }));
    expect(server.calls.map((c) => c.params.startRow)).to.eql([0, 100, 0, 100]);
  });

  it('retries twice by default, waiting 1 s then 2 s', async () => {
    const delays: number[] = [];
    const realSetTimeout = window.setTimeout;
    window.setTimeout = ((fn: () => void, ms?: number) => {
      if (ms && ms >= 1000) {
        delays.push(ms);
        return realSetTimeout(fn, 0);
      }
      return realSetTimeout(fn, ms);
    }) as typeof window.setTimeout;
    try {
      const { grid, failures } = await mountInfinite((params) => {
        if (params.startRow === 0) throw new Error('down');
        return { rows: block(params.startRow, 100), rowCount: 300 };
      }, {});
      await settle(grid);
      await settle(grid);
      expect(failures.map((f) => f.retrying)).to.eql([true, true, false]);
      expect(delays).to.eql([1000, 2000]);
    } finally {
      window.setTimeout = realSetTimeout;
    }
  });

  it('caps maxRetries at 10 and treats NaN as the default', async () => {
    const attempts = async (maxRetries: number) => {
      let calls = 0;
      const { grid, failures } = await mountInfinite(
        (params) => {
          if (params.startRow === 0) {
            calls += 1;
            throw new Error('down');
          }
          return { rows: block(params.startRow, 100), rowCount: 300 };
        },
        { maxRetries, retryDelay: 0 }
      );
      for (let i = 0; i < 4; i += 1) await settle(grid);
      fixtureCleanup();
      return { calls, last: failures[failures.length - 1]?.retrying };
    };
    expect(await attempts(Number.POSITIVE_INFINITY)).to.eql({ calls: 11, last: false });
    expect(await attempts(Number.NaN)).to.eql({ calls: 3, last: false });
  });

  it('collapses a server group whose children failed, so expanding asks again (ent-ssrm-4)', async () => {
    let failNext = true;
    const calls: string[][] = [];
    const failures: ServerRowsLoadFailedDetail[] = [];
    const datasource: ServerSideDataSource<Row> = {
      getRows(params) {
        calls.push(params.groupKeys);
        if (!params.groupKeys.length) {
          return { rows: [{ region: 'EMEA', salary: 0 }] as unknown as Row[] };
        }
        if (failNext) {
          failNext = false;
          throw new Error('timeout');
        }
        return { rows: LEAVES.filter((row) => row.region === 'EMEA') };
      },
    };
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .columns=${columns}
      .serverSideRowModel=${{ datasource, rowGroupCols: ['region'], maxRetries: 0 }}
    ></apex-grid-enterprise>`);
    (grid as EventTarget).addEventListener(SERVER_ROWS_LOAD_FAILED_EVENT, (event) =>
      failures.push((event as CustomEvent<ServerRowsLoadFailedDetail>).detail)
    );
    await settle(grid);
    grid.expandServerGroup(['EMEA']);
    await settle(grid);
    expect(failures).to.have.length(1);
    expect(failures[0].groupKeys).to.eql(['EMEA']);
    expect(failures[0].retrying).to.be.false;
    expect(getServerRowMeta(byLabel(grid, 'EMEA'))?.expanded, 'collapsed again').to.be.false;

    grid.expandServerGroup(['EMEA']);
    await settle(grid);
    expect(calls.filter((keys) => keys[0] === 'EMEA')).to.have.length(2);
    expect(flat(grid).map((row) => row.name)).to.include('Ava');
  });
});

describe('row models: unloaded rows', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  it('pastes and exports past unloaded infinite rows instead of throwing (sweep-editing-state-2)', async () => {
    const server = new PendingServer();
    const editable: ColumnConfiguration<Row>[] = [
      { key: 'region' },
      { key: 'name', editable: true },
      { key: 'salary', type: 'number' },
    ];
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .columns=${editable}
      .editing=${{ enabled: true }}
      .infiniteRowModel=${{ datasource: server, blockSize: 100 }}
    ></apex-grid-enterprise>`);
    await settle(grid);
    server.answer(0, 100, 500);
    await settle(grid);
    expect(grid.isRowLoading(grid.data[150])).to.be.true;
    // A three-line paste from row 99 reaches the unloaded rows 100 and 101.
    grid.selectRange({ row: 99, column: 'name' });
    expect(() => grid.pasteText('a\nb\nc')).to.not.throw();
    expect(grid.data[99].name).to.equal('a');
    const csv = grid.exportToCSV({ filename: '' }) as string;
    expect(csv.replace(/^\uFEFF/, '').split('\r\n')).to.have.length(101);
  });

  const editable: ColumnConfiguration<Row>[] = [
    { key: 'region' },
    { key: 'name', editable: true },
    { key: 'salary', type: 'number' },
  ];

  /** An infinite grid of 500 rows with blocks 0 and 2 loaded and block 1 still pending. */
  async function mountGap() {
    const server = new PendingServer();
    const changed: number[] = [];
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .columns=${editable}
      .editing=${{ enabled: true }}
      .infiniteRowModel=${{ datasource: server, blockSize: 100 }}
      @cellValueChanged=${(event: CustomEvent<{ rowIndex: number }>) =>
        changed.push(event.detail.rowIndex)}
    ></apex-grid-enterprise>`);
    await settle(grid);
    server.answer(0, 100, 500);
    await settle(grid);
    const vz = grid.renderRoot.querySelector('apex-virtualizer') as HTMLElement;
    vz.dispatchEvent(Object.assign(new Event('rangeChanged'), { first: 200, last: 210 }));
    server.answer(200, 100, 500);
    await settle(grid);
    expect(grid.isRowLoading(grid.data[100]), 'block 1 pending').to.be.true;
    expect(grid.isRowLoading(grid.data[200]), 'block 2 loaded').to.be.false;
    return { grid, changed };
  }

  it('drops pasted lines that land on unloaded rows instead of moving them past the gap', async () => {
    const { grid, changed } = await mountGap();
    grid.selectRange({ row: 99, column: 'name' });
    grid.pasteText('a\nb\nc');
    await settle(grid);
    const rows = grid.data as Row[];
    expect(rows[99].name).to.equal('a');
    expect(rows[200].name, 'row after the gap untouched').to.equal('R200');
    expect(rows[201].name).to.equal('R201');
    expect(changed).to.eql([99]);
  });

  it('drops pasted lines on unloaded server-side rows, past a gap', async () => {
    const datasource: ServerSideDataSource<Row> = {
      getRows(params) {
        const start = params.startRow ?? 0;
        if (start === 10) return new Promise(() => {});
        const rows = Array.from({ length: 10 }, (_, i) => ({
          region: 'EMEA',
          name: `R${start + i}`,
          salary: start + i,
        }));
        return { rows, rowCount: 100 };
      },
    };
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .columns=${editable}
      .editing=${{ enabled: true }}
      .serverSideRowModel=${{ datasource, rowGroupCols: [], blockSize: 10 }}
    ></apex-grid-enterprise>`);
    await settle(grid);
    const vz = grid.renderRoot.querySelector('apex-virtualizer') as HTMLElement;
    vz.dispatchEvent(Object.assign(new Event('rangeChanged'), { first: 20, last: 25 }));
    await settle(grid);
    const rows = () => grid.data as Row[];
    expect(grid.isRowLoading(rows()[10]), 'block 1 pending').to.be.true;
    expect(grid.isRowLoading(rows()[20]), 'block 2 loaded').to.be.false;
    grid.selectRange({ row: 9, column: 'name' });
    grid.pasteText('a\nb\nc');
    await settle(grid);
    expect(rows()[9].name).to.equal('a');
    expect(rows()[20].name, 'row after the gap untouched').to.equal('R20');
    expect(rows()[21].name).to.equal('R21');
  });

  it('does not edit an unloaded row (sweep-editing-state-2)', async () => {
    const { grid, changed } = await mountGap();
    expect(await grid.editCell(150, 'name'), 'no editor on an unloaded row').to.be.false;
    const tally = grid.applyEdits([
      { rowIndex: 0, column: 'name', value: 'loaded' },
      { rowIndex: 150, column: 'name', value: 'ghost' },
    ]);
    expect(tally).to.include({ applied: 1, skipped: 1 });
    expect((grid.data as Row[])[0].name).to.equal('loaded');
    expect(changed).to.eql([0]);
  });

  type Flagged = Row & { active?: boolean };

  /** Every element matching `selector` under `root`, through shadow roots. */
  function deepAll(root: ParentNode, selector: string, out: Element[] = []): Element[] {
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (el.matches(selector)) out.push(el);
      if (el.shadowRoot) deepAll(el.shadowRoot, selector, out);
    }
    return out;
  }

  /** A grid of 50 rows in blocks of 5 with block 0 loaded and every later block pending. */
  async function mountCheckboxes(model: 'infinite' | 'server-side', mode: 'cell' | 'row') {
    const block = (start: number) =>
      Array.from({ length: 5 }, (_, i) => ({
        region: 'EMEA',
        name: `R${start + i}`,
        salary: start + i,
        active: false,
      }));
    const getRows = (params: { startRow?: number }) =>
      (params.startRow ?? 0) === 0
        ? { rows: block(0), rowCount: 50 }
        : new Promise<never>(() => {});
    const events: string[] = [];
    const grid = await fixture<ApexGridEnterprise<Flagged>>(html`<apex-grid-enterprise
      style="height:400px"
      .columns=${[{ key: 'name' }, { key: 'active', type: 'boolean', editable: true }]}
      .editing=${{ enabled: true, mode }}
      .infiniteRowModel=${model === 'infinite' ? { datasource: { getRows }, blockSize: 5 } : undefined}
      .serverSideRowModel=${
        model === 'server-side'
          ? { datasource: { getRows }, rowGroupCols: [], blockSize: 5 }
          : undefined
      }
      @cellValueChanged=${() => events.push('cellValueChanged')}
      @rowEditStarted=${() => events.push('rowEditStarted')}
    ></apex-grid-enterprise>`);
    for (let i = 0; i < 3; i++) await settle(grid as unknown as ApexGridEnterprise<Row>);
    return { grid, events };
  }

  for (const model of ['infinite', 'server-side'] as const) {
    for (const mode of ['cell', 'row'] as const) {
      it(`does not commit a checkbox click on an unloaded ${model} row (${mode} mode)`, async () => {
        const rejections: unknown[] = [];
        const onRejection = (event: PromiseRejectionEvent) => {
          rejections.push(event.reason);
          event.preventDefault();
        };
        window.addEventListener('unhandledrejection', onRejection);
        try {
          const { grid, events } = await mountCheckboxes(model, mode);
          const rowEl = (
            deepAll(grid.renderRoot, 'apex-grid-row') as Array<HTMLElement & { data: Flagged }>
          ).find((el) => grid.isRowLoading(el.data));
          expect(rowEl, 'an unloaded row is rendered').to.exist;
          const box = deepAll(
            rowEl!.shadowRoot ?? rowEl!,
            'input[type=checkbox]'
          )[0] as HTMLInputElement;
          expect(box, 'its checkbox').to.exist;
          box.click();
          for (let i = 0; i < 2; i++) await settle(grid as unknown as ApexGridEnterprise<Row>);
          await new Promise((resolve) => setTimeout(resolve, 20));
          const placeholder = rowEl!.data;
          expect(rejections, 'no unhandled rejection').to.eql([]);
          expect(placeholder.active, 'placeholder left alone').to.not.equal(true);
          expect(box.checked, 'checkbox put back').to.be.false;
          expect(events).to.eql([]);
        } finally {
          window.removeEventListener('unhandledrejection', onRejection);
        }
      });
    }
  }
});
