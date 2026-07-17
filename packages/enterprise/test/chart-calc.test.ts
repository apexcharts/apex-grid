import { expect } from '@open-wc/testing';
import { computeCalculatedSeries, isValidChartFormula } from '../src/index.js';

describe('calculated-field series — isValidChartFormula (pure)', () => {
  it('accepts parseable formulas (leading = optional), rejects the rest', () => {
    expect(isValidChartFormula('B1 / A1 * 100')).to.equal(true);
    expect(isValidChartFormula('=A1 + B1')).to.equal(true);
    expect(isValidChartFormula('SUM(A1:B1)')).to.equal(true);
    expect(isValidChartFormula('A1 +')).to.equal(false); // dangling operator
    expect(isValidChartFormula('')).to.equal(false);
    expect(isValidChartFormula('   ')).to.equal(false);
  });
});

describe('calculated-field series — computeCalculatedSeries (pure)', () => {
  it('evaluates a formula per category over the aggregates (A1 = first numeric column)', () => {
    // A1 = column 0 (salary), B1 = column 1 (bonus); two categories.
    const refAggregates = [
      [160, 130], // salary per category
      [26, 20], // bonus per category
    ];
    const [series] = computeCalculatedSeries(
      [{ name: 'Bonus %', formula: 'B1 / A1 * 100' }],
      refAggregates,
      2
    );
    expect(series.name).to.equal('Bonus %');
    expect(series.data[0]).to.be.closeTo(16.25, 1e-9); // 26/160*100
    expect(series.data[1]).to.be.closeTo(15.3846, 1e-3); // 20/130*100
  });

  it('supports functions and a leading =', () => {
    const [series] = computeCalculatedSeries(
      [{ name: 'Total', formula: '=A1 + B1' }],
      [
        [10, 3],
        [5, 7],
      ],
      2
    );
    expect(series.data).to.eql([15, 10]);
  });

  it('skips an unparseable formula entirely (no series)', () => {
    expect(computeCalculatedSeries([{ name: 'Bad', formula: 'A1 /' }], [[1]], 1)).to.eql([]);
  });

  it('yields null (a gap) for an error or non-finite result, not a fake zero', () => {
    // Divide by zero → #DIV/0! → null for that category.
    const [series] = computeCalculatedSeries(
      [{ name: 'Ratio', formula: 'A1 / B1' }],
      [
        [10, 10],
        [0, 2],
      ],
      2
    );
    expect(series.data[0]).to.equal(null); // 10 / 0
    expect(series.data[1]).to.equal(5); // 10 / 2
  });

  it('reads blank (null) for references beyond the available columns', () => {
    // Only column A exists; C1 is out of range → blank → A1 + blank = A1.
    const [series] = computeCalculatedSeries([{ name: 'X', formula: 'A1 + C1' }], [[7]], 1);
    expect(series.data[0]).to.equal(7);
  });

  it('is a no-op for an empty field list', () => {
    expect(computeCalculatedSeries([], [[1, 2]], 2)).to.eql([]);
  });
});
