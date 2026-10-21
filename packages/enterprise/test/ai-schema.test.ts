import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration, GridSchema } from 'apex-grid';
import {
  ConversationMemory,
  createContextBuilder,
  createDefaultRegistry,
  createToolExecutor,
  gridApiFor,
} from '../src/features/ai/index.js';
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

  it('marks rating and progress columns aggregatable, like the aggregation engine', async () => {
    const grid = await fixture<ApexGridEnterprise<{ name: string; score: number; done: number }>>(
      html`<apex-grid-enterprise
        .data=${[{ name: 'A', score: 4, done: 50 }]}
        .columns=${[
          { key: 'name' },
          { key: 'score', type: 'rating' },
          { key: 'done', type: 'progress' },
        ]}
      ></apex-grid-enterprise>`
    );
    await grid.updateComplete;
    const byKey = new Map(grid.getSchema().columns.map((c) => [c.key, c]));
    expect(byKey.get('score')?.aggregatable).to.be.true;
    expect(byKey.get('done')?.aggregatable).to.be.true;
    expect(byKey.get('done')?.aggFuncs).to.not.be.empty;
    expect(byKey.get('name')?.aggregatable).to.be.false;
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
    // Every entry was refused, so the slice is left out rather than sent as a clear.
    expect(patch.filter).to.be.undefined;
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

  // --- trust boundary: refusals never clear the view ---------------------

  type Blob = Record<string, unknown>;

  /** Run the applyState tool, the path an LLM reasoner's patch takes. */
  function runApplyState(grid: ApexGridEnterprise<Row>, patch: Blob) {
    const api = gridApiFor(grid);
    const ctx = createContextBuilder<Row>().build(api, new ConversationMemory());
    return createToolExecutor(createDefaultRegistry()).run(
      {
        mode: 'control',
        steps: [{ tool: 'applyState', args: { patch } }],
        confidence: 1,
        source: 'llm',
      },
      { api, ctx }
    );
  }
  const enterpriseOf = (patch: { modules?: Blob }) => patch.modules?.enterprise as Blob | undefined;

  it('leaves a sort untouched when "sort by" names a non-sortable column', async () => {
    const grid = await mount();
    grid.setState({ sort: [{ key: 'amount', direction: 'descending' }] });
    await grid.updateComplete;

    const result = await grid.runPrompt('sort by note');
    await grid.updateComplete;
    expect(grid.getState().sort.map((s) => s.key)).to.deep.equal(['amount']);
    expect(result.mode).to.equal('control');
    if (result.mode !== 'control') return;
    expect(result.applied).to.not.include('sort');
    expect(result.skipped).to.include('sort');
  });

  it('omits every slice whose entries were all refused, with a warning each', async () => {
    const schema = (await mount()).getSchema();
    const { patch, warnings } = sanitizePatch(
      {
        sort: [{ key: 'note', direction: 'ascending' }],
        filter: [{ key: 'ghost', operand: 'equals', searchTerm: 1 }],
        columns: [{ key: 'ghost', hidden: true }],
        selection: [{ index: -1 }] as never,
        modules: {
          enterprise: {
            groupBy: ['ghost'],
            pivotOn: ['ghost'],
            pivotRows: ['ghost'],
            aggregations: { region: ['sum'] },
            pivotValues: { amount: ['bogus'] },
          },
        },
      },
      schema
    );
    expect(patch).to.deep.equal({});
    for (const slice of [
      'sort',
      'filter',
      'columns',
      'groupBy',
      'pivotOn',
      'pivotRows',
      'aggregations',
      'pivotValues',
    ]) {
      expect(warnings, slice).to.include(`${slice}: no valid entries, left unchanged`);
    }
  });

  it('keeps an all-refused grouping on the grid instead of clearing it', async () => {
    const grid = await mount();
    grid.setState({ modules: { enterprise: { groupBy: ['region'] } } });
    await grid.updateComplete;
    const { patch } = sanitizePatch(
      { modules: { enterprise: { groupBy: ['ghost'] } } },
      grid.getSchema()
    );
    const result = grid.setState(patch);
    await grid.updateComplete;
    expect(grid.groupBy).to.deep.equal(['region']);
    expect(result.applied).to.not.include('modules');
  });

  it('passes an explicitly empty slice through as the deliberate clear', async () => {
    const schema = (await mount()).getSchema();
    const { patch, warnings } = sanitizePatch(
      {
        sort: [],
        filter: [],
        modules: {
          enterprise: {
            groupBy: [],
            pivotOn: '',
            pivotRows: [],
            aggregations: {},
            pivotValues: {},
          },
        },
      },
      schema
    );
    expect(patch.sort).to.deep.equal([]);
    expect(patch.filter).to.deep.equal([]);
    expect(enterpriseOf(patch)).to.deep.equal({
      groupBy: [],
      pivotOn: '',
      pivotRows: [],
      aggregations: {},
      pivotValues: {},
    });
    expect(warnings).to.be.empty;
  });

  it('treats a known column with no functions as removing its aggregation', async () => {
    const schema = (await mount()).getSchema();
    for (const field of ['aggregations', 'pivotValues']) {
      const { patch, warnings } = sanitizePatch(
        { modules: { enterprise: { [field]: { amount: [] } } } },
        schema
      );
      expect(enterpriseOf(patch)).to.deep.equal({ [field]: {} });
      expect(warnings).to.be.empty;
    }
  });

  // --- trust boundary: the enterprise blob matches its advertised schema ---

  it('drops groupExpand and ranges, which the AI schema does not offer', async () => {
    const grid = await mount();
    const { patch, warnings } = sanitizePatch(
      { modules: { enterprise: { groupBy: ['region'], groupExpand: null, ranges: [null] } } },
      grid.getSchema()
    );
    expect(enterpriseOf(patch)).to.deep.equal({ groupBy: ['region'] });
    expect(warnings).to.include(
      'modules.enterprise.groupExpand: not part of the AI patch surface, dropped'
    );
    expect(warnings).to.include(
      'modules.enterprise.ranges: not part of the AI patch surface, dropped'
    );
    const json = toJSONSchema(grid.getSchema());
    const enterprise = json.properties?.modules?.properties?.enterprise as JSONSchema;
    expect(enterprise.properties).to.not.have.any.keys('groupExpand', 'ranges');

    // The applyState tool applies the grouping and does not throw on the bad blob.
    const run = runApplyState(grid, {
      modules: { enterprise: { groupBy: ['region'], groupExpand: null } },
    });
    await grid.updateComplete;
    expect(grid.groupBy).to.deep.equal(['region']);
    expect(run.applied).to.include('modules');
  });

  it('warns about unknown keys inside modules.enterprise and reports nothing applied', async () => {
    const schema = (await mount()).getSchema();
    const { patch, warnings } = sanitizePatch(
      { modules: { enterprise: { groupby: ['region'], formulas: [] } } },
      schema
    );
    expect(patch.modules).to.be.undefined;
    expect(warnings).to.include(
      'modules.enterprise.groupby: not part of the AI patch surface, dropped'
    );
    expect(warnings).to.include(
      'modules.enterprise.formulas: not part of the AI patch surface, dropped'
    );
  });

  it('keeps third-party module blobs untouched', async () => {
    const schema = (await mount()).getSchema();
    const { patch, warnings } = sanitizePatch({ modules: { other: { a: 1 } } }, schema);
    expect(patch.modules).to.deep.equal({ other: { a: 1 } });
    expect(warnings).to.be.empty;
  });

  // --- trust boundary: typed fields -------------------------------------

  it('rebuilds column entries from typed fields only, warning for each dropped field', async () => {
    const schema = (await mount()).getSchema();
    const { patch, warnings } = sanitizePatch(
      {
        columns: [
          { key: 'region', hidden: 'false' },
          { key: 'product', width: 200, pinned: 'left', hidden: false },
          { key: 'amount', pinned: null, width: '120px', extra: 1 },
          { key: 'note', pinned: 'end', hidden: true, width: undefined },
        ] as never,
      },
      schema
    );
    expect(patch.columns).to.deep.equal([
      { key: 'region' },
      { key: 'product', hidden: false },
      { key: 'amount', pinned: null, width: '120px' },
      { key: 'note', pinned: 'end', hidden: true },
    ]);
    expect(warnings).to.have.lengthOf(4);
    expect(warnings.some((w) => w.includes('"hidden" on "region"'))).to.be.true;
    expect(warnings.some((w) => w.includes('"width" on "product"'))).to.be.true;
    expect(warnings.some((w) => w.includes('"pinned" on "product"'))).to.be.true;
    expect(warnings.some((w) => w.includes('"extra" on "amount"'))).to.be.true;
  });

  it('does not hide a column when a model sends hidden as a string', async () => {
    const grid = await mount();
    const run = runApplyState(grid, {
      columns: [
        { key: 'region', hidden: 'false' },
        { key: 'product', hidden: false },
        { key: 'amount', hidden: false },
        { key: 'note', hidden: false },
      ],
    });
    await grid.updateComplete;
    expect(run.warnings.some((w) => w.includes('"hidden" on "region"'))).to.be.true;
    expect(grid.columns.find((c) => c.key === 'region')?.hidden).to.not.be.ok;
  });

  it('drops a non-boolean caseSensitive on sort and filter entries', async () => {
    const schema = (await mount()).getSchema();
    const { patch, warnings } = sanitizePatch(
      {
        sort: [{ key: 'region', direction: 'ascending', caseSensitive: 'yes' }],
        filter: [{ key: 'region', operand: 'contains', searchTerm: 'E', caseSensitive: 1 }],
      } as never,
      schema
    );
    expect(patch.sort).to.deep.equal([{ key: 'region', direction: 'ascending' }]);
    expect(patch.filter).to.deep.equal([{ key: 'region', operand: 'contains', searchTerm: 'E' }]);
    expect(warnings.filter((w) => w.includes('caseSensitive'))).to.have.lengthOf(2);
  });

  // --- selection / pagination gating ------------------------------------

  async function mountEnabled(): Promise<ApexGridEnterprise<Row>> {
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .data=${data}
      .columns=${columns}
      .pagination=${{ enabled: true, pageSize: 1 }}
      .selection=${{ enabled: true }}
    ></apex-grid-enterprise>`);
    await grid.updateComplete;
    await nextFrame();
    return grid;
  }

  it('advertises and keeps selection and pagination when the grid enables them', async () => {
    const schema = (await mountEnabled()).getSchema();
    const json = toJSONSchema(schema);
    expect(json.properties).to.include.keys('pagination', 'selection');
    const { patch, warnings } = sanitizePatch(
      { pagination: { page: 1, pageSize: 1 }, selection: [{ id: 'a' }, { index: 1 }] },
      schema
    );
    expect(patch.pagination).to.deep.equal({ page: 1, pageSize: 1 });
    expect(patch.selection).to.deep.equal([{ id: 'a' }, { index: 1 }]);
    expect(warnings).to.be.empty;
  });

  it('drops selection and pagination when the grid disables them', async () => {
    const schema = (await mount()).getSchema();
    const json = toJSONSchema(schema);
    expect(json.properties).to.not.have.any.keys('pagination', 'selection');
    const { patch, warnings } = sanitizePatch(
      { pagination: { page: 1, pageSize: 1 }, selection: [{ index: 0 }] },
      schema
    );
    expect(patch).to.deep.equal({});
    expect(warnings).to.include('pagination: grid is not paginated, dropped');
    expect(warnings).to.include('selection: grid selection is disabled, dropped');
  });

  it('keeps only well-formed selection references', async () => {
    const schema = (await mountEnabled()).getSchema();
    const { patch, warnings } = sanitizePatch(
      {
        selection: [
          0,
          { id: 'x' },
          { index: -1 },
          { index: 1.5 },
          { index: 2, extra: 1 },
          { id: {} },
        ],
      } as never,
      schema
    );
    expect(patch.selection).to.deep.equal([{ id: 'x' }, { index: 2 }]);
    expect(warnings.filter((w) => w.startsWith('selection:'))).to.have.lengthOf(4);
  });

  // --- pivot ------------------------------------------------------------

  it('validates pivotOn, pivotRows and pivotValues against the pivotable columns', async () => {
    const schema = (await mount()).getSchema();
    const run = (enterprise: Blob) => sanitizePatch({ modules: { enterprise } }, schema);

    expect(enterpriseOf(run({ pivotOn: '' }).patch)).to.deep.equal({ pivotOn: '' });
    expect(enterpriseOf(run({ pivotOn: 'region' }).patch)).to.deep.equal({ pivotOn: 'region' });
    const ghost = run({ pivotOn: 'ghost' });
    expect(ghost.patch).to.deep.equal({});
    expect(ghost.warnings.some((w) => w.includes('"ghost" is not pivotable'))).to.be.true;
    expect(enterpriseOf(run({ pivotOn: ['region', 'ghost'] }).patch)).to.deep.equal({
      pivotOn: ['region'],
    });

    const full = run({
      pivotOn: 'region',
      pivotRows: ['product', 'ghost'],
      pivotValues: { amount: ['sum', 'bogus'], region: ['sum'] },
    });
    expect(enterpriseOf(full.patch)).to.deep.equal({
      pivotOn: 'region',
      pivotRows: ['product'],
      pivotValues: { amount: ['sum'] },
    });
    expect(full.warnings).to.have.lengthOf(3);
  });

  it('drops pivot fields when the grid does not pivot or aggregate', async () => {
    const base = (await mount()).getSchema();
    const noPivot: GridSchema = { ...base, capabilities: { ...base.capabilities, pivot: false } };
    const off = sanitizePatch(
      {
        modules: {
          enterprise: {
            pivotOn: 'region',
            pivotRows: ['product'],
            pivotValues: { amount: ['sum'] },
          },
        },
      },
      noPivot
    );
    expect(off.patch).to.deep.equal({});
    expect(off.warnings).to.deep.equal([
      'pivot: not available, pivotOn dropped',
      'pivot: not available, pivotRows dropped',
      'pivot: not available, pivotValues dropped',
    ]);

    const noAgg: GridSchema = {
      ...base,
      capabilities: { ...base.capabilities, aggregation: undefined },
    };
    const json = toJSONSchema(noAgg);
    const enterprise = json.properties?.modules?.properties?.enterprise as JSONSchema;
    expect(enterprise.properties).to.not.have.any.keys('aggregations', 'pivotValues');
    const values = sanitizePatch(
      { modules: { enterprise: { pivotValues: { amount: ['sum'] } } } },
      noAgg
    );
    expect(values.warnings).to.deep.equal(['aggregation: not available, pivotValues dropped']);
  });

  // --- aggregation functions: one source for schema and guard -------------

  it('accepts only the aggregation functions the schema advertises per column', async () => {
    const base = (await mount()).getSchema();
    const schema: GridSchema = {
      ...base,
      columns: base.columns.map((c) => (c.key === 'amount' ? { ...c, aggFuncs: ['sum'] } : c)),
    };
    const json = toJSONSchema(schema);
    const enterprise = json.properties?.modules?.properties?.enterprise as JSONSchema;
    const amountEnum = (prop: string) =>
      (
        (enterprise.properties?.[prop]?.properties as Record<string, JSONSchema>)?.amount
          ?.items as JSONSchema
      )?.enum;
    expect(amountEnum('aggregations')).to.deep.equal(['sum']);
    expect(amountEnum('pivotValues')).to.deep.equal(['sum']);

    for (const field of ['aggregations', 'pivotValues']) {
      const { patch, warnings } = sanitizePatch(
        { modules: { enterprise: { [field]: { amount: ['sum', 'avg'] } } } },
        schema
      );
      expect(enterpriseOf(patch)?.[field], field).to.deep.equal({ amount: ['sum'] });
      expect(
        warnings.some((w) => w.includes('function "avg"')),
        field
      ).to.be.true;
    }
  });

  it('treats an explicit empty aggFuncs list as no functions, in schema and guard alike', async () => {
    const base = (await mount()).getSchema();
    const schema: GridSchema = {
      ...base,
      columns: base.columns.map((c) => (c.key === 'amount' ? { ...c, aggFuncs: [] } : c)),
    };
    const json = toJSONSchema(schema);
    const enterprise = json.properties?.modules?.properties?.enterprise as JSONSchema;
    const amount = (enterprise.properties?.aggregations?.properties as Record<string, JSONSchema>)
      .amount;
    expect((amount.items as JSONSchema).enum).to.deep.equal([]);
    const { patch } = sanitizePatch(
      { modules: { enterprise: { aggregations: { amount: ['sum'] } } } },
      schema
    );
    expect(patch.modules).to.be.undefined;
  });
});
