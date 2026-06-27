import type { ReactiveController } from 'lit';
import { PIPELINE } from '../internal/constants.js';
import type {
  ColumnConfiguration,
  EditMode,
  EditTrigger,
  GridHost,
  Keys,
  Validator,
  ValidatorContext,
} from '../internal/types.js';
import { runValidators } from '../internal/validators.js';

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
 * Outcome of a single committed cell edit routed through
 * {@link EditingController.applyCellEdit}.
 *
 * - `'unchanged'` - the candidate equalled the current value; nothing happened.
 * - `'invalid'` - a column validator rejected the candidate; the value was not
 *   written and `cellValidationFailed` fired.
 * - `'cancelled'` - a `cellValueChanging` listener called `preventDefault()`.
 * - `'applied'` - the value was written and `cellValueChanged` fired.
 */
export type CellEditResult = 'unchanged' | 'invalid' | 'cancelled' | 'applied';

/**
 * Options for {@link EditingController.applyCellEdit}.
 */
export interface ApplyCellEditOptions {
  /**
   * Run the column's declarative validators before writing. Defaults to `true`.
   * Set to `false` for writes that must not be re-validated (e.g. reverting a
   * previously valid value during undo/redo).
   */
  validate?: boolean;
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

  /**
   * Per-record validation errors, keyed by the live data reference and then by
   * column. Keyed by reference (not row index) so an invalid marker tracks its
   * row across pipeline runs (sort / filter / paginate).
   */
  #invalid: Map<T, Map<Keys<T>, string[]>> = new Map();

  #validationVersion = 0;

  /**
   * Monotonic token bumped whenever the validation-error set changes. Forwarded
   * down to each cell as a reactive property so a validation-only change
   * re-renders the affected cells (toggling `aria-invalid` and the error node)
   * without re-running the data pipeline. Stays `0` until the first failure.
   */
  public get validationVersion(): number {
    return this.#validationVersion;
  }

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
   * The single choke point for committing a cell value to the backing record.
   * Short-circuits no-op writes, runs the cancellable `cellValueChanging` gate,
   * writes the value through to {@link ApexGrid.data}, and emits
   * `cellValueChanged`. Returns the {@link CellEditResult} so callers can manage
   * their own UI state (active cell) and batch the render.
   *
   * @remarks
   * Does **not** request a render — callers refresh (once per edit, or once per
   * batch) so row-mode and bulk edits coalesce into a single pipeline pass.
   * Every committed edit (single-cell, row-mode, and enterprise paste/fill)
   * funnels through here so cross-cutting concerns (validation, undo/redo) have
   * one place to hook the old/new values and the write.
   */
  public applyCellEdit(
    rowIndex: number,
    columnKey: Keys<T>,
    data: T,
    value: unknown,
    options?: ApplyCellEditOptions
  ): CellEditResult {
    const record = data as Record<string, unknown>;
    const oldValue = record[columnKey as string];
    if (Object.is(value, oldValue)) {
      // Re-entering the original value clears any stale invalid marker.
      this.clearCellErrors(data, columnKey);
      return 'unchanged';
    }

    if (options?.validate !== false) {
      const errors = this.validateCell(rowIndex, columnKey, data, value);
      if (errors.length > 0) {
        this.#setCellErrors(data, columnKey, errors);
        this.host.emitEvent('cellValidationFailed', {
          detail: { key: columnKey, rowIndex, data, value, errors },
        });
        return 'invalid';
      }
    }

    const proceed = this.host.emitEvent('cellValueChanging', {
      detail: { key: columnKey, rowIndex, data, oldValue, newValue: value },
      cancelable: true,
    });
    if (!proceed) return 'cancelled';

    record[columnKey as string] = value;
    this.clearCellErrors(data, columnKey);
    this.host.emitEvent('cellValueChanged', {
      detail: { key: columnKey, rowIndex, data, value },
    });
    return 'applied';
  }

  /**
   * Runs the column's declarative validators against a candidate value and
   * returns the collected error messages (empty when the value passes or the
   * column has no validators).
   */
  public validateCell(rowIndex: number, columnKey: Keys<T>, data: T, value: unknown): string[] {
    const column = this.host.getColumn(columnKey);
    if (!column?.validators?.length) return [];
    // `ColumnConfiguration<T>` is a distributive conditional, so `validators`
    // and `column` widen to a per-key union here; collapse to the base form for
    // the runner (the runtime shapes are identical).
    return runValidators(column.validators as Validator<T>[], value, {
      column,
      data,
      rowIndex,
    } as ValidatorContext<T>);
  }

