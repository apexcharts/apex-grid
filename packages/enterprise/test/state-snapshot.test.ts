import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { getGroupMeta } from '../src/features/grouping.js';
import { type AggregationConfig, ApexGridEnterprise, enterpriseModules } from '../src/index.js';

interface Row {
  region: string;
  product: string;
  amount: number;
}

function makeData(): Row[] {
  return [
    { region: 'EMEA', product: 'A', amount: 10 },
    { region: 'EMEA', product: 'B', amount: 20 },
    { region: 'AMER', product: 'A', amount: 30 },
    { region: 'AMER', product: 'A', amount: 40 },
  ];
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'region' },
  { key: 'product' },
  { key: 'amount', type: 'number' },
];

function groupHeaderCount(grid: ApexGridEnterprise<Row>): number {
  return (grid.pageItems as readonly Row[]).filter((row) => getGroupMeta(row)).length;
}

describe('ApexGridEnterprise — state snapshot', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  async function mount(
    props: Partial<{
      groupBy: string[];
      aggregations: AggregationConfig;
      pivotOn: string;
      pivotRows: string[];
      pivotValues: AggregationConfig;
    }> = {}
  ): Promise<ApexGridEnterprise<Row>> {
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .data=${makeData()}
      .columns=${columns}
      .groupBy=${props.groupBy ?? []}
      .aggregations=${props.aggregations ?? {}}
      .pivotOn=${props.pivotOn ?? ''}
      .pivotRows=${props.pivotRows ?? []}
      .pivotValues=${props.pivotValues ?? {}}
    ></apex-grid-enterprise>`);
    await grid.updateComplete;
    await nextFrame();
    return grid;
  }

  it('captures grouping + aggregation state under modules.enterprise', async () => {
    const grid = await mount({ groupBy: ['region'], aggregations: { amount: ['sum'] } });

    const snapshot = grid.getState();
    const enterprise = snapshot.modules.enterprise as Record<string, unknown>;
    expect(enterprise.groupBy).to.deep.equal(['region']);
    expect(enterprise.aggregations).to.deep.equal({ amount: ['sum'] });
    expect(() => JSON.stringify(snapshot), 'snapshot is JSON-safe').to.not.throw();
  });

  it('round-trips grouping: capture → reset → restore reproduces the grouped view', async () => {
    const grid = await mount({ groupBy: ['region'], aggregations: { amount: ['sum'] } });
    expect(groupHeaderCount(grid)).to.equal(2); // EMEA + AMER

    const snapshot = grid.getState();

    grid.groupBy = [];
    grid.aggregations = {};
    await grid.updateComplete;
    await nextFrame();
    expect(groupHeaderCount(grid)).to.equal(0);

    grid.setState(snapshot);
    await grid.updateComplete;
    await nextFrame();

    expect(grid.groupBy).to.deep.equal(['region']);
    expect(grid.aggregations).to.deep.equal({ amount: ['sum'] });
    expect(groupHeaderCount(grid)).to.equal(2);
  });

  it('round-trips pivot state', async () => {
    const grid = await mount({
      pivotOn: 'product',
      pivotRows: ['region'],
      pivotValues: { amount: ['sum'] },
    });
    expect(grid.isPivoting).to.be.true;

    const snapshot = grid.getState();
    const enterprise = snapshot.modules.enterprise as Record<string, unknown>;
    expect(enterprise.pivotOn).to.equal('product');
    expect(enterprise.pivotRows).to.deep.equal(['region']);
    expect(enterprise.pivotValues).to.deep.equal({ amount: ['sum'] });

    grid.pivotOn = '';
    grid.pivotRows = [];
    grid.pivotValues = {};
    await grid.updateComplete;
    await nextFrame();
    expect(grid.isPivoting).to.be.false;

    grid.setState(snapshot);
    await grid.updateComplete;
    await nextFrame();
    expect(grid.isPivoting).to.be.true;
    expect(grid.pivotOn).to.equal('product');
  });

  it('round-trips per-group collapse overrides', async () => {
    const grid = await mount({ groupBy: ['region'] });
    const emea = grid.getGroups().find((g) => g.value === 'EMEA')?.key as string;
    grid.collapseGroup(emea);
    await grid.updateComplete;
    await nextFrame();
    const collapsedRows = grid.pageItems.length;

    const snapshot = grid.getState();
    expect((snapshot.modules.enterprise as Record<string, unknown>).groupExpand).to.deep.equal({
      [emea]: false,
    });

    grid.expandGroup(emea);
    await grid.updateComplete;
    await nextFrame();
    expect(grid.pageItems.length).to.be.greaterThan(collapsedRows);

    grid.setState(snapshot);
    await grid.updateComplete;
    await nextFrame();
    expect(grid.pageItems.length).to.equal(collapsedRows);
  });

  it('round-trips range-selection rectangles', async () => {
    const grid = await mount();
    grid.selectRange({ row: 0, column: 'region' }, { row: 1, column: 'amount' });
    await grid.updateComplete;

    const bounds = { top: 0, bottom: 1, left: 0, right: 2 };
    const snapshot = grid.getState();
    expect((snapshot.modules.enterprise as Record<string, unknown>).ranges).to.deep.equal([bounds]);

    grid.clearRangeSelection();
    await grid.updateComplete;
    expect(grid.getSelectionRanges()).to.have.lengthOf(0);

    grid.setState(snapshot);
    await grid.updateComplete;
    expect(grid.getSelectionRanges()).to.deep.equal([bounds]);
  });

  it('still captures the core slices (sort) alongside enterprise state', async () => {
    const grid = await mount({ groupBy: ['region'] });
    grid.sort([{ key: 'amount', direction: 'descending' }] as never);
    await grid.updateComplete;

    const snapshot = grid.getState();
    expect(snapshot.sort).to.deep.equal([
      { key: 'amount', direction: 'descending', caseSensitive: false },
    ]);
    expect((snapshot.modules.enterprise as Record<string, unknown>).groupBy).to.deep.equal([
      'region',
    ]);
  });
});
