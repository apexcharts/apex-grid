import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  FORMULA_MODULE_ID,
  FormulaCellEditor,
  type FormulaController,
  type FormulaEditorContext,
  type FormulaEditorController,
} from '../src/features/formula/index.js';
import { ApexGridEnterprise, enterpriseModules } from '../src/index.js';

function makeController() {
  const formulas = new Map<string, string>();
  const calls = { set: [] as Array<[string, string]>, clear: [] as string[] };
  const controller: FormulaEditorController = {
    getFormula: (_row, key) => formulas.get(key),
    setFormula: (_row, key, src) => {
      calls.set.push([key, src]);
      formulas.set(key, src);
    },
    clearFormula: (_row, key) => {
      calls.clear.push(key);
      formulas.delete(key);
    },
    functionNames: () => [
      'ABS',
      'AND',
      'AVERAGE',
      'AVG',
      'CONCAT',
      'COUNT',
      'IF',
      'MAX',
      'MIN',
      'SUM',
    ],
  };
  return { controller, formulas, calls };
}

function makeCtx(value: unknown, key = 'total') {
  const commits: unknown[] = [];
  const state = { canceled: false };
  const ctx: FormulaEditorContext = {
    value,
    column: { key },
    row: { data: { [key]: value } },
    commit: async (next) => {
      commits.push(next);
      return true;
    },
    cancel: () => {
      state.canceled = true;
    },
  };
  return { ctx, commits, state };
}

async function mountEditor(ctx: FormulaEditorContext, controller: FormulaEditorController) {
  const el = await fixture<FormulaCellEditor>(
    html`<apex-grid-formula-editor
      .ctx=${ctx}
      .controller=${controller}
    ></apex-grid-formula-editor>`
  );
  await el.updateComplete;
  return el;
}

const inputOf = (el: FormulaCellEditor) => el.renderRoot.querySelector('input') as HTMLInputElement;

async function type(el: FormulaCellEditor, text: string) {
  const input = inputOf(el);
  input.value = text;
  input.dispatchEvent(new Event('input'));
  await el.updateComplete;
}

