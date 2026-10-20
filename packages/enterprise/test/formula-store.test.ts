import { elementUpdated, expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration, GridState } from 'apex-grid';
import {
  type CellValue,
  createFunctionRegistry,
  FORMULA_MODULE_ID,
  type FormulaController,
  type FormulaEngineHost,
  FormulaStore,
  formulaModule,
} from '../src/features/formula/index.js';
import { ApexGridEnterprise, enterpriseModules } from '../src/index.js';

interface Row {
  id: number; // A
  qty: number; // B
  price: number; // C
  total: number; // D
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number', sort: true },
  { key: 'qty', type: 'number', editable: true },
  { key: 'price', type: 'number', editable: true },
  { key: 'total', type: 'number', editable: true, allowFormula: true },
];

const makeData = (): Row[] => [
  { id: 1, qty: 1, price: 10, total: 100 },
  { id: 2, qty: 2, price: 10, total: 200 },
  { id: 3, qty: 3, price: 10, total: 0 },
  { id: 4, qty: 4, price: 10, total: 400 },
];

type FormulaEntry = { row: Record<string, unknown>; column: string; src: string };
type FormulaSlice = { enterprise?: { formulas?: FormulaEntry[] } };
const formulasOf = (state: GridState) => (state.modules as FormulaSlice).enterprise?.formulas;
const withFormulas = (formulas: unknown[]) =>
  ({ modules: { enterprise: { formulas } } }) as unknown as Partial<GridState>;

function controllerOf(grid: ApexGridEnterprise<Row>): FormulaController<Row> {
  return (
    grid as unknown as { stateController: { module(id: string): FormulaController<Row> } }
  ).stateController.module(FORMULA_MODULE_ID);
}

function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '600px';
  return node;
}

async function settle(grid: ApexGridEnterprise<Row>) {
  await grid.updateComplete;
  await nextFrame();
  await grid.updateComplete;
}

type RowEl = HTMLElement & { data: Row; renderRoot: ParentNode; updateComplete: Promise<unknown> };

async function gutterLabel(grid: ApexGridEnterprise<Row>, record: Row) {
  for (let frame = 0; frame < 10 && !grid.rows.length; frame++) await nextFrame();
  const rows = grid.rows as unknown as RowEl[];
  await Promise.all(rows.map((row) => row.updateComplete));
  const el = rows.find((row) => row.data === record);
  return el?.renderRoot.querySelector('[part~="row-number"]')?.textContent?.trim();
}

function headerLetters(grid: ApexGridEnterprise<Row>): Record<string, string> {
  const headerRow = grid.shadowRoot!.querySelector('apex-grid-header-row')!;
  const out: Record<string, string> = {};
  for (const header of headerRow.shadowRoot!.querySelectorAll('apex-grid-header')) {
    const h = header as unknown as { column: { key: string }; coordinateLetter: string };
    out[h.column.key] = h.coordinateLetter;
  }
  return out;
}

/** An in-memory engine host for the pure store. */
function memoryHost(rows: number, cols: number) {
  const cells: CellValue[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, () => (r + 1) as CellValue)
  );
  const host: FormulaEngineHost = {
    readValue: ({ row, col }) => cells[row]?.[col] ?? null,
    writeValue: ({ row, col }, value) => {
      if (cells[row]) cells[row][col] = value;
    },
    isValidAddress: ({ row, col }) => row >= 0 && row < rows && col >= 0 && col < cols,
    functions: createFunctionRegistry(),
  };
  return { cells, host };
}

/** Count Set.prototype.add calls made while `run` executes. */
function countSetAdds(run: () => void): number {
  const original = Set.prototype.add;
  let adds = 0;
  Set.prototype.add = function (this: Set<unknown>, value: unknown) {
    adds += 1;
    return original.call(this, value);
  } as typeof Set.prototype.add;
  try {
    run();
  } finally {
    Set.prototype.add = original;
  }
  return adds;
}

