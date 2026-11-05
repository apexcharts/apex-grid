import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  FormulaCellEditor,
  type FormulaEditorContext,
  type FormulaEditorController,
  ParseError,
  parseFormula,
} from '../src/features/formula/index.js';
import { foldFullWidth } from '../src/features/formula/parser.js';
import {
  ApexGridAI,
  ApexGridChart,
  ApexGridEnterprise,
  ApexGridSetFilter,
  ApexGridToolPanel,
  enterpriseModules,
} from '../src/index.js';
import { settle } from './settle.js';

// Synthetic stand-ins for what a browser fires while an IME converts text.
// Real composition events are composed, so they reach the document listener.
const compose = (target: EventTarget, type: 'compositionstart' | 'compositionend') =>
  target.dispatchEvent(new CompositionEvent(type, { bubbles: true, composed: true }));

const keydown = (target: EventTarget, key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    composed: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
};

/** Sets the control's text and fires `input`, marked as composing when asked. */
const input = (
  target: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  composing = false
) => {
  target.value = value;
  if ('setSelectionRange' in target) target.setSelectionRange(value.length, value.length);
  target.dispatchEvent(
    new InputEvent('input', { bubbles: true, composed: true, isComposing: composing })
  );
};

async function frames(n = 3) {
  for (let i = 0; i < n; i++) await nextFrame();
}

