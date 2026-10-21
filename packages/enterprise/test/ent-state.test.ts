import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  ApexGridEnterprise,
  enterpriseModules,
  pivotModule,
  rangeSelectionModule,
} from '../src/index.js';

// ent-grid-core-5: getSchema advertises only the registered modules.

interface Row {
  id: number;
  region: string;
  product: string;
  amount: number;
  total?: number;
}

function makeData(): Row[] {
  return [
    { id: 1, region: 'EMEA', product: 'A', amount: 10, total: 0 },
    { id: 2, region: 'EMEA', product: 'B', amount: 20, total: 0 },
    { id: 3, region: 'AMER', product: 'A', amount: 30, total: 0 },
    { id: 4, region: 'AMER', product: 'B', amount: 40, total: 0 },
  ];
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number' },
  { key: 'region' },
  { key: 'product' },
  { key: 'amount', type: 'number' },
  { key: 'total', type: 'number', allowFormula: true },
];

async function settle(grid: ApexGridEnterprise<Row>) {
  await grid.updateComplete;
  await nextFrame();
  await grid.updateComplete;
}

async function mount(data: Row[] = makeData()): Promise<ApexGridEnterprise<Row>> {
  const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
    .data=${data}
    .columns=${columns}
  ></apex-grid-enterprise>`);
  await settle(grid);
  return grid;
}

describe('ent-state: enterprise state blob', () => {
  before(() => ApexGridEnterprise.register());
  afterEach(() => fixtureCleanup());

  // Modules are global and read when a grid is constructed, so the subsets run
  // first and each later block only adds modules.
  describe('getSchema with a module subset (ent-grid-core-5)', () => {
    it('advertises no grouping, pivot or aggregation without their modules', async () => {
      ApexGridEnterprise.use(rangeSelectionModule);
      const schema = (await mount()).getSchema();
      expect(schema.capabilities.grouping).to.not.equal(true);
      expect(schema.capabilities.pivot).to.not.equal(true);
      expect(schema.capabilities.aggregation).to.equal(undefined);
      for (const column of schema.columns) {
        expect(column.groupable, column.key).to.not.equal(true);
        expect(column.pivotable, column.key).to.not.equal(true);
        expect(column.aggregatable, column.key).to.not.equal(true);
        expect(column.aggFuncs, column.key).to.equal(undefined);
      }
    });

    it('advertises pivot (and the measures it aggregates) with only the pivot module', async () => {
      ApexGridEnterprise.use(pivotModule);
      const schema = (await mount()).getSchema();
      expect(schema.capabilities.pivot).to.equal(true);
      expect(schema.capabilities.grouping).to.not.equal(true);
      // Pivot values are aggregations, so the functions stay advertised.
      expect(schema.capabilities.aggregation?.funcs).to.include('sum');
      const amount = schema.columns.find((column) => column.key === 'amount')!;
      expect(amount.pivotable).to.equal(true);
      expect(amount.groupable).to.not.equal(true);
      expect(amount.aggFuncs).to.include('sum');
    });
  });

  describe('with every module', () => {
    before(() => ApexGridEnterprise.use(...enterpriseModules));

    it('advertises grouping, pivot and aggregation', async () => {
      const schema = (await mount()).getSchema();
      expect(schema.capabilities.grouping).to.equal(true);
      expect(schema.capabilities.pivot).to.equal(true);
      expect(schema.capabilities.aggregation?.funcs).to.include('sum');
      const region = schema.columns.find((column) => column.key === 'region')!;
      expect(region.groupable).to.equal(true);
      expect(region.aggregatable).to.equal(false);
    });
  });
});
