/**
 * The formula cell editor (F4): a small Lit element injected as the
 * `editorTemplate` of `allowFormula` columns. It opens showing the cell's stored
 * formula (or its literal value), live-highlights cell/range references and
 * surfaces parse errors as the user types, and on commit routes through the
 * formula controller:
 *   - text starting with `=` is parsed and stored as a formula; the controller
 *     computes the value, writes it into `row[key]`, and recomputes dependents,
 *     then the editor exits via `ctx.cancel()` (the value is already written).
 *   - any other text clears a stored formula and commits the literal through the
 *     normal edit path (`ctx.commit`, so validation / history / events run).
 *
 * Routing formula writes through the controller (not `ctx.commit`) keeps a single
 * write authority for computed values and preserves cycle detection.
 */

import { registerComponent } from 'apex-grid/internal';
import { css, html, LitElement, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { ParseError } from './errors.js';
import { type FormulaAst, parseFormula } from './parser.js';
import type { FormulaController } from './store.js';

export const FORMULA_EDITOR_TAG = 'apex-grid-formula-editor';

/** The slice of `ApexEditorContext` the formula editor uses. */
export interface FormulaEditorContext {
  value: unknown;
  column: { key: PropertyKey };
  row: { data: object };
  commit: (value: unknown) => boolean | Promise<boolean>;
  cancel: () => void;
}

/** The slice of the formula controller the editor calls (key-loose for reuse). */
export interface FormulaEditorController {
  getFormula(row: object, key: string): string | undefined;
  setFormula(row: object, key: string, src: string): void;
  clearFormula(row: object, key: string): void;
  /** Optional localizer (the real controller delegates to the grid). */
  localize?(key: string): string;
}

const REFERENCE = /[A-Za-z]+[0-9]+(?::[A-Za-z]+[0-9]+)?/g;

/** Split formula text into reference and plain segments, for highlighting. */
function highlightSegments(text: string): Array<{ text: string; kind: 'ref' | 'plain' }> {
  const segments: Array<{ text: string; kind: 'ref' | 'plain' }> = [];
  let last = 0;
  REFERENCE.lastIndex = 0;
  let match = REFERENCE.exec(text);
  while (match !== null) {
    if (match.index > last) {
      segments.push({ text: text.slice(last, match.index), kind: 'plain' });
    }
    segments.push({ text: match[0], kind: 'ref' });
    last = match.index + match[0].length;
    match = REFERENCE.exec(text);
  }
  if (last < text.length) {
    segments.push({ text: text.slice(last), kind: 'plain' });
  }
  return segments;
}

/** Coerce committed literal text: empty to null, numeric to number, else text. */
function coerceLiteral(text: string): unknown {
  if (text === '') {
    return null;
  }
  const numeric = Number(text);
  return Number.isNaN(numeric) ? text : numeric;
}

/** The injected formula cell editor element. */
export class FormulaCellEditor extends LitElement {
  public static get tagName(): string {
    return FORMULA_EDITOR_TAG;
  }

  public static register(): void {
    registerComponent(FormulaCellEditor);
  }

  public static override styles = css`
    :host {
      display: block;
      position: relative;
      font: inherit;
    }
    [part='editor'] {
      font: inherit;
      box-sizing: border-box;
      inline-size: 100%;
      border: none;
      outline: none;
      padding: 0;
      background: transparent;
      color: inherit;
    }
    [part='popover'] {
      position: absolute;
      inset-block-start: 100%;
      inset-inline-start: 0;
      z-index: 5;
      min-inline-size: 100%;
      box-sizing: border-box;
      background: #fff;
      border: 1px solid #d0d5dd;
      border-radius: 0 0 4px 4px;
      padding: 3px 6px;
      font: 0.85em/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      white-space: pre;
      color: #6b7280;
    }
    [part='formula-ref'] {
      color: #1d4ed8;
      font-weight: 600;
    }
    [part='formula-error'] {
      color: #b42318;
      font-weight: 600;
      white-space: normal;
    }
  `;

  /** The grid-provided editor context. */
  @property({ attribute: false })
  public ctx: FormulaEditorContext | null = null;

  /** The formula controller this grid owns. */
  @property({ attribute: false })
  public controller: FormulaEditorController | null = null;

  @state() private text = '';
  @state() private error = '';

  #initialized = false;
  #done = false;

  public override willUpdate(): void {
    if (this.#initialized || !this.ctx) {
      return;
    }
    this.#initialized = true;
    const existing = this.#existingFormula();
    this.text = existing ?? (this.ctx.value == null ? '' : String(this.ctx.value));
  }

  public override firstUpdated(): void {
    this.#input?.focus();
    this.#input?.select();
  }

  public override render(): unknown {
    const isFormula = this.text.trim().startsWith('=');
    return html`
      <input
        part="editor"
        type="text"
        spellcheck="false"
        autocomplete="off"
        .value=${this.text}
        aria-label=${this.#label()}
        aria-invalid=${this.error ? 'true' : 'false'}
        @input=${this.#onInput}
        @keydown=${this.#onKeydown}
        @blur=${this.#onBlur}
      />
      ${
        this.error
          ? html`<div part="popover formula-error" role="alert">${this.error}</div>`
          : isFormula
            ? html`<div part="popover" aria-hidden="true">${highlightSegments(this.text).map(
                (segment) =>
                  segment.kind === 'ref'
                    ? html`<span part="formula-ref">${segment.text}</span>`
                    : segment.text
              )}</div>`
            : nothing
      }
    `;
  }

  get #input(): HTMLInputElement | null {
    return this.renderRoot?.querySelector('input') ?? null;
  }

  #label(): string {
    return this.controller?.localize?.('formula.editorLabel') ?? 'Formula';
  }

  #existingFormula(): string | undefined {
    const record = this.ctx?.row?.data;
    if (!record || !this.controller) {
      return undefined;
    }
    return this.controller.getFormula(record, String(this.ctx?.column.key));
  }

  #onInput = (event: Event): void => {
    this.text = (event.target as HTMLInputElement).value;
    this.error = '';
    const trimmed = this.text.trim();
    if (trimmed.startsWith('=')) {
      this.error = this.#parseError(trimmed) ?? '';
    }
  };

  #onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      void this.#commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.#done = true;
      this.ctx?.cancel();
    }
  };

  #onBlur = (): void => {
    void this.#commit();
  };

  async #commit(): Promise<void> {
    if (this.#done || !this.ctx) {
      return;
    }
    const text = this.text.trim();
    const record = this.ctx.row?.data;
    const key = String(this.ctx.column.key);

    if (text.startsWith('=')) {
      const parseError = this.#parseError(text);
      if (parseError) {
        this.error = parseError; // keep editing so the user can fix it
        return;
      }
      this.#done = true;
      this.controller?.setFormula(record, key, text);
      this.ctx.cancel(); // value already written by the controller
      return;
    }

    this.#done = true;
    this.controller?.clearFormula(record, key);
    await this.ctx.commit(coerceLiteral(text));
  }

  /** Parse `src`, returning an error message (with position) or undefined. */
  #parseError(src: string): string | undefined {
    try {
      const ast: FormulaAst = parseFormula(src);
      void ast;
      return undefined;
    } catch (error) {
      if (error instanceof ParseError) {
        return `${error.message} (position ${error.position})`;
      }
      return this.controller?.localize?.('formula.invalid') ?? 'Invalid formula';
    }
  }
}

/**
 * Build an `editorTemplate` that renders the formula editor bound to a grid's
 * formula controller. Registers the editor element on first use (idempotent).
 */
export function formulaEditorTemplate<T extends object>(
  controller: FormulaController<T>
): (ctx: unknown) => unknown {
  FormulaCellEditor.register();
  return (ctx: unknown) =>
    html`<apex-grid-formula-editor
      .ctx=${ctx as FormulaEditorContext}
      .controller=${controller as unknown as FormulaEditorController}
    ></apex-grid-formula-editor>`;
}
