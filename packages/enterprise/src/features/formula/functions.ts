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

// --- broader flat-argument library (Tier 2, P6) ----------------------------
// All take their arguments already flattened, so the public FormulaFn calling
// convention is unchanged. Range+criteria functions (SUMIF, ...) are deferred:
// they would need a different argument-grouping convention.

/** A unary numeric function with the standard error-propagation + arity guard. */
function unaryNumeric(name: string, compute: (n: number) => CellValue): FormulaFn {
  return (args) => {
    const error = firstError(args);
    if (error) {
      return error;
    }
    if (args.length !== 1) {
      return valueError(`${name} requires one argument`);
    }
    const n = toNumber(args[0]);
    return isFormulaError(n) ? n : compute(n);
  };
}

/** A unary text function with the standard error-propagation + arity guard. */
function unaryText(name: string, compute: (text: string) => CellValue): FormulaFn {
  return (args) => {
    const error = firstError(args);
    if (error) {
      return error;
    }
    if (args.length !== 1) {
      return valueError(`${name} requires one argument`);
    }
    const text = toText(args[0]);
    return isFormulaError(text) ? text : compute(text);
  };
}

const MOD: FormulaFn = (args) => {
  const error = firstError(args);
  if (error) {
    return error;
  }
  if (args.length !== 2) {
    return valueError('MOD requires two arguments');
  }
  const a = toNumber(args[0]);
  if (isFormulaError(a)) {
    return a;
  }
  const b = toNumber(args[1]);
  if (isFormulaError(b)) {
    return b;
  }
  // Excel MOD takes the sign of the divisor (unlike JS `%`).
  return b === 0 ? divZeroError('MOD by zero') : a - b * Math.floor(a / b);
};

const POWER: FormulaFn = (args) => {
  const error = firstError(args);
  if (error) {
    return error;
  }
  if (args.length !== 2) {
    return valueError('POWER requires two arguments');
  }
  const base = toNumber(args[0]);
  if (isFormulaError(base)) {
    return base;
  }
  const exponent = toNumber(args[1]);
  return isFormulaError(exponent) ? exponent : base ** exponent;
};

/** ROUND variant: `mode` rounds the magnitude up (ceil) or down (trunc). */
function roundWith(name: string, mode: 'up' | 'down'): FormulaFn {
  return (args) => {
    const error = firstError(args);
    if (error) {
      return error;
    }
    if (args.length === 0) {
      return valueError(`${name} requires a number`);
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
    const scaled = Math.abs(value) * factor;
    const rounded = mode === 'up' ? Math.ceil(scaled) : Math.floor(scaled);
    return (Math.sign(value) * rounded) / factor;
  };
}

const LEFT: FormulaFn = (args) => {
  const error = firstError(args);
  if (error) {
    return error;
  }
  if (args.length === 0) {
    return valueError('LEFT requires text');
  }
  const text = toText(args[0]);
  if (isFormulaError(text)) {
    return text;
  }
  const count = args.length > 1 ? toNumber(args[1]) : 1;
  if (isFormulaError(count)) {
    return count;
  }
  return text.slice(0, Math.max(0, Math.trunc(count)));
};

const RIGHT: FormulaFn = (args) => {
  const error = firstError(args);
  if (error) {
    return error;
  }
  if (args.length === 0) {
    return valueError('RIGHT requires text');
  }
  const text = toText(args[0]);
  if (isFormulaError(text)) {
    return text;
  }
  const count = args.length > 1 ? toNumber(args[1]) : 1;
  if (isFormulaError(count)) {
    return count;
  }
  const n = Math.max(0, Math.trunc(count));
  return n === 0 ? '' : text.slice(Math.max(0, text.length - n));
};

const MID: FormulaFn = (args) => {
  const error = firstError(args);
  if (error) {
    return error;
  }
  if (args.length !== 3) {
    return valueError('MID requires three arguments');
  }
  const text = toText(args[0]);
  if (isFormulaError(text)) {
    return text;
  }
  const start = toNumber(args[1]);
  if (isFormulaError(start)) {
    return start;
  }
  const count = toNumber(args[2]);
  if (isFormulaError(count)) {
    return count;
  }
  if (start < 1) {
    return valueError('MID start position is 1-based');
  }
  const from = Math.trunc(start) - 1;
  return text.slice(from, from + Math.max(0, Math.trunc(count)));
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
  ['ROUNDUP', roundWith('ROUNDUP', 'up')],
  ['ROUNDDOWN', roundWith('ROUNDDOWN', 'down')],
  ['ABS', ABS],
  ['MOD', MOD],
  ['POWER', POWER],
  [
    'SQRT',
    unaryNumeric('SQRT', (n) => (n < 0 ? valueError('SQRT of a negative number') : Math.sqrt(n))),
  ],
  ['INT', unaryNumeric('INT', (n) => Math.floor(n))],
  ['SIGN', unaryNumeric('SIGN', (n) => Math.sign(n))],
  ['AND', AND],
  ['OR', OR],
  ['NOT', NOT],
  ['CONCAT', CONCAT],
  ['CONCATENATE', CONCAT],
  ['LEN', unaryText('LEN', (text) => text.length)],
  ['LEFT', LEFT],
  ['RIGHT', RIGHT],
  ['MID', MID],
  ['TRIM', unaryText('TRIM', (text) => text.replace(/\s+/g, ' ').trim())],
  ['UPPER', unaryText('UPPER', (text) => text.toUpperCase())],
  ['LOWER', unaryText('LOWER', (text) => text.toLowerCase())],
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
