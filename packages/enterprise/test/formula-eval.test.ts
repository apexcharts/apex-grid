import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  type CellAddress,
  type CellValue,
  createFunctionRegistry,
  evaluate,
  FORMULA_MODULE_ID,
  type FormulaContext,
  type FormulaController,
  type FormulaEngineHost,
  type FormulaError,
  type FormulaFn,
  FormulaStore,
  formulaModule,
  isFormulaError,
  offsetAddress,
  offsetReferences,
  ParseError,
  parseA1,
  parseFormula,
  rangeCells,
  stringifyFormula,
  toBoolean,
  toNumber,
  toText,
} from '../src/features/formula/index.js';
import { ApexGridEnterprise, enterpriseModules } from '../src/index.js';

/** Evaluate against a small row-major sheet; cells outside it read blank. */
function sheet(cells: unknown[][], extra: Array<[string, FormulaFn]> = []) {
  const functions = createFunctionRegistry();
  for (const [name, fn] of extra) functions.set(name, fn);
  const read = ({ row, col }: CellAddress) => (cells[row]?.[col] ?? null) as CellValue;
  const ctx: FormulaContext = {
    getRef: read,
    getRange: (range) => rangeCells(range).map(read),
    functions,
  };
  return (src: string): CellValue => evaluate(parseFormula(src), ctx);
}

const ev = sheet([]);

function code(value: CellValue): string {
  expect(isFormulaError(value), `expected an error, got ${JSON.stringify(value)}`).to.be.true;
  return (value as FormulaError).code;
}

function controllerOf<T extends object>(grid: ApexGridEnterprise<T>): FormulaController<T> {
  return (
    grid as unknown as {
      stateController: { module(id: string): FormulaController<T> };
    }
  ).stateController.module(FORMULA_MODULE_ID);
}

