/**
 * The formula evaluator (F1): a tree-walk over the AST that produces a
 * {@link CellValue}. References are resolved through an injected
 * {@link FormulaContext}, so the evaluator has no grid knowledge and is
 * trivially unit-testable. Error values propagate: any error operand yields the
 * same error. `IF` is evaluated directly (not via the function registry) so it
 * short-circuits, only the taken branch is evaluated, which lets
 * `IF(B1=0, 0, A1/B1)` guard a division.
 *
 * Pure: no DOM.
 */
import {
  type CellValue,
  divZeroError,
  type FormulaError,
  isFormulaError,
  nameError,
  toBoolean,
  toCellValue,
  toNumber,
  toText,
  valueError,
} from './errors.js';
import { type FormulaFn, modulo, takesRange } from './functions.js';
import type { BinaryNode, CallNode, FormulaAst, UnaryNode } from './parser.js';
import type { CellAddress, RangeAddress } from './refs.js';

/**
 * Everything the evaluator needs from the outside world: how to read a cell,
 * how to read a range (as a flat value list), and the available functions.
 * Wired to the grid by the recalc layer (F3); supplied directly in tests.
 */
export interface FormulaContext {
  /** Resolve a single cell reference to its current value. */
  getRef(address: CellAddress): CellValue;
  /** Resolve a range to the values of its cells (row-major). */
  getRange(range: RangeAddress): CellValue[];
  /** Available functions, keyed by upper-case name. */
  functions: Map<string, FormulaFn>;
}

const COMPARISON = new Set(['=', '<>', '<', '>', '<=', '>=']);

/**
 * A blank operand compares as the blank value of the other side's type (`0`,
 * `FALSE` or `""`), so a blank cell equals both `""` and `0`.
 */
function blankAs(value: CellValue, other: CellValue): CellValue {
  if (value !== null) {
    return value;
  }
  return typeof other === 'number' ? 0 : typeof other === 'boolean' ? false : '';
}

/** Spreadsheet `=`: same-type comparison, text case-insensitive. */
function looseEquals(a: CellValue, b: CellValue): boolean {
  if (typeof a !== typeof b) {
    return false;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

/** Ordering for `< > <= >=`: numeric when both numbers, else case-insensitive text. */
function compareOrder(a: CellValue, b: CellValue): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  // Neither side is an error here: the caller returned those already.
  const left = (toText(a) as string).toLowerCase();
  const right = (toText(b) as string).toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
}

/** A non-finite number result (overflow, `0^-1`, `POWER(-8,1/3)`) is `#VALUE!`. */
function finite(value: CellValue): CellValue {
  return typeof value === 'number' && !Number.isFinite(value)
    ? valueError('non-finite number')
    : value;
}

function evaluateUnary(node: UnaryNode, ctx: FormulaContext): CellValue {
  const operand = toNumber(evaluate(node.operand, ctx));
  if (isFormulaError(operand)) {
    return operand;
  }
  return node.operator === '-' ? -operand : operand;
}

function evaluateBinary(node: BinaryNode, ctx: FormulaContext): CellValue {
  const op = node.operator;

  if (op === '&') {
    const left = toText(evaluate(node.left, ctx));
    if (isFormulaError(left)) {
      return left;
    }
    const right = toText(evaluate(node.right, ctx));
    return isFormulaError(right) ? right : left + right;
  }

  if (COMPARISON.has(op)) {
    const rawLeft = evaluate(node.left, ctx);
    if (isFormulaError(rawLeft)) {
      return rawLeft;
    }
    const rawRight = evaluate(node.right, ctx);
    if (isFormulaError(rawRight)) {
      return rawRight;
    }
    const left = blankAs(rawLeft, rawRight);
    const right = blankAs(rawRight, rawLeft);
    switch (op) {
      case '=':
        return looseEquals(left, right);
      case '<>':
        return !looseEquals(left, right);
      case '<':
        return compareOrder(left, right) < 0;
      case '>':
        return compareOrder(left, right) > 0;
      case '<=':
        return compareOrder(left, right) <= 0;
      default:
        return compareOrder(left, right) >= 0;
    }
  }

  const left = toNumber(evaluate(node.left, ctx));
  if (isFormulaError(left)) {
    return left;
  }
  const right = toNumber(evaluate(node.right, ctx));
  if (isFormulaError(right)) {
    return right;
  }
  switch (op) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
      return right === 0 ? divZeroError() : left / right;
    case '%':
      return modulo(left, right);
    case '^':
      return left ** right;
    default:
      return valueError(`unknown operator "${op}"`);
  }
}

/** `IF(condition, thenValue, elseValue?)` with short-circuit evaluation. */
function evaluateIf(node: CallNode, ctx: FormulaContext): CellValue {
  if (node.args.length < 2 || node.args.length > 3) {
    return valueError('IF requires 2 or 3 arguments');
  }
  const condition = toBoolean(evaluate(node.args[0], ctx));
  if (isFormulaError(condition)) {
    return condition;
  }
  if (condition) {
    return evaluate(node.args[1], ctx);
  }
  return node.args.length === 3 ? evaluate(node.args[2], ctx) : false;
}

function evaluateCall(node: CallNode, ctx: FormulaContext): CellValue {
  if (node.name === 'IF') {
    return evaluateIf(node, ctx);
  }
  const fn = ctx.functions.get(node.name);
  if (!fn) {
    return nameError(`unknown function "${node.name}"`);
  }
  const args: CellValue[] = [];
  for (const arg of node.args) {
    if (arg.type !== 'range') {
      args.push(evaluate(arg, ctx));
    } else if (takesRange(fn)) {
      // A loop, not push(...cells): spreading throws past ~120k cells.
      for (const cell of ctx.getRange(arg.range)) args.push(toCellValue(cell));
    } else {
      // A one-cell range (A2:A2, or what fill makes of B$1:B1) is that cell.
      const { start, end } = arg.range;
      if (start.row !== end.row || start.col !== end.col) {
        return valueError(`${node.name} takes no range`);
      }
      args.push(toCellValue(ctx.getRef(start)));
    }
  }
  // A custom function may throw or return anything: keep it a cell value.
  try {
    return toCellValue(fn(args));
  } catch (error) {
    return valueError(`${node.name}: ${String(error)}`);
  }
}

/**
 * Evaluate a parsed formula against a {@link FormulaContext}. Returns the
 * computed {@link CellValue} (which may be a {@link FormulaError}). Never
 * throws for well-formed ASTs, even when a custom function does (that cell is
 * `#VALUE!`); malformed input is rejected earlier by `parseFormula`. Values
 * read from the context pass through {@link toCellValue}, so a `Date` cell
 * reads as its epoch milliseconds.
 */
export function evaluate(ast: FormulaAst, ctx: FormulaContext): CellValue {
  switch (ast.type) {
    case 'number':
      return ast.value;
    case 'string':
      return ast.value;
    case 'boolean':
      return ast.value;
    case 'ref':
      return toCellValue(ctx.getRef(ast.address));
    case 'range':
      return valueError('a range cannot be used as a single value');
    case 'unary':
      return evaluateUnary(ast, ctx);
    case 'binary':
      return finite(evaluateBinary(ast, ctx));
    case 'call':
      return finite(evaluateCall(ast, ctx));
    default:
      return valueError('unknown expression');
  }
}

// Re-exported so the recalc layer (F3) can type the values it reads/writes.
export type { CellValue, FormulaError };
