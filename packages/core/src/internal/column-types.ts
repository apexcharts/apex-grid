import { html, nothing, svg, type TemplateResult } from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import { ref } from 'lit/directives/ref.js';
import type ApexGridCell from '../components/cell.js';
import type { ChartCellState } from '../components/chart-cell.js';
import type ApexGridRow from '../components/row.js';
import { EN_LOCALE, type GridLocaleKey } from '../i18n/en.js';
import { interpolate, type LocaleParams } from '../i18n/localize.js';
import { renderIcon } from './icons.js';
import type {
  BadgeVariant,
  ChartColumnOptions,
  ColumnConfiguration,
  StatusVariant,
} from './types.js';

const RATING_DEFAULT_MAX = 5;

/** The star count of a `'rating'` column: its `max`, or 5. */
export function getRatingMax(column: { max?: number }): number {
  const max = typeof column.max === 'number' ? Math.floor(column.max) : RATING_DEFAULT_MAX;
  return max > 0 ? max : RATING_DEFAULT_MAX;
}

/** A rating value as a whole number from 0 to `max` (0 when not a number). */
export function clampRating(value: unknown, max: number): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > max) return max;
  return Math.round(n);
}

/**
 * An option entry for a `'select'` column. May be either a bare value (the
 * displayed label is `String(value)`) or an explicit `{ value, label }` pair.
 */
export type SelectOption<V = unknown> = V | { value: V; label?: string };

/**
 * The flat, non-distributive cell context handed to a column-type renderer's
 * `display` function. Mirrors {@link ApexCellContext} but uses `unknown` for
 * `value` so renderers can author against a single shape without
 * conditional-type narrowing in generic positions.
 */
export interface ColumnTypeCellContext<T extends object> {
  /** Rendered element; may later show another record (see {@link data}). */
  parent: ApexGridCell<T>;
  /** Rendered element; may later show another record (see {@link data}). */
  row: ApexGridRow<T>;
  column: ColumnConfiguration<T>;
  value: unknown;
  /** The record this context was built for. */
  readonly data: T;
  /**
   * Commits a new value for this cell without entering edit mode. Only
   * present when the column is editable. Used by interactive display
   * widgets like the boolean checkbox. Writes to {@link data}, also after an
   * `await`.
   */
  commit?(value: unknown): Promise<boolean>;
}

/**
 * Cell context handed to a column-type renderer's `editor` function. Adds the
 * `commit` / `cancel` / `setDraft` helpers wired through
 * {@link EditingController}.
 */
export interface ColumnTypeEditorContext<T extends object> extends ColumnTypeCellContext<T> {
  /**
   * Commits the open editor's value (see `BaseApexEditorContext.commit`).
   * It commits the cell in edit when called, not {@link data}, so it should
   * not run after an `await` that outlives the edit.
   */
  commit(value: unknown): Promise<boolean>;
  cancel(): void;
  /**
   * Records the editor's uncommitted value without closing the editor. The
   * cell commits it on Tab and on focus loss, `grid.commitEdit()` commits it
   * too.
   */
  setDraft(value: unknown): void;
}

/**
 * Built-in column-type renderer contract. A renderer can supply either a
 * display template, an editor template, or both. Cells fall back to the
 * column's `cellTemplate` / `editorTemplate` / built-in primitive editor if
 * the renderer is absent.
 */
export interface ColumnTypeRenderer<T extends object> {
  /**
   * Renders the display (read-only) representation of the cell.
   *
   * @remarks
   * Called when the cell is not in edit mode and the column has no
   * `cellTemplate`. Return any lit-renderable value.
   */
  display?(ctx: ColumnTypeCellContext<T>): TemplateResult | unknown;

  /**
   * Renders the inline editor while the cell is in edit mode.
   *
   * @remarks
   * Called when the cell is in edit mode and the column has no
   * `editorTemplate`. The returned template SHOULD include `data-apex-editor`
   * on its focusable element so the cell auto-focuses it. The editor is
   * responsible for calling `ctx.commit(value)` / `ctx.cancel()`.
   */
  editor?(ctx: ColumnTypeEditorContext<T>): TemplateResult | unknown;
}

interface NormalizedSelectOption {
  value: unknown;
  label: string;
}

/**
 * Normalizes a column's `options` configuration into a uniform
 * `{ value, label }[]` list. Accepts both bare-value entries and explicit
 * `{ value, label }` pairs.
 */
