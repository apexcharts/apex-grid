/**
 * The formula parser (F1): tokenizer plus a recursive-descent parser that turns
 * formula text into an abstract syntax tree (AST). Pure: no DOM, no grid
 * knowledge. References are resolved to {@link CellAddress}/{@link RangeAddress}
 * at parse time (A1 letter-to-index is purely positional, see {@link refs}), so
 * the AST is self-describing and {@link formulaReferences} is a simple walk.
 *
 * Grammar (lowest to highest precedence):
 *   comparison  = | <> | < | > | <= | >=
 *   concat      &
 *   additive    + -
 *   multiplicative  * / %
 *   unary       - + (prefix)
 *   power       ^ (right-associative; binds tighter than unary, so -2^2 = -4)
 *   primary     number | string | boolean | reference | range | call | ( expr )
 */
import { ParseError } from './errors.js';
import {
  type CellAddress,
  type CellRefFlags,
  formatCell,
  offsetAddress,
  parseCellRef,
  type RangeAddress,
} from './refs.js';

/** Binary operators, by category: arithmetic, concat, and comparison. */
export type BinaryOperator =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '^'
  | '&'
  | '='
  | '<>'
  | '<'
  | '>'
  | '<='
  | '>=';

/** Prefix operators. */
export type UnaryOperator = '-' | '+';

export interface NumberLiteralNode {
  type: 'number';
  value: number;
}
export interface StringLiteralNode {
  type: 'string';
  value: string;
}
export interface BooleanLiteralNode {
  type: 'boolean';
  value: boolean;
}
export interface ReferenceNode extends CellRefFlags {
  type: 'ref';
  address: CellAddress;
}
export interface RangeNode {
  type: 'range';
  range: RangeAddress;
  /** `$`-absoluteness of the start (`A1`) corner. */
  startFlags: CellRefFlags;
  /** `$`-absoluteness of the end (`C3`) corner. */
  endFlags: CellRefFlags;
}
export interface UnaryNode {
  type: 'unary';
  operator: UnaryOperator;
  operand: FormulaAst;
}
export interface BinaryNode {
  type: 'binary';
  operator: BinaryOperator;
  left: FormulaAst;
  right: FormulaAst;
}
export interface CallNode {
  type: 'call';
  name: string;
  args: FormulaAst[];
}

/** A node in the formula AST. */
export type FormulaAst =
  | NumberLiteralNode
  | StringLiteralNode
  | BooleanLiteralNode
  | ReferenceNode
  | RangeNode
  | UnaryNode
  | BinaryNode
  | CallNode;

/** The cells and ranges a formula reads, for dependency tracking + highlighting. */
export interface RefList {
  cells: CellAddress[];
  ranges: RangeAddress[];
}

// --- Tokenizer -------------------------------------------------------------

type TokenType =
  | 'number'
  | 'string'
  | 'boolean'
  | 'cell'
  | 'name'
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'colon'
  | 'eof';

interface Token {
  type: TokenType;
  value: string;
  position: number;
}

