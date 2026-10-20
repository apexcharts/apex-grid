import type { ReactiveController } from 'lit';
import { PIPELINE } from '../internal/constants.js';
import type { GridHost, Keys } from '../internal/types.js';

/** Default number of commands retained on the undo stack. */
const DEFAULT_STACK_SIZE = 100;

/**
 * A single recorded cell mutation: the record reference, its column, and the
 * before / after values. `rowIndex` is the view-relative index at record time;
 * replay reports the record's index at replay time instead (the live record
 * reference is authoritative).
 */
export interface CellChange<T extends object> {
  record: T;
  key: Keys<T>;
  rowIndex: number;
  oldValue: unknown;
  newValue: unknown;
}

/**
 * A reversible unit of work on the history stacks.
 *
 * @remarks
 * `apply` re-performs the change (redo); `revert` undoes it. Cell-data edits use
 * {@link CellEditCommand}; the interface is deliberately open so later command
 * kinds (e.g. view-state) can join the same stacks.
 */
export interface EditCommand {
  apply(): void;
  revert(): void;
}

/**
 * One or more cell mutations that undo / redo as a single step. A single-cell
 * edit holds one change; a row-mode commit or a bulk paste / fill holds many so
 * one Ctrl+Z reverts the whole batch.
 */
export class CellEditCommand<T extends object> implements EditCommand {
  constructor(
    private host: GridHost<T>,
    public readonly changes: ReadonlyArray<CellChange<T>>
  ) {}

  public apply(): void {
    const indexOf = viewIndexer(this.host.pageItems, this.changes.length);
    for (const change of this.changes) {
      this.#write(change, change.newValue, indexOf);
    }
  }

  public revert(): void {
    const indexOf = viewIndexer(this.host.pageItems, this.changes.length);
    // Revert in reverse so overlapping writes to the same cell unwind cleanly.
    for (let i = this.changes.length - 1; i >= 0; i -= 1) {
      this.#write(this.changes[i], this.changes[i].oldValue, indexOf);
    }
  }

  #write(change: CellChange<T>, value: unknown, indexOf: (record: T) => number): void {
    (change.record as Record<string, unknown>)[change.key as string] = value;
    // Re-emit `cellValueChanged` (never the cancellable `cellValueChanging`) so
    // data-bound consumers stay in sync. Validation and history recording are
    // intentionally skipped on replay. The index is where the record is now:
    // -1 when it is pinned or on another page.
    this.host.emitEvent('cellValueChanged', {
      detail: { key: change.key, rowIndex: indexOf(change.record), data: change.record, value },
    });
  }
}

/**
 * Returns a lookup of a record's index in `items` (by reference, `-1` when
 * absent). For more than one lookup it indexes `items` once, so a large batch
 * costs one pass instead of one scan per record.
 */
export function viewIndexer<T>(items: ReadonlyArray<T>, lookups: number): (record: T) => number {
  if (lookups < 2) return (record) => items.indexOf(record);
  let index: Map<T, number> | undefined;
  return (record) => {
    if (!index) {
      index = new Map();
      // Backwards, so a record listed twice resolves to its first index.
      for (let i = items.length - 1; i >= 0; i -= 1) index.set(items[i], i);
    }
    return index.get(record) ?? -1;
  };
}

/**
 * Reactive controller owning the undo / redo stacks for cell-data edits.
 *
 * @remarks
 * Recording is driven from the {@link EditingController.applyCellEdit} choke
 * point: every successful write calls {@link record}. Single edits push one
 * command; {@link beginBatch} / {@link endBatch} coalesce a row-mode commit or a
 * bulk paste / fill into one command. Disabled unless
 * `editing.history.enabled` is set, so the community grid pays nothing.
 */
export class HistoryController<T extends object> implements ReactiveController {
  #undo: EditCommand[] = [];
  #redo: EditCommand[] = [];
  /** Changes recorded by the open batch, pushed as one command when it closes. */
  #batch: CellChange<T>[] = [];
  /** Open {@link beginBatch} calls; only the outermost {@link endBatch} commits. */
  #depth = 0;

  constructor(protected host: GridHost<T>) {
    this.host.addController(this);
  }

  public hostConnected(): void {}

