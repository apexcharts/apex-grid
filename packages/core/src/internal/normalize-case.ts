/**
 * The text a string filter operand compares: strings as they are, `null` and
 * `undefined` as `''`, any other value (number, Date, array) through `String`,
 * case-folded unless `caseSensitive`. Total, so a cell of any type can be
 * matched by a string condition without throwing. A string cell allocates
 * nothing beyond the case fold.
 */
export function normalizeCase(value: unknown, caseSensitive?: boolean): string {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  return caseSensitive ? text : text.toLowerCase();
}
