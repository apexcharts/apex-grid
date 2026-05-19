import type { ReactiveController } from 'lit';
import { PIPELINE } from '../internal/constants.js';
import type {
  ColumnConfiguration,
  EditMode,
  EditTrigger,
  GridHost,
  Keys,
} from '../internal/types.js';

/**
 * The default editing configuration used when the grid has none set.
 */
export const DEFAULT_EDITING_CONFIG = Object.freeze({
  enabled: false,
  mode: 'cell' as EditMode,
  trigger: 'doubleClick' as EditTrigger,
});

interface ActiveCell<T> {
  rowIndex: number;
  columnKey: Keys<T>;
  /**
   * Live reference to the underlying record (preserved through the pipeline so
   * the source array can be mutated on commit).
   */
  data: T;
}

/**
 * Reactive controller backing inline cell + row editing.
 *
 * @remarks
 * Holds the currently active cell / row, pending values for row-mode edits,
 * and is responsible for emitting the cancellable `cellValueChanging` event
 * and follow-up `cellValueChanged` event. The actual data mutation writes
 * through to {@link ApexGrid.data} so changes survive pipeline runs and
 * propagate to consumers that own the source array.
 */
export class EditingController<T extends object> implements ReactiveController {
  /** The cell currently in edit mode, or `null`. */
  public activeCell: ActiveCell<T> | null = null;

  /** The row currently in edit mode (row mode only), or `null`. */
  public activeRow: { rowIndex: number; data: T } | null = null;

  /**
   * Pending values keyed by column for the currently editing row. Populated in
   * row mode as the user edits individual cells; flushed on
   * {@link commitRow}.
   */
  public pending: Map<Keys<T>, unknown> = new Map();

  constructor(protected host: GridHost<T>) {
    this.host.addController(this);
  }

  public hostConnected() {}

  /**
   * Whether editing is enabled at the grid level.
   */
  public get enabled(): boolean {
    return Boolean(this.host.editing?.enabled);
  }

  /**
   * The resolved edit mode (`'cell'` if unset).
   */
  public get mode(): EditMode {
    return this.host.editing?.mode ?? DEFAULT_EDITING_CONFIG.mode;
  }

  /**
   * The resolved edit trigger (`'doubleClick'` if unset).
   */
  public get trigger(): EditTrigger {
    return this.host.editing?.trigger ?? DEFAULT_EDITING_CONFIG.trigger;
  }

  /**
   * Whether the given column can be edited.
   */
  public isEditable(column: ColumnConfiguration<T>): boolean {
    return Boolean(this.enabled && column.editable && !column.hidden);
  }

  /**
   * Whether the cell `(rowIndex, columnKey)` is currently in edit mode.
   */
  public isCellEditing(rowIndex: number, columnKey: Keys<T>): boolean {
    return this.activeCell?.rowIndex === rowIndex && this.activeCell?.columnKey === columnKey;
  }

  /**
   * Whether the given row is currently in edit mode (row mode).
   */
  public isRowEditing(rowIndex: number): boolean {
    return this.activeRow?.rowIndex === rowIndex;
  }

  /**
   * Begins editing the cell at `(rowIndex, columnKey)`. Auto-commits any cell
   * already in edit mode (in cell mode); in row mode it switches the active
   * cell within the same row and rejects cross-row moves.
   *
   * @returns `true` if edit started, `false` if rejected (column not editable
   * or row-mode constraint violated).
   */
  public async editCell(rowIndex: number, columnKey: Keys<T>): Promise<boolean> {
    if (!this.enabled) return false;
    const column = this.host.getColumn(columnKey);
    if (!column || !this.isEditable(column)) return false;
    const data = this.host.pageItems[rowIndex] as T | undefined;
    if (!data) return false;

    if (this.mode === 'row') {
      if (!this.activeRow) {
        await this.editRow(rowIndex);
      } else if (this.activeRow.rowIndex !== rowIndex) {
        // Switching rows in row mode — commit pending edits in the previous row
        // before starting elsewhere.
        const committed = await this.commitRow();
        if (!committed) return false;
        await this.editRow(rowIndex);
      }
    } else if (this.activeCell && !this.isCellEditing(rowIndex, columnKey)) {
      // Cell mode — commit any in-flight cell before switching.
      await this.commitCell();
    }

    this.activeCell = { rowIndex, columnKey, data };
    this.host.requestUpdate();
    return true;
  }

