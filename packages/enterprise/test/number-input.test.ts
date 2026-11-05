import { expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
import { sendKeys } from '@web/test-runner-commands';
import type { ColumnConfiguration } from 'apex-grid';
import { coerceText } from '../src/features/formula/coerce.js';
import {
  type AdvancedFilterModel,
  ApexGridEnterprise,
  ApexGridFilterBuilder,
  enterpriseModules,
  filterRows,
} from '../src/index.js';
import { settle } from './settle.js';

// Numbers typed or pasted the way a Japanese user or a spreadsheet writes
// them: full-width digits from an IME, grouping and a currency mark.

describe('typed numbers in enterprise', () => {
  describe('coerceText (paste and formula-editor literals)', () => {
    it('reads full-width, grouped and currency-marked text in a numeric column', () => {
      const number = { type: 'number' };
      expect(coerceText('¥1,200', number, 0)).to.equal(1200);
      expect(coerceText('１，２００', number, 0)).to.equal(1200);
      expect(coerceText('－５', number, 0)).to.equal(-5);
      expect(coerceText('１２３．５', number, 0)).to.equal(123.5);
      expect(coerceText(' 1e3 ', number, 0)).to.equal(1000);
    });

    it("reads the column's locale and currency", () => {
      const euro = { type: 'currency', locale: 'de-DE', currency: 'EUR' };
      expect(coerceText('1.234,50 €', euro, 0)).to.equal(1234.5);
      expect(coerceText('1,5', euro, 0)).to.equal(1.5);
    });

    it('applies the column rules to the parsed number', () => {
      expect(coerceText('４', { type: 'rating', max: 5 }, 0)).to.equal(4);
      expect(coerceText('９', { type: 'rating', max: 5 }, 0), 'clamped').to.equal(5);
      expect(coerceText('５０%', { type: 'progress' }, 0)).to.equal(50);
    });

    it('reads a percent only in a progress column, against its scale', () => {
      expect(coerceText('５０％', { type: 'progress' }, 0)).to.equal(50);
      expect(coerceText('50%', { type: 'progress', max: 1 }, 0)).to.equal(0.5);
      expect(coerceText('12.5 %', { type: 'progress', max: 1 }, 0)).to.equal(0.125);
      // A number or currency column keeps percent text as typed, for validators to judge.
      expect(coerceText('12.5%', { type: 'number' }, 0)).to.equal('12.5%');
      expect(coerceText('50%', { type: 'currency' }, 0)).to.equal('50%');
      expect(coerceText('abc%', { type: 'progress' }, 0)).to.equal('abc%');
    });

    it('does not read superscript or circled digits as a number', () => {
      const number = { type: 'number' };
      expect(coerceText('10²', number, 0)).to.equal('10²');
      expect(coerceText('①', number, 0)).to.equal('①');
    });

    it("reads one paste consistently in a locale that groups with '.'", () => {
      const euro = { type: 'currency', locale: 'de-DE', currency: 'EUR' };
      const pasted = ['1.000', '1.000.000', '1.000 €', '1.5'].map((t) => coerceText(t, euro, 0));
      expect(pasted).to.deep.equal([1000, 1000000, 1000, 1.5]);
      // Without a column locale a plain decimal reads as Number() does.
      expect(coerceText('1.000', { type: 'number' }, 0)).to.equal(1);
    });

    it('keeps text that is not a number as typed, and its old reading otherwise', () => {
      const number = { type: 'number' };
      expect(coerceText('1,0', number, 0)).to.equal('1,0');
      expect(coerceText('abc', number, 0)).to.equal('abc');
      expect(coerceText('0x10', number, 0), 'Number() reads hex').to.equal(16);
      expect(coerceText('', number, 0)).to.equal(null);
      // A text column never reads a number.
      expect(coerceText('１，２００', { type: 'string' }, 'x')).to.equal('１，２００');
    });
  });

  describe('advanced filter', () => {
    interface Row {
      amount: number;
      price: number;
    }
    const columns: ColumnConfiguration<Row>[] = [
      { key: 'amount', type: 'number' },
      { key: 'price', type: 'currency', currency: 'EUR', locale: 'de-DE' },
    ];
    const data: Row[] = [
      { amount: 150, price: 1.5 },
      { amount: 1200, price: 1234.5 },
      { amount: 5000, price: 20 },
    ];
    const where = (column: string, operator: string, value: string): AdvancedFilterModel => ({
      kind: 'group',
      join: 'and',
      children: [{ kind: 'condition', column, operator, value }],
    });

    it('compares against a full-width or grouped term', () => {
      const amounts = (value: string) =>
        filterRows(data, where('amount', 'greaterThan', value), columns).map((r) => r.amount);
      expect(amounts('１，０００')).to.eql([1200, 5000]);
      expect(amounts('1,000')).to.eql([1200, 5000]);
      expect(amounts('¥1,200')).to.eql([5000]);
      expect(amounts('150')).to.eql([1200, 5000]);
    });

    it("reads a term in the column's locale", () => {
      const prices = filterRows(data, where('price', 'equals', '1.234,5'), columns);
      expect(prices.map((r) => r.price)).to.eql([1234.5]);
    });

    it("the builder hands the term to the column's locale as typed", async () => {
      ApexGridEnterprise.use(...enterpriseModules);
      ApexGridEnterprise.register();
      ApexGridFilterBuilder.register();
      try {
        const grid = await fixture<ApexGridEnterprise<Row>>(
          html`<apex-grid-enterprise .columns=${columns} .data=${[...data]}></apex-grid-enterprise>`
        );
        const builder = await fixture<ApexGridFilterBuilder>(
          html`<apex-grid-filter-builder .grid=${grid as never}></apex-grid-filter-builder>`
        );
        builder.model = where('price', 'equals', '');
        await builder.updateComplete;
        const input = builder.renderRoot.querySelector<HTMLInputElement>('input[part="val"]')!;
        input.focus();
        await sendKeys({ type: '1.234,5' });
        expect(input.value, 'not sanitized by a number input').to.equal('1.234,5');
        builder.renderRoot.querySelector<HTMLButtonElement>('[part="apply"]')!.click();
        await settle(grid as never);
        expect((grid.dataView as Row[]).map((r) => r.price)).to.eql([1234.5]);
      } finally {
        fixtureCleanup();
      }
    });
  });

  describe('range paste', () => {
    interface Sale {
      name: string;
      amount: number | string | null;
    }

    before(() => {
      ApexGridEnterprise.use(...enterpriseModules);
      ApexGridEnterprise.register();
    });
    afterEach(() => fixtureCleanup());

    async function mount(data: Sale[]) {
      const parent = document.createElement('div');
      parent.style.height = '400px';
      const grid = await fixture<ApexGridEnterprise<Sale>>(
        html`<apex-grid-enterprise
          .data=${data}
          .columns=${[
            { key: 'name', type: 'string', editable: true },
            { key: 'amount', type: 'number', editable: true },
          ]}
          .editing=${{ enabled: true }}
        ></apex-grid-enterprise>`,
        { parentNode: parent }
      );
      await settle(grid);
      return grid;
    }

    it('stores ¥1,200 and １，２００ pasted into a numeric column as 1200', async () => {
      const data: Sale[] = [
        { name: 'a', amount: 0 },
        { name: 'b', amount: 0 },
        { name: 'c', amount: 0 },
      ];
      const grid = await mount(data);
      grid.selectRange({ row: 0, column: 'amount' });
      grid.pasteText('¥1,200\n１，２００\n"1,234,567.5"');
      expect(data.map((r) => r.amount)).to.eql([1200, 1200, 1234567.5]);
    });
  });
});