export function getSelectOptions(column: { options?: SelectOption[] }): NormalizedSelectOption[] {
  const raw = column.options ?? [];
  return raw.map((entry) => {
    if (entry !== null && typeof entry === 'object' && 'value' in entry) {
      const opt = entry as { value: unknown; label?: string };
      return { value: opt.value, label: opt.label ?? String(opt.value) };
    }
    return { value: entry, label: String(entry) };
  });
}

const selectType: ColumnTypeRenderer<object> = {
  display(ctx) {
    const opts = getSelectOptions(ctx.column as { options?: SelectOption[] });
    const match = opts.find((o) => o.value === ctx.value);
    const label = match?.label ?? (ctx.value == null ? '' : String(ctx.value));
    // Closed-state display is intentionally plain text — the cell reads as
    // a normal value cell until the user double-clicks to edit. The
    // dropdown affordance appears only in edit mode (the listbox popover).
    return html`<span part="select-label">${label}</span>`;
  },

  editor(ctx) {
    const opts = getSelectOptions(ctx.column as { options?: SelectOption[] });
    const current = ctx.value;
    const match = opts.find((o) => o.value === current);
    const label = match?.label ?? (current == null ? '' : String(current));
    const selectedIdx = Math.max(
      0,
      opts.findIndex((o) => o.value === current)
    );

    // The popover is rendered as a `position: absolute` child of the cell
    // (the cell host is `position: relative`). That positions it relative
    // to the cell regardless of how the row is laid out — important
    // because the virtualizer applies `transform: translate` to each row,
    // which would re-anchor a `position: fixed` descendant onto the row.
    // The cell-level SCSS lifts `overflow: hidden` for select-type editing
    // cells so the popover can extend below the cell's box.
    const mountPopover = (el: Element | undefined) => {
      if (!el) return;
      const popover = el as HTMLElement;
      if (popover.dataset.apexFocused) return;
      popover.dataset.apexFocused = '1';
      const items = Array.from(popover.querySelectorAll<HTMLElement>('[part~="select-option"]'));
      items[selectedIdx]?.focus();
    };

    const handleKeydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const list = target.closest('[part~="select-popover"]') as HTMLElement | null;
      if (!list) return;
      const items = Array.from(list.querySelectorAll<HTMLElement>('[part~="select-option"]'));
      const idx = items.indexOf(target);
      if (idx < 0) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        items[Math.min(idx + 1, items.length - 1)]?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        items[Math.max(idx - 1, 0)]?.focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        event.stopPropagation();
        items[0]?.focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        event.stopPropagation();
        items[items.length - 1]?.focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        ctx.commit(opts[idx].value);
      }
      // Escape / Tab fall through to the cell-level handler which cancels /
      // exits — we don't consume them here so the standard exit flow applies.
    };

    return html`<span part="select-label">${label}</span>
      <div
        part="select-popover"
        role="listbox"
        @keydown=${handleKeydown}
        ${ref(mountPopover)}
      >
        ${opts.map(
          (o, i) => html`<div
            part=${o.value === current ? 'select-option selected' : 'select-option'}
            role="option"
            aria-selected=${o.value === current ? 'true' : 'false'}
            tabindex=${i === selectedIdx ? '0' : '-1'}
            data-apex-editor=${i === selectedIdx ? '' : nothing}
            @click=${() => ctx.commit(o.value)}
          >
            ${o.label}
          </div>`
        )}
      </div>`;
  },
};

/**
 * Parses a stored cell value into a `Date`, or `null` when the value can't be
 * resolved to a real date.
 *
 * @remarks
 * Accepts `Date` instances, ISO/parseable strings, and millisecond
 * timestamps. `YYYY-MM-DD` strings are interpreted as **floating dates**
 * (local midnight) rather than UTC midnight, so they render on the same
 * calendar day in every timezone.
 */
export function parseDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (match) {
      const [, y, m, d] = match;
      const date = new Date(Number(y), Number(m) - 1, Number(d));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const currencyFormatters = new Map<string, Intl.NumberFormat>();

/**
 * The cached `Intl.DateTimeFormat` for a date column's `format` style, shared
 * by the date cell and CSV export. Building a formatter costs about fifty
 * times as much as using one, so cells and export rows reuse it. An unknown
 * style falls back to `'medium'` instead of throwing on every cell.
 */
export function dateFormatter(style = 'medium'): Intl.DateTimeFormat {
  let formatter = dateFormatters.get(style);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat(undefined, {
        dateStyle: style as Intl.DateTimeFormatOptions['dateStyle'],
      });
    } catch {
      formatter = dateFormatter();
    }
    dateFormatters.set(style, formatter);
  }
  return formatter;
}

