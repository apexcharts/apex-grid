/**
 * Value model and error values for the formula engine.
 *
 * Spreadsheet-style error values (`#REF!`, `#DIV/0!`, ...) are first-class cell
 * values: they are produced by evaluation, propagate through operators and
 * functions, and render as their code text in the grid. Because a
 * {@link FormulaError} is not a `number`, it is naturally excluded from numeric
 * aggregates (sum/average), matching the aggregation engine.
 *
 * This module is pure (no DOM, no grid knowledge) and sits at the bottom of the
 * engine: every other formula module depends on the value model defined here.
 */

/** The spreadsheet error codes the engine can produce. */
export type FormulaErrorCode = '#REF!' | '#NAME?' | '#DIV/0!' | '#VALUE!' | '#CYCLE!';

/**
 * A spreadsheet error value. Carries the user-facing {@link FormulaErrorCode}
 * (the text shown in the cell) and an optional internal detail message for
 * debugging. Instances are immutable.
 */
export class FormulaError {
  constructor(
    public readonly code: FormulaErrorCode,
    public readonly detail?: string
  ) {}

  /** Renders as the error code, so the default cell renderer shows e.g. `#DIV/0!`. */
  public toString(): string {
    return this.code;
  }
}

/** A value a formula cell can hold: the evaluated result or an error value. */
export type CellValue = number | string | boolean | null | FormulaError;

/** `#REF!` — a reference points outside the grid (unknown row/column). */
export const refError = (detail?: string): FormulaError => new FormulaError('#REF!', detail);
/** `#NAME?` — an unknown function name. */
export const nameError = (detail?: string): FormulaError => new FormulaError('#NAME?', detail);
/** `#DIV/0!` — division (or modulo) by zero. */
export const divZeroError = (detail?: string): FormulaError => new FormulaError('#DIV/0!', detail);
/** `#VALUE!` — a type error (e.g. arithmetic on non-numeric text). */
export const valueError = (detail?: string): FormulaError => new FormulaError('#VALUE!', detail);
/** `#CYCLE!` — the cell participates in a circular reference (raised by recalc). */
export const cycleError = (detail?: string): FormulaError => new FormulaError('#CYCLE!', detail);

/** Type guard: is the value a {@link FormulaError}? */
export function isFormulaError(value: unknown): value is FormulaError {
  return value instanceof FormulaError;
}

/**
 * Returns the first {@link FormulaError} found in `values`, or `undefined`.
 * Used by functions and operators to propagate errors: an error operand yields
 * the same error, the spreadsheet convention.
 */
export function firstError(values: readonly CellValue[]): FormulaError | undefined {
  for (const value of values) {
    if (isFormulaError(value)) {
      return value;
    }
  }
  return undefined;
}

/**
 * Thrown by `parseFormula` when the input is not a well-formed formula. Carries
 * the 0-based character {@link position} of the offending token so the editor
 * can point at it.
 */
export class ParseError extends Error {
  constructor(
    message: string,
    public readonly position: number
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

/**
 * Coerce a value to a number for arithmetic. Booleans map to `1`/`0`, numeric
 * strings parse, empty/`null` is `0`; anything else is a `#VALUE!` error. Errors
 * pass through unchanged so they propagate.
 */
export function toNumber(value: CellValue): number | FormulaError {
  if (isFormulaError(value)) {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : valueError('non-finite number');
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (value === null) {
    return 0;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return 0;
  }
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? valueError(`cannot convert "${value}" to a number`) : parsed;
}

/**
 * Coerce a value to a boolean for logical functions. Numbers are truthy when
 * non-zero, the strings `TRUE`/`FALSE` (any case) map accordingly; `null` is
 * `false`. Other strings are a `#VALUE!` error. Errors pass through.
 */
export function toBoolean(value: CellValue): boolean | FormulaError {
  if (isFormulaError(value)) {
    return value;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (value === null) {
    return false;
  }
  const upper = value.trim().toUpperCase();
  if (upper === 'TRUE') {
    return true;
  }
  if (upper === 'FALSE' || upper === '') {
    return false;
  }
  return valueError(`cannot convert "${value}" to a boolean`);
}

/**
 * Coerce a value to its string form for text concatenation. `null` is the empty
 * string, booleans become `TRUE`/`FALSE`. Errors pass through.
 */
export function toText(value: CellValue): string | FormulaError {
  if (isFormulaError(value)) {
    return value;
  }
  if (value === null) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  return String(value);
}
