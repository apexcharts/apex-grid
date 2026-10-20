import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import { type ColumnConfiguration, max, min } from 'apex-grid';
import { FormulaCellEditor } from '../src/features/formula/index.js';
import { ApexGridEnterprise, enterpriseModules } from '../src/index.js';

// The formula editor commits through the grid's edit path: an untouched editor
// writes nothing, literals keep the column type, a rejected literal keeps the
// formula, row mode stages formulas with the row, and undo restores formulas.

type Row = { qty: number; price: number; total: number | null };

type CellEl = HTMLElement & {
  renderRoot: ParentNode;
  row: { data: object };
  column: { key: PropertyKey };
};

interface Editing {
  editCell(rowIndex: number, key: string): Promise<boolean>;
  commitCell(value?: unknown): Promise<boolean>;
  commitRow(): Promise<boolean>;
  cancelRow(): void;
  activeRow: unknown;
  activeCell: unknown;
}

const editingOf = (grid: ApexGridEnterprise<never>) =>
  (grid as unknown as { stateController: { editing: Editing } }).stateController.editing;

function cellOf(grid: ApexGridEnterprise<never>, rowIndex: number, key: string) {
  for (const row of grid.rows as unknown as Array<{ index: number; cells: CellEl[] }>) {
    if (row.index !== rowIndex) continue;
    return row.cells.find((cell) => String(cell.column.key) === key);
  }
  return undefined;
}

const editorOf = (grid: ApexGridEnterprise<never>, rowIndex: number, key: string) =>
  (cellOf(grid, rowIndex, key)?.renderRoot.querySelector('apex-grid-formula-editor') ??
    null) as FormulaCellEditor | null;

const inputOf = (editor: FormulaCellEditor) =>
  editor.renderRoot.querySelector('input') as HTMLInputElement;

const numberColumns = (
  extra: Partial<ColumnConfiguration<Row>> = {}
): ColumnConfiguration<Row>[] => [
  { key: 'qty', type: 'number', editable: true },
  { key: 'price', type: 'number', editable: true },
  { key: 'total', type: 'number', editable: true, allowFormula: true, ...extra } as never,
];

async function mount<R extends object>(
  data: R[],
  columns: ColumnConfiguration<R>[],
  editing: Record<string, unknown> = { enabled: true, mode: 'cell' }
) {
  const parent = document.createElement('div');
  parent.style.height = '600px';
  const grid = await fixture<ApexGridEnterprise<R>>(
    html`<apex-grid-enterprise
      .data=${data}
      .columns=${columns}
      .editing=${editing}
    ></apex-grid-enterprise>`,
    { parentNode: parent }
  );
  await grid.updateComplete;
  await (grid as unknown as { scrollContainer?: { layoutComplete?: Promise<unknown> } })
    .scrollContainer?.layoutComplete;
  await nextFrame();
  await nextFrame();
  return grid;
}

async function open(grid: ApexGridEnterprise<never>, rowIndex: number, key: string) {
  await editingOf(grid).editCell(rowIndex, key);
  await grid.updateComplete;
  await nextFrame();
  const editor = editorOf(grid, rowIndex, key);
  expect(editor, `formula editor open on ${key}`).to.exist;
  return editor!;
}

async function type(editor: FormulaCellEditor, text: string) {
  const input = inputOf(editor);
  input.value = text;
  input.setSelectionRange(text.length, text.length);
  input.dispatchEvent(new Event('input'));
  await editor.updateComplete;
  return input;
}

async function press(grid: ApexGridEnterprise<never>, editor: FormulaCellEditor, key: string) {
  inputOf(editor).dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, composed: true })
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  await grid.updateComplete;
  await nextFrame();
}

