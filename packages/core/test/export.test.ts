import { expect, html } from '@open-wc/testing';
import type { ColumnConfiguration } from '../src/internal/types.js';
import { buildXLSX, columnLetter, toExcelSerial } from '../src/internal/xlsx.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

const decoder = new TextDecoder();

class ExportFixture extends GridTestFixture<TestData> {
  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number' },
      { key: 'name', headerText: 'Full Name' },
      { key: 'active', type: 'boolean' },
      { key: 'importance', type: 'select', options: ['low', 'medium', 'high'] },
    ] as ColumnConfiguration<TestData>[];
  }

  public override setupTemplate() {
    return html`<apex-grid .data=${this.data} .columns=${this.columnConfig}></apex-grid>`;
  }
}

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

describe('Grid export', () => {
  let fx: ExportFixture;

  beforeEach(async () => {
    fx = new ExportFixture(JSON.parse(JSON.stringify(data)));
    await fx.setUp();
  });

  afterEach(() => fx.tearDown());

  describe('CSV', () => {
    it('emits a header row followed by data rows', () => {
      const csv = fx.grid.exportToCSV({ filename: '' });
      const lines = csv.replace(/^﻿/, '').split('\r\n');
      expect(lines[0]).to.equal('id,Full Name,active,importance');
      expect(lines[1]).to.equal('1,A,false,medium');
      expect(lines).to.have.length(1 + data.length);
    });

    it('prepends a UTF-8 BOM by default and skips it when requested', () => {
      const withBom = fx.grid.exportToCSV({ filename: '' });
      expect(withBom.charCodeAt(0)).to.equal(0xfeff);
      const withoutBom = fx.grid.exportToCSV({ filename: '', bom: false });
      expect(withoutBom.charCodeAt(0)).to.not.equal(0xfeff);
    });

    it('respects a custom delimiter', () => {
      const csv = fx.grid.exportToCSV({ filename: '', delimiter: ';', bom: false });
      expect(csv.split('\r\n')[0]).to.equal('id;Full Name;active;importance');
    });

    it('escapes quotes, delimiters and newlines per RFC 4180', async () => {
      fx.grid.data = [{ id: 9, name: 'O"Hara, Jr.\nbacon', active: true, importance: 'low' }];
      await fx.waitForUpdate();
      const csv = fx.grid.exportToCSV({ filename: '', bom: false });
      const rest = csv.split('\r\n').slice(1).join('\r\n');
      expect(rest).to.equal('9,"O""Hara, Jr.\nbacon",true,low');
    });

    it('omits columns flagged exportable: false', async () => {
      fx.columnConfig[0].exportable = false;
      fx.grid.columns = [...fx.columnConfig];
      await fx.waitForUpdate();
      const csv = fx.grid.exportToCSV({ filename: '', bom: false });
      const header = csv.split('\r\n')[0];
      expect(header).to.equal('Full Name,active,importance');
    });

    it('restricts to the supplied column keys', () => {
      const csv = fx.grid.exportToCSV({ filename: '', bom: false, columns: ['name', 'active'] });
      const header = csv.split('\r\n')[0];
      expect(header).to.equal('Full Name,active');
    });

    it('exports only the current selection when source: selected', async () => {
      fx.grid.selection = { enabled: true, mode: 'multiple' };
      await fx.waitForUpdate();
      await fx.grid.selectRow(fx.grid.data[1]);
      await fx.grid.selectRow(fx.grid.data[3]);
      const csv = fx.grid.exportToCSV({ filename: '', bom: false, source: 'selected' });
      const lines = csv.split('\r\n');
      expect(lines).to.have.length(3);
      expect(lines[1].split(',')[0]).to.equal('2');
      expect(lines[2].split(',')[0]).to.equal('4');
    });

    it('uses the post-sort dataView by default', async () => {
      await fx.sort({ key: 'name', direction: 'descending' });
      const csv = fx.grid.exportToCSV({ filename: '', bom: false });
      const lines = csv.split('\r\n').slice(1);
      const firstName = lines[0].split(',')[1];
      const lastName = lines[lines.length - 1].split(',')[1];
      expect(firstName.toLowerCase()).to.equal('d');
      expect(lastName.toLowerCase()).to.equal('a');
    });

    it('routes raw input through a user-supplied formatter', () => {
      const csv = fx.grid.exportToCSV({
        filename: '',
        bom: false,
        formatter: (column, value) =>
          column.key === 'active' ? (value ? 'YES' : 'NO') : (value as string),
      });
      const activeIdx = 2;
      const row = csv.split('\r\n')[1].split(',');
      expect(row[activeIdx]).to.equal('NO');
    });

    it('drops the header row when includeHeader: false', () => {
      const csv = fx.grid.exportToCSV({ filename: '', bom: false, includeHeader: false });
      expect(csv.split('\r\n')).to.have.length(data.length);
    });

    it('resolves select option labels when present', async () => {
      fx.columnConfig = [
        { key: 'id', type: 'number' },
        {
          key: 'importance',
          type: 'select',
          options: [
            { value: 'low', label: 'Low priority' },
            { value: 'medium', label: 'Medium priority' },
            { value: 'high', label: 'High priority' },
          ],
        },
      ] as ColumnConfiguration<TestData>[];
      fx.grid.columns = fx.columnConfig;
      await fx.waitForUpdate();
      const csv = fx.grid.exportToCSV({ filename: '', bom: false });
      const lines = csv.split('\r\n');
      expect(lines[1]).to.equal('1,Medium priority');
    });
  });

  describe('XLSX', () => {
    it('produces bytes with the ZIP signature', () => {
      const bytes = fx.grid.exportToXLSX({ filename: '' });
      expect(bytes[0]).to.equal(0x50);
      expect(bytes[1]).to.equal(0x4b);
      expect(bytes[2]).to.equal(0x03);
      expect(bytes[3]).to.equal(0x04);
    });

    it('packages the OOXML parts the spec requires', () => {
      const bytes = fx.grid.exportToXLSX({ filename: '' });
      expect(extractStoredFile(bytes, '[Content_Types].xml')).to.not.be.null;
      expect(extractStoredFile(bytes, '_rels/.rels')).to.not.be.null;
      expect(extractStoredFile(bytes, 'xl/workbook.xml')).to.not.be.null;
      expect(extractStoredFile(bytes, 'xl/worksheets/sheet1.xml')).to.not.be.null;
      expect(extractStoredFile(bytes, 'xl/styles.xml')).to.not.be.null;
    });

    it('writes the header labels into the first sheet row', () => {
      const bytes = fx.grid.exportToXLSX({ filename: '' });
      const sheet = extractStoredFile(bytes, 'xl/worksheets/sheet1.xml')!;
      expect(sheet).to.include('<t xml:space="preserve">Full Name</t>');
      expect(sheet).to.include('<t xml:space="preserve">importance</t>');
    });

    it('writes numbers as native number cells', () => {
      const bytes = fx.grid.exportToXLSX({ filename: '' });
      const sheet = extractStoredFile(bytes, 'xl/worksheets/sheet1.xml')!;
      expect(sheet).to.include('<c r="A2"><v>1</v></c>');
    });

    it('writes booleans as native boolean cells', () => {
      const bytes = fx.grid.exportToXLSX({ filename: '' });
      const sheet = extractStoredFile(bytes, 'xl/worksheets/sheet1.xml')!;
      expect(sheet).to.match(/<c r="C2" t="b"><v>0<\/v><\/c>/);
    });

    it('uses the supplied sheet name and sanitizes illegal characters', () => {
      const bytes = fx.grid.exportToXLSX({ filename: '', sheetName: 'Bad/Name*[]' });
      const workbook = extractStoredFile(bytes, 'xl/workbook.xml')!;
      expect(workbook).to.include('name="Bad_Name___"');
    });

    it('honours exportable: false and columns option', async () => {
      fx.columnConfig[0].exportable = false;
      fx.grid.columns = [...fx.columnConfig];
      await fx.waitForUpdate();
      const bytes = fx.grid.exportToXLSX({ filename: '', columns: ['name', 'active'] });
      const sheet = extractStoredFile(bytes, 'xl/worksheets/sheet1.xml')!;
      expect(sheet).to.include('<t xml:space="preserve">Full Name</t>');
      expect(sheet).to.not.include('<t xml:space="preserve">importance</t>');
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
});
