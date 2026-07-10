import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration, GridSchema } from 'apex-grid';
import { createFakeGridApi, emptyGridState, gridApiFor } from '../src/features/ai/index.js';
import { ApexGridEnterprise, enterpriseModules } from '../src/index.js';

interface Row {
  region: string;
  amount: number;
}

const schema: GridSchema = {
  version: 1,
  columns: [
    {
      key: 'region',
      label: 'Region',
      dataType: 'string',
      sortable: true,
      filterable: true,
      filterOperands: ['equals', 'contains'],
      editable: false,
      hidden: false,
    },
    {
      key: 'amount',
      label: 'Amount',
      dataType: 'number',
      sortable: true,
      filterable: true,
      filterOperands: ['equals', 'greaterThan'],
      editable: false,
      hidden: false,
    },
  ],
  capabilities: {
    sort: { directions: ['ascending', 'descending'], multi: true },
    filter: { operandsByType: {} },
    pagination: false,
    selection: 'multiple',
    rowPinning: false,
    rowReordering: false,
  },
  state: emptyGridState(),
};

const columns: ColumnConfiguration<Row>[] = [
  { key: 'region', sort: true, filter: true },
  { key: 'amount', type: 'number', sort: true, filter: true },
];

const data: Row[] = [
  { region: 'EMEA', amount: 10 },
  { region: 'AMER', amount: 30 },
];

describe('AI reasoning layer — GridApi', () => {
  describe('createFakeGridApi (pure)', () => {
    it('records applied patches and merges them into state', () => {
      const api = createFakeGridApi<Row>({ schema, data });
      const result = api.applyState({ sort: [{ key: 'amount', direction: 'descending' }] });
      expect(result.applied).to.include('sort');
      expect(api.getState().sort).to.deep.equal([{ key: 'amount', direction: 'descending' }]);
      expect(api.calls).to.have.length(1);
    });

    it('reports data, schema columns, and locale', () => {
      const api = createFakeGridApi<Row>({
        schema,
        data,
        localeText: { 'toolbar.askAI': 'Ask AI' },
      });
      expect(api.getData()).to.have.length(2);
      expect(api.getSchema().columns.map((c) => c.key)).to.deep.equal(['region', 'amount']);
      expect(api.getLocaleText()).to.deep.equal({ 'toolbar.askAI': 'Ask AI' });
    });

    it('embeds the live state into the reported schema', () => {
      const api = createFakeGridApi<Row>({ schema, data });
      api.applyState({ quickFilter: 'hub' });
      expect(api.getSchema().state.quickFilter).to.equal('hub');
    });
  });

  describe('gridApiFor (over a live element)', () => {
    before(() => {
      ApexGridEnterprise.use(...enterpriseModules);
      ApexGridEnterprise.register();
    });
    afterEach(() => fixtureCleanup());

    async function mount(): Promise<ApexGridEnterprise<Row>> {
      const grid = await fixture<ApexGridEnterprise<Row>>(
        html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`
      );
      await grid.updateComplete;
      await nextFrame();
      return grid;
    }

    it('delegates introspection to the element', async () => {
      const grid = await mount();
      const api = gridApiFor(grid);
      expect(api.getSchema().columns.map((c) => c.key)).to.include('amount');
      expect(api.getData()).to.have.length(2);
    });

    it('routes applyState through the element setState (defensively)', async () => {
      const grid = await mount();
      const api = gridApiFor(grid);
      const result = api.applyState({ sort: [{ key: 'amount', direction: 'descending' }] });
      await grid.updateComplete;
      expect(result.applied).to.include('sort');
      expect(grid.getState().sort.map((s) => s.key)).to.deep.equal(['amount']);
    });
  });
});
