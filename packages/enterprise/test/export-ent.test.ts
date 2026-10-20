import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  CONTEXT_MENU_MODULE_ID,
  type ContextMenuController,
  type ContextMenuTarget,
} from '../src/features/context-menu.js';
import {
  FORMULA_MODULE_ID,
  type FormulaController,
  formulaModule,
} from '../src/features/formula/index.js';
import { ApexGridAI, ApexGridChart, ApexGridEnterprise, enterpriseModules } from '../src/index.js';

// Enterprise export and grid API: synthesized rows stay out of exports and
// view charts, formula exports address the file, the XLSX writer encodes the
// sheet in chunks, and the toolbar only offers the panels that are registered.
// `<apex-grid-chart>` and `<apex-grid-ai>` are registered part way through, so
// the tests that need them unregistered run first.

interface Row {
  region: string;
  product: string;
  amount: number;
}

const makeData = (): Row[] => [
  { region: 'EMEA', product: 'A', amount: 10 },
  { region: 'EMEA', product: 'B', amount: 20 },
  { region: 'AMER', product: 'A', amount: 30 },
  { region: 'AMER', product: 'A', amount: 40 },
];

const columns: ColumnConfiguration<Row>[] = [
  { key: 'region' },
  { key: 'product' },
  { key: 'amount' },
];

