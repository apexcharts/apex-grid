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
import type { HistoryController } from './history.js';

/**
 * The default editing configuration used when the grid has none set.
 */
export const DEFAULT_EDITING_CONFIG = Object.freeze({
  enabled: false,
  mode: 'cell' as EditMode,
  trigger: 'doubleClick' as EditTrigger,
});

/** {@link EditingController} draft sentinel: the open editor has no typed value yet. */
const NO_DRAFT = Symbol('no-draft');

interface ActiveCell<T> {
  /**
   * The record's view index (matches {@link ApexGrid.pageItems}), refreshed
   * after every grid update; `-1` for a pinned record or one on another page.
   */
  rowIndex: number;
  columnKey: Keys<T>;
  /**
   * Live reference to the underlying record (preserved through the pipeline so
   * the source array can be mutated on commit). The edit is bound to this
   * record, never to the view index, so a sort, filter, page or data change
   * cannot move the editor onto another record.
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
  /**
   * Emit the cancellable `cellValueChanging` before writing. Defaults to
   * `true`. Set to `false` when the caller already ran the gate for this
   * write (a row commit gates every cell before writing any).
   */
  gate?: boolean;
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

  /**
   * The row currently in edit mode (row mode only), or `null`. Bound to its
   * record like {@link activeCell}.
   */
  public activeRow: { rowIndex: number; data: T } | null = null;

  /**
   * Pending values keyed by column for the currently editing row. Populated in
   * row mode as the user edits individual cells; flushed on
   * {@link commitRow}. Holds only values that differ from the record.
   */
  public pending: Map<Keys<T>, unknown> = new Map();

  /**
   * Per-record validation errors, keyed by the live data reference and then by
   * column. Keyed by reference (not row index) so an invalid marker tracks its
   * row across pipeline runs (sort / filter / paginate). Weak, so the markers
   * of records the app replaced are released with them.
   */
  #invalid: WeakMap<T, Map<Keys<T>, string[]>> = new WeakMap();

  #validationVersion = 0;

  /**
   * The open editor's uncommitted value, or {@link NO_DRAFT}. Held here rather
   * than in the cell so a re-render of the editing cell cannot reset it and a
   * bare {@link commitCell} (from `grid.commitEdit()`, a cell switch or a row
   * commit) writes what the user typed.
   */
  #draft: unknown = NO_DRAFT;

  /** Whether {@link #draft} failed validation and has not changed since. */
  #draftRejected = false;

  /**
   * Monotonic token bumped whenever the validation-error set or the staged
   * row-mode values change. Forwarded down to each cell as a reactive property
   * so such a change re-renders the affected cells (toggling `aria-invalid`
   * and the error node, showing a staged value) without re-running the data
   * pipeline. Stays `0` until the first failure or staged value.
   */
  public get validationVersion(): number {
    return this.#validationVersion;
  }

  constructor(
    protected host: GridHost<T>,
    protected history?: HistoryController<T>
  ) {
    this.host.addController(this);
  }

  public hostConnected() {}

  /**
   * Keeps an open edit bound to its record after the view changed: refreshes
   * the reported view index, and cancels the edit when the record left the
   * view (removed, filtered out, replaced by a copy), so no hidden editor can
   * commit later. A record on another page or in a pinned band stays open.
   * Runs only while an edit is open.
   */
  public hostUpdated(): void {
    const data = this.activeRow?.data ?? this.activeCell?.data;
    if (!data) return;
    const rowIndex = this.#indexOf(data);
    if (rowIndex < 0 && !this.#inView(data)) {
      if (this.activeRow) this.cancelRow();
      else this.cancelCell();
      return;
    }
    if (this.activeRow) this.activeRow.rowIndex = rowIndex;
    if (this.activeCell) this.activeCell.rowIndex = rowIndex;
  }