describe('formula store (audit batch B15)', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules, formulaModule);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  async function mount(
    data: Row[],
    extra: {
      rowId?: (row: Row) => number;
      reorder?: boolean;
      cols?: ColumnConfiguration<Row>[];
    } = {}
  ) {
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise
        .data=${data}
        .columns=${extra.cols ?? columns}
        .rowId=${extra.rowId}
        .editing=${{ enabled: true, history: { enabled: true } }}
        .rowReordering=${extra.reorder ? { enabled: true, applyToData: true } : undefined}
      ></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    await settle(grid);
    return grid;
  }

  // --- literal writes clear the stored formula (ent-formula-store-1) ---------

  describe('a literal written over a formula cell', () => {
    it('paste detaches the formula and keeps the pasted value', async () => {
      const data = makeData();
      const grid = await mount(data);
      grid.setFormula(data[0], 'total', '=B1*C1');
      expect(data[0].total).to.equal(10);

      grid.selectRange({ row: 0, column: 'total' });
      grid.pasteText('42');
      expect(data[0].total).to.equal(42);
      expect(grid.getFormula(data[0], 'total')).to.be.undefined;

      grid.selectRange({ row: 0, column: 'qty' });
      grid.pasteText('6');
      expect(data[0].total, 'pasted literal survives a precedent edit').to.equal(42);
    });

    it('applyEdits and undo replay detach the formula too', async () => {
      const data = makeData();
      const grid = await mount(data);
      grid.setFormula(data[0], 'total', '=B1*C1');
      grid.setFormula(data[1], 'total', '=D1+1'); // depends on the first formula
      expect(data[1].total).to.equal(11);

      grid.applyEdits([{ row: data[0], column: 'total', value: 7 }]);
      expect(grid.getFormula(data[0], 'total')).to.be.undefined;
      expect(data[1].total, 'dependents read the literal').to.equal(8);
      grid.applyEdits([{ row: data[0], column: 'qty', value: 9 }]);
      expect(data[0].total).to.equal(7);

      grid.setFormula(data[2], 'total', '=B3*C3');
      grid.applyEdits([{ row: data[2], column: 'qty', value: 5 }]);
      expect(data[2].total).to.equal(50);
      grid.applyEdits([{ row: data[2], column: 'total', value: 1 }]);
      grid.undo(); // replays the computed 50 as a literal
      expect(data[2].total).to.equal(50);
      expect(grid.getFormula(data[2], 'total')).to.be.undefined;
    });
  });

  // --- formulas follow their rows (ent-formula-store-2) ----------------------

  describe('row identity', () => {
    it('an in-place reorder keeps the formula on its row and re-offsets its references', async () => {
      const data = makeData();
      const grid = await mount(data, { reorder: true });
      const [r1, r2, r3, r4] = data;
      grid.setFormula(r3, 'total', '=B3*C3');
      expect(r3.total).to.equal(30);

      expect(grid.moveRow(2, 0)).to.equal(true);
      await settle(grid);
      expect(data.map((row) => row.id)).to.deep.equal([3, 1, 2, 4]);
      expect(grid.getFormula(r3, 'total'), 'formula still on id3').to.equal('=B1*C1');
      expect(grid.getFormula(r2, 'total'), 'not moved onto id2').to.be.undefined;

      grid.recalculateFormulas();
      expect(r3.total).to.equal(30);
      expect(r2.total, 'id2 literal total preserved').to.equal(200);
      expect(r1.total).to.equal(100);
      expect(r4.total).to.equal(400);
    });

    it('removing a row (same objects, no rowId) keeps formulas on their rows', async () => {
      const data = makeData();
      const grid = await mount(data);
      const [, , r3, r4] = data;
      grid.setFormula(r3, 'total', '=B3*C3');
      grid.data = data.filter((row) => row.id !== 1);
      await settle(grid);
      expect(r4.total, 'id4 literal total preserved').to.equal(400);
      expect(grid.getFormula(r3, 'total')).to.equal('=B2*C2');
      expect(r3.total).to.equal(30);
      expect(grid.getFormula(r4, 'total')).to.be.undefined;
    });

    it('fresh row objects follow the rowId option', async () => {
      const data = makeData();
      const grid = await mount(data, { rowId: (row) => row.id });
      grid.setFormula(data[2], 'total', '=B3*C3');
      const fresh = makeData()
        .reverse()
        .map((row) => ({ ...row, qty: row.qty * 2 }));
      grid.data = fresh;
      await settle(grid);
      const id3 = fresh.find((row) => row.id === 3)!;
      const id2 = fresh.find((row) => row.id === 2)!;
      expect(grid.getFormula(id3, 'total')).to.equal('=B2*C2');
      expect(id3.total).to.equal(60);
      expect(id2.total, 'the row now at the old position keeps its literal').to.equal(200);
    });

    it('an immutable copy of a formula row keeps its formula', async () => {
      const data = makeData();
      const grid = await mount(data);
      grid.setFormula(data[0], 'total', '=B1*C1');
      grid.setFormula(data[1], 'total', '=B2*C2');
      const next = data.map((row, i) => (i === 0 ? { ...row, qty: 7 } : row));
      grid.data = next;
      await settle(grid);
      expect(grid.getFormula(next[0], 'total')).to.equal('=B1*C1');
      expect(next[0].total).to.equal(70);
      expect(grid.getFormula(next[1], 'total')).to.equal('=B2*C2');

      const all = next.map((row) => ({ ...row, price: 1 })); // every object new
      grid.data = all;
      await settle(grid);
      expect(all[0].total).to.equal(7);
      expect(all[1].total).to.equal(2);
    });

    it('a fresh object holding another value at that position keeps its literal', async () => {
      const data = makeData();
      const grid = await mount(data);
      grid.setFormula(data[0], 'total', '=5*5');
      const reloaded = makeData().reverse(); // id4 (total 400) now at index 0
      grid.data = reloaded;
      await settle(grid);
      expect(reloaded[0].total).to.equal(400);
      expect(grid.getFormula(reloaded[0], 'total')).to.be.undefined;
    });

    it('a grid without formulas pays nothing on later data changes', async () => {
      const plain = columns.map((column) => ({ ...column, allowFormula: false }));
      const data = makeData();
      const grid = await mount(data, { cols: plain });
      const state = (grid as unknown as { stateController: { bumpDecoration(): void } })
        .stateController;
      let bumps = 0;
      const bump = state.bumpDecoration.bind(state);
      state.bumpDecoration = () => {
        bumps += 1;
        bump();
      };
      grid.applyEdits([{ row: data[0], column: 'qty', value: 9 }]);
      for (let i = 0; i < 3; i++) {
        grid.data = [...grid.data].reverse();
        await settle(grid);
      }
      expect(bumps).to.equal(0);
    });

    it('replacing data and moving the grid in one task still recalculates (ent-formula-store-9)', async () => {
      const data = makeData();
      const grid = await mount(data);
      grid.setFormula(data[0], 'total', '=B1*C1');
      const fresh = [...data];
      fresh[0].qty = 5;
      grid.data = fresh;
      const other = sizedParent();
      document.body.append(other);
      try {
        other.append(grid);
        await settle(grid);
        expect(fresh[0].total).to.equal(50);
        expect(grid.getFormula(fresh[0], 'total')).to.equal('=B1*C1');
      } finally {
        other.remove();
      }
    });
  });

  // --- state: rowId option, order, validation (ent-grid-core-1/2, store-6/7, security-2)

  describe('state round trip', () => {
    it('honours GetStateOptions.rowId and SetStateOptions.rowId', async () => {
      const byId = (row: Row) => row.id;
      const data = makeData();
      const grid = await mount(data);
      grid.setFormula(data[0], 'total', '=5*5');
      const saved = grid.getState({ rowId: byId });
      expect(formulasOf(saved)?.[0].row).to.deep.equal({ id: 1 });

      // Reload: a fresh grid over the same records in another order.
      const reloaded = makeData().reverse();
      const next = await mount(reloaded);
      next.setState(saved, { rowId: byId });
      const id1 = reloaded.find((row) => row.id === 1)!;
      const id4 = reloaded[0];
      expect(id4.total, 'the row now at index 0 is untouched').to.equal(400);
      expect(next.getFormula(id4, 'total')).to.be.undefined;
      expect(next.getFormula(id1, 'total')).to.equal('=5*5');
      expect(id1.total).to.equal(25);
    });

    it('re-offsets relative references when restored rows come back in another order', async () => {
      const byId = (row: Row) => row.id;
      const data = makeData();
      const grid = await mount(data, { rowId: byId });
      grid.setFormula(data[2], 'total', '=B3*C3');
      const saved = grid.getState();

      const reloaded = makeData().reverse(); // id3 now at index 1
      for (const row of reloaded) row.qty *= 2;
      const next = await mount(reloaded, { rowId: byId });
      next.setState(saved);
      const id3 = reloaded.find((row) => row.id === 3)!;
      expect(next.getFormula(id3, 'total')).to.equal('=B2*C2');
      expect(id3.total).to.equal(60);
    });

    it('restores in O(rows) rowId calls, not O(formulas x rows)', async () => {
      let calls = 0;
      const rowId = (row: Row) => {
        calls += 1;
        return row.id;
      };
      const N = 1000;
      const data = Array.from({ length: N }, (_, i) => ({ id: i + 1, qty: i, price: 2, total: 0 }));
      const grid = await mount(data, { rowId });
      const formulas = data.map((row, i) => ({
        row: { id: row.id },
        column: 'total',
        src: `=B${i + 1}*C${i + 1}`,
      }));
      calls = 0;
      grid.setState(withFormulas(formulas));
      expect(grid.getFormula(data[5], 'total')).to.equal('=B6*C6');
      expect(data[5].total).to.equal(10);
      expect(calls, 'rowId calls during setState').to.be.below(10 * N);
    });

    it('skips a malformed formula with a warning and keeps the valid ones', async () => {
      const data = makeData();
      const grid = await mount(data);
      grid.setFormula(data[3], 'total', '=1+1');
      let result: ReturnType<typeof grid.setState> | undefined;
      expect(() => {
        result = grid.setState(
          withFormulas([
            { row: { index: 0 }, column: 'total', src: '=B1*C1' },
            { row: { index: 1 }, column: 'total', src: '=B2*' },
            { row: { index: 2 }, column: 'total', src: '=B3*C3' },
          ])
        );
      }).not.to.throw();
      expect(grid.getFormula(data[0], 'total')).to.equal('=B1*C1');
      expect(grid.getFormula(data[1], 'total')).to.be.undefined;
      expect(grid.getFormula(data[2], 'total')).to.equal('=B3*C3');
      expect(data[2].total).to.equal(30);
      expect(result?.warnings.some((w) => w.includes('=B2*'))).to.equal(true);
    });

    it('restores formulas only into allowFormula columns', async () => {
      const data = makeData();
      const grid = await mount(data);
      const result = grid.setState(
        withFormulas([
          { row: { index: 0 }, column: 'price', src: '=0' },
          { row: { index: 1 }, column: 'total', src: '=B2*C2' },
        ])
      );
      expect(data[0].price, 'non-formula column untouched').to.equal(10);
      expect(grid.getFormula(data[0], 'price')).to.be.undefined;
      expect(data[1].total).to.equal(20);
      expect(result.warnings.some((w) => w.includes('price'))).to.equal(true);
    });

    it('fill and saved state reach only allowFormula columns', async () => {
      const data = makeData();
      const grid = await mount(data);
      grid.setFormula(data[0], 'total', '=B1*C1');
      expect(controllerOf(grid).fillFormula(data[0], 'total', data[0], 'id')).to.equal(false);
      expect(data[0].id, 'no formula written into id').to.equal(1);

      grid.setFormula(data[1], 'qty', '=A1+1'); // app code may target any column
      expect(data[1].qty).to.equal(2);
      const saved = grid.getState();
      expect(formulasOf(saved)?.map((entry) => entry.column)).to.deep.equal(['total']);
      expect(grid.setState(saved).warnings).to.deep.equal([]);
      expect(grid.getFormula(data[0], 'total')).to.equal('=B1*C1');
    });

    it('a snapshot restore keeps formulas code set outside allowFormula columns', async () => {
      const data = makeData();
      const plain = columns.map((column) => ({ ...column, allowFormula: false }));
      const grid = await mount(data, { cols: plain });
      grid.setFormula(data[0], 'total', '=B1*C1');
      const saved = grid.getState();
      grid.sort({ key: 'id', direction: 'descending' });
      await settle(grid);
      expect(grid.setState(saved).warnings).to.deep.equal([]);
      expect(grid.getFormula(data[0], 'total')).to.equal('=B1*C1');
    });

    it('an AI undo keeps a code set formula next to a saved one', async () => {
      const data = makeData();
      const grid = await mount(data);
      grid.setFormula(data[0], 'total', '=B1*C1');
      grid.setFormula(data[1], 'price', '=A2*2');
      const result = await grid.runPrompt('sort by id descending');
      await settle(grid);
      if (result.mode !== 'control') throw new Error('expected a control result');
      result.undo();
      await settle(grid);
      expect(grid.getFormula(data[0], 'total')).to.equal('=B1*C1');
      expect(grid.getFormula(data[1], 'price')).to.equal('=A2*2');
      expect(data[1].price).to.equal(4);
    });

    it('a reload without grid.rowId leaves literals for setState to restore by id', async () => {
      const byId = (row: Row) => row.id;
      const data = makeData();
      const grid = await mount(data);
      grid.setFormula(data[0], 'total', '=5*5');
      const saved = grid.getState({ rowId: byId });

      const reloaded = makeData().reverse();
      grid.data = reloaded;
      await settle(grid);
      grid.setState(saved, { rowId: byId });
      const id1 = reloaded.find((row) => row.id === 1)!;
      expect(reloaded[0].total, 'id4 total untouched').to.equal(400);
      expect(grid.getFormula(reloaded[0], 'total')).to.be.undefined;
      expect(grid.getFormula(id1, 'total')).to.equal('=5*5');
      expect(id1.total).to.equal(25);
    });

    it('strict throws before any stored formula changes', async () => {
      const data = makeData();
      const grid = await mount(data);
      grid.setFormula(data[0], 'total', '=B1*C1');
      const state = withFormulas([
        { row: { index: 1 }, column: 'total', src: '=B2*C2' },
        { row: { index: 2 }, column: 'total', src: '=(' },
      ]);
      expect(() => grid.setState(state, { strict: true })).to.throw('=(');
      expect(grid.getFormula(data[0], 'total')).to.equal('=B1*C1');
      expect(grid.getFormula(data[1], 'total')).to.be.undefined;
    });
  });

  // --- recalc events (ent-formula-store-4, ent-formula-store-8, sweep-test-gaps-1)

  describe('recalc events', () => {
    it('a full recalculation signals the view once, not once per formula', async () => {
      const N = 500;
      const data = Array.from({ length: N }, (_, i) => ({ id: i + 1, qty: i, price: 2, total: 0 }));
      const grid = await mount(data);
      for (let i = 0; i < N; i++) grid.setFormula(data[i], 'total', `=B${i + 1}*C${i + 1}`);
      await settle(grid);
      let signals = 0;
      const onSignal = () => {
        signals += 1;
      };
      (grid as EventTarget).addEventListener('apex-view-changed', onSignal);
      for (const row of data) row.price = 3;
      grid.recalculateFormulas();
      await settle(grid);
      (grid as EventTarget).removeEventListener('apex-view-changed', onSignal);
      expect(data[10].total).to.equal(30);
      expect(signals).to.be.at.most(2);
    });

    it('an edit made from a cellValueChanged listener during recalc still reaches dependents', async () => {
      const data = makeData();
      const grid = await mount(data);
      grid.setFormula(data[0], 'total', '=B1*C1'); // 10
      grid.setFormula(data[1], 'total', '=C1*10'); // 100
      let reacted = false;
      grid.addEventListener('cellValueChanged', (event) => {
        const { data: record, key } = event.detail;
        if (!reacted && record === data[0] && key === 'total') {
          reacted = true;
          grid.applyEdits([{ row: data[0], column: 'price', value: 7 }]);
        }
      });
      grid.applyEdits([{ row: data[0], column: 'qty', value: 2 }]);
      expect(data[0].price).to.equal(7);
      expect(data[1].total, 'D2 follows C1').to.equal(70);
      expect(data[0].total, 'D1 follows C1').to.equal(14);
    });

    it('clearFormula re-renders the cell and emits stateChanged', async () => {
      const data = makeData();
      const grid = await mount(data);
      grid.setFormula(data[0], 'total', '=B1*C1');
      grid.showFormulas = true;
      await settle(grid);
      let changes = 0;
      grid.addEventListener('stateChanged', () => {
        changes += 1;
      });
      const cellText = () => {
        const row = (grid.rows as unknown as RowEl[]).find((r) => r.data === data[0])!;
        const cell = [...row.renderRoot.querySelectorAll('apex-grid-cell')].find(
          (c) => (c as unknown as { column: { key: string } }).column.key === 'total'
        ) as HTMLElement & { updateComplete: Promise<unknown> };
        return cell;
      };
      expect(cellText().shadowRoot!.textContent?.trim()).to.equal('=B1*C1');
      grid.clearFormula(data[0], 'total');
      await settle(grid);
      const cell = cellText();
      await cell.updateComplete;
      expect(cell.shadowRoot!.textContent?.trim()).to.equal('10');
      expect(changes).to.equal(1);
    });
  });

  // --- coordinate hints (ent-formula-store-3, core-row-2) ---------------------

  describe('coordinate hints', () => {
    it('header letters follow the engine letters past a hidden column and a move', async () => {
      const data = makeData();
      const grid = await mount(data, {
        cols: [
          { key: 'id', hidden: true },
          { key: 'qty', type: 'number' },
          { key: 'price', type: 'number' },
          { key: 'total', type: 'number', editable: true, allowFormula: true },
        ],
      });
      expect(grid.coordinateHints).to.equal(true);
      const ctrl = controllerOf(grid);
      expect(`${headerLetters(grid).qty}1`).to.equal(ctrl.referenceFor(data[0], 'qty'));

      await grid.moveColumn('price', 'qty', 'before');
      await settle(grid);
      const letters = headerLetters(grid);
      expect(`${letters.price}1`).to.equal(ctrl.referenceFor(data[0], 'price'));
      expect(`${letters.qty}1`).to.equal(ctrl.referenceFor(data[0], 'qty'));
    });

    it('the row-number gutter labels the data row a reference reads', async () => {
      const data = makeData();
      const grid = await mount(data);
      grid.sort({ key: 'id', direction: 'descending' });
      await settle(grid);
      expect(await gutterLabel(grid, data[0])).to.equal('1');
      expect(await gutterLabel(grid, data[3])).to.equal('4');
    });

    it('the gutter follows an in-place reorder of the data', async () => {
      const data = makeData();
      const grid = await mount(data, { reorder: true });
      const [, , r3] = data;
      grid.moveRow(2, 0);
      await settle(grid);
      await elementUpdated(grid);
      expect(await gutterLabel(grid, r3)).to.equal('1');
    });
  });

  // --- show formulas display (ent-grid-helpers-5, ent-grid-helpers-6) ---------

  describe('show formulas display', () => {
    it('keeps the column type renderer for cells without a formula', async () => {
      const data = makeData();
      const grid = await mount(data, {
        cols: [
          { key: 'id', type: 'number' },
          { key: 'qty', type: 'number' },
          { key: 'price', type: 'currency', allowFormula: true },
          { key: 'total', type: 'number', allowFormula: true },
        ],
      });
      grid.setFormula(data[0], 'price', '=1+1');
      grid.showFormulas = true;
      await settle(grid);
      const row = (grid.rows as unknown as RowEl[]).find((r) => r.data === data[1])!;
      const cell = [...row.renderRoot.querySelectorAll('apex-grid-cell')].find(
        (c) => (c as unknown as { column: { key: string } }).column.key === 'price'
      )!;
      expect(cell.shadowRoot!.textContent?.trim()).to.equal('$10.00');
    });

    it('lays the formula source out left to right', async () => {
      const data = makeData();
      const grid = await mount(data);
      grid.setFormula(data[0], 'total', '=B1*C1');
      grid.showFormulas = true;
      await settle(grid);
      const row = (grid.rows as unknown as RowEl[]).find((r) => r.data === data[0])!;
      const span = [...row.renderRoot.querySelectorAll('apex-grid-cell')]
        .map((c) => c.shadowRoot!.querySelector('[part="formula-source"]'))
        .find(Boolean);
      expect(span?.getAttribute('dir')).to.equal('ltr');
    });
  });

  // --- range precedents are indexed, not expanded (ent-formula-store-5) -------

  describe('range precedents', () => {
    it('share-of-total filled down builds a graph linear in rows', () => {
      const N = 1000;
      const { cells, host } = memoryHost(N, 2);
      const store = new FormulaStore(host);
      const adds = countSetAdds(() => {
        for (let i = 0; i < N; i++) {
          store.set({ row: i, col: 1 }, `=A${i + 1}/SUM($A$1:$A$${N})`);
        }
      });
      expect(cells[0][1]).to.be.closeTo(1 / ((N * (N + 1)) / 2), 1e-12);
      expect(adds).to.be.below(20 * N);

      // An edit inside the range still reaches every dependent.
      cells[0][0] = 1 + (N * (N + 1)) / 2;
      store.recalc([{ row: 0, col: 0 }], false);
      expect(cells[1][1]).to.be.closeTo(2 / (N * (N + 1)), 1e-12);
    });

    it('a SUM over 100k rows registers a constant number of keys', () => {
      const N = 100_000;
      const { cells, host } = memoryHost(N, 2);
      const store = new FormulaStore(host);
      const adds = countSetAdds(() => {
        store.set({ row: 0, col: 1 }, `=SUM(A1:A${N})`);
      });
      expect(cells[0][1]).to.equal((N * (N + 1)) / 2);
      expect(adds).to.be.below(50);
    });

    it('orders a chain that runs through ranges and detects a cycle through one', () => {
      const { cells, host } = memoryHost(4, 3);
      const store = new FormulaStore(host);
      store.set({ row: 0, col: 1 }, '=A1*2'); // B1 = 2
      store.set({ row: 1, col: 1 }, '=SUM(B1:B1)+1'); // B2 = 3
      store.set({ row: 0, col: 2 }, '=SUM(B1:B2)'); // C1 = 5
      expect(cells[0][2]).to.equal(5);
      cells[0][0] = 10;
      store.recalc([{ row: 0, col: 0 }], false);
      expect(cells[0][1]).to.equal(20);
      expect(cells[1][1]).to.equal(21);
      expect(cells[0][2]).to.equal(41);

      store.set({ row: 2, col: 2 }, '=SUM(C1:C3)');
      expect(String((cells[2][2] as { code?: string }).code)).to.equal('#CYCLE!');
      store.clear({ row: 2, col: 2 });
      store.set({ row: 3, col: 2 }, '=SUM(B1:B4)');
      expect(cells[3][2]).to.equal(20 + 21 + 3 + 4);
    });
  });
});
