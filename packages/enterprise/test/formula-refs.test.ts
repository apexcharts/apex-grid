import { expect } from '@open-wc/testing';
import {
  type CellAddress,
  columnLetterToIndex,
  formatA1,
  formatCell,
  indexToColumnLetter,
  isRangeAddress,
  normalizeRange,
  offsetAddress,
  ParseError,
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

  describe('parseCellRef addresses', () => {
    const at = (token: string) => parseCellRef(token).address;

    it('parses a single cell to a 0-based address', () => {
      expect(at('A1')).to.deep.equal({ row: 0, col: 0 });
      expect(at('B2')).to.deep.equal({ row: 1, col: 1 });
      expect(at('C10')).to.deep.equal({ row: 9, col: 2 });
    });

    it('is case-insensitive', () => {
      expect(at('b2')).to.deep.equal({ row: 1, col: 1 });
    });

    it('rejects malformed input with a ParseError', () => {
      expect(() => at('A')).to.throw(ParseError);
      expect(() => at('1A')).to.throw(ParseError);
      expect(() => at('A0')).to.throw(ParseError); // rows are 1-based
    });

    it('records the position of the offending text', () => {
      try {
        parseCellRef('bad', 3);
        expect.fail('expected a ParseError');
      } catch (error) {
        expect(error).to.be.instanceOf(ParseError);
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
      for (const token of ['A1', 'Z9', 'AA100']) {
        expect(formatA1(parseCellRef(token).address)).to.equal(token);
      }
    });
  });

  describe('ranges', () => {
    it('isRangeAddress distinguishes cells from ranges', () => {
      const cell: CellAddress = { row: 0, col: 0 };
      expect(isRangeAddress(cell)).to.be.false;
      expect(isRangeAddress({ start: cell, end: { row: 1, col: 1 } })).to.be.true;
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

    it('offsetAddress leaves an axis moved before row 1 or column A negative', () => {
      expect(offsetAddress({ row: 1, col: 1 }, -5, -5)).to.deep.equal({ row: -4, col: -4 });
    });

    it('formatA1 stays relative (no markers) for back-compat', () => {
      expect(formatCell({ row: 0, col: 0 })).to.equal('A1');
      expect(formatA1(parseCellRef('$B$2').address)).to.equal('B2');
    });
  });
});
