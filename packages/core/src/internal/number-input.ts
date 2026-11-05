/**
 * Reading a number a person typed or pasted.
 *
 * Text that reaches a numeric column is not always a plain JavaScript number
 * literal. An input method in full-width mode types `１２３` and `－５`, a
 * spreadsheet copies `¥1,200`, and a German user writes `1.234,5`.
 * {@link parseNumberInput} reads all of those, and reads a plain ASCII
 * decimal (`-5`, `.5`, `1e3`) exactly as `Number()` does.
 */

/** A plain decimal literal, which `Number()` and `parseFloat` agree on. */
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * Characters outside the full-width block that an input method types for a
 * sign, separator or currency mark: the minus sign (U+2212), the long vowel
 * mark (U+30FC) kana mode types for `-`, the ideographic comma and full stop,
 * the full-width yen sign, and the ideographic, no-break and narrow no-break
 * spaces some locales group with.
 */
const IME_PUNCTUATION: Record<string, string> = {
  '\u2212': '-',
  '\u30fc': '-',
  '\u3001': ',',
  '\u3002': '.',
  '\uffe5': '¥',
  '\u3000': ' ',
  '\u00a0': ' ',
  '\u202f': ' ',
};

/** The full-width forms of ASCII (U+FF01 to U+FF5E) and {@link IME_PUNCTUATION}. */
const FOLDABLE = /[\uff01-\uff5e\u2212\u30fc\u3001\u3002\uffe5\u3000\u00a0\u202f]/g;

/**
 * `text` with what an input method types in full-width mode folded to ASCII.
 * Only those forms: a superscript, subscript or circled digit (`²`, `①`) is
 * not a digit someone typed, so it stays and the text does not read as a
 * number.
 */
function foldFullWidth(text: string): string {
  return text.replace(FOLDABLE, (c) => {
    const code = c.charCodeAt(0);
    return code >= 0xff01 && code <= 0xff5e
      ? String.fromCharCode(code - 0xfee0)
      : IME_PUNCTUATION[c];
  });
}

/** Currency marks stripped before or after a number in every locale. */
const COMMON_SYMBOLS = ['¥', '$', '€', '円'];

interface Separators {
  /** The grouping separator, NFKC-folded (a no-break space becomes a space). */
  group: string;
  /** The decimal separator, NFKC-folded. */
  decimal: string;
  /** Digits in the group nearest the decimal separator (3 almost everywhere). */
  primary: number;
  /** Digits in every group before it (2 in `en-IN`, otherwise 3). */
  secondary: number;
}

const separatorCache = new Map<string, Separators>();
const symbolCache = new Map<string, string[]>();

/** A malformed locale tag or currency code falls back to the runtime default. */
function numberFormat(locale: string | undefined, options?: Intl.NumberFormatOptions) {
  try {
    return new Intl.NumberFormat(locale, options);
  } catch {
    try {
      return new Intl.NumberFormat(undefined, options);
    } catch {
      return new Intl.NumberFormat();
    }
  }
}

function separatorsFor(locale: string | undefined): Separators {
  const key = locale ?? '';
  let separators = separatorCache.get(key);
  if (!separators) {
    const parts = numberFormat(locale).formatToParts(1234567890.5);
    const groups = parts.filter((p) => p.type === 'integer').map((p) => p.value.length);
    const primary = groups.at(-1) ?? 3;
    separators = {
      group: (parts.find((p) => p.type === 'group')?.value ?? '').normalize('NFKC'),
      decimal: (parts.find((p) => p.type === 'decimal')?.value ?? '.').normalize('NFKC'),
      primary,
      secondary: groups.length > 2 ? (groups.at(-2) ?? primary) : primary,
    };
    separatorCache.set(key, separators);
  }
  return separators;
}

/** The marks to strip, longest first so `US$` goes before `$`. */
function symbolsFor(locale: string | undefined, currency: string | undefined): string[] {
  if (!currency) return COMMON_SYMBOLS;
  const key = `${locale ?? ''}|${currency}`;
  let symbols = symbolCache.get(key);
  if (!symbols) {
    const own = numberFormat(locale, { style: 'currency', currency })
      .formatToParts(1)
      .find((p) => p.type === 'currency')
      ?.value.normalize('NFKC')
      .trim();
    symbols = [...new Set([...(own ? [own] : []), ...COMMON_SYMBOLS])].sort(
      (a, b) => b.length - a.length
    );
    symbolCache.set(key, symbols);
  }
  return symbols;
}