describe('formula evaluator (audit batch B18)', () => {
  describe('Date and other object cells coerce instead of throwing', () => {
    const when = new Date(2024, 0, 1);
    const run = sheet([[when, { an: 'object' }]]);

    it('a Date reads as its epoch milliseconds in arithmetic, logic and text', () => {
      expect(run('=A1+30')).to.equal(when.getTime() + 30);
      expect(run('=ABS(A1)')).to.equal(when.getTime());
      expect(run('=ROUND(A1,0)')).to.equal(when.getTime());
      expect(run('=IF(A1,1,0)')).to.equal(1);
      expect(run('=A1&""')).to.equal(String(when.getTime()));
      expect(run('=A1=A1')).to.equal(true);
    });

    it('any other object is #VALUE!', () => {
      expect(code(run('=B1+1'))).to.equal('#VALUE!');
      expect(code(run('=IF(B1,1,0)'))).to.equal('#VALUE!');
    });

    it('toNumber, toBoolean and toText accept a Date without throwing', () => {
      const raw = when as unknown as CellValue;
      expect(toNumber(raw)).to.equal(when.getTime());
      expect(toBoolean(raw)).to.equal(true);
      expect(toText(raw)).to.equal(String(when.getTime()));
      expect(code(toNumber(new Date(Number.NaN) as unknown as CellValue))).to.equal('#VALUE!');
    });
  });

  describe('blank cells compare as empty text and zero', () => {
    const run = sheet([[null, 5]]);

    it('blank equals "" and 0', () => {
      expect(run('=A1=""')).to.equal(true);
      expect(run('=A1=0')).to.equal(true);
      expect(run('=A1=FALSE')).to.equal(true);
      expect(run('=A1<>0')).to.equal(false);
      expect(run('=""=A1')).to.equal(true);
      expect(run('=A1=C1')).to.equal(true);
    });

    it('blank orders as 0 against numbers and "" against text', () => {
      expect(run('=A1>=0')).to.equal(true);
      expect(run('=A1>-5')).to.equal(true);
      expect(run('=A1<B1')).to.equal(true);
      expect(run('=A1<"a"')).to.equal(true);
    });

    it('the blank guard idiom yields blank text', () => {
      expect(run('=IF(A1="","",A1*2)')).to.equal('');
      expect(run('=IF(B1="","",B1*2)')).to.equal(10);
    });
  });

  describe('ROUND, ROUNDUP and ROUNDDOWN round in decimal', () => {
    it('keeps values that already have the target precision', () => {
      expect(ev('=ROUNDUP(0.07,2)')).to.equal(0.07);
      expect(ev('=ROUNDDOWN(0.29,2)')).to.equal(0.29);
      expect(ev('=ROUND(1.005,2)')).to.equal(1.01);
      expect(ev('=ROUND(-1.005,2)')).to.equal(-1.01);
    });

    it('a sweep of every cent value round-trips through all three', () => {
      const run = sheet([]);
      for (let cents = 1; cents < 10000; cents++) {
        const value = cents / 100;
        for (const fn of ['ROUND', 'ROUNDUP', 'ROUNDDOWN']) {
          const got = run(`=${fn}(${value},2)`);
          if (got !== value) expect.fail(`${fn}(${value},2) gave ${String(got)}`);
        }
      }
    });

    it('keeps the existing whole and negative digit behaviour', () => {
      expect(ev('=ROUND(2.5)')).to.equal(3);
      expect(ev('=ROUND(-2.5)')).to.equal(-3);
      expect(ev('=ROUND(1234.5,-2)')).to.equal(1200);
      expect(ev('=ROUNDUP(1201,-2)')).to.equal(1300);
      expect(ev('=ROUNDDOWN(-3.7,0)')).to.equal(-3);
    });

    it('huge digit counts stay finite', () => {
      expect(ev('=ROUND(1.5,400)')).to.equal(1.5);
      expect(ev('=ROUND(1.5,-400)')).to.equal(0);
      expect(ev('=ROUNDUP(1e300,20)')).to.equal(1e300);
    });
  });

  describe('custom functions cannot break recalc', () => {
    const tax: FormulaFn = (args) =>
      (args[0] as unknown as { toFixed(n: number): string }).toFixed(2);
    const weird: FormulaFn = () => ({ not: 'a value' }) as unknown as CellValue;
    const nothing: FormulaFn = () => undefined as unknown as CellValue;

    it('a throwing function is #VALUE! in its cell', () => {
      const run = sheet(
        [[null]],
        [
          ['TAX', tax],
          ['WEIRD', weird],
          ['NOTHING', nothing],
        ]
      );
      expect(code(run('=TAX(A1)'))).to.equal('#VALUE!');
      expect(code(run('=WEIRD()'))).to.equal('#VALUE!');
      expect(run('=NOTHING()')).to.equal(null);
    });

    it('a store recalc continues past a throwing function', () => {
      const cells: CellValue[][] = [[null, null, null]];
      const functions = createFunctionRegistry();
      functions.set('TAX', tax);
      const host: FormulaEngineHost = {
        readValue: ({ row, col }) => cells[row]?.[col] ?? null,
        writeValue: ({ row, col }, value) => {
          cells[row][col] = value;
        },
        isValidAddress: ({ row, col }) => row === 0 && col >= 0 && col < 3,
        functions,
      };
      const store = new FormulaStore(host);
      expect(() => store.set({ row: 0, col: 1 }, '=TAX(A1)')).to.not.throw();
      store.set({ row: 0, col: 2 }, '=7');
      expect(code(cells[0][1])).to.equal('#VALUE!');
      expect(cells[0][2]).to.equal(7);
    });
  });

  describe('every number result is finite', () => {
    it('POWER and ^ agree', () => {
      expect(code(ev('=0^-1'))).to.equal('#VALUE!');
      expect(code(ev('=POWER(0,-1)'))).to.equal('#VALUE!');
      expect(code(ev('=POWER(-8,1/3)'))).to.equal('#VALUE!');
      expect(code(ev('=(-8)^(1/3)'))).to.equal('#VALUE!');
      expect(ev('=POWER(2,10)')).to.equal(1024);
      expect(ev('=2^10')).to.equal(1024);
    });

    it('overflowing arithmetic is #VALUE!', () => {
      expect(code(ev('=10^308*10'))).to.equal('#VALUE!');
      expect(code(ev('=SUM(10^308*10,1)'))).to.equal('#VALUE!');
    });
  });

  describe('a range into a fixed-arity built-in is #VALUE!', () => {
    const run = sheet([[4.56789], [2], ['abc']]);

    it('scalar built-ins reject ranges', () => {
      expect(code(run('=ROUND(A1:A2)'))).to.equal('#VALUE!');
      expect(code(run('=LEFT(A1:A2)'))).to.equal('#VALUE!');
      expect(code(run('=ABS(A1:A2)'))).to.equal('#VALUE!');
      expect(code(run('=LEN(A1:A3)'))).to.equal('#VALUE!');
    });

    it('a one-cell range is that cell', () => {
      expect(run('=ABS(A2:A2)')).to.equal(2);
      expect(run('=LEN(A3:A3)')).to.equal(3);
      expect(run('=ROUND(A1:A1,1)')).to.equal(4.6);
    });

    it('variadic built-ins and custom functions still take ranges', () => {
      expect(run('=SUM(A1:A2)')).to.be.closeTo(6.56789, 1e-12);
      expect(run('=COUNTA(A1:A3)')).to.equal(3);
      expect(run('=MAX(A1:A3)')).to.equal(4.56789);
      expect(run('=ROUND(A1,2)')).to.equal(4.57);
      const count = sheet([[1], [2]], [['N', (args) => args.length]]);
      expect(count('=N(A1:A2)')).to.equal(2);
    });
  });

  describe('% and MOD share the spreadsheet MOD sign rule', () => {
    it('the result takes the sign of the divisor', () => {
      expect(ev('=-7%3')).to.equal(2);
      expect(ev('=MOD(-7,3)')).to.equal(2);
      expect(ev('=7%-3')).to.equal(-2);
      expect(ev('=MOD(7,-3)')).to.equal(-2);
      expect(ev('=10%3')).to.equal(1);
      expect(code(ev('=1%0'))).to.equal('#DIV/0!');
    });
  });

  describe('number to text uses 15 significant digits', () => {
    const run = sheet([[null, 0.1, 0.2]]);
    it('float noise does not leak into text', () => {
      expect(run('=(B1+C1)&" kg"')).to.equal('0.3 kg');
      expect(run('=LEN(B1+C1)')).to.equal(3);
      expect(run('=CONCAT(1/3)')).to.equal('0.333333333333333');
      expect(run('=12&""')).to.equal('12');
    });
  });

  describe('text to number accepts decimal literals only', () => {
    const run = sheet([['0x10', 'Infinity', '1e999', ' 12 ', '-.5', '1e3', '0b101']]);
    it('rejects JavaScript-only and non-finite forms', () => {
      expect(code(run('=A1+1'))).to.equal('#VALUE!');
      expect(code(run('=B1+1'))).to.equal('#VALUE!');
      expect(code(run('=C1*2'))).to.equal('#VALUE!');
      expect(code(run('=G1+0'))).to.equal('#VALUE!');
    });
    it('still parses decimal text', () => {
      expect(run('=D1+1')).to.equal(13);
      expect(run('=E1*2')).to.equal(-1);
      expect(run('=F1+0')).to.equal(1000);
    });
  });

  describe('negative relative offsets give #REF!', () => {
    const shift = (src: string, dRow: number, dCol: number): string =>
      stringifyFormula(offsetReferences(parseFormula(src), dRow, dCol));

    it('offsetAddress no longer clamps a relative axis', () => {
      expect(offsetAddress({ row: 1, col: 1 }, -5, -5)).to.deep.equal({ row: -4, col: -4 });
      expect(offsetAddress({ row: 1, col: 1 }, -5, -5, { rowAbsolute: true })).to.deep.equal({
        row: 1,
        col: -4,
      });
    });

    it('a reference or range that leaves the sheet becomes #REF!', () => {
      expect(shift('=B2', -5, -5)).to.equal('=#REF!');
      expect(shift('=SUM(C1:C3)', -2, 0)).to.equal('=SUM(#REF!)');
      expect(shift('=C2+B2', -1, 0)).to.equal('=C1+B1');
      expect(shift('=$A$1+B2', -5, 0)).to.equal('=$A$1+#REF!');
    });

    it('the #REF! literal reparses and evaluates to #REF!', () => {
      expect(code(ev('=#REF!+1'))).to.equal('#REF!');
      expect(code(ev('=SUM(#REF!)'))).to.equal('#REF!');
      expect(stringifyFormula(parseFormula('=#ref!*2'))).to.equal('=#REF!*2');
    });
  });

  describe('number literals round-trip in exponent notation', () => {
    it('parses exponents and reserializes them', () => {
      expect(ev('=2E5')).to.equal(200000);
      expect(ev('=1.5e-3*2')).to.equal(0.003);
      expect(stringifyFormula(parseFormula('=A2*0.0000001'))).to.equal('=A2*1e-7');
      expect(stringifyFormula(parseFormula('=A2*1e-7'))).to.equal('=A2*1e-7');
      expect(stringifyFormula(parseFormula('=1000000000000000000000+A1'))).to.equal('=1e+21+A1');
      expect(stringifyFormula(parseFormula('=1e+21+A1'))).to.equal('=1e+21+A1');
    });

    it('rejects a literal that overflows', () => {
      expect(() => parseFormula('=1e999')).to.throw(ParseError);
    });
  });

  describe('function names with digits, underscores and dots', () => {
    const run = sheet(
      [
        [100, 3],
        [7, 9],
      ],
      [
        ['LOG10', (args) => Math.log10(args[0] as number)],
        ['VAT_RATE', () => 0.2],
        ['STDEV.S', () => 1],
        ['X2', (args) => (args[0] as number) * 2],
      ]
    );

    it('a registered name is callable', () => {
      expect(run('=LOG10(A1)')).to.equal(2);
      expect(run('=LOG10 (A1)')).to.equal(2);
      expect(run('=VAT_RATE()')).to.equal(0.2);
      expect(run('=STDEV.S(A1:B2)')).to.equal(1);
      expect(run('=X2(B1)')).to.equal(6);
    });

    it('cell references stay unambiguous', () => {
      expect(run('=A1+LOG10(B1)')).to.be.closeTo(100 + Math.log10(3), 1e-12);
      expect(run('=SUM(A1:B2)')).to.equal(119);
      expect(parseFormula('=AB10')).to.deep.include({ type: 'ref' });
      expect(parseFormula('=A$1')).to.deep.include({ type: 'ref' });
      expect(code(run('=NOPE1(2)'))).to.equal('#NAME?');
    });
  });

  describe('ParseError positions index the typed text', () => {
    const at = (src: string): number => {
      try {
        parseFormula(src);
      } catch (error) {
        expect(error).to.be.instanceOf(ParseError);
        return (error as ParseError).position;
      }
      return expect.fail(`${src} parsed`);
    };
    it('includes the "=" and leading whitespace', () => {
      expect(at('=1+@')).to.equal(3);
      expect(at('=SUM(A1')).to.equal(7);
      expect(at('  =1+@')).to.equal(5);
      expect(at('1+@')).to.equal(2);
    });

    it('trailing Unicode whitespace is ignored, as at 0.7.0', () => {
      for (const tail of [' ', ' ', '\f', '\v', ' ']) {
        expect(ev(`=1+2${tail}`)).to.equal(3);
      }
      expect(at('=1+@ ')).to.equal(3);
    });
  });

  describe('oversized ranges are clipped to the sheet', () => {
    it('a store evaluates a huge range without enumerating it', () => {
      const cells: CellValue[][] = [
        [1, 2, null],
        [3, 4, null],
      ];
      const host: FormulaEngineHost = {
        readValue: ({ row, col }) => cells[row]?.[col] ?? null,
        writeValue: ({ row, col }, value) => {
          cells[row][col] = value;
        },
        isValidAddress: ({ row, col }) => row >= 0 && row < 2 && col >= 0 && col < 3,
        extent: () => ({ rows: 2, cols: 3 }),
        functions: createFunctionRegistry(),
      } as FormulaEngineHost;
      const store = new FormulaStore(host);
      const started = performance.now();
      store.set({ row: 0, col: 2 }, '=SUM(A2:B50000000)');
      store.set({ row: 1, col: 2 }, '=SUM(A1:B2)');
      expect(performance.now() - started).to.be.below(1000);
      expect(code(cells[0][2])).to.equal('#REF!');
      expect(cells[1][2]).to.equal(10);
      expect(sheet([[1]])('=COUNT(A1:A1)')).to.equal(1);
    });

    describe('in a grid', () => {
      interface Row {
        a: number;
        out: unknown;
      }
      const columns: ColumnConfiguration<Row>[] = [
        { key: 'a', type: 'number' },
        { key: 'out', allowFormula: true },
      ];
      before(() => {
        ApexGridEnterprise.use(...enterpriseModules, formulaModule);
        ApexGridEnterprise.register();
      });
      afterEach(() => fixtureCleanup());

      async function mount<T extends object>(data: T[], cols: ColumnConfiguration<T>[]) {
        const grid = await fixture<ApexGridEnterprise<T>>(
          html`<apex-grid-enterprise .data=${data} .columns=${cols}></apex-grid-enterprise>`
        );
        await grid.updateComplete;
        await nextFrame();
        return grid;
      }

      it('setFormula and live highlighting over a huge range finish fast', async () => {
        const data: Row[] = [
          { a: 1, out: null },
          { a: 2, out: null },
        ];
        const grid = await mount(data, columns);
        const started = performance.now();
        grid.setFormula(data[0], 'out', '=SUM(A1:A90000000)');
        controllerOf(grid).highlightReferences('=SUM(A1:ZZ1000000)');
        controllerOf(grid).setPointer(parseA1('A1:ZZ1000000') as never);
        expect(performance.now() - started).to.be.below(1000);
        expect(code(data[0].out as CellValue)).to.equal('#REF!');
        grid.setFormula(data[1], 'out', '=SUM(A1:A2)');
        expect(data[1].out).to.equal(3);
      });

      it('a Date cell feeds a formula through setFormula', async () => {
        interface DateRow {
          start: Date;
          out: unknown;
        }
        const when = new Date(2024, 0, 1);
        const data: DateRow[] = [{ start: when, out: null }];
        const grid = await mount(data, [{ key: 'start', type: 'date' }, { key: 'out' }]);
        for (const src of ['=A1+30', '=ABS(A1)', '=IF(A1,1,0)', '=ROUND(A1,0)']) {
          expect(() => grid.setFormula(data[0], 'out', src), src).to.not.throw();
        }
        grid.setFormula(data[0], 'out', '=A1+30');
        expect(data[0].out).to.equal(when.getTime() + 30);
      });

      it('a formula with a trailing non-breaking space sets and restores', async () => {
        const dataA: Row[] = [{ a: 10, out: null }];
        const gridA = await mount(dataA, columns);
        gridA.setFormula(dataA[0], 'out', '=A1*2 ');
        expect(dataA[0].out).to.equal(20);
        const state = gridA.getState();
        const dataB: Row[] = [{ a: 10, out: null }];
        const gridB = await mount(dataB, columns);
        gridB.setState(state);
        await gridB.updateComplete;
        expect(gridB.getFormula(dataB[0], 'out')).to.not.be.undefined;
        expect(dataB[0].out).to.equal(20);
      });

      it('fill upward rewrites an underflowing reference to #REF!', async () => {
        const data: Row[] = [
          { a: 1, out: null },
          { a: 2, out: null },
          { a: 3, out: null },
        ];
        const grid = await mount(data, columns);
        grid.setFormula(data[2], 'out', '=SUM(A1:A3)');
        expect(controllerOf(grid).fillFormula(data[2], 'out', data[0], 'out')).to.equal(true);
        expect(grid.getFormula(data[0], 'out')).to.equal('=SUM(#REF!)');
        expect(code(data[0].out as CellValue)).to.equal('#REF!');
      });

      it('registerFormulaFunction takes digit names and rejects unusable ones', async () => {
        const grid = await mount(
          [
            { a: 100, out: null },
            { a: 1, out: null },
          ] as Row[],
          columns
        );
        grid.registerFormulaFunction('log10', (args) => Math.log10(args[0] as number));
        grid.setFormula(grid.data[0], 'out', '=LOG10(A1)');
        expect(grid.data[0].out).to.equal(2);
        for (const name of ['IF', 'true', 'MY-FN', '1ABC', '']) {
          expect(() => grid.registerFormulaFunction(name, () => 1), name).to.throw(TypeError);
        }
      });
    });
  });
});
