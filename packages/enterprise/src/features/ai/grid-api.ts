/**
 * The Grid API abstraction: the one boundary between the AI layer and the grid.
 *
 * Tools depend only on {@link GridApi}, never on `ApexGridEnterprise` internals.
 * View operations funnel through {@link GridApi.applyState} (which reuses the grid's
 * defensive `setState` and the `sanitizePatch` guard); non-state actions are
 * separate, optional, capability-gated methods. `gridApiFor` is the only place that
 * knows the concrete element; `createFakeGridApi` lets every downstream component be
 * unit-tested with no DOM.
 *
 * @see plans/ai-reasoning-layer-spec.md (section 4.1)
 */

import type { GridLocaleText, GridSchema, GridState, RowRef, SetStateResult } from 'apex-grid';
import type { ApexGridEnterprise } from '../../grid-enterprise.js';
import type { StatePatch } from '../ai-schema.js';

/** A single cell, addressed by a row reference and a column key. */
export interface CellTarget {
  row: RowRef;
  column: string;
}

/** A normalized chart request. Intentionally minimal for now; expanded when the chart tool lands. */
export interface ChartRequest {
  type?: string;
  container?: HTMLElement;
}

/** The uniform result of an imperative action: what changed, any warnings, and an optional inverse. */
export interface ActionResult {
  applied: string[];
  warnings: string[];
  undo?: () => void;
}

/**
 * The stable facade the AI layer targets.
 *
 * `getSchema` / `getState` / `getData` / `getLocaleText` are read-only and feed the
 * ContextBuilder. `applyState` is the single declarative view-state mutation and
 * covers sort / filter / quick-filter / columns / selection / pagination / grouping /
 * pivot / aggregation. The action methods are optional: their presence mirrors grid
 * capabilities, so a tool that needs a missing action is simply never registered.
 */
export interface GridApi<T = unknown> {
  /** Columns, capabilities, and the live state: the machine-readable descriptor. */
  getSchema(): GridSchema;
  /** The current view-state snapshot (the undo baseline). */
  getState(): GridState;
  /** The current rows (callers bound the sample they use). */
  getData(): readonly T[];
  /** The locale override map, for building localized summaries / warnings / answers. */
  getLocaleText(): GridLocaleText | undefined;

  /** The one declarative view-state mutation. Defensive: it reports what it dropped. */
  applyState(patch: StatePatch): SetStateResult;

  /** Export the current view. Present when the grid advertises an export format. */
  export?(format: string, options?: Record<string, unknown>): ActionResult;
  /** Set a single cell's value. Present when editing is enabled (deferred; see spec 6.6). */
  editCell?(target: CellTarget, value: unknown): ActionResult;
  /** Render a chart of the current view / selection. Present when charts are available (deferred). */
  renderChart?(request: ChartRequest): ActionResult;
}

/**
 * Adapt a live enterprise grid element to the {@link GridApi} facade. This is the
 * only function that references the concrete element type; everything downstream
 * depends on the interface. View operations delegate to the grid's defensive
 * `setState`, so every guardrail the grid ships with still applies.
 */
export function gridApiFor<T extends object>(grid: ApexGridEnterprise<T>): GridApi<T> {
  return {
    getSchema: () => grid.getSchema(),
    getState: () => grid.getState(),
    getData: () => grid.data,
    getLocaleText: () => grid.localeText,
    applyState: (patch) => grid.setState(patch),
  };
}

/** A complete, empty {@link GridState}. Useful as a fake's initial state and in tests. */
export function emptyGridState(): GridState {
  return {
    version: 1,
    columns: [],
    sort: [],
    filter: [],
    quickFilter: '',
    pagination: { page: 0, pageSize: 25 },
    selection: [],
    expansion: [],
    treeExpanded: [],
    treeExpandedKeys: [],
    modules: {},
  };
}

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
}

/**
 * A pure, in-memory {@link GridApi} for unit tests: no element, no DOM. `applyState`
 * shallow-merges the patch into a stored state and records every patch on `calls`,
 * so components (ContextBuilder, tools, the executor) can be exercised in isolation.
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
    applyState: (patch) => {
      calls.push(patch);
      state = { ...state, ...patch } as GridState;
      return { applied: Object.keys(patch), skipped: [], warnings: [] };
    },
  };
}
