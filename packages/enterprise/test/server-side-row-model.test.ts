import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  ApexGridEnterprise,
  enterpriseModules,
  getServerRowMeta,
  type ServerSideDataSource,
  type ServerSideGetRowsParams,
  type ServerSideGetRowsResult,
  SSRM_GROUP_KEY,
} from '../src/index.js';

interface Row {
  region: string;
  department: string;
  name: string;
  salary: number;
}

const LEAVES: Row[] = [
  { region: 'EMEA', department: 'Engineering', name: 'Ava', salary: 100 },
  { region: 'EMEA', department: 'Engineering', name: 'Noah', salary: 90 },
  { region: 'EMEA', department: 'Sales', name: 'Olivia', salary: 70 },
  { region: 'AMER', department: 'Engineering', name: 'Liam', salary: 110 },
  { region: 'AMER', department: 'Sales', name: 'Emma', salary: 80 },
];

/**
 * An in-memory datasource that groups + aggregates on request, standing in for a
 * server. Group rows carry the grouped field's value + sum(salary); leaf rows are
 * the raw records. Records fetches for assertions.
 */
class MockServer implements ServerSideDataSource<Row> {
  public calls: ServerSideGetRowsParams<Row>[] = [];

  getRows(params: ServerSideGetRowsParams<Row>): ServerSideGetRowsResult<Row> {
    this.calls.push(params);
    const { groupKeys, rowGroupCols } = params;
    // Filter leaves to those matching the group path.
    const scoped = LEAVES.filter((row) =>
      groupKeys.every((value, i) => String(row[rowGroupCols[i] as keyof Row]) === value)
    );
    const depth = groupKeys.length;
    if (depth < rowGroupCols.length) {
      const field = rowGroupCols[depth] as keyof Row;
      const byValue = new Map<string, Row[]>();
      for (const row of scoped) {
        const key = String(row[field]);
        (byValue.get(key) ?? byValue.set(key, []).get(key)!).push(row);
      }
      return {
        rows: [...byValue.entries()].map(([value, rows]) => ({
          [field]: value,
          salary: rows.reduce((sum, r) => sum + r.salary, 0),
        })) as unknown as Row[],
      };
    }
    return { rows: scoped };
  }
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'region' },
  { key: 'department' },
  { key: 'name' },
  { key: 'salary', type: 'number' },
];

function rows(grid: ApexGridEnterprise<Row>) {
  return grid.data as ReadonlyArray<Row>;
}

