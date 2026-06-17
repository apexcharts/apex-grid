import { registerComponent } from 'apex-grid/internal';
import { css, html, LitElement, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import {
  RANGE_CHANGED_EVENT,
  type RangeChangedDetail,
  type RangeStats,
} from './features/range-selection.js';
import type { ApexGridEnterprise } from './grid-enterprise.js';

export const STATUS_BAR_TAG = 'apex-grid-status-bar';

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Spreadsheet-style status bar. Mount it beside (or below) an
 * `<apex-grid-enterprise>` and set its `grid` property; it listens for the
 * grid's range-selection changes and shows live aggregates of the selected
 * cells — count, plus sum / average / min / max over the numeric ones, exactly
 * like the selection summary in Excel or Google Sheets.
 *
 * @element apex-grid-status-bar
 *
 * @csspart status-bar - The bar container.
 * @csspart hint - Placeholder text shown when nothing is selected.
 * @csspart stat - A single stat chip.
 * @csspart stat-label - The stat's label (e.g. "Sum").
 * @csspart stat-value - The stat's value.
 */
export class ApexGridStatusBar extends LitElement {
  public static get tagName(): string {
    return STATUS_BAR_TAG;
  }

  public static register(): void {
    registerComponent(ApexGridStatusBar);
  }

  public static override styles = css`
    :host {
      display: block;
      box-sizing: border-box;
      font: 0.8rem/1.4 system-ui, sans-serif;
      color: #3a3f45;
      background: #f6f7f8;
      border: 1px solid #d8dade;
      border-radius: 6px;
    }
    [part='status-bar'] {
      display: flex;
      align-items: center;
      gap: 18px;
      padding: 6px 12px;
      min-block-size: 18px;
    }
    [part='hint'] {
      opacity: 0.55;
      font-style: italic;
    }
    [part='stat'] {
      display: inline-flex;
      align-items: baseline;
      gap: 5px;
      white-space: nowrap;
    }
    [part='stat-label'] {
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      opacity: 0.6;
    }
    [part='stat-value'] {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: #1f2328;
    }
  `;

  /** The enterprise grid to summarize. Setting it (re)binds the listener. */
  @property({ attribute: false })
  public grid: ApexGridEnterprise<Record<string, unknown>> | null = null;

  @state()
  private stats: RangeStats | null = null;

  #boundGrid: HTMLElement | null = null;

  public override disconnectedCallback(): void {
    this.#detach();
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('grid')) this.#attach();
  }

  #attach(): void {
    this.#detach();
    const grid = this.grid as unknown as HTMLElement | null;
    if (!grid) return;
    grid.addEventListener(RANGE_CHANGED_EVENT, this.#onRangeChanged as EventListener);
    this.#boundGrid = grid;
    // Pull the current stats so a late mount shows any existing selection.
    const current = this.grid?.getSelectionStats?.();
    this.stats = current && current.count > 0 ? current : null;
  }

  #detach(): void {
    this.#boundGrid?.removeEventListener(
      RANGE_CHANGED_EVENT,
      this.#onRangeChanged as EventListener
    );
    this.#boundGrid = null;
  }

  #onRangeChanged = (event: CustomEvent<RangeChangedDetail>): void => {
    const { bounds, stats } = event.detail;
    this.stats = bounds && stats.count > 0 ? stats : null;
  };

  #renderStat(label: string, value: string) {
    return html`<span part="stat"
      ><span part="stat-label">${label}</span><span part="stat-value">${value}</span></span
    >`;
  }

  protected override render() {
    const stats = this.stats;
    if (!stats || stats.count === 0) {
      return html`<div part="status-bar">
        <span part="hint">Select a range of cells</span>
      </div>`;
    }
    return html`<div part="status-bar">
      ${this.#renderStat('Count', formatNumber(stats.count))}
      ${
        stats.numericCount > 0
          ? html`${this.#renderStat('Sum', formatNumber(stats.sum))}
          ${this.#renderStat('Avg', formatNumber(stats.average))}
          ${this.#renderStat('Min', formatNumber(stats.min))}
          ${this.#renderStat('Max', formatNumber(stats.max))}`
          : nothing
      }
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [STATUS_BAR_TAG]: ApexGridStatusBar;
  }
}
