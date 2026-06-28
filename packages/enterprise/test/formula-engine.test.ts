import { expect } from '@open-wc/testing';
import {
  type CellValue,
  createFunctionRegistry,
  evaluate,
  type FormulaContext,
  type FormulaError,
  type FormulaFn,
  formatA1,
  formulaReferences,
  isFormulaError,
  ParseError,
  parseFormula,
  rangeCells,
  refError,
  valueError,
} from '../src/features/formula/index.js';

/** Build a context over a dense `grid[row][col]` of values; out-of-range is null. */
function contextFor(
  grid: CellValue[][],
  functions: Map<string, FormulaFn> = createFunctionRegistry()
): FormulaContext {
  return {
    getRef: ({ row, col }) => grid[row]?.[col] ?? null,
    getRange: (range) => rangeCells(range).map(({ row, col }) => grid[row]?.[col] ?? null),
    functions,
  };
}

/** Parse + evaluate `src` against an optional grid / function registry. */
function ev(src: string, grid: CellValue[][] = [], functions?: Map<string, FormulaFn>): CellValue {
  return evaluate(parseFormula(src), contextFor(grid, functions));
}

/** Assert the value is an error and return its code. */
function errCode(value: CellValue): string {
  expect(isFormulaError(value), `expected an error, got ${JSON.stringify(value)}`).to.be.true;
  return (value as FormulaError).code;
}

