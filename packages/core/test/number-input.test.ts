import { expect, html } from '@open-wc/testing';
import { sendKeys } from '@web/test-runner-commands';
import type ApexGridCell from '../src/components/cell.js';
import { parseLocaleNumberInput, parseNumberInput } from '../src/internal/number-input.js';
import type { ColumnConfiguration, GridEditingConfiguration } from '../src/internal/types.js';
import { max } from '../src/internal/validators.js';
import GridTestFixture from './utils/grid-fixture.js';

describe('parseNumberInput', () => {
  const cases: Array<[raw: string, expected: number, locale?: string, currency?: string]> = [
    // Plain ASCII reads exactly as Number() does.
    ['-5', -5],
    ['.5', 0.5],
    ['1.', 1],
    ['+7', 7],
    ['1e3', 1000],
    ['1E-2', 0.01],
    ['  42  ', 42],
    // Full-width digits, signs and separators from an IME in full-width mode.
    ['１２３', 123],
    ['－５', -5],
    ['＋５', 5],
    ['１．５', 1.5],
    ['１，２００．５', 1200.5],
    ['１ｅ３', 1000],
    ['１２３　', 123],
    // The minus sign and the kana-mode long vowel mark read as minus.
    ['−5', -5],
    ['ー５', -5],
    // Grouping only where it forms valid groups.
    ['1,000', 1000],
    ['1,234,567.25', 1234567.25],
    ['1,0', Number.NaN],
    ['1,00', Number.NaN],
    ['1,000,', Number.NaN],
    // Currency marks.
    ['¥1,200', 1200],
    ['￥１，２００', 1200],
    ['-¥1,200', -1200],
    ['¥-1,200', -1200],
    ['$ 1,200.50', 1200.5],
    ['€5', 5],
    ['1,200円', 1200],
    // The locale's separators.
    ['1,5', 1.5, 'de-DE'],
    ['1.234,5', 1234.5, 'de-DE'],
    ['1.234.567', 1234567, 'de-DE'],
    [',5', 0.5, 'de-DE'],
    ['1 234,5', 1234.5, 'fr-FR'],
    ['1 234,5', 1234.5, 'fr-FR'],
    ['12,34,567', 1234567, 'en-IN'],
    ['1,234,567', 1234567, 'en-IN'],
    ['1.200 €', 1200, 'de-DE', 'EUR'],
    ['$1.5', 1.5, 'de-DE'],
    ['US$1,200', 1200, 'en-CA', 'USD'],
    ['£1,200', 1200, 'en-GB', 'GBP'],
    // A plain ASCII decimal keeps its plain reading in every locale.
    ['1.5', 1.5, 'de-DE'],
    // Not numbers.
    ['', Number.NaN],
    ['   ', Number.NaN],
    ['abc', Number.NaN],
    ['-', Number.NaN],
    ['.', Number.NaN],
    ['%', Number.NaN],
    ['¥', Number.NaN],
    ['12abc', Number.NaN],
    ['--5', Number.NaN],
    // A percent depends on the column's scale, so the caller reads it.
    ['50%', Number.NaN],
    ['１２．５％', Number.NaN],
    // Only what an IME types folds: these are not digits someone typed.
    ['10²', Number.NaN],
    ['①', Number.NaN],
    ['㉑', Number.NaN],
    ['１₂', Number.NaN],
    // Forms Number() reads but a person does not type: left to the caller.
    ['0x10', Number.NaN],
    ['Infinity', Number.NaN],
  ];

  for (const [raw, expected, locale, currency] of cases) {
    const label = `${JSON.stringify(raw)}${locale ? ` in ${locale}` : ''}${currency ? ` (${currency})` : ''}`;
    it(`reads ${label} as ${expected}`, () => {
      const actual = parseNumberInput(raw, locale, currency);
      if (Number.isNaN(expected)) expect(actual).to.be.NaN;
      else expect(actual).to.equal(expected);
    });
  }

  it('keeps a no-break or narrow no-break space as a grouping space', () => {
    expect(parseNumberInput('1\u00a0234,5', 'fr-FR')).to.equal(1234.5);
    expect(parseNumberInput('1\u202f234,5', 'fr-FR')).to.equal(1234.5);
  });

  it('falls back to the runtime locale for a malformed locale tag or currency code', () => {
    expect(parseNumberInput('1,200', 'not a locale')).to.equal(1200);
    expect(parseNumberInput('¥1,200', undefined, 'not a code')).to.equal(1200);
  });
});

