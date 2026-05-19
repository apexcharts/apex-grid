import { consume } from '@lit/context';
import { html, LitElement } from 'lit';
import { property, query } from 'lit/decorators.js';
import { gridStateContext, type StateController } from '../controllers/state.js';
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
    return {
      parent: this,
      row: this.row,
      column: this.column,
      value: this.value,
    } as unknown as ApexCellContext<T>;
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

  public override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('click', this.#handleClick);
    this.addEventListener('dblclick', this.#handleDoubleClick);
  }

  public override disconnectedCallback(): void {
    this.removeEventListener('click', this.#handleClick);
    this.removeEventListener('dblclick', this.#handleDoubleClick);
    super.disconnectedCallback();
  }

  protected override updated() {
    if (this.isEditing) {
      this.editorElement?.focus();
      if (this.editorElement instanceof HTMLInputElement) {
        if (this.editorElement.type === 'text' || this.editorElement.type === 'number') {
          this.editorElement.select();
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
    if (this.editingController.trigger !== 'click') return;
    this.#startEdit();
  };

  #handleDoubleClick = (event: MouseEvent) => {
    if (this.isEditing) {
      event.stopPropagation();
      return;
    }
    if (!this.isEditable) return;
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
    if (template) {
      const ctx: ApexEditorContext<T> = {
        parent: this,
        row: this.row,
        column: this.column,
        value: this.value,
        commit: (next: unknown) => this.editingController.commitCell(next),
        cancel: () => this.editingController.cancelCell(),
      } as unknown as ApexEditorContext<T>;
      return template(ctx as ApexEditorContext<T> as never);
    }
    return this.renderDefaultEditor();
  }

  protected override render() {
    if (this.isEditing) {
      return this.renderEditor();
    }
    return this.column.cellTemplate
      ? this.column.cellTemplate(this.context as ApexCellContext<T> as never)
      : html`${this.value}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [ApexGridCell.tagName]: ApexGridCell<object>;
  }
}
