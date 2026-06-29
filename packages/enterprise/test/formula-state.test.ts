import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration, GridState } from 'apex-grid';
import { ApexGridEnterprise, enterpriseModules } from '../src/index.js';

interface Row {
  id: number;
  qty: number; // B
  price: number; // C
  total: number; // D
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'id' },
  { key: 'qty', editable: true },
  { key: 'price', editable: true },
  { key: 'total', editable: true, allowFormula: true },
];

const makeData = (): Row[] => [
  { id: 1, qty: 2, price: 3, total: 0 },
  { id: 2, qty: 4, price: 5, total: 0 },
];

type FormulaSlice = {
  enterprise?: { formulas?: Array<{ row: Record<string, unknown>; column: string; src: string }> };
};
const formulasOf = (state: GridState) => (state.modules as FormulaSlice).enterprise?.formulas;

describe('formula state + public API (F5)', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  async function mount(data: Row[], rowId?: (row: Row) => number) {
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise
        .data=${data}
        .columns=${columns}
        .rowId=${rowId}
      ></apex-grid-enterprise>`
    );
    await grid.updateComplete;
    await nextFrame();
    return grid;
  }

  it('setFormula computes; getFormula and clearFormula act on the cell', async () => {
    const data = makeData();
    const grid = await mount(data);
    grid.setFormula(data[0], 'total', '=B1*C1');
    expect(data[0].total).to.equal(6);
    expect(grid.getFormula(data[0], 'total')).to.equal('=B1*C1');
    grid.clearFormula(data[0], 'total');
    expect(grid.getFormula(data[0], 'total')).to.be.undefined;
  });

  it('recalculateFormulas recomputes after an in-place data mutation', async () => {
    const data = makeData();
    const grid = await mount(data);
    grid.setFormula(data[0], 'total', '=B1*C1'); // 6
    data[0].qty = 10;
    grid.recalculateFormulas();
    expect(data[0].total).to.equal(30);
  });

  it('registerFormulaFunction adds a custom function callable from formulas', async () => {
    const data = makeData();
    const grid = await mount(data);
    grid.registerFormulaFunction('TAX', (args) =>
      typeof args[0] === 'number' ? args[0] * 0.1 : 0
    );
    grid.setFormula(data[0], 'total', '=TAX(B1)'); // qty 2 * 0.1
    expect(data[0].total).to.be.closeTo(0.2, 1e-9);
  });

  it('serializes formulas under modules.enterprise.formulas', async () => {
    const data = makeData();
    const grid = await mount(data);
    grid.setFormula(data[0], 'total', '=B1*C1');
    const formulas = formulasOf(grid.getState());
    expect(formulas).to.have.lengthOf(1);
    expect(formulas?.[0]).to.include({ column: 'total', src: '=B1*C1' });
    expect(formulas?.[0].row).to.deep.equal({ index: 0 });
  });

  it('round-trips formulas through getState/setState and recomputes on restore', async () => {
    const dataA = makeData();
    const gridA = await mount(dataA);
    gridA.setFormula(dataA[0], 'total', '=B1*C1'); // 6
    gridA.setFormula(dataA[1], 'total', '=B2*C2'); // 20
    const state = gridA.getState();

    const dataB = makeData();
    const gridB = await mount(dataB);
    gridB.setState(state);
    await gridB.updateComplete;
    await nextFrame();

    expect(dataB[0].total).to.equal(6);
    expect(dataB[1].total).to.equal(20);
    expect(gridB.getFormula(dataB[0], 'total')).to.equal('=B1*C1');
  });

  it('uses durable rowId references when rowId is configured', async () => {
    const data = makeData();
    const grid = await mount(data, (row) => row.id);
    grid.setFormula(data[0], 'total', '=B1*C1');
    expect(formulasOf(grid.getState())?.[0].row).to.deep.equal({ id: 1 });
  });

  it('marks allowFormula columns in getSchema', async () => {
    const grid = await mount(makeData());
    const schema = grid.getSchema();
    expect(schema.columns.find((column) => column.key === 'total')?.allowFormula).to.equal(true);
    expect(schema.columns.find((column) => column.key === 'qty')?.allowFormula).to.be.undefined;
  });
});