/**
 * The cached currency formatter for a column. A malformed `locale` falls back
 * to the runtime locale and a malformed `currency` to USD, keeping whichever
 * option is valid, so a bad option shows a default format instead of
 * throwing on every cell.
 */
function currencyFormatter(locale?: string, currency = 'USD'): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  let formatter = currencyFormatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
    } catch {
      let localeOk = true;
      try {
        Intl.getCanonicalLocales(locale);
      } catch {
        localeOk = false;
      }
      // Only the currency is bad: keep the column's locale with USD.
      formatter =
        localeOk && currency !== 'USD'
          ? currencyFormatter(locale)
          : currencyFormatter(undefined, currency);
    }
    currencyFormatters.set(key, formatter);
  }
  return formatter;
}

/**
 * Returns a `next` value cast to the same shape as `original` (Date / number
 * timestamp / ISO string). Empty inputs commit `null` regardless of the
 * source shape, which is the simplest "clear" semantics.
 */
export function commitDateInSameShape(original: unknown, next: Date | null): unknown {
  if (next === null) return null;
  if (original instanceof Date) return next;
  if (typeof original === 'number') return next.getTime();
  return toDateInputValue(next);
}

/**
 * Date inputs the user has typed into. Chromium fires `change` on every
 * segment keystroke of `<input type="date">`, so once the keyboard is used a
 * change only stages the draft; a change without typing (a pick from the
 * calendar popup) still commits at once. Keyed by the element so the state
 * survives re-renders of the editing cell.
 */
const typedDateInputs = new WeakSet<EventTarget>();

const dateType: ColumnTypeRenderer<object> = {
  display(ctx) {
    const date = parseDate(ctx.value);
    return date ? dateFormatter((ctx.column as { format?: string }).format).format(date) : '';
  },

  editor(ctx) {
    const initial = parseDate(ctx.value);
    const initialInput = initial ? toDateInputValue(initial) : '';
    // The record value sets the shape: ctx.value is the draft when the editor
    // resumes an edit in progress, and a cleared draft (null) has no shape.
    const { key } = ctx.column as { key: string };
    const shape = (ctx.row.data as Record<string, unknown>)[key] ?? ctx.value;

    const read = (input: HTMLInputElement) => {
      const raw = input.value;
      return commitDateInSameShape(shape, raw ? parseDate(raw) : null);
    };
    const handleChange = (event: Event) => {
      const input = event.target as HTMLInputElement;
      // A half-typed date reads as '' (badInput); keep the last full draft
      // rather than staging a clear.
      if (input.validity.badInput) return;
      if (typedDateInputs.has(input)) {
        ctx.setDraft(read(input));
      } else {
        ctx.commit(read(input));
      }
    };
    // Escape / Tab / focus-out are handled at the cell level (Tab and focus-out
    // commit the draft); Enter commits the typed value here. Enter on a
    // half-typed date (badInput, which reads as '') keeps the editor open
    // rather than committing a clear.
    const handleKeydown = (event: KeyboardEvent) => {
      const input = event.target as HTMLInputElement;
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        if (!input.validity.badInput) ctx.commit(read(input));
        return;
      }
      if (event.key !== 'Tab' && event.key !== 'Escape') typedDateInputs.add(input);
    };
    return html`<input
      type="date"
      part="editor"
      data-apex-editor
      .value=${initialInput}
      @change=${handleChange}
      @keydown=${handleKeydown}
    />`;
  },
};

/**
 * A built-in cell string through the grid's `localeText`. A cell rendered
 * without a grid (no state yet) gets the English default.
 */
function localizeCell(
  ctx: ColumnTypeCellContext<object>,
  key: GridLocaleKey,
  params?: LocaleParams
): string {
  return ctx.parent.state?.localize(key, params) ?? interpolate(EN_LOCALE[key], params);
}

/** The accessible name of a rating, `{value} of {max}` in English. */
function ratingLabel(ctx: ColumnTypeCellContext<object>, value: number, max: number): string {
  return localizeCell(ctx, 'cell.rating', { value, max });
}