const CELL_REF = /\$?[A-Za-z]+\$?[0-9]+/y;
const WORD = /[A-Za-z]+[0-9]*/y;
const NUMBER = /[0-9]+(?:\.[0-9]+)?|\.[0-9]+/y;

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const char = input[i];

    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      i++;
      continue;
    }

    // String literal: "..." with "" as an escaped quote.
    if (char === '"') {
      const start = i;
      i++;
      let value = '';
      let closed = false;
      while (i < len) {
        if (input[i] === '"') {
          if (input[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        value += input[i];
        i++;
      }
      if (!closed) {
        throw new ParseError('unterminated string literal', start);
      }
      tokens.push({ type: 'string', value, position: start });
      continue;
    }

    // Number literal.
    NUMBER.lastIndex = i;
    const numberMatch = NUMBER.exec(input);
    if (numberMatch && numberMatch.index === i) {
      tokens.push({ type: 'number', value: numberMatch[0], position: i });
      i += numberMatch[0].length;
      continue;
    }

    // Cell reference, optionally with `$` absolute markers (A1, $A1, A$1, $A$1).
    // Tried before a bare word so a leading or embedded `$` is consumed as one
    // token (a word stops at `$`, which would otherwise split `A$1`).
    CELL_REF.lastIndex = i;
    const cellMatch = CELL_REF.exec(input);
    if (cellMatch && cellMatch.index === i) {
      tokens.push({ type: 'cell', value: cellMatch[0], position: i });
      i += cellMatch[0].length;
      continue;
    }

    // Word: a boolean literal or a function name (cell tokens were handled above).
    WORD.lastIndex = i;
    const wordMatch = WORD.exec(input);
    if (wordMatch && wordMatch.index === i) {
      const word = wordMatch[0];
      const upper = word.toUpperCase();
      const type: TokenType = upper === 'TRUE' || upper === 'FALSE' ? 'boolean' : 'name';
      tokens.push({ type, value: word, position: i });
      i += word.length;
      continue;
    }

    // Multi-character operators.
    const two = input.slice(i, i + 2);
    if (two === '<>' || two === '<=' || two === '>=') {
      tokens.push({ type: 'op', value: two, position: i });
      i += 2;
      continue;
    }

    // Single-character tokens.
    if ('+-*/^%&=<>'.includes(char)) {
      tokens.push({ type: 'op', value: char, position: i });
      i++;
      continue;
    }
    if (char === '(') {
      tokens.push({ type: 'lparen', value: char, position: i });
      i++;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'rparen', value: char, position: i });
      i++;
      continue;
    }
    if (char === ',') {
      tokens.push({ type: 'comma', value: char, position: i });
      i++;
      continue;
    }
    if (char === ':') {
      tokens.push({ type: 'colon', value: char, position: i });
      i++;
      continue;
    }

    throw new ParseError(`unexpected character "${char}"`, i);
  }

  tokens.push({ type: 'eof', value: '', position: len });
  return tokens;
}

// --- Parser ----------------------------------------------------------------

