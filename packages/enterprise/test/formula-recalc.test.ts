import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  type CellAddress,
  type CellValue,
  createFunctionRegistry,
  FORMULA_MODULE_ID,
  type FormulaController,
  type FormulaEngineHost,
  type FormulaError,
  FormulaStore,
  formulaModule,
  isFormulaError,
  parseA1,
} from '../src/features/formula/index.js';
import { ApexGridEnterprise, enterpriseModules } from '../src/index.js';

/** An in-memory grid implementing the engine host, for testing the pure store. */
function makeHost(rows: number, cols: number) {
  const grid: CellValue[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => null as CellValue)
  );
  const host: FormulaEngineHost = {
    readValue: ({ row, col }) => grid[row]?.[col] ?? null,
    writeValue: ({ row, col }, value) => {
      if (grid[row]) {
        grid[row][col] = value;
      }
    },
    isValidAddress: ({ row, col }) => row >= 0 && row < rows && col >= 0 && col < cols,
    functions: createFunctionRegistry(),
  };
  return { grid, host };
}

const addr = (a1: string): CellAddress => parseA1(a1) as CellAddress;
const valueAt = (grid: CellValue[][], a1: string): CellValue => {
  const { row, col } = addr(a1);
  return grid[row][col];
};
function errCode(value: CellValue): string {
  expect(isFormulaError(value), `expected an error, got ${JSON.stringify(value)}`).to.be.true;
  return (value as FormulaError).code;
}

describe('formula recalc store (F3)', () => {
  it('computes a formula immediately on set', () => {
    const { grid, host } = makeHost(3, 3);
    grid[0][0] = 5; // A1
    const store = new FormulaStore(host);
    store.set(addr('B1'), '=A1*2');
    expect(valueAt(grid, 'B1')).to.equal(10);
  });

  it('recomputes a dependent when a referenced cell changes', () => {
    const { grid, host } = makeHost(3, 3);
    grid[0][0] = 5;
    const store = new FormulaStore(host);
    store.set(addr('B1'), '=A1*2');
    grid[0][0] = 7; // external edit to A1
    const changes = store.recalc([addr('A1')], false);
    expect(valueAt(grid, 'B1')).to.equal(14);
    expect(changes.map((c) => c.value)).to.eql([14]);
  });

  it('cascades transitively in dependency order', () => {
    const { grid, host } = makeHost(3, 3);
    grid[0][0] = 1;
    const store = new FormulaStore(host);
    store.set(addr('B1'), '=A1*2'); // 2
    store.set(addr('C1'), '=B1+1'); // 3
    expect(valueAt(grid, 'C1')).to.equal(3);
    grid[0][0] = 10;
    store.recalc([addr('A1')], false);
    expect(valueAt(grid, 'B1')).to.equal(20);
    expect(valueAt(grid, 'C1')).to.equal(21);
  });

  it('recomputes through a range dependency', () => {
    const { grid, host } = makeHost(4, 3);
    grid[0][0] = 1;
    grid[1][0] = 2;
    grid[2][0] = 3; // A1..A3
    const store = new FormulaStore(host);
    store.set(addr('C1'), '=SUM(A1:A3)');
    expect(valueAt(grid, 'C1')).to.equal(6);
    grid[1][0] = 20; // A2
    store.recalc([addr('A2')], false);
    expect(valueAt(grid, 'C1')).to.equal(24); // 1 + 20 + 3
  });

  it('marks a direct cycle as #CYCLE!', () => {
    const { grid, host } = makeHost(2, 2);
    const store = new FormulaStore(host);
    store.set(addr('A1'), '=B1');
    store.set(addr('B1'), '=A1'); // closes the cycle
    expect(errCode(valueAt(grid, 'A1'))).to.equal('#CYCLE!');
    expect(errCode(valueAt(grid, 'B1'))).to.equal('#CYCLE!');
  });

  it('marks a self-reference as #CYCLE!', () => {
    const { grid, host } = makeHost(1, 1);
    const store = new FormulaStore(host);
    store.set(addr('A1'), '=A1+1');
    expect(errCode(valueAt(grid, 'A1'))).to.equal('#CYCLE!');
  });

  it('produces #REF! for an out-of-range reference', () => {
    const { grid, host } = makeHost(2, 2);
    const store = new FormulaStore(host);
    store.set(addr('A1'), '=Z9'); // outside a 2x2 grid
    expect(errCode(valueAt(grid, 'A1'))).to.equal('#REF!');
  });

  it('clears a formula and recomputes its dependents from the literal', () => {
    const { grid, host } = makeHost(2, 3);
    grid[0][0] = 5;
    const store = new FormulaStore(host);
    store.set(addr('B1'), '=A1*2'); // 10
    store.set(addr('C1'), '=B1+1'); // 11
    store.clear(addr('B1')); // B1 keeps its last computed value as a literal
    expect(store.has(addr('B1'))).to.be.false;
    expect(store.has(addr('C1'))).to.be.true;
    expect(valueAt(grid, 'B1')).to.equal(10);
    expect(valueAt(grid, 'C1')).to.equal(11);

    grid[0][0] = 100; // A1 no longer drives B1 (its formula is gone)
    store.recalc([addr('A1')], false);
    expect(valueAt(grid, 'B1')).to.equal(10);
  });

  it('recalcAll recomputes every formula against current inputs', () => {
    const { grid, host } = makeHost(3, 3);
    grid[0][0] = 2;
    const store = new FormulaStore(host);
    store.set(addr('B1'), '=A1*2'); // 4
    store.set(addr('C1'), '=B1+A1'); // 6
    grid[0][0] = 5; // mutate input without recalc
    store.recalcAll();
    expect(valueAt(grid, 'B1')).to.equal(10);
    expect(valueAt(grid, 'C1')).to.equal(15);
  });

  it('does not touch cells unrelated to the change', () => {
    const { grid, host } = makeHost(3, 3);
    grid[0][0] = 1;
    grid[0][1] = 100;
    const store = new FormulaStore(host);
    store.set(addr('C1'), '=A1+1'); // depends only on A1
    const changes = store.recalc([addr('B1')], false); // nothing depends on B1
    expect(changes).to.be.empty;
  });

  it('lists stored formulas', () => {
    const { host } = makeHost(2, 2);
    const store = new FormulaStore(host);
    store.set(addr('A1'), '=1+1');
    store.set(addr('B2'), '=A1*3');
    expect(store.size).to.equal(2);
    expect(
      store
        .list()
        .map((entry) => entry.src)
        .sort()
    ).to.eql(['=1+1', '=A1*3']);
  });
});

