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
import { type CellAddress, parseA1, type RangeAddress } from './refs.js';

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
export interface ReferenceNode {
  type: 'ref';
  address: CellAddress;
}
export interface RangeNode {
  type: 'range';
  range: RangeAddress;
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

const CELL_TOKEN = /^[A-Za-z]+[0-9]+$/;
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

    // Word: a cell reference (letters then digits), a boolean, or a name.
    WORD.lastIndex = i;
    const wordMatch = WORD.exec(input);
    if (wordMatch && wordMatch.index === i) {
      const word = wordMatch[0];
      const upper = word.toUpperCase();
      let type: TokenType;
      if (upper === 'TRUE' || upper === 'FALSE') {
        type = 'boolean';
      } else if (CELL_TOKEN.test(word)) {
        type = 'cell';
      } else {
        type = 'name';
      }
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
    const start = parseA1(startToken.value, startToken.position) as CellAddress;
    if (this.peek().type === 'colon') {
      this.next();
      const endToken = this.expect('cell', 'a cell reference after ":"');
      const end = parseA1(endToken.value, endToken.position) as CellAddress;
      return { type: 'range', range: { start, end } };
    }
    return { type: 'ref', address: start };
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