const pressEnter = (el: FormulaCellEditor) =>
  inputOf(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

describe('formula cell editor (F4)', () => {
  before(() => FormulaCellEditor.register());
  afterEach(() => fixtureCleanup());

  it('opens showing an existing formula', async () => {
    const { controller, formulas } = makeController();
    formulas.set('total', '=A1*B1');
    const { ctx } = makeCtx(12);
    const el = await mountEditor(ctx, controller);
    expect(inputOf(el).value).to.equal('=A1*B1');
  });

  it('opens showing the literal value when there is no formula', async () => {
    const { controller } = makeController();
    const { ctx } = makeCtx(42);
    const el = await mountEditor(ctx, controller);
    expect(inputOf(el).value).to.equal('42');
  });

  it('commits a formula through the controller and exits via cancel', async () => {
    const { controller, calls } = makeController();
    const { ctx, commits, state } = makeCtx(0);
    const el = await mountEditor(ctx, controller);
    await type(el, '=A1*B1');
    pressEnter(el);
    await el.updateComplete;
    expect(calls.set).to.eql([['total', '=A1*B1']]);
    expect(state.canceled, 'exits via ctx.cancel').to.be.true;
    expect(commits, 'no double write via ctx.commit').to.be.empty;
  });

  it('clears the formula and commits a literal through ctx.commit', async () => {
    const { controller, calls, formulas } = makeController();
    formulas.set('total', '=A1');
    const { ctx, commits } = makeCtx(5);
    const el = await mountEditor(ctx, controller);
    await type(el, '99');
    pressEnter(el);
    await el.updateComplete;
    expect(calls.clear).to.eql(['total']);
    expect(commits).to.eql([99]);
  });

  it('surfaces a parse error and does not commit', async () => {
    const { controller, calls } = makeController();
    const { ctx, state } = makeCtx(0);
    const el = await mountEditor(ctx, controller);
    await type(el, '=1+');
    pressEnter(el);
    await el.updateComplete;
    expect(el.renderRoot.querySelector('[part~="formula-error"]'), 'shows an error').to.exist;
    expect(calls.set).to.be.empty;
    expect(state.canceled).to.be.false;
  });

  it('highlights cell references in the preview', async () => {
    const { controller } = makeController();
    const { ctx } = makeCtx(0);
    const el = await mountEditor(ctx, controller);
    await type(el, '=A1+B2');
    const refs = [...el.renderRoot.querySelectorAll('[part~="formula-ref"]')];
    expect(refs.map((node) => node.textContent)).to.eql(['A1', 'B2']);
  });

  // --- autocomplete (Tier 2, P3) -------------------------------------------

  const suggestionTexts = (el: FormulaCellEditor) =>
    [...el.renderRoot.querySelectorAll('[part~="suggestion"]')].map((node) => node.textContent);
  const press = (el: FormulaCellEditor, key: string) =>
    inputOf(el).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  it('suggests functions for a partial name and accepts with Enter', async () => {
    const { controller, calls } = makeController();
    const { ctx, state } = makeCtx(0);
    const el = await mountEditor(ctx, controller);
    await type(el, '=SU');
    expect(suggestionTexts(el)).to.eql(['SUM']);

    press(el, 'Enter'); // accepts the active suggestion, does not commit
    await el.updateComplete;
    expect(inputOf(el).value).to.equal('=SUM()');
    expect(calls.set, 'accepting a suggestion does not commit').to.be.empty;
    expect(state.canceled).to.be.false;
  });

  it('filters and navigates suggestions with the arrow keys', async () => {
    const { controller } = makeController();
    const { ctx } = makeCtx(0);
    const el = await mountEditor(ctx, controller);
    await type(el, '=A'); // ABS, AND, AVERAGE, AVG
    expect(suggestionTexts(el)).to.eql(['ABS', 'AND', 'AVERAGE', 'AVG']);

    press(el, 'ArrowDown'); // move to AND
    await el.updateComplete;
    press(el, 'Enter');
    await el.updateComplete;
    expect(inputOf(el).value).to.equal('=AND()');
  });

  it('hides suggestions after a complete cell reference', async () => {
    const { controller } = makeController();
    const { ctx } = makeCtx(0);
    const el = await mountEditor(ctx, controller);
    await type(el, '=A1');
    expect(suggestionTexts(el)).to.be.empty;
  });

  it('does not suggest while editing a literal (no leading =)', async () => {
    const { controller } = makeController();
    const { ctx } = makeCtx(0);
    const el = await mountEditor(ctx, controller);
    await type(el, 'SU');
    expect(suggestionTexts(el)).to.be.empty;
  });

  it('dismisses suggestions with Escape without cancelling the edit', async () => {
    const { controller } = makeController();
    const { ctx, state } = makeCtx(0);
    const el = await mountEditor(ctx, controller);
    await type(el, '=SU');
    expect(suggestionTexts(el)).to.eql(['SUM']);

    press(el, 'Escape');
    await el.updateComplete;
    expect(suggestionTexts(el)).to.be.empty;
    expect(state.canceled, 'first Escape only closes the list').to.be.false;
  });

  it('accepts a suggestion on pointerdown', async () => {
    const { controller } = makeController();
    const { ctx } = makeCtx(0);
    const el = await mountEditor(ctx, controller);
    await type(el, '=AV'); // AVERAGE, AVG
    const average = [...el.renderRoot.querySelectorAll('[part~="suggestion"]')].find(
      (node) => node.textContent === 'AVERAGE'
    ) as HTMLElement;
    average.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await el.updateComplete;
    expect(inputOf(el).value).to.equal('=AVERAGE()');
  });
});

interface Row {
  qty: number;
  price: number;
  total: number;
}

describe('formula editor injection (F4)', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  it('injects the formula editor onto allowFormula columns only', async () => {
    const columns: ColumnConfiguration<Row>[] = [
      { key: 'qty', editable: true },
      { key: 'price', editable: true },
      { key: 'total', editable: true, allowFormula: true },
    ];
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise
        .data=${[{ qty: 2, price: 3, total: 0 }]}
        .columns=${columns}
      ></apex-grid-enterprise>`
    );
    await grid.updateComplete;
    await nextFrame();

    const total = grid.columns.find((column) => column.key === 'total');
    const qty = grid.columns.find((column) => column.key === 'qty');
    expect(total?.editorTemplate, 'allowFormula column gets an editor').to.be.a('function');
    expect(qty?.editorTemplate, 'plain column is untouched').to.be.undefined;
  });

  it('does not override a user-provided editorTemplate', async () => {
    const custom = () => html`<input data-custom />`;
    const columns: ColumnConfiguration<Row>[] = [
      { key: 'qty' },
      { key: 'price' },
      { key: 'total', editable: true, allowFormula: true, editorTemplate: custom },
    ];
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise
        .data=${[{ qty: 2, price: 3, total: 0 }]}
        .columns=${columns}
      ></apex-grid-enterprise>`
    );
    await grid.updateComplete;
    await nextFrame();

    const total = grid.columns.find((column) => column.key === 'total');
    expect(total?.editorTemplate).to.equal(custom);
  });
});