describe('formula editor commits through the edit pipeline', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    FormulaCellEditor.register();
  });
  afterEach(() => fixtureCleanup());

  describe('literals keep the column type', () => {
    type Mixed = { n: number; code: string; ok: boolean; when: Date };
    const columns: ColumnConfiguration<Mixed>[] = [
      { key: 'n', type: 'number', editable: true },
      { key: 'code', type: 'string', editable: true, allowFormula: true },
      { key: 'ok', type: 'boolean', editable: true, allowFormula: true },
      { key: 'when', type: 'date', editable: true, allowFormula: true },
    ];

    it('opening and leaving the editor untouched writes nothing', async () => {
      const when = new Date(2026, 0, 15);
      const data: Mixed[] = [{ n: 1, code: '00123', ok: true, when }];
      const grid = await mount(data, columns);
      const changed: string[] = [];
      grid.addEventListener('cellValueChanged', (event) =>
        changed.push(String((event as CustomEvent).detail.key))
      );
      for (const key of ['code', 'ok', 'when'] as const) {
        const editor = await open(grid as never, 0, key);
        await press(grid as never, editor, 'Enter');
        expect(editorOf(grid as never, 0, key), `${key} editor closed`).to.equal(null);
      }
      expect(data[0].code).to.equal('00123');
      expect(data[0].ok).to.equal(true);
      expect(data[0].when).to.equal(when);
      expect(changed, 'no write for an untouched editor').to.eql([]);
    });

    it('blurring an untouched editor writes nothing', async () => {
      const data: Mixed[] = [{ n: 1, code: '1e3', ok: false, when: new Date(2026, 0, 1) }];
      const grid = await mount(data, columns);
      const editor = await open(grid as never, 0, 'code');
      inputOf(editor).blur();
      await grid.updateComplete;
      expect(data[0].code).to.equal('1e3');
    });

    it('a typed literal is coerced by the column type', async () => {
      const data: Mixed[] = [{ n: 1, code: 'x', ok: true, when: new Date(2026, 0, 1) }];
      const grid = await mount(data, columns);
      await type(await open(grid as never, 0, 'code'), '0x1F');
      await press(grid as never, editorOf(grid as never, 0, 'code')!, 'Enter');
      expect(data[0].code, 'string column keeps text').to.equal('0x1F');

      await type(await open(grid as never, 0, 'ok'), 'false');
      await press(grid as never, editorOf(grid as never, 0, 'ok')!, 'Enter');
      expect(data[0].ok, 'boolean column parses true / false').to.equal(false);

      await type(await open(grid as never, 0, 'when'), '2026-02-03');
      await press(grid as never, editorOf(grid as never, 0, 'when')!, 'Enter');
      expect(data[0].when).to.be.instanceOf(Date);
      expect(data[0].when.getMonth()).to.equal(1);
      expect(data[0].when.getDate()).to.equal(3);
    });

    it('a number column keeps non-finite text for validators', async () => {
      const data: Row[] = [{ qty: 1, price: 1, total: 4 }];
      const grid = await mount(data, numberColumns());
      await type(await open(grid as never, 0, 'total'), ' 12 ');
      await press(grid as never, editorOf(grid as never, 0, 'total')!, 'Enter');
      expect(data[0].total).to.equal(12);
      await type(await open(grid as never, 0, 'total'), 'Infinity');
      await press(grid as never, editorOf(grid as never, 0, 'total')!, 'Enter');
      expect(data[0].total).to.equal('Infinity');
    });

    it('a column without a type reads a literal by the value the cell holds', async () => {
      type Loose = { a: number; b: unknown; c: unknown };
      const data: Loose[] = [
        { a: 1, b: 5, c: 'x' },
        { a: 2, b: null, c: null },
      ];
      const grid = await mount(data, [
        { key: 'a', type: 'number' },
        { key: 'b', editable: true, allowFormula: true },
        { key: 'c', editable: true, allowFormula: true },
      ] as ColumnConfiguration<Loose>[]);
      const enter = async (rowIndex: number, key: string, text: string) => {
        const editor = await open(grid as never, rowIndex, key);
        await type(editor, text);
        await press(grid as never, editor, 'Enter');
      };
      await enter(0, 'b', '7');
      expect(data[0].b, 'a number cell takes a number').to.equal(7);
      await enter(0, 'b', '0042');
      expect(data[0].b).to.equal(42);
      await enter(0, 'c', '00123');
      expect(data[0].c, 'a text cell keeps the text').to.equal('00123');
      await enter(1, 'b', '7');
      expect(data[1].b, 'an empty cell takes a plain number').to.equal(7);
      await enter(1, 'c', '007');
      expect(data[1].c, 'but keeps text a number would change').to.equal('007');
      data[1].c = null;
      await enter(1, 'c', 'NaN');
      expect(data[1].c, 'NaN is not a plainly written number').to.equal('NaN');
    });
  });

  describe('events and history', () => {
    type Chain = Row & { dbl: number | null };

    it('a formula entry dispatches one cellValueChanged per moved cell', async () => {
      const data: Chain[] = [{ qty: 2, price: 3, total: 0, dbl: 0 }];
      const columns = [
        ...numberColumns(),
        { key: 'dbl', type: 'number', editable: true, allowFormula: true },
      ] as ColumnConfiguration<Chain>[];
      const grid = await mount(data, columns);
      grid.setFormula(data[0], 'total', '=A1*B1');
      grid.setFormula(data[0], 'dbl', '=C1*2');
      await grid.updateComplete;
      const seen: string[] = [];
      grid.addEventListener('cellValueChanged', (event) => {
        const { key, value } = (event as CustomEvent).detail;
        seen.push(`${key}=${value}`);
      });
      const editor = await open(grid as never, 0, 'total');
      await type(editor, '=A1+B1');
      await press(grid as never, editor, 'Enter');
      expect([...seen].sort()).to.eql(['dbl=10', 'total=5']);
      expect(grid.getFormula(data[0], 'total')).to.equal('=A1+B1');
    });

    it('a formula with an error result dispatches one event per cell', async () => {
      const data: Chain[] = [{ qty: 0, price: 3, total: 0, dbl: 0 }];
      const columns = [
        ...numberColumns(),
        { key: 'dbl', type: 'number', editable: true, allowFormula: true },
      ] as ColumnConfiguration<Chain>[];
      const grid = await mount(data, columns);
      grid.setFormula(data[0], 'dbl', '=C1*2');
      await grid.updateComplete;
      const seen: string[] = [];
      grid.addEventListener('cellValueChanged', (event) => {
        const { key, value } = (event as CustomEvent).detail;
        seen.push(`${key}=${String(value)}`);
      });
      const editor = await open(grid as never, 0, 'total');
      await type(editor, '=B1/A1');
      await press(grid as never, editor, 'Enter');
      expect([...seen].sort()).to.eql(['dbl=#DIV/0!', 'total=#DIV/0!']);
    });

    it('a reload drops a step that only changed a formula', async () => {
      const data: Row[] = [{ qty: 2, price: 3, total: 6 }];
      const grid = await mount(data, numberColumns(), {
        enabled: true,
        mode: 'cell',
        history: { enabled: true },
      });
      const editor = await open(grid as never, 0, 'total');
      await type(editor, '=A1*B1');
      await press(grid as never, editor, 'Enter');
      expect(grid.canUndo).to.equal(true);
      grid.data = data.map((row) => ({ ...row }));
      await grid.updateComplete;
      expect(grid.canUndo).to.equal(false);
    });
  });

  describe('a rejected literal keeps the formula', () => {
    it('a validator rejection keeps the formula and the editor usable', async () => {
      const data: Row[] = [{ qty: 2, price: 3, total: 0 }];
      const grid = await mount(data, numberColumns({ validators: [min(0)] as never }));
      grid.setFormula(data[0], 'total', '=A1*B1');
      await grid.updateComplete;
      expect(data[0].total).to.equal(6);

      const editor = await open(grid as never, 0, 'total');
      await type(editor, '-5');
      await press(grid as never, editor, 'Enter');
      expect(grid.getFormula(data[0], 'total'), 'formula kept').to.equal('=A1*B1');
      expect(editorOf(grid as never, 0, 'total'), 'editor still open').to.equal(editor);
      expect(data[0].total).to.equal(6);

      await type(editor, '7');
      await press(grid as never, editor, 'Enter');
      expect(editorOf(grid as never, 0, 'total'), 'corrected literal commits').to.equal(null);
      expect(data[0].total).to.equal(7);
      expect(grid.getFormula(data[0], 'total')).to.equal(undefined);
    });

    it('a cancelled cellValueChanging keeps the formula', async () => {
      const data: Row[] = [{ qty: 2, price: 3, total: 0 }];
      const grid = await mount(data, numberColumns());
      grid.setFormula(data[0], 'total', '=A1*B1');
      await grid.updateComplete;
      grid.addEventListener('cellValueChanging', (event) => event.preventDefault());
      const editor = await open(grid as never, 0, 'total');
      await type(editor, '9');
      await press(grid as never, editor, 'Enter');
      expect(grid.getFormula(data[0], 'total')).to.equal('=A1*B1');
      expect(data[0].total).to.equal(6);
      await press(grid as never, editor, 'Escape');
      expect(grid.getFormula(data[0], 'total'), 'Escape keeps it too').to.equal('=A1*B1');
    });
  });

  describe('row mode stages formulas with the row', () => {
    const rowMode = { enabled: true, mode: 'row' };

    it('a literal typed over a formula survives a cancelled row', async () => {
      const data: Row[] = [{ qty: 5, price: 2, total: 0 }];
      const grid = await mount(data, numberColumns(), rowMode);
      grid.setFormula(data[0], 'total', '=A1*B1');
      await grid.updateComplete;
      const editor = await open(grid as never, 0, 'total');
      await type(editor, '9');
      await press(grid as never, editor, 'Enter');
      expect(editingOf(grid as never).activeRow, 'row still in edit').to.not.equal(null);
      expect(grid.getFormula(data[0], 'total'), 'staged, not applied').to.equal('=A1*B1');
      editingOf(grid as never).cancelRow();
      await grid.updateComplete;
      expect(grid.getFormula(data[0], 'total')).to.equal('=A1*B1');
      expect(data[0].total).to.equal(10);
    });

    it('a formula entered in a cancelled row is dropped', async () => {
      const data: Row[] = [{ qty: 5, price: 2, total: 7 }];
      const grid = await mount(data, numberColumns(), rowMode);
      const editor = await open(grid as never, 0, 'total');
      await type(editor, '=A1*B1');
      await press(grid as never, editor, 'Enter');
      expect(grid.getFormula(data[0], 'total'), 'staged, not applied').to.equal(undefined);
      editingOf(grid as never).cancelRow();
      await grid.updateComplete;
      expect(grid.getFormula(data[0], 'total')).to.equal(undefined);
      expect(data[0].total).to.equal(7);
    });

    it('commitRow applies the staged formula and reopening shows it', async () => {
      const data: Row[] = [{ qty: 5, price: 2, total: 7 }];
      const grid = await mount(data, numberColumns(), rowMode);
      let editor = await open(grid as never, 0, 'total');
      await type(editor, '=A1*B1');
      await press(grid as never, editor, 'Enter');
      editor = await open(grid as never, 0, 'total');
      expect(inputOf(editor).value, 'reopen shows the staged formula').to.equal('=A1*B1');
      await press(grid as never, editor, 'Escape');
      expect(await editingOf(grid as never).commitRow()).to.equal(true);
      await grid.updateComplete;
      expect(grid.getFormula(data[0], 'total')).to.equal('=A1*B1');
      expect(data[0].total).to.equal(10);
      grid.applyEdits([{ row: data[0], column: 'qty', value: 7 }]);
      await grid.updateComplete;
      expect(data[0].total, 'the formula recalculates').to.equal(14);
    });

    it('validators judge a staged formula on the row it commits with', async () => {
      const data: Row[] = [{ qty: 2, price: 3, total: 0 }];
      const grid = await mount(data, numberColumns({ validators: [max(20)] as never }), rowMode);
      const editor = await open(grid as never, 0, 'total');
      await type(editor, '=A1*B1');
      await press(grid as never, editor, 'Enter');
      expect(await editingOf(grid as never).editCell(0, 'qty')).to.equal(true);
      await editingOf(grid as never).commitCell(9);
      expect(await editingOf(grid as never).commitRow(), '9 * 3 is over 20').to.equal(false);
      expect(grid.getFormula(data[0], 'total')).to.equal(undefined);
      expect(data[0].total).to.equal(0);
    });
  });

  describe('formula edits are undoable', () => {
    const history = { enabled: true, mode: 'cell', history: { enabled: true } };

    it('undo removes a formula typed over a literal, redo restores it', async () => {
      const data: Row[] = [{ qty: 2, price: 3, total: 7 }];
      const grid = await mount(data, numberColumns(), history);
      grid.applyEdits([{ row: data[0], column: 'total', value: 8 }]);
      await grid.updateComplete;
      const editor = await open(grid as never, 0, 'total');
      await type(editor, '=A1*B1');
      await press(grid as never, editor, 'Enter');
      expect(data[0].total).to.equal(6);
      expect(grid.getFormula(data[0], 'total')).to.equal('=A1*B1');

      grid.undo();
      await grid.updateComplete;
      expect(data[0].total, 'undo restores the literal').to.equal(8);
      expect(grid.getFormula(data[0], 'total'), 'undo removes the formula').to.equal(undefined);
      expect(grid.canUndo, 'the earlier edit is still undoable').to.equal(true);

      grid.redo();
      await grid.updateComplete;
      expect(grid.getFormula(data[0], 'total')).to.equal('=A1*B1');
      expect(data[0].total).to.equal(6);
    });

    it('undo restores a formula a literal replaced', async () => {
      const data: Row[] = [{ qty: 2, price: 3, total: 0 }];
      const grid = await mount(data, numberColumns(), history);
      grid.setFormula(data[0], 'total', '=A1*B1');
      await grid.updateComplete;
      const editor = await open(grid as never, 0, 'total');
      await type(editor, '9');
      await press(grid as never, editor, 'Enter');
      expect(grid.getFormula(data[0], 'total')).to.equal(undefined);

      grid.undo();
      await grid.updateComplete;
      expect(grid.getFormula(data[0], 'total'), 'formula is back').to.equal('=A1*B1');
      grid.applyEdits([{ row: data[0], column: 'qty', value: 5 }]);
      await grid.updateComplete;
      expect(data[0].total, 'and recalculates').to.equal(15);
    });

    it('a literal equal to the computed value still replaces the formula, undoably', async () => {
      const data: Row[] = [{ qty: 2, price: 3, total: 0 }];
      const grid = await mount(data, numberColumns(), history);
      grid.setFormula(data[0], 'total', '=A1*B1');
      await grid.updateComplete;
      const editor = await open(grid as never, 0, 'total');
      await type(editor, '6');
      await press(grid as never, editor, 'Enter');
      expect(grid.getFormula(data[0], 'total')).to.equal(undefined);
      expect(grid.canUndo).to.equal(true);
      grid.undo();
      await grid.updateComplete;
      expect(grid.getFormula(data[0], 'total')).to.equal('=A1*B1');
    });

    it('a row commit undoes values and formulas as one step', async () => {
      const data: Row[] = [{ qty: 2, price: 3, total: 7 }];
      const grid = await mount(data, numberColumns(), { ...history, mode: 'row' });
      const editor = await open(grid as never, 0, 'total');
      await type(editor, '=A1*B1');
      await press(grid as never, editor, 'Enter');
      await editingOf(grid as never).commitRow();
      await grid.updateComplete;
      expect(data[0].total).to.equal(6);
      grid.undo();
      await grid.updateComplete;
      expect(data[0].total).to.equal(7);
      expect(grid.getFormula(data[0], 'total')).to.equal(undefined);
      expect(grid.canUndo).to.equal(false);
    });
  });
});
