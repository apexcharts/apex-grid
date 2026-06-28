import { type GridLocaleKey, localize } from 'apex-grid';
import { registerComponent } from 'apex-grid/internal';
import { css, html, LitElement, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { AIMode, AIResult } from './features/ai.js';
import type { ApexGridEnterprise } from './grid-enterprise.js';

export const AI_TAG = 'apex-grid-ai';

/**
 * Prompt panel for the enterprise grid's AI Toolkit. Mount it beside a grid and
 * set its `grid` property: it sends a natural-language prompt through the grid's
 * {@link ApexGridEnterprise.runPrompt} (and thus its {@link ApexGridEnterprise.aiAdapter}),
 * then shows what changed with a one-click **Undo**, or the answer in ask mode.
 *
 * Two container modes via `mode`: `'inline'` renders in place; `'dialog'` (the
 * default) is a floating, draggable panel. The element holds no API key and never
 * imports an LLM SDK: it only calls the grid, which owns the adapter.
 *
 * @element apex-grid-ai
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
 * @csspart result - The result region (applied summary or answer).
 * @csspart undo - The undo button (control mode).
 * @csspart warnings - The notes / warnings list.
 * @csspart notice - The "no adapter" / empty notice.
 * @csspart error - The error message.
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
    if (!grid || this.busy || !this.prompt.trim()) return;
    this.error = '';
    this.result = null;
    this.undone = false;
    this.busy = true;
    this.#controller = new AbortController();
    try {
      const result = await grid.runPrompt(this.prompt, {
        mode: this.currentMode,
        signal: this.#controller.signal,
      });
      this.result = result;
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

  #setMode(mode: AIMode): void {
    this.currentMode = mode;
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

  #renderResult() {
    if (this.error) return html`<div part="error">${this.error}</div>`;
    if (this.busy) return html`<div part="notice">${this.#t('ai.thinking')}</div>`;
    const result = this.result;
    if (!result) return nothing;

    if (result.mode === 'ask') {
      return html`<div part="result">${result.answer}</div>`;
    }

    const applied = result.result.applied;
    const summary = applied.length
      ? `${this.#t('ai.applied')}: ${applied.join(', ')}`
      : this.#t('ai.noChanges');
    return html`<div part="result">
      <div>${summary}</div>
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

  protected override render() {
    const hasAdapter = Boolean(this.grid?.aiAdapter);
    const canSend = hasAdapter && !this.busy && this.prompt.trim().length > 0;
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
                </button>`
          }
        </div>
        ${hasAdapter ? nothing : html`<div part="notice">${this.#t('ai.noAdapter')}</div>`}
        <div role="status" aria-live="polite">${this.#renderResult()}</div>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [AI_TAG]: ApexGridAI;
  }
}
