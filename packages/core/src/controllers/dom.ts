import type { RenderItemFunction } from '@lit-labs/virtualizer/virtualize.js';
import { html, type ReactiveController } from 'lit';
import { type StyleInfo, styleMap } from 'lit/directives/style-map.js';
import { SENTINEL_NODE } from '../internal/constants.js';
import type { ActiveNode, ColumnConfiguration, GridHost, Keys } from '../internal/types.js';
import {
  applyColumnWidths,
  type ChromeTrack,
  getDisplayColumns,
  leadingChromeTracks,
} from '../internal/utils.js';
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

  /**
   * Number of chrome rows above the body for `aria-rowindex`: an optional group
   * header row and the column header (always present). The filter panel is a
   * floating overlay rather than a table row, so it is not counted here.
   */
  protected get headerRowCount(): number {
    return this.host.columnGroupDepth + 1;
  }

  public rowRenderer: RenderItemFunction<T> = (data: T, index: number) => {
    const editingKey = this.#editingKey(data);
    // Body rows follow the chrome rows and any pinned-top rows in the
    // aria-rowindex sequence.
    const ariaRowOffset = this.headerRowCount + this.state.rowPin.pinnedRows.top.length;
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
        .ariaRowOffset=${ariaRowOffset}
        .decorationVersion=${this.state.decorationVersion}
        .dataVersion=${this.state.dataVersion}
        .validationVersion=${this.state.editing.validationVersion}
        .dragging=${this.state.rowReorder.dragging === data}
        .grabbed=${this.state.rowReorder.grabbed === data}
        .coordinateHints=${Boolean(this.host.coordinateHints)}
      >
      </apex-grid-row>
    `;
  };

  /**
   * The column whose editor the row showing `data` renders, or `null`. Bound
   * to the edited record, never to a view index, so a view change (sort,
   * filter, paging, live data, pinning) cannot move the editor onto another
   * record.
   */
  #editingKey(data: T): Keys<T> | null {
    const editingCell = this.state.editing.activeCell;
    return editingCell && editingCell.data === data ? editingCell.columnKey : null;
  }

  /**
   * Renders a single pinned row for a sticky band. Reuses {@link ApexGridRow}
   * so selection / expansion / decoration / editing all work by data
   * reference, but pins a sentinel {@link ActiveNode} (pinned rows are
   * presentation, selection and pointer-edit surfaces in v1, never the
   * keyboard-active cell).
   *
   * @param localIndex - position within the band (drives the active sentinel id).
   * @param ariaRowOffset - so `aria-rowindex` continues the unified sequence.
   */
  public pinnedRowRenderer(data: T, localIndex: number, ariaRowOffset: number) {
    return html`
      <apex-grid-row
        part="row pinned-row"
        style=${styleMap(this.columnSizes)}
        .index=${localIndex}
        .activeNode=${SENTINEL_NODE as ActiveNode<T>}
        .data=${data}
        .columns=${this.displayColumns}
        .pinOffsets=${this.pinOffsets}
        .editingKey=${this.#editingKey(data)}
        .ariaRowOffset=${ariaRowOffset}
        .decorationVersion=${this.state.decorationVersion}
        .dataVersion=${this.state.dataVersion}
        .validationVersion=${this.state.editing.validationVersion}
        .coordinateHints=${Boolean(this.host.coordinateHints)}
      >
      </apex-grid-row>
    `;
  }

  public async hostConnected() {
    this.setGridColumnSizes();
    // Wait for the initial paint of the virtualizer, then measure the pinned
    // columns and sticky rows it laid out.
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

  protected setGridColumnSizes() {
    const chrome = leadingChromeTracks(this.state);
    this.columnSizes = applyColumnWidths(this.displayColumns, chrome);
    this.#publishChromeOffsets(chrome);
  }

  /** Total width (CSS px) of the leading chrome tracks; start pins stack after it. */
  #chromeWidth = 0;

  /**
   * Writes each leading chrome cell's sticky inline-start offset into
   * `--apex-chrome-offset-<track>` on the host (the stylesheets of the header,
   * group header and body rows read it), so the gutter, grip, checkbox and
   * chevron stay side by side during a horizontal scroll instead of all
   * sticking at 0. Every track is written, absent ones as 0, so a grid nested
   * in another grid's row never inherits its parent's offsets. Written on
   * every update, not deduped, so they come back after something replaces
   * the host's style attribute (a string style binding, setAttribute).
   */
  #publishChromeOffsets(chrome: Array<[ChromeTrack, number]>): void {
    const offsets: Record<ChromeTrack, number> = {
      'row-number': 0,
      reorder: 0,
      selection: 0,
      expansion: 0,
    };
    let accum = 0;
    for (const [track, width] of chrome) {
      offsets[track] = accum;
      accum += width;
    }
    this.#chromeWidth = accum;
    for (const [track, offset] of Object.entries(offsets)) {
      this.host.style.setProperty(`--apex-chrome-offset-${track}`, `${offset}px`);
    }
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
    const widths = new Map<Keys<T>, number>();
    // Rects are visual px (after any ancestor transform) but the offsets are
    // applied as CSS px, so divide out the scale. Rects rather than
    // offsetWidth keep subpixel widths; offsetWidth is rounded to whole px, so
    // a difference under 1px is that rounding, not a transform.
    const host = this.host as HTMLElement;
    const visual = host.getBoundingClientRect().width;
    const layout = host.offsetWidth;
    const scale = visual && layout && Math.abs(visual - layout) >= 1 ? visual / layout : 1;
    for (const header of headerRow.headers) {
      widths.set(header.column.key as Keys<T>, header.getBoundingClientRect().width / scale);
    }

    // Start pins stack after the leading chrome cells, which stick first.
    let leftAccum = this.#chromeWidth;
    for (const column of this.displayColumns) {
      if (column.hidden) continue;
      if (column.pinned !== 'start') break;
      next.set(column.key as Keys<T>, leftAccum);
      leftAccum += widths.get(column.key as Keys<T>) ?? 0;
    }

    let rightAccum = 0;
    for (let i = this.displayColumns.length - 1; i >= 0; i--) {
      const column = this.displayColumns[i];
      if (column.hidden) continue;
      if (column.pinned !== 'end') break;
      next.set(column.key as Keys<T>, rightAccum);
      rightAccum += widths.get(column.key as Keys<T>) ?? 0;
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

  #lastGroupTop = -1;
  #lastHeaderTop = -1;
  #lastFilterTop = -1;
  #lastPinnedTop = -1;
  #lastPinnedBottom = -1;
  #lastHostWidth = -1;
  #hostWidthObserver: ResizeObserver | null = null;

  /**
   * Writes the cumulative heights of the sticky chrome rows into CSS custom
   * properties used for their `inset-block-start` / `inset-block-end` offsets.
   * The toolbar is at `top: 0`; the header sits below it
   * (`--apex-row-top-header`), the filter below the header
   * (`--apex-row-top-filter`), and the pinned-top band below the filter
   * (`--apex-row-top-pinned`). The pinned-bottom band sticks above the
   * paginator (`--apex-row-bottom-pinned`). Writes are skipped when values are
   * unchanged so the ResizeObserver feedback loop terminates.
   */
  public recomputeStickyRowOffsets(): void {
    const root = (this.host as HTMLElement).shadowRoot;
    if (!root) return;
    const toolbar = root.querySelector('apex-grid-toolbar') as HTMLElement | null;
    const groupHeader = root.querySelector('apex-grid-group-header-row') as HTMLElement | null;
    const header = root.querySelector('apex-grid-header-row') as HTMLElement | null;
    const filter = root.querySelector('apex-filter-row') as HTMLElement | null;
    const paginator = root.querySelector('apex-grid-paginator') as HTMLElement | null;

    const toolbarH = toolbar?.offsetHeight ?? 0;
    const groupH = groupHeader?.offsetHeight ?? 0;
    const headerH = header?.offsetHeight ?? 0;
    const filterH = filter?.offsetHeight ?? 0;
    const paginatorH = paginator?.offsetHeight ?? 0;
    // The group header (when present) sits below the toolbar; the column header
    // sits below the group header; filter below header; pinned-top below filter.
    const groupTop = toolbarH;
    const headerTop = toolbarH + groupH;
    const filterTop = toolbarH + groupH + headerH;
    const pinnedTop = toolbarH + groupH + headerH + filterH;

    if (groupTop !== this.#lastGroupTop) {
      this.host.style.setProperty('--apex-row-top-group', `${groupTop}px`);
      this.#lastGroupTop = groupTop;
    }
    if (headerTop !== this.#lastHeaderTop) {
      this.host.style.setProperty('--apex-row-top-header', `${headerTop}px`);
      this.#lastHeaderTop = headerTop;
    }
    if (filterTop !== this.#lastFilterTop) {
      this.host.style.setProperty('--apex-row-top-filter', `${filterTop}px`);
      this.#lastFilterTop = filterTop;
    }
    if (pinnedTop !== this.#lastPinnedTop) {
      this.host.style.setProperty('--apex-row-top-pinned', `${pinnedTop}px`);
      this.#lastPinnedTop = pinnedTop;
    }
    if (paginatorH !== this.#lastPinnedBottom) {
      this.host.style.setProperty('--apex-row-bottom-pinned', `${paginatorH}px`);
      this.#lastPinnedBottom = paginatorH;
    }
  }

  protected observeStickyRows(): void {
    const root = (this.host as HTMLElement).shadowRoot;
    if (!root) return;
    const toolbar = root.querySelector('apex-grid-toolbar') as HTMLElement | null;
    const groupHeader = root.querySelector('apex-grid-group-header-row') as HTMLElement | null;
    const header = root.querySelector('apex-grid-header-row') as HTMLElement | null;
    const filter = root.querySelector('apex-filter-row') as HTMLElement | null;
    const paginator = root.querySelector('apex-grid-paginator') as HTMLElement | null;

    if (!this.#stickyRowObserver) {
      this.#stickyRowObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => this.recomputeStickyRowOffsets());
      });
    }

    const next = new Set<Element>(
      [toolbar, groupHeader, header, filter, paginator].filter((el): el is HTMLElement => !!el)
    );
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
