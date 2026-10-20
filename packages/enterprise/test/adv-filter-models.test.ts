import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration, DataPipelineConfiguration } from 'apex-grid';
import {
  type AdvancedFilterModel,
  ApexGridEnterprise,
  enterpriseModules,
  filterRows,
  type InfiniteGetRowsParams,
  type ServerSideGetRowsParams,
} from '../src/index.js';

interface Row {
  id: number;
  name: string;
  value: number;
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number', headerText: 'ID' },
  { key: 'name', headerText: 'Name' },
  { key: 'value', type: 'number', headerText: 'Value' },
];

const ALL: Row[] = Array.from({ length: 250 }, (_, id) => ({
  id,
  name: `Row ${id}`,
  value: id * 10,
}));

/** Twenty local rows; `value < 50` keeps five of them. */
const LOCAL: Row[] = ALL.slice(0, 20);

const below = (limit: number): AdvancedFilterModel => ({
  kind: 'group',
  join: 'and',
  children: [{ kind: 'condition', column: 'value', operator: 'lessThan', value: limit }],
});

/** A server that applies the advanced filter model it is sent, as an app's should. */
function infiniteServer() {
  const calls: InfiniteGetRowsParams<Row>[] = [];
  return {
    calls,
    getRows(params: InfiniteGetRowsParams<Row>) {
      calls.push(params);
      const model = params.advancedFilterModel;
      const rows = model ? filterRows(ALL, model, columns) : ALL;
      return Promise.resolve({
        rows: rows.slice(params.startRow, params.endRow),
        rowCount: rows.length,
      });
    },
  };
}

function serverSideServer() {
  const calls: ServerSideGetRowsParams<Row>[] = [];
  return {
    calls,
    getRows(params: ServerSideGetRowsParams<Row>) {
      calls.push(params);
      const model = params.advancedFilterModel;
      return { rows: model ? filterRows(ALL, model, columns) : ALL };
    },
  };
}

function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '600px';
  return node;
}

async function flush(grid: ApexGridEnterprise<Row>): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await grid.updateComplete;
    await Promise.resolve();
    await nextFrame();
  }
}

