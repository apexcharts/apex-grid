/**
 * A test-only, in-memory {@link GridApi}. It lived in the published package
 * until apex-grid-enterprise 0.10.0; it is a test double, not grid API, so it
 * now lives with the tests and never ships in dist.
 */

import type { GridLocaleText, GridSchema, GridState } from 'apex-grid';
import { emptyGridState, type GridApi } from '../../src/features/ai/grid-api.js';
import type { StatePatch } from '../../src/features/ai-schema.js';

/** Seed for {@link createFakeGridApi}. */
export interface FakeGridApiInit<T> {
  /** The capability descriptor to report from `getSchema` (its `state` is kept live). */
  schema: GridSchema;
  /** Initial state overrides merged over {@link emptyGridState}. */
  state?: Partial<GridState>;
  /** Rows returned from `getData`. */
  data?: readonly T[];
  /** Locale map returned from `getLocaleText`. */
  localeText?: GridLocaleText;
  /** Direction reported by `getDirection` (omitted: no `getDirection`, which reads as ltr). */
  direction?: 'ltr' | 'rtl';
}

/**
 * A pure {@link GridApi}: no element, no DOM. `applyState` shallow-merges the
 * patch into a stored state and records every patch on `calls`, so components
 * (ContextBuilder, tools, the executor) can be exercised in isolation.
 */
export function createFakeGridApi<T = unknown>(
  init: FakeGridApiInit<T>
): GridApi<T> & { readonly calls: readonly StatePatch[] } {
  let state: GridState = { ...emptyGridState(), ...init.state };
  const calls: StatePatch[] = [];
  return {
    get calls() {
      return calls;
    },
    getSchema: () => ({ ...init.schema, state }),
    getState: () => state,
    getData: () => init.data ?? [],
    getLocaleText: () => init.localeText,
    ...(init.direction ? { getDirection: () => init.direction as 'ltr' | 'rtl' } : {}),
    applyState: (patch) => {
      calls.push(patch);
      state = { ...state, ...patch } as GridState;
      return { applied: Object.keys(patch), skipped: [], warnings: [] };
    },
  };
}