interface GridRow {
  qty: number;
  price: number;
  total: number;
}

function controllerOf(grid: ApexGridEnterprise<GridRow>): FormulaController<GridRow> | undefined {
  return (
    grid as unknown as {
      stateController: { module(id: string): FormulaController<GridRow> | undefined };
    }
  ).stateController.module(FORMULA_MODULE_ID);
}

describe('formula recalc controller (F3, grid-bound)', () => {
  const columns: ColumnConfiguration<GridRow>[] = [
    { key: 'qty' }, // A
    { key: 'price' }, // B
    { key: 'total' }, // C
  ];

  before(() => {
    ApexGridEnterprise.use(...enterpriseModules, formulaModule);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  async function mount(data: GridRow[]) {
    const grid = await fixture<ApexGridEnterprise<GridRow>>(
      html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`
    );
    await grid.updateComplete;
    await nextFrame();
    return grid;
  }

  it('registers the formula controller', async () => {
    const grid = await mount([{ qty: 1, price: 1, total: 0 }]);
    expect(controllerOf(grid)).to.exist;
  });

  it('writes a computed value into row[key], reading A1 refs over the data', async () => {
    const data: GridRow[] = [{ qty: 3, price: 4, total: 0 }];
    const grid = await mount(data);
    const controller = controllerOf(grid)!;

    controller.setFormula(data[0], 'total', '=A1*B1'); // qty * price
    expect(data[0].total).to.equal(12);
    expect(controller.getFormula(data[0], 'total')).to.equal('=A1*B1');
  });

  it('recomputes when a referenced cell changes (cellValueChanged)', async () => {
    const data: GridRow[] = [{ qty: 3, price: 4, total: 0 }];
    const grid = await mount(data);
    const controller = controllerOf(grid)!;
    controller.setFormula(data[0], 'total', '=A1*B1');
    expect(data[0].total).to.equal(12);

    data[0].qty = 10; // a normal edit to A1
    grid.dispatchEvent(
      new CustomEvent('cellValueChanged', {
        detail: { key: 'qty', rowIndex: 0, data: data[0], value: 10 },
      })
    );
    expect(data[0].total).to.equal(40);
  });

  it('clears a formula, leaving the last computed value as a literal', async () => {
    const data: GridRow[] = [{ qty: 2, price: 5, total: 0 }];
    const grid = await mount(data);
    const controller = controllerOf(grid)!;
    controller.setFormula(data[0], 'total', '=A1*B1');
    expect(data[0].total).to.equal(10);

    controller.clearFormula(data[0], 'total');
    expect(controller.getFormula(data[0], 'total')).to.be.undefined;
    expect(data[0].total).to.equal(10);
  });

  it('supports a custom registered function', async () => {
    const data: GridRow[] = [{ qty: 9, price: 0, total: 0 }];
    const grid = await mount(data);
    const controller = controllerOf(grid)!;
    controller.registerFormulaFunction('TRIPLE', (args) =>
      typeof args[0] === 'number' ? args[0] * 3 : 0
    );
    controller.setFormula(data[0], 'total', '=TRIPLE(A1)');
    expect(data[0].total).to.equal(27);
  });
});
