import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  type AggregationConfig,
  ApexGridEnterprise,
  enterpriseModules,
  getPivotMeta,
  type PivotOptions,
} from '../src/index.js';

interface Row {
  region: string;
  product: string;
  quarter?: string;
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
  pivotOn: string | string[] = 'product',
  pivotRows: string[] = ['region'],
  pivotValues: AggregationConfig = { amount: ['sum'] },
  pivotOptions: PivotOptions = {},
  data: Row[] = makeData()
) {
  const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
    .data=${data}
    .columns=${columns}
    .pivotOn=${pivotOn}
    .pivotRows=${pivotRows}
    .pivotValues=${pivotValues}
    .pivotOptions=${pivotOptions}
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

  it('single measure over a single field stays flat (no column groups)', async () => {
    const grid = await mountPivot();
    expect(grid.getPivotColumnGroups()).to.eql([]);
    expect(grid.columns.every((c) => !c.group)).to.be.true;
  });

  it('groups columns under a spanning header for multiple measures', async () => {
    const grid = await mountPivot('product', ['region'], { amount: ['sum', 'count'] });
    const groups = grid.getPivotColumnGroups();
    expect(groups.map((g) => g.id)).to.eql(['pv::A', 'pv::B']);
    expect(groups.map((g) => g.headerText)).to.eql(['A', 'B']);
    // Each value's two measure columns join its group, contiguously.
    const valueCols = grid.columns.filter((c) => c.group);
    expect(valueCols.map((c) => c.group)).to.eql(['pv::A', 'pv::A', 'pv::B', 'pv::B']);
    expect(valueCols[0].headerText).to.equal('amount (sum)');
  });

  it('emits a grand-total row over all leaves', async () => {
    const grid = await mountPivot('product', ['region'], { amount: ['sum'] }, { grandTotal: true });
    const rows = rowsOf(grid);
    const grand = rows.find((r) => getPivotMeta(r)?.kind === 'grandTotal')!;
    expect(grand, 'grand-total row present').to.exist;
    expect(grand[A]).to.equal(80); // 10 + 30 + 40 (A across all regions)
    expect(grand[B]).to.equal(20); // 20 (B)
    // It sits at the bottom by default.
    expect(getPivotMeta(rows[rows.length - 1])?.kind).to.equal('grandTotal');
  });

  it('emits subtotal rows per first row-dimension value', async () => {
    const data: Row[] = [
      { region: 'EMEA', product: 'A', amount: 10 },
      { region: 'EMEA', product: 'B', amount: 20 },
      { region: 'AMER', product: 'A', amount: 30 },
    ];
    const grid = await mountPivot(
      'product',
      ['region', 'product'],
      { amount: ['sum'] },
      { subtotals: true },
      data
    );
    const rows = rowsOf(grid);
    const subtotals = rows.filter((r) => getPivotMeta(r)?.kind === 'subtotal');
    expect(subtotals.length, 'one subtotal per region').to.equal(2);
    const emeaSub = subtotals.find((r) => r.region === 'EMEA')!;
    expect(emeaSub[A]).to.equal(10);
    expect(emeaSub[B]).to.equal(20);
  });

  it('multi-field pivotOn groups by the outer field', async () => {
    const data: Row[] = [
      { region: 'EMEA', product: 'A', quarter: 'Q1', amount: 10 },
      { region: 'EMEA', product: 'A', quarter: 'Q2', amount: 5 },
      { region: 'AMER', product: 'A', quarter: 'Q1', amount: 30 },
    ];
    const grid = await mountPivot('product', ['region'], { amount: ['sum'] }, {}, data);
    // Switch to a 2-field column dimension: product then quarter.
    grid.pivotOn = ['product', 'quarter'];
    await grid.updateComplete;
    await nextFrame();
    const groups = grid.getPivotColumnGroups();
    // Outer field (product) heads one spanning group: A.
    expect(groups.map((g) => g.headerText)).to.eql(['A']);
    const emea = rowsOf(grid).find((r) => r.region === 'EMEA')!;
    expect(emea['pivot::A|Q1::amount::sum']).to.equal(10);
    expect(emea['pivot::A|Q2::amount::sum']).to.equal(5);
  });

  it('restores column groups when pivoting is turned off', async () => {
    const grid = await mountPivot('product', ['region'], { amount: ['sum', 'count'] });
    expect(grid.getPivotColumnGroups().length).to.equal(2);
    grid.pivotOn = '';
    await grid.updateComplete;
    await nextFrame();
    expect(grid.isPivoting).to.be.false;
    expect(grid.columnGroups ?? []).to.eql([]);
  });

  describe('expandable (tree) mode', () => {
    const treeData: Row[] = [
      { region: 'EMEA', product: 'A', amount: 10 },
      { region: 'EMEA', product: 'B', amount: 20 },
      { region: 'AMER', product: 'A', amount: 30 },
      { region: 'AMER', product: 'B', amount: 40 },
    ];

    it('emits one auto group column instead of per-field leading columns', async () => {
      const grid = await mountPivot(
        'product',
        ['region', 'product'],
        { amount: ['sum'] },
        { expandable: true },
        treeData
      );
      const keys = grid.columns.map((c) => c.key);
      expect(keys[0]).to.equal('__pivot_group__');
      expect(keys).to.not.include('region');
      expect(keys).to.not.include('product');
    });

    it('nests parent rows over their children, parents carry the subtree aggregate', async () => {
      const grid = await mountPivot(
        'product',
        ['region', 'product'],
        { amount: ['sum'] },
        { expandable: true, defaultExpanded: true },
        treeData
      );
      const rows = rowsOf(grid);
      // 2 region parents + 4 leaf combos, all expanded.
      expect(rows.length).to.equal(6);
      const emea = rows[0];
      expect(getPivotMeta(emea)?.kind).to.equal('subtotal');
      expect(getPivotMeta(emea)?.expandable).to.be.true;
      expect(getPivotMeta(emea)?.depth).to.equal(0);
      expect(emea[A]).to.equal(10); // EMEA·A leaves summed at the region parent
      expect(emea[B]).to.equal(20);
      // Its first child is a leaf.
      expect(getPivotMeta(rows[1])?.kind).to.equal('data');
      expect(getPivotMeta(rows[1])?.depth).to.equal(1);
    });

    it('collapsing a node hides its children', async () => {
      const grid = await mountPivot(
        'product',
        ['region', 'product'],
        { amount: ['sum'] },
        { expandable: true, defaultExpanded: false },
        treeData
      );
      const rows = rowsOf(grid);
      // All collapsed ⇒ only the 2 top-level region parents show.
      expect(rows.length).to.equal(2);
      expect(rows.map((r) => getPivotMeta(r)?.label)).to.eql(['EMEA', 'AMER']);
    });

    it('sets aria-level and aria-expanded on tree rows', async () => {
      const grid = await mountPivot(
        'product',
        ['region', 'product'],
        { amount: ['sum'] },
        { expandable: true, defaultExpanded: true },
        treeData
      );
      // The virtualizer paints rows over a couple of frames; wait for them.
      let rowEls: Element[] = [];
      for (let i = 0; i < 10 && rowEls.length === 0; i++) {
        rowEls = [...grid.renderRoot.querySelectorAll('apex-grid-row')].filter(
          (r) => (r as { data?: Row }).data
        );
        if (rowEls.length === 0) await nextFrame();
      }
      const parent = rowEls.find(
        (r) => getPivotMeta((r as { data?: Row }).data as Row)?.expandable
      )!;
      const leaf = rowEls.find(
        (r) => getPivotMeta((r as { data?: Row }).data as Row)?.kind === 'data'
      )!;
      // A region parent is level 1 and expandable ⇒ aria-expanded present.
      expect(parent.getAttribute('aria-level')).to.equal('1');
      expect(parent.getAttribute('aria-expanded')).to.equal('true');
      // A leaf is level 2 with no aria-expanded (not expandable).
      expect(leaf.getAttribute('aria-level')).to.equal('2');
      expect(leaf.hasAttribute('aria-expanded')).to.be.false;
    });

    it('grand total composes with tree mode', async () => {
      const grid = await mountPivot(
        'product',
        ['region', 'product'],
        { amount: ['sum'] },
        { expandable: true, defaultExpanded: false, grandTotal: 'bottom' },
        treeData
      );
      const rows = rowsOf(grid);
      const grand = rows[rows.length - 1];
      expect(getPivotMeta(grand)?.kind).to.equal('grandTotal');
      expect(grand[A]).to.equal(40); // 10 + 30
      expect(grand[B]).to.equal(60); // 20 + 40
    });
  });
});