describe('formula engine (F1)', () => {
  describe('arithmetic + precedence', () => {
    it('respects operator precedence and parentheses', () => {
      expect(ev('=1+2*3')).to.equal(7);
      expect(ev('=(1+2)*3')).to.equal(9);
      expect(ev('=10/4')).to.equal(2.5);
      expect(ev('=10%3')).to.equal(1);
    });

    it('handles a leading "=" or no prefix identically', () => {
      expect(ev('1+1')).to.equal(2);
      expect(ev('=1+1')).to.equal(2);
    });

    it('treats ^ as right-associative and binding tighter than unary minus', () => {
      expect(ev('=2^3^2')).to.equal(512); // 2^(3^2)
      expect(ev('=-2^2')).to.equal(-4); // -(2^2)
      expect(ev('=2^-2')).to.equal(0.25);
    });

    it('applies unary minus and plus', () => {
      expect(ev('=2*-3')).to.equal(-6);
      expect(ev('=-(1+2)')).to.equal(-3);
      expect(ev('=+5')).to.equal(5);
    });

    it('ignores surrounding whitespace', () => {
      expect(ev('=  1 +  2 ')).to.equal(3);
    });
  });

  describe('comparisons + text', () => {
    it('compares numbers', () => {
      expect(ev('=1<2')).to.equal(true);
      expect(ev('=2<=2')).to.equal(true);
      expect(ev('=3>5')).to.equal(false);
      expect(ev('=3<>3')).to.equal(false);
    });

    it('compares text case-insensitively', () => {
      expect(ev('="a"="A"')).to.equal(true);
      expect(ev('="abc"<>"abd"')).to.equal(true);
    });

    it('concatenates with &', () => {
      expect(ev('="a"&"b"')).to.equal('ab');
      expect(ev('=1&2')).to.equal('12');
    });

    it('parses strings with escaped quotes', () => {
      expect(ev('="a""b"')).to.equal('a"b');
    });
  });

  describe('booleans + logical functions', () => {
    it('reads boolean literals', () => {
      expect(ev('=TRUE')).to.equal(true);
      expect(ev('=false')).to.equal(false);
    });

    it('evaluates AND / OR / NOT', () => {
      expect(ev('=AND(TRUE,1,2)')).to.equal(true);
      expect(ev('=AND(TRUE,0)')).to.equal(false);
      expect(ev('=OR(FALSE,0,5)')).to.equal(true);
      expect(ev('=NOT(FALSE)')).to.equal(true);
    });
  });

  describe('references + ranges', () => {
    it('reads single cells', () => {
      expect(ev('=A1+B1', [[10, 20]])).to.equal(30);
    });

    it('expands ranges into function arguments', () => {
      const grid: CellValue[][] = [[1], [2], [3], [4]];
      expect(ev('=SUM(A1:A4)', grid)).to.equal(10);
      expect(ev('=AVERAGE(A1:A4)', grid)).to.equal(2.5);
      expect(ev('=MIN(A1:A4)', grid)).to.equal(1);
      expect(ev('=MAX(A1:A4)', grid)).to.equal(4);
      expect(ev('=COUNT(A1:A4)', grid)).to.equal(4);
    });

    it('skips non-numeric cells in numeric functions but counts them in COUNTA', () => {
      const grid: CellValue[][] = [[1], ['x'], [3]];
      expect(ev('=SUM(A1:A3)', grid)).to.equal(4);
      expect(ev('=COUNT(A1:A3)', grid)).to.equal(2);
      expect(ev('=COUNTA(A1:A3)', grid)).to.equal(3);
    });

    it('treats a bare range used as a scalar as #VALUE!', () => {
      expect(errCode(ev('=A1:B2', [[1, 2]]))).to.equal('#VALUE!');
    });
  });

  describe('numeric functions', () => {
    it('ROUND rounds half away from zero', () => {
      expect(ev('=ROUND(2.5)')).to.equal(3);
      expect(ev('=ROUND(-2.5)')).to.equal(-3);
      expect(ev('=ROUND(3.14159,2)')).to.equal(3.14);
    });

    it('ABS returns magnitude', () => {
      expect(ev('=ABS(-5)')).to.equal(5);
    });
  });

  describe('IF (short-circuit)', () => {
    it('selects the matching branch', () => {
      expect(ev('=IF(1>0,"yes","no")')).to.equal('yes');
      expect(ev('=IF(1>2,"yes","no")')).to.equal('no');
    });

    it('returns FALSE when the else branch is omitted', () => {
      expect(ev('=IF(FALSE,1)')).to.equal(false);
    });

    it('does not evaluate the untaken branch (so it can guard a division)', () => {
      expect(ev('=IF(B1=0,0,A1/B1)', [[10, 0]])).to.equal(0);
      expect(ev('=IF(B1=0,0,A1/B1)', [[10, 2]])).to.equal(5);
    });
  });

  describe('error values', () => {
    it('produces #DIV/0! for division and modulo by zero', () => {
      expect(errCode(ev('=1/0'))).to.equal('#DIV/0!');
      expect(errCode(ev('=5%0'))).to.equal('#DIV/0!');
    });

    it('produces #NAME? for an unknown function', () => {
      expect(errCode(ev('=NOPE(1)'))).to.equal('#NAME?');
    });

    it('produces #VALUE! for non-numeric arithmetic', () => {
      expect(errCode(ev('="a"+1'))).to.equal('#VALUE!');
    });

    it('propagates an error operand through operators and functions', () => {
      expect(errCode(ev('=1/0+5'))).to.equal('#DIV/0!');
      expect(errCode(ev('=SUM(1,1/0)'))).to.equal('#DIV/0!');
    });

    it('propagates a reference error from the context (#REF!)', () => {
      const ctx: FormulaContext = {
        getRef: () => refError('out of range'),
        getRange: () => [refError()],
        functions: createFunctionRegistry(),
      };
      expect(errCode(evaluate(parseFormula('=A1+1'), ctx))).to.equal('#REF!');
    });
  });

  describe('custom functions', () => {
    it('calls a registered custom function', () => {
      const functions = createFunctionRegistry();
      functions.set('DOUBLE', (args) =>
        typeof args[0] === 'number' ? args[0] * 2 : valueError('DOUBLE expects a number')
      );
      expect(ev('=DOUBLE(21)', [], functions)).to.equal(42);
      expect(ev('=DOUBLE(A1)+1', [[20]], functions)).to.equal(41);
    });
  });

  describe('parse errors', () => {
    it('throws ParseError with a position for malformed input', () => {
      expect(() => parseFormula('=1+')).to.throw(ParseError);
      expect(() => parseFormula('=(1+2')).to.throw(ParseError);
      expect(() => parseFormula('=1 2')).to.throw(ParseError);
      expect(() => parseFormula('=')).to.throw(ParseError);
    });

    it('reports the character position of the error', () => {
      try {
        parseFormula('=1+@');
        expect.fail('expected a ParseError');
      } catch (error) {
        expect(error).to.be.instanceOf(ParseError);
        expect((error as ParseError).position).to.be.a('number');
      }
    });
  });

  describe('formulaReferences', () => {
    it('collects the cells and ranges a formula reads', () => {
      const refs = formulaReferences(parseFormula('=A1+SUM(B2:B4)*C1'));
      expect(refs.cells.map(formatA1)).to.eql(['A1', 'C1']);
      expect(refs.ranges.map(formatA1)).to.eql(['B2:B4']);
    });

    it('returns nothing for a constant formula', () => {
      const refs = formulaReferences(parseFormula('=1+2'));
      expect(refs.cells).to.be.empty;
      expect(refs.ranges).to.be.empty;
    });
  });
});
