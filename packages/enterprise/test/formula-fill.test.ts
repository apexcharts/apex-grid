import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
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

const columns: ColumnConfiguration<Row>[] = [
  { key: 'qty', type: 'number' }, // A
  { key: 'price', type: 'number' }, // B
  { key: 'total', type: 'number' }, // C
];

/** A sized parent so the virtualizer lays out body rows. */
function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '600px';
  return node;
}

function controllerOf(grid: ApexGridEnterprise<Row>): FormulaController<Row> {
  return (
    grid as unknown as {
      stateController: { module(id: string): FormulaController<Row> };
    }
  ).stateController.module(FORMULA_MODULE_ID);
}

/** Temporarily replace `navigator.clipboard` so copy/paste are deterministic. */
async function withClipboard(run: (buffer: { text: string }) => Promise<void>): Promise<void> {
  const buffer = { text: '' };
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        buffer.text = value;
      },
      readText: async () => buffer.text,
    },
  });
  try {
    await run(buffer);
  } finally {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'clipboard');
  }
}

describe('formula fill + paste (Tier 2, P2)', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules, formulaModule);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  async function mount(rows: Row[]) {
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise .data=${rows} .columns=${columns}></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    await grid.updateComplete;
    const scroll = (grid as unknown as { scrollContainer?: { layoutComplete?: Promise<unknown> } })
      .scrollContainer;
    await scroll?.layoutComplete;
    await nextFrame();
    return grid;
  }

  // --- controller.fillFormula ----------------------------------------------

  it('fillFormula shifts relative references by the row delta', async () => {
    const data: Row[] = [
      { qty: 2, price: 5, total: 0 },
      { qty: 3, price: 7, total: 0 },
    ];
    const grid = await mount(data);
    const controller = controllerOf(grid);
    controller.setFormula(data[0], 'total', '=A1*B1');
    expect(data[0].total).to.equal(10);

    expect(controller.fillFormula(data[0], 'total', data[1], 'total')).to.be.true;
    expect(controller.getFormula(data[1], 'total')).to.equal('=A2*B2');
    expect(data[1].total).to.equal(21); // 3 * 7
  });

  it('fillFormula preserves absolute ($) references', async () => {
    const data: Row[] = [
      { qty: 2, price: 5, total: 0 },
      { qty: 3, price: 7, total: 0 },
    ];
    const grid = await mount(data);
    const controller = controllerOf(grid);
    controller.setFormula(data[0], 'total', '=A1*$B$1'); // qty(row) * price of the first row
    expect(data[0].total).to.equal(10);

    controller.fillFormula(data[0], 'total', data[1], 'total');
    expect(controller.getFormula(data[1], 'total')).to.equal('=A2*$B$1');
    expect(data[1].total).to.equal(15); // 3 * 5 ($B$1 stays on the first row)
  });

  it('fillFormula returns false (writing nothing) when the source has no formula', async () => {
    const data: Row[] = [
      { qty: 2, price: 5, total: 99 },
      { qty: 3, price: 7, total: 0 },
    ];
    const grid = await mount(data);
    const controller = controllerOf(grid);
    expect(controller.fillFormula(data[0], 'total', data[1], 'total')).to.be.false;
    expect(controller.getFormula(data[1], 'total')).to.be.undefined;
    expect(data[1].total).to.equal(0);
  });

  // --- drag fill (the range-selection handle) ------------------------------

  it('drag-fill rewrites a formula down a column (relative refs follow the row)', async () => {
    const data: Row[] = [
      { qty: 2, price: 5, total: 0 },
      { qty: 3, price: 7, total: 0 },
      { qty: 4, price: 9, total: 0 },
    ];
    const grid = await mount(data);
    const controller = controllerOf(grid);
    controller.setFormula(data[0], 'total', '=A1*B1');

    grid.selectRange({ row: 0, column: 'total' });
    grid.fillTo({ row: 2, column: 'total' });

    expect(controller.getFormula(data[1], 'total')).to.equal('=A2*B2');
    expect(controller.getFormula(data[2], 'total')).to.equal('=A3*B3');
    expect(data[1].total).to.equal(21); // 3 * 7
    expect(data[2].total).to.equal(36); // 4 * 9
  });

  // --- intra-grid paste ----------------------------------------------------

  it('re-offsets a formula on an intra-grid paste of the same clipboard text', async () => {
    const data: Row[] = [
      { qty: 2, price: 5, total: 0 },
      { qty: 3, price: 7, total: 0 },
      { qty: 4, price: 9, total: 0 },
    ];
    const grid = await mount(data);
    const controller = controllerOf(grid);
    controller.setFormula(data[0], 'total', '=A1*B1');

    await withClipboard(async (buffer) => {
      grid.selectRange({ row: 0, column: 'total' });
      await grid.copySelection();
      grid.selectRange({ row: 2, column: 'total' });
      grid.pasteText(buffer.text);
    });

    expect(controller.getFormula(data[2], 'total')).to.equal('=A3*B3');
    expect(data[2].total).to.equal(36); // 4 * 9
  });

  it('pastes the literal value when the text is not our own copy', async () => {
    const data: Row[] = [
      { qty: 2, price: 5, total: 0 },
      { qty: 3, price: 7, total: 0 },
    ];
    const grid = await mount(data);
    const controller = controllerOf(grid);
    controller.setFormula(data[0], 'total', '=A1*B1');

    grid.selectRange({ row: 1, column: 'total' });
    grid.pasteText('42'); // external text, never copied from this grid

    expect(controller.getFormula(data[1], 'total')).to.be.undefined;
    expect(data[1].total).to.equal(42);
  });
});