  /** The record's view index (matches {@link ApexGrid.pageItems}), or `-1`. */
  #indexOf(data: T): number {
    return this.host.pageItems.indexOf(data);
  }

  /** Whether the record is still in the processed view or a pinned band. */
  #inView(data: T): boolean {
    return this.host.dataView.includes(data) || this.#isPinned(data);
  }

  #isPinned(data: T): boolean {
    if (!this.host.rowPinning?.enabled) return false;
    const { top, bottom } = this.host.pinnedRows;
    return top.includes(data) || bottom.includes(data);
  }

  /**
   * Whether the record of an open edit is out of sight: on another page, so
   * neither a body row nor a pinned row renders its editor.
   */
  #isHidden(data: T): boolean {
    return this.#indexOf(data) < 0 && !this.#isPinned(data);
  }

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
   * Whether the cell `(data, columnKey)` is currently in edit mode.
   */
  public isCellEditing(data: T, columnKey: Keys<T>): boolean {
    const active = this.activeCell;
    return active !== null && active.data === data && active.columnKey === columnKey;
  }

  /**
   * Begins editing the cell at `(rowIndex, columnKey)`, where `rowIndex` is
   * the view index (matches {@link ApexGrid.pageItems}). See
   * {@link editRecord}.
   */
  public async editCell(rowIndex: number, columnKey: Keys<T>): Promise<boolean> {
    const data = this.host.pageItems[rowIndex] as T | undefined;
    return data ? this.editRecord(data, columnKey) : false;
  }

  /**
   * Begins editing the `columnKey` cell of the record `data`, a body or a
   * pinned row. Auto-commits any cell already in edit mode (in cell mode); in
   * row mode it stages that cell and commits the row first on a cross-row
   * move.
   *
   * @returns `true` if edit started, `false` if rejected (column not editable,
   * the in-flight cell's commit was rejected, or the previous row could not be
   * committed). A rejected commit keeps the in-flight editor open, unless its
   * record is on another page: an edit the user cannot see or correct is
   * cancelled instead, so it cannot block every other edit.
   */
  public async editRecord(data: T, columnKey: Keys<T>): Promise<boolean> {
    if (!this.enabled) return false;
    const column = this.host.getColumn(columnKey);
    if (!column || !this.isEditable(column)) return false;
    // Row mode: switching rows commits the pending edits of the previous row
    // before starting elsewhere.
    if (this.mode === 'row' && !(await this.#openRow(data))) return false;
    if (this.activeCell && !this.isCellEditing(data, columnKey)) {
      // Commit (cell mode) or stage (row mode) the in-flight cell, draft
      // included, before switching. A rejected commit keeps that editor open
      // with its error instead of abandoning it over still-valid data. A
      // draft that already failed validation (the focus loss of the same
      // click) is not validated a second time.
      if (this.#draftRejected || !(await this.commitCell())) {
        if (!this.#isHidden(this.activeCell.data)) return false;
        this.cancelCell();
      }
    }

    if (!this.isCellEditing(data, columnKey)) this.#resetDraft();
    this.activeCell = { rowIndex: this.#indexOf(data), columnKey, data };
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
    return data ? this.#openRow(data) : false;
  }

  /** Opens `data` for a row edit, committing a different open row first. */
  async #openRow(data: T): Promise<boolean> {
    if (this.activeRow?.data === data) return true;
    if (this.activeRow && !(await this.commitRow())) {
      // A rejected row on another page cannot be corrected there: cancel it
      // rather than block every other edit.
      if (!this.#isHidden(this.activeRow.data)) return false;
      this.cancelRow();
    }
    const rowIndex = this.#indexOf(data);
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

    if (options?.gate !== false && !this.#gate(rowIndex, columnKey, data, value)) {
      return 'cancelled';
    }

    record[columnKey as string] = value;
    this.clearCellErrors(data, columnKey);
    this.history?.record({ record: data, key: columnKey, rowIndex, oldValue, newValue: value });
    this.host.emitEvent('cellValueChanged', {
      detail: { key: columnKey, rowIndex, data, value },
    });
    return 'applied';
  }

  /** Emits the cancellable `cellValueChanging`; `false` when a listener vetoed it. */
  #gate(rowIndex: number, columnKey: Keys<T>, data: T, value: unknown): boolean {
    return this.host.emitEvent('cellValueChanging', {
      detail: {
        key: columnKey,
        rowIndex,
        data,
        oldValue: (data as Record<string, unknown>)[columnKey as string],
        newValue: value,
      },
      cancelable: true,
    });
  }

  /**
   * Runs the column's declarative validators against a candidate value and
   * returns the collected error messages (empty when the value passes or the
   * column has no validators).
   *
   * @param row - What validators see as `ctx.data`: the record itself, or in
   * a row commit the staged row (the record with the staged values applied).
   */
  public validateCell(
    rowIndex: number,
    columnKey: Keys<T>,
    data: T,
    value: unknown,
    row: T = data
  ): string[] {
    const column = this.host.getColumn(columnKey);
    if (!column?.validators?.length) return [];
    // `ColumnConfiguration<T>` is a distributive conditional, so `validators`
    // and `column` widen to a per-key union here; collapse to the base form for
    // the runner (the runtime shapes are identical).
    return runValidators(column.validators as Validator<T>[], value, {
      column,
      data: row,
      rowIndex,
    } as ValidatorContext<T>);
  }

  /**
   * The staged row-mode values of `data` keyed by column, or `null` when
   * `data` is not the row in edit. Cells read it to show staged values.
   */
  public stagedValues(data: T): ReadonlyMap<Keys<T>, unknown> | null {
    return this.activeRow?.data === data ? this.pending : null;
  }

  /**
   * Stages `value` for the active row's `columnKey`. A value equal to the
   * record's is unstaged (and its stale error cleared), so re-entering the
   * original undoes a staged edit.
   */
  #stage(data: T, columnKey: Keys<T>, value: unknown): void {
    if (Object.is(value, (data as Record<string, unknown>)[columnKey as string])) {
      if (this.pending.delete(columnKey)) this.#validationVersion += 1;
      this.clearCellErrors(data, columnKey);
    } else if (!this.pending.has(columnKey) || !Object.is(this.pending.get(columnKey), value)) {
      this.pending.set(columnKey, value);
      this.#validationVersion += 1;
    }
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
   * Records the open editor's current, uncommitted value. A later
   * {@link commitCell} without an argument commits it. No-op while no cell is
   * in edit mode.
   */
  public setDraft(value: unknown): void {
    if (!this.activeCell) return;
    this.#draft = value;
    this.#draftRejected = false;
  }

  /**
   * The draft held for the open editor of `(data, columnKey)`, or `null` when
   * that cell is not in edit or nothing was typed. An editor rendered again
   * for an edit already open (its record paged or scrolled back into view)
   * resumes from it, so it shows what a bare {@link commitCell} commits.
   */
  public heldDraft(data: T, columnKey: Keys<T>): { value: unknown } | null {
    return this.#draft === NO_DRAFT || !this.isCellEditing(data, columnKey)
      ? null
      : { value: this.#draft };
  }

  #resetDraft(): void {
    this.#draft = NO_DRAFT;
    this.#draftRejected = false;
  }

  #endCellEdit(): void {
    this.activeCell = null;
    this.#resetDraft();
  }

  /**
   * Commits a candidate value for the currently editing cell. In cell mode the
   * value is written through to {@link ApexGrid.data}; in row mode it is staged
   * in {@link pending} until {@link commitRow} is called.
   *
   * @param args - The candidate value, committed as given (`undefined`
   * included). Called with no argument, it commits the open editor's draft
   * (see {@link setDraft}), or keeps the current value when nothing was typed.
   * @returns `true` if accepted (or staged), `false` if rejected by
   * `cellValueChanging.preventDefault()` or a validator.
   */
  public async commitCell(...args: [value?: unknown]): Promise<boolean> {
    const active = this.activeCell;
    if (!active) return false;
    const { rowIndex, columnKey, data } = active;
    // The value the editor opened on: in row mode a staged value, so an
    // untouched editor keeps it staged.
    const staged = this.stagedValues(data);
    const current = staged?.has(columnKey)
      ? staged.get(columnKey)
      : (data as Record<string, unknown>)[columnKey as string];
    const draft = this.#draft;
    const candidate = args.length > 0 ? args[0] : draft === NO_DRAFT ? current : draft;

    if (this.mode === 'cell') {
      const result = this.applyCellEdit(rowIndex, columnKey, data, candidate);
      if (result === 'cancelled') return false;
      // A failed validation keeps the editor open so the user can correct the
      // value; re-render to surface `aria-invalid` + the error node.
      if (result === 'invalid') {
        if (args.length === 0) this.#draftRejected = true;
        this.host.requestUpdate();
        return false;
      }
      // Both 'applied' and 'unchanged' close the editor; only an applied write
      // needs the data pipeline to re-run.
      this.#endCellEdit();
      if (result === 'applied') {
        this.host.requestUpdate(PIPELINE);
        await this.host.updateComplete;
      } else {
        this.host.requestUpdate();
      }
      return true;
    }

    // Row mode: stage and exit cell edit (row stays open).
    this.#stage(data, columnKey, candidate);
    this.#endCellEdit();
    this.host.requestUpdate();
    return true;
  }

  /**
   * Writes `value` directly to the `columnKey` cell of the record `data` (a
   * body or a pinned row) without entering edit mode. Used by interactive
   * display widgets (e.g. the boolean checkbox) that handle their own input.
   * Goes through the same `cellValueChanging` / `cellValueChanged` event path
   * as a normal commit. In row mode the value joins the row's staged values
   * instead (opening the row edit first), so it commits or cancels with the
   * rest of the row.
   *
   * @returns `true` if the value was applied (or staged), `false` if rejected
   * by `cellValueChanging.preventDefault()`, a validator, a previous row that
   * could not be committed, or the column is not editable.
   */
  public async commitImmediate(data: T, columnKey: Keys<T>, value: unknown): Promise<boolean> {
    if (!this.enabled) return false;
    const column = this.host.getColumn(columnKey);
    if (!column || !this.isEditable(column)) return false;

    if (this.mode === 'row') {
      if (!(await this.#openRow(data))) return false;
      this.#stage(data, columnKey, value);
      this.host.requestUpdate();
      return true;
    }

    const result = this.applyCellEdit(this.#indexOf(data), columnKey, data, value);
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
    this.#endCellEdit();
    // Abandoning the edit discards any validation error raised for the cell.
    this.clearCellErrors(data, columnKey);
    this.host.requestUpdate();
  }

  /**
   * Commits all pending edits for the currently editing row. Emits
   * `cellValueChanging` for every changed cell and `rowEditEnded` at the end.
   *
   * @remarks
   * Validators see the staged row as `ctx.data`, and once any value is staged
   * the other editable cells of the row are validated too, so a cross-field
   * rule judges the row being saved. Every cell passes its `cellValueChanging`
   * gate before any is written: an invalid or cancelled cell aborts the whole
   * row.
   *
   * @returns `true` if the row was applied, `false` if any cell failed
   * validation or its change was cancelled (the row remains in edit mode).
   */
  public async commitRow(): Promise<boolean> {
    const active = this.activeRow;
    if (!active) return false;
    const { data } = active;

    // Make sure any open cell editor flushes its pending value first.
    if (this.activeCell?.data === data) {
      await this.commitCell();
    }
    const rowIndex = active.rowIndex;
    const record = data as Record<string, unknown>;
    const changes = [...this.pending].filter(
      ([columnKey, candidate]) => !Object.is(candidate, record[columnKey as string])
    );

    if (this.pending.size > 0 && !this.#validateRow(rowIndex, data)) {
      this.host.requestUpdate();
      return false;
    }
    for (const [columnKey, candidate] of changes) {
      if (!this.#gate(rowIndex, columnKey, data, candidate)) return false;
    }

    // Coalesce the row's writes into one undo step. Validation and the gate
    // already ran above for every cell.
    this.history?.beginBatch();
    try {
      for (const [columnKey, candidate] of changes) {
        this.applyCellEdit(rowIndex, columnKey, data, candidate, { validate: false, gate: false });
      }
    } finally {
      this.history?.endBatch();
    }

    // Staged values were showing in the row's cells, and a cell whose record
    // value ended where it started gets no new value binding: re-render them.
    if (this.pending.size > 0) this.#validationVersion += 1;
    this.pending.clear();
    this.activeRow = null;
    this.host.requestUpdate(PIPELINE);
    await this.host.updateComplete;
    this.host.emitEvent('rowEditEnded', { detail: { rowIndex, committed: true } });
    return true;
  }

  /**
   * Validates the staged row, marking each failing cell (and clearing the
   * marker of each passing one). `false` when any cell failed. A staged cell
   * is judged on its staged value; another editable cell fails only when the
   * staged values made it invalid (a cross-field rule), so an untouched value
   * that was already invalid does not block the row.
   */
  #validateRow(rowIndex: number, data: T): boolean {
    // The record with the staged values applied, keeping its prototype so
    // validators reading accessors or methods still work.
    const row = Object.assign(Object.create(Object.getPrototypeOf(data)), data) as T;
    for (const [columnKey, value] of this.pending) {
      (row as Record<string, unknown>)[columnKey as string] = value;
    }
    let valid = true;
    for (const column of this.host.columns) {
      if (!this.isEditable(column) || !column.validators?.length) continue;
      const columnKey = column.key;
      const value = (row as Record<string, unknown>)[columnKey as string];
      const errors = this.#validateStaged(rowIndex, columnKey, data, value, row);
      if (errors.length === 0) {
        this.clearCellErrors(data, columnKey);
        continue;
      }
      if (
        !this.pending.has(columnKey) &&
        this.validateCell(rowIndex, columnKey, data, value).length > 0
      ) {
        continue;
      }
      valid = false;
      this.#setCellErrors(data, columnKey, errors);
      this.host.emitEvent('cellValidationFailed', {
        detail: { key: columnKey, rowIndex, data, value, errors },
      });
    }
    return valid;
  }

  /**
   * Validates a cell against the staged row. A validator that throws on the
   * copy (one reading private class fields of the record, say) is run again
   * against the live record, as before staged rows existed; a throw there
   * propagates.
   */
  #validateStaged(rowIndex: number, columnKey: Keys<T>, data: T, value: unknown, row: T): string[] {
    try {
      return this.validateCell(rowIndex, columnKey, data, value, row);
    } catch {
      return this.validateCell(rowIndex, columnKey, data, value);
    }
  }

  /**
   * Discards every pending edit for the active row and exits row edit mode.
   * Emits `rowEditEnded` with `committed: false`.
   */
  public cancelRow(): void {
    if (!this.activeRow) return;
    const { rowIndex, data } = this.activeRow;
    this.#endCellEdit();
    this.activeRow = null;
    // Staged values were showing in the row's cells: re-render them.
    if (this.pending.size > 0) this.#validationVersion += 1;
    this.pending.clear();
    // Abandoning the row discards every validation error raised for it.
    this.clearRecordErrors(data);
    this.host.requestUpdate();
    this.host.emitEvent('rowEditEnded', { detail: { rowIndex, committed: false } });
  }
}
