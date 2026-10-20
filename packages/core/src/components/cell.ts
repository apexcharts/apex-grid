import { consume } from '@lit/context';
import { html, LitElement, type PropertyValues } from 'lit';
import { property, query } from 'lit/decorators.js';
import { gridStateContext, type StateController } from '../controllers/state.js';
import { getColumnTypeRenderer } from '../internal/column-types.js';
import { registerComponent } from '../internal/register.js';
import { GRID_CELL_TAG, GRID_ROW_TAG } from '../internal/tags.js';
import type {
  ActiveNode,
  ApexCellContext,
  ApexEditorContext,
  ColumnConfiguration,
  PropertyType,
} from '../internal/types.js';
import { styles } from '../styles/body-cell/body-cell.css.js';
import type ApexGridRow from './row.js';

/**
 * A spreadsheet-style error value (e.g. the enterprise formula engine's
 * `#VALUE!` / `#DIV/0!`). Duck-typed so core carries no dependency on the
 * enterprise layer: any value that is an object carrying a `#...` string `code`
 * is rendered as that code, even in a typed (currency / number) column whose
 * numeric renderer would otherwise coerce it to `NaN` and show nothing.
 */
function isErrorLike(value: unknown): value is { code: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    (value as { code: string }).code.startsWith('#')
  );
}

/** The body rows rendered under `body` (the rows' shared parent). */
function renderedRows<T extends object>(body: Element | null): ApexGridRow<T>[] {
  if (!body) return [];
  return Array.from(body.children).filter(
    (element) => element.localName === GRID_ROW_TAG
  ) as unknown as ApexGridRow<T>[];
}

/**
 * The cell Tab moves to from column `key` of view row `from`: the neighbouring
 * column (`keys`) of that row or, past the row edge, the first (or last) column
 * of the nearest row in that direction that renders cells, skipping full-width
 * rows. `null` at the edge of the grid's `count` view rows.
 */
function tabTarget<T extends object>(
  count: number,
  from: number,
  keys: ColumnConfiguration<T>['key'][],
  key: ColumnConfiguration<T>['key'],
  step: 1 | -1,
  isFullWidth: (index: number) => boolean
): ActiveNode<T> | null {
  const column = keys[keys.indexOf(key) + step];
  if (column !== undefined) return { row: from, column };
  const wrapColumn = keys[step > 0 ? 0 : keys.length - 1];
  for (let index = from + step; index >= 0 && index < count; index += step) {
    if (!isFullWidth(index)) return { row: index, column: wrapColumn };
  }
  return null;
}

/**
 * The view row nearest `start` (clamped to the `count` rows) that renders
 * cells, looking in the `step` direction first. `-1` when none does.
 */
function nearestCellRow(
  count: number,
  start: number,
  step: 1 | -1,
  isFullWidth: (index: number) => boolean
): number {
  const origin = Math.min(Math.max(start, 0), count - 1);
  for (let distance = 0; distance < count; distance++) {
    for (const index of [origin + distance * step, origin - distance * step]) {
      if (index >= 0 && index < count && !isFullWidth(index)) return index;
    }
  }
  return -1;
}

/** The rendered cell for `node` under `body`, if its row is rendered. */
function findRenderedCell<T extends object>(body: Element | null, node: ActiveNode<T>) {
  return renderedRows<T>(body)
    .find((row) => row.index === node.row)
    ?.cells.find((cell) => cell.column.key === node.column);
}

/**
 * Scrolls `scroller` (the grid host, which owns the body's scrolling) so view
 * row `index`, outside the rows rendered under `body`, lands about mid-view,
 * placing it from the rendered rows' positions and average height. The
 * virtualizer then renders it on the scroll and the landed cell is aligned
 * exactly. (The virtualizer's own `element(index).scrollIntoView()` pin does
 * not work with the grid host as the scroller: it jumps to the end of the
 * range and renders no rows.)
 */
