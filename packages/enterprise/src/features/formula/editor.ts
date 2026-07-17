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
import { type CellRefFlags, formatCell, parseCellRef } from './refs.js';
import type { FormulaController } from './store.js';

export const FORMULA_EDITOR_TAG = 'apex-grid-formula-editor';

/** A cell address (data-row index + stable letter index) exchanged with the controller. */
interface EditorAddress {
  row: number;
  col: number;
}

/** Arrow keys, detected so they can be kept as plain caret navigation while editing. */
const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

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
  /** Highlight (or clear) the cells the formula being edited references. */
  highlightReferences?(src: string | null): void;
  /** The A1 address of a cell, for click/drag point-mode reference entry. */
  addressFor?(row: object, key: string): EditorAddress | null;
  /** Format the A1 reference spanning anchor→focus (single cell or `A1:C3`). */
  rangeReferenceForAddresses?(
    anchor: EditorAddress,
    focus: EditorAddress,
    absolute?: boolean
  ): string;
  /** Show (or clear) the point-mode marquee over the pointed cell/range. */
  setPointer?(range: { start: EditorAddress; end: EditorAddress } | null): void;
}

/** Whether two addresses point at the same cell. */
function sameAddress(a: EditorAddress, b: EditorAddress): boolean {
  return a.row === b.row && a.col === b.col;
}

/**
 * The next step in the F4 absoluteness cycle for a reference's `$` markers:
 * `A1 (rel,rel) -> $A$1 (abs,abs) -> A$1 (rel,abs) -> $A1 (abs,rel) -> A1`.
 */