async function mount(extra: Record<string, unknown> = {}) {
  const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
    .data=${makeData()}
    .columns=${columns}
    .aggregations=${extra.aggregations ?? {}}
    .groupBy=${extra.groupBy ?? []}
    .pivotOn=${extra.pivotOn ?? ''}
    .pivotRows=${extra.pivotRows ?? []}
    .pivotValues=${extra.pivotValues ?? {}}
    .pivotOptions=${extra.pivotOptions ?? {}}
    .totalRow=${extra.totalRow ?? null}
  ></apex-grid-enterprise>`);
  await grid.updateComplete;
  await nextFrame();
  await grid.updateComplete;
  return grid;
}

/** The ids of the default context menu items for the grid's first cell. */
function cellMenuIds(grid: ApexGridEnterprise<Row>): string[] {
  const menu = (
    grid as unknown as { stateController: { module(id: string): ContextMenuController<Row> } }
  ).stateController.module(CONTEXT_MENU_MODULE_ID);
  const target: ContextMenuTarget<Row> = {
    kind: 'cell',
    column: columns[0],
    row: grid.data[0],
    rowIndex: 0,
  };
  const items = typeof menu.items === 'function' ? menu.items(target) : (menu.items ?? []);
  return items.map((item) => item.id);
}

const decoder = new TextDecoder();

/** The stored ZIP entry `filename`, with the CRC-32 its local header declares. */
function storedEntry(bytes: Uint8Array, filename: string): { text: string; crc: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 0;
  while (cursor < bytes.length - 4 && view.getUint32(cursor, true) === 0x04034b50) {
    const nameLen = view.getUint16(cursor + 26, true);
    const extraLen = view.getUint16(cursor + 28, true);
    const dataLen = view.getUint32(cursor + 18, true);
    const name = decoder.decode(bytes.subarray(cursor + 30, cursor + 30 + nameLen));
    const start = cursor + 30 + nameLen + extraLen;
    if (name === filename) {
      const data = bytes.subarray(start, start + dataLen);
      return { text: decoder.decode(data), crc: view.getUint32(cursor + 14, true) };
    }
    cursor = start + dataLen;
  }
  return null;
}

const sheetOf = (bytes: Uint8Array) => storedEntry(bytes, 'xl/worksheets/sheet1.xml')!.text;

function formulaOf<R extends object>(grid: ApexGridEnterprise<R>): FormulaController<R> {
  return (
    grid as unknown as { stateController: { module(id: string): FormulaController<R> } }
  ).stateController.module(FORMULA_MODULE_ID);
}

interface Line {
  qty: number; // A
  price: number; // B
  total: number; // C
}

async function mountFormulas(data: Line[], cols?: ColumnConfiguration<Line>[]) {
  const grid = await fixture<ApexGridEnterprise<Line>>(html`<apex-grid-enterprise
    .data=${data}
    .columns=${
      cols ?? [
        { key: 'qty', type: 'number' },
        { key: 'price', type: 'number' },
        { key: 'total', type: 'number', allowFormula: true },
      ]
    }
  ></apex-grid-enterprise>`);
  await grid.updateComplete;
  await nextFrame();
  return grid;
}

describe('enterprise export and grid API', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules, formulaModule);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  describe('toolbar panels that are not registered', () => {
    it('offers neither Create chart nor Ask AI, and opens nothing', async () => {
      const grid = await mount();
      const ids = grid.toolbarActions.map((action) => action.id);
      expect(ids).to.not.include('create-chart');
      expect(ids).to.not.include('ask-ai');
      expect(grid.renderRoot.querySelector('apex-grid-toolbar')).to.equal(null);
      // A selected range shows no chart button, and Alt+F1 is left to the page.
      grid.selectRange({ row: 0, column: 'region' }, { row: 1, column: 'amount' });
      const button = [...document.body.querySelectorAll('button')].find((el) =>
        el.title.startsWith('Chart the selection')
      );
      expect(button === undefined || button.style.display === 'none').to.equal(true);
      const shortcut = new KeyboardEvent('keydown', { key: 'F1', altKey: true, cancelable: true });
      grid.dispatchEvent(shortcut);
      expect(shortcut.defaultPrevented).to.equal(false);
      expect(document.body.querySelectorAll('apex-grid-chart').length).to.equal(0);
      // The default context menu leaves the Chart range submenu out.
      expect(cellMenuIds(grid)).to.not.include('chart-range');
    });

    it('adds the actions to a mounted grid once the panels are registered', async () => {
      const grid = await mount();
      ApexGridChart.register();
      ApexGridAI.register();
      await customElements.whenDefined('apex-grid-ai');
      await grid.updateComplete;
      const ids = grid.toolbarActions.map((action) => action.id);
      expect(ids).to.include('create-chart');
      expect(ids).to.include('ask-ai');
      expect(grid.renderRoot.querySelector('apex-grid-toolbar')).to.not.equal(null);
      expect(cellMenuIds(grid)).to.include('chart-range');
    });
  });

  describe('Ask AI dialog lifetime', () => {
    it('is removed when its grid is removed', async () => {
      const grid = await mount();
      grid.toolbarActions.find((action) => action.id === 'ask-ai')!.run();
      await nextFrame();
      expect(document.body.querySelector('apex-grid-ai')).to.not.equal(null);
      grid.remove();
      await nextFrame();
      const orphan = document.body.querySelector('apex-grid-ai');
      orphan?.remove();
      expect(orphan).to.equal(null);
    });

    it('stays open across a same-task move of its grid', async () => {
      const grid = await mount();
      grid.toolbarActions.find((action) => action.id === 'ask-ai')!.run();
      await nextFrame();
      const dialog = document.body.querySelector('apex-grid-ai');
      const other = document.createElement('div');
      grid.parentElement!.after(other);
      other.appendChild(grid);
      await nextFrame();
      expect(dialog?.isConnected).to.equal(true);
      // Opening again reuses the same dialog.
      grid.toolbarActions.find((action) => action.id === 'ask-ai')!.run();
      expect(document.body.querySelectorAll('apex-grid-ai').length).to.equal(1);
      grid.remove();
      await nextFrame();
      expect(dialog?.isConnected).to.equal(false);
      other.remove();
    });
  });

  describe('synthesized rows in exports', () => {
    const leaves = 'region,product,amount\r\nEMEA,A,10\r\nEMEA,B,20\r\nAMER,A,30\r\nAMER,A,40';

    it('a grouped grid exports its leaves, collapsed or expanded', async () => {
      const grid = await mount({ groupBy: ['region'] });
      expect(grid.exportToCSV({ filename: '', bom: false })).to.equal(leaves);
      grid.collapseAllGroups();
      await grid.updateComplete;
      expect(grid.exportToCSV({ filename: '', bom: false })).to.equal(leaves);
      const sheet = sheetOf(grid.exportToXLSX({ filename: '' }));
      expect((sheet.match(/<row /g) ?? []).length).to.equal(5);
      expect(sheet).to.include('<c r="C5"><v>40</v></c>');
    });

    it('a grand-total row is not exported', async () => {
      const grid = await mount({ totalRow: { aggregations: { amount: ['sum'] } } });
      expect(grid.exportToCSV({ filename: '', bom: false })).to.equal(leaves);
      const sheet = sheetOf(grid.exportToXLSX({ filename: '' }));
      expect((sheet.match(/<row /g) ?? []).length).to.equal(5);
    });
  });

  describe('view chart model', () => {
    const pivot = {
      pivotOn: 'product',
      pivotRows: ['region'],
      pivotValues: { amount: ['sum'] },
    };

    it('charts the top-level nodes of an expandable pivot by their labels', async () => {
      const grid = await mount({ ...pivot, pivotOptions: { expandable: true, grandTotal: true } });
      const model = grid.getViewChartModel();
      expect(model.categories).to.eql(['EMEA', 'AMER']);
      expect(model.series.map((series) => series.data)).to.eql([
        [10, 70],
        [20, 0],
      ]);
    });

    it('leaves pivot subtotal and grand-total rows out', async () => {
      const grid = await mount({
        ...pivot,
        pivotOptions: { grandTotal: true, subtotals: true },
      });
      const model = grid.getViewChartModel();
      expect(model.categories).to.eql(['EMEA', 'AMER']);
      expect(model.series[0].data).to.eql([10, 70]);
    });

    it('leaves a flat grid total row out', async () => {
      const grid = await mount({ totalRow: { aggregations: { amount: ['sum'] } } });
      const model = grid.getViewChartModel();
      expect(model.categories).to.eql(['EMEA', 'AMER']);
      expect(model.series[0].data).to.eql([30, 70]);
      expect(grid.getChartFields().find((field) => field.key === 'amount')?.numeric).to.equal(true);
    });
  });

  describe('cross-filter model', () => {
    it('detects an untyped numeric column from its values, as the range model does', async () => {
      const grid = await mount();
      grid.selectRange({ row: 0, column: 'region' }, { row: 3, column: 'amount' });
      await grid.updateComplete;
      const range = grid.getRangeChartModel();
      const cross = grid.getCrossFilterModel();
      expect(cross.categoryKey).to.equal('region');
      expect(cross.model.series[0].data).to.eql(range.series[0].data);
      expect(cross.model.series[0].name).to.equal('amount');
    });

    it('does not take an untyped numeric first column as the category', async () => {
      const grid = await mount();
      grid.columns = [{ key: 'amount' }, { key: 'region' }];
      await grid.updateComplete;
      grid.selectRange({ row: 0, column: 'amount' }, { row: 3, column: 'region' });
      expect(grid.getCrossFilterModel().categoryKey).to.equal('region');
    });

    it('takes the first column as the category of an all-numeric range', async () => {
      const grid = await mount();
      grid.selectRange({ row: 0, column: 'amount' }, { row: 3, column: 'amount' });
      const single = grid.getCrossFilterModel();
      expect(single.categoryKey).to.equal('amount');
      expect(single.model.categories).to.eql(['10', '20', '30', '40']);
      expect(single.model.series[0].data).to.eql([1, 1, 1, 1]);
    });
  });

  describe('formula export', () => {
    it('CSV references point at the exported cells under the header row', async () => {
      const data: Line[] = [
        { qty: 2, price: 5, total: 0 },
        { qty: 3, price: 7, total: 0 },
      ];
      const grid = await mountFormulas(data);
      formulaOf(grid).setFormula(data[0], 'total', '=A1*B1');
      formulaOf(grid).setFormula(data[1], 'total', '=SUM($A$1:A2)+C1');
      await grid.updateComplete;
      expect(grid.exportToCSV({ filename: '', bom: false, formulas: true })).to.equal(
        'qty,price,total\r\n2,5,=A2*B2\r\n3,7,=SUM($A$2:A3)+C2'
      );
      expect(
        grid.exportToCSV({ filename: '', bom: false, formulas: true, includeHeader: false })
      ).to.equal('2,5,=A1*B1\r\n3,7,=SUM($A$1:A2)+C1');
    });

    it('CSV references follow sorting and moved columns', async () => {
      const data: Line[] = [
        { qty: 2, price: 5, total: 0 },
        { qty: 3, price: 7, total: 0 },
      ];
      const grid = await mountFormulas(data);
      formulaOf(grid).setFormula(data[0], 'total', '=A1*B1');
      await grid.updateComplete;
      grid.columns = [
        { key: 'price', type: 'number' },
        { key: 'qty', type: 'number' },
        { key: 'total', type: 'number', allowFormula: true },
      ];
      await grid.updateComplete;
      grid.sort({ key: 'qty', direction: 'descending' });
      await grid.updateComplete;
      expect(grid.exportToCSV({ filename: '', bom: false, formulas: true })).to.equal(
        'price,qty,total\r\n7,3,0\r\n5,2,=B3*A3'
      );
    });

    it('a formula that reads a cell outside the export falls back to its value', async () => {
      const data: Line[] = [
        { qty: 2, price: 5, total: 0 },
        { qty: 3, price: 7, total: 0 },
      ];
      const grid = await mountFormulas(data);
      formulaOf(grid).setFormula(data[0], 'total', '=A1*B1');
      formulaOf(grid).setFormula(data[1], 'total', '=SUM(A1:A2)');
      await grid.updateComplete;
      // `price` (B) is not exported, so `=A1*B1` cannot be written.
      expect(
        grid.exportToCSV({ filename: '', bom: false, formulas: true, columns: ['qty', 'total'] })
      ).to.equal('qty,total\r\n2,10\r\n3,=SUM(A2:A3)');
      // Sorted descending, A1:A2 no longer covers consecutive file rows in order.
      grid.sort({ key: 'qty', direction: 'descending' });
      await grid.updateComplete;
      expect(grid.exportToCSV({ filename: '', bom: false, formulas: true })).to.equal(
        'qty,price,total\r\n3,7,5\r\n2,5,=A3*B3'
      );
    });

    it('CSV keeps formula sources raw and escapes other formula-like text', async () => {
      type Note = { note: string; qty: number; total: number };
      const data: Note[] = [{ note: '=HYPERLINK("x")', qty: 4, total: 0 }];
      const grid = await fixture<ApexGridEnterprise<Note>>(html`<apex-grid-enterprise
        .data=${data}
        .columns=${[
          { key: 'note' },
          { key: 'qty', type: 'number' },
          { key: 'total', type: 'number', allowFormula: true },
        ]}
      ></apex-grid-enterprise>`);
      await grid.updateComplete;
      formulaOf(grid).setFormula(data[0], 'total', '=B1*2');
      await grid.updateComplete;
      expect(grid.exportToCSV({ filename: '', bom: false, formulas: true })).to.equal(
        `note,qty,total\r\n"'=HYPERLINK(""x"")",4,=B2*2`
      );
    });

    it('XLSX writes formula cells as formulas with their computed value', async () => {
      const data: Line[] = [
        { qty: 2, price: 5, total: 0 },
        { qty: 3, price: 7, total: 0 },
      ];
      // An untyped column keeps a text result as text.
      const grid = await mountFormulas(data, [
        { key: 'qty', type: 'number' },
        { key: 'price', type: 'number' },
        { key: 'total', allowFormula: true },
      ]);
      formulaOf(grid).setFormula(data[0], 'total', '=A1*B1');
      formulaOf(grid).setFormula(data[1], 'total', '=IF(A2>2,"big","small")');
      await grid.updateComplete;
      const sheet = sheetOf(grid.exportToXLSX({ filename: '', formulas: true }));
      expect(sheet).to.include('<c r="C2"><f>A2*B2</f><v>10</v></c>');
      expect(sheet).to.include(
        '<c r="C3" t="str"><f>IF(A3&gt;2,&quot;big&quot;,&quot;small&quot;)</f><v>big</v></c>'
      );
      // Without the option the computed values are written.
      const plain = sheetOf(grid.exportToXLSX({ filename: '' }));
      expect(plain).to.include('<c r="C2"><v>10</v></c>');
      expect(plain).to.not.include('<f>');
    });

    it('writes the spreadsheet dialect: MOD, AVERAGE and power parentheses', async () => {
      const data: Line[] = [
        { qty: 7, price: 1, total: 0 },
        { qty: 2, price: 2, total: 0 },
        { qty: 3, price: 2, total: 0 },
        { qty: 2, price: 3, total: 0 },
      ];
      const grid = await mountFormulas(data);
      const formulas = formulaOf(grid);
      formulas.setFormula(data[0], 'total', '=A1%3');
      formulas.setFormula(data[1], 'total', '=AVG(A1:A2)');
      formulas.setFormula(data[2], 'total', '=-A3^2');
      formulas.setFormula(data[3], 'total', '=A4^B4^2');
      await grid.updateComplete;
      expect(data.map((row) => row.total)).to.eql([1, 4.5, -9, 512]);
      expect(grid.exportToCSV({ filename: '', bom: false, formulas: true })).to.equal(
        'qty,price,total\r\n7,1,"=MOD(A2,3)"\r\n2,2,=AVERAGE(A2:A3)\r\n3,2,=-(A4^2)\r\n2,3,=A5^(B5^2)'
      );
      const sheet = sheetOf(grid.exportToXLSX({ filename: '', formulas: true }));
      expect(sheet).to.include('<c r="C2"><f>MOD(A2,3)</f><v>1</v></c>');
      expect(sheet).to.include('<c r="C3"><f>AVERAGE(A2:A3)</f><v>4.5</v></c>');
      expect(sheet).to.include('<c r="C4"><f>-(A4^2)</f><v>-9</v></c>');
      expect(sheet).to.include('<c r="C5"><f>A5^(B5^2)</f><v>512</v></c>');
      // The engine reads the dialect back to the same values.
      formulas.setFormula(data[0], 'total', '=MOD(A1,3)');
      formulas.setFormula(data[2], 'total', '=-(A3^2)');
      formulas.setFormula(data[3], 'total', '=A4^(B4^2)');
      expect(data.map((row) => row.total)).to.eql([1, 4.5, -9, 512]);
    });

    it('writes CONCATENATE over a range as CONCAT, which joins ranges', async () => {
      const data: Line[] = [
        { qty: 7, price: 4, total: 0 },
        { qty: 1, price: 2, total: 0 },
      ];
      const grid = await mountFormulas(data);
      const formulas = formulaOf(grid);
      formulas.setFormula(data[0], 'total', '=CONCATENATE(A1:B1)');
      formulas.setFormula(data[1], 'total', '=CONCATENATE(A2,B2)');
      await grid.updateComplete;
      expect(data.map((row) => String(row.total))).to.eql(['74', '12']);
      expect(
        grid.exportToCSV({ filename: '', bom: false, formulas: true, includeHeader: false })
      ).to.equal('7,4,=CONCAT(A1:B1)\r\n1,2,"=CONCATENATE(A2,B2)"');
      const sheet = sheetOf(grid.exportToXLSX({ filename: '', formulas: true }));
      expect(sheet).to.include('<f>CONCAT(A2:B2)</f><v>74</v></c>');
      expect(sheet).to.include('<f>CONCATENATE(A3,B3)</f><v>12</v></c>');
    });

    it('a formula calling a custom function exports its value', async () => {
      const data: Line[] = [{ qty: 2, price: 5, total: 0 }];
      const grid = await mountFormulas(data);
      grid.registerFormulaFunction('DOUBLE', (args) => Number(args[0]) * 2);
      formulaOf(grid).setFormula(data[0], 'total', '=DOUBLE(A1)+SUM(B1)');
      await grid.updateComplete;
      expect(grid.exportToCSV({ filename: '', bom: false, formulas: true })).to.equal(
        'qty,price,total\r\n2,5,9'
      );
      expect(sheetOf(grid.exportToXLSX({ filename: '', formulas: true }))).to.include(
        '<c r="C2"><v>9</v></c>'
      );
    });

    it('XLSX caches a formula error as an error cell', async () => {
      const data: Line[] = [{ qty: 2, price: 0, total: 0 }];
      const grid = await mountFormulas(data, [
        { key: 'qty', type: 'number' },
        { key: 'price', type: 'number' },
        { key: 'total', allowFormula: true },
      ]);
      formulaOf(grid).setFormula(data[0], 'total', '=A1/B1');
      await grid.updateComplete;
      expect(sheetOf(grid.exportToXLSX({ filename: '', formulas: true }))).to.include(
        '<c r="C2" t="e"><f>A2/B2</f><v>#DIV/0!</v></c>'
      );
    });
  });
});
