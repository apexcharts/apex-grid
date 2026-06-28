import { consume } from '@lit/context';
import { html, LitElement } from 'lit';
import { property, query } from 'lit/decorators.js';
import { gridStateContext, type StateController } from '../controllers/state.js';
import { getColumnTypeRenderer } from '../internal/column-types.js';
import { registerComponent } from '../internal/register.js';
import { GRID_CELL_TAG } from '../internal/tags.js';
import type {
  ApexCellContext,
  ApexEditorContext,
  ColumnConfiguration,
  PropertyType,
} from '../internal/types.js';
import { styles } from '../styles/body-cell/body-cell.css.js';
import type ApexGridRow from './row.js';

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
        this.editingController.commitImmediate(this.row.index, this.column.key, next);
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

  protected override willUpdate() {
    if (this.colindex > 0) {
      this.setAttribute('aria-colindex', String(this.colindex));
    } else {
      this.removeAttribute('aria-colindex');
    }
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
            rowIndex: this.row.index,
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

  protected override updated() {
    if (this.isEditing) {
      const editor = this.editorElement;
      editor?.focus();
      if (editor instanceof HTMLInputElement) {
        if (editor.type === 'text' || editor.type === 'number') {
          editor.select();
        }
      }
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
    this.editingController.editCell(this.row.index, this.column.key);
  }

  #pendingValue: unknown;

  #commitWith = async (value?: unknown): Promise<boolean> => {
    return this.editingController.commitCell(value ?? this.#pendingValue);
  };

  #cancel = () => {
    this.editingController.cancelCell();
  };

  #handleKeydown = (event: KeyboardEvent) => {
    event.stopPropagation();
    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        this.#commitWith();
        return;
      case 'Escape':
        event.preventDefault();
        this.#cancel();
        return;
      case 'Tab':
        // Commit first; navigation moves to the next/prev cell. Editing of the
        // landed cell stays manual (Enter to re-edit) for predictability.
        event.preventDefault();
        this.#commitWith();
        return;
      default:
        return;
    }
  };

  #handleBlur = () => {
    if (!this.isEditing) return;
    if (this.editingController.mode === 'cell') {
      this.#commitWith();
    } else {
      // Row mode — stash the value and exit the cell editor; the row stays open.
      this.editingController.commitCell(this.#pendingValue);
    }
  };

  /**
   * Cell-level keydown that catches keys bubbling out of registry-built
   * editors (the default editor stops propagation on its own input).
   *
   * - Escape always cancels the edit.
   * - Tab commits (or closes when there's no draft — `commitCell()` with
   *   `undefined` value is treated as "no change" by the controller).
   *
   * Per-editor `keydown` handlers that need to consume Enter (e.g. the
   * built-in `<select>` editor) still get the first crack — they call
   * `event.stopPropagation()` and we never see those keys here.
   */
  #handleCellKeydown = (event: KeyboardEvent) => {
    if (!this.isEditing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.#cancel();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      this.#commitWith();
    }
  };

  /**
   * Cell-level focus-out: commits the active edit when focus truly leaves
   * the cell (clicking another cell, tabbing past the editor, blurring to
   * the document body). The default editor's input also has `@blur` which
   * commits first; by that time `isEditing` is false and this is a no-op.
   *
   * For built-in registry editors `commitCell()` with no explicit value
   * resolves to the current data value — same shape as "no change", so
   * losing focus without picking discards the open editor without writing
   * spurious data.
   */
  #handleCellFocusOut = (event: FocusEvent) => {
    if (!this.isEditing) return;
    const next = event.relatedTarget as Node | null;
    if (next && (this.contains(next) || this.shadowRoot?.contains(next))) return;
    if (this.editingController.mode === 'cell') {
      this.#commitWith();
    } else {
      this.editingController.commitCell(this.#pendingValue);
    }
  };

  #handleTextInput = (event: Event) => {
    const target = event.target as HTMLInputElement;
    this.#pendingValue = this.column.type === 'number' ? target.valueAsNumber : target.value;
  };

  #handleCheckboxChange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    this.#pendingValue = target.checked;
    // Booleans commit immediately — toggling is the whole interaction.
    this.#commitWith(target.checked);
  };

  protected renderDefaultEditor() {
    const value = this.value as unknown;
    if (this.column.type === 'boolean') {
      this.#pendingValue = Boolean(value);
      return html`<input
        type="checkbox"
        part="editor"
        data-apex-editor
        ?checked=${Boolean(value)}
        @change=${this.#handleCheckboxChange}
        @keydown=${this.#handleKeydown}
        @blur=${this.#handleBlur}
      />`;
    }
    if (this.column.type === 'number') {
      this.#pendingValue = value;
      return html`<input
        type="number"
        part="editor"
        data-apex-editor
        .value=${value == null ? '' : String(value)}
        @input=${this.#handleTextInput}
        @keydown=${this.#handleKeydown}
        @blur=${this.#handleBlur}
      />`;
    }
    this.#pendingValue = value;
    return html`<input
      type="text"
      part="editor"
      data-apex-editor
      .value=${value == null ? '' : String(value)}
      @input=${this.#handleTextInput}
      @keydown=${this.#handleKeydown}
      @blur=${this.#handleBlur}
    />`;
  }

  protected renderEditor() {
    const template = this.column.editorTemplate;
    const ctx = {
      parent: this,
      row: this.row,
      column: this.column,
      value: this.value,
      commit: (next: unknown) => this.editingController.commitCell(next),
      cancel: () => this.editingController.cancelCell(),
    };
    if (template) {
      // For custom editors we don't know the draft shape; reset pending so
      // cell-level commit doesn't write a stale value from a previous edit.
      this.#pendingValue = this.value;
      return template(ctx as unknown as ApexEditorContext<T> as never);
    }
    const typeRenderer = getColumnTypeRenderer<T>(this.column.type);
    if (typeRenderer?.editor) {
      this.#pendingValue = this.value;
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
