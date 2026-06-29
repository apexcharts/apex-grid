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
  /** Available function names (built-ins + custom), for autocomplete. */
  functionNames?(): string[];
  /** Resolve a clicked cell to its A1 reference, for click-to-insert. */
  referenceFor?(row: object, key: string, absolute?: boolean): string | undefined;
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
    [part~='suggestions'] {
      margin: 0;
      padding: 2px 0;
      list-style: none;
      color: inherit;
      max-block-size: 9em;
      overflow-y: auto;
    }
    [part~='suggestion'] {
      padding: 2px 8px;
      cursor: pointer;
      color: #1f2937;
    }
    [part~='suggestion'][aria-selected='true'] {
      background: #eef2ff;
      color: #1d4ed8;
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
  /** Function-name autocomplete: the current matches and the highlighted one. */
  @state() private suggestions: string[] = [];
  @state() private activeSuggestion = 0;

  #initialized = false;
  #done = false;
  /** Caret position to restore after a programmatic text change (insert/accept). */
  #caretToRestore: number | null = null;
  /** The grid host the click-to-insert listener is attached to (for teardown). */
  #gridHost: HTMLElement | null = null;

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
    this.#attachClickToInsert();
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#gridHost?.removeEventListener('pointerdown', this.#onGridPointerDown, true);
    this.#gridHost = null;
  }

  public override updated(): void {
    if (this.#caretToRestore !== null) {
      const caret = this.#caretToRestore;
      this.#caretToRestore = null;
      this.#input?.setSelectionRange(caret, caret);
    }
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
        this.suggestions.length
          ? html`<ul part="popover suggestions" role="listbox">${this.suggestions.map(
              (name, index) =>
                html`<li
                  part="suggestion"
                  role="option"
                  aria-selected=${index === this.activeSuggestion ? 'true' : 'false'}
                  @pointerdown=${(event: Event) => this.#onSuggestionPointerDown(event, name)}
                >${name}</li>`
            )}</ul>`
          : this.error
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
    const input = event.target as HTMLInputElement;
    this.text = input.value;
    this.error = '';
    const trimmed = this.text.trim();
    if (trimmed.startsWith('=')) {
      this.error = this.#parseError(trimmed) ?? '';
    }
    this.#updateSuggestions(input.selectionStart ?? this.text.length);
  };

  #onKeydown = (event: KeyboardEvent): void => {
    // While suggestions are open, the arrow / accept / dismiss keys drive the
    // list rather than the edit, so they never reach commit / cancel.
    if (this.suggestions.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.activeSuggestion = (this.activeSuggestion + 1) % this.suggestions.length;
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.activeSuggestion =
          (this.activeSuggestion - 1 + this.suggestions.length) % this.suggestions.length;
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        this.#acceptSuggestion(this.suggestions[this.activeSuggestion]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.suggestions = [];
        return;
      }
    }

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

  // --- autocomplete ---------------------------------------------------------

  /** Recompute function-name suggestions for the partial word before the caret. */
  #updateSuggestions(caret: number): void {
    const names = this.controller?.functionNames?.();
    const partial = this.#partialNameBefore(caret);
    if (!names || partial === null) {
      this.suggestions = [];
      return;
    }
    const upper = partial.toUpperCase();
    this.suggestions = names.filter((name) => name.startsWith(upper) && name !== upper).slice(0, 8);
    this.activeSuggestion = 0;
  }

  /**
   * The function-name fragment immediately before the caret (letters only), or
   * `null` when not in formula mode or there is no such fragment.
   */
  #partialNameBefore(caret: number): string | null {
    if (!this.text.trim().startsWith('=')) {
      return null;
    }
    const match = /([A-Za-z]+)$/.exec(this.text.slice(0, caret));
    return match ? match[1] : null;
  }

  /** Replace the partial name before the caret with `NAME()`, caret inside the parens. */
  #acceptSuggestion(name: string): void {
    const caret = this.#input?.selectionStart ?? this.text.length;
    const partial = this.#partialNameBefore(caret) ?? '';
    const start = caret - partial.length;
    const after = this.text.slice(caret);
    this.text = `${this.text.slice(0, start)}${name}()${after}`;
    this.#caretToRestore = start + name.length + 1; // between the parentheses
    this.suggestions = [];
    this.error = this.#parseError(this.text.trim()) ?? '';
  }

  #onSuggestionPointerDown(event: Event, name: string): void {
    event.preventDefault(); // keep focus on the input (no blur -> no commit)
    this.#acceptSuggestion(name);
    this.#input?.focus();
  }

  // --- click-to-insert ------------------------------------------------------

  /** While open, listen for cell clicks on the owning grid to insert references. */
  #attachClickToInsert(): void {
    if (!this.controller?.referenceFor) {
      return;
    }
    const host = this.#resolveGridHost();
    if (!host) {
      return;
    }
    this.#gridHost = host;
    host.addEventListener('pointerdown', this.#onGridPointerDown, true);
  }

  /**
   * Climb out of the nested shadow roots (editor -> cell -> row -> grid) to the
   * owning grid host, so a capture listener there sees clicks on every cell of
   * this grid (and only this grid). Returns the outermost `apex-grid*` host.
   */
  #resolveGridHost(): HTMLElement | null {
    let host: HTMLElement | null = null;
    let node: Node | null = this;
    for (let depth = 0; node && depth < 6; depth += 1) {
      const root = node.getRootNode();
      if (!(root instanceof ShadowRoot)) {
        break;
      }
      const candidate = root.host as HTMLElement;
      if (candidate.localName?.startsWith('apex-grid')) {
        host = candidate;
      }
      node = candidate;
    }
    return host;
  }

  #onGridPointerDown = (event: PointerEvent): void => {
    if (!this.controller?.referenceFor || !this.text.trim().startsWith('=')) {
      return;
    }
    const path = event.composedPath();
    if (path.includes(this)) {
      return; // a click within our own editor
    }
    const ownCell = (this.getRootNode() as ShadowRoot | null)?.host;
    const cell = path.find(
      (el): el is HTMLElement => el instanceof HTMLElement && el.localName === 'apex-grid-cell'
    ) as (HTMLElement & { row?: { data?: object }; column?: { key?: PropertyKey } }) | undefined;
    if (!cell || cell === ownCell) {
      return; // not a cell, or our own editing cell
    }
    const record = cell.row?.data;
    const key = cell.column?.key;
    if (!record || key == null) {
      return;
    }
    const reference = this.controller.referenceFor(record, String(key), event.shiftKey);
    if (!reference) {
      return;
    }
    // Insert the reference instead of letting the grid select/edit that cell.
    event.preventDefault();
    event.stopPropagation();
    this.#insertAtCaret(reference);
  };

  /** Insert `text` at the caret (or end), keeping focus and re-validating. */
  #insertAtCaret(text: string): void {
    const caret = this.#input?.selectionStart ?? this.text.length;
    this.text = `${this.text.slice(0, caret)}${text}${this.text.slice(caret)}`;
    this.#caretToRestore = caret + text.length;
    this.error = this.#parseError(this.text.trim()) ?? '';
    this.#input?.focus();
  }

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
