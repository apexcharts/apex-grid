import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  FormulaCellEditor,
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
