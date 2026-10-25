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
  /**
   * The turn took back an earlier change (an "undo" prompt, or a result's
   * `undo()`). Each such turn cancels the newest applied turn not already
   * cancelled, so repeated undos step back through history instead of
   * restoring what the previous undo removed.
   */
  reverts?: boolean;
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
  /**
   * The `stateBefore` of the newest applied control turn that changed the view
   * and that no later turn reverted: the "undo" baseline.
   */
  lastControlBefore?: GridState;
}

/** The memory contract. Swap the implementation to persist; the pipeline is agnostic. */
export interface Memory {
  snapshot(): MemorySnapshot;
  record(turn: ConversationTurn): void;
  clear(): void;
}

type Blob = Record<string, unknown>;

const isBlob = (value: unknown): value is Blob => typeof value === 'object' && value !== null;

/**
 * The slices that differ between two snapshots, as a shape of `true` leaves:
 * `modules` is compared per module, and each module blob per field.
 */
export function changedShape(before: Blob, after: Blob, level = 0): Blob {
  const out: Blob = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const x = before[key];
    const y = after[key];
    if ((level === 1 || (level === 0 && key === 'modules')) && isBlob(x) && isBlob(y)) {
      const inner = changedShape(x, y, level + 1);
      if (Object.keys(inner).length > 0) out[key] = inner;
    } else if (JSON.stringify(x) !== JSON.stringify(y)) {
      out[key] = true;
    }
  }
  return out;
}

/**
 * Whether a turn changed the view. A turn that kept no after state (a custom
 * Memory) is assumed to have changed it.
 */
function changedView({ stateBefore, stateAfter }: ConversationTurn): boolean {
  if (!stateBefore || !stateAfter) return true;
  return Object.keys(changedShape(stateBefore as never, stateAfter as never)).length > 0;
}

/**
 * The turn the next "undo" takes back: walking newest to oldest, each applied
 * turn marked {@link ConversationTurn.reverts} cancels the next older candidate,
 * so repeated undos step back through history. A turn that changed nothing (an
 * export) is passed over, so it never absorbs an undo.
 */
export function undoTarget(turns: readonly ConversationTurn[]): ConversationTurn | undefined {
  let pending = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.outcome !== 'applied') continue;
    if (turn.reverts) pending++;
    else if (turn.stateBefore && changedView(turn)) {
      if (pending === 0) return turn;
      pending--;
    }
  }
  return undefined;
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
    for (let i = this.#turns.length - 1; i >= 0 && !lastEntities; i--) {
      lastEntities = this.#turns[i].entities;
    }
    return {
      turns: [...this.#turns],
      lastEntities,
      lastControlBefore: undoTarget(this.#turns)?.stateBefore,
    };
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
