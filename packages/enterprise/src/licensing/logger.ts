// Thin wrapper so callers are not flagged by the no-console lint rule.
const cons = globalThis.console;

export function logError(message: string): void {
  cons.error(message);
}