const ratingType: ColumnTypeRenderer<object> = {
  display(ctx) {
    const max = getRatingMax(ctx.column as { max?: number });
    const value = clampRating(ctx.value, max);
    const stars = Array.from({ length: max }, (_, i) => i < value);
    return html`<span part="rating" role="img" aria-label=${ratingLabel(ctx, value, max)}>
      ${stars.map(
        (filled) =>
          html`<span part=${filled ? 'rating-star filled' : 'rating-star'} aria-hidden="true">
            ${renderIcon('star')}
          </span>`
      )}
    </span>`;
  },

  editor(ctx) {
    const max = getRatingMax(ctx.column as { max?: number });
    const current = clampRating(ctx.value, max);
    const focusRank = Math.max(current, 1);

    const commitTo = (next: number) => ctx.commit(clampRating(next, max));

    // Escape / Tab / focus-out are handled at the cell level — no per-editor
    // handlers needed here. Clicking a star is the primary commit action;
    // clicking the currently-rated star clears the rating back to 0, which
    // is the only way to get below 1 once any star is set.
    const stars = Array.from({ length: max }, (_, i) => i + 1);
    return html`<span
      part="rating-editor"
      role="radiogroup"
      aria-label=${ctx.parent.state?.localize('editor.rating', undefined, 'Rating') ?? 'Rating'}
    >
      ${stars.map(
        (rank) => html`<button
          type="button"
          part=${rank <= current ? 'rating-star filled selected' : 'rating-star'}
          role="radio"
          aria-checked=${rank === current}
          aria-label=${ratingLabel(ctx, rank, max)}
          data-rating-value=${rank}
          data-apex-editor=${rank === focusRank ? '' : nothing}
          @click=${() => commitTo(rank === current ? 0 : rank)}
        >
          ${renderIcon('star')}
        </button>`
      )}
    </span>`;
  },
};

const booleanType: ColumnTypeRenderer<object> = {
  display(ctx) {
    const truthy = ctx.value === true;
    const editable = typeof ctx.commit === 'function';
    // For editable boolean cells the display IS the interactive control —
    // a single click toggles and commits via `ctx.commit`, no edit mode
    // dance and no visual reflow. For non-editable cells the checkbox
    // reads as a state indicator (tabindex=-1, aria-readonly, pointer-
    // events disabled via SCSS).
    return html`<input
      type="checkbox"
      part=${truthy ? 'boolean-mark checked' : 'boolean-mark'}
      .checked=${truthy}
      tabindex=${editable ? '0' : '-1'}
      aria-readonly=${editable ? 'false' : 'true'}
      aria-label=${localizeCell(ctx, truthy ? 'cell.true' : 'cell.false')}
      @click=${(event: Event) => {
        // Keep the click inside the cell — we don't want it to bubble into
        // the grid body-click handler twice or trigger edit-mode logic.
        event.stopPropagation();
      }}
      @change=${
        editable
          ? async (event: Event) => {
              const target = event.target as HTMLInputElement;
              // A rejected commit (cancelled cellValueChanging, failed
              // validator) leaves the data alone, and Lit sees no binding
              // change to re-apply, so put the checkbox back by hand.
              if (!(await ctx.commit?.(target.checked))) target.checked = truthy;
            }
          : undefined
      }
    />`;
  },
  // No `editor` — boolean cells never enter edit mode (the display widget
  // commits directly). Programmatic `editCell` on a boolean column is a
  // no-op as far as the user can see.
};

const imageType: ColumnTypeRenderer<object> = {
  display(ctx) {
    const value = ctx.value;
    if (value == null || value === '') return html``;
    const shape = (ctx.column as { shape?: 'square' | 'circle' }).shape ?? 'square';
    const colAny = ctx.column as { alt?: string; key?: unknown };
    const alt = colAny.alt ?? String(colAny.key ?? '');
    const src = String(value);
    // Keyed by the picture: a cell re-bound to another record (a recycled
    // row, a pinned band shifting up) gets a fresh `<img>` rather than a new
    // `src` on the old one, which some engines keep painting with the
    // previous record's picture until the new one has loaded.
    return keyed(
      src,
      html`<img
        part=${shape === 'circle' ? 'image circle' : 'image'}
        src=${src}
        alt=${alt}
        loading="lazy"
      />`
    );
  },
  // Editing an image URL is just text editing — fall through to the default
  // text editor for `editable: true` image columns.
};

// ── Premium presentation renderers ─────────────────────────────────────────
// currency / avatar / badge / progress / sparkline / status. These are display
// presentations over primitive values; for sorting / filtering they behave as
// their underlying value type. Styling lives in `styles/body-cell/cell-renderers.scss`.

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function getPositiveMax(column: { max?: number }, fallback: number): number {
  const m = typeof column.max === 'number' ? column.max : fallback;
  return m > 0 ? m : fallback;
}

