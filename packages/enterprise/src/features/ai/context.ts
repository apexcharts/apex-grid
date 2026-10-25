/**
 * Context Builder: assembles everything a reasoner needs into one immutable object.
 *
 * Pure. It only reads the grid (through {@link GridApi}) and the {@link Memory}; it
 * performs no I/O and touches no clock. The data sample is bounded (and the true row
 * count recorded, so an answer can say "of N rows"), and `now` is injected rather
 * than read from `Date.now()`, so any downstream date parsing is deterministic and
 * testable.
 *
 * @see plans/ai-reasoning-layer-spec.md (section 4.2)
 */

import type { ColumnSchema, GridLocaleText, GridSchema, GridState } from 'apex-grid';
import type { GridApi } from './grid-api.js';
import type { Memory, MemorySnapshot } from './memory.js';
import type { AIMode } from './types.js';

/** The immutable bundle a reasoner reasons over. */
export interface GridContext<T = unknown> {
  schema: GridSchema;
  state: GridState;
  /** Convenience alias of `schema.columns`. */
  columns: ColumnSchema[];
  /**
   * A bounded sample of the current rows, plus the row count and whether it was cut.
   * `rows` is every current row, for grounding a value the sample may miss (the rule
   * resolver reads it). It is not enumerable, so serializing `data` never sends it.
   * `rowCount` counts the rows loaded in the grid: under a server-backed row model
   * (infinite or server-side) that is the loaded rows only, and the server may hold
   * more.
   *
   * The sample holds the bound row objects as they are, every field included, for the
   * rule engine's grounding. What reaches a model is narrower: the LLM bridge
   * (`createLLMReasoner`, which `createClaudeReasoner` builds on) copies
   * each sampled row onto the visible schema columns only (under an active pivot, the
   * source fields the pivot displays), so fields that are not grid columns and hidden
   * columns never leave the page, and sends `rowCount` with it.
   */
  data: {
    sample: readonly T[];
    rowCount: number;
    truncated: boolean;
    readonly rows?: readonly T[];
  };
  memory: MemorySnapshot;
  locale?: GridLocaleText;
  /**
   * The grid's layout direction (from {@link GridApi.getDirection}). Under `'rtl'`
   * "left" means the inline end side. Undefined reads as `'ltr'`.
   */
  direction?: 'ltr' | 'rtl';
  /** Injected clock (0 by default). The engine passes a real value at call time. */
  now: number;
  /**
   * The mode the caller asked for, if any. The rule reasoner ignores it (it is
   * intent-driven); an LLM reasoner uses it to answer vs. act. Undefined = auto.
   */
  requestedMode?: AIMode;
  /** Cooperative cancellation, forwarded from `runPrompt` for any LLM reasoner. */
  signal?: AbortSignal;
}

/** Options for {@link ContextBuilder.build}. */
export interface ContextBuildOptions {
  /** Max rows sampled into `data.sample`. `0` disables the sample; negative means unbounded. */
  maxDataRows?: number;
  /** The clock value to stamp on the context. Defaults to `0`. */
  now?: number;
  /** The requested mode to stamp on the context (see {@link GridContext.requestedMode}). */
  requestedMode?: AIMode;
  /** The abort signal to stamp on the context (see {@link GridContext.signal}). */
  signal?: AbortSignal;
}

/** Builds a {@link GridContext} from a grid and a memory. */
export interface ContextBuilder<T = unknown> {
  build(api: GridApi<T>, memory: Memory, opts?: ContextBuildOptions): GridContext<T>;
}

/**
 * Rows of current data sampled into context by default. This is also the ceiling of
 * what an LLM reasoner can send unless `runPrompt` passes a larger `maxDataRows`.
 */
export const DEFAULT_MAX_DATA_ROWS = 50;

/**
 * The default {@link ContextBuilder}: pure, reading only the grid and the memory.
 */
export function createContextBuilder<T = unknown>(): ContextBuilder<T> {
  return {
    build(api, memory, opts = {}) {
      const schema = api.getSchema();
      const rows = api.getData();
      const max = opts.maxDataRows ?? DEFAULT_MAX_DATA_ROWS;
      const sample = max >= 0 && rows.length > max ? rows.slice(0, max) : rows;
      return {
        schema,
        state: api.getState(),
        columns: schema.columns,
        data: Object.defineProperty(
          { sample, rowCount: rows.length, truncated: sample.length < rows.length },
          'rows',
          { value: rows }
        ),
        memory: memory.snapshot(),
        locale: api.getLocaleText(),
        direction: api.getDirection?.(),
        now: opts.now ?? 0,
        requestedMode: opts.requestedMode,
        signal: opts.signal,
      };
    },
  };
}