function nextAbsFlags({ colAbsolute, rowAbsolute }: CellRefFlags): CellRefFlags {
  if (!colAbsolute && !rowAbsolute) {
    return { colAbsolute: true, rowAbsolute: true };
  }
  if (colAbsolute && rowAbsolute) {
    return { colAbsolute: false, rowAbsolute: true };
  }
  if (!colAbsolute && rowAbsolute) {
    return { colAbsolute: true, rowAbsolute: false };
  }
  return { colAbsolute: false, rowAbsolute: false };
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
    /* Floating dropdown for autocomplete + parse errors. Positioned 'fixed' (the
       editor sets left/top/width in JS from the input's rect) so it escapes the
       cell's clipping and never grows the row — a proper overlay, not in-flow.
       Token-matched ([part~=]) because the elements carry 'popover suggestions'
       / 'popover formula-error'. */
    [part~='popover'] {
      position: absolute;
      inset-block-start: calc(100% + 2px);
      inset-inline-start: 0;
      z-index: 30;
      min-inline-size: 100%;
      box-sizing: border-box;
      background: #fff;
      border: 1px solid #d0d5dd;
      border-radius: 6px;
      box-shadow:
        0 2px 6px rgba(0, 0, 0, 0.1),
        0 8px 22px rgba(0, 0, 0, 0.16);
      padding: 4px;
      font: 0.85em/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      white-space: pre;
      color: #6b7280;
    }
    [part~='formula-error'] {
      color: #b42318;
      font-weight: 600;
      white-space: normal;
      padding: 4px 8px;
      max-inline-size: 260px;
    }
    [part~='suggestions'] {
      margin: 0;
      padding: 2px;
      list-style: none;
      color: inherit;
      max-block-size: 11em;
      overflow-y: auto;
    }
    [part~='suggestion'] {
      padding: 3px 8px;
      cursor: pointer;
      color: #1f2937;
      border-radius: 4px;
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

  // --- point mode (drag / arrow reference entry) ----------------------------
  /**
   * The active point session: `'mouse'` while clicking/dragging cells to enter a
   * reference, `'none'` otherwise. A session owns a {@link #pendingSpan} of the
   * input text that the pointer rewrites live. Point mode is mouse-only — arrow
   * keys are reserved for text-caret navigation.
   */
  #pointMode: 'none' | 'mouse' = 'none';
  /** The `[start,end)` slice of `this.text` the current point session rewrites. */
  #pendingSpan: { start: number; end: number } | null = null;
  /** The point session's anchor + focus cells (the range corners). */
  #pointAnchor: EditorAddress | null = null;
  #pointFocus: EditorAddress | null = null;
  /** Whether the session emits absolute refs (`$A$1`) — set by a Shift mouse drag. */
  #pointAbsolute = false;
  /** Whether a mouse drag is currently in progress (between pointerdown and up). */
  #dragging = false;

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
    // Caret at the END (not select-all): a fully-selected field made
    // click-to-insert prepend the reference (corrupting the formula). With the
    // caret at the end, clicking a cell appends / inserts at the caret.
    const end = this.#input?.value.length ?? 0;
    this.#input?.setSelectionRange(end, end);
    this.#attachClickToInsert();
    this.#updateHighlights();
    this.#allowCellOverflow(true);
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#detachPointDrag();
    this.#gridHost?.removeEventListener('pointerdown', this.#onGridPointerDown, true);
    this.#gridHost?.removeEventListener('click', this.#onGridClickCapture, true);
    this.#gridHost?.removeEventListener('dblclick', this.#onGridClickCapture, true);
    this.#gridHost = null;
    this.controller?.highlightReferences?.(null);
    this.controller?.setPointer?.(null);
    this.#allowCellOverflow(false);
  }

  /**
   * Let the host cell's clip region open while editing so the dropdown (which
   * extends below the cell) is visible, then restore it. The cell clips by
   * default (`:host([editing]) { overflow: hidden }`).
   */
  #hostCell: HTMLElement | null = null;
  #allowCellOverflow(on: boolean): void {
    if (on) {
      this.#hostCell = this.#hostCellEl;
      if (this.#hostCell) this.#hostCell.style.overflow = 'visible';
    } else if (this.#hostCell) {
      this.#hostCell.style.overflow = '';
      this.#hostCell = null;
    }
  }

  public override updated(): void {
    if (this.#caretToRestore !== null) {
      const caret = this.#caretToRestore;
      this.#caretToRestore = null;
      this.#input?.setSelectionRange(caret, caret);
    }
  }

  /** The host cell this editor lives in (its shadow-root host), or null. */
  get #hostCellEl(): HTMLElement | null {
    const root = this.getRootNode();
    return root instanceof ShadowRoot ? (root.host as HTMLElement) : null;
  }

  public override render(): unknown {
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
    // Typing while pointing locks the pending reference into the text and ends
    // the point session (matching Sheets: a keystroke commits the picked ref).
    if (this.#pointMode !== 'none') {
      this.#endPoint();
    }
    const input = event.target as HTMLInputElement;
    this.text = input.value;
    this.error = '';
    const trimmed = this.text.trim();
    if (trimmed.startsWith('=')) {
      this.error = this.#parseError(trimmed) ?? '';
    }
    this.#updateSuggestions(input.selectionStart ?? this.text.length);
    this.#updateHighlights();
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

    // F4 cycles the absolute/relative `$` markers on the reference at the caret.
    if (event.key === 'F4' && this.text.trim().startsWith('=')) {
      event.preventDefault();
      event.stopPropagation();
      this.#cycleAbsolute();
      return;
    }

    // Arrow keys always move the text caret while editing — they never start
    // referencing cells (that was a jarring hijack of normal caret navigation).
    // Point mode is entered only by the mouse (click a cell / drag a range). If a
    // reference is still armed from a click, an arrow locks it in first, then the
    // caret moves natively (no preventDefault).
    if (ARROW_KEYS.has(event.key)) {
      if (this.#pointMode !== 'none') {
        this.#endPoint();
      }
      return;
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      this.#endPoint(); // lock any pending reference before committing
      void this.#commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (this.#pointMode !== 'none') {
        this.#cancelPoint(); // back out of point mode, stay in the edit
        return;
      }
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
    this.#updateHighlights();
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
    // The pointerdown insert prevents the default, but the browser still fires
    // the follow-up click/dblclick at the foreign cell. Those must be swallowed
    // too: the cell's own click handler moves the roving focus (and a focusout
    // on the editing cell commits), which would close this editor mid-insert.
    host.addEventListener('click', this.#onGridClickCapture, true);
    host.addEventListener('dblclick', this.#onGridClickCapture, true);
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

  /** Resolve a grid pointer event to the foreign cell's `{ record, key }`, or null. */
  #cellFromEvent(event: Event): { record: object; key: string } | null {
    const path = event.composedPath();
    if (path.includes(this)) {
      return null; // within our own editor
    }
    const ownCell = (this.getRootNode() as ShadowRoot | null)?.host;
    const cell = path.find(
      (el): el is HTMLElement => el instanceof HTMLElement && el.localName === 'apex-grid-cell'
    ) as (HTMLElement & { row?: { data?: object }; column?: { key?: PropertyKey } }) | undefined;
    if (!cell || cell === ownCell) {
      return null; // not a cell, or our own editing cell
    }
    const record = cell.row?.data;
    const key = cell.column?.key;
    return record && key != null ? { record, key: String(key) } : null;
  }

  /**
   * Swallow the click/dblclick that follows a reference-inserting pointerdown on
   * a foreign cell, so the cell never activates, steals the roving focus, or
   * opens its own editor while a formula is being authored.
   */
  #onGridClickCapture = (event: MouseEvent): void => {
    if (!this.text.trim().startsWith('=') || !this.#cellFromEvent(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  #onGridPointerDown = (event: PointerEvent): void => {
    if (!this.controller?.referenceFor || !this.text.trim().startsWith('=')) {
      return;
    }
    const hit = this.#cellFromEvent(event);
    if (!hit) {
      return;
    }
    // Insert the reference instead of letting the grid select/edit that cell.
    event.preventDefault();
    event.stopPropagation();
    const anchor = this.controller.addressFor?.(hit.record, hit.key) ?? null;
    if (!anchor || !this.controller.rangeReferenceForAddresses) {
      // Fallback: no address services -> the original single-cell insert.
      const reference = this.controller.referenceFor(hit.record, hit.key, event.shiftKey);
      if (reference) {
        this.#insertAtCaret(reference);
      }
      return;
    }
    this.#pointAbsolute = event.shiftKey;
    if (this.#pendingSpan && this.#pointMode !== 'none') {
      // A reference is still armed from the previous click/arrow (the user has
      // not typed since). Replace it in place rather than appending a new one —
      // matching Sheets, where consecutive clicks re-pick the same reference.
      this.#pointMode = 'mouse';
      this.#pointAnchor = anchor;
      this.#pointFocus = anchor;
      this.#refreshPoint();
    } else {
      // Fresh session: press seeds a single-cell ref, drag extends it to a range.
      this.#beginPoint(anchor);
    }
    this.#dragging = true;
    globalThis.addEventListener?.('pointermove', this.#onGridPointerMove, true);
    globalThis.addEventListener?.('pointerup', this.#onGridPointerUp, true);
  };

  #onGridPointerMove = (event: PointerEvent): void => {
    if (!this.#dragging || !this.#pointAnchor) {
      return;
    }
    const hit = this.#cellFromEvent(event);
    if (!hit) {
      return; // pointer left the grid; keep the last focus
    }
    const focus = this.controller?.addressFor?.(hit.record, hit.key);
    if (!focus || (this.#pointFocus && sameAddress(focus, this.#pointFocus))) {
      return;
    }
    this.#pointFocus = focus;
    this.#refreshPoint();
  };

  #onGridPointerUp = (): void => {
    if (!this.#dragging) {
      return;
    }
    // End the drag but keep the reference ARMED: a next click/arrow replaces it,
    // typing or Enter locks it, Escape cancels it. (Ending here was the bug that
    // made a second click append instead of replace.)
    this.#dragging = false;
    this.#detachPointDrag();
    this.#input?.focus();
  };

  /** Remove the transient drag listeners (safe to call when none are attached). */
  #detachPointDrag(): void {
    globalThis.removeEventListener?.('pointermove', this.#onGridPointerMove, true);
    globalThis.removeEventListener?.('pointerup', this.#onGridPointerUp, true);
  }

  // --- point mode (mouse click / drag reference entry) ----------------------

  /**
   * The `[start,end)` of the reference token the caret sits in or touches, or
   * `null`. Used so a click/arrow that lands on an existing reference *replaces*
   * it (Sheets-style) instead of inserting an adjacent, invalid one — e.g.
   * opening `=B4*C4` (caret at the end) and clicking a cell re-points `C4`.
   */
  #referenceSpanAt(caret: number): { start: number; end: number } | null {
    const pattern = /\$?[A-Za-z]+\$?[0-9]+(?::\$?[A-Za-z]+\$?[0-9]+)?/g;
    for (let match = pattern.exec(this.text); match; match = pattern.exec(this.text)) {
      const start = match.index;
      const end = start + match[0].length;
      if (caret >= start && caret <= end) {
        return { start, end };
      }
    }
    return null;
  }

  /**
   * Open a point session and seed the anchor/focus. The pending span is: an
   * explicit text selection if one exists; else the reference token the caret
   * touches (so it is replaced, not appended to); else an empty insertion point.
   */
  #beginPoint(anchor: EditorAddress): void {
    const input = this.#input;
    let start = input?.selectionStart ?? this.text.length;
    let end = input?.selectionEnd ?? start;
    if (start === end) {
      const token = this.#referenceSpanAt(start);
      if (token) {
        start = token.start;
        end = token.end;
      }
    }
    this.text = this.text.slice(0, start) + this.text.slice(end);
    this.#pointMode = 'mouse';
    this.#pendingSpan = { start, end: start };
    this.#pointAnchor = anchor;
    this.#pointFocus = anchor;
    this.#refreshPoint();
  }

  /** Rewrite the pending span to the current anchor→focus reference + marquee. */
  #refreshPoint(): void {
    if (!this.#pendingSpan || !this.#pointAnchor || !this.#pointFocus) {
      return;
    }
    const reference = this.controller?.rangeReferenceForAddresses?.(
      this.#pointAnchor,
      this.#pointFocus,
      this.#pointAbsolute
    );
    if (reference === undefined) {
      return;
    }
    const span = this.#pendingSpan;
    this.text = this.text.slice(0, span.start) + reference + this.text.slice(span.end);
    span.end = span.start + reference.length;
    this.#caretToRestore = span.end;
    this.suggestions = [];
    this.error = this.#parseError(this.text.trim()) ?? '';
    this.controller?.setPointer?.({ start: this.#pointAnchor, end: this.#pointFocus });
    this.#updateHighlights();
  }

  /** Lock the pending reference into the text and end the session (clears marquee). */
  #endPoint(): void {
    if (this.#pointMode === 'none') {
      return;
    }
    this.#pointMode = 'none';
    this.#pendingSpan = null;
    this.#pointAnchor = null;
    this.#pointFocus = null;
    this.#pointAbsolute = false;
    this.#dragging = false;
    this.#detachPointDrag();
    this.controller?.setPointer?.(null);
  }

  /** Back out of point mode: drop the pending reference text, then end the session. */
  #cancelPoint(): void {
    if (this.#pendingSpan) {
      const { start, end } = this.#pendingSpan;
      this.text = this.text.slice(0, start) + this.text.slice(end);
      this.#caretToRestore = start;
    }
    this.#endPoint();
    this.error = this.#parseError(this.text.trim()) ?? '';
    this.#updateHighlights();
  }

  /**
   * Cycle the `$` markers on the cell reference at the caret:
   * `A1 -> $A$1 -> A$1 -> $A1 -> A1`. No-op when the caret is not on a reference.
   */
  #cycleAbsolute(): void {
    const caret = this.#input?.selectionStart ?? this.text.length;
    const pattern = /\$?[A-Za-z]+\$?[0-9]+/g;
    for (let match = pattern.exec(this.text); match; match = pattern.exec(this.text)) {
      const start = match.index;
      const end = start + match[0].length;
      if (caret < start || caret > end) {
        continue;
      }
      let parsed: { address: { row: number; col: number } } & CellRefFlags;
      try {
        parsed = parseCellRef(match[0]);
      } catch {
        return; // not a valid single-cell reference (e.g. a bare column letter)
      }
      const replaced = formatCell(parsed.address, nextAbsFlags(parsed));
      this.text = this.text.slice(0, start) + replaced + this.text.slice(end);
      this.#caretToRestore = start + replaced.length;
      this.error = this.#parseError(this.text.trim()) ?? '';
      this.#updateHighlights();
      return;
    }
  }

  /**
   * Insert `text` over the current selection (or at the caret), keeping focus
   * and re-validating. Replacing the selection means a click-to-insert while a
   * range is selected swaps it, and with the caret collapsed it just inserts.
   */
  #insertAtCaret(text: string): void {
    const input = this.#input;
    const start = input?.selectionStart ?? this.text.length;
    const end = input?.selectionEnd ?? start;
    this.text = `${this.text.slice(0, start)}${text}${this.text.slice(end)}`;
    this.#caretToRestore = start + text.length;
    this.suggestions = []; // an inserted reference dismisses any open autocomplete
    this.error = this.#parseError(this.text.trim()) ?? '';
    this.#updateHighlights();
    this.#input?.focus();
  }

  /**
   * Push the cells referenced by the current formula to the grid so they light
   * up while editing (reference highlighting). Cleared when the text is not a
   * formula. Row-number + column-letter coordinates are shown by default when
   * the grid has formula columns (see the enterprise grid), so the editor no
   * longer toggles them — that avoided a jarring layout shift on each edit.
   */
  #updateHighlights(): void {
    const text = this.text.trim();
    this.controller?.highlightReferences?.(text.startsWith('=') ? text : null);
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
