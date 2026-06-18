import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  ApexGridEnterprise,
  type InfiniteGetRowsParams,
  type InfiniteRowModelConfig,
  ROWS_LOADED_EVENT,
  type RowsLoadedDetail,
} from '../src/index.js';

interface Row {
  id: number;
  name: string;
  value: number;
}

const ALL: Row[] = Array.from({ length: 250 }, (_, id) => ({
  id,
  name: `Row ${id}`,
  value: id * 10,
}));
const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number', headerText: 'ID', sort: true },
  { key: 'name', headerText: 'Name' },
  { key: 'value', type: 'number', headerText: 'Value' },
];

/** In-memory "server" that records every block request. */
function makeDatasource() {
  const calls: InfiniteGetRowsParams<Row>[] = [];
  return {
    calls,
    datasource: {
      getRows(params: InfiniteGetRowsParams<Row>) {
        calls.push(params);
        let rows = ALL.slice();
        const q = params.quickFilter.trim().toLowerCase();
        if (q) rows = rows.filter((row) => row.name.toLowerCase().includes(q));
        const sort = params.sortModel[0];
        if (sort) {
          const dir = sort.direction === 'descending' ? -1 : 1;
          const key = sort.key as keyof Row;
          rows = rows
            .slice()
            .sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir);
        }
        const rowCount = rows.length;
        return Promise.resolve({ rows: rows.slice(params.startRow, params.endRow), rowCount });
      },
    },
  };
}

function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '600px';
  return node;
}

/** Let block fetches (microtask) + the pipeline + a couple frames settle. */
async function flush(grid: ApexGridEnterprise<Row>): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await grid.updateComplete;
    await Promise.resolve();
    await nextFrame();
  }
}

async function mount(config: InfiniteRowModelConfig<Row>) {
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise
      .columns=${columns}
      .infiniteRowModel=${config}
    ></apex-grid-enterprise>`,
    { parentNode: sizedParent() }
  );
  await flush(grid);
  return grid;
}

function dispatchRange(grid: ApexGridEnterprise<Row>, first: number, last: number): void {
  const vz = grid.shadowRoot!.querySelector('apex-virtualizer')!;
  const event = new Event('rangeChanged');
  (event as Event & { first: number; last: number }).first = first;
  (event as Event & { first: number; last: number }).last = last;
  vz.dispatchEvent(event);
}

const rowsOf = (grid: ApexGridEnterprise<Row>) => grid.data as Row[];

describe('Infinite row model', () => {
  before(() => ApexGridEnterprise.register());
  afterEach(() => fixtureCleanup());

  it('loads the first block and sizes data to the server row count', async () => {
    const { datasource, calls } = makeDatasource();
    const grid = await mount({ datasource, blockSize: 50 });

    expect(rowsOf(grid).length, 'data sized to total').to.equal(250);
    expect(calls.length, 'at least one block fetched').to.be.greaterThan(0);
    expect(calls[0].startRow).to.equal(0);

    // First block is real data; far-down rows are unloaded placeholders.
    expect(rowsOf(grid)[0].id).to.equal(0);
    expect(grid.isRowLoading(rowsOf(grid)[0])).to.be.false;
    expect(grid.isRowLoading(rowsOf(grid)[200])).to.be.true;
  });

  it('fetches a later block when the viewport range moves', async () => {
    const { datasource } = makeDatasource();
    const grid = await mount({ datasource, blockSize: 50 });
    expect(grid.isRowLoading(rowsOf(grid)[120])).to.be.true;

    dispatchRange(grid, 110, 135); // block 2 (rows 100–149)
    await flush(grid);

    expect(grid.isRowLoading(rowsOf(grid)[120])).to.be.false;
    expect(rowsOf(grid)[120].id).to.equal(120);
  });

  it('refetches from the server when sorting changes', async () => {
    const { datasource, calls } = makeDatasource();
    const grid = await mount({ datasource, blockSize: 50 });
    const before = calls.length;

    grid.sort([{ key: 'id', direction: 'descending' }]);
    await flush(grid);

    expect(calls.length, 'a new fetch happened').to.be.greaterThan(before);
    expect(calls.at(-1)!.sortModel[0]?.direction).to.equal('descending');
    // Server-ordered: top row is now the highest id.
    expect(rowsOf(grid)[0].id).to.equal(249);
  });

  it('refetches and resizes when the quick filter changes', async () => {
    const { datasource } = makeDatasource();
    const grid = await mount({ datasource, blockSize: 50 });
    expect(rowsOf(grid).length).to.equal(250);

    await grid.setQuickFilter('Row 1'); // matches 1, 10–19, 100–199, 1xx... → 111 rows
    await flush(grid);

    const matches = ALL.filter((row) => row.name.toLowerCase().includes('row 1')).length;
    expect(rowsOf(grid).length).to.equal(matches);
    expect((grid.data as Row[])[0].name.toLowerCase()).to.contain('row 1');
  });

  it('fires apex-rows-loaded with the row count', async () => {
    const { datasource } = makeDatasource();
    let detail: RowsLoadedDetail | null = null;
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise .columns=${columns}></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    grid.addEventListener(ROWS_LOADED_EVENT, (event) => {
      detail = (event as CustomEvent<RowsLoadedDetail>).detail;
    });
    grid.infiniteRowModel = { datasource, blockSize: 50 };
    await flush(grid);

    expect(detail).to.not.be.null;
    expect(detail!.rowCount).to.equal(250);
    expect(detail!.exact).to.be.true;
    expect(detail!.blockSize).to.equal(50);
  });
});
