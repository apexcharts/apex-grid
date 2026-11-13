import { type GridLocaleKey, localize } from 'apex-grid';
import { isComposing, registerComponent, trackCompositions } from 'apex-grid/internal';
import { css, html, LitElement, nothing, type PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { AIMode, AIResult, Plan } from './features/ai/index.js';
import { OverlayTheme } from './features/carry-theme.js';
import {
  captureFocus,
  type FocusReturn,
  focusGrid,
  isPanelCycleKey,
  returnFocus,
} from './features/focus-return.js';
import { PanelGeometry } from './features/panel-geometry.js';
import type { ApexGridEnterprise, ApexGridEnterpriseHost } from './grid-enterprise.js';

export const AI_TAG = 'apex-grid-ai';

/** One completed turn, kept for the in-panel transcript. */
interface TranscriptEntry {
  prompt: string;
  summary: string;
  /** The reasoner that produced the plan (`'rule'`, `'llm:claude'`, …). */
  source: string;
  mode: AIMode;
}

/**
 * The applied slices as the user reads them: enterprise fields
 * (`modules.enterprise.groupBy`) by name, in place of the bare `modules` slice.
 */
function appliedLabels(applied: readonly string[]): string {
  const fields = applied
    .filter((slice) => slice.startsWith('modules.'))
    .map((slice) => slice.slice(slice.lastIndexOf('.') + 1));
  const slices = applied.filter(
    (slice) => !slice.startsWith('modules.') && !(slice === 'modules' && fields.length)
  );
  return [...slices, ...fields].join(', ');
}

/**
 * Prompt panel for the enterprise grid's AI Toolkit. Mount it beside a grid and
 * set its `grid` property: it sends a natural-language prompt through the grid's
 * {@link ApexGridEnterprise.runPrompt} (the built-in rule engine, plus any
 * {@link ApexGridEnterprise.aiReasoner}), then shows what changed with a one-click
 * **Undo**, or the answer in ask mode.
 *
 * Two container modes via `mode`: `'inline'` renders in place; `'dialog'` (the
 * default) is a floating, draggable panel. The element holds no API key and never
 * imports an LLM SDK: it only calls the grid, which owns the reasoning.
 *
 * The dialog is non-modal: it floats beside the live grid, so Tab moves on out
 * of it in document order. Escape closes it and returns focus to where it came
 * from; F6 or the header's "Back to grid" button moves focus to the grid's
 * active cell, and F6 in the grid comes back.
 *
 * @element apex-grid-ai
 *
 * A **source badge** shows whether each result came from the deterministic rule
 * engine or an LLM reasoner; **Preview** dry-runs the prompt through
 * {@link ApexGridEnterprise.previewPrompt} (nothing is applied) so the planned
 * steps can be inspected first; and a **transcript** logs past turns.
 *
 * @fires apex-ai-result - After a prompt resolves: `{ result }` (the {@link AIResult}).
 * @fires apex-ai-closed - When a dialog panel is dismissed.
 *
 * @csspart panel - The panel container.
 * @csspart header - Dialog header (drag handle + title + close).
 * @csspart move-handle - Dialog header button that moves the panel with the arrow keys.
 * @csspart resize-handle - Dialog corner grip that resizes the panel (arrow keys or drag).
 * @csspart back-to-grid - Dialog header button that moves focus to the grid.
 * @csspart close - Dialog close button.
 * @csspart body - The prompt + result body.
 * @csspart mode-button - A Control / Ask mode toggle button.
 * @csspart input - The prompt textarea.
 * @csspart send - The send / cancel button.
 * @csspart preview-button - The preview (dry-run) button.
 * @csspart result - The result region (applied summary or answer).
 * @csspart abstention - The region shown when the prompt could not be mapped.
 * @csspart preview - The preview region (planned steps, not applied).
 * @csspart source - The badge naming the reasoner that produced a result.
 * @csspart undo - The undo button (control mode).
 * @csspart warnings - The notes / warnings list.
 * @csspart notice - The thinking / empty notice.
 * @csspart error - The error message.
 * @csspart history - The transcript region.
 * @csspart history-item - One past turn in the transcript.
 * @csspart clear-history - The button that clears the transcript.
 */
export class ApexGridAI extends LitElement {
  public static get tagName(): string {
    return AI_TAG;
  }

  public static register(): void {
    registerComponent(ApexGridAI);
  }

  public static override styles = css`
    /* Popup tokens (carried from the bound grid): unset, the controls keep
       the browser's own colours. */
    :where(button, input, select, textarea) {
      color: var(--_ag-overlay-text, revert);
    }
    :where(input:not([type='checkbox'], [type='radio']), select, textarea) {
      background-color: var(--_ag-overlay, revert);
    }
    :host {
      display: block;
      font: 0.8rem/1.4 var(--_ag-overlay-font, system-ui, sans-serif);
      color: var(--_ag-overlay-text, #1f2328);
    }
    :host([mode='dialog']) {
      position: fixed;
      inset: auto 24px 24px auto;
      z-index: 11000;
    }
    :host([mode='dialog']:not([open])) {
      display: none;
    }
    [part='panel'] {
      box-sizing: border-box;
      background: var(--_ag-overlay, #fff);
      border: 1px solid var(--_ag-overlay-line, #d8dade);
      border-radius: 8px;
    }
    :host([mode='dialog']) [part='panel'] {
      position: fixed;
      inset: auto 24px 24px auto;
      /* A column, so a panel the grip made shorter than its content scrolls the body. */
      display: flex;
      flex-direction: column;
      inline-size: 380px;
      max-inline-size: 92vw;
      max-block-size: 92vh;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
    }
    :host([mode='dialog']) [part='body'] {
      flex: 1 1 auto;
      min-block-size: 0;
      overflow: auto;
    }
    [part='move-handle'],
    [part='resize-handle'] {
      display: inline-grid;
      place-items: center;
      flex: none;
      padding: 0;
      border: none;
      border-radius: 4px;
      background: none;
      color: var(--_ag-overlay-muted, #6b7280);
      touch-action: none;
    }
    [part='move-handle'] {
      inline-size: 24px;
      block-size: 24px;
      margin-inline-start: -6px;
      cursor: move;
    }
    [part='resize-handle'] {
      position: absolute;
      inset-block-end: 2px;
      inset-inline-end: 2px;
      inline-size: 16px;
      block-size: 16px;
      cursor: nwse-resize;
    }
    [part='resize-handle']:dir(rtl) {
      cursor: nesw-resize;
    }
    [part='resize-handle']:dir(rtl) svg {
      transform: scaleX(-1);
    }
    [part='header'] {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 12px;
      border-block-end: 1px solid var(--_ag-overlay-line, #eef0f4);
      cursor: move;
      touch-action: none;
      font-weight: 600;
    }
    [part='back-to-grid'] {
      margin-inline-start: auto;
      padding: 2px 8px;
      border: 1px solid var(--_ag-overlay-line, #d0d5dd);
      border-radius: 4px;
      background: none;
      font: inherit;
      font-size: 0.72rem;
      font-weight: 500;
      cursor: pointer;
      min-height: 24px;
    }
    [part='close'] {
      cursor: pointer;
      border: none;
      background: none;
      font-size: 16px;
      line-height: 1;
      color: var(--_ag-overlay-muted, #6b7280);
      min-width: 24px;
      min-height: 24px;
    }
    [part='body'] {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px 12px;
    }
    .modes {
      display: flex;
      gap: 6px;
    }
    [part='mode-button'] {
      font: inherit;
      font-size: 0.75rem;
      padding: 4px 10px;
      border: 1px solid var(--_ag-overlay-line, #d0d5dd);
      background: var(--_ag-overlay, #fff);
      border-radius: 4px;
      cursor: pointer;
    }
    [part='mode-button'][aria-pressed='true'] {
      background: var(--_ag-overlay-text, #1f2328);
      color: var(--_ag-overlay, #fff);
      border-color: var(--_ag-overlay-text, #1f2328);
    }
    [part='input'] {
      font: inherit;
      box-sizing: border-box;
      inline-size: 100%;
      min-block-size: 60px;
      resize: vertical;
      padding: 6px 8px;
      border: 1px solid var(--_ag-overlay-line, #d0d5dd);
      border-radius: 4px;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    [part='send'] {
      font: inherit;
      padding: 5px 14px;
      border: 1px solid var(--_ag-overlay-text, #1f2328);
      background: var(--_ag-overlay-text, #1f2328);
      color: var(--_ag-overlay, #fff);
      border-radius: 4px;
      cursor: pointer;
      min-height: 24px;
    }
    [part='send'][disabled] {
      opacity: 0.5;
      cursor: default;
    }
    [part='result'] {
      font-size: 0.78rem;
    }
    [part='abstention'] {
      font-size: 0.78rem;
      color: var(--_ag-overlay-muted, #475467);
    }
    [part='undo'] {
      font: inherit;
      font-size: 0.75rem;
      margin-block-start: 6px;
      padding: 3px 10px;
      border: 1px solid var(--_ag-overlay-line, #d0d5dd);
      background: var(--_ag-overlay, #fff);
      border-radius: 4px;
      cursor: pointer;
      min-height: 24px;
    }
    [part='undo'][disabled] {
      opacity: 0.5;
      cursor: default;
    }
    [part='warnings'] {
      color: #92400e;
      margin-block-start: 4px;
    }
    [part='notice'] {
      color: var(--_ag-overlay-muted, #888);
      font-style: italic;
    }
    [part='error'] {
      color: #b42318;
    }
    [part='preview-button'] {
      font: inherit;
      padding: 5px 12px;
      border: 1px solid var(--_ag-overlay-line, #d0d5dd);
      background: var(--_ag-overlay, #fff);
      color: var(--_ag-overlay-text, #1f2328);
      border-radius: 4px;
      cursor: pointer;
      min-height: 24px;
    }
    [part='preview-button'][disabled] {
      opacity: 0.5;
      cursor: default;
    }
    [part='source'] {
      font-size: 0.68rem;
      font-weight: 600;
      color: var(--_ag-overlay-muted, #57606a);
      background: var(--_ag-overlay-hover, #f3f4f6);
      border: 1px solid var(--_ag-overlay-line, #e5e7eb);
      border-radius: 10px;
      padding: 0 7px;
      vertical-align: middle;
      white-space: nowrap;
    }
    [part='preview'] {
      font-size: 0.78rem;
      color: var(--_ag-overlay-muted, #475467);
    }
    [part='history'] {
      margin-block-start: 4px;
      border-block-start: 1px solid var(--_ag-overlay-line, #eef0f4);
      padding-block-start: 6px;
    }
    .history-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-weight: 600;
      font-size: 0.72rem;
      color: var(--_ag-overlay-muted, #6b7280);
    }
    [part='clear-history'] {
      font: inherit;
      font-size: 0.7rem;
      border: none;
      background: none;
      color: var(--_ag-overlay-muted, #6b7280);
      cursor: pointer;
      text-decoration: underline;
    }
    [part='history-item'] {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: baseline;
    }
    .hist-prompt {
      font-weight: 600;
    }
    .hist-summary {
      color: var(--_ag-overlay-muted, #6b7280);
    }
    ul {
      margin: 4px 0 0;
      padding-inline-start: 18px;
    }
  `;

  /**
   * The enterprise grid to drive. Setting it binds the panel; binding another grid retires the
   * in-flight turn and clears the result, Undo and transcript of the old one. Labels follow the
   * grid's `localeText`: the toolbar's Ask AI dialog re-renders on a change, while a panel the
   * app mounts itself needs `requestUpdate()` after the app changes `localeText`.
   */
  @property({ attribute: false })
  public grid: ApexGridEnterpriseHost | null = null;

  constructor() {
    super();
    // The bound grid's popup colours (`--ag-overlay`, Ignite UI), carried onto this element.
    this.addController(new OverlayTheme(this));
  }

  /** `'inline'` renders in place; `'dialog'` (default) is a floating, draggable panel. */
  @property({ reflect: true })
  public mode: 'inline' | 'dialog' = 'dialog';

  /** Dialog open state (no-op for `mode="inline"`). */
  @property({ type: Boolean, reflect: true })
  public open = false;

  @state() private prompt = '';
  @state() private currentMode: AIMode = 'control';
  @state() private busy = false;
  @state() private error = '';
  @state() private result: AIResult | null = null;
  @state() private undone = false;
  @state() private previewPlan: Plan | null = null;
  @state() private transcript: TranscriptEntry[] = [];
  /** The last turn was cancelled by the user (Cancel, Escape or close while thinking). */
  @state() private cancelled = false;

  /** The in-flight turn; a turn whose controller is no longer this one has been retired. */
  #controller: AbortController | null = null;
  /** The grid the in-flight turn was started for. */
  #turnGrid: ApexGridAI['grid'] = null;
  /** Header drag, the Move panel control and the Resize panel grip of the dialog. */
  #geometry = new PanelGeometry(this, {
    panelBox: () => this.renderRoot?.querySelector<HTMLElement>('[part="panel"]') ?? null,
    localeText: () => this.grid?.localeText,
    announcer: () => this.grid ?? null,
    floating: () => this.mode === 'dialog',
  });
  /** What had focus before {@link show}, so a dialog close can put focus back. */
  #restoreFocus: FocusReturn | null = null;

  /** Resolve a locale key against the bound grid's overrides (English when unbound). */
  #t = (key: GridLocaleKey, fallback?: string): string =>
    localize(this.grid?.localeText, key, undefined, fallback);

  public override connectedCallback(): void {
    super.connectedCallback();
    trackCompositions();
  }

  public override disconnectedCallback(): void {
    // Leaving the page (its grid parked the dialog) retires the turn quietly, with no notice.
    this.#retire();
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    // Re-bound to another grid: nothing from the old one may land here (its Undo reverts it).
    if (changed.get('grid')) {
      this.transcript = [];
      // A turn already started on the new grid (a send in the same task) is kept: #begin
      // cleared the old outcome when it started.
      if (this.#controller && this.#turnGrid === this.grid) return;
      this.#retire();
      this.#clear();
      this.undone = false;
    }
  }

  /** Open the dialog panel and move focus into the prompt. */
  public show(): void {
    this.open = true;
    // Remember where focus came from so close() can put it back (dialog a11y). A second show()
    // while focus is already inside keeps the original target.
    if (!this.matches(':focus-within')) this.#restoreFocus = captureFocus();
    void this.updateComplete.then(() => this.#focus('input'));
  }

  /** Close the dialog panel and notify (so a launcher can remove it). */
  public close(): void {
    this.open = false;
    // A move announced after the close would talk over the focus returning to the grid.
    this.#geometry.cancel();
    this.#cancel();
    this.dispatchEvent(new CustomEvent('apex-ai-closed', { bubbles: true, composed: true }));
    const previous = this.#restoreFocus;
    this.#restoreFocus = null;
    // A body cell gets focus back by its address: rows may have re-bound while open.
    if (this.mode === 'dialog') returnFocus(previous);
  }

  /**
   * Escape closes the dialog. It is non-modal, so Tab is left alone and F6 moves to the grid (a
   * grid that opened the panel handles F6 first, to cycle through its open panels).
   */
  #onKeydown = (event: KeyboardEvent): void => {
    // Escape in an IME conversion in the prompt cancels the conversion.
    if (this.mode !== 'dialog' || !this.open || isComposing(event)) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.close();
    } else if (isPanelCycleKey(event) && !event.defaultPrevented && focusGrid(this.grid)) {
      event.preventDefault();
    }
  };

  #onInputKeydown = (event: KeyboardEvent): void => {
    // Cmd/Ctrl + Enter sends, matching common prompt-box conventions; never
    // the Enter that confirms an IME conversion.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !isComposing(event)) {
      event.preventDefault();
      void this.#send();
    }
  };

  #focus(name: string): void {
    this.renderRoot.querySelector<HTMLElement>(`[part="${name}"]`)?.focus();
  }

  /** Forget the last outcome: its error, cancel notice, result and preview. */
  #clear(): void {
    this.error = '';
    this.cancelled = false;
    this.result = null;
    this.previewPlan = null;
  }

  /** Start a turn: clear the last outcome, show it as busy, and return its controller. */
  #begin(): AbortController {
    this.#clear();
    this.busy = true;
    this.#turnGrid = this.grid;
    this.#controller = new AbortController();
    return this.#controller;
  }

  /** End a turn that is still current (a retired one already reset the panel). */
  #end(controller: AbortController): void {
    if (controller !== this.#controller) return;
    this.#controller = null;
    this.busy = false;
  }

  /** Abort the in-flight turn and stop waiting on it: its late result or error is dropped. */
  #retire(): void {
    this.#controller?.abort();
    this.#controller = null;
    this.#turnGrid = null;
    this.busy = false;
  }

  async #send(): Promise<void> {
    const grid = this.grid;
    const prompt = this.prompt.trim();
    if (!grid || this.busy || !prompt) return;
    this.undone = false;
    const controller = this.#begin();
    try {
      const result = await grid.runPrompt(this.prompt, {
        mode: this.currentMode,
        signal: controller.signal,
      });
      if (controller !== this.#controller) return;
      this.result = result;
      this.transcript = [
        ...this.transcript,
        {
          prompt,
          summary: this.#summarize(result),
          source: result.plan.source,
          mode: result.mode,
        },
      ];
      this.dispatchEvent(
        new CustomEvent('apex-ai-result', { detail: { result }, bubbles: true, composed: true })
      );
    } catch (error) {
      this.#fail(controller, error);
    } finally {
      this.#end(controller);
    }
  }

  /** Dry-run the prompt: show the plan the reasoner would run, applying nothing. */
  async #preview(): Promise<void> {
    const grid = this.grid;
    if (!grid || this.busy || !this.prompt.trim()) return;
    // Preview disables while busy, which drops its focus out of the dialog: hand it to Send.
    if (this.shadowRoot?.activeElement?.getAttribute('part') === 'preview-button') {
      void this.updateComplete.then(() => this.#focus('send'));
    }
    const controller = this.#begin();
    try {
      const plan = await grid.previewPrompt(this.prompt, {
        mode: this.currentMode,
        signal: controller.signal,
      });
      if (controller === this.#controller) this.previewPlan = plan;
    } catch (error) {
      this.#fail(controller, error);
    } finally {
      this.#end(controller);
    }
  }

  /**
   * Show a failed turn's error. A retired turn (Cancel, close, a disconnect or a re-bind) shows
   * nothing: its abort is not a failure, and the panel already says what happened.
   */
  #fail(controller: AbortController, error: unknown): void {
    if (controller === this.#controller) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  #cancel(): void {
    if (!this.#controller) return;
    this.#retire();
    this.cancelled = true;
  }

  #undo(): void {
    if (this.result?.mode === 'control' && !this.undone) {
      this.result.undo();
      this.undone = true;
      // The button disables, which drops its focus out of the dialog: return to the prompt.
      void this.updateComplete.then(() => this.#focus('input'));
    }
  }

  #clearHistory(): void {
    this.transcript = [];
  }

  #setMode(mode: AIMode): void {
    this.currentMode = mode;
  }

  /** A one-line, localized summary of a result, for the transcript. */
  #summarize(result: AIResult): string {
    if (result.mode === 'ask') {
      return result.abstained ? this.#t('ai.abstained') : result.answer;
    }
    return result.applied.length
      ? `${this.#t('ai.applied')}: ${appliedLabels(result.applied)}`
      : this.#t('ai.noChanges');
  }

  /** Human label for a plan's source: the rule engine, or an LLM. */
  #sourceLabel(source: string): string {
    return source === 'rule' ? this.#t('ai.viaRule') : this.#t('ai.viaAI');
  }

  // --- render --------------------------------------------------------------

  /** The live status region: error, thinking, a preview, or the last result. */
  #renderStatus() {
    if (this.error) {
      return html`<div part="error">${this.#t('ai.error')} <br /><small>${this.error}</small></div>`;
    }
    if (this.busy) return html`<div part="notice">${this.#t('ai.thinking')}</div>`;
    if (this.cancelled) return html`<div part="notice">${this.#t('ai.cancelled')}</div>`;
    if (this.previewPlan) return this.#renderPreview(this.previewPlan);
    if (this.result) return this.#renderResult(this.result);
    return nothing;
  }

  /** A small badge naming the reasoner behind a plan (rule engine vs. an LLM). */
  #renderSource(source: string) {
    return html`<span part="source" title=${source}>${this.#sourceLabel(source)}</span>`;
  }

  #renderResult(result: AIResult) {
    if (result.mode === 'ask') {
      // Abstention: the pipeline could not map the prompt to an action or a grounded
      // answer. Show an honest, localized message plus a hint, not the raw note.
      if (result.abstained) {
        return html`<div part="abstention">
          <div>${this.#t('ai.abstained')} ${this.#renderSource(result.plan.source)}</div>
          <div part="notice">${this.#t('ai.abstainedHint')}</div>
        </div>`;
      }
      return html`<div part="result">
        <div>${result.answer} ${this.#renderSource(result.plan.source)}</div>
      </div>`;
    }

    const applied = result.applied;
    const summary = applied.length
      ? `${this.#t('ai.applied')}: ${appliedLabels(applied)}`
      : this.#t('ai.noChanges');
    return html`<div part="result">
      <div>${summary} ${this.#renderSource(result.plan.source)}</div>
      ${
        result.warnings.length
          ? html`<div part="warnings">
              ${this.#t('ai.warnings')}:
              <ul>
                ${result.warnings.map((warning) => html`<li>${warning}</li>`)}
              </ul>
            </div>`
          : nothing
      }
      ${
        applied.length
          ? html`<button
              part="undo"
              type="button"
              ?disabled=${this.undone}
              @click=${() => this.#undo()}
            >
              ${this.#t('ai.undo')}
            </button>`
          : nothing
      }
    </div>`;
  }

  /** A dry-run: the steps the plan would run (or its answer), applying nothing. */
  #renderPreview(plan: Plan) {
    const lines =
      plan.mode === 'ask'
        ? [this.#t('ai.modeAsk')]
        : plan.steps.map((step) => step.rationale ?? step.tool);
    return html`<div part="preview">
      <div>${this.#t('ai.previewHeading')} ${this.#renderSource(plan.source)}</div>
      ${
        lines.length
          ? html`<ul>
              ${lines.map((line) => html`<li>${line}</li>`)}
            </ul>`
          : html`<div part="notice">${this.#t('ai.previewEmpty')}</div>`
      }
      ${
        plan.notes?.length
          ? html`<div part="warnings">
              <ul>
                ${plan.notes.map((note) => html`<li>${note}</li>`)}
              </ul>
            </div>`
          : nothing
      }
    </div>`;
  }

  /** A compact log of past turns, newest last. */
  #renderTranscript() {
    if (this.transcript.length === 0) return nothing;
    return html`<div part="history">
      <div class="history-head">
        <span>${this.#t('ai.history')}</span>
        <button part="clear-history" type="button" @click=${() => this.#clearHistory()}>
          ${this.#t('ai.clearHistory')}
        </button>
      </div>
      <ul>
        ${this.transcript.map(
          (entry) => html`<li part="history-item">
            <span class="hist-prompt">${entry.prompt}</span>
            <span class="hist-summary">${entry.summary}</span>
            ${this.#renderSource(entry.source)}
          </li>`
        )}
      </ul>
    </div>`;
  }

  protected override render() {
    const canSend = !this.busy && this.prompt.trim().length > 0;
    const dialog = this.mode === 'dialog';
    return html`<div
      part="panel"
      role=${dialog ? 'dialog' : nothing}
      tabindex=${dialog ? '-1' : nothing}
      aria-label=${dialog ? this.#t('ai.title') : nothing}
      aria-description=${
        dialog
          ? this.#t('panel.shortcutHint', 'Press F6 to move between the grid and this panel')
          : nothing
      }
      @keydown=${this.#onKeydown}
    >
      ${
        dialog
          ? html`<div
              part="header"
              @pointerdown=${this.#geometry.onHeaderPointerDown}
              @pointermove=${this.#geometry.onHeaderPointerMove}
              @pointerup=${this.#geometry.onHeaderPointerUp}
              @pointercancel=${this.#geometry.onHeaderPointerUp}
              @lostpointercapture=${this.#geometry.onHeaderPointerUp}
            >
              ${this.#geometry.renderMoveHandle()}
              <span>${this.#t('ai.title')}</span>
              ${
                this.grid
                  ? html`<button
                      part="back-to-grid"
                      type="button"
                      @click=${() => focusGrid(this.grid)}
                    >
                      ${this.#t('panel.backToGrid', 'Back to grid')}
                    </button>`
                  : nothing
              }
              <button
                part="close"
                type="button"
                aria-label=${this.#t('ai.close')}
                @click=${() => this.close()}
              >
                ✕
              </button>
            </div>`
          : nothing
      }
      <div part="body">
        <div class="modes" role="group" aria-label=${this.#t('ai.title')}>
          <button
            part="mode-button"
            type="button"
            aria-pressed=${this.currentMode === 'control' ? 'true' : 'false'}
            @click=${() => this.#setMode('control')}
          >
            ${this.#t('ai.modeControl')}
          </button>
          <button
            part="mode-button"
            type="button"
            aria-pressed=${this.currentMode === 'ask' ? 'true' : 'false'}
            @click=${() => this.#setMode('ask')}
          >
            ${this.#t('ai.modeAsk')}
          </button>
        </div>
        <textarea
          part="input"
          .value=${this.prompt}
          aria-label=${this.#t('ai.title')}
          placeholder=${this.#t('ai.placeholder')}
          @input=${(event: Event) => {
            this.prompt = (event.target as HTMLTextAreaElement).value;
          }}
          @keydown=${this.#onInputKeydown}
        ></textarea>
        <div class="actions">
          <button
            part="send"
            type="button"
            ?disabled=${!this.busy && !canSend}
            @click=${() => (this.busy ? this.#cancel() : this.#send())}
          >
            ${this.#t(this.busy ? 'ai.cancel' : 'ai.send')}
          </button>
          <button
            part="preview-button"
            type="button"
            ?disabled=${!canSend}
            @click=${() => this.#preview()}
          >
            ${this.#t('ai.preview')}
          </button>
        </div>
        <div role="status" aria-live="polite">${this.#renderStatus()}</div>
        ${this.#renderTranscript()}
      </div>
      ${dialog ? this.#geometry.renderResizeHandle() : nothing}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [AI_TAG]: ApexGridAI;
  }
}
