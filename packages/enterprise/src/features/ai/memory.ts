/**
 * Memory: the conversation and grid-state history the pipeline reads and writes.
 *
 * Two facets, both required by multi-turn control: the sequence of turns
 * (conversation) and the state snapshots captured around each control turn
 * (grid state). Together they enable anaphora ("sort it the other way") and
 * turn-level undo ("undo that"). The default implementation is bounded and
 * in-memory; the interface allows a persisted implementation (localStorage,
 * server) with no change to the rest of the pipeline.
 *
 * @see plans/ai-reasoning-layer-spec.md (section 4.3)
 */

import type { GridState } from 'apex-grid';
import type { Intent, Plan, ResolvedEntities } from './types.js';

/** One recorded exchange: what was asked, what was planned, and the state around it. */
export interface ConversationTurn {
  utterance: string;
  intent?: Intent;
  plan?: Plan;
  outcome: 'applied' | 'answered' | 'no-op' | 'error';
  /** State just before a control turn: the baseline a later "undo" restores. */
  stateBefore?: GridState;
  /** State just after a control turn. */
  stateAfter?: GridState;
  /** Entities resolved this turn, carried forward for anaphora. */
  entities?: ResolvedEntities;
  /** The injected clock value at record time (never `Date.now()` inside the engine). */
  at: number;
}

/** The read-only view of memory a {@link ContextBuilder} folds into the context. */
export interface MemorySnapshot {
  /** Retained turns, most-recent-last. */
  turns: readonly ConversationTurn[];
  /** The most recent turn's resolved entities, for "it" / "that" / "those". */
  lastEntities?: ResolvedEntities;
  /** The `stateBefore` of the most recent applied control turn: the "undo" baseline. */
  lastControlBefore?: GridState;
}

/** The memory contract. Swap the implementation to persist; the pipeline is agnostic. */
export interface Memory {
  snapshot(): MemorySnapshot;
  record(turn: ConversationTurn): void;
  clear(): void;
}

/** Options for {@link ConversationMemory}. */
export interface ConversationMemoryOptions {
  /** Maximum turns retained; the most recent are kept. Default 20. */
  maxTurns?: number;
}

/**
 * The default {@link Memory}: bounded and in-memory. Keeps the most recent
 * `maxTurns` turns and derives the anaphora entities and the undo baseline from
 * them on each `snapshot`.
 */
export class ConversationMemory implements Memory {
  #turns: ConversationTurn[] = [];
  readonly #maxTurns: number;

  constructor(options: ConversationMemoryOptions = {}) {
    this.#maxTurns = Math.max(1, options.maxTurns ?? 20);
  }

  snapshot(): MemorySnapshot {
    let lastEntities: ResolvedEntities | undefined;
    let lastControlBefore: GridState | undefined;
    // Walk newest to oldest, taking the first of each we find.
    for (let i = this.#turns.length - 1; i >= 0; i--) {
      const turn = this.#turns[i];
      if (!lastEntities && turn.entities) lastEntities = turn.entities;
      if (!lastControlBefore && turn.outcome === 'applied' && turn.stateBefore) {
        lastControlBefore = turn.stateBefore;
      }
      if (lastEntities && lastControlBefore) break;
    }
    return { turns: [...this.#turns], lastEntities, lastControlBefore };
  }

  record(turn: ConversationTurn): void {
    this.#turns.push(turn);
    const overflow = this.#turns.length - this.#maxTurns;
    if (overflow > 0) this.#turns.splice(0, overflow);
  }

  clear(): void {
    this.#turns = [];
  }
}