const COMPARISON_OPS = new Set(['=', '<>', '<', '>', '<=', '>=']);

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.index];
  }

  private next(): Token {
    return this.tokens[this.index++];
  }

  private expect(type: TokenType, label: string): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new ParseError(`expected ${label}`, token.position);
    }
    return this.next();
  }

  public parse(): FormulaAst {
    const expression = this.parseComparison();
    const token = this.peek();
    if (token.type !== 'eof') {
      throw new ParseError(`unexpected token "${token.value}"`, token.position);
    }
    return expression;
  }

  private parseComparison(): FormulaAst {
    let left = this.parseConcat();
    while (this.peek().type === 'op' && COMPARISON_OPS.has(this.peek().value)) {
      const operator = this.next().value as BinaryOperator;
      const right = this.parseConcat();
      left = { type: 'binary', operator, left, right };
    }
    return left;
  }

  private parseConcat(): FormulaAst {
    let left = this.parseAdditive();
    while (this.peek().type === 'op' && this.peek().value === '&') {
      this.next();
      const right = this.parseAdditive();
      left = { type: 'binary', operator: '&', left, right };
    }
    return left;
  }

  private parseAdditive(): FormulaAst {
    let left = this.parseMultiplicative();
    while (this.peek().type === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      const operator = this.next().value as BinaryOperator;
      const right = this.parseMultiplicative();
      left = { type: 'binary', operator, left, right };
    }
    return left;
  }

  private parseMultiplicative(): FormulaAst {
    let left = this.parseUnary();
    while (
      this.peek().type === 'op' &&
      (this.peek().value === '*' || this.peek().value === '/' || this.peek().value === '%')
    ) {
      const operator = this.next().value as BinaryOperator;
      const right = this.parseUnary();
      left = { type: 'binary', operator, left, right };
    }
    return left;
  }

  private parseUnary(): FormulaAst {
    const token = this.peek();
    if (token.type === 'op' && (token.value === '-' || token.value === '+')) {
      this.next();
      const operand = this.parseUnary();
      return { type: 'unary', operator: token.value as UnaryOperator, operand };
    }
    return this.parsePower();
  }

  private parsePower(): FormulaAst {
    const base = this.parsePrimary();
    if (this.peek().type === 'op' && this.peek().value === '^') {
      this.next();
      // Right-associative; the exponent may itself be unary, e.g. 2^-3.
      const exponent = this.parseUnary();
      return { type: 'binary', operator: '^', left: base, right: exponent };
    }
    return base;
  }

  private parsePrimary(): FormulaAst {
    const token = this.peek();

    switch (token.type) {
      case 'number':
        this.next();
        return { type: 'number', value: Number(token.value) };
      case 'string':
        this.next();
        return { type: 'string', value: token.value };
      case 'boolean':
        this.next();
        return { type: 'boolean', value: token.value.toUpperCase() === 'TRUE' };
      case 'cell':
        return this.parseReference();
      case 'name':
        return this.parseCall();
      case 'lparen': {
        this.next();
        const expression = this.parseComparison();
        this.expect('rparen', '")"');
        return expression;
      }
      default:
        throw new ParseError(
          token.type === 'eof' ? 'unexpected end of formula' : `unexpected token "${token.value}"`,
          token.position
        );
    }
  }

  private parseReference(): ReferenceNode | RangeNode {
    const startToken = this.next();
    const start = parseCellRef(startToken.value, startToken.position);
    if (this.peek().type === 'colon') {
      this.next();
      const endToken = this.expect('cell', 'a cell reference after ":"');
      const end = parseCellRef(endToken.value, endToken.position);
      return {
        type: 'range',
        range: { start: start.address, end: end.address },
        startFlags: { colAbsolute: start.colAbsolute, rowAbsolute: start.rowAbsolute },
        endFlags: { colAbsolute: end.colAbsolute, rowAbsolute: end.rowAbsolute },
      };
    }
    return {
      type: 'ref',
      address: start.address,
      colAbsolute: start.colAbsolute,
      rowAbsolute: start.rowAbsolute,
    };
  }

  private parseCall(): CallNode {
    const nameToken = this.next();
    this.expect('lparen', `"(" after "${nameToken.value}"`);
    const args: FormulaAst[] = [];
    if (this.peek().type !== 'rparen') {
      args.push(this.parseComparison());
      while (this.peek().type === 'comma') {
        this.next();
        args.push(this.parseComparison());
      }
    }
    this.expect('rparen', '")"');
    return { type: 'call', name: nameToken.value.toUpperCase(), args };
  }
}

/**
 * Parse formula text into an AST. A leading `=` (the spreadsheet convention) is
 * tolerated and stripped. Throws {@link ParseError} (with a character position)
 * on malformed input.
 */
export function parseFormula(input: string): FormulaAst {
  const trimmed = input.trim();
  const body = trimmed.startsWith('=') ? trimmed.slice(1) : trimmed;
  if (body.trim() === '') {
    throw new ParseError('empty formula', 0);
  }
  return new Parser(tokenize(body)).parse();
}

/**
 * Collect every cell and range a formula reads, for the dependency graph (F3)
 * and reference highlighting (F4). Duplicates are preserved (the caller dedupes
 * as needed).
 */
export function formulaReferences(ast: FormulaAst): RefList {
  const cells: CellAddress[] = [];
  const ranges: RangeAddress[] = [];

  const walk = (node: FormulaAst): void => {
    switch (node.type) {
      case 'ref':
        cells.push(node.address);
        return;
      case 'range':
        ranges.push(node.range);
        return;
      case 'unary':
        walk(node.operand);
        return;
      case 'binary':
        walk(node.left);
        walk(node.right);
        return;
      case 'call':
        for (const arg of node.args) {
          walk(arg);
        }
        return;
      default:
        return;
    }
  };

  walk(ast);
  return { cells, ranges };
}

// --- Serialization + reference offsetting (Tier 2) -------------------------

/** Operator binding strength, mirroring the parser's grammar levels. */
const BINARY_PRECEDENCE: Record<BinaryOperator, number> = {
  '=': 1,
  '<>': 1,
  '<': 1,
  '>': 1,
  '<=': 1,
  '>=': 1,
  '&': 2,
  '+': 3,
  '-': 3,
  '*': 4,
  '/': 4,
  '%': 4,
  '^': 6,
};
const UNARY_PRECEDENCE = 5;
const ATOM_PRECEDENCE = 100;

