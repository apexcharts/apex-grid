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
  /** A bounded sample of the current rows, plus the true total and whether it was cut. */
  data: { sample: readonly T[]; rowCount: number; truncated: boolean };
  memory: MemorySnapshot;
  locale?: GridLocaleText;
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

/** Rows of current data sampled into context by default (mirrors the shipped Claude adapter bound). */
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
        data: { sample, rowCount: rows.length, truncated: sample.length < rows.length },
        memory: memory.snapshot(),
        locale: api.getLocaleText(),
        now: opts.now ?? 0,
        requestedMode: opts.requestedMode,
        signal: opts.signal,
      };
    },
  };
}
