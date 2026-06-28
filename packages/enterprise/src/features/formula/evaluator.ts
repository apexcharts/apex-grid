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
  toNumber,
  toText,
  valueError,
} from './errors.js';
import type { FormulaFn } from './functions.js';
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

/** Render any value as text for string comparison/concatenation fallbacks. */
function asText(value: CellValue): string {
  if (isFormulaError(value)) {
    return value.code;
  }
  if (value === null) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  return String(value);
}

/** Spreadsheet `=`: same-type comparison, text case-insensitive. */
function looseEquals(a: CellValue, b: CellValue): boolean {
  if (a === null || b === null) {
    return a === b;
  }
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
  const left = asText(a).toLowerCase();
  const right = asText(b).toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
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
    const left = evaluate(node.left, ctx);
    if (isFormulaError(left)) {
      return left;
    }
    const right = evaluate(node.right, ctx);
    if (isFormulaError(right)) {
      return right;
    }
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
      return right === 0 ? divZeroError() : left % right;
    case '^': {
      const power = left ** right;
      return Number.isFinite(power) ? power : valueError('invalid exponentiation');
    }
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
    if (arg.type === 'range') {
      args.push(...ctx.getRange(arg.range));
    } else {
      args.push(evaluate(arg, ctx));
    }
  }
  return fn(args);
}

/**
 * Evaluate a parsed formula against a {@link FormulaContext}. Returns the
 * computed {@link CellValue} (which may be a {@link FormulaError}). Never
 * throws for well-formed ASTs; malformed input is rejected earlier by
 * `parseFormula`.
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
      return ctx.getRef(ast.address);
    case 'range':
      return valueError('a range cannot be used as a single value');
    case 'unary':
      return evaluateUnary(ast, ctx);
    case 'binary':
      return evaluateBinary(ast, ctx);
    case 'call':
      return evaluateCall(ast, ctx);
    default:
      return valueError('unknown expression');
  }
}

// Re-exported so the recalc layer (F3) can type the values it reads/writes.
export type { CellValue, FormulaError };