  /**
   * Begins editing the given row in row mode. Emits `rowEditStarted` on
   * success. No-op in cell mode.
   */
  public async editRow(rowIndex: number): Promise<boolean> {
    if (!this.enabled || this.mode !== 'row') return false;
    const data = this.host.pageItems[rowIndex] as T | undefined;
    if (!data) return false;
    if (this.activeRow && this.activeRow.rowIndex !== rowIndex) {
      const committed = await this.commitRow();
      if (!committed) return false;
    }
    if (this.activeRow?.rowIndex === rowIndex) return true;
    this.activeRow = { rowIndex, data };
    this.pending.clear();
    this.host.requestUpdate();
    this.host.emitEvent('rowEditStarted', { detail: { rowIndex } });
    return true;
  }

  /**
   * Commits a candidate value for the currently editing cell. In cell mode the
   * value is written through to {@link ApexGrid.data}; in row mode it is staged
   * in {@link pending} until {@link commitRow} is called.
   *
   * @param value - The candidate value.
   * @returns `true` if accepted (or staged), `false` if rejected by
   * `cellValueChanging.preventDefault()`.
   */
  public async commitCell(value?: unknown): Promise<boolean> {
    const active = this.activeCell;
    if (!active) return false;
    const { rowIndex, columnKey, data } = active;
    const oldValue = (data as Record<string, unknown>)[columnKey as string];
    const candidate = value === undefined ? oldValue : value;

    if (this.mode === 'cell') {
      if (Object.is(candidate, oldValue)) {
        this.activeCell = null;
        this.host.requestUpdate();
        return true;
      }
      const proceed = this.host.emitEvent('cellValueChanging', {
        detail: { key: columnKey, rowIndex, data, oldValue, newValue: candidate },
        cancelable: true,
      });
      if (!proceed) return false;
      (data as Record<string, unknown>)[columnKey as string] = candidate;
      this.activeCell = null;
      this.host.requestUpdate(PIPELINE);
      await this.host.updateComplete;
      this.host.emitEvent('cellValueChanged', {
        detail: { key: columnKey, rowIndex, data, value: candidate },
      });
      return true;
    }

    // Row mode — stage and exit cell edit (row stays open).
    if (!Object.is(candidate, oldValue)) {
      this.pending.set(columnKey, candidate);
    }
    this.activeCell = null;
    this.host.requestUpdate();
    return true;
  }

  /**
   * Discards the current cell edit without writing. In row mode the row edit
   * stays open.
   */
  public cancelCell(): void {
    if (!this.activeCell) return;
    this.activeCell = null;
    this.host.requestUpdate();
  }

  /**
   * Commits all pending edits for the currently editing row. Emits
   * `cellValueChanging` for every changed cell and `rowEditEnded` at the end.
   *
   * @returns `true` if the row was applied, `false` if any cell change was
   * cancelled (the row remains in edit mode in that case).
   */
  public async commitRow(): Promise<boolean> {
    const active = this.activeRow;
    if (!active) return false;
    const { rowIndex, data } = active;

    // Make sure any open cell editor flushes its pending value first.
    if (this.activeCell?.rowIndex === rowIndex) {
      await this.commitCell();
    }

    for (const [columnKey, candidate] of this.pending) {
      const oldValue = (data as Record<string, unknown>)[columnKey as string];
      if (Object.is(candidate, oldValue)) continue;
      const proceed = this.host.emitEvent('cellValueChanging', {
        detail: { key: columnKey, rowIndex, data, oldValue, newValue: candidate },
        cancelable: true,
      });
      if (!proceed) return false;
      (data as Record<string, unknown>)[columnKey as string] = candidate;
      this.host.emitEvent('cellValueChanged', {
        detail: { key: columnKey, rowIndex, data, value: candidate },
      });
    }

    this.pending.clear();
    this.activeRow = null;
    this.host.requestUpdate(PIPELINE);
    await this.host.updateComplete;
    this.host.emitEvent('rowEditEnded', { detail: { rowIndex, committed: true } });
    return true;
  }

  /**
   * Discards every pending edit for the active row and exits row edit mode.
   * Emits `rowEditEnded` with `committed: false`.
   */
  public cancelRow(): void {
    if (!this.activeRow) return;
    const { rowIndex } = this.activeRow;
    this.activeCell = null;
    this.activeRow = null;
    this.pending.clear();
    this.host.requestUpdate();
    this.host.emitEvent('rowEditEnded', { detail: { rowIndex, committed: false } });
  }

  /**
   * Returns the current pending or committed value for `(rowIndex, columnKey)`.
   * Cells in row mode read this so unstaged-but-pending values are reflected
   * during the edit.
   */
  public getValue(rowIndex: number, columnKey: Keys<T>): unknown {
    if (
      this.mode === 'row' &&
      this.activeRow?.rowIndex === rowIndex &&
      this.pending.has(columnKey)
    ) {
      return this.pending.get(columnKey);
    }
    const data = this.host.pageItems[rowIndex] as T | undefined;
    return data ? (data as Record<string, unknown>)[columnKey as string] : undefined;
  }
}