function scrollRowIntoRange(scroller: HTMLElement, body: Element | null, index: number) {
  const rows = renderedRows(body).sort((a, b) => a.index - b.index);
  const first = rows.at(0);
  const last = rows.at(-1);
  if (!first || !last) return;
  const top = first.getBoundingClientRect().top;
  const height = (last.getBoundingClientRect().bottom - top) / (last.index - first.index + 1);
  const view = scroller.getBoundingClientRect();
  const rowCentre = top + (index - first.index + 0.5) * height;
  scroller.scrollTop += rowCentre - (view.top + scroller.clientHeight / 2);
}

/**
 * Component representing a DOM cell of the Apex grid.
 *
 * @csspart cell - The cell host element.
 * @csspart editor - The editor wrapper rendered while the cell is in edit mode.
 */
export default class ApexGridCell<T extends object> extends LitElement {
  public static get tagName() {
    return GRID_CELL_TAG;
  }

  public static override styles = styles;

  public static register(): void {
    registerComponent(ApexGridCell);
  }

  /**
   * The value which will be rendered by the component.
   */
  @property({ attribute: false })
  public value!: PropertyType<T>;

  /**
   * A reference to the column configuration object.
   */
  @property({ attribute: false })
  public column!: ColumnConfiguration<T>;

  /**
   * Indicates whether this is the active cell in the grid.
   *
   */
  @property({ type: Boolean, reflect: true })
  public active = false;

  /**
   * Whether the cell is currently in edit mode. Set by the parent row from the
   * editing controller's state so cells re-render on edit state changes.
   */
  @property({ type: Boolean, reflect: true })
  public editing = false;

  @consume({ context: gridStateContext, subscribe: true })
  @property({ attribute: false })
  public state!: StateController<T>;

  /**
   * The parent row component holding this cell.
   */
  public row!: ApexGridRow<T>;

  @query('input, [data-apex-editor]')
  protected editorElement!: HTMLElement | null;

  protected get context(): ApexCellContext<T> {
    const ctx = {
      parent: this,
      row: this.row,
      column: this.column,
      value: this.value,
    } as unknown as {
      parent: ApexGridCell<T>;
      row: ApexGridRow<T>;
      column: ColumnConfiguration<T>;
      value: PropertyType<T>;
      commit?: (value: unknown) => Promise<boolean>;
    };
    // Only expose `commit` when the column is editable — non-editable
    // interactive widgets should render as read-only.
    if (this.isEditable) {
      ctx.commit = (next: unknown) =>
        this.editingController.commitImmediate(this.row.data, this.column.key, next);
    }
    return ctx as unknown as ApexCellContext<T>;
  }

  protected get editingController() {
    return this.state.editing;
  }

  protected get isEditing(): boolean {
    return this.editing;
  }

  protected get isEditable(): boolean {
    if (!this.editingController) return false;
    return this.editingController.isEditable(this.column);
  }

