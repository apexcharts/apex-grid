import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
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
  { key: 'amount' },
];

function stateOf(grid: ApexGridEnterprise<Row>) {
  return (grid as unknown as { stateController: { modules: Map<string, unknown> } })
    .stateController;
}

async function mountPivot(
  pivotOn = 'product',
  pivotRows: string[] = ['region'],
  pivotValues: AggregationConfig = { amount: ['sum'] }
) {
  const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
    .data=${makeData()}
    .columns=${columns}
    .pivotOn=${pivotOn}
    .pivotRows=${pivotRows}
    .pivotValues=${pivotValues}
  ></apex-grid-enterprise>`);
  await grid.updateComplete;
  await nextFrame();
  return grid;
}

/** Reads pivot rows as plain records (synthetic keys). */
function rowsOf(grid: ApexGridEnterprise<Row>) {
  return grid.pageItems as ReadonlyArray<Record<string, unknown>>;
}

const A = 'pivot::A::amount::sum';
const B = 'pivot::B::amount::sum';

describe('ApexGridEnterprise pivoting', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  it('registers the pivot module alongside aggregation + grouping', async () => {
    const grid = await mountPivot('', [], {});
    const { modules } = stateOf(grid);
    expect(modules.size).to.equal(6);
    expect(modules.has('pivot')).to.be.true;
    expect(modules.has('grouping')).to.be.true;
    expect(modules.has('aggregation')).to.be.true;
    expect(modules.has('formula')).to.be.true;
  });

  it('turns distinct column-dimension values into columns', async () => {
    const grid = await mountPivot();
    expect(grid.isPivoting).to.be.true;
    expect(grid.columns.map((c) => c.key)).to.eql(['region', A, B]);
    // Single measure+fn ⇒ header is just the pivot value.
    expect(grid.columns.map((c) => c.headerText)).to.eql(['Region', 'A', 'B']);
  });

  it('fills cells with the aggregate of the matching leaves', async () => {
    const grid = await mountPivot();
    const rows = rowsOf(grid);
    expect(rows.length, 'one row per region').to.equal(2);

    const emea = rows.find((r) => r.region === 'EMEA')!;
    expect(emea[A]).to.equal(10);
    expect(emea[B]).to.equal(20);

    const amer = rows.find((r) => r.region === 'AMER')!;
    expect(amer[A]).to.equal(70); // 30 + 40
    expect(amer[B]).to.equal(0); // no B in AMER
  });

  it('aggregates reflect the filtered leaves', async () => {
    const grid = await mountPivot();
    grid.quickFilter = 'AMER';
    await grid.updateComplete;
    await nextFrame();
    await nextFrame();

    const rows = rowsOf(grid);
    expect(rows.length).to.equal(1);
    expect(rows[0].region).to.equal('AMER');
    expect(rows[0][A]).to.equal(70);
  });

  it('restores the original columns when pivoting is turned off', async () => {
    const grid = await mountPivot();
    expect(grid.columns.map((c) => c.key)).to.eql(['region', A, B]);

    grid.pivotOn = '';
    await grid.updateComplete;
    await nextFrame();

    expect(grid.isPivoting).to.be.false;
    expect(grid.columns.map((c) => c.key)).to.eql(['region', 'product', 'amount']);
  });

  it('supports multiple measures (one column per value × fn)', async () => {
    const grid = await mountPivot('product', ['region'], { amount: ['sum', 'count'] });
    const keys = grid.columns.map((c) => c.key);
    expect(keys).to.include('pivot::A::amount::sum');
    expect(keys).to.include('pivot::A::amount::count');
    const emea = rowsOf(grid).find((r) => r.region === 'EMEA')!;
    expect(emea['pivot::A::amount::sum']).to.equal(10);
    expect(emea['pivot::A::amount::count']).to.equal(1);
  });
});