describe('parseLocaleNumberInput', () => {
  it("prefers the locale's grouping over a plain decimal", () => {
    expect(parseLocaleNumberInput('1.000', 'de-DE')).to.equal(1000);
    expect(parseLocaleNumberInput('-1.000', 'de-DE')).to.equal(-1000);
    expect(parseLocaleNumberInput('1.000.000', 'de-DE')).to.equal(1000000);
    expect(parseLocaleNumberInput('1.000 €', 'de-DE', 'EUR')).to.equal(1000);
    expect(parseNumberInput('1.000', 'de-DE'), 'the plain reading stays').to.equal(1);
  });

  it('reads text that is not valid grouping as a plain decimal', () => {
    expect(parseLocaleNumberInput('1.5', 'de-DE')).to.equal(1.5);
    expect(parseLocaleNumberInput('1.0000', 'de-DE')).to.equal(1);
    expect(parseLocaleNumberInput('.5', 'de-DE')).to.equal(0.5);
    expect(parseLocaleNumberInput('1e3', 'de-DE')).to.equal(1000);
    expect(parseLocaleNumberInput('1,5', 'de-DE')).to.equal(1.5);
  });

  it('reads as parseNumberInput where the locale groups with another character', () => {
    for (const raw of ['1.000', '1.5', '-5', '.5', '1e3', '1,000', '1,234.5']) {
      expect(parseLocaleNumberInput(raw, 'en-US'), raw).to.equal(parseNumberInput(raw, 'en-US'));
      expect(parseLocaleNumberInput(raw), raw).to.equal(parseNumberInput(raw));
    }
  });
});

interface Sale {
  id: number;
  name: string;
  amount: number;
  price: number;
}

const SALES: Sale[] = [
  { id: 1, name: 'a', amount: 1, price: 1.5 },
  { id: 2, name: 'b', amount: 123, price: 15 },
  { id: 3, name: 'c', amount: 1000, price: 1234.5 },
  { id: 4, name: 'd', amount: 1200, price: 2 },
  { id: 5, name: 'e', amount: -5, price: 0 },
];

class SalesFixture extends GridTestFixture<Sale> {
  public editing: GridEditingConfiguration = { enabled: true, mode: 'cell' };

  public override updateConfig(): void {
    this.columnConfig = [
      { key: 'id', type: 'number' },
      { key: 'name', editable: true, validators: [max(100)] },
      { key: 'amount', type: 'number', filter: true, editable: true },
      { key: 'price', type: 'currency', currency: 'EUR', locale: 'de-DE', filter: true },
    ] as ColumnConfiguration<Sale>[];
  }

  public override async setUp() {
    this.data = SALES.map((row) => ({ ...row }));
    await super.setUp();
  }

  public override setupTemplate() {
    return html`<apex-grid
      .data=${this.data}
      .columns=${this.columnConfig}
      .editing=${this.editing}
    ></apex-grid>`;
  }

  /** Opens the filter panel on `key`. */
  public async openFilter(key: keyof Sale) {
    this.filterRow.open(key as never);
    await this.waitForUpdate();
  }

  /** Types `text` into the open filter panel as one input. */
  public async type(text: string) {
    this.filterRow.fireInputEvent(text);
    await this.waitForUpdate();
  }

  public get terms() {
    return this.grid.filterExpressions.map((e) => e.searchTerm);
  }

  public cell(rowIndex: number, key: keyof Sale): ApexGridCell<Sale> {
    return this.rows.get(rowIndex).cells.get(key as never).element as ApexGridCell<Sale>;
  }

  public async open(rowIndex: number, key: keyof Sale): Promise<HTMLInputElement> {
    await this.grid.editCell(rowIndex, key);
    await this.waitForUpdate();
    const input = this.cell(rowIndex, key).shadowRoot!.querySelector<HTMLInputElement>(
      'input[data-apex-editor]'
    )!;
    input.focus();
    input.select();
    return input;
  }
}

const F = new SalesFixture(SALES);