describe('IME composition and full-width entry (enterprise)', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    FormulaCellEditor.register();
    ApexGridChart.register();
    ApexGridAI.register();
    ApexGridSetFilter.register();
    ApexGridToolPanel.register();
  });
  afterEach(() => fixtureCleanup());

  describe('formula editor keys', () => {
    function setup(value: unknown = '') {
      const formulas = new Map<string, string>();
      const controller: FormulaEditorController = {
        getFormula: (_row, key) => formulas.get(key),
        setFormula: (_row, key, src) => formulas.set(key, src),
        clearFormula: (_row, key) => formulas.delete(key),
        functionNames: () => ['ABS', 'AND', 'AVERAGE', 'SUM'],
      };
      const commits: unknown[] = [];
      const state = { canceled: false };
      const ctx: FormulaEditorContext = {
        value,
        column: { key: 'total' },
        row: { data: { total: value } },
        commit: async (next) => {
          commits.push(next);
          return true;
        },
        cancel: () => {
          state.canceled = true;
        },
      };
      return { controller, ctx, formulas, commits, state };
    }

    async function mount(ctx: FormulaEditorContext, controller: FormulaEditorController) {
      const el = await fixture<FormulaCellEditor>(
        html`<apex-grid-formula-editor .ctx=${ctx} .controller=${controller}></apex-grid-formula-editor>`
      );
      await el.updateComplete;
      return { el, field: el.renderRoot.querySelector('input') as HTMLInputElement };
    }

    it('Enter during a composition does not commit; Enter after it does', async () => {
      const { controller, ctx, formulas, state } = setup();
      const { el, field } = await mount(ctx, controller);
      compose(field, 'compositionstart');
      input(field, '＝Ａ１＋', true);
      const confirming = keydown(field, 'Enter', { isComposing: true });
      compose(field, 'compositionend');
      // Safari sends the confirming Enter after compositionend, with keyCode 229.
      keydown(field, 'Enter', { keyCode: 229 });
      await el.updateComplete;
      expect(confirming.defaultPrevented).to.be.false;
      expect(state.canceled).to.be.false;
      expect(formulas.size).to.equal(0);

      input(field, '＝Ａ１＋１');
      keydown(field, 'Enter');
      await el.updateComplete;
      expect(formulas.get('total'), 'stored in its ASCII form').to.equal('=A1+1');
      expect(state.canceled, 'exits').to.be.true;
    });

    it('Escape during a composition keeps the edit', async () => {
      const { controller, ctx, state } = setup('x');
      const { el, field } = await mount(ctx, controller);
      compose(field, 'compositionstart');
      input(field, 'xとう', true);
      keydown(field, 'Escape', { isComposing: true });
      await el.updateComplete;
      expect(state.canceled).to.be.false;
      compose(field, 'compositionend');
      keydown(field, 'Escape');
      expect(state.canceled).to.be.true;
    });

    it('waits for the composition to end before suggesting, and leaves the arrows to the IME', async () => {
      const { controller, ctx } = setup();
      const { el, field } = await mount(ctx, controller);
      const listbox = () => el.renderRoot.querySelector('[part~="suggestions"]');
      compose(field, 'compositionstart');
      input(field, '＝Ａ', true);
      await el.updateComplete;
      expect(listbox(), 'no list over the candidate window').to.equal(null);

      compose(field, 'compositionend');
      await el.updateComplete;
      expect(listbox(), 'the full-width prefix suggests').to.not.equal(null);
      expect(field.getAttribute('aria-activedescendant')).to.equal('suggestion-0');

      compose(field, 'compositionstart');
      const arrow = keydown(field, 'ArrowDown', { isComposing: true });
      await el.updateComplete;
      expect(arrow.defaultPrevented).to.be.false;
      expect(field.getAttribute('aria-activedescendant')).to.equal('suggestion-0');
      compose(field, 'compositionend');
      keydown(field, 'ArrowDown');
      await el.updateComplete;
      expect(field.getAttribute('aria-activedescendant')).to.equal('suggestion-1');
    });

    it('shows no parse error for text still being converted', async () => {
      const { controller, ctx } = setup();
      const { el, field } = await mount(ctx, controller);
      input(field, '＝Ａ１＋', true);
      await el.updateComplete;
      expect(field.getAttribute('aria-invalid')).to.equal('false');
      compose(field, 'compositionend');
      await el.updateComplete;
      expect(field.getAttribute('aria-invalid')).to.equal('true');
    });

    it('commits a plain full-width value exactly as typed', async () => {
      const { controller, ctx, commits, formulas } = setup('old');
      const { el, field } = await mount(ctx, controller);
      input(field, 'ＡＢＣ（１）');
      keydown(field, 'Enter');
      await el.updateComplete;
      expect(commits).to.deep.equal(['ＡＢＣ（１）']);
      expect(formulas.size).to.equal(0);
    });
  });

  describe('full-width formulas', () => {
    it('reads a leading ＝ and full-width operators as their ASCII forms', () => {
      const pairs: Array<[string, string]> = [
        ['＝ＳＵＭ（Ａ１：Ａ３）＊２', '=SUM(A1:A3)*2'],
        ['＝ＩＦ（Ａ１＞０，Ａ１－１，Ａ１／２）＋Ｂ２', '=IF(A1>0,A1-1,A1/2)+B2'],
        ['＝＄Ａ＄１＾２＆"x"', '=$A$1^2&"x"'],
        ['＝（Ａ１＜＞Ｂ１）', '=(A1<>B1)'],
        // Kana mode types these for `,` `-` `.`.
        ['＝ＳＵＭ（Ａ１\u3001Ｂ１）\u30fc１\u3002５', '=SUM(A1,B1)-1.5'],
        ['\u3000＝Ａ１\u2212１', ' =A1-1'],
        ['=A1+1', '=A1+1'],
      ];
      for (const [wide, ascii] of pairs) {
        expect(foldFullWidth(wide), wide).to.equal(ascii);
        expect(parseFormula(wide), wide).to.deep.equal(parseFormula(ascii));
      }
    });

    it('never changes the text of a string literal', () => {
      expect(foldFullWidth('＝"ＡＢＣ（１）\u3001\u30fc"＆Ａ１')).to.equal(
        '="ＡＢＣ（１）\u3001\u30fc"&A1'
      );
      expect(parseFormula('＝"ＡＢＣ（１）"＆Ａ１')).to.deep.include({
        type: 'binary',
        operator: '&',
      });
      const ast = parseFormula('＝"東京（本社）"') as { type: string; value: string };
      expect(ast).to.deep.equal({ type: 'string', value: '東京（本社）' });
      // An escaped quote keeps the literal open.
      expect(foldFullWidth('＝"Ａ""Ｂ"＋１')).to.equal('="Ａ""Ｂ"+1');
    });

    it('keeps the full-width quote out of the fold, so it is still an error', () => {
      expect(() => parseFormula('＝＂ａ＂')).to.throw(ParseError);
    });

    it('keeps error positions on the text as typed', () => {
      const position = (src: string) => {
        try {
          parseFormula(src);
        } catch (error) {
          return (error as ParseError).position;
        }
        return -1;
      };
      expect(position('＝Ａ１＋')).to.equal(position('=A1+'));
      expect(position('＝Ａ１＋＋＋')).to.equal(position('=A1+++'));
    });

    it('returns text with nothing to fold as it is', () => {
      const text = '=SUM(A1:A3)';
      expect(foldFullWidth(text)).to.equal(text);
    });

    describe('in a grid', () => {
      type Row = { qty: number; price: number; total: number | string | null };

      async function mountGrid(data: Row[], columns: ColumnConfiguration<Row>[]) {
        const parent = document.createElement('div');
        parent.style.height = '400px';
        const grid = await fixture<ApexGridEnterprise<Row>>(
          html`<apex-grid-enterprise
            .data=${data}
            .columns=${columns}
            .editing=${{ enabled: true, mode: 'cell' }}
          ></apex-grid-enterprise>`,
          { parentNode: parent }
        );
        await settle(grid);
        return grid;
      }

      async function editAndType(grid: ApexGridEnterprise<Row>, key: string, text: string) {
        const editing = (
          grid as unknown as {
            stateController: { editing: { editCell(r: number, k: string): Promise<boolean> } };
          }
        ).stateController.editing;
        await editing.editCell(0, key);
        await grid.updateComplete;
        await nextFrame();
        const cell = (
          grid.rows as unknown as Array<{
            cells: Array<HTMLElement & { column: { key: string }; renderRoot: ParentNode }>;
          }>
        )[0].cells.find((c) => c.column.key === key)!;
        const editor = cell.renderRoot.querySelector(
          'apex-grid-formula-editor'
        ) as FormulaCellEditor;
        const field = editor.renderRoot.querySelector('input') as HTMLInputElement;
        compose(field, 'compositionstart');
        input(field, text, true);
        compose(field, 'compositionend');
        keydown(field, 'Enter', { keyCode: 229 });
        await editor.updateComplete;
        expect(editor.isConnected, 'the confirming Enter keeps the editor').to.be.true;
        keydown(field, 'Enter');
        await new Promise((resolve) => setTimeout(resolve, 20));
        await grid.updateComplete;
        await nextFrame();
      }

      it('computes and stores a formula typed in full-width', async () => {
        const data: Row[] = [{ qty: 2, price: 3, total: null }];
        const grid = await mountGrid(data, [
          { key: 'qty', type: 'number', editable: true },
          { key: 'price', type: 'number', editable: true },
          { key: 'total', type: 'number', editable: true, allowFormula: true } as never,
        ]);
        await editAndType(grid, 'total', '＝Ａ１＊Ｂ１＋１');
        expect(grid.getFormula(data[0], 'total')).to.equal('=A1*B1+1');
        expect(data[0].total).to.equal(7);
      });

      it('keeps full-width text inside a string literal', async () => {
        const data: Row[] = [{ qty: 2, price: 3, total: null }];
        const grid = await mountGrid(data, [
          { key: 'qty', type: 'number', editable: true },
          { key: 'price', type: 'number', editable: true },
          { key: 'total', type: 'string', editable: true, allowFormula: true } as never,
        ]);
        await editAndType(grid, 'total', '＝"東京（本社）"＆Ａ１');
        expect(grid.getFormula(data[0], 'total')).to.equal('="東京（本社）"&A1');
        expect(data[0].total).to.equal('東京（本社）2');
      });
    });
  });

  describe('chart dialog', () => {
    async function openChart() {
      const parent = document.createElement('div');
      parent.style.height = '400px';
      const grid = await fixture<ApexGridEnterprise<{ name: string; q1: number }>>(
        html`<apex-grid-enterprise
          .data=${[{ name: 'A', q1: 1 }, { name: 'B', q1: 2 }]}
          .columns=${[{ key: 'name', type: 'string' }, { key: 'q1', type: 'number' }]}
        ></apex-grid-enterprise>`,
        { parentNode: parent }
      );
      await grid.updateComplete;
      const panel = await fixture<ApexGridChart>(
        html`<apex-grid-chart .grid=${grid as never} heading="Original"></apex-grid-chart>`
      );
      panel.show();
      await frames(4);
      return panel;
    }

    const part = (panel: ApexGridChart, name: string) =>
      panel.querySelector<HTMLInputElement>(`[part="${name}"]`)!;

    it('Enter and Escape of a conversion in the heading keep the rename and the dialog', async () => {
      const panel = await openChart();
      part(panel, 'heading').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await frames(1);
      const field = part(panel, 'heading-input');
      compose(field, 'compositionstart');
      input(field, '売上', true);
      keydown(field, 'Enter', { isComposing: true });
      keydown(field, 'Escape', { isComposing: true });
      await frames(1);
      expect(panel.open).to.be.true;
      expect(part(panel, 'heading-input'), 'still renaming').to.equal(field);
      expect(panel.heading).to.equal('Original');

      compose(field, 'compositionend');
      keydown(field, 'Enter');
      await frames(1);
      expect(panel.heading).to.equal('売上');
    });

    it('Escape of a conversion elsewhere in the dialog does not close it', async () => {
      const panel = await openChart();
      const close = part(panel, 'close');
      keydown(close, 'Escape', { isComposing: true });
      keydown(close, 'Tab', { isComposing: true });
      await frames(1);
      expect(panel.open).to.be.true;
      keydown(close, 'Escape');
      await frames(1);
      expect(panel.open).to.be.false;
    });
  });

  describe('AI panel', () => {
    type Row = { region: string; amount: number };
    async function mountAI(mode: 'inline' | 'dialog') {
      const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
        .data=${[{ region: 'EMEA', amount: 10 }, { region: 'AMER', amount: 30 }]}
        .columns=${[{ key: 'region', sort: true }, { key: 'amount', type: 'number', sort: true }]}
      ></apex-grid-enterprise>`);
      await grid.updateComplete;
      const panel = await fixture<ApexGridAI>(
        html`<apex-grid-ai .grid=${grid} mode=${mode}></apex-grid-ai>`
      );
      await panel.updateComplete;
      if (mode === 'dialog') {
        panel.show();
        await frames(2);
      }
      const prompt = panel.renderRoot.querySelector<HTMLTextAreaElement>('[part="input"]')!;
      return { grid, panel, prompt };
    }

    it('Ctrl+Enter that confirms a conversion does not send', async () => {
      const { grid, panel, prompt } = await mountAI('inline');
      input(prompt, 'sort by amount descending');
      await panel.updateComplete;
      keydown(prompt, 'Enter', { ctrlKey: true, isComposing: true });
      keydown(prompt, 'Enter', { ctrlKey: true, keyCode: 229 });
      await frames(5);
      expect(grid.getState().sort).to.have.lengthOf(0);

      keydown(prompt, 'Enter', { ctrlKey: true });
      for (let i = 0; i < 40 && grid.getState().sort.length === 0; i++) await nextFrame();
      expect(grid.getState().sort).to.have.lengthOf(1);
    });

    it('Escape of a conversion in the prompt keeps the dialog open', async () => {
      const { panel, prompt } = await mountAI('dialog');
      compose(prompt, 'compositionstart');
      input(prompt, 'とう', true);
      keydown(prompt, 'Escape', { isComposing: true });
      await frames(1);
      expect(panel.open).to.be.true;
      compose(prompt, 'compositionend');
      keydown(prompt, 'Escape');
      await frames(1);
      expect(panel.open).to.be.false;
    });
  });

  describe('list searches', () => {
    it('the set filter search waits for the conversion to end', async () => {
      const grid = await fixture<ApexGridEnterprise<{ city: string }>>(
        html`<apex-grid-enterprise
          .data=${[{ city: '東京' }, { city: '大阪' }, { city: 'とうほく' }]}
          .columns=${[{ key: 'city', type: 'string' }]}
        ></apex-grid-enterprise>`
      );
      await grid.updateComplete;
      const filter = await fixture<ApexGridSetFilter>(
        html`<apex-grid-set-filter .grid=${grid as never} column="city"></apex-grid-set-filter>`
      );
      await filter.updateComplete;
      const labels = () =>
        [...filter.shadowRoot!.querySelectorAll('[part~="option"] [part="label"]')]
          .map((el) => el.textContent?.trim())
          .slice(1);
      const search = filter.shadowRoot!.querySelector<HTMLInputElement>('[part="search"]')!;
      expect(labels()).to.have.lengthOf(3);

      compose(search, 'compositionstart');
      input(search, 'とう', true);
      await filter.updateComplete;
      expect(labels(), 'the kana reading filters nothing yet').to.have.lengthOf(3);

      input(search, '東京', true);
      compose(search, 'compositionend');
      await filter.updateComplete;
      expect(labels()).to.deep.equal(['東京']);
    });

    it('the tool panel search waits for the conversion to end', async () => {
      const grid = await fixture<ApexGridEnterprise<{ a: string; b: string }>>(
        html`<apex-grid-enterprise
          .data=${[{ a: '1', b: '2' }]}
          .columns=${[{ key: 'a', headerText: '売上' }, { key: 'b', headerText: '地域' }]}
        ></apex-grid-enterprise>`
      );
      await grid.updateComplete;
      const panel = await fixture<ApexGridToolPanel>(
        html`<apex-grid-tool-panel .grid=${grid as never}></apex-grid-tool-panel>`
      );
      await panel.updateComplete;
      const items = () => panel.shadowRoot!.querySelectorAll('li[part="item"]').length;
      const search = panel.shadowRoot!.querySelector<HTMLInputElement>('[part="search"]')!;
      expect(items()).to.equal(2);

      input(search, 'うり', true);
      await panel.updateComplete;
      expect(items()).to.equal(2);

      input(search, '売上', true);
      compose(search, 'compositionend');
      await panel.updateComplete;
      expect(items()).to.equal(1);
    });
  });
});
