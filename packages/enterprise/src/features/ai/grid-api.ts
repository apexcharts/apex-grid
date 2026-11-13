/**
 * The Grid API abstraction: the one boundary between the AI layer and the grid.
 *
 * Tools depend only on {@link GridApi}, never on `ApexGridEnterprise` internals.
 * View operations funnel through {@link GridApi.applyState} (which reuses the grid's
 * defensive `setState` and the `sanitizePatch` guard); non-state actions are
 * separate, optional, capability-gated methods. `gridApiFor` is the only place that
 * knows the concrete element; tests implement the interface with an in-memory fake.
 *
 * @see plans/ai-reasoning-layer-spec.md (section 4.1)
 */

import type { GridLocaleText, GridSchema, GridState, SetStateResult } from 'apex-grid';
import type { ApexGridEnterprise } from '../../grid-enterprise.js';
import type { StatePatch } from '../ai-schema.js';

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
 * capabilities, and a tool whose action is missing reports a warning instead.
 */
export interface GridApi<T = unknown> {
  /** Columns, capabilities, and the live state: the machine-readable descriptor. */
  getSchema(): GridSchema;
  /** The current view-state snapshot (the undo baseline). */
  getState(): GridState;
  /** The current rows (callers bound the sample they use). */
  getData(): readonly T[];
  /**
   * The grid's `localeText` override map.
   *
   * @remarks
   * The built-in rule engine answers in English whatever this holds (it only
   * parses English prompts). The map is for a custom or LLM reasoner that
   * wants to write its answers, summaries and warnings in the grid's language.
   */
  getLocaleText(): GridLocaleText | undefined;
  /**
   * The grid's layout direction, so a physical word ("left", "right") maps to the
   * logical side it means. Optional: a facade without it reads as `'ltr'`.
   */
  getDirection?(): 'ltr' | 'rtl';

  /** The one declarative view-state mutation. Defensive: it reports what it dropped. */
  applyState(patch: StatePatch): SetStateResult;

  /** Export the current view. Present when the grid advertises an export format. */
  export?(format: string, options?: Record<string, unknown>): ActionResult;
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
    // A remote row model pads `data` with placeholder rows that are not loaded
    // yet; answers cover the loaded rows only. Client data is returned as is.
    getData: () =>
      grid.infiniteRowModel || grid.serverSideRowModel
        ? grid.data.filter((row) => !grid.isRowLoading(row))
        : grid.data,
    getLocaleText: () => grid.localeText,
    // The computed direction (what the layout follows), read directly: this module is
    // lazy-loaded, and importing the shared helper would split it into its own chunk.
    getDirection: () => (getComputedStyle(grid).direction === 'rtl' ? 'rtl' : 'ltr'),
    applyState: (patch) => grid.setState(patch),
    export: (format) => {
      const id = format === 'excel' ? 'xlsx' : format;
      const ids = grid.exportFormats.map((entry) => entry.id);
      if (!ids.includes(id)) {
        return {
          applied: [],
          warnings: [`export: "${format}" is not available (try ${ids.join(', ')})`],
        };
      }
      grid.exportAs(id);
      return { applied: [`export: ${id}`], warnings: [] };
    },
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