describe('Numeric entry points', () => {
  beforeEach(async () => await F.setUp());
  afterEach(() => F.tearDown());

  describe('filter row', () => {
    it('reads full-width digits typed with an IME', async () => {
      await F.openFilter('amount');
      await F.type('１２３');
      expect(F.terms).to.deep.equal([123]);
      expect(F.dataState.map((r) => r.id)).to.deep.equal([2]);
    });

    it('reads the full-width number a composition ends with', async () => {
      await F.openFilter('amount');
      const input = F.filterRow.input;
      input.dispatchEvent(
        new CompositionEvent('compositionstart', { bubbles: true, composed: true })
      );
      input.value = '１２３';
      input.dispatchEvent(
        new InputEvent('input', { bubbles: true, composed: true, isComposing: true })
      );
      await F.waitForUpdate();
      expect(F.terms, 'nothing applied mid-composition').to.deep.equal([]);
      input.dispatchEvent(
        new CompositionEvent('compositionend', { bubbles: true, composed: true, data: '１２３' })
      );
      await F.waitForUpdate();
      expect(F.terms).to.deep.equal([123]);
    });

    it('reads a grouped number as the whole number, not its first group', async () => {
      await F.openFilter('amount');
      await F.type('1,000');
      expect(F.terms).to.deep.equal([1000]);
      expect(F.dataState.map((r) => r.id)).to.deep.equal([3]);
    });

    it('reads full-width grouping and a currency mark', async () => {
      await F.openFilter('amount');
      await F.type('￥１，２００');
      expect(F.terms).to.deep.equal([1200]);
      await F.type('－５');
      expect(F.terms).to.deep.equal([-5]);
    });

    it("reads the column's locale separators", async () => {
      await F.openFilter('price');
      await F.type('1.234,5');
      expect(F.terms).to.deep.equal([1234.5]);
      await F.type('1,5 €');
      expect(F.terms).to.deep.equal([1.5]);
    });

    it('keeps the old reading of text the parser does not take', async () => {
      // A group still being typed filters by its first digits, as before.
      await F.openFilter('amount');
      await F.type('1,0');
      expect(F.terms).to.deep.equal([1]);
      await F.type('12abc');
      expect(F.terms).to.deep.equal([12]);
      await F.type('0x10');
      expect(F.terms).to.deep.equal([0]);
    });

    describe('typed one key at a time', () => {
      /** Types `text` into the open panel's input through real key presses. */
      async function typeKeys(text: string) {
        const input = F.filterRow.input;
        input.focus();
        for (const key of text) {
          await sendKeys({ type: key });
          await F.waitForUpdate();
        }
        return input;
      }

      it('keeps the separators of a grouped decimal in the column locale', async () => {
        await F.openFilter('price');
        const input = await typeKeys('1.234,5');
        expect(input.value, 'the typed text stays as typed').to.equal('1.234,5');
        expect(F.terms).to.deep.equal([1234.5]);
      });

      it('keeps every group of a grouped whole number', async () => {
        await F.openFilter('amount');
        const input = await typeKeys('1,234,567');
        expect(input.value).to.equal('1,234,567');
        expect(F.terms).to.deep.equal([1234567]);
      });

      it('keeps a currency mark typed first', async () => {
        await F.openFilter('amount');
        const input = await typeKeys('$1,000');
        expect(input.value).to.equal('$1,000');
        expect(F.terms).to.deep.equal([1000]);
      });

      it('still shows a term set other than by typing', async () => {
        await F.openFilter('amount');
        const input = await typeKeys('1,000');
        expect(input.value).to.equal('1,000');
        // Enter commits the chip and clears the box for the next term.
        await sendKeys({ press: 'Enter' });
        await F.waitForUpdate();
        expect(F.filterRow.input.value).to.equal('');
        // Selecting the chip again shows its term.
        F.filterRow.activeStateChips[0].querySelector<HTMLElement>('[part="chip-body"]')!.click();
        await F.waitForUpdate();
        expect(F.filterRow.input.value).to.equal('1000');
      });
    });
  });

  describe('number cell editor', () => {
    // Chromium, Firefox and WebKit all fold full-width digits, `－` and `．`
    // into an `<input type="number">` as they are inserted, so the editor
    // stays a number input (keeping its arrow-key stepping).
    it('commits full-width digits inserted by an IME as a number', async () => {
      const input = await F.open(1, 'amount');
      expect(input.type).to.equal('number');
      await sendKeys({ type: '－１２３．５' });
      expect(input.value).to.equal('-123.5');
      await sendKeys({ press: 'Enter' });
      await F.waitForUpdate();
      expect(F.grid.data[1].amount).to.equal(-123.5);
    });
  });

  describe('validators', () => {
    it('fail full-width text above the limit instead of letting it through', async () => {
      let failed = 0;
      F.grid.addEventListener('cellValidationFailed', () => failed++);
      await F.open(0, 'name');
      await sendKeys({ type: '１２３' });
      await sendKeys({ press: 'Enter' });
      await F.waitForUpdate();
      expect(failed).to.equal(1);
      expect(F.grid.data[0].name).to.equal('a');
    });
  });
});
