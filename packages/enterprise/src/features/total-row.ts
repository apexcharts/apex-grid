import type {
  GridFeatureModule,
  GridHost,
  PresentedRow,
  RowPresenter,
  RowPresenterContext,
  RowTransformer,
} from 'apex-grid/internal';
import { html, type ReactiveController } from 'lit';
import { type AggregationConfig, computeAggregations } from './aggregation.js';

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
 * Totals are computed over the rows as they reach the presenter, so they follow
 * filtering and the quick filter — a filtered grid totals what it shows, not the
 * whole dataset. Group-header rows are excluded so their aggregates are not
 * double-counted into the total.
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

  constructor(private host: GridHost<T>) {
    host.addController(this);
  }

  public hostConnected(): void {}

  // --- RowTransformer ------------------------------------------------------

  /** Last, so the total row is appended to the finished (grouped) view. */
  public readonly transformOrder = 1000;

  public processRows(rows: ReadonlyArray<T>): T[] {
    const config = this.config;
    if (!config || !Object.keys(config.aggregations).length) return [...rows];

    // Only real data rows feed the total. A grouped view interleaves synthesized
    // group headers whose columns hold group labels, not values; including them
    // would count each group's own aggregate as another data point.
    const leaves = rows.filter((row) => !this.#isSynthesized(row));
    this.#results = computeAggregations(leaves, config.aggregations);

    const total = { [TOTAL_ROW]: true } as unknown as T;
    return config.position === 'top' ? [total, ...rows] : [...rows, total];
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

  /**
   * Whether a row is module-synthesized rather than a data row. Detected by the
   * symbol keys features attach (group meta, pivot meta, this row's own marker)
   * rather than by importing each feature, which would couple them.
   */
  #isSynthesized(row: T): boolean {
    if (typeof row !== 'object' || row === null) return false;
    return Object.getOwnPropertySymbols(row).some((symbol) =>
      symbol.description?.startsWith('apex-grid-enterprise.')
    );
  }
}

/** Matches the grouping feature's aggregate formatting so the two rows agree. */
function formatTotal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** Feature module registered on the enterprise grid. */
export const totalRowModule: GridFeatureModule = {
  id: TOTAL_ROW_MODULE_ID,
  create: (host) => new TotalRowController(host),
};