function nodePrecedence(node: FormulaAst): number {
  if (node.type === 'binary') return BINARY_PRECEDENCE[node.operator];
  if (node.type === 'unary') return UNARY_PRECEDENCE;
  return ATOM_PRECEDENCE;
}

/** Stringify a child, wrapping in parentheses only when precedence requires it. */
function stringifyChild(
  child: FormulaAst,
  parentPrecedence: number,
  wrapWhenEqual: boolean
): string {
  const text = stringifyNode(child);
  const precedence = nodePrecedence(child);
  const needsParens =
    precedence < parentPrecedence || (precedence === parentPrecedence && wrapWhenEqual);
  return needsParens ? `(${text})` : text;
}

function stringifyNode(node: FormulaAst): string {
  switch (node.type) {
    case 'number':
      return String(node.value);
    case 'string':
      return `"${node.value.replace(/"/g, '""')}"`;
    case 'boolean':
      return node.value ? 'TRUE' : 'FALSE';
    case 'ref':
      return formatCell(node.address, node);
    case 'range':
      return `${formatCell(node.range.start, node.startFlags)}:${formatCell(
        node.range.end,
        node.endFlags
      )}`;
    case 'unary':
      // The operand was parsed at unary level, so only a lower-precedence
      // parenthesized expression (e.g. `-(a+b)`) needs its parentheses back.
      return `${node.operator}${stringifyChild(node.operand, UNARY_PRECEDENCE, false)}`;
    case 'binary': {
      const precedence = BINARY_PRECEDENCE[node.operator];
      // `^` is right-associative; every other binary operator is left-associative.
      const rightAssociative = node.operator === '^';
      const left = stringifyChild(node.left, precedence, rightAssociative);
      const right = stringifyChild(node.right, precedence, !rightAssociative);
      return `${left}${node.operator}${right}`;
    }
    case 'call':
      return `${node.name}(${node.args.map(stringifyNode).join(',')})`;
  }
}

/**
 * Serialize an AST back to canonical formula source, including the leading `=`.
 * References emit their `$` absolute markers; the minimum parentheses needed to
 * round-trip the operator precedence are kept. Pure.
 */
export function stringifyFormula(ast: FormulaAst): string {
  return `=${stringifyNode(ast)}`;
}

/**
 * Return a copy of the AST with every **relative** reference shifted by
 * (`dRow`, `dCol`); axes marked absolute with `$` are left untouched. Fill and
 * intra-grid paste use this to relocate a formula. Because each reference still
 * resolves to a concrete absolute address (decision DT1), the evaluator and the
 * dependency graph need no knowledge of relative-ness. Pure.
 */
export function offsetReferences(ast: FormulaAst, dRow: number, dCol: number): FormulaAst {
  switch (ast.type) {
    case 'ref':
      return {
        type: 'ref',
        address: offsetAddress(ast.address, dRow, dCol, ast),
        colAbsolute: ast.colAbsolute,
        rowAbsolute: ast.rowAbsolute,
      };
    case 'range':
      return {
        type: 'range',
        range: {
          start: offsetAddress(ast.range.start, dRow, dCol, ast.startFlags),
          end: offsetAddress(ast.range.end, dRow, dCol, ast.endFlags),
        },
        startFlags: { ...ast.startFlags },
        endFlags: { ...ast.endFlags },
      };
    case 'unary':
      return {
        type: 'unary',
        operator: ast.operator,
        operand: offsetReferences(ast.operand, dRow, dCol),
      };
    case 'binary':
      return {
        type: 'binary',
        operator: ast.operator,
        left: offsetReferences(ast.left, dRow, dCol),
        right: offsetReferences(ast.right, dRow, dCol),
      };
    case 'call':
      return {
        type: 'call',
        name: ast.name,
        args: ast.args.map((arg) => offsetReferences(arg, dRow, dCol)),
      };
    default:
      return { ...ast };
  }
}