/** Stable 0–359 hue derived from a string, for per-row avatar tinting. */
function hashHue(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) % 360;
  }
  return hash;
}

/** Heuristic fallback mapping a free-text status to a known state. */
function inferStatus(value: unknown): StatusVariant {
  const s = String(value ?? '').toLowerCase();
  if (/churn|cancel|expired|inactive|lost|risk|fail|off|overdue/.test(s)) return 'churn';
  if (/trial|trialing|pending|new|invited|watch|paused/.test(s)) return 'trial';
  return 'active';
}

const currencyType: ColumnTypeRenderer<object> = {
  display(ctx) {
    const col = ctx.column as { currency?: string; locale?: string };
    const n = toFiniteNumber(ctx.value);
    if (n === null) return html``;
    return html`${currencyFormatter(col.locale, col.currency).format(n)}`;
  },
  // No `editor`: currency cells edit with the cell's built-in number editor.
};

const avatarType: ColumnTypeRenderer<object> = {
  display(ctx) {
    const label = ctx.value == null ? '' : String(ctx.value);
    const initial = label.trim().charAt(0).toUpperCase();
    if (!initial) return html``;
    return html`<span part="avatar" role="img" aria-label=${label} style="--ag-avatar-hue: ${hashHue(label)}"
      >${initial}</span
    >`;
  },
};

const badgeType: ColumnTypeRenderer<object> = {
  display(ctx) {
    const value = ctx.value;
    if (value == null || value === '') return html``;
    const col = ctx.column as {
      badgeVariant?: BadgeVariant | ((value: unknown) => BadgeVariant);
    };
    const variant =
      typeof col.badgeVariant === 'function'
        ? col.badgeVariant(value)
        : (col.badgeVariant ?? 'neutral');
    return html`<span part="pill pill--${variant}">${String(value)}</span>`;
  },
};

const progressType: ColumnTypeRenderer<object> = {
  display(ctx) {
    const n = toFiniteNumber(ctx.value);
    if (n === null) return html``;
    const max = getPositiveMax(ctx.column as { max?: number }, 100);
    const pct = Math.max(0, Math.min(100, (n / max) * 100));
    const tier = pct >= 80 ? 'good' : pct >= 65 ? 'watch' : 'risk';
    return html`<span part="progress">
      <span part="progress-track">
        <span part="progress-fill progress-fill--${tier}" style="width: ${pct}%"></span>
      </span>
      <span part="progress-label">${Math.round(pct)}</span>
    </span>`;
  },
};

/** The column fields a sparkline cell reads, free of the column's key type. */
interface SparklineColumn {
  locale?: string;
  showDelta?: boolean;
  sparkline?: { label?: string | ((value: unknown, data: object) => string) };
}

/**
 * The default accessible name of a sparkline cell:
 * `'{count} values, {first} to {last}, {trend}'` in English, the trend being
 * `'up {percent}%'`, `'down {percent}%'` or `'unchanged'`. The percent is the
 * delta label's, unsigned. A rise or fall from zero has no percent change, so
 * it reads the chart cell's `'{count} values, {first} to {last}'`. Numbers are
 * formatted for the column's locale. `{min}` and `{max}` are unused by the
 * defaults but passed, as `chartLabel` does, for a `localeText` override.
 */
function sparklineLabel(
  ctx: ColumnTypeCellContext<object>,
  series: number[],
  delta: number | null,
  locale: string | undefined
): string {
  const format = chartNumberFormatter(locale);
  const first = series[0];
  const last = series[series.length - 1];
  const params = {
    count: format.format(series.length),
    first: format.format(first),
    last: format.format(last),
    min: format.format(Math.min(...series)),
    max: format.format(Math.max(...series)),
  };
  if (last === first) {
    return localizeCell(ctx, 'cell.sparkline', {
      ...params,
      trend: localizeCell(ctx, 'cell.sparklineFlat'),
    });
  }
  if (delta === null) return localizeCell(ctx, 'cell.chart', params);
  const trend = localizeCell(ctx, last > first ? 'cell.sparklineUp' : 'cell.sparklineDown', {
    percent: format.format(Math.abs(delta)),
  });
  return localizeCell(ctx, 'cell.sparkline', { ...params, trend });
}

