import { html, nothing, type TemplateResult } from 'lit';
import type ApexGridCell from '../components/cell.js';
import type ApexGridRow from '../components/row.js';
import { renderIcon } from './icons.js';
import type { ColumnConfiguration } from './types.js';

const RATING_DEFAULT_MAX = 5;

function getRatingMax(column: { max?: number }): number {
  const max = typeof column.max === 'number' ? Math.floor(column.max) : RATING_DEFAULT_MAX;
  return max > 0 ? max : RATING_DEFAULT_MAX;
}

function clampRating(value: unknown, max: number): number {
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
  parent: ApexGridCell<T>;
  row: ApexGridRow<T>;
  column: ColumnConfiguration<T>;
  value: unknown;
}

/**
 * Cell context handed to a column-type renderer's `editor` function. Adds the
 * `commit` / `cancel` helpers wired through {@link EditingController}.
 */
export interface ColumnTypeEditorContext<T extends object> extends ColumnTypeCellContext<T> {
  commit(value: unknown): Promise<boolean>;
  cancel(): void;
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
    return html`${match?.label ?? (ctx.value as unknown as string | number | null | undefined)}`;
  },

  editor(ctx) {
    const opts = getSelectOptions(ctx.column as { options?: SelectOption[] });
    const current = ctx.value;
    const handleChange = (event: Event) => {
      const idx = (event.target as HTMLSelectElement).selectedIndex;
      const next = opts[idx]?.value;
      ctx.commit(next);
    };
    const handleKeydown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        ctx.cancel();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const el = event.target as HTMLSelectElement;
        const next = opts[el.selectedIndex]?.value;
        ctx.commit(next);
      }
    };
    return html`<select
      part="editor"
      data-apex-editor
      @change=${handleChange}
      @keydown=${handleKeydown}
    >
      ${opts.map(
        (o) =>
          html`<option .value=${String(o.value)} ?selected=${o.value === current}>
            ${o.label}
          </option>`
      )}
    </select>`;
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

function formatDateValue(value: unknown, style: string): string {
  const date = parseDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: style as Intl.DateTimeFormatOptions['dateStyle'],
  }).format(date);
}

/**
 * Returns a `next` value cast to the same shape as `original` (Date / number
 * timestamp / ISO string). Empty inputs commit `null` regardless of the
 * source shape, which is the simplest "clear" semantics.
 */
function commitDateInSameShape(original: unknown, next: Date | null): unknown {
  if (next === null) return null;
  if (original instanceof Date) return next;
  if (typeof original === 'number') return next.getTime();
  return toDateInputValue(next);
}

const dateType: ColumnTypeRenderer<object> = {
  display(ctx) {
    const style = (ctx.column as { format?: string }).format ?? 'medium';
    return html`${formatDateValue(ctx.value, style)}`;
  },

  editor(ctx) {
    const initial = parseDate(ctx.value);
    const initialInput = initial ? toDateInputValue(initial) : '';

    const handleChange = (event: Event) => {
      const raw = (event.target as HTMLInputElement).value;
      const next = raw ? parseDate(raw) : null;
      ctx.commit(commitDateInSameShape(ctx.value, next));
    };
    const handleKeydown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        ctx.cancel();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const raw = (event.target as HTMLInputElement).value;
        const next = raw ? parseDate(raw) : null;
        ctx.commit(commitDateInSameShape(ctx.value, next));
      }
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

const ratingType: ColumnTypeRenderer<object> = {
  display(ctx) {
    const max = getRatingMax(ctx.column as { max?: number });
    const value = clampRating(ctx.value, max);
    const stars = Array.from({ length: max }, (_, i) => i < value);
    return html`<span part="rating" role="img" aria-label="${value} of ${max}">
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

    const handleKeydown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        ctx.cancel();
      }
    };

    const handleFocusOut = (event: FocusEvent) => {
      const wrapper = event.currentTarget as Element;
      const next = event.relatedTarget as Node | null;
      // Cancel only when focus actually leaves the editor (not when it
      // bounces between stars).
      if (!next || !wrapper.contains(next)) {
        ctx.cancel();
      }
    };

    const stars = Array.from({ length: max }, (_, i) => i + 1);
    return html`<span
      part="rating-editor"
      role="radiogroup"
      aria-label="Rating"
      @keydown=${handleKeydown}
      @focusout=${handleFocusOut}
    >
      ${stars.map(
        (rank) => html`<button
          type="button"
          part=${rank <= current ? 'rating-star filled selected' : 'rating-star'}
          role="radio"
          aria-checked=${rank === current}
          data-rating-value=${rank}
          data-apex-editor=${rank === focusRank ? '' : nothing}
          @click=${() => commitTo(rank)}
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
    return html`<span
      part=${truthy ? 'boolean-mark filled' : 'boolean-mark'}
      role="img"
      aria-label=${truthy ? 'true' : 'false'}
    >
      ${renderIcon(truthy ? 'true' : 'false')}
    </span>`;
  },
  // No `editor` — falls through to cell.renderDefaultEditor() which already
  // produces a native <input type="checkbox"> for boolean columns.
};

const imageType: ColumnTypeRenderer<object> = {
  display(ctx) {
    const value = ctx.value;
    if (value == null || value === '') return html``;
    const shape = (ctx.column as { shape?: 'square' | 'circle' }).shape ?? 'square';
    const colAny = ctx.column as { alt?: string; key?: unknown };
    const alt = colAny.alt ?? String(colAny.key ?? '');
    return html`<img
      part=${shape === 'circle' ? 'image circle' : 'image'}
      src=${String(value)}
      alt=${alt}
      loading="lazy"
    />`;
  },
  // Editing an image URL is just text editing — fall through to the default
  // text editor for `editable: true` image columns.
};

const BUILTIN_TYPES: Record<string, ColumnTypeRenderer<object>> = {
  select: selectType,
  rating: ratingType,
  date: dateType,
  boolean: booleanType,
  image: imageType,
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