/** `digits` with its group separators removed, or `null` when they do not form valid groups. */
function ungroup(digits: string, { group, primary, secondary }: Separators): string | null {
  if (!group || !digits.includes(group)) return /^\d*$/.test(digits) ? digits : null;
  const groups = digits.split(group);
  const last = groups.length - 1;
  // The locale's own pattern, or uniform groups of its primary size (so
  // `1,234,567` reads in `en-IN` too).
  const fits = (size: number) =>
    groups.every((g, i) => {
      if (!/^\d+$/.test(g)) return false;
      if (i === last) return g.length === primary;
      return i === 0 ? g.length <= size : g.length === size;
    });
  return fits(secondary) || fits(primary) ? groups.join('') : null;
}

/**
 * Reads `raw` as a number, or returns `NaN` when it is not one.
 *
 * @remarks
 * Steps, in order:
 * - Trim and fold the full-width forms an input method types (U+FF01 to
 *   U+FF5E), so full-width digits, `．`, `，`, `＋`, `－` and `￥` read as their
 *   ASCII forms. The minus sign (U+2212) and the long vowel mark (U+30FC)
 *   read as `-`; the ideographic comma and full stop as `,` and `.`. Nothing
 *   else is folded: `10²` and `①` are not numbers.
 * - A plain decimal (`-5`, `.5`, `1e3`) is read by `Number()`, unchanged, in
 *   every locale: `1.5` is 1.5 in `de-DE` too, as it always was. So is
 *   `1.000`, where `.` is also the locale's grouping separator; see
 *   {@link parseLocaleNumberInput} for the reading that prefers the grouping.
 * - A currency mark before or after the number is dropped: `¥`, `$`, `€`,
 *   `円`, and the symbol of `currency` in `locale` when `currency` is given.
 *   A `%` is not: what `12.5%` means depends on the scale a column stores,
 *   so it returns `NaN` and the caller decides.
 * - The separators of `locale` (the runtime default when omitted) are read
 *   from `Intl.NumberFormat`: grouping separators are removed only where they
 *   form valid groups (`1,000` but not `1,0`), and the decimal separator is
 *   read (`1,5` in `de-DE` is `1.5`).
 *
 * Anything else, including the hexadecimal and `Infinity` forms `Number()`
 * accepts, returns `NaN`, so a caller can fall back to its own reading.
 *
 * @param raw - The text as typed or pasted.
 * @param locale - BCP 47 tag whose separators to read; the runtime locale when omitted.
 * @param currency - ISO 4217 code whose symbol may surround the number.
 */
export function parseNumberInput(raw: string, locale?: string, currency?: string): number {
  return read(raw, locale, currency, true);
}

/**
 * {@link parseNumberInput}, except that text grouped with the separators of
 * `locale` reads as grouped even where it is also a plain decimal: with a
 * `de-DE` locale, `1.000` is 1000, as `1.000.000` and `1.000 €` are, where
 * {@link parseNumberInput} keeps the plain reading 1. Text that does not form
 * valid groups (`1.5`) still reads as a plain decimal.
 *
 * Meant for text whose locale is known, such as a cell pasted into a column
 * that names its `locale`; without `locale` it is {@link parseNumberInput}.
 *
 * @param raw - The text as typed or pasted.
 * @param locale - BCP 47 tag whose separators to read.
 * @param currency - ISO 4217 code whose symbol may surround the number.
 */
export function parseLocaleNumberInput(raw: string, locale?: string, currency?: string): number {
  return read(raw, locale, currency, locale === undefined);
}

function read(
  raw: string,
  locale: string | undefined,
  currency: string | undefined,
  plainFirst: boolean
): number {
  let text = foldFullWidth(String(raw ?? '')).trim();
  if (text === '') return Number.NaN;
  if (plainFirst && DECIMAL.test(text)) return Number(text);

  let sign = '';
  const takeSign = () => {
    if (!sign && (text[0] === '-' || text[0] === '+')) {
      sign = text[0];
      text = text.slice(1).trimStart();
    }
  };
  takeSign();
  const symbols = symbolsFor(locale, currency);
  const prefix = symbols.find((s) => text.startsWith(s));
  if (prefix) {
    text = text.slice(prefix.length).trimStart();
    takeSign();
  } else {
    const suffix = symbols.find((s) => text.endsWith(s));
    if (suffix) text = text.slice(0, -suffix.length).trimEnd();
  }
  if (text === '' || text[0] === '-' || text[0] === '+') return Number.NaN;

  // The locale's reading wins over the plain one here, so `1.200 €` in
  // `de-DE` is 1200; a symbol around a plain decimal (`$1.5`) still reads.
  const separators = separatorsFor(locale);
  const at = text.indexOf(separators.decimal);
  const whole = at === -1 ? text : text.slice(0, at);
  const fraction = at === -1 ? '' : text.slice(at + separators.decimal.length);
  const digits = /^\d*$/.test(fraction) ? ungroup(whole, separators) : null;
  if (digits !== null && (digits !== '' || fraction !== '')) {
    return Number(`${sign}${digits || '0'}.${fraction || '0'}`);
  }
  return DECIMAL.test(text) ? Number(sign + text) : Number.NaN;
}