  /**
   * The current validation errors for `(data, columnKey)`, or `null` when the
   * cell is valid. Read by {@link ApexGridCell} to drive `aria-invalid` and the
   * inline error node.
   */
  public getCellErrors(data: T, columnKey: Keys<T>): readonly string[] | null {
    return this.#invalid.get(data)?.get(columnKey) ?? null;
  }

  /**
   * Clears any validation error recorded for `(data, columnKey)`.
   */
  public clearCellErrors(data: T, columnKey: Keys<T>): void {
    const perColumn = this.#invalid.get(data);
    if (!perColumn) return;
    if (perColumn.delete(columnKey)) {
      if (perColumn.size === 0) this.#invalid.delete(data);
      this.#validationVersion += 1;
    }
  }

  /**
   * Clears every validation error recorded for a record (all columns).
   */
  public clearRecordErrors(data: T): void {
    if (this.#invalid.delete(data)) {
      this.#validationVersion += 1;
    }
  }

  #setCellErrors(data: T, columnKey: Keys<T>, errors: string[]): void {
    let perColumn = this.#invalid.get(data);
    if (!perColumn) {
      perColumn = new Map();
      this.#invalid.set(data, perColumn);
    }
    perColumn.set(columnKey, errors);
    this.#validationVersion += 1;
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
      const result = this.applyCellEdit(rowIndex, columnKey, data, candidate);
      if (result === 'cancelled') return false;
      // A failed validation keeps the editor open so the user can correct the
      // value; re-render to surface `aria-invalid` + the error node.
      if (result === 'invalid') {
        this.host.requestUpdate();
        return false;
      }
      // Both 'applied' and 'unchanged' close the editor; only an applied write
      // needs the data pipeline to re-run.
      this.activeCell = null;
      if (result === 'applied') {
        this.host.requestUpdate(PIPELINE);
        await this.host.updateComplete;
      } else {
        this.host.requestUpdate();
      }
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
   * Writes `value` directly to the cell at `(rowIndex, columnKey)` without
   * entering edit mode. Used by interactive display widgets (e.g. the boolean
   * checkbox) that handle their own input. Goes through the same
   * `cellValueChanging` / `cellValueChanged` event path as a normal commit.
   *
   * @returns `true` if the value was applied, `false` if rejected by
   * `cellValueChanging.preventDefault()` or the column is not editable.
   */
  public async commitImmediate(
    rowIndex: number,
    columnKey: Keys<T>,
    value: unknown
  ): Promise<boolean> {
    if (!this.enabled) return false;
    const column = this.host.getColumn(columnKey);
    if (!column || !this.isEditable(column)) return false;
    const data = this.host.pageItems[rowIndex] as T | undefined;
    if (!data) return false;

    const result = this.applyCellEdit(rowIndex, columnKey, data, value);
    if (result === 'cancelled') return false;
    if (result === 'invalid') {
      this.host.requestUpdate();
      return false;
    }
    if (result === 'applied') {
      this.host.requestUpdate(PIPELINE);
      await this.host.updateComplete;
    }
    return true;
  }

  /**
   * Discards the current cell edit without writing. In row mode the row edit
   * stays open.
   */
  public cancelCell(): void {
    if (!this.activeCell) return;
    const { data, columnKey } = this.activeCell;
    this.activeCell = null;
    // Abandoning the edit discards any validation error raised for the cell.
    this.clearCellErrors(data, columnKey);
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

    // Pre-validate every pending cell so a single failure aborts the whole row
    // commit without a partial write. Each failing cell is marked invalid and
    // the row stays in edit mode.
    let hasInvalid = false;
    for (const [columnKey, candidate] of this.pending) {
      const errors = this.validateCell(rowIndex, columnKey, data, candidate);
      if (errors.length > 0) {
        this.#setCellErrors(data, columnKey, errors);
        this.host.emitEvent('cellValidationFailed', {
          detail: { key: columnKey, rowIndex, data, value: candidate, errors },
        });
        hasInvalid = true;
      }
    }
    if (hasInvalid) {
      this.host.requestUpdate();
      return false;
    }

    for (const [columnKey, candidate] of this.pending) {
      // Validation already ran above; a cancelled cell aborts the whole row
      // commit, leaving it in edit mode.
      if (
        this.applyCellEdit(rowIndex, columnKey, data, candidate, { validate: false }) ===
        'cancelled'
      ) {
        return false;
      }
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
    const { rowIndex, data } = this.activeRow;
    this.activeCell = null;
    this.activeRow = null;
    this.pending.clear();
    // Abandoning the row discards every validation error raised for it.
    this.clearRecordErrors(data);
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
