/**
 * Calculated-field chart series: evaluate a spreadsheet formula per category over the **aggregated**
 * measure values (aggregate-then-evaluate — the ratio-of-totals a user expects; see
 * plans/chart-calculated-fields-spec.md). Pure: it drives the (DOM-free) formula engine, so it is
 * unit-tested directly. References are A1, where the letters map to the numeric columns in display
 * order (`A1` = first numeric column, row is always 1 — one aggregated value per column per category).
 */
import type { CalculatedField } from './chart.js';
import { isFormulaError, toNumber } from './formula/errors.js';
import { evaluate, type FormulaContext } from './formula/evaluator.js';
import { createFunctionRegistry } from './formula/functions.js';
import { type FormulaAst, parseFormula } from './formula/parser.js';
import { rangeCells } from './formula/refs.js';

/** Strip a single leading `=` (spreadsheet-style) and trim, so `=A1/B1` and `A1/B1` both parse. */
function stripEquals(formula: string): string {
  return formula.trim().replace(/^=/, '');
}

/** Whether `formula` parses (parse-only; does not evaluate). Drives the editor's live validation. */
export function isValidChartFormula(formula: string): boolean {
  const source = stripEquals(formula);
  if (source === '') return false;
  try {
    parseFormula(source);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compute each {@link CalculatedField} as a series. `refAggregates[letterColIndex][categorySlot]` is
 * the aggregated value of the numeric column mapped to that letter (A = index 0) for that category.
 * Evaluated once per category (aggregate-then-evaluate). An unparseable formula is skipped entirely;
 * an error or non-finite result for a category becomes `null` (a gap) rather than a misleading zero.
 */
export function computeCalculatedSeries(
  fields: readonly CalculatedField[],
  refAggregates: readonly number[][],
  categoryCount: number
): { name: string; data: (number | null)[] }[] {
  if (fields.length === 0) return [];
  const functions = createFunctionRegistry();
  const out: { name: string; data: (number | null)[] }[] = [];

  for (const field of fields) {
    let ast: FormulaAst;
    try {
      ast = parseFormula(stripEquals(field.formula));
    } catch {
      continue; // invalid formula → no series (the editor validates before adding)
    }
    // Only the aggregated row (row 0 = "row 1") holds values; every other cell reads blank.
    const valueAt = (row: number, col: number, slot: number): number | null =>
      row === 0 && col >= 0 && col < refAggregates.length
        ? (refAggregates[col][slot] ?? null)
        : null;

    const data: (number | null)[] = [];
    for (let slot = 0; slot < categoryCount; slot += 1) {
      const ctx: FormulaContext = {
        getRef: ({ row, col }) => valueAt(row, col, slot),
        getRange: (range) => rangeCells(range).map(({ row, col }) => valueAt(row, col, slot)),
        functions,
      };
      const result = evaluate(ast, ctx);
      if (isFormulaError(result)) {
        data.push(null);
        continue;
      }
      const num = toNumber(result);
      data.push(!isFormulaError(num) && Number.isFinite(num) ? num : null);
    }
    out.push({ name: field.name, data });
  }
  return out;
}
