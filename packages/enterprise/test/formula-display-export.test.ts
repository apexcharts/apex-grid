import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ApexCellContext, ColumnConfiguration } from 'apex-grid';
import { render } from 'lit';
import {
  FORMULA_MODULE_ID,
  type FormulaController,
  formulaModule,
} from '../src/features/formula/index.js';
import { ApexGridEnterprise, enterpriseModules } from '../src/index.js';

interface Row {
  qty: number; // A
  price: number; // B
  total: number; // C
}

function controllerOf(grid: ApexGridEnterprise<Row>): FormulaController<Row> {
  return (
    grid as unknown as { stateController: { module(id: string): FormulaController<Row> } }
  ).stateController.module(FORMULA_MODULE_ID);
}

/** A minimal cell context for invoking an injected display `cellTemplate`. */
const ctxFor = (record: Row, value: unknown) =>
  ({ row: { data: record }, column: { key: 'total' }, value }) as unknown as ApexCellContext<Row>;

describe('formula show-formulas + export (Tier 2, P4/P5)', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules, formulaModule);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  async function mountGrid(
    data: Row[],
    columns: ColumnConfiguration<Row>[] = [
      { key: 'qty', type: 'number' },
      { key: 'price', type: 'number' },
      { key: 'total', type: 'number', allowFormula: true },
    ]
  ) {
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`
    );
    await grid.updateComplete;
    await nextFrame();
    return grid;
  }

  // --- P4: show-formulas display toggle ------------------------------------

  it('showFormulas reveals the formula source, and toggling off restores the cell', async () => {
    const data: Row[] = [
      { qty: 2, price: 5, total: 0 },
      { qty: 3, price: 7, total: 0 },
    ];
    const grid = await mountGrid(data);
    controllerOf(grid).setFormula(data[0], 'total', '=A1*B1');
    await grid.updateComplete;

    grid.showFormulas = true;
    await grid.updateComplete;
    const column = grid.columns.find((c) => c.key === 'total');
    expect(column?.cellTemplate, 'a display template is injected').to.be.a('function');
    // A formula cell shows its source (left-aligned markup): render it and read the text.
    const host = document.createElement('div');
    render(column?.cellTemplate?.(ctxFor(data[0], data[0].total)), host);
    expect(host.textContent).to.equal('=A1*B1');
    // A cell without a formula shows its value unchanged.
    expect(column?.cellTemplate?.(ctxFor(data[1], data[1].total))).to.equal(data[1].total);

    grid.showFormulas = false;
    await grid.updateComplete;
    expect(
      grid.columns.find((c) => c.key === 'total')?.cellTemplate,
      'the injected template is removed'
    ).to.be.undefined;
  });

  it('showFormulas never overrides a user-provided cellTemplate', async () => {
    const custom = () => html`<i>custom</i>`;
    const grid = await mountGrid(
      [{ qty: 2, price: 5, total: 0 }],
      [
        { key: 'qty', type: 'number' },
        { key: 'price', type: 'number' },
        { key: 'total', type: 'number', allowFormula: true, cellTemplate: custom },
      ]
    );
    grid.showFormulas = true;
    await grid.updateComplete;
    expect(grid.columns.find((c) => c.key === 'total')?.cellTemplate).to.equal(custom);
  });

  // --- P5: export formulas -------------------------------------------------

  it('exportToCSV emits the formula source with { formulas: true }, the value without', async () => {
    const data: Row[] = [{ qty: 2, price: 5, total: 0 }];
    const grid = await mountGrid(data);
    controllerOf(grid).setFormula(data[0], 'total', '=A1*B1'); // total computes to 10
    await grid.updateComplete;

    const withFormulas = grid.exportToCSV({ filename: '', formulas: true });
    expect(withFormulas).to.contain('=A1*B1');

    const plain = grid.exportToCSV({ filename: '' });
    expect(plain).to.contain('10');
    expect(plain).to.not.contain('=A1*B1');
  });

  it('exportToXLSX accepts the formulas option without throwing', async () => {
    const data: Row[] = [{ qty: 2, price: 5, total: 0 }];
    const grid = await mountGrid(data);
    controllerOf(grid).setFormula(data[0], 'total', '=A1*B1');
    await grid.updateComplete;
    const bytes = grid.exportToXLSX({ filename: '', formulas: true });
    expect(bytes).to.be.instanceOf(Uint8Array);
    expect(bytes.length).to.be.greaterThan(0);
  });
});