async function mount(rowGroupCols = ['region', 'department']) {
  const server = new MockServer();
  const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
    .columns=${columns}
    .serverSideRowModel=${{ datasource: server, rowGroupCols, valueCols: { salary: ['sum'] } }}
  ></apex-grid-enterprise>`);
  await grid.updateComplete;
  await nextFrame();
  await nextFrame();
  return { grid, server };
}

describe('server-side row model (grouping + aggregation)', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  it('loads the top group level with server aggregates + a group column', async () => {
    const { grid } = await mount();
    expect(grid.isServerSideRowModel).to.be.true;
    // Auto group column is prepended; the grouped fields fold into it.
    expect(String(grid.columns[0].key)).to.equal(SSRM_GROUP_KEY);
    expect(grid.columns.map((c) => String(c.key))).to.not.include('region');

    const top = rows(grid);
    expect(top.map((r) => r.region)).to.eql(['EMEA', 'AMER']);
    expect(getServerRowMeta(top[0])?.group).to.be.true;
    expect(getServerRowMeta(top[0])?.depth).to.equal(0);
    // Server-computed aggregate on the group row.
    expect(top.find((r) => r.region === 'EMEA')!.salary).to.equal(260); // 100+90+70
    expect(top.find((r) => r.region === 'AMER')!.salary).to.equal(190); // 110+80
  });

  it("lazily fetches a group's children on expand and collapses them", async () => {
    const { grid, server } = await mount();
    const callsBefore = server.calls.length;

    grid.expandServerGroup(['EMEA']);
    await grid.updateComplete;
    await nextFrame();
    await nextFrame();

    // A fetch for groupKeys ['EMEA'] happened.
    expect(server.calls.length).to.be.greaterThan(callsBefore);
    expect(server.calls.some((c) => c.groupKeys.join('/') === 'EMEA')).to.be.true;

    // EMEA now shows its department groups beneath it.
    const flat = rows(grid);
    const emeaIdx = flat.findIndex((r) => getServerRowMeta(r)?.label === 'EMEA');
    expect(getServerRowMeta(flat[emeaIdx])?.expanded).to.be.true;
    expect(flat[emeaIdx + 1].department).to.equal('Engineering');
    expect(flat[emeaIdx + 1].salary).to.equal(190); // 100+90 (dept aggregate)
    expect(getServerRowMeta(flat[emeaIdx + 1])?.depth).to.equal(1);

    // Collapse removes the children.
    grid.collapseServerGroup(['EMEA']);
    await grid.updateComplete;
    await nextFrame();
    expect(rows(grid).map((r) => r.region)).to.eql(['EMEA', 'AMER']);
  });

  it('drills to leaf rows at the deepest level', async () => {
    const { grid } = await mount();
    grid.expandServerGroup(['EMEA']);
    await grid.updateComplete;
    await nextFrame();
    await nextFrame();
    grid.expandServerGroup(['EMEA', 'Engineering']);
    await grid.updateComplete;
    await nextFrame();
    await nextFrame();

    const flat = rows(grid);
    const leaf = flat.find((r) => getServerRowMeta(r)?.group === false);
    expect(leaf, 'a leaf row is present').to.exist;
    expect(['Ava', 'Noah']).to.include(leaf!.name);
    expect(getServerRowMeta(leaf!)?.depth).to.equal(2);
  });

  it('sets aria-level / aria-expanded on server group rows', async () => {
    const { grid } = await mount();
    grid.expandServerGroup(['EMEA']);
    await grid.updateComplete;
    await nextFrame();
    await nextFrame();

    let rowEls: Element[] = [];
    for (let i = 0; i < 10 && rowEls.length === 0; i++) {
      rowEls = [...grid.renderRoot.querySelectorAll('apex-grid-row')].filter(
        (r) => (r as { data?: Row }).data
      );
      if (rowEls.length === 0) await nextFrame();
    }
    const groupRow = rowEls.find(
      (r) => getServerRowMeta((r as { data?: Row }).data as Row)?.group
    )!;
    expect(groupRow.getAttribute('aria-level')).to.equal('1');
    expect(groupRow.getAttribute('aria-expanded')).to.equal('true'); // EMEA is expanded
    const leafDepthGroup = rowEls.find(
      (r) => getServerRowMeta((r as { data?: Row }).data as Row)?.depth === 1
    )!;
    expect(leafDepthGroup.getAttribute('aria-level')).to.equal('2');
  });

  it('installs server-provided pivot columns in pivot mode', async () => {
    // A pivot server: rows carry per-department sums under synthetic keys, and the
    // top response advertises the generated columns.
    const pivotServer: ServerSideDataSource<Row> = {
      getRows(params: ServerSideGetRowsParams<Row>): ServerSideGetRowsResult<Row> {
        expect(params.pivotMode).to.be.true;
        expect(params.pivotCols).to.eql(['department']);
        const scoped = LEAVES.filter((row) =>
          params.groupKeys.every((v, i) => String(row[params.rowGroupCols[i] as keyof Row]) === v)
        );
        if (params.groupKeys.length < params.rowGroupCols.length) {
          const field = params.rowGroupCols[params.groupKeys.length] as keyof Row;
          const values = [...new Set(scoped.map((r) => String(r[field])))];
          return {
            rows: values.map((value) => ({
              [field]: value,
              'pv::Engineering': sumBy2(scoped, value, field, 'Engineering'),
              'pv::Sales': sumBy2(scoped, value, field, 'Sales'),
            })) as unknown as Row[],
            pivotResultFields: [
              { key: 'pv::Engineering', headerText: 'Engineering' },
              { key: 'pv::Sales', headerText: 'Sales' },
            ],
          };
        }
        return { rows: scoped };
      },
    };
    function sumBy2(rows: Row[], value: string, field: keyof Row, dept: string): number {
      return rows
        .filter((r) => String(r[field]) === value && r.department === dept)
        .reduce((s, r) => s + r.salary, 0);
    }

    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .columns=${columns}
      .serverSideRowModel=${{
        datasource: pivotServer,
        rowGroupCols: ['region'],
        pivotCols: ['department'],
      }}
    ></apex-grid-enterprise>`);
    await grid.updateComplete;
    await nextFrame();
    await nextFrame();

    // Group column + the two server-generated pivot value columns.
    expect(grid.columns.map((c) => String(c.key))).to.eql([
      SSRM_GROUP_KEY,
      'pv::Engineering',
      'pv::Sales',
    ]);
    const emea = (grid.data as Row[]).find((r) => r.region === 'EMEA')! as unknown as Record<
      string,
      number
    >;
    expect(emea['pv::Engineering']).to.equal(190); // 100 + 90
    expect(emea['pv::Sales']).to.equal(70);
  });

  it("paginates a group's children by blockSize and fills placeholders on demand", async () => {
    // A leaf group far larger than any viewport, so deep rows stay placeholders
    // until scrolled (making the range-driven fetch deterministic).
    const N = 500;
    const bs = 50;
    const BIG: Row[] = Array.from({ length: N }, (_, i) => ({
      region: 'EMEA',
      department: 'Engineering',
      name: `Person ${i}`,
      salary: 100 + i,
    }));
    const leafWindows: Array<{ start: number; end: number }> = [];
    const pagedServer: ServerSideDataSource<Row> = {
      getRows(params: ServerSideGetRowsParams<Row>): ServerSideGetRowsResult<Row> {
        const depth = params.groupKeys.length;
        if (depth < params.rowGroupCols.length) {
          const field = params.rowGroupCols[depth] as keyof Row;
          const values = [...new Set(BIG.map((r) => String(r[field])))];
          return { rows: values.map((v) => ({ [field]: v })) as unknown as Row[] };
        }
        // Leaf level: honour the block window and report the exact total.
        const start = params.startRow ?? 0;
        const end = params.endRow ?? N;
        leafWindows.push({ start, end });
        return { rows: BIG.slice(start, end), rowCount: N };
      },
    };

    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .columns=${columns}
      .serverSideRowModel=${{
        datasource: pagedServer,
        rowGroupCols: ['region', 'department'],
        blockSize: bs,
      }}
    ></apex-grid-enterprise>`);
    await grid.updateComplete;
    await nextFrame();
    await nextFrame();

    grid.expandServerGroup(['EMEA']);
    await grid.updateComplete;
    await nextFrame();
    grid.expandServerGroup(['EMEA', 'Engineering']);
    await grid.updateComplete;
    await nextFrame();
    await nextFrame();

    const flat = rows(grid);
    const engIdx = flat.findIndex((r) => getServerRowMeta(r)?.label === 'Engineering');
    // Level is sized to the full 500 children even though only windows have loaded.
    const children = flat.slice(engIdx + 1, engIdx + 1 + N);
    expect(children.length).to.equal(N);
    // Block 0 (the expand fetch) is real; a deep row is still a placeholder.
    expect(grid.isRowLoading(children[0])).to.be.false;
    expect(children[0].name).to.equal('Person 0');
    expect(grid.isRowLoading(children[400]), 'deep row not yet loaded').to.be.true;
    expect(getServerRowMeta(children[400])?.placeholder).to.be.true;
    // The server was asked for a window, not the whole level.
    expect(leafWindows[0]).to.eql({ start: 0, end: bs });

    // Scroll the virtualizer to reveal row 400 → the manager fetches its block.
    const vz = grid.renderRoot.querySelector('apex-virtualizer') as HTMLElement;
    expect(vz, 'virtualizer present').to.exist;
    const range = new Event('rangeChanged') as Event & { first: number; last: number };
    range.first = engIdx + 1 + 395;
    range.last = engIdx + 1 + 405;
    vz.dispatchEvent(range);
    await grid.updateComplete;
    await nextFrame();
    await nextFrame();

    expect(
      leafWindows.some((w) => w.start === 400 && w.end === 450),
      'block covering row 400 was fetched'
    ).to.be.true;
    const after = rows(grid);
    const engIdx2 = after.findIndex((r) => getServerRowMeta(r)?.label === 'Engineering');
    const child400 = after[engIdx2 + 1 + 400];
    expect(grid.isRowLoading(child400), 'row 400 now loaded').to.be.false;
    expect(child400.name).to.equal('Person 400');
  });

  it('loads all children in one request when no blockSize is set (no startRow/endRow)', async () => {
    const { grid, server } = await mount();
    grid.expandServerGroup(['EMEA']);
    await grid.updateComplete;
    await nextFrame();
    await nextFrame();
    // Non-paginated: the datasource never receives a window.
    expect(server.calls.every((c) => c.startRow === undefined && c.endRow === undefined)).to.be
      .true;
    expect(
      rows(grid).some((r) => grid.isRowLoading(r)),
      'no placeholders'
    ).to.be.false;
  });

  it('resets the tree when the sort model changes', async () => {
    const { grid, server } = await mount();
    grid.expandServerGroup(['EMEA']);
    await grid.updateComplete;
    await nextFrame();
    const callsBefore = server.calls.length;

    grid.sort({ key: 'salary', direction: 'ascending' });
    await grid.updateComplete;
    await nextFrame();
    await nextFrame();

    // A fresh top-level fetch (groupKeys []) happened after the sort change.
    const topFetchesAfter = server.calls
      .slice(callsBefore)
      .filter((c) => c.groupKeys.length === 0).length;
    expect(topFetchesAfter).to.be.greaterThan(0);
    // Collapsed back to just the top level (expansion cleared on reset).
    expect(rows(grid).map((r) => r.region)).to.eql(['EMEA', 'AMER']);
  });
});
