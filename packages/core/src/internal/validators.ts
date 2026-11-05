import { EN_LOCALE, type GridLocaleKey } from '../i18n/en.js';
import { interpolate, type LocaleParams } from '../i18n/localize.js';
import { parseNumberInput } from './number-input.js';
import type { Keys, Validator, ValidatorContext } from './types.js';

/**
 * Built-in declarative validators for {@link BaseColumnConfiguration.validators}
 * plus the {@link runValidators} runner that executes them.
 *
 * @remarks
 * Each factory returns a {@link Validator} — a function `(value, context) =>
 * string | null` that yields an error message when the value is invalid or
 * `null` when it passes. Bounds validators (`min` / `max`) and `pattern` treat
 * an empty value (`null` / `undefined` / `''`) as out of scope so they compose
 * cleanly with {@link required}; pair them with `required` when a value is
 * mandatory. A bounds validator fails a value that is not a number at all.
 *
 * A factory called without a `message` reports its `validation.*` locale key
 * (`validation.required`, `validation.min`, `validation.max`,
 * `validation.pattern`), resolved through the grid's `localeText` when the
 * value fails, so the English defaults below can be translated.
 */

/**
 * A default message: the `validation.*` key through the grid's `localeText`
 * when the context carries it, else the English text.
 */
function defaultMessage(
  context: { localize?: ValidatorContext<object>['localize'] } | undefined,
  key: GridLocaleKey,
  params?: LocaleParams
): string {
  return context?.localize?.(key, params) ?? interpolate(EN_LOCALE[key], params);
}

/** `true` for `null`, `undefined`, or an empty / whitespace-only string. */
function isBlank(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

/**
 * A value as a number for the bounds validators: text read as typed (full-width
 * digits, grouping and a currency mark in the column's locale) and anything
 * else as `Number()` reads it.
 */
function toNumber(value: unknown, column: { locale?: string; currency?: string }): number {
  if (typeof value !== 'string') return Number(value);
  const parsed = parseNumberInput(value, column.locale, column.currency);
  return Number.isNaN(parsed) ? Number(value) : parsed;
}

/**
 * Fails when the value is `null`, `undefined`, or an empty / whitespace-only
 * string.
 *
 * @param message - The error message. Defaults to the `validation.required`
 * locale key, `'This field is required'` in English.
 */
export function required<T extends object, K extends Keys<T> = Keys<T>>(
  message?: string
): Validator<T, K> {
  return (value, context) =>
    isBlank(value) ? (message ?? defaultMessage(context, 'validation.required')) : null;
}

/**
 * Fails when the numeric value is below `limit`, or when the value is not a
 * number. Empty values pass (compose with {@link required}).
 *
 * @param message - The error message. Defaults to the `validation.min` locale
 * key, `'Must be at least {limit}'` in English.
 */
export function min<T extends object, K extends Keys<T> = Keys<T>>(
  limit: number,
  message?: string
): Validator<T, K> {
  return (value, context) => {
    if (isBlank(value)) return null;
    const num = toNumber(value, context?.column ?? {});
    return num >= limit ? null : (message ?? defaultMessage(context, 'validation.min', { limit }));
  };
}

/**
 * Fails when the numeric value is above `limit`, or when the value is not a
 * number. Empty values pass (compose with {@link required}).
 *
 * @param message - The error message. Defaults to the `validation.max` locale
 * key, `'Must be at most {limit}'` in English.
 */
export function max<T extends object, K extends Keys<T> = Keys<T>>(
  limit: number,
  message?: string
): Validator<T, K> {
  return (value, context) => {
    if (isBlank(value)) return null;
    const num = toNumber(value, context?.column ?? {});
    return num <= limit ? null : (message ?? defaultMessage(context, 'validation.max', { limit }));
  };
}

/**
 * Fails when the string form of the value does not match `regex`. Empty values
 * pass (compose with {@link required}).
 *
 * @param message - The error message. Defaults to the `validation.pattern`
 * locale key, `'Invalid format'` in English.
 */
export function pattern<T extends object, K extends Keys<T> = Keys<T>>(
  regex: RegExp,
  message?: string
): Validator<T, K> {
  return (value, context) => {
    if (isBlank(value)) return null;
    // A global or sticky RegExp resumes from `lastIndex`, so start every
    // validation from the beginning of the value.
    regex.lastIndex = 0;
    return regex.test(String(value))
      ? null
      : (message ?? defaultMessage(context, 'validation.pattern'));
  };
}

/**
 * Wraps an arbitrary predicate as a {@link Validator}. Provided for symmetry and
 * type inference; an inline arrow function works identically.
 */
export function custom<T extends object, K extends Keys<T> = Keys<T>>(
  fn: Validator<T, K>
): Validator<T, K> {
  return fn;
}

/**
 * Runs every validator in order and collects all error messages. Returns an
 * empty array when the value passes.
 */
export function runValidators<T extends object, K extends Keys<T> = Keys<T>>(
  validators: Validator<T, K>[] | undefined,
  value: unknown,
  context: ValidatorContext<T, K>
): string[] {
  if (!validators?.length) return [];
  const errors: string[] = [];
  for (const validate of validators) {
    const message = validate(value, context);
    if (message) errors.push(message);
  }
  return errors;
}
