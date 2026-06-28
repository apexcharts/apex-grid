/**
 * Built-in formula functions and the per-evaluation function registry (F1).
 *
 * A {@link FormulaFn} receives its arguments already evaluated and with ranges
 * flattened into the value list (the evaluator does the expansion), so a custom
 * function is just `(args) => value`. Numeric functions skip non-numeric values
 * (matching the aggregation engine) but propagate error values, the spreadsheet
 * convention. `IF` is not here: the evaluator handles it directly so it can
 * short-circuit (only the taken branch is evaluated).
 *
 * Pure: no DOM, no grid knowledge.
 */
import {
  type CellValue,
  divZeroError,
  type FormulaError,
  firstError,
  isFormulaError,
  toBoolean,
  toNumber,
  toText,
  valueError,
} from './errors.js';

/** A formula function: evaluated arguments in (ranges already flattened), a value out. */
export type FormulaFn = (args: CellValue[]) => CellValue;

/** Collect the finite numbers among the arguments, skipping everything else. */
function numbersOf(args: readonly CellValue[]): number[] {
  const numbers: number[] = [];
  for (const arg of args) {
    if (typeof arg === 'number' && Number.isFinite(arg)) {
      numbers.push(arg);
    }
  }
  return numbers;
}

const SUM: FormulaFn = (args) =>
  firstError(args) ?? numbersOf(args).reduce((total, value) => total + value, 0);

const AVERAGE: FormulaFn = (args) => {
  const error = firstError(args);
  if (error) {
    return error;
  }
  const numbers = numbersOf(args);
  return numbers.length
    ? numbers.reduce((total, value) => total + value, 0) / numbers.length
    : divZeroError('AVERAGE of no numbers');
};

const MIN: FormulaFn = (args) => {
  const error = firstError(args);
  if (error) {
    return error;
  }
  const numbers = numbersOf(args);
  return numbers.length ? Math.min(...numbers) : 0;
};

const MAX: FormulaFn = (args) => {
  const error = firstError(args);
  if (error) {
    return error;
  }
  const numbers = numbersOf(args);
  return numbers.length ? Math.max(...numbers) : 0;
};

// COUNT counts numbers only and (like Excel) ignores error values.
const COUNT: FormulaFn = (args) => numbersOf(args).length;

// COUNTA counts every non-empty value (text, booleans, numbers, even errors).
const COUNTA: FormulaFn = (args) => args.filter((arg) => arg !== null && arg !== '').length;

const ROUND: FormulaFn = (args) => {
  const error = firstError(args);
  if (error) {
    return error;
  }
  if (args.length === 0) {
    return valueError('ROUND requires a number');
  }
  const value = toNumber(args[0]);
  if (isFormulaError(value)) {
    return value;
  }
  const digitsArg = args.length > 1 ? toNumber(args[1]) : 0;
  if (isFormulaError(digitsArg)) {
    return digitsArg;
  }
  const factor = 10 ** Math.trunc(digitsArg);
  // Round half away from zero, matching the spreadsheet ROUND.
  return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
};

const ABS: FormulaFn = (args) => {
  const error = firstError(args);
  if (error) {
    return error;
  }
  if (args.length === 0) {
    return valueError('ABS requires a number');
  }
  const value = toNumber(args[0]);
  return isFormulaError(value) ? value : Math.abs(value);
};

const AND: FormulaFn = (args) => {
  const error = firstError(args);
  if (error) {
    return error;
  }
  if (args.length === 0) {
    return valueError('AND requires arguments');
  }
  for (const arg of args) {
    const bool = toBoolean(arg);
    if (isFormulaError(bool)) {
      return bool;
    }
    if (!bool) {
      return false;
    }
  }
  return true;
};

const OR: FormulaFn = (args) => {
  const error = firstError(args);
  if (error) {
    return error;
  }
  if (args.length === 0) {
    return valueError('OR requires arguments');
  }
  for (const arg of args) {
    const bool = toBoolean(arg);
    if (isFormulaError(bool)) {
      return bool;
    }
    if (bool) {
      return true;
    }
  }
  return false;
};

const NOT: FormulaFn = (args) => {
  const error = firstError(args);
  if (error) {
    return error;
  }
  if (args.length !== 1) {
    return valueError('NOT requires exactly one argument');
  }
  const bool = toBoolean(args[0]);
  return isFormulaError(bool) ? bool : !bool;
};

const CONCAT: FormulaFn = (args) => {
  let out = '';
  for (const arg of args) {
    const text = toText(arg);
    if (isFormulaError(text)) {
      return text;
    }
    out += text;
  }
  return out;
};

const BUILTINS: ReadonlyArray<readonly [string, FormulaFn]> = [
  ['SUM', SUM],
  ['AVERAGE', AVERAGE],
  ['AVG', AVERAGE],
  ['MIN', MIN],
  ['MAX', MAX],
  ['COUNT', COUNT],
  ['COUNTA', COUNTA],
  ['ROUND', ROUND],
  ['ABS', ABS],
  ['AND', AND],
  ['OR', OR],
  ['NOT', NOT],
  ['CONCAT', CONCAT],
];

/**
 * Create a fresh function registry seeded with the v1 built-ins, keyed by
 * upper-case name. Each grid owns its own registry so `registerFormulaFunction`
 * adds custom functions without leaking across instances. `IF` is intentionally
 * absent: the evaluator implements it for short-circuit semantics.
 */
export function createFunctionRegistry(): Map<string, FormulaFn> {
  return new Map<string, FormulaFn>(BUILTINS.map(([name, fn]) => [name, fn]));
}

/** The names of the built-in functions (upper-case), for documentation/tests. */
export const BUILTIN_FUNCTION_NAMES: readonly string[] = BUILTINS.map(([name]) => name);

// Re-exported for convenience so consumers can build error returns in custom functions.
export type { FormulaError };
