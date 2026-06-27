import type { ReactiveController } from 'lit';
import { PIPELINE } from '../internal/constants.js';
import type { GridHost, Keys } from '../internal/types.js';

/** Default number of commands retained on the undo stack. */
const DEFAULT_STACK_SIZE = 100;

/**
 * A single recorded cell mutation: the record reference, its column, and the
 * before / after values. `rowIndex` is the view-relative index at record time
 * and is used only for the replayed `cellValueChanged` event (the live record
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
    for (const change of this.changes) {
      this.#write(change, change.newValue);
    }
  }

  public revert(): void {
    // Revert in reverse so overlapping writes to the same cell unwind cleanly.
    for (let i = this.changes.length - 1; i >= 0; i -= 1) {
      this.#write(this.changes[i], this.changes[i].oldValue);
    }
  }

  #write(change: CellChange<T>, value: unknown): void {
    (change.record as Record<string, unknown>)[change.key as string] = value;
    // Re-emit `cellValueChanged` (never the cancellable `cellValueChanging`) so
    // data-bound consumers stay in sync. Validation and history recording are
    // intentionally skipped on replay. Prefer the record's current view index
    // when it is on the page; fall back to the recorded one.
    const liveIndex = this.host.pageItems.indexOf(change.record);
    this.host.emitEvent('cellValueChanged', {
      detail: {
        key: change.key,
        rowIndex: liveIndex >= 0 ? liveIndex : change.rowIndex,
        data: change.record,
        value,
      },
    });
  }
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
  #batch: CellChange<T>[] | null = null;

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
    if (this.#batch) {
      this.#batch.push(change);
      return;
    }
    this.#push(new CellEditCommand(this.host, [change]));
  }

  /**
   * Opens a batch so subsequent {@link record} calls coalesce into one command.
   * Nestable calls are flattened (the outermost {@link endBatch} commits).
   */
  public beginBatch(): void {
    if (!this.enabled) return;
    this.#batch ??= [];
  }

  /**
   * Closes the open batch, pushing it as a single command when it captured any
   * changes.
   */
  public endBatch(): void {
    const batch = this.#batch;
    this.#batch = null;
    if (batch && batch.length > 0) {
      this.#push(new CellEditCommand(this.host, batch));
    }
  }

  /** Reverts the most recent command. No-op when the undo stack is empty. */
  public undo(): void {
    const command = this.#undo.pop();
    if (!command) return;
    command.revert();
    this.#redo.push(command);
    this.#afterReplay(command, 'Undo');
  }

  /** Re-applies the most recently undone command. No-op when nothing to redo. */
  public redo(): void {
    const command = this.#redo.pop();
    if (!command) return;
    command.apply();
    this.#undo.push(command);
    this.#afterReplay(command, 'Redo');
  }

  /** Clears both stacks (e.g. after a data reset). */
  public clear(): void {
    if (this.#undo.length === 0 && this.#redo.length === 0) return;
    this.#undo = [];
    this.#redo = [];
    this.#batch = null;
    this.#emitChanged();
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

  #afterReplay(command: EditCommand, label: string): void {
    this.host.requestUpdate(PIPELINE);
    const count = command instanceof CellEditCommand ? command.changes.length : 1;
    this.host.announce(`${label} ${count} cell ${count === 1 ? 'change' : 'changes'}`);
    this.#emitChanged();
  }

  #emitChanged(): void {
    this.host.emitEvent('historyChanged', {
      detail: { canUndo: this.canUndo, canRedo: this.canRedo },
    });
  }
}
