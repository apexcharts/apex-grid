import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  ApexGridEnterprise,
  enterpriseModules,
  type ServerSideDataSource,
  type ServerSideGetRowsParams,
  type ServerSideGetRowsResult,
} from '../src/index.js';

interface Row {
  region: string;
  name: string;
  salary: number;
}

const LEAVES: Row[] = [
  { region: 'EMEA', name: 'Ava', salary: 100 },
  { region: 'EMEA', name: 'Noah', salary: 90 },
  { region: 'AMER', name: 'Liam', salary: 110 },
];

/** Groups by the requested columns in memory, standing in for a server. */
class MockServer implements ServerSideDataSource<Row> {
  getRows({ groupKeys, rowGroupCols }: ServerSideGetRowsParams<Row>): ServerSideGetRowsResult<Row> {
    const scoped = LEAVES.filter((row) =>
      groupKeys.every((value, i) => String(row[rowGroupCols[i] as keyof Row]) === value)
    );
    if (groupKeys.length < rowGroupCols.length) {
      const field = rowGroupCols[groupKeys.length] as keyof Row;
      const values = [...new Set(scoped.map((row) => String(row[field])))];
      return { rows: values.map((value) => ({ [field]: value })) as unknown as Row[] };
    }
    return { rows: LEAVES.filter((row) => scoped.includes(row)) };
  }
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'region' },
  { key: 'name', editable: true },
  { key: 'salary', type: 'number' },
];

async function settle(grid: ApexGridEnterprise<Row>) {
  for (let i = 0; i < 4; i++) {
    await grid.updateComplete;
    await nextFrame();
  }
}

describe('Server-side row model and undo history', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  it('keeps undo for an edited leaf across a collapse of its group', async () => {
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .columns=${columns}
      .editing=${{ enabled: true, history: { enabled: true } }}
      .serverSideRowModel=${{ datasource: new MockServer(), rowGroupCols: ['region'] }}
    ></apex-grid-enterprise>`);
    await settle(grid);
    grid.expandServerGroup(['EMEA']);
    await settle(grid);

    const ava = (grid.data as Row[]).find((row) => row.name === 'Ava')!;
    expect(grid.applyEdits([{ row: ava, column: 'name', value: 'Ava2' }]).applied).to.equal(1);

    grid.collapseServerGroup(['EMEA']);
    await settle(grid);
    expect(grid.canUndo).to.be.true;

    grid.expandServerGroup(['EMEA']);
    await settle(grid);
    expect((grid.data as Row[]).includes(ava)).to.be.true;
    grid.undo();
    expect(ava.name).to.equal('Ava');
  });
});
