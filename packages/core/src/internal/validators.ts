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
 * mandatory.
 */

/** `true` for `null`, `undefined`, or an empty / whitespace-only string. */
function isBlank(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

/**
 * Fails when the value is `null`, `undefined`, or an empty / whitespace-only
 * string.
 */
export function required<T extends object, K extends Keys<T> = Keys<T>>(
  message = 'This field is required'
): Validator<T, K> {
  return (value) => (isBlank(value) ? message : null);
}

/**
 * Fails when the numeric value is below `limit`. Non-numeric and empty values
 * pass (compose with {@link required}).
 */
export function min<T extends object, K extends Keys<T> = Keys<T>>(
  limit: number,
  message = `Must be at least ${limit}`
): Validator<T, K> {
  return (value) => {
    if (isBlank(value)) return null;
    const num = Number(value);
    return Number.isNaN(num) || num >= limit ? null : message;
  };
}

/**
 * Fails when the numeric value is above `limit`. Non-numeric and empty values
 * pass (compose with {@link required}).
 */
export function max<T extends object, K extends Keys<T> = Keys<T>>(
  limit: number,
  message = `Must be at most ${limit}`
): Validator<T, K> {
  return (value) => {
    if (isBlank(value)) return null;
    const num = Number(value);
    return Number.isNaN(num) || num <= limit ? null : message;
  };
}

/**
 * Fails when the string form of the value does not match `regex`. Empty values
 * pass (compose with {@link required}).
 */
export function pattern<T extends object, K extends Keys<T> = Keys<T>>(
  regex: RegExp,
  message = 'Invalid format'
): Validator<T, K> {
  return (value) => {
    if (isBlank(value)) return null;
    return regex.test(String(value)) ? null : message;
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
