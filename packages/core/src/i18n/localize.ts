import { EN_LOCALE, type GridLocaleKey, type GridLocaleText } from './en.js';

/**
 * Values substituted into a localized string's `{placeholder}` tokens.
 */
export type LocaleParams = Record<string, string | number>;

const TOKEN = /\{(\w+)\}/g;

/**
 * Replaces `{name}` tokens in `template` with the matching value from `params`.
 * Tokens with no matching param are left untouched, so a missing value shows
 * the literal `{name}` rather than `undefined`.
 */
export function interpolate(template: string, params?: LocaleParams): string {
  if (!params) return template;
  return template.replace(TOKEN, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

/**
 * Resolves a locale key to its display string.
 *
 * @remarks
 * Resolution order: a consumer override in `overrides`, then the built-in
 * English default ({@link EN_LOCALE}), then the explicit `fallback`, then the
 * key itself as a last resort. The `fallback` lets callers localize text whose
 * key is not part of the built-in set (for example a custom filter operand's
 * own `label`). Any `{placeholder}` tokens in the resolved string are
 * interpolated from `params`.
 */
export function localize(
  overrides: GridLocaleText | undefined,
  key: GridLocaleKey,
  params?: LocaleParams,
  fallback?: string
): string {
  const template = overrides?.[key] ?? EN_LOCALE[key] ?? fallback ?? key;
  return interpolate(template, params);
}
