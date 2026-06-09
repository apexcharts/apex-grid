import { expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { buildXLSX, columnLetter, toExcelSerial } from '../src/features/xlsx.js';
import { ApexGridEnterprise } from '../src/index.js';

type Row = { id: number; name: string; active: boolean };

const data: Row[] = [
  { id: 1, name: 'A', active: false },
  { id: 2, name: 'B', active: true },
];

const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number' },
  { key: 'name', headerText: 'Full Name' },
  { key: 'active', type: 'boolean' },
];

const decoder = new TextDecoder();

/** Reads a stored (uncompressed) entry out of the XLSX/ZIP byte stream. */
function extractStoredFile(bytes: Uint8Array, filename: string): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 0;
  while (cursor < bytes.length - 4) {
    if (view.getUint32(cursor, true) !== 0x04034b50) break;
    const nameLen = view.getUint16(cursor + 26, true);
    const extraLen = view.getUint16(cursor + 28, true);
    const dataLen = view.getUint32(cursor + 18, true);
    const name = decoder.decode(bytes.subarray(cursor + 30, cursor + 30 + nameLen));
    const dataStart = cursor + 30 + nameLen + extraLen;
    if (name === filename) {
      return decoder.decode(bytes.subarray(dataStart, dataStart + dataLen));
    }
    cursor = dataStart + dataLen;
  }
  return null;
}

async function mountGrid() {
  return fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`
  );
}

describe('ApexGridEnterprise — XLSX export', () => {
  before(() => ApexGridEnterprise.register());
  afterEach(() => fixtureCleanup());

  describe('exportToXLSX', () => {
    it('produces bytes with the ZIP signature', async () => {
      const grid = await mountGrid();
      const bytes = grid.exportToXLSX({ filename: '' });
      expect(bytes[0]).to.equal(0x50);
      expect(bytes[1]).to.equal(0x4b);
      expect(bytes[2]).to.equal(0x03);
      expect(bytes[3]).to.equal(0x04);
    });

    it('packages the OOXML parts the spec requires', async () => {
      const grid = await mountGrid();
      const bytes = grid.exportToXLSX({ filename: '' });
      expect(extractStoredFile(bytes, '[Content_Types].xml')).to.not.be.null;
      expect(extractStoredFile(bytes, '_rels/.rels')).to.not.be.null;
      expect(extractStoredFile(bytes, 'xl/workbook.xml')).to.not.be.null;
      expect(extractStoredFile(bytes, 'xl/worksheets/sheet1.xml')).to.not.be.null;
      expect(extractStoredFile(bytes, 'xl/styles.xml')).to.not.be.null;
    });

    it('writes the header labels into the first sheet row', async () => {
      const grid = await mountGrid();
      const bytes = grid.exportToXLSX({ filename: '' });
      const sheet = extractStoredFile(bytes, 'xl/worksheets/sheet1.xml')!;
      expect(sheet).to.include('<t xml:space="preserve">Full Name</t>');
    });

    it('writes numbers as native number cells', async () => {
      const grid = await mountGrid();
      const bytes = grid.exportToXLSX({ filename: '' });
      const sheet = extractStoredFile(bytes, 'xl/worksheets/sheet1.xml')!;
      expect(sheet).to.include('<c r="A2"><v>1</v></c>');
    });

    it('writes booleans as native boolean cells', async () => {
      const grid = await mountGrid();
      const bytes = grid.exportToXLSX({ filename: '' });
      const sheet = extractStoredFile(bytes, 'xl/worksheets/sheet1.xml')!;
      expect(sheet).to.match(/<c r="C2" t="b"><v>0<\/v><\/c>/);
    });

    it('uses the supplied sheet name and sanitizes illegal characters', async () => {
      const grid = await mountGrid();
      const bytes = grid.exportToXLSX({ filename: '', sheetName: 'Bad/Name*[]' });
      const workbook = extractStoredFile(bytes, 'xl/workbook.xml')!;
      expect(workbook).to.include('name="Bad_Name___"');
    });

    it('honours the columns option', async () => {
      const grid = await mountGrid();
      const bytes = grid.exportToXLSX({ filename: '', columns: ['name'] });
      const sheet = extractStoredFile(bytes, 'xl/worksheets/sheet1.xml')!;
      expect(sheet).to.include('<t xml:space="preserve">Full Name</t>');
      expect(sheet).to.not.include('<c r="B1"');
    });
  });

  describe('xlsx primitives', () => {
    it('column letters wrap from Z to AA', () => {
      expect(columnLetter(0)).to.equal('A');
      expect(columnLetter(25)).to.equal('Z');
      expect(columnLetter(26)).to.equal('AA');
      expect(columnLetter(701)).to.equal('ZZ');
      expect(columnLetter(702)).to.equal('AAA');
    });

    it('toExcelSerial maps the well-known 2025-01-01 to 45658', () => {
      const ms = Date.UTC(2025, 0, 1);
      const local = new Date(ms + new Date().getTimezoneOffset() * 60_000);
      expect(toExcelSerial(local)).to.equal(45658);
    });

    it('buildXLSX with an empty sheet still produces a valid archive', () => {
      const bytes = buildXLSX({ headers: [], rows: [] });
      expect(bytes[0]).to.equal(0x50);
      const sheet = extractStoredFile(bytes, 'xl/worksheets/sheet1.xml')!;
      expect(sheet).to.include('<sheetData></sheetData>');
    });
  });

  describe('toolbar export menu', () => {
    function exportMenuItems(grid: ApexGridEnterprise<Row>): HTMLButtonElement[] {
      const toolbar = grid.renderRoot.querySelector('apex-grid-toolbar');
      const root = toolbar?.renderRoot;
      return root
        ? Array.from(root.querySelectorAll<HTMLButtonElement>('[part="export-menu-item"]'))
        : [];
    }

    async function openMenu(grid: ApexGridEnterprise<Row>) {
      const toolbar = grid.renderRoot.querySelector('apex-grid-toolbar')!;
      const trigger =
        toolbar.renderRoot.querySelector<HTMLButtonElement>('[part="export-trigger"]')!;
      trigger.click();
      await (toolbar as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    }

    it('lists both CSV and XLSX entries', async () => {
      const grid = await fixture<ApexGridEnterprise<Row>>(
        html`<apex-grid-enterprise
          show-export
          .data=${data}
          .columns=${columns}
        ></apex-grid-enterprise>`
      );
      await grid.updateComplete;
      await openMenu(grid);
      const items = exportMenuItems(grid);
      expect(items.map((i) => i.textContent?.trim())).to.deep.equal(['Export CSV', 'Export XLSX']);
    });

    it('clicking the XLSX entry calls exportToXLSX', async () => {
      const grid = await fixture<ApexGridEnterprise<Row>>(
        html`<apex-grid-enterprise
          show-export
          .data=${data}
          .columns=${columns}
        ></apex-grid-enterprise>`
      );
      await grid.updateComplete;
      let calls = 0;
      const original = grid.exportToXLSX.bind(grid);
      grid.exportToXLSX = (opts) => {
        calls += 1;
        return original({ ...opts, filename: '' });
      };
      await openMenu(grid);
      exportMenuItems(grid)
        .find((i) => i.textContent?.trim() === 'Export XLSX')!
        .click();
      expect(calls).to.equal(1);
    });
  });
});
