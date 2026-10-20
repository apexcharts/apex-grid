import type { GridFeatureModule, GridHost } from 'apex-grid/internal';
import type { ReactiveController } from 'lit';

/** Supported aggregation functions. */
export type AggregationFn = 'sum' | 'avg' | 'min' | 'max' | 'count';

/** Per-column aggregation request, keyed by column key. */
export type AggregationConfig = Record<string, AggregationFn[]>;

/** Computed aggregation values, keyed by column key then function. */
export type AggregationResults = Record<string, Partial<Record<AggregationFn, number>>>;

export const AGGREGATION_MODULE_ID = 'aggregation';

/**
 * The smallest of `values`, exactly as `Math.min(...values)` (NaN wins, -0 is
 * below 0, Infinity when empty) but without the argument spread, which throws
 * RangeError past roughly 120k values. The lazy AI engine keeps its own copy
 * in ai/analytics.ts; change both together.
 */
export function minOf(values: readonly number[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < values.length; i += 1) min = Math.min(min, values[i]);
  return min;
}

/** The largest of `values`, exactly as `Math.max(...values)`; see {@link minOf}. */
export function maxOf(values: readonly number[]): number {
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < values.length; i += 1) max = Math.max(max, values[i]);
  return max;
}

/**
 * A cell value as a finite number, or `null` when the cell does not count:
 * NaN and Infinity do not, numeric strings do. The same rule as the status
 * bar's `toNumber` (range-selection.ts), so a group header, the total row, a
 * pivot cell and the status bar agree on which cells count; change both
 * together.
 */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** One aggregation function's result from a column's running totals. */
function pickAggregate(
  fn: AggregationFn,
  count: number,
  sum: number,
  min: number,
  max: number
): number {
  switch (fn) {
    case 'count':
      return count;
    case 'sum':
      return sum;
    case 'avg':
      return count ? sum / count : 0;
    case 'min':
      return count ? min : 0;
    case 'max':
      return count ? max : 0;
    default:
      return 0;
  }
}

/**
 * Compute the requested aggregations for a set of rows. Pure and reusable:
 * shared by the {@link AggregationController} and the row-grouping feature,
 * which calls it per group over the (filtered) leaf rows. One pass per column
 * yields every function; cells that are not finite numbers are skipped (see
 * {@link toFiniteNumber}), and an empty column gives 0 throughout.
 */
export function computeAggregations<T extends object>(
  data: readonly T[],
  config: AggregationConfig
): AggregationResults {
  const results: AggregationResults = {};

  for (const [key, fns] of Object.entries(config)) {
    let count = 0;
    let sum = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < data.length; i += 1) {
      const value = toFiniteNumber((data[i] as Record<string, unknown>)[key]);
      if (value === null) continue;
      count += 1;
      sum += value;
      // Math.min / Math.max, not < / >, so -0 still sorts below 0.
      min = Math.min(min, value);
      max = Math.max(max, value);
    }

    const column: Partial<Record<AggregationFn, number>> = {};
    for (const fn of fns) column[fn] = pickAggregate(fn, count, sum, min, max);
    results[key] = column;
  }

  return results;
}

/**
 * Enterprise feature: computes column aggregations (sum/avg/min/max/count) over
 * a dataset. Implemented as a {@link GridFeatureModule} controller so it is
 * wired through the core extension seam and only ships in the enterprise grid.
 */
export class AggregationController<T extends object> implements ReactiveController {
  constructor(host: GridHost<T>) {
    host.addController(this);
  }

  public hostConnected(): void {}

  /** Compute the requested aggregations for the given rows. */
  public compute(data: readonly T[], config: AggregationConfig): AggregationResults {
    return computeAggregations(data, config);
  }
}

/** Feature module registered on the enterprise grid. */
export const aggregationModule: GridFeatureModule = {
  id: AGGREGATION_MODULE_ID,
  create: (host) => new AggregationController(host),
};
