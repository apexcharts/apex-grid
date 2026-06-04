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
    const results: AggregationResults = {};

    for (const [key, fns] of Object.entries(config)) {
      const values = data
        .map((row) => (row as Record<string, unknown>)[key])
        .filter((value): value is number => typeof value === 'number');

      const column: Partial<Record<AggregationFn, number>> = {};
      for (const fn of fns) {
        column[fn] = AggregationController.apply(fn, values);
      }
      results[key] = column;
    }

    return results;
  }

  private static apply(fn: AggregationFn, values: number[]): number {
    const sum = values.reduce((total, value) => total + value, 0);
    switch (fn) {
      case 'count':
        return values.length;
      case 'sum':
        return sum;
      case 'avg':
        return values.length ? sum / values.length : 0;
      case 'min':
        return values.length ? Math.min(...values) : 0;
      case 'max':
        return values.length ? Math.max(...values) : 0;
      default:
        return 0;
    }
  }
}

/** Feature module registered on the enterprise grid. */
export const aggregationModule: GridFeatureModule = {
  id: AGGREGATION_MODULE_ID,
  create: (host) => new AggregationController(host),
};
