import { type GridLocaleKey, localize } from 'apex-grid';
import { registerComponent } from 'apex-grid/internal';
import {
  css,
  html,
  LitElement,
  nothing,
  type ReactiveController,
  type ReactiveControllerHost,
} from 'lit';
import { property, state } from 'lit/decorators.js';
import {
  RANGE_CHANGED_EVENT,
  type RangeChangedDetail,
  type RangeStats,
} from './features/range-selection.js';
import { type ApexGridEnterpriseHost, VIEW_CHANGED_EVENT } from './grid-enterprise.js';

export const STATUS_BAR_TAG = 'apex-grid-status-bar';

type Grid = ReactiveControllerHost & EventTarget;

/**
 * Keeps a companion element (status bar, tool panel) in step with the grid it
 * is bound to. While the companion is connected it hooks the grid's update
 * cycle, so anything that re-renders the grid (columns, grouping, pivot,
 * locale) re-renders the companion too, and `onLink` adds or drops any grid
 * listeners. A disconnect unhooks it and a reconnect hooks it again, so moving
 * the companion in the DOM never stops it updating or doubles its listeners.
 */
export class GridLink implements ReactiveController {
  #grid: Grid | null | undefined;
  readonly #hook: ReactiveController;

  constructor(
    private readonly host: ReactiveControllerHost & Element,
    private readonly onLink?: (grid: Grid, on: boolean) => void
  ) {
    host.addController(this);
    this.#hook = { hostUpdated: () => host.requestUpdate() };
  }

  /** Bind another grid (or none), moving the hook across. */
  public set grid(grid: Grid | null | undefined) {
    if (grid === this.#grid) return;
    this.hostDisconnected();
    this.#grid = grid;
    if (this.host.isConnected) this.hostConnected();
  }

  // Both are idempotent: controllers are a set, and a listener is added once per function.
  // The optional calls skip a grid element that is not upgraded yet.
  public hostConnected(): void {
    const grid = this.#grid;
    if (!grid) return;
    grid.addController?.(this.#hook);
    this.onLink?.(grid, true);
    // The grid may have changed while the companion was detached.
    this.host.requestUpdate();
  }

  public hostDisconnected(): void {
    const grid = this.#grid;
    if (!grid) return;
    grid.removeController?.(this.#hook);
    this.onLink?.(grid, false);
  }
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Spreadsheet-style status bar. Mount it beside (or below) an
 * `<apex-grid-enterprise>` and set its `grid` property; it shows live
 * aggregates of the selected cells (count, plus sum / average / min / max over
 * the numeric ones), the usual spreadsheet selection summary. The figures
 * follow the selection and the values under it: edits, paste, fill, undo,
 * formula recalculation and a new `data` array all refresh them, once per burst.
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
  public grid: ApexGridEnterpriseHost | null = null;

  @state()
  private stats: RangeStats | null = null;

  /** Set when values under the selection may have changed; the next update re-reads them. */
  #stale = false;

  readonly #link = new GridLink(this, (grid, on) => {
    const method = on ? 'addEventListener' : 'removeEventListener';
    grid[method](RANGE_CHANGED_EVENT, this.#onRangeChanged as EventListener);
    // The grid fires this on a cell value change (edit, paste, fill, undo, formula
    // recalc) and on a data, sort, filter or structure change.
    grid[method](VIEW_CHANGED_EVENT, this.#onValuesChanged);
    // Pull the current stats so a late mount or a reconnect shows the live selection.
    if (on) this.#onValuesChanged();
  });

  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('grid')) this.#link.grid = this.grid;
    // Bursts (a many-cell paste or applyEdits) coalesce into this one read, and a
    // grid with no selection makes it free.
    if (this.#stale) {
      this.#stale = false;
      const current = this.grid?.getSelectionStats?.();
      this.stats = current && current.count > 0 ? current : null;
    }
  }

  #onRangeChanged = (event: CustomEvent<RangeChangedDetail>): void => {
    const { bounds, stats } = event.detail;
    this.#stale = false;
    this.stats = bounds && stats.count > 0 ? stats : null;
  };

  #onValuesChanged = (): void => {
    this.#stale = true;
    this.requestUpdate();
  };

  #renderStat(label: string, value: string) {
    return html`<span part="stat"
      ><span part="stat-label">${label}</span><span part="stat-value">${value}</span></span
    >`;
  }

  /** Resolve a locale key against the bound grid's overrides (English when unbound). */
  #t = (key: GridLocaleKey): string => localize(this.grid?.localeText, key);

  protected override render() {
    const stats = this.stats;
    // A polite live region: screen readers announce the aggregates as the selection changes.
    if (!stats || stats.count === 0) {
      return html`<div part="status-bar" role="status" aria-live="polite">
        <span part="hint">${this.#t('statusBar.selectRange')}</span>
      </div>`;
    }
    return html`<div part="status-bar" role="status" aria-live="polite">
      ${this.#renderStat(this.#t('statusBar.count'), formatNumber(stats.count))}
      ${
        stats.numericCount > 0
          ? html`${this.#renderStat(this.#t('statusBar.sum'), formatNumber(stats.sum))}
          ${this.#renderStat(this.#t('statusBar.average'), formatNumber(stats.average))}
          ${this.#renderStat(this.#t('statusBar.min'), formatNumber(stats.min))}
          ${this.#renderStat(this.#t('statusBar.max'), formatNumber(stats.max))}`
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
