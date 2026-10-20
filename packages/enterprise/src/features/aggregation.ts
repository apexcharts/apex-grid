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

/** Apply a single aggregation function over a list of numeric values. */
function applyAggregation(fn: AggregationFn, values: number[]): number {
  const sum = values.reduce((total, value) => total + value, 0);
  switch (fn) {
    case 'count':
      return values.length;
    case 'sum':
      return sum;
    case 'avg':
      return values.length ? sum / values.length : 0;
    case 'min':
      return values.length ? minOf(values) : 0;
    case 'max':
      return values.length ? maxOf(values) : 0;
    default:
      return 0;
  }
}

/**
 * Compute the requested aggregations for a set of rows. Pure and reusable —
 * shared by the {@link AggregationController} and the row-grouping feature,
 * which calls it per group over the (filtered) leaf rows.
 */
export function computeAggregations<T extends object>(
  data: readonly T[],
  config: AggregationConfig
): AggregationResults {
  const results: AggregationResults = {};

  for (const [key, fns] of Object.entries(config)) {
    const values = data
      .map((row) => (row as Record<string, unknown>)[key])
      .filter((value): value is number => typeof value === 'number');

    const column: Partial<Record<AggregationFn, number>> = {};
    for (const fn of fns) {
      column[fn] = applyAggregation(fn, values);
    }
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
