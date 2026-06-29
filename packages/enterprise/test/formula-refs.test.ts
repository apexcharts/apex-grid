import { expect } from '@open-wc/testing';
import {
  buildColumnLetters,
  type CellAddress,
  columnLetterToIndex,
  formatA1,
  formatCell,
  indexToColumnLetter,
  isRangeAddress,
  normalizeRange,
  offsetAddress,
  ParseError,
  parseA1,
  parseCellRef,
  type RangeAddress,
  rangeCells,
} from '../src/features/formula/index.js';

describe('formula reference model (F2)', () => {
  describe('column letters <-> index (bijective base-26)', () => {
    it('maps the first 26 letters', () => {
      expect(columnLetterToIndex('A')).to.equal(0);
      expect(columnLetterToIndex('B')).to.equal(1);
      expect(columnLetterToIndex('Z')).to.equal(25);
    });

    it('wraps past Z into multi-letter columns', () => {
      expect(columnLetterToIndex('AA')).to.equal(26);
      expect(columnLetterToIndex('AB')).to.equal(27);
      expect(columnLetterToIndex('BA')).to.equal(52);
    });

    it('is case-insensitive', () => {
      expect(columnLetterToIndex('aa')).to.equal(26);
    });

    it('round-trips index -> letter -> index', () => {
      for (const index of [0, 1, 25, 26, 27, 51, 52, 701, 702]) {
        expect(columnLetterToIndex(indexToColumnLetter(index))).to.equal(index);
      }
    });

    it('produces the expected letters', () => {
      expect(indexToColumnLetter(0)).to.equal('A');
      expect(indexToColumnLetter(25)).to.equal('Z');
      expect(indexToColumnLetter(26)).to.equal('AA');
      expect(indexToColumnLetter(701)).to.equal('ZZ');
    });
  });

  describe('parseA1', () => {
    it('parses a single cell to a 0-based address', () => {
      expect(parseA1('A1')).to.deep.equal({ row: 0, col: 0 });
      expect(parseA1('B2')).to.deep.equal({ row: 1, col: 1 });
      expect(parseA1('C10')).to.deep.equal({ row: 9, col: 2 });
    });

    it('is case-insensitive', () => {
      expect(parseA1('b2')).to.deep.equal({ row: 1, col: 1 });
    });

    it('parses a range', () => {
      expect(parseA1('A1:C3')).to.deep.equal({
        start: { row: 0, col: 0 },
        end: { row: 2, col: 2 },
      });
    });

    it('rejects malformed input with a ParseError', () => {
      expect(() => parseA1('A')).to.throw(ParseError);
      expect(() => parseA1('1A')).to.throw(ParseError);
      expect(() => parseA1('A0')).to.throw(ParseError); // rows are 1-based
    });

    it('records the position of the offending text', () => {
      try {
        parseA1('A1:bad', 0);
        expect.fail('expected a ParseError');
      } catch (error) {
        expect(error).to.be.instanceOf(ParseError);
        // 'bad' starts after 'A1:' (3 chars).
        expect((error as ParseError).position).to.equal(3);
      }
    });
  });

  describe('formatA1', () => {
    it('formats cells and ranges', () => {
      expect(formatA1({ row: 0, col: 0 })).to.equal('A1');
      expect(formatA1({ row: 9, col: 2 })).to.equal('C10');
      expect(formatA1({ start: { row: 0, col: 0 }, end: { row: 2, col: 2 } })).to.equal('A1:C3');
    });

    it('round-trips parse -> format', () => {
      for (const token of ['A1', 'Z9', 'AA100', 'B2:D8']) {
        expect(formatA1(parseA1(token))).to.equal(token);
      }
    });
  });

  describe('ranges', () => {
    it('isRangeAddress distinguishes cells from ranges', () => {
      expect(isRangeAddress(parseA1('A1'))).to.be.false;
      expect(isRangeAddress(parseA1('A1:B2'))).to.be.true;
    });

    it('normalizes reversed corners', () => {
      const reversed: RangeAddress = { start: { row: 2, col: 2 }, end: { row: 0, col: 0 } };
      expect(normalizeRange(reversed)).to.deep.equal({
        start: { row: 0, col: 0 },
        end: { row: 2, col: 2 },
      });
    });

    it('enumerates cells in row-major order', () => {
      const cells = rangeCells({ start: { row: 0, col: 0 }, end: { row: 1, col: 1 } });
      expect(cells).to.deep.equal([
        { row: 0, col: 0 },
        { row: 0, col: 1 },
        { row: 1, col: 0 },
        { row: 1, col: 1 },
      ] satisfies CellAddress[]);
    });
  });

  describe('relative / absolute references (Tier 2)', () => {
    it('parseCellRef resolves the address plus per-axis $ flags', () => {
      expect(parseCellRef('A1')).to.deep.equal({
        address: { row: 0, col: 0 },
        colAbsolute: false,
        rowAbsolute: false,
      });
      expect(parseCellRef('$A$1')).to.deep.equal({
        address: { row: 0, col: 0 },
        colAbsolute: true,
        rowAbsolute: true,
      });
      expect(parseCellRef('$A1')).to.deep.equal({
        address: { row: 0, col: 0 },
        colAbsolute: true,
        rowAbsolute: false,
      });
      expect(parseCellRef('A$1')).to.deep.equal({
        address: { row: 0, col: 0 },
        colAbsolute: false,
        rowAbsolute: true,
      });
    });

    it('formatCell emits $ only for the axes marked absolute', () => {
      const address: CellAddress = { row: 1, col: 2 }; // C2
      expect(formatCell(address)).to.equal('C2');
      expect(formatCell(address, { colAbsolute: true, rowAbsolute: true })).to.equal('$C$2');
      expect(formatCell(address, { colAbsolute: true })).to.equal('$C2');
      expect(formatCell(address, { rowAbsolute: true })).to.equal('C$2');
    });

    it('round-trips parseCellRef -> formatCell preserving markers', () => {
      for (const token of ['A1', '$A$1', '$A1', 'A$1', '$Z$9', 'AA$100']) {
        const ref = parseCellRef(token);
        expect(formatCell(ref.address, ref)).to.equal(token);
      }
    });

    it('offsetAddress shifts only the relative axes', () => {
      const a1: CellAddress = { row: 0, col: 0 };
      expect(offsetAddress(a1, 2, 3)).to.deep.equal({ row: 2, col: 3 });
      expect(offsetAddress(a1, 2, 3, { rowAbsolute: true })).to.deep.equal({ row: 0, col: 3 });
      expect(offsetAddress(a1, 2, 3, { colAbsolute: true })).to.deep.equal({ row: 2, col: 0 });
      expect(offsetAddress(a1, 2, 3, { colAbsolute: true, rowAbsolute: true })).to.deep.equal({
        row: 0,
        col: 0,
      });
    });

    it('offsetAddress clamps at 0 instead of producing a negative index', () => {
      expect(offsetAddress({ row: 1, col: 1 }, -5, -5)).to.deep.equal({ row: 0, col: 0 });
    });

    it('parseA1 / formatA1 stay relative (no markers) for back-compat', () => {
      expect(formatCell({ row: 0, col: 0 })).to.equal('A1');
      expect(formatA1(parseA1('B2'))).to.equal('B2');
    });
  });

  describe('buildColumnLetters', () => {
    const columns = [{ key: 'id' }, { key: 'qty' }, { key: 'price' }];

    it('assigns letters by configuration order', () => {
      const { toLetter, toKey } = buildColumnLetters(columns);
      expect(toLetter.get('id')).to.equal('A');
      expect(toLetter.get('qty')).to.equal('B');
      expect(toLetter.get('price')).to.equal('C');
      expect(toKey.get('A')).to.equal('id');
      expect(toKey.get('C')).to.equal('price');
    });

    it('lets the recalc layer resolve a parsed column index back to a key', () => {
      const { toKey } = buildColumnLetters(columns);
      const address = parseA1('C2') as CellAddress; // col index 2
      expect(toKey.get(indexToColumnLetter(address.col))).to.equal('price');
    });

    it('keeps a stable letter for every column including later ones', () => {
      const many = Array.from({ length: 30 }, (_, i) => ({ key: `c${i}` }));
      const { toLetter } = buildColumnLetters(many);
      expect(toLetter.get('c25')).to.equal('Z');
      expect(toLetter.get('c26')).to.equal('AA');
      expect(toLetter.get('c27')).to.equal('AB');
    });
  });
});