  /** Whether the cell's row renders in a pinned band rather than the body. */
  get #inPinnedBand(): boolean {
    const pin = this.state.rowPin;
    return pin.hasPinnedRows && pin.enabled && pin.isPinned(this.row.data);
  }

  /**
   * 1-based column index used to populate `aria-colindex`. Accounts for the
   * auto-rendered selection + expansion columns ahead of the data columns.
   */
  @property({ attribute: false, type: Number })
  public colindex = 0;

  /**
   * Reactive token forwarded from {@link StateController.decorationVersion}.
   * Changing it re-runs {@link willUpdate} so module-driven cell decoration is
   * re-evaluated when it changes (e.g. while dragging a selection range). Stays
   * `0` for the community grid, so cells are never re-decorated there.
   */
  @property({ attribute: false, type: Number })
  public decorationVersion = 0;

  /**
   * Reactive token forwarded from {@link EditingController.validationVersion}.
   * Changing it re-runs {@link willUpdate} so the cell re-reads its validation
   * errors and toggles `aria-invalid` / the inline error node. Stays `0` until
   * the first validation failure.
   */
  @property({ attribute: false, type: Number })
  public validationVersion = 0;

  /** Decoration attribute keys applied on the previous update, for cleanup. */
  #decoratedKeys: string[] = [];

  /** DOM id of the inline error node, referenced by `aria-errormessage`. */
  static readonly #ERROR_ID = 'apex-cell-error';

  /** Validation errors resolved in {@link willUpdate}, consumed in render. */
  #errors: readonly string[] | null = null;

  /** Whether {@link value} currently shows a staged row-mode value. */
  #staged = false;

  /**
   * The held draft the editor resumed from when it opened on an edit already
   * in progress (see {@link #editorValue}), or `null`.
   */
  #resumed: { value: unknown } | null = null;

  public override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'gridcell');
    this.addEventListener('click', this.#handleClick);
    this.addEventListener('dblclick', this.#handleDoubleClick);
    this.addEventListener('keydown', this.#handleCellKeydown);
    this.addEventListener('focusout', this.#handleCellFocusOut);
  }

  public override disconnectedCallback(): void {
    this.removeEventListener('click', this.#handleClick);
    this.removeEventListener('dblclick', this.#handleDoubleClick);
    this.removeEventListener('keydown', this.#handleCellKeydown);
    this.removeEventListener('focusout', this.#handleCellFocusOut);
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>) {
    this.#applyStaged();
    if (changed.has('editing')) {
      this.#resumed = this.editing
        ? this.editingController.heldDraft(this.row.data, this.column.key)
        : null;
    }
    if (this.colindex > 0) {
      this.setAttribute('aria-colindex', String(this.colindex));
    } else {
      this.removeAttribute('aria-colindex');
    }
    // Roving tabindex: the active cell is the grid body's single tab stop, so
    // real focus (not just `aria-current`) tracks keyboard navigation and
    // screen readers follow arrow-key movement cell to cell.
    this.tabIndex = this.active ? 0 : -1;
    if (this.active) {
      this.setAttribute('aria-current', 'true');
    } else {
      this.removeAttribute('aria-current');
    }
    // Reflect tree-expanded state on the group cell so the SCSS chevron
    // rotation triggers from this attribute (cheaper than per-render style
    // mutations and keeps the SVG transform purely declarative).
    const tree = this.state?.tree;
    const isGroup = tree?.enabled && this.row?.data && tree.isGroupColumn(this.column.key);
    if (isGroup && tree.isExpanded(this.row.data)) {
      this.setAttribute('data-tree-expanded', '');
    } else {
      this.removeAttribute('data-tree-expanded');
    }

    this.#applyValidation();
    this.#applyDecoration();
  }

  /**
   * Row mode: while the row is in edit, shows the cell's staged value in
   * place of the record's (display and a re-opened editor alike), and the
   * record's again once the row commits or cancels. One property read for
   * cells of rows not in edit.
   */
  #applyStaged(): void {
    const staged = this.state?.editing?.activeRow
      ? this.editingController.stagedValues(this.row.data)
      : null;
    const key = this.column.key;
    if (staged?.has(key)) {
      this.value = staged.get(key) as PropertyType<T>;
      this.#staged = true;
    } else if (this.#staged) {
      this.#staged = false;
      this.value = this.row.data[key] as PropertyType<T>;
    }
  }

  /**
   * Reflects the cell's validation state from the editing controller: stores the
   * current error messages for {@link render} and toggles `aria-invalid` +
   * `aria-errormessage` + `data-invalid` on the host. Inert for cells whose
   * column has no validators (the lookup returns `null`).
   */
  #applyValidation(): void {
    const errors =
      this.state && this.row?.data
        ? (this.editingController?.getCellErrors(this.row.data, this.column.key) ?? null)
        : null;
    this.#errors = errors && errors.length > 0 ? errors : null;

    if (this.#errors) {
      this.setAttribute('aria-invalid', 'true');
      this.setAttribute('aria-errormessage', ApexGridCell.#ERROR_ID);
      this.setAttribute('data-invalid', '');
      this.setAttribute('title', this.#errors.join('; '));
    } else {
      this.removeAttribute('aria-invalid');
      this.removeAttribute('aria-errormessage');
      this.removeAttribute('data-invalid');
      this.removeAttribute('title');
    }
  }

  /**
   * The inline error node surfaced when the cell is invalid. `role="alert"`
   * announces the message when it appears, covering the cross-shadow gap where
   * an `aria-errormessage` IDREF on the host can't reach this node.
   */
  protected renderError() {
    if (!this.#errors) return null;
    return html`<span
      part="cell-error"
      id=${ApexGridCell.#ERROR_ID}
      role="alert"
      >${this.#errors.join('; ')}</span
    >`;
  }

  /**
   * Reflects module-contributed decoration attributes (see {@link CellDecorator})
   * onto the cell host, reconciling against the previous update so attributes
   * that are no longer present are removed. Inert for the community grid:
   * `state.decorateCell` returns `null` with no modules, so nothing is set.
   */
  #applyDecoration(): void {
    const decoration =
      this.state && this.row
        ? this.state.decorateCell({
            row: this.row.data,
            // A pinned row is outside the body view (`pageItems`), so its
            // band-local index must not match a body row's.
            rowIndex: this.#inPinnedBand ? -1 : this.row.index,
            column: this.column,
            value: this.value as unknown,
          })
        : null;
    const next = decoration?.attributes ?? {};

    // Remove anything we set last time that's gone (or explicitly cleared).
    for (const key of this.#decoratedKeys) {
      if (next[key] == null) this.removeAttribute(key);
    }

    const applied: string[] = [];
    for (const [key, value] of Object.entries(next)) {
      if (value == null) {
        this.removeAttribute(key);
      } else {
        this.setAttribute(key, value);
        applied.push(key);
      }
    }
    this.#decoratedKeys = applied;
  }

  protected override updated(changed: PropertyValues<this>) {
    if (this.isEditing) {
      // Focus and select only on entering edit mode: a mid-edit re-render
      // (validation, decoration) must keep the caret and the user's focus.
      if (!changed.has('editing')) return;
      const editor = this.editorElement;
      editor?.focus();
      if (editor instanceof HTMLInputElement) {
        if (editor.type === 'text' || editor.type === 'number') {
          editor.select();
        }
      }
      return;
    }
    // A keyboard-committed (or cancelled) edit removes the focused editor from
    // the DOM; hand focus back to the cell host so grid navigation continues
    // from where the user was. Pointer-driven exits (blur / outside click)
    // never set the flag, so they don't steal focus from the click target.
    if (changed.get('editing') === true && this.#refocusAfterEdit) {
      this.#refocusAfterEdit = false;
      this.focus();
    }
  }

  #handleClick = (event: MouseEvent) => {
    if (this.isEditing) {
      // Don't let clicks inside the editor bubble into navigation / outside-click commits.
      event.stopPropagation();
      return;
    }
    if (!this.isEditable) return;
    // Boolean cells handle interaction in their display widget — clicking the
    // checkbox commits inline via `ctx.commit`. We never enter edit mode for
    // booleans, which avoids the visual reflow between display/editor markup
    // and lets a single click toggle the value.
    if (this.column.type === 'boolean') return;
    if (this.editingController.trigger !== 'click') return;
    this.#startEdit();
  };

  #handleDoubleClick = (event: MouseEvent) => {
    if (this.isEditing) {
      event.stopPropagation();
      return;
    }
    if (!this.isEditable) return;
    if (this.column.type === 'boolean') return;
    if (this.editingController.trigger !== 'doubleClick') return;
    this.#startEdit();
  };

  #startEdit() {
    if (!this.row) return;
    // By record, so a pinned row edits its own record, not the body row at
    // its band-local index.
    this.editingController.editRecord(this.row.data, this.column.key);
  }

  /** Set by keyboard-driven commit/cancel so `updated` refocuses the cell host. */
  #refocusAfterEdit = false;

  /** Commits the open editor's draft (held by the editing controller). */
  #commit = (): Promise<boolean> => this.editingController.commitCell();

  #cancel = () => {
    this.editingController.cancelCell();
  };

  /**
   * Tab while editing: commits the draft and, once the commit is accepted,
   * moves the active cell and focus to the next cell (Shift+Tab: the previous
   * one), wrapping across rows, and scrolls it into view. The landed cell
   * stays closed (Enter or F2 opens it); a rejected commit keeps the editor
   * open. With no cell to land on (grid edge, only full-width rows such as
   * group headers beyond), focus stays on the edited record's cell.
   *
   * The target is resolved after the commit settles, from the edited record's
   * position in {@link ApexGrid.pageItems}: a commit can re-sort or regroup
   * the rows (the edited value is a sort or group key), so the record may now
   * sit at another index, outside the rows the virtualizer renders; the target
   * row is scrolled into view before it is focused. When the commit removed
   * the record from the view (filtered out, moved into a collapsed group, or
   * replaced by a listener writing a new object), focus stays in the grid on
   * the cell nearest the edited position.
   */
  #commitAndTab(event: KeyboardEvent): void {
    event.preventDefault();
    if (this.#inPinnedBand) {
      // Pinned rows sit outside the body's keyboard model: commit and keep
      // focus on this cell.
      this.#refocusAfterEdit = true;
      void this.#commit();
      return;
    }
    const step = event.shiftKey ? -1 : 1;
    const host = this.state.host;
    const body = this.row.parentElement as
      | (HTMLElement & { updateComplete?: Promise<unknown> })
      | null;
    const record = this.row.data;
    const origin = this.row.index;
    const key = this.column.key;
    const columns = this.row.columns;
    const keys = this.row.cells.map((cell) => cell.column.key);
    // The grid, then the rows' container (the virtualizer re-renders its rows
    // in its own update), then the rows themselves (a row that now holds a
    // full-width record drops its cells in its own update).
    const settle = async () => {
      await host.updateComplete;
      await body?.updateComplete;
      await Promise.all(renderedRows<T>(body).map((row) => row.updateComplete));
    };
    void this.#commit().then(async (committed) => {
      if (!committed) return;
      await settle();
      const items = host.pageItems;
      const isFullWidth = (index: number) =>
        items[index] == null ||
        this.state.presentRow(items[index], { columns, rowIndex: index }) !== null;
      const from = items.indexOf(record);
      let target: ActiveNode<T> | null;
      if (from >= 0) {
        target = tabTarget(items.length, from, keys, key, step, isFullWidth) ?? {
          row: from,
          column: key,
        };
      } else {
        const row = nearestCellRow(items.length, origin, step, isFullWidth);
        target = row < 0 ? null : { row, column: key };
      }
      if (!target) {
        body?.focus({ preventScroll: true });
        return;
      }
      this.state.active = target;
      await settle();
      let cell = findRenderedCell(body, target);
      // The target row is outside the rendered range: scroll towards it and
      // let the virtualizer render (two frames), re-aiming from the newly
      // rendered rows when the estimate fell short.
      for (let attempt = 0; !cell && attempt < 3; attempt++) {
        scrollRowIntoRange(host as unknown as HTMLElement, body, target.row);
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        await settle();
        cell = findRenderedCell(body, target);
      }
      if (!cell) {
        body?.focus({ preventScroll: true });
        return;
      }
      cell.focus({ preventScroll: true });
      cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      // The virtualizer's own layout pass, a frame or two later, can move or
      // re-create the landed row (an items change from the commit, such as a
      // quick filter dropping the record), which drops focus to the document.
      // Land again while the active cell is still the target.
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const active = this.state.active;
      const dropped = !document.activeElement || document.activeElement === document.body;
      if (dropped && active.row === target.row && active.column === target.column) {
        findRenderedCell(body, target)?.focus({ preventScroll: true });
      }
    });
  }

  #handleKeydown = (event: KeyboardEvent) => {
    event.stopPropagation();
    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        this.#refocusAfterEdit = true;
        this.#commit();
        return;
      case 'Escape':
        event.preventDefault();
        this.#refocusAfterEdit = true;
        this.#cancel();
        return;
      case 'Tab':
        this.#commitAndTab(event);
        return;
      default:
        return;
    }
  };

  /**
   * Cell-level keydown that catches keys bubbling out of registry-built
   * editors (the default editor stops propagation on its own input).
   *
   * - Escape always cancels the edit.
   * - Tab commits the draft (or just closes when nothing was typed) and
   *   moves to the next cell.
   *
   * Per-editor `keydown` handlers that need to consume Enter (e.g. the
   * built-in `<select>` editor) still get the first crack — they call
   * `event.stopPropagation()` and we never see those keys here.
   */
  #handleCellKeydown = (event: KeyboardEvent) => {
    if (!this.isEditing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.#refocusAfterEdit = true;
      this.#cancel();
      return;
    }
    if (event.key === 'Tab') this.#commitAndTab(event);
  };

  /**
   * Cell-level focus-out, the single focus-loss commit path: commits the
   * editor's draft when focus truly leaves the cell (clicking another cell or
   * a control outside the grid, blurring to the document body). In row mode
   * the value is staged and the row stays open.
   *
   * With no draft (nothing typed or picked) `commitCell()` resolves to the
   * current data value, so losing focus closes the editor without writing.
   * A failed validation keeps the editor open with its error.
   */
  #handleCellFocusOut = (event: FocusEvent) => {
    if (!this.isEditing) return;
    const next = event.relatedTarget as Node | null;
    if (next && (this.contains(next) || this.shadowRoot?.contains(next))) return;
    // A pointer exit never hands focus back to the cell, even after an
    // earlier keyboard commit that failed validation set the flag.
    this.#refocusAfterEdit = false;
    this.#commit();
  };

  /** Number and currency columns share the built-in number editor. */
  get #isNumeric(): boolean {
    const type = this.column.type;
    return type === 'number' || type === 'currency';
  }

  #handleTextInput = (event: Event) => {
    const target = event.target as HTMLInputElement;
    if (this.#isNumeric) {
      // An empty (or non-parseable) number field clears the value to null rather
      // than committing NaN, which would render as the text "NaN".
      const numeric = target.valueAsNumber;
      this.editingController.setDraft(
        target.value === '' || Number.isNaN(numeric) ? null : numeric
      );
      return;
    }
    this.editingController.setDraft(target.value);
  };

  #handleCheckboxChange = async (event: Event) => {
    const target = event.target as HTMLInputElement;
    // Booleans commit immediately: toggling is the whole interaction. A
    // rejected toggle flips back so the box never shows an unsaved state.
    if (!(await this.editingController.commitCell(target.checked))) {
      target.checked = !target.checked;
    }
  };

  /**
   * The value the editor shows: the cell value, or the held draft when the
   * editor opened on an edit already in progress (its record paged or
   * scrolled back into view), so what it shows is what a commit writes. Read
   * once on opening, so a later re-render never rewrites what the user is
   * typing.
   */
  get #editorValue(): unknown {
    return this.#resumed ? this.#resumed.value : this.value;
  }

  protected renderDefaultEditor() {
    const value = this.#editorValue;
    if (this.column.type === 'boolean') {
      return html`<input
        type="checkbox"
        part="editor"
        data-apex-editor
        ?checked=${Boolean(value)}
        @change=${this.#handleCheckboxChange}
        @keydown=${this.#handleKeydown}
      />`;
    }
    if (this.#isNumeric) {
      return html`<input
        type="number"
        part="editor"
        data-apex-editor
        .value=${value == null ? '' : String(value)}
        @input=${this.#handleTextInput}
        @keydown=${this.#handleKeydown}
      />`;
    }
    return html`<input
      type="text"
      part="editor"
      data-apex-editor
      .value=${value == null ? '' : String(value)}
      @input=${this.#handleTextInput}
      @keydown=${this.#handleKeydown}
    />`;
  }

  protected renderEditor() {
    const template = this.column.editorTemplate;
    const ctx = {
      parent: this,
      row: this.row,
      column: this.column,
      value: this.#editorValue,
      commit: (next: unknown) => this.editingController.commitCell(next),
      cancel: () => this.editingController.cancelCell(),
      setDraft: (next: unknown) => this.editingController.setDraft(next),
    };
    if (template) {
      return template(ctx as unknown as ApexEditorContext<T> as never);
    }
    const typeRenderer = getColumnTypeRenderer<T>(this.column.type);
    if (typeRenderer?.editor) {
      return typeRenderer.editor(ctx as never);
    }
    return this.renderDefaultEditor();
  }

  /**
   * Renders the tree affordance — depth-based indent + a chevron toggle (or
   * leaf spacer) — that prefixes the group cell when {@link ApexGrid.tree}
   * is enabled. Returns `nothing` for every other cell.
   */
  protected renderTreeAffordance() {
    const tree = this.state?.tree;
    if (!tree?.enabled) return null;
    if (!this.row?.data) return null;
    if (!tree.isGroupColumn(this.column.key)) return null;

    const data = this.row.data;
    const meta = tree.getMeta(data);
    if (!meta) return null;

    const indent = meta.depth * tree.childIndent;
    const expanded = tree.isExpanded(data);
    const handleClick = (event: MouseEvent) => {
      event.stopPropagation();
      if (!meta.hasChildren) return;
      void tree.toggleRow(data);
    };

    const chevron = meta.hasChildren
      ? html`<button
          type="button"
          part="tree-toggle"
          aria-label=${
            expanded ? this.state.localize('row.collapse') : this.state.localize('row.expand')
          }
          aria-expanded=${expanded ? 'true' : 'false'}
          @click=${handleClick}
        >
          <svg
            part="tree-chevron"
            viewBox="0 0 24 24"
            aria-hidden="true"
            width="14"
            height="14"
          >
            <path
              d="M9 6l6 6-6 6"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>`
      : html`<span part="tree-spacer" aria-hidden="true"></span>`;

    return html`<span
        part="tree-indent"
        aria-hidden="true"
        style=${`inline-size: ${indent}px`}
      ></span>${chevron}`;
  }

  /**
   * Resolves the value to display for the cell. Synthesized tree parents
   * (those that appear only as a path segment with no backing data) render
   * their last path segment in the group column and nothing elsewhere.
   */
  protected resolveDisplayValue(): unknown {
    const tree = this.state?.tree;
    if (tree?.enabled && this.row?.data && tree.isSynthesized(this.row.data)) {
      return tree.isGroupColumn(this.column.key) ? tree.getLabel(this.row.data) : '';
    }
    return this.value;
  }

  protected renderCellBody() {
    if (this.column.cellTemplate) {
      return this.column.cellTemplate(this.context as ApexCellContext<T> as never);
    }
    // A formula error is a first-class cell value: render its code as text so it
    // stays visible in typed columns (a currency/number renderer would coerce it
    // to NaN and show an empty cell).
    const value = this.resolveDisplayValue();
    if (isErrorLike(value)) {
      return html`${value.code}`;
    }
    const typeRenderer = getColumnTypeRenderer<T>(this.column.type);
    if (typeRenderer?.display) {
      // Synthesized parents have no real backing data — route them through
      // a plain text render instead of the typed renderer.
      const tree = this.state?.tree;
      if (tree?.enabled && this.row?.data && tree.isSynthesized(this.row.data)) {
        return html`${this.resolveDisplayValue()}`;
      }
      return typeRenderer.display(this.context as never);
    }
    return html`${this.resolveDisplayValue()}`;
  }

  protected override render() {
    const error = this.renderError();
    if (this.isEditing) {
      return html`${this.renderEditor()}${error}`;
    }
    const affordance = this.renderTreeAffordance();
    if (affordance) {
      return html`${affordance}<span part="tree-cell-content"
          >${this.renderCellBody()}</span
        >${error}`;
    }
    return html`${this.renderCellBody()}${error}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [ApexGridCell.tagName]: ApexGridCell<object>;
  }
}