async function mount(extra: Partial<ApexGridEnterprise<Row>> = {}) {
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise .columns=${columns}></apex-grid-enterprise>`,
    { parentNode: sizedParent() }
  );
  Object.assign(grid, extra);
  await flush(grid);
  return grid;
}

describe('advanced filter with the server row models', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  it('sends the model to the infinite model and refetches from the top (sweep-regression-3.5-1, sweep-api-types-i18n-1)', async () => {
    const server = infiniteServer();
    const grid = await mount({ infiniteRowModel: { datasource: server, blockSize: 50 } });
    expect(grid.dataView.length, 'baseline').to.equal(250);
    expect(server.calls[0].advancedFilterModel, 'no model yet').to.equal(null);
    const before = server.calls.length;

    const model: AdvancedFilterModel = {
      kind: 'group',
      join: 'and',
      children: [{ kind: 'condition', column: 'value', operator: 'equals', value: 2400 }],
    };
    grid.applyAdvancedFilter(model);
    await flush(grid);
    const fresh = server.calls.slice(before);
    expect(fresh.length, 'refetched').to.be.greaterThan(0);
    expect(fresh[0].startRow, 'from the first block').to.equal(0);
    expect(fresh[0].advancedFilterModel).to.eql(model);
    expect(grid.dataView.map((row) => row.id)).to.eql([240]);
  });

  it('keeps unloaded rows when the model matches everything (sweep-drift-duplication-1)', async () => {
    const server = infiniteServer();
    const grid = await mount({ infiniteRowModel: { datasource: server, blockSize: 50 } });
    grid.applyAdvancedFilter(below(100_000));
    await flush(grid);
    expect(grid.dataView.length).to.equal(250);
  });

  it('sends a model applied before the infinite model starts (sweep-drift-duplication-1)', async () => {
    const grid = await mount({ data: LOCAL.slice() });
    grid.applyAdvancedFilter(below(50));
    await flush(grid);
    expect(grid.dataView.length, 'client result').to.equal(5);
    const server = infiniteServer();
    grid.infiniteRowModel = { datasource: server, blockSize: 50 };
    await flush(grid);
    expect(server.calls[0].advancedFilterModel).to.eql(below(50));
    expect(grid.dataView.length, 'server result').to.equal(5);
  });

  it('sends the model to the server-side model and refetches (sweep-regression-3.5-1)', async () => {
    const server = serverSideServer();
    const grid = await mount({
      serverSideRowModel: { datasource: server, rowGroupCols: [] },
    });
    expect(grid.dataView.length, 'baseline').to.equal(250);
    expect(server.calls[0].advancedFilterModel).to.equal(null);
    grid.applyAdvancedFilter(below(50));
    await flush(grid);
    expect(server.calls.at(-1)?.advancedFilterModel).to.eql(below(50));
    expect(grid.dataView.length).to.equal(5);
    grid.clearAdvancedFilter();
    await flush(grid);
    expect(server.calls.at(-1)?.advancedFilterModel).to.equal(null);
    expect(grid.dataView.length).to.equal(250);
  });

  it('never brings a stopped infinite model back (sweep-regression-3.5-2)', async () => {
    const server = infiniteServer();
    const grid = await mount({ infiniteRowModel: { datasource: server, blockSize: 50 } });
    grid.applyAdvancedFilter(below(50));
    await flush(grid);
    grid.infiniteRowModel = null;
    grid.data = LOCAL.slice();
    await flush(grid);
    expect(grid.dataView.length, 'advanced filter still applies').to.equal(5);
    grid.clearAdvancedFilter();
    await flush(grid);
    const calls = server.calls.length;
    const local = grid.data;
    grid.filter({ key: 'name', condition: 'contains', searchTerm: 'Row 1' });
    await flush(grid);
    expect(server.calls.length, 'no fetch').to.equal(calls);
    expect(grid.data, 'local data kept').to.equal(local);
    expect(grid.dataView.length, 'column filter applies').to.equal(11);
  });

  it('keeps an app filter hook the app spreads while the advanced filter is on (sweep-regression-3.5-2)', async () => {
    const evens = ({ data }: { data: Row[] }) => data.filter((row) => row.id % 2 === 0);
    const grid = await mount({ data: LOCAL.slice(), dataPipelineConfiguration: { filter: evens } });
    expect(grid.dataView.length, 'app filter').to.equal(10);
    grid.applyAdvancedFilter(below(50));
    await flush(grid);
    expect(grid.dataView.length, 'advanced filter').to.equal(5);
    grid.dataPipelineConfiguration = {
      ...grid.dataPipelineConfiguration,
      sort: ({ data }) => data,
    };
    await flush(grid);
    expect(grid.dataView.length, 'advanced filter after the spread').to.equal(5);
    grid.clearAdvancedFilter();
    await flush(grid);
    const pipeline = grid.dataPipelineConfiguration;
    expect(pipeline?.filter === evens, 'app filter hook back').to.equal(true);
    expect(Object.keys(pipeline ?? {}).sort()).to.eql(['filter', 'sort']);
    expect(grid.dataView.length, 'app filter applies').to.equal(10);
  });

  it('keeps app hooks the app spreads while a server row model runs (sweep-regression-3.5-2)', async () => {
    const evens = ({ data }: { data: Row[] }) => data.filter((row) => row.id % 2 === 0);
    const grid = await mount({ data: LOCAL.slice(), dataPipelineConfiguration: { filter: evens } });
    const server = serverSideServer();
    grid.serverSideRowModel = { datasource: server, rowGroupCols: [] };
    await flush(grid);
    expect(grid.dataView.length, 'server rows').to.equal(250);
    const pagination = ({ data }: { data: Row[] }) => data;
    grid.dataPipelineConfiguration = { ...grid.dataPipelineConfiguration, pagination };
    await flush(grid);
    grid.serverSideRowModel = null;
    grid.data = LOCAL.slice();
    await flush(grid);
    const pipeline = grid.dataPipelineConfiguration;
    expect(pipeline?.filter === evens, 'app filter hook back').to.equal(true);
    expect(pipeline?.pagination === pagination, 'app pagination hook kept').to.equal(true);
    expect(Object.keys(pipeline ?? {}).sort(), 'no stale passthrough hooks').to.eql([
      'filter',
      'pagination',
    ]);
    expect(grid.dataView.length, 'app filter applies').to.equal(10);
  });

  it('keeps an app filter hook when the app spreads a configuration it read earlier (sweep-regression-3.5-2)', async () => {
    const evens = ({ data }: { data: Row[] }) => data.filter((row) => row.id % 2 === 0);
    const grid = await mount({ data: LOCAL.slice(), dataPipelineConfiguration: { filter: evens } });
    grid.applyAdvancedFilter(below(50));
    await flush(grid);
    const read = grid.dataPipelineConfiguration;
    grid.dataPipelineConfiguration = { ...read, sort: ({ data }) => data };
    await flush(grid);
    const pagination = ({ data }: { data: Row[] }) => data;
    grid.dataPipelineConfiguration = { ...read, pagination };
    await flush(grid);
    expect(grid.dataView.length, 'advanced filter after the spreads').to.equal(5);
    grid.clearAdvancedFilter();
    await flush(grid);
    const pipeline = grid.dataPipelineConfiguration;
    expect(pipeline?.filter === evens, 'app filter hook back').to.equal(true);
    expect(pipeline?.pagination === pagination, 'app pagination hook kept').to.equal(true);
    expect(grid.dataView.length, 'app filter applies').to.equal(10);
  });

  it('drops an older advanced filter the app spreads back after a new apply (sweep-regression-3.5-2)', async () => {
    const evens = ({ data }: { data: Row[] }) => data.filter((row) => row.id % 2 === 0);
    const grid = await mount({ data: LOCAL.slice(), dataPipelineConfiguration: { filter: evens } });
    grid.applyAdvancedFilter(below(50));
    await flush(grid);
    const read = grid.dataPipelineConfiguration;
    grid.applyAdvancedFilter(below(100));
    await flush(grid);
    grid.dataPipelineConfiguration = { ...read, sort: ({ data }) => data };
    await flush(grid);
    expect(grid.dataView.length, 'newer advanced filter').to.equal(10);
    grid.clearAdvancedFilter();
    await flush(grid);
    expect(grid.dataPipelineConfiguration?.filter === evens, 'app filter hook back').to.equal(true);
    expect(grid.dataView.length, 'app filter applies').to.equal(10);
  });

  it('drops a replaced row model hook the app spreads back (sweep-regression-3.5-2)', async () => {
    const evens = ({ data }: { data: Row[] }) => data.filter((row) => row.id % 2 === 0);
    const grid = await mount({ data: LOCAL.slice(), dataPipelineConfiguration: { filter: evens } });
    grid.infiniteRowModel = { datasource: infiniteServer(), blockSize: 50 };
    await flush(grid);
    const read = grid.dataPipelineConfiguration;
    grid.infiniteRowModel = { datasource: infiniteServer(), blockSize: 50 };
    await flush(grid);
    const pagination = ({ data }: { data: Row[] }) => data;
    grid.dataPipelineConfiguration = { ...read, pagination };
    await flush(grid);
    grid.infiniteRowModel = null;
    grid.data = LOCAL.slice();
    await flush(grid);
    const pipeline = grid.dataPipelineConfiguration;
    expect(pipeline?.filter === evens, 'app filter hook back').to.equal(true);
    expect(Object.keys(pipeline ?? {}).sort(), 'no stale passthrough hooks').to.eql([
      'filter',
      'pagination',
    ]);
    expect(grid.dataView.length, 'app filter applies').to.equal(10);
    grid.sort({ key: 'id', direction: 'descending' });
    await flush(grid);
    expect(grid.dataView[0]?.id, 'column sort applies').to.equal(18);
  });

  it('filters a numeric source field while pivoting (sweep-regression-3.5-3)', async () => {
    type Sale = { region: string; year: string; value: number };
    const grid = await fixture<ApexGridEnterprise<Sale>>(html`<apex-grid-enterprise
      .data=${[
        { region: 'N', year: '2024', value: 5 },
        { region: 'N', year: '2024', value: 500 },
        { region: 'S', year: '2025', value: 7 },
      ]}
      .columns=${[{ key: 'region' }, { key: 'year' }, { key: 'value', type: 'number' }]}
      .pivotOn=${'year'}
      .pivotRows=${['region']}
      .pivotValues=${{ value: ['sum'] }}
    ></apex-grid-enterprise>`);
    await flush(grid as unknown as ApexGridEnterprise<Row>);
    grid.applyAdvancedFilter({
      kind: 'group',
      join: 'and',
      children: [{ kind: 'condition', column: 'value', operator: 'greaterThan', value: 100 }],
    });
    await flush(grid as unknown as ApexGridEnterprise<Row>);
    const rows = grid.pageItems as ReadonlyArray<Record<string, unknown>>;
    expect(rows.map((row) => row.region)).to.eql(['N']);
    expect(rows[0]['pivot::2024::value::sum']).to.equal(500);
  });
});

type Step = 'startFilter' | 'startModel' | 'stopFilter' | 'stopModel';

/** Every order of start A, start B, stop A, stop B where each start precedes its stop. */
const ORDERS: Step[][] = [
  ['startFilter', 'startModel', 'stopFilter', 'stopModel'],
  ['startFilter', 'startModel', 'stopModel', 'stopFilter'],
  ['startModel', 'startFilter', 'stopFilter', 'stopModel'],
  ['startModel', 'startFilter', 'stopModel', 'stopFilter'],
  ['startFilter', 'stopFilter', 'startModel', 'stopModel'],
  ['startModel', 'stopModel', 'startFilter', 'stopFilter'],
];

for (const kind of ['infinite', 'server-side'] as const) {
  describe(`advanced filter and the ${kind} row model in any order (sweep-regression-3.5-2)`, () => {
    before(() => {
      ApexGridEnterprise.use(...enterpriseModules);
      ApexGridEnterprise.register();
    });
    afterEach(() => fixtureCleanup());

    for (const order of ORDERS) {
      it(order.join(', '), async () => {
        const own: DataPipelineConfiguration<Row> = { pagination: ({ data }) => data };
        const grid = await mount({ data: LOCAL.slice(), dataPipelineConfiguration: own });
        const infinite = infiniteServer();
        const serverSide = serverSideServer();
        const calls: Array<{ advancedFilterModel: unknown }> =
          kind === 'infinite' ? infinite.calls : serverSide.calls;
        let filtering = false;
        let modelOn = false;
        for (const step of order) {
          if (step === 'startFilter') {
            grid.applyAdvancedFilter(below(50));
            filtering = true;
          } else if (step === 'stopFilter') {
            grid.clearAdvancedFilter();
            filtering = false;
          } else if (step === 'startModel') {
            if (kind === 'infinite')
              grid.infiniteRowModel = { datasource: infinite, blockSize: 50 };
            else grid.serverSideRowModel = { datasource: serverSide, rowGroupCols: [] };
            modelOn = true;
          } else {
            if (kind === 'infinite') grid.infiniteRowModel = null;
            else grid.serverSideRowModel = null;
            grid.data = LOCAL.slice();
            modelOn = false;
          }
          await flush(grid);
          const label = `after ${step}`;
          if (modelOn) {
            expect(calls.at(-1)?.advancedFilterModel, `${label}: model sent`).to.eql(
              filtering ? below(50) : null
            );
            expect(grid.dataView.length, `${label}: server rows`).to.equal(filtering ? 5 : 250);
          } else {
            expect(grid.dataView.length, `${label}: local rows`).to.equal(filtering ? 5 : 20);
          }
        }

        // Everything stopped: the app's pipeline is back and nothing stale runs.
        expect(grid.dataPipelineConfiguration, 'app pipeline restored').to.equal(own);
        const fetched = calls.length;
        const local = grid.data;
        grid.filter({ key: 'name', condition: 'contains', searchTerm: 'Row 1' });
        await flush(grid);
        expect(calls.length, 'stopped model never fetches').to.equal(fetched);
        expect(grid.data, 'local data kept').to.equal(local);
        expect(grid.dataView.length, 'column filter works').to.equal(11);
      });
    }
  });
}
