export function normalizeCase(string: string, caseSensitive?: boolean) {
  return caseSensitive ? string : string.toLowerCase();
}
