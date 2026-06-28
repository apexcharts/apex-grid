import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration, GridSchema } from 'apex-grid';
import {
  ApexGridEnterprise,
  enterpriseModules,
  type JSONSchema,
  sanitizePatch,
  toJSONSchema,
} from '../src/index.js';

interface Row {
  region: string;
  product: string;
  amount: number;
  note?: string;
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'region', sort: true, filter: true },
  { key: 'product', sort: true, filter: true },
  { key: 'amount', type: 'number', sort: true, filter: true },
  { key: 'note' }, // neither sortable nor filterable
];

const data: Row[] = [
  { region: 'EMEA', product: 'A', amount: 10 },
  { region: 'AMER', product: 'B', amount: 30 },
];

describe('AI Toolkit — schema (toJSONSchema) + sanitizePatch', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  async function mount(): Promise<ApexGridEnterprise<Row>> {
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .data=${data}
      .columns=${columns}
    ></apex-grid-enterprise>`);
    await grid.updateComplete;
    await nextFrame();
    return grid;
  }

  // --- toJSONSchema -------------------------------------------------------

  it('constrains sort to sortable columns and advertised directions', async () => {
    const schema = (await mount()).getSchema();
    const json = toJSONSchema(schema);
    const sortItems = (json.properties?.sort?.items as JSONSchema)?.properties;

    expect(sortItems?.key?.enum).to.deep.equal(['region', 'product', 'amount']);
    expect(sortItems?.direction?.enum).to.deep.equal(schema.capabilities.sort.directions);
  });

  it('emits one filter branch per filterable column, each with that column operands', async () => {
    const schema = (await mount()).getSchema();
    const json = toJSONSchema(schema);
    const branches = (json.properties?.filter?.items as JSONSchema)?.oneOf ?? [];

    // region / product / amount are filterable; note is not.
    expect(branches.map((b) => b.properties?.key?.const)).to.deep.equal([
      'region',
      'product',
      'amount',
    ]);
    const amountBranch = branches.find((b) => b.properties?.key?.const === 'amount');
    const amountColumn = schema.columns.find((c) => c.key === 'amount');
    expect(amountBranch?.properties?.operand?.enum).to.deep.equal(amountColumn?.filterOperands);
  });

  it('lists every column key for layout, but only numeric columns for aggregation', async () => {
    const schema = (await mount()).getSchema();
    const json = toJSONSchema(schema);

    const columnKeys = (json.properties?.columns?.items as JSONSchema)?.properties?.key?.enum;
    expect(columnKeys).to.deep.equal(['region', 'product', 'amount', 'note']);

    const enterprise = json.properties?.modules?.properties?.enterprise as JSONSchema;
    // Enterprise marks every column groupable.
    expect((enterprise?.properties?.groupBy?.items as JSONSchema)?.enum).to.have.lengthOf(4);
    // Only the numeric column is aggregatable.
    expect(Object.keys(enterprise?.properties?.aggregations?.properties ?? {})).to.deep.equal([
      'amount',
    ]);
  });

  it('omits slices the grid does not support', async () => {
    const schema = (await mount()).getSchema();
    const json = toJSONSchema(schema);
    // Derive expectations from the live capabilities so the test tracks config.
    if (!schema.capabilities.pagination) expect(json.properties?.pagination).to.be.undefined;
    if (schema.capabilities.selection === false) expect(json.properties?.selection).to.be.undefined;
  });

  // --- sanitizePatch ------------------------------------------------------

  it('passes a valid patch through unchanged with no warnings', async () => {
    const schema = (await mount()).getSchema();
    const { patch, warnings } = sanitizePatch(
      { sort: [{ key: 'amount', direction: 'descending' }], quickFilter: 'abc' },
      schema
    );
    expect(patch.sort).to.deep.equal([{ key: 'amount', direction: 'descending' }]);
    expect(patch.quickFilter).to.equal('abc');
    expect(warnings).to.be.empty;
  });

  it('drops sort on unknown or non-sortable columns, with a warning each', async () => {
    const schema = (await mount()).getSchema();
    const { patch, warnings } = sanitizePatch(
      {
        sort: [
          { key: 'amount', direction: 'descending' },
          { key: 'nope', direction: 'ascending' },
          { key: 'note', direction: 'ascending' }, // exists but not sortable
        ],
      },
      schema
    );
    expect(patch.sort).to.deep.equal([{ key: 'amount', direction: 'descending' }]);
    expect(warnings.some((w) => w.includes('unknown column "nope"'))).to.be.true;
    expect(warnings.some((w) => w.includes('"note" is not sortable'))).to.be.true;
  });

  it('drops filters with an invalid operand or on a non-filterable column', async () => {
    const schema = (await mount()).getSchema();
    const { patch, warnings } = sanitizePatch(
      {
        filter: [
          { key: 'amount', operand: 'not-an-operand' },
          { key: 'note', operand: 'contains' }, // not filterable
        ],
      },
      schema
    );
    expect(patch.filter).to.be.empty;
    expect(warnings.some((w) => w.includes('operand "not-an-operand"'))).to.be.true;
    expect(warnings.some((w) => w.includes('"note" is not filterable'))).to.be.true;
  });

  it('keeps only the first sort on a single-sort grid', async () => {
    const base = (await mount()).getSchema();
    const schema: GridSchema = {
      ...base,
      capabilities: { ...base.capabilities, sort: { ...base.capabilities.sort, multi: false } },
    };
    const { patch, warnings } = sanitizePatch(
      {
        sort: [
          { key: 'region', direction: 'ascending' },
          { key: 'amount', direction: 'descending' },
        ],
      },
      schema
    );
    expect(patch.sort).to.deep.equal([{ key: 'region', direction: 'ascending' }]);
    expect(warnings.some((w) => w.includes('single-sort'))).to.be.true;
  });

  it('validates the enterprise blob: groupBy keys + aggregation funcs', async () => {
    const schema = (await mount()).getSchema();
    const { patch, warnings } = sanitizePatch(
      {
        modules: {
          enterprise: {
            groupBy: ['region', 'ghost'],
            aggregations: { amount: ['sum', 'bogus'], region: ['sum'] },
          },
        },
      },
      schema
    );
    const enterprise = patch.modules?.enterprise as Record<string, unknown>;
    expect(enterprise.groupBy).to.deep.equal(['region']);
    expect(enterprise.aggregations).to.deep.equal({ amount: ['sum'] });
    expect(warnings.some((w) => w.includes('"ghost" is not groupable'))).to.be.true;
    expect(warnings.some((w) => w.includes('function "bogus"'))).to.be.true;
    expect(warnings.some((w) => w.includes('"region" is not aggregatable'))).to.be.true;
  });

  it('warns and drops slices outside the AI patch surface', async () => {
    const schema = (await mount()).getSchema();
    const { patch, warnings } = sanitizePatch(
      { rowOrder: [{ index: 0 }] } as Record<string, unknown>,
      schema
    );
    expect(patch).to.not.have.property('rowOrder');
    expect(warnings.some((w) => w.includes('rowOrder'))).to.be.true;
  });
});
