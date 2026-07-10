import { type GridLocaleKey, localize } from 'apex-grid';
import { registerComponent } from 'apex-grid/internal';
import { css, html, LitElement, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { AIMode, AIResult, Plan } from './features/ai/index.js';
import type { ApexGridEnterprise } from './grid-enterprise.js';

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
    :host {
      display: block;
      font: 0.8rem/1.4 system-ui, sans-serif;
      color: #1f2328;
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
      background: #fff;
      border: 1px solid #d8dade;
      border-radius: 8px;
    }
    :host([mode='dialog']) [part='panel'] {
      position: fixed;
      inset: auto 24px 24px auto;
      inline-size: 380px;
      max-inline-size: 92vw;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
    }
    [part='header'] {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 12px;
      border-block-end: 1px solid #eef0f4;
      cursor: move;
      font-weight: 600;
    }
    [part='close'] {
      cursor: pointer;
      border: none;
      background: none;
      font-size: 16px;
      line-height: 1;
      color: #6b7280;
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
      border: 1px solid #d0d5dd;
      background: #fff;
      border-radius: 4px;
      cursor: pointer;
    }
    [part='mode-button'][aria-pressed='true'] {
      background: #1f2328;
      color: #fff;
      border-color: #1f2328;
    }
    [part='input'] {
      font: inherit;
      box-sizing: border-box;
      inline-size: 100%;
      min-block-size: 60px;
      resize: vertical;
      padding: 6px 8px;
      border: 1px solid #d0d5dd;
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
      border: 1px solid #1f2328;
      background: #1f2328;
      color: #fff;
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
      color: #475467;
    }
    [part='undo'] {
      font: inherit;
      font-size: 0.75rem;
      margin-block-start: 6px;
      padding: 3px 10px;
      border: 1px solid #d0d5dd;
      background: #fff;
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
      color: #888;
      font-style: italic;
    }
    [part='error'] {
      color: #b42318;
    }
    [part='preview-button'] {
      font: inherit;
      padding: 5px 12px;
      border: 1px solid #d0d5dd;
      background: #fff;
      color: #1f2328;
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
      color: #57606a;
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 0 7px;
      vertical-align: middle;
      white-space: nowrap;
    }
    [part='preview'] {
      font-size: 0.78rem;
      color: #475467;
    }
    [part='history'] {
      margin-block-start: 4px;
      border-block-start: 1px solid #eef0f4;
      padding-block-start: 6px;
    }
    .history-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-weight: 600;
      font-size: 0.72rem;
      color: #6b7280;
    }
    [part='clear-history'] {
      font: inherit;
      font-size: 0.7rem;
      border: none;
      background: none;
      color: #6b7280;
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
      color: #6b7280;
    }
    ul {
      margin: 4px 0 0;
      padding-inline-start: 18px;
    }
  `;

  /** The enterprise grid to drive. Setting it binds the panel. */
  @property({ attribute: false })
  public grid: ApexGridEnterprise<Record<string, unknown>> | null = null;

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

  #controller: AbortController | null = null;
  #drag: { pointerId: number; offsetX: number; offsetY: number } | null = null;

  /** Resolve a locale key against the bound grid's overrides (English when unbound). */
  #t = (key: GridLocaleKey, fallback?: string): string =>
    localize(this.grid?.localeText, key, undefined, fallback);

  public override disconnectedCallback(): void {
    this.#controller?.abort();
    this.#controller = null;
    super.disconnectedCallback();
  }

  /** Open the dialog panel and move focus into the prompt. */
  public show(): void {
    this.open = true;
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLElement>('[part="input"]')?.focus();
    });
  }

  /** Close the dialog panel and notify (so a launcher can remove it). */
  public close(): void {
    this.open = false;
    this.#controller?.abort();
    this.dispatchEvent(new CustomEvent('apex-ai-closed', { bubbles: true, composed: true }));
  }

  #onKeydown = (event: KeyboardEvent): void => {
    if (this.mode === 'dialog' && this.open && event.key === 'Escape') {
      event.stopPropagation();
      this.close();
    }
  };

  #onInputKeydown = (event: KeyboardEvent): void => {
    // Cmd/Ctrl + Enter sends, matching common prompt-box conventions.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void this.#send();
    }
  };

  async #send(): Promise<void> {
    const grid = this.grid;
    const prompt = this.prompt.trim();
    if (!grid || this.busy || !prompt) return;
    this.error = '';
    this.result = null;
    this.previewPlan = null;
    this.undone = false;
    this.busy = true;
    this.#controller = new AbortController();
    try {
      const result = await grid.runPrompt(this.prompt, {
        mode: this.currentMode,
        signal: this.#controller.signal,
      });
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
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.#controller = null;
    }
  }

  /** Dry-run the prompt: show the plan the reasoner would run, applying nothing. */
  async #preview(): Promise<void> {
    const grid = this.grid;
    if (!grid || this.busy || !this.prompt.trim()) return;
    this.error = '';
    this.result = null;
    this.previewPlan = null;
    this.busy = true;
    this.#controller = new AbortController();
    try {
      this.previewPlan = await grid.previewPrompt(this.prompt, {
        mode: this.currentMode,
        signal: this.#controller.signal,
      });
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.#controller = null;
    }
  }

  #cancel(): void {
    this.#controller?.abort();
    this.busy = false;
  }

  #undo(): void {
    if (this.result?.mode === 'control' && !this.undone) {
      this.result.undo();
      this.undone = true;
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
      ? `${this.#t('ai.applied')}: ${result.applied.join(', ')}`
      : this.#t('ai.noChanges');
  }

  /** Human label for a plan's source: the rule engine, or an LLM. */
  #sourceLabel(source: string): string {
    return source === 'rule' ? this.#t('ai.viaRule') : this.#t('ai.viaAI');
  }

  // --- dialog drag ---------------------------------------------------------

  #onHeaderPointerDown = (event: PointerEvent): void => {
    if (this.mode !== 'dialog') return;
    const panel = this.renderRoot.querySelector<HTMLElement>('[part="panel"]');
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    this.#drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  #onHeaderPointerMove = (event: PointerEvent): void => {
    if (!this.#drag || event.pointerId !== this.#drag.pointerId) return;
    const panel = this.renderRoot.querySelector<HTMLElement>('[part="panel"]');
    if (!panel) return;
    panel.style.left = `${event.clientX - this.#drag.offsetX}px`;
    panel.style.top = `${event.clientY - this.#drag.offsetY}px`;
  };

  #onHeaderPointerUp = (event: PointerEvent): void => {
    if (this.#drag?.pointerId === event.pointerId) this.#drag = null;
  };

  // --- render --------------------------------------------------------------

  /** The live status region: error, thinking, a preview, or the last result. */
  #renderStatus() {
    if (this.error) return html`<div part="error">${this.error}</div>`;
    if (this.busy) return html`<div part="notice">${this.#t('ai.thinking')}</div>`;
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
      ? `${this.#t('ai.applied')}: ${applied.join(', ')}`
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
              ${this.undone ? '✓' : this.#t('ai.undo')}
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
    return html`<div
      part="panel"
      role=${this.mode === 'dialog' ? 'dialog' : nothing}
      aria-label=${this.mode === 'dialog' ? this.#t('ai.title') : nothing}
      @keydown=${this.#onKeydown}
    >
      ${
        this.mode === 'dialog'
          ? html`<div
              part="header"
              @pointerdown=${this.#onHeaderPointerDown}
              @pointermove=${this.#onHeaderPointerMove}
              @pointerup=${this.#onHeaderPointerUp}
            >
              <span>${this.#t('ai.title')}</span>
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
          ${
            this.busy
              ? html`<button part="send" type="button" @click=${() => this.#cancel()}>
                  ${this.#t('ai.cancel')}
                </button>`
              : html`<button
                    part="send"
                    type="button"
                    ?disabled=${!canSend}
                    @click=${() => this.#send()}
                  >
                    ${this.#t('ai.send')}
                  </button>
                  <button
                    part="preview-button"
                    type="button"
                    ?disabled=${!canSend}
                    @click=${() => this.#preview()}
                  >
                    ${this.#t('ai.preview')}
                  </button>`
          }
        </div>
        <div role="status" aria-live="polite">${this.#renderStatus()}</div>
        ${this.#renderTranscript()}
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [AI_TAG]: ApexGridAI;
  }
}