type CellEl = HTMLElement & {
  renderRoot: ParentNode;
  row: { data: Row };
  column: { key: PropertyKey };
};

function gridControllerOf(grid: ApexGridEnterprise<Row>): FormulaController<Row> {
  return (
    grid as unknown as { stateController: { module(id: string): FormulaController<Row> } }
  ).stateController.module(FORMULA_MODULE_ID);
}

function editingOf(grid: ApexGridEnterprise<Row>) {
  return (
    grid as unknown as {
      stateController: { editing: { editCell(rowIndex: number, key: string): Promise<boolean> } };
    }
  ).stateController.editing;
}

function cellOf(
  grid: ApexGridEnterprise<Row>,
  rowIndex: number,
  key: keyof Row
): CellEl | undefined {
  for (const row of grid.rows as unknown as Array<{ index: number; cells: CellEl[] }>) {
    if (row.index !== rowIndex) continue;
    return row.cells.find((cell) => String(cell.column.key) === key);
  }
  return undefined;
}

describe('formula editor autocomplete + click-to-insert (Tier 2, P3, grid-bound)', () => {
  const columns: ColumnConfiguration<Row>[] = [
    { key: 'qty', type: 'number', editable: true }, // A
    { key: 'price', type: 'number', editable: true }, // B
    { key: 'total', type: 'number', editable: true, allowFormula: true }, // C
  ];

  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  function sizedParent() {
    const node = document.createElement('div');
    node.style.height = '600px';
    return node;
  }

  async function mountGrid(data: Row[]) {
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise
        .data=${data}
        .columns=${columns}
        .editing=${{ enabled: true, mode: 'cell' }}
      ></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    await grid.updateComplete;
    const scroll = (grid as unknown as { scrollContainer?: { layoutComplete?: Promise<unknown> } })
      .scrollContainer;
    await scroll?.layoutComplete;
    await nextFrame();
    return grid;
  }

  it('referenceFor resolves a cell to its A1 reference (absolute on request)', async () => {
    const data: Row[] = [
      { qty: 1, price: 2, total: 0 },
      { qty: 3, price: 4, total: 0 },
    ];
    const grid = await mountGrid(data);
    const controller = gridControllerOf(grid);
    expect(controller.referenceFor(data[0], 'qty')).to.equal('A1');
    expect(controller.referenceFor(data[1], 'price')).to.equal('B2');
    expect(controller.referenceFor(data[1], 'price', true)).to.equal('$B$2');
  });

  it('click-to-insert appends a clicked cell reference into the open formula', async () => {
    const data: Row[] = [
      { qty: 5, price: 2, total: 0 },
      { qty: 3, price: 4, total: 0 },
    ];
    const grid = await mountGrid(data);
    await editingOf(grid).editCell(0, 'total');
    await grid.updateComplete;
    await nextFrame();

    const totalCell = cellOf(grid, 0, 'total');
    const editor = totalCell?.renderRoot.querySelector(
      'apex-grid-formula-editor'
    ) as FormulaCellEditor | null;
    expect(editor, 'editor is open on total[0]').to.exist;
    const input = editor!.renderRoot.querySelector('input') as HTMLInputElement;

    input.value = '=';
    input.dispatchEvent(new Event('input'));
    await editor!.updateComplete;

    // Click the qty cell of row 0 (column A) -> inserts a relative A1.
    (cellOf(grid, 0, 'qty') as HTMLElement).dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, composed: true })
    );
    await editor!.updateComplete;
    expect(input.value).to.equal('=A1');

    // Continue the formula, then shift-click price[1] (column B, row 2) -> absolute $B$2.
    input.value = '=A1+';
    input.dispatchEvent(new Event('input'));
    await editor!.updateComplete;
    (cellOf(grid, 1, 'price') as HTMLElement).dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, composed: true, shiftKey: true })
    );
    await editor!.updateComplete;
    expect(input.value).to.equal('=A1+$B$2');
  });
});
