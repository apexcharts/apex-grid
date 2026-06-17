import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { ApexGridEnterprise } from '../src/index.js';

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

async function mount(extra: Record<string, unknown>) {
  const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
    .data=${makeData()}
    .columns=${columns}
    .aggregations=${extra.aggregations ?? {}}
    .groupBy=${extra.groupBy ?? []}
    .pivotOn=${extra.pivotOn ?? ''}
    .pivotRows=${extra.pivotRows ?? []}
    .pivotValues=${extra.pivotValues ?? {}}
  ></apex-grid-enterprise>`);
  await grid.updateComplete;
  await nextFrame();
  return grid;
}

describe('ApexGridEnterprise integrated charts — getChartModel', () => {
  before(() => ApexGridEnterprise.register());
  afterEach(() => fixtureCleanup());

  it('returns an empty model when neither grouping nor pivot is active', async () => {
    const grid = await mount({});
    const model = grid.getChartModel();
    expect(model.categories).to.eql([]);
    expect(model.series).to.eql([]);
  });

  it('charts group aggregates: categories = group labels, series = measure×fn', async () => {
    const grid = await mount({ groupBy: ['region'], aggregations: { amount: ['sum'] } });
    const model = grid.getChartModel();

    expect(model.categories).to.eql(['EMEA', 'AMER']);
    expect(model.series.length).to.equal(1);
    expect(model.series[0].name).to.equal('amount sum');
    expect(model.series[0].data).to.eql([30, 70]); // EMEA 10+20, AMER 30+40
  });

  it('charts a pivot: categories = row labels, one series per pivot column', async () => {
    const grid = await mount({
      pivotOn: 'product',
      pivotRows: ['region'],
      pivotValues: { amount: ['sum'] },
    });
    const model = grid.getChartModel();

    expect(model.categories).to.eql(['EMEA', 'AMER']);
    expect(model.series.map((s) => s.name)).to.eql(['A', 'B']);
    expect(model.series.find((s) => s.name === 'A')!.data).to.eql([10, 70]);
    expect(model.series.find((s) => s.name === 'B')!.data).to.eql([20, 0]);
  });
});
