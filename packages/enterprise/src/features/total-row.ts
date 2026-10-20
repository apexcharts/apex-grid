import {
  type GridFeatureModule,
  type GridHost,
  PIPELINE,
  type PresentedRow,
  type RowPresenter,
  type RowPresenterContext,
  type RowTransformer,
  type StateController,
} from 'apex-grid/internal';
import { html, type ReactiveController } from 'lit';
import { type AggregationConfig, computeAggregations } from './aggregation.js';
import { PIVOT_MODULE_ID, type PivotController } from './pivot.js';

export const TOTAL_ROW_MODULE_ID = 'total-row';

/** Marks the synthesized grand-total row. */
const TOTAL_ROW = Symbol('apex-grid-enterprise.totalRow');

/** Whether a row is the synthesized grand-total row. */
export function isTotalRow(row: unknown): boolean {
  return typeof row === 'object' && row !== null && TOTAL_ROW in row;
}

/** Configuration for the grand-total row. */
export interface TotalRowConfig {
  /**
   * Aggregations to show, keyed by column, e.g. `{ salary: ['sum', 'avg'] }`.
   * An empty config renders nothing, so the feature is inert until asked for.
   */
  aggregations: AggregationConfig;
  /** Where the row sits in the view. Default `'bottom'`. */
  position?: 'top' | 'bottom';
  /** Leading label. Defaults to the localized `pivot.grandTotal`. */
  label?: string;
}

/**
 * Enterprise feature: a **grand-total row** over the whole view.
 *
 * Distinct from the per-group aggregates row grouping already renders, which
 * total a group's leaves: this totals every row the view currently holds, which
 * is what makes it answer "what is the sum of this column" without grouping
 * anything. Pivot has its own grand total (it has to, since it builds its own
 * row set); this covers the flat and grouped views that did not.
 *
 * Totals cover every record the view holds, so they follow filtering and the
 * quick filter (a filtered grid totals what it shows, not the whole dataset),
 * but not display state: rows on other pages and the leaves of a collapsed
 * group still count. Group-header rows are left out so their aggregates are not
 * counted twice. The row goes inert while a pivot (which has its own grand
 * total), the server-side row model or the infinite row model (whose rows
 * are only what has loaded) is active.
 *
 * Implemented on the existing {@link RowTransformer} / {@link RowPresenter}
 * seams (the pattern grouping and pivot use), so there is no core change: the
 * row is appended to the view and rendered full-width.
 */
export class TotalRowController<T extends object>
  implements ReactiveController, RowTransformer<T>, RowPresenter<T>
{
  /** Configuration; `null` (the default) leaves the feature inert. */
  public config: TotalRowConfig | null = null;

  /** Totals computed during the most recent {@link processRows}. */
  #results: ReturnType<typeof computeAggregations> = {};

  /** The {@link #lazyModel} answer the view was last shaped (or reshaped) for. */
  #wasLazy = false;

  constructor(
    private host: GridHost<T>,
    private state: StateController<T>
  ) {
    host.addController(this);
  }

  public hostConnected(): void {}

  /**
   * Switching a lazy row model off does not rerun the pipeline by itself (its
   * loaded rows stay as they are), so the row would stay off until something
   * unrelated reshaped the view. Rerun it once when that answer changes. Only
   * the lazy row models are watched: a pivot change already reruns the
   * pipeline, and with an async pipeline that run has not reached processRows
   * yet, so watching the pivot here would run every hook a second time. This
   * is hostUpdated, not hostUpdate: the pipeline watcher has already run in
   * willUpdate by then, so a request there would be dropped with the update.
   */
  public hostUpdated(): void {
    const lazy = this.#lazyModel();
    if (lazy === this.#wasLazy) return;
    this.#wasLazy = lazy;
    if (this.#configured()) this.host.requestUpdate(PIPELINE);
  }

  // --- RowTransformer ------------------------------------------------------

  /** Last, so the total row is appended to the finished (grouped) view. */
  public readonly transformOrder = 1000;

  public processRows(rows: ReadonlyArray<T>): T[] {
    const config = this.config;
    this.#wasLazy = this.#lazyModel();
    if (!config || !this.#configured() || this.#wasLazy || this.#pivotActive()) {
      this.#results = {};
      return rows as T[];
    }

    // The view's records, not its rows: group headers drop out (their columns
    // hold labels, and counting them would add each group's aggregate again)
    // and a collapsed group's leaves come back, since collapse is display state.
    const leaves = this.state.viewRecords(rows);
    this.#results = computeAggregations(leaves, config.aggregations);

    const total = { [TOTAL_ROW]: true } as unknown as T;
    return config.position === 'top' ? [total, ...rows] : [...rows, total];
  }

  /** Whether a config with at least one aggregation is set. */
  #configured(): boolean {
    return Boolean(this.config && Object.keys(this.config.aggregations).length);
  }

  /**
   * Whether a pivot owns the view; it renders its own grand total. This asks
   * the pivot controller, not the host's isPivoting, so a pivot config that
   * passes rows through keeps the total.
   */
  #pivotActive(): boolean {
    return Boolean(this.state.module<PivotController<T>>(PIVOT_MODULE_ID)?.active);
  }

  /**
   * Whether the server-side or infinite row model is on; their rows are only
   * what has loaded.
   */
  #lazyModel(): boolean {
    const host = this.host as { isServerSideRowModel?: boolean; infiniteRowModel?: unknown };
    return Boolean(host.isServerSideRowModel || host.infiniteRowModel);
  }

  /** The total row is synthesized, so selection and export skip it. */
  public isSyntheticRow(row: T): boolean {
    return isTotalRow(row);
  }

  // --- RowPresenter --------------------------------------------------------

  public presentRow(row: T, _ctx: RowPresenterContext<T>): PresentedRow | null {
    if (!isTotalRow(row)) return null;
    const label =
      this.config?.label ?? this.host.localize('pivot.grandTotal', undefined, 'Grand Total');
    return { content: this.#render(label), part: 'total-row' };
  }

  #render(label: string) {
    const entries = Object.entries(this.#results);
    return html`<div
      part="total-row-content"
      style="display:flex;align-items:center;gap:12px;padding:0 8px;font-weight:600"
    >
      <span part="total-row-label">${label}</span>
      <span
        part="total-row-values"
        style="margin-inline-start:auto;display:flex;gap:12px;font-weight:500"
      >
        ${entries.flatMap(([column, fns]) =>
          Object.entries(fns).map(
            ([fn, value]) =>
              html`<span part="total-row-value"
                ><b>${column} ${fn}</b>: ${formatTotal(value as number)}</span
              >`
          )
        )}
      </span>
    </div>`;
  }

  /** The computed totals from the latest pipeline run (read-only). */
  public get totals(): ReturnType<typeof computeAggregations> {
    return this.#results;
  }
}

/** Matches the grouping feature's aggregate formatting so the two rows agree. */
function formatTotal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** Feature module registered on the enterprise grid. */
export const totalRowModule: GridFeatureModule = {
  id: TOTAL_ROW_MODULE_ID,
  create: (host, state) => new TotalRowController(host, state),
};
