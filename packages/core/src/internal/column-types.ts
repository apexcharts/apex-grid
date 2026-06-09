import { html, nothing, svg, type TemplateResult } from 'lit';
import { ref } from 'lit/directives/ref.js';
import type ApexGridCell from '../components/cell.js';
import type ApexGridRow from '../components/row.js';
import { renderIcon } from './icons.js';
import type { BadgeVariant, ColumnConfiguration, StatusVariant } from './types.js';

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
  /**
   * Commits a new value for this cell without entering edit mode. Only
   * present when the column is editable. Used by interactive display
   * widgets like the boolean checkbox.
   */
  commit?(value: unknown): Promise<boolean>;
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
    // Escape / Tab / focus-out are handled at the cell level; we only need
    // Enter here to commit the typed value without waiting for `change`.
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
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

    // Escape / Tab / focus-out are handled at the cell level — no per-editor
    // handlers needed here. Clicking a star is the primary commit action;
    // clicking the currently-rated star clears the rating back to 0, which
    // is the only way to get below 1 once any star is set.
    const stars = Array.from({ length: max }, (_, i) => i + 1);
    return html`<span
      part="rating-editor"
      role="radiogroup"
      aria-label="Rating"
    >
      ${stars.map(
        (rank) => html`<button
          type="button"
          part=${rank <= current ? 'rating-star filled selected' : 'rating-star'}
          role="radio"
          aria-checked=${rank === current}
          aria-label=${`${rank} of ${max}`}
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
      aria-label=${truthy ? 'true' : 'false'}
      @click=${(event: Event) => {
        // Keep the click inside the cell — we don't want it to bubble into
        // the grid body-click handler twice or trigger edit-mode logic.
        event.stopPropagation();
      }}
      @change=${
        editable
          ? (event: Event) => {
              const next = (event.target as HTMLInputElement).checked;
              ctx.commit?.(next);
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
    return html`${new Intl.NumberFormat(col.locale, {
      style: 'currency',
      currency: col.currency ?? 'USD',
    }).format(n)}`;
  },

  editor(ctx) {
    const commit = (event: Event) => {
      const raw = (event.target as HTMLInputElement).value;
      ctx.commit(raw === '' ? null : Number(raw));
    };
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        commit(event);
      }
    };
    return html`<input
      type="number"
      part="editor"
      data-apex-editor
      .value=${ctx.value == null ? '' : String(ctx.value)}
      @change=${commit}
      @keydown=${handleKeydown}
    />`;
  },
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

const sparklineType: ColumnTypeRenderer<object> = {
  display(ctx) {
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
    const delta = first === 0 ? 0 : ((last - first) / Math.abs(first)) * 100;
    const showDelta = (ctx.column as { showDelta?: boolean }).showDelta !== false;

    return html`<span part="spark-cell">
      <svg
        part="sparkline sparkline--${trend}"
        viewBox="0 0 ${width} ${height}"
        width=${width}
        height=${height}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        ${svg`<path part="spark-area" d=${area} /><path part="spark-line" d=${line} />`}
      </svg>
      ${
        showDelta
          ? html`<span part="spark-delta spark-delta--${trend}"
            >${delta > 0 ? '+' : ''}${delta.toFixed(0)}%</span
          >`
          : nothing
      }
    </span>`;
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
