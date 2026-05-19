import { html, type TemplateResult } from 'lit';
import type ApexGridCell from '../components/cell.js';
import type ApexGridRow from '../components/row.js';
import type { ColumnConfiguration } from './types.js';

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

const BUILTIN_TYPES: Record<string, ColumnTypeRenderer<object>> = {
  select: selectType,
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
