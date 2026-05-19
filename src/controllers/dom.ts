import type { RenderItemFunction } from '@lit-labs/virtualizer/virtualize.js';
import { html, type ReactiveController } from 'lit';
import { type StyleInfo, styleMap } from 'lit/directives/style-map.js';
import type { ColumnConfiguration, GridHost, Keys } from '../internal/types.js';
import { applyColumnWidths, getDisplayColumns } from '../internal/utils.js';
import type { StateController } from './state.js';

export class GridDOMController<T extends object> implements ReactiveController {
  constructor(
    protected host: GridHost<T>,
    protected state: StateController<T>
  ) {
    this.host.addController(this);
  }

  #initialSize = () => {
    setTimeout(() => {
      this.setScrollOffset();
      this.recomputePinOffsets();
      this.recomputeStickyRowOffsets();
    });
  };

  #resizeObserver: ResizeObserver | null = null;
  #observedHeaders = new Set<Element>();
  #stickyRowObserver: ResizeObserver | null = null;
  #observedStickyRows = new Set<Element>();

  public get container() {
    // @ts-expect-error: protected member access
    return this.host.scrollContainer;
  }

  /**
   * Visual render order: `'start'`-pinned columns first, then unpinned, then
   * `'end'`-pinned. The user-supplied `columns` array is never mutated.
   */
  public get displayColumns(): Array<ColumnConfiguration<T>> {
    return getDisplayColumns(this.host.columns);
  }

  public columnSizes: StyleInfo = {};

  /**
   * The resolved inline-start (for `'start'` pin) or inline-end (for `'end'` pin)
   * pixel offset per pinned column key. Populated after layout by
   * {@link recomputePinOffsets}.
   */
  public pinOffsets = new Map<Keys<T>, number>();

  public rowRenderer: RenderItemFunction<T> = (data: T, index: number) => {
    const editingCell = this.state.editing.activeCell;
    const editingKey = editingCell?.rowIndex === index ? editingCell.columnKey : null;
    return html`
      <apex-grid-row
        part="row"
        style=${styleMap({ ...this.columnSizes, ...this.getActiveRowStyles(index) })}
        .index=${index}
        .activeNode=${this.state.active}
        .data=${data}
        .columns=${this.displayColumns}
        .pinOffsets=${this.pinOffsets}
        .editingKey=${editingKey}
      >
      </apex-grid-row>
    `;
  };

  public async hostConnected() {
    this.setGridColumnSizes();
    // Wait for the initial paint of the virtualizer and recalculate the scrollbar offset
    // for the next one
    await this.host.updateComplete;
    this.#initialSize();
    if (typeof ResizeObserver !== 'undefined' && !this.#hostWidthObserver) {
      this.#hostWidthObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => this.recomputeHostWidth());
      });
      this.#hostWidthObserver.observe(this.host as HTMLElement);
    }
    this.recomputeHostWidth();
  }

  public hostUpdate(): void {
    this.setScrollOffset();
    this.setGridColumnSizes();
  }

  public hostUpdated(): void {
    this.recomputePinOffsets();
    this.observeHeaderCells();
    this.recomputeStickyRowOffsets();
    this.observeStickyRows();
  }

  public hostDisconnected(): void {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#observedHeaders.clear();
    this.#stickyRowObserver?.disconnect();
    this.#stickyRowObserver = null;
    this.#observedStickyRows.clear();
    this.#hostWidthObserver?.disconnect();
    this.#hostWidthObserver = null;
  }

  /**
   * Writes the grid host's `clientWidth` into `--apex-host-width`. Used by the
   * toolbar and paginator to clamp their width to the visible viewport so
   * horizontal scrolling doesn't drag them off-screen.
   */
  public recomputeHostWidth(): void {
    const host = this.host as HTMLElement;
    const width = host.clientWidth;
    if (width === this.#lastHostWidth) return;
    host.style.setProperty('--apex-host-width', `${width}px`);
    this.#lastHostWidth = width;
  }

  public setScrollOffset() {
    // The grid host now owns vertical scrolling, so the historic per-row
    // padding-inline-end compensation is no longer needed. Keep the CSS var
    // set to `0` for forward compatibility with consumer themes that read it.
    this.host.style.setProperty('--scrollbar-offset', '0px');
  }

  protected setGridColumnSizes() {
    this.columnSizes = applyColumnWidths(this.displayColumns);
  }

  public getActiveRowStyles(index: number): StyleInfo {
    const { row } = this.state.active;
    return row === index ? { 'z-index': '3' } : {};
  }

  /**
   * Measures the rendered widths of pinned header cells and writes cumulative
   * inline-start / inline-end pixel offsets into {@link pinOffsets}. Called after
   * each grid update and whenever a header cell is resized.
   */
  public recomputePinOffsets(): void {
    // @ts-expect-error - protected member access
    const headerRow = this.host.headerRow as
      | {
          headers?: Array<{
            column: ColumnConfiguration<T>;
            getBoundingClientRect: () => DOMRect;
          }>;
        }
      | undefined;
    if (!headerRow?.headers) return;

    const next = new Map<Keys<T>, number>();
    const headersByKey = new Map<Keys<T>, DOMRect>();
    for (const header of headerRow.headers) {
      headersByKey.set(header.column.key as Keys<T>, header.getBoundingClientRect());
    }

    let leftAccum = 0;
    for (const column of this.displayColumns) {
      if (column.hidden) continue;
      if (column.pinned !== 'start') break;
      next.set(column.key as Keys<T>, leftAccum);
      const rect = headersByKey.get(column.key as Keys<T>);
      leftAccum += rect?.width ?? 0;
    }

    let rightAccum = 0;
    for (let i = this.displayColumns.length - 1; i >= 0; i--) {
      const column = this.displayColumns[i];
      if (column.hidden) continue;
      if (column.pinned !== 'end') break;
      next.set(column.key as Keys<T>, rightAccum);
      const rect = headersByKey.get(column.key as Keys<T>);
      rightAccum += rect?.width ?? 0;
    }

    if (!offsetsEqual(this.pinOffsets, next)) {
      this.pinOffsets = next;
      this.host.requestUpdate();
    }
  }

  protected observeHeaderCells(): void {
    // @ts-expect-error - protected member access
    const headerRow = this.host.headerRow as { headers?: Array<Element> } | undefined;
    if (!headerRow?.headers) return;

    if (!this.#resizeObserver) {
      this.#resizeObserver = new ResizeObserver(() => {
        // Defer to a new frame so any layout writes can't synchronously feed back
        // into this observer (which makes the browser raise the benign
        // "ResizeObserver loop completed" warning).
        requestAnimationFrame(() => this.recomputePinOffsets());
      });
    }

    const next = new Set<Element>(headerRow.headers);
    for (const element of this.#observedHeaders) {
      if (!next.has(element)) this.#resizeObserver.unobserve(element);
    }
    for (const element of next) {
      if (!this.#observedHeaders.has(element)) this.#resizeObserver.observe(element);
    }
    this.#observedHeaders = next;
  }

  #lastHeaderTop = -1;
  #lastFilterTop = -1;
  #lastHostWidth = -1;
  #hostWidthObserver: ResizeObserver | null = null;

  /**
   * Writes the cumulative height of the sticky top rows into CSS custom
   * properties used by the header/filter rows for their `inset-block-start`
   * offsets. The toolbar is always at `top: 0`; the header sits below it
   * (`--apex-row-top-header`) and the filter sits below the header
   * (`--apex-row-top-filter`). Writes are skipped when the values haven't
   * changed so the ResizeObserver feedback loop terminates.
   */
  public recomputeStickyRowOffsets(): void {
    const root = (this.host as HTMLElement).shadowRoot;
    if (!root) return;
    const toolbar = root.querySelector('apex-grid-toolbar') as HTMLElement | null;
    const header = root.querySelector('apex-grid-header-row') as HTMLElement | null;

    const toolbarH = toolbar?.offsetHeight ?? 0;
    const headerH = header?.offsetHeight ?? 0;
    const headerTop = toolbarH;
    const filterTop = toolbarH + headerH;

    if (headerTop !== this.#lastHeaderTop) {
      this.host.style.setProperty('--apex-row-top-header', `${headerTop}px`);
      this.#lastHeaderTop = headerTop;
    }
    if (filterTop !== this.#lastFilterTop) {
      this.host.style.setProperty('--apex-row-top-filter', `${filterTop}px`);
      this.#lastFilterTop = filterTop;
    }
  }

  protected observeStickyRows(): void {
    const root = (this.host as HTMLElement).shadowRoot;
    if (!root) return;
    const toolbar = root.querySelector('apex-grid-toolbar') as HTMLElement | null;
    const header = root.querySelector('apex-grid-header-row') as HTMLElement | null;

    if (!this.#stickyRowObserver) {
      this.#stickyRowObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => this.recomputeStickyRowOffsets());
      });
    }

    const next = new Set<Element>([toolbar, header].filter((el): el is HTMLElement => !!el));
    for (const element of this.#observedStickyRows) {
      if (!next.has(element)) this.#stickyRowObserver.unobserve(element);
    }
    for (const element of next) {
      if (!this.#observedStickyRows.has(element)) this.#stickyRowObserver.observe(element);
    }
    this.#observedStickyRows = next;
  }
}

function offsetsEqual<K>(a: Map<K, number>, b: Map<K, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
}