  /** Whether undo / redo tracking is enabled. */
  public get enabled(): boolean {
    return Boolean(this.host.editing?.history?.enabled);
  }

  /** Maximum number of commands retained on the undo stack. */
  public get stackSize(): number {
    const size = this.host.editing?.history?.stackSize;
    return typeof size === 'number' && size > 0 ? size : DEFAULT_STACK_SIZE;
  }

  /** Whether there is at least one command to undo. */
  public get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  /** Whether there is at least one command to redo. */
  public get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  /**
   * Records a single cell mutation. Routed to the open batch when one is active,
   * otherwise pushed immediately as a standalone command. No-op when history is
   * disabled.
   */
  public record(change: CellChange<T>): void {
    if (!this.enabled) return;
    if (this.#depth > 0) {
      this.#batch.push(change);
      return;
    }
    this.#push(new CellEditCommand(this.host, [change]));
  }

  /**
   * Opens a batch so subsequent {@link record} calls coalesce into one command.
   * Nested calls are flattened: a batch opened while another is open (a
   * `cellValueChanged` listener that calls `applyEdits`, say) joins it, and
   * only the outermost {@link endBatch} commits. Counted even while history
   * is disabled, so every begin pairs with its end.
   */
  public beginBatch(): void {
    this.#depth += 1;
  }

  /**
   * Closes the innermost open batch. Closing the outermost pushes everything
   * it captured as a single command.
   */
  public endBatch(): void {
    if (this.#depth === 0 || --this.#depth > 0) return;
    const batch = this.#batch;
    this.#batch = [];
    if (batch.length > 0) {
      this.#push(new CellEditCommand(this.host, batch));
    }
  }

  /** Reverts the most recent command. No-op when the undo stack is empty. */
  public undo(): void {
    const command = this.#undo.pop();
    if (!command) return;
    command.revert();
    this.#redo.push(command);
    this.#afterReplay(command, 'undo');
  }

  /** Re-applies the most recently undone command. No-op when nothing to redo. */
  public redo(): void {
    const command = this.#redo.pop();
    if (!command) return;
    command.apply();
    this.#undo.push(command);
    this.#afterReplay(command, 'redo');
  }

  /** Clears both stacks, and the changes an open batch has captured so far. */
  public clear(): void {
    this.#batch = [];
    if (this.#undo.length === 0 && this.#redo.length === 0) return;
    this.#undo = [];
    this.#redo = [];
    this.#emitChanged();
  }

  /**
   * Clears both stacks when the grid's data was replaced and a recorded change
   * names a record that `records` no longer yields (a reload with new objects).
   * Replaying onto such a detached record would change nothing on screen while
   * still reporting the edit. New data that keeps the edited records (an
   * append, a re-sorted copy) keeps its history. `records` is read only while
   * a stack has entries, so the caller may pass an expensive source.
   */
  public reconcile(records: () => Iterable<T>): void {
    if (this.#undo.length === 0 && this.#redo.length === 0) return;
    const live = new Set(records());
    const stale = (command: EditCommand) =>
      command instanceof CellEditCommand &&
      command.changes.some((change: CellChange<T>) => !live.has(change.record));
    if (this.#undo.some(stale) || this.#redo.some(stale)) this.clear();
  }

  #push(command: EditCommand): void {
    this.#undo.push(command);
    // A fresh edit invalidates the redo branch.
    this.#redo = [];
    // Evict the oldest commands once the stack exceeds its cap.
    while (this.#undo.length > this.stackSize) {
      this.#undo.shift();
    }
    this.#emitChanged();
  }

  #afterReplay(command: EditCommand, kind: 'undo' | 'redo'): void {
    this.host.requestUpdate(PIPELINE);
    const count = command instanceof CellEditCommand ? command.changes.length : 1;
    const key =
      kind === 'undo'
        ? count === 1
          ? 'announce.undoOne'
          : 'announce.undoMany'
        : count === 1
          ? 'announce.redoOne'
          : 'announce.redoMany';
    this.host.announce(this.host.localize(key, { count }));
    this.#emitChanged();
  }

  #emitChanged(): void {
    this.host.emitEvent('historyChanged', {
      detail: { canUndo: this.canUndo, canRedo: this.canRedo },
    });
  }
}