const sparklineType: ColumnTypeRenderer<object> = {
  display(ctx) {
    const column = ctx.column as SparklineColumn;
    const series = Array.isArray(ctx.value)
      ? (ctx.value.filter((v) => typeof v === 'number' && Number.isFinite(v)) as number[])
      : [];
    if (series.length < 2) return html``;

    const width = 64;
    const height = 22;
    const pad = 2;
    const min = Math.min(...series);
    const max = Math.max(...series);
    const range = max - min || 1;
    const stepX = width / (series.length - 1);
    const points = series.map((value, i) => {
      const x = i * stepX;
      const y = pad + (height - 2 * pad) * (1 - (value - min) / range);
      return `${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    const line = `M${points.join(' L')}`;
    const area = `${line} L${width} ${height} L0 ${height} Z`;

    const first = series[0];
    const last = series[series.length - 1];
    const trend = last > first ? 'up' : last < first ? 'down' : 'flat';
    // A percent change from zero is undefined, so no label then. toFixed
    // rounds a half away from zero, so a rise and a fall of the same size
    // get the same label; `|| 0` turns the '-0' of a tiny decline into 0.
    const delta = first === 0 ? null : +(((last - first) / Math.abs(first)) * 100).toFixed(0) || 0;
    // A label that is '' (or a callback returning '') gets the default, so
    // the role="img" graphic always has a name.
    const custom = column.sparkline?.label;
    const label =
      (typeof custom === 'function' ? custom(ctx.value, ctx.data) : custom) ||
      sparklineLabel(ctx, series, delta, column.locale);

    // The name carries the delta, so the visible label is hidden from
    // assistive technology rather than read a second time.
    return html`<span part="spark-cell">
      <svg
        part="sparkline sparkline--${trend}"
        viewBox="0 0 ${width} ${height}"
        width=${width}
        height=${height}
        preserveAspectRatio="none"
        role="img"
        aria-label=${label}
      >
        ${svg`<path part="spark-area" d=${area} /><path part="spark-line" d=${line} />`}
      </svg>
      ${
        delta !== null && column.showDelta !== false
          ? html`<span part="spark-delta spark-delta--${trend}" aria-hidden="true"
            >${delta > 0 ? '+' : ''}${delta}%</span
          >`
          : nothing
      }
    </span>`;
  },
};

// ── Chart (an ApexCharts chart per cell) ─────────────────────────────────

/** ApexCharts options as the renderer merges them. */
type Options = Record<string, unknown>;

/** The `chart` settings as the renderer reads them, free of the column's key type. */
interface ChartColumnConfig {
  type?: string;
  height?: number;
  width?: number | string;
  options?: ChartColumnOptions | ((value: unknown, data: object) => ChartColumnOptions);
  label?: (value: unknown, data: object) => string;
}

/** The column fields a chart cell reads. */
interface ChartColumn {
  key?: unknown;
  headerText?: string;
  locale?: string;
  chart?: ChartColumnConfig;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Merges `over` into `base`: objects merge key by key, anything else replaces. */
function mergeOptions(base: Options, over: Options): Options {
  const out: Options = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const current = out[key];
    out[key] =
      isPlainObject(current) && isPlainObject(value) ? mergeOptions(current, value) : value;
  }
  return out;
}

/**
 * Chart types that take one number per slice or ring as their `series`, not
 * a list of `{ data }` series.
 */
const NON_AXIS_CHART_TYPES = new Set(['pie', 'donut', 'radialBar', 'polarArea']);

/** The `chart.type` an options object sets, if it is a string. */
function chartTypeOf(options: Options): string | undefined {
  const type = isPlainObject(options.chart) ? options.chart.type : undefined;
  return typeof type === 'string' ? type : undefined;
}

/**
 * The column's defaults for a chart of `type`, under whatever `chart.options`
 * adds.
 */
function chartDefaults(config: ChartColumnConfig, type: string): Options {
  const defaults: Options = {
    chart: {
      type,
      height: config.height ?? 28,
      width: config.width ?? '100%',
      sparkline: { enabled: true },
      animations: { enabled: false },
      toolbar: { show: false },
      zoom: { enabled: false },
      parentHeightOffset: 0,
      // Off the accessibility tree: by default a chart is a role="application"
      // tab stop, one per row here. The cell element carries the name.
      accessibility: { enabled: false },
    },
    dataLabels: { enabled: false },
    // The cell clips overflow, so a tooltip would be cut off.
    tooltip: { enabled: false },
  };
  // One brand colour suits an axis chart; slices and rings take the
  // ApexCharts palette, so each is told apart.
  if (!NON_AXIS_CHART_TYPES.has(type)) defaults.colors = ['var(--_ag-brand)'];
  if (type === 'line' || type === 'area') defaults.stroke = { width: 1.5 };
  if (type === 'radialBar') {
    // Its own labels ('series-1', the percentage) do not fit a cell, and its
    // default margins leave no room for the ring at row height.
    defaults.plotOptions = {
      radialBar: {
        dataLabels: { show: false },
        hollow: { margin: 0, size: '40%' },
        track: { margin: 1 },
      },
    };
  }
  return defaults;
}

/**
 * Merges `over` onto the defaults for the chart type it ends up with: a
 * `chart.type` in the options (which wins the merge), else the column's
 * `chart.type`, else `'line'`.
 */
function withDefaults(config: ChartColumnConfig, over: Options): Options {
  const type = chartTypeOf(over) ?? config.type ?? 'line';
  return mergeOptions(chartDefaults(config, type), over);
}

/** Merged options per column config, for the plain-object case. */
const staticChartOptions = new WeakMap<object, Options>();
/** Per-row options per record, so a re-render of the same record is not an update. */
const rowChartOptions = new WeakMap<
  object,
  WeakMap<object, { value: unknown; options: Options }>
>();

/**
 * The settings of a chart column that has none. Shared, because the options
 * caches are keyed by this object: a fresh `{}` per render would miss them and
 * turn every re-bind into a full `updateOptions`.
 */
const NO_CHART_CONFIG: ChartColumnConfig = Object.freeze({});

/** What `chart.options` gave, as an object to merge (anything else adds nothing). */
function asOptions(value: unknown): Options {
  return isPlainObject(value) ? value : {};
}

function chartOptions(column: ChartColumn, value: unknown, data: object): Options {
  const config = column.chart ?? NO_CHART_CONFIG;
  const over = config.options;
  if (typeof over !== 'function') {
    let options = staticChartOptions.get(config);
    if (!options) {
      options = withDefaults(config, asOptions(over));
      staticChartOptions.set(config, options);
    }
    return options;
  }
  let perRecord = rowChartOptions.get(config);
  if (!perRecord) {
    perRecord = new WeakMap();
    rowChartOptions.set(config, perRecord);
  }
  const cached = perRecord.get(data);
  if (cached && cached.value === value) return cached.options;
  const options = withDefaults(config, asOptions(over(value, data)));
  perRecord.set(data, { value, options });
  return options;
}

/** A finite number, or `null` for a gap. */
function chartPoint(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * A chart cell's series. For an axis chart, a `number[]` is one series named
 * for the column and an array of `{ data }` objects is passed through; in a
 * `number[]`, `null`, `undefined` and non-finite entries are gaps. A pie,
 * donut, radial bar or polar area chart takes the `number[]` itself, one value
 * per slice or ring, with a gap as `0`. Anything else, or series with no
 * points at all, draws nothing.
 */
export function chartSeries(
  value: unknown,
  column: { headerText?: string; key?: unknown },
  type: string | undefined
): unknown[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  const numeric = value.every((v) => v == null || typeof v === 'number');
  if (NON_AXIS_CHART_TYPES.has(type ?? '')) {
    if (!numeric || value.every((v) => chartPoint(v) === null)) return [];
    return value.map((v) => chartPoint(v) ?? 0);
  }
  if (numeric) {
    const data = value.map(chartPoint);
    if (data.every((v) => v === null)) return [];
    return [{ name: column.headerText ?? String(column.key ?? ''), data }];
  }
  const isSeries = (v: unknown) => isPlainObject(v) && Array.isArray(v.data);
  if (value.every(isSeries) && value.some((v) => pointCount(v) > 0)) return value;
  return [];
}

/** A point with nothing to draw: a gap. */
function isGap(point: unknown): boolean {
  const y = Array.isArray(point) ? point[1] : isPlainObject(point) ? point.y : point;
  return y == null || (typeof y === 'number' && !Number.isFinite(y));
}

/** The points of a series that are not gaps. */
function pointCount(series: unknown): number {
  const data = isPlainObject(series) ? series.data : undefined;
  return Array.isArray(data) ? data.filter((point) => !isGap(point)).length : 0;
}

/** The y values of a series' points: numbers, `[x, y]` pairs or `{ y }` objects. */
function seriesValues(series: unknown): number[] {
  const data = isPlainObject(series) ? series.data : undefined;
  if (!Array.isArray(data)) return [];
  const out: number[] = [];
  for (const point of data) {
    const y = Array.isArray(point) ? point[1] : isPlainObject(point) ? point.y : point;
    if (typeof y === 'number' && Number.isFinite(y)) out.push(y);
  }
  return out;
}

const chartNumberFormatters = new Map<string, Intl.NumberFormat>();

function chartNumberFormatter(locale?: string): Intl.NumberFormat {
  const key = locale ?? '';
  let formatter = chartNumberFormatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(locale);
    } catch {
      formatter = new Intl.NumberFormat();
    }
    chartNumberFormatters.set(key, formatter);
  }
  return formatter;
}

/**
 * The default accessible name of a chart cell. One series reads
 * `'{count} values, {first} to {last}'` (one value, `'1 value, {value}'`);
 * points with no single number (range or candlestick data) read
 * `'{count} values'`. Several series are each named (`'{name}: …'`, an unnamed
 * one `'Series 2'`) and joined with `'; '`. The numbers of a pie, donut,
 * radial bar or polar area chart read as one series.
 */
function chartLabel(
  ctx: ColumnTypeCellContext<object>,
  series: unknown[],
  locale: string | undefined
): string {
  const format = chartNumberFormatter(locale);
  const describe = (one: unknown): string => {
    const values = seriesValues(one);
    if (!values.length) {
      const count = pointCount(one);
      return count === 1
        ? localizeCell(ctx, 'cell.chartPointsOne')
        : localizeCell(ctx, 'cell.chartPoints', { count: format.format(count) });
    }
    if (values.length === 1) {
      return localizeCell(ctx, 'cell.chartOne', { value: format.format(values[0]) });
    }
    return localizeCell(ctx, 'cell.chart', {
      count: format.format(values.length),
      first: format.format(values[0]),
      last: format.format(values[values.length - 1]),
      min: format.format(Math.min(...values)),
      max: format.format(Math.max(...values)),
    });
  };
  // A pie, donut, radial bar or polar area series is the numbers themselves.
  if (series.every((one) => typeof one === 'number')) return describe({ data: series });
  if (series.length === 1) return describe(series[0]);
  return series
    .map((one, i) => {
      const named = isPlainObject(one) && typeof one.name === 'string' ? one.name : '';
      const name =
        named || localizeCell(ctx, 'cell.chartSeriesUnnamed', { index: format.format(i + 1) });
      return localizeCell(ctx, 'cell.chartSeries', { name, label: describe(one) });
    })
    .join('; ');
}

const chartType: ColumnTypeRenderer<object> = {
  display(ctx) {
    const column = ctx.column as unknown as ChartColumn;
    const options = chartOptions(column, ctx.value, ctx.data);
    // The series shape follows the type ApexCharts will draw.
    const series = chartSeries(ctx.value, column, chartTypeOf(options));
    if (!series.length) return nothing;
    // A label callback that returns '' gets the default, so the cell's
    // role="img" always has a name.
    const label =
      column.chart?.label?.(ctx.value, ctx.data) || chartLabel(ctx, series, column.locale);
    const state: ChartCellState = { series, options, label };
    return html`<apex-grid-cell-chart .state=${state}></apex-grid-cell-chart>`;
  },
};

const statusType: ColumnTypeRenderer<object> = {
  display(ctx) {
    const value = ctx.value;
    if (value == null || value === '') return html``;
    const col = ctx.column as {
      statusVariant?: StatusVariant | ((value: unknown) => StatusVariant);
    };
    const variant =
      typeof col.statusVariant === 'function'
        ? col.statusVariant(value)
        : (col.statusVariant ?? inferStatus(value));
    return html`<span part="status status--${variant}">
      <span part="status-dot"></span>${String(value)}
    </span>`;
  },
};

const BUILTIN_TYPES: Record<string, ColumnTypeRenderer<object>> = {
  select: selectType,
  rating: ratingType,
  date: dateType,
  boolean: booleanType,
  image: imageType,
  currency: currencyType,
  avatar: avatarType,
  badge: badgeType,
  progress: progressType,
  sparkline: sparklineType,
  chart: chartType,
  status: statusType,
};

/**
 * Returns the built-in renderer for a column `type`, or `undefined` when the
 * type has no built-in display/editor (the cell falls back to plain text /
 * the primitive editor in that case).
 */
export function getColumnTypeRenderer<T extends object>(
  type?: string
): ColumnTypeRenderer<T> | undefined {
  return type ? (BUILTIN_TYPES[type] as unknown as ColumnTypeRenderer<T> | undefined) : undefined;
}
