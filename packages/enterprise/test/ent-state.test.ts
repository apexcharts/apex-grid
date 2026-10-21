import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration, GridState } from 'apex-grid';
import { PIVOT_MODULE_ID, type PivotController } from '../src/features/pivot.js';
import {
  type AdvancedFilterModel,
  ApexGridEnterprise,
  enterpriseModules,
  getPivotMeta,
  pivotModule,
  rangeSelectionModule,
} from '../src/index.js';

// ent-grid-core-5, ent-grid-core-6, ent-grid-core-7, ent-pivot-6,
// ent-filter-builder-7: the enterprise slice of getState / setState / getSchema.

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

function pivotOf(grid: ApexGridEnterprise<Row>): PivotController<Row> {
  return (
    grid as unknown as { stateController: { module<C>(id: string): C | undefined } }
  ).stateController.module<PivotController<Row>>(PIVOT_MODULE_ID)!;
}

/** A snapshot as it comes back from storage. */
function stored(state: GridState): GridState {
  return JSON.parse(JSON.stringify(state));
}

function blobOf(state: GridState): Record<string, unknown> {
  return state.modules.enterprise as Record<string, unknown>;
}

const amountOver15: AdvancedFilterModel = {
  kind: 'group',
  join: 'and',
  children: [{ kind: 'condition', column: 'amount', operator: 'greaterThan', value: 15 }],
};

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

    it('reports in applied only the fields whose module is registered', async () => {
      // Only range selection is registered here (see the test above).
      const grid = await mount();
      const result = grid.setState({
        modules: {
          enterprise: {
            groupBy: ['region'],
            aggregations: { amount: ['sum'] },
            pivotOn: 'product',
            pivotExpand: { EMEA: false },
            ranges: [],
            formulas: [],
            advancedFilter: amountOver15,
          },
        },
      });
      expect(result.applied).to.include.members([
        'modules.enterprise.ranges',
        'modules.enterprise.advancedFilter',
      ]);
      for (const field of ['groupBy', 'aggregations', 'pivotOn', 'pivotExpand', 'formulas']) {
        expect(result.applied).to.not.include(`modules.enterprise.${field}`);
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
      const result = (await mount()).setState({
        modules: { enterprise: { groupBy: ['region'], pivotOn: 'product' } },
      });
      expect(result.applied).to.include('modules.enterprise.pivotOn');
      expect(result.applied).to.not.include('modules.enterprise.groupBy');
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

    describe('advanced filter (ent-grid-core-6, ent-filter-builder-7)', () => {
      it('round-trips through a stored snapshot onto a fresh grid', async () => {
        const grid = await mount();
        grid.applyAdvancedFilter(amountOver15);
        await settle(grid);
        expect(grid.pageItems.length).to.equal(3);
        const saved = stored(grid.getState());
        expect(blobOf(saved).advancedFilter).to.deep.equal(amountOver15);

        const next = await mount();
        const result = next.setState(saved);
        await settle(next);
        expect(next.advancedFilterModel).to.deep.equal(amountOver15);
        expect(next.pageItems.length).to.equal(3);
        expect(result.applied).to.include('modules.enterprise.advancedFilter');
      });

      it('getState hands out a copy of the model', async () => {
        const grid = await mount();
        grid.applyAdvancedFilter(amountOver15);
        const blob = blobOf(grid.getState());
        (blob.advancedFilter as AdvancedFilterModel).children.length = 0;
        expect(grid.advancedFilterModel?.children.length).to.equal(1);
      });

      it('a null advanced filter in the snapshot clears the applied one', async () => {
        const grid = await mount();
        grid.applyAdvancedFilter(amountOver15);
        await settle(grid);
        expect(blobOf(grid.getState()).advancedFilter).to.not.equal(null);
        grid.setState({ modules: { enterprise: { advancedFilter: null } } });
        await settle(grid);
        expect(grid.advancedFilterModel).to.equal(null);
        expect(grid.pageItems.length).to.equal(4);
        expect(blobOf(grid.getState()).advancedFilter).to.equal(null);
      });

      it('applying or changing it fires stateChanged with the model', async () => {
        const grid = await mount();
        const seen: GridState[] = [];
        grid.addEventListener('stateChanged', (event) => seen.push(event.detail.state));
        await settle(grid);
        grid.applyAdvancedFilter(amountOver15);
        await settle(grid);
        expect(seen.length).to.equal(1);
        expect(blobOf(seen[0]).advancedFilter).to.deep.equal(amountOver15);
        grid.clearAdvancedFilter();
        await settle(grid);
        expect(seen.length).to.equal(2);
        expect(blobOf(seen[1]).advancedFilter).to.equal(null);
      });
    });

    describe('pivot options and tree expansion (ent-pivot-6)', () => {
      it('round-trips pivotOptions and collapsed tree nodes', async () => {
        const grid = await mount();
        grid.pivotOn = 'product';
        grid.pivotRows = ['region', 'product'];
        grid.pivotValues = { amount: ['sum'] };
        grid.pivotOptions = {
          expandable: true,
          grandTotal: true,
          maxValueColumns: Number.POSITIVE_INFINITY,
        };
        await settle(grid);
        const emea = (grid.pageItems as Row[]).find((row) => getPivotMeta(row)?.label === 'EMEA')!;
        pivotOf(grid).toggleExpand(getPivotMeta(emea)!.key!);
        await settle(grid);
        const before = (grid.pageItems as Row[]).length;
        const saved = stored(grid.getState());

        const next = await mount();
        const result = next.setState(saved);
        await settle(next);
        expect(next.pivotOptions).to.deep.equal({
          expandable: true,
          grandTotal: true,
          maxValueColumns: Number.POSITIVE_INFINITY,
        });
        const rows = next.pageItems as Row[];
        expect(rows.length).to.equal(before);
        const restored = rows.find((row) => getPivotMeta(row)?.label === 'EMEA')!;
        expect(pivotOf(next).isExpanded(getPivotMeta(restored)!.key!, 0)).to.equal(false);
        expect(rows.some((row) => getPivotMeta(row)?.kind === 'grandTotal')).to.equal(true);
        expect(result.applied).to.include.members([
          'modules.enterprise.pivotOptions',
          'modules.enterprise.pivotExpand',
        ]);
      });
    });

    describe('defensive setState (ent-grid-core-7)', () => {
      const malformed: Array<[string, Record<string, unknown>]> = [
        ['groupBy', { groupBy: null }],
        ['groupBy', { groupBy: ['region', 1] }],
        ['pivotRows', { pivotRows: 'region' }],
        ['pivotOn', { pivotOn: 5 }],
        ['aggregations', { aggregations: ['sum'] }],
        ['pivotValues', { pivotValues: { amount: 'sum' } }],
        ['pivotOptions', { pivotOptions: 'tree' }],
        ['pivotExpand', { pivotExpand: { EMEA: 1 } }],
        ['ranges', { ranges: { top: 0 } }],
        ['formulas', { formulas: 'B1' }],
        ['advancedFilter', { advancedFilter: 'amount > 15' }],
        ['advancedFilter', { advancedFilter: { kind: 'group', join: 'xor', children: [] } }],
        ['advancedFilter', { advancedFilter: { kind: 'group', join: 'and', children: [{}] } }],
      ];

      for (const [field, blob] of malformed) {
        it(`skips a malformed ${field} (${JSON.stringify(blob[field])}) with a warning`, async () => {
          const grid = await mount();
          const state = {
            sort: [{ key: 'amount', direction: 'descending' }],
            modules: { enterprise: { groupBy: ['product'], ...blob } },
          } as unknown as Partial<GridState>;
          let result: ReturnType<typeof grid.setState> | undefined;
          expect(() => {
            result = grid.setState(state);
          }).to.not.throw();
          expect(
            result!.warnings.some((w) => w.includes(field)),
            result!.warnings.join('; ')
          ).to.equal(true);
          expect(result!.applied).to.not.include(`modules.enterprise.${field}`);
          expect(result!.applied).to.include('sort');
          // The rest of the blob still applies.
          if (field !== 'groupBy') expect(grid.groupBy).to.deep.equal(['product']);
        });

        it(`throws on a malformed ${field} (${JSON.stringify(blob[field])}) in strict mode before applying anything`, async () => {
          const grid = await mount();
          const state = {
            sort: [{ key: 'amount', direction: 'descending' }],
            modules: { enterprise: { groupBy: ['product'], ...blob } },
          } as unknown as Partial<GridState>;
          expect(() => grid.setState(state, { strict: true })).to.throw(field);
          expect(grid.groupBy).to.deep.equal([]);
          expect(grid.sortExpressions).to.deep.equal([]);
        });
      }

      it('skips a non-object enterprise blob with a warning', async () => {
        const grid = await mount();
        const result = grid.setState({ modules: { enterprise: 'grouped' } });
        expect(result.warnings.some((w) => w.includes('modules.enterprise'))).to.equal(true);
        expect(() => grid.setState({ modules: { enterprise: 7 } }, { strict: true })).to.throw(
          'modules.enterprise'
        );
      });

      it('reports applied enterprise fields', async () => {
        const grid = await mount();
        const result = grid.setState({
          modules: { enterprise: { groupBy: ['region'], aggregations: { amount: ['sum'] } } },
        });
        expect(result.applied).to.include.members([
          'modules',
          'modules.enterprise.groupBy',
          'modules.enterprise.aggregations',
        ]);
        expect(grid.groupBy).to.deep.equal(['region']);
      });

      it('reports unresolved formula rows the way core row slices do', async () => {
        const data = makeData();
        const grid = await mount(data);
        const result = grid.setState({
          modules: {
            enterprise: {
              formulas: [
                { row: { index: 0 }, column: 'total', src: '=D1*2' },
                { row: { index: 99 }, column: 'total', src: '=1' },
                { column: 'total', src: '=2' },
                null,
              ],
            },
          },
        });
        // Like a core row slice: bad entries are dropped, the field still applies.
        // Malformed entries are counted apart from rows that do not resolve.
        expect(result.warnings).to.include.members([
          'formulas: 2 of 4 entries malformed; skipped',
          'formulas: 1 of 2 row(s) could not be resolved',
        ]);
        expect(result.applied).to.include('modules.enterprise.formulas');
        expect(grid.getFormula(data[0], 'total')).to.equal('=D1*2');
        expect(() =>
          grid.setState(
            {
              modules: {
                enterprise: { formulas: [{ row: { index: 99 }, column: 'total', src: '=1' }] },
              },
            },
            { strict: true }
          )
        ).to.throw('could not be resolved');
        expect(grid.getFormula(data[0], 'total')).to.equal('=D1*2');
      });
    });
  });
});
