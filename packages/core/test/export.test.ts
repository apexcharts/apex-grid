import { expect, html } from '@open-wc/testing';
import type { ColumnConfiguration } from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

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
});
