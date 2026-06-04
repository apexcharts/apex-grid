import { expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { ApexGridEnterprise } from '../src/index.js';

type Row = { id: number; age: number };
const data: Row[] = [
  { id: 1, age: 10 },
  { id: 2, age: 20 },
  { id: 3, age: 30 },
];
const columns: ColumnConfiguration<Row>[] = [{ key: 'id' }, { key: 'age' }];

describe('ApexGridEnterprise aggregations', () => {
  before(() => ApexGridEnterprise.register());
  afterEach(() => fixtureCleanup());

  it('computes sum/avg/min/max/count for a numeric column', async () => {
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise
        .data=${data}
        .columns=${columns}
        .aggregations=${{ age: ['sum', 'avg', 'min', 'max', 'count'] }}
      ></apex-grid-enterprise>`
    );

    const result = grid.getAggregations();
    expect(result.age).to.deep.equal({ sum: 60, avg: 20, min: 10, max: 30, count: 3 });
  });

  it('returns an empty result when nothing is configured', async () => {
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`
    );
    expect(grid.getAggregations()).to.deep.equal({});
  });
});
