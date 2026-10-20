import { html, nothing, type ReactiveController } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import type ApexGridHeader from '../components/header.js';
import { MIN_COL_RESIZE_WIDTH } from '../internal/constants.js';
import type { ColumnConfiguration, GridHost, Keys } from '../internal/types.js';
import { isRTL } from '../internal/utils.js';

export class ResizeController<T extends object> implements ReactiveController {
  constructor(protected host: GridHost<T>) {
    this.host.addController(this);
  }

  public indicatorActive = false;
  public indicatorOffset = 0;

  #maxSize(key: Keys<T>, headerWidth: number) {
    let max = Math.max(MIN_COL_RESIZE_WIDTH, headerWidth);
    // Rows rendered as one full-width block (group headers, total rows, rows
    // still loading) have no cell for the column, so they do not count.
    for (const row of this.host.rows) {
      const cell = row.cells.find((cell) => cell.column.key === key);
      if (cell) max = Math.max(max, cell.offsetWidth);
    }
    return max;
  }

  /**
   * Indicator offset for the edge being dragged when `header` is `width`
   * pixels wide. That is the inline-end edge: the right one in LTR, the left
   * one under `dir="rtl"`, where the fixed inline-start edge is the right one.
   *
   * Measured in client coordinates against the indicator's origin, the grid's
   * padding box at scroll 0 (`left: 0`, moved with a physical `translateX`).
   * A header offset would count from the far left of the header row, which
   * under RTL with horizontal overflow lies outside the grid.
   *
   * @param header the header being resized
   * @param width the column width to place the edge for, its current width by default
   * @param rtl whether the header lays out right to left
   */
  public edge(header: ApexGridHeader<T>, width = header.offsetWidth, rtl = isRTL(header)) {
    const { left, right } = header.getBoundingClientRect();
    const grid = this.host;
    // scrollLeft is negative when scrolled under RTL, so this holds either way.
    const origin = grid.getBoundingClientRect().left + grid.clientLeft - grid.scrollLeft;
    return (rtl ? right - width : left + width) - origin;
  }

  /**
   * Begins resizing a column by showing the resize indicator on the dragged edge of its header.
   *
   * @param header the header being resized
   */
  public start(header: ApexGridHeader<T>) {
    this.indicatorActive = true;
    this.indicatorOffset = this.edge(header);
    this.host.requestUpdate();
  }

  /**
   * Stops and resets the resizing state.
   */
  public stop() {
    this.indicatorActive = false;
    this.host.requestUpdate();
  }

  public resize(column: ColumnConfiguration<T>, width: number, sizerOffset?: number) {
    if (sizerOffset !== undefined) {
      this.indicatorOffset = sizerOffset;
    }

    column.width = `${width}px`;
    this.host.requestUpdate();
  }

  public async autosize(column: ColumnConfiguration<T>, header: ApexGridHeader<T>) {
    column.width = 'max-content';

    this.host.requestUpdate();
    await this.host.updateComplete;

    column.width = `${this.#maxSize(column.key, header.offsetWidth)}px`;
    this.host.requestUpdate();
  }

  public hostConnected() {}

  /**
   * Renders the resize indicator in the grid.
   */
  public renderIndicator() {
    return this.indicatorActive
      ? html`<div
          part="resize-indicator"
          style=${styleMap({
            transform: `translateX(${this.indicatorOffset}px)`,
          })}
        ></div>`
      : nothing;
  }
}
