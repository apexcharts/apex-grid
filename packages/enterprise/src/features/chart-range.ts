import { isRTL } from 'apex-grid/internal';
import type { ApexGridChart } from '../chart-panel.js';
import { carryGridTheme } from './carry-theme.js';
import type { ChartDefinition, ChartModel } from './chart.js';
import type { RangeBounds } from './range-selection.js';

/**
 * The minimal grid surface the {@link ChartRangeManager} drives. Implemented by
 * `ApexGridEnterprise`; kept as an interface so the manager does not import the
 * grid (avoids a circular dependency, mirrors the SSRM / infinite managers).
 */
export interface ChartRangeHost {
  /** Union client rect of a range's rendered cells, or `null` when scrolled off. */
  boundsClientRect(bounds: RangeBounds): DOMRectReadOnly | null;
  /** Hit-test a client point to the nearest cell, in view coordinates. */
  cellAtPoint(clientX: number, clientY: number): { row: number; col: number } | null;
  /** The chart-ready model for an explicit range (drives a linked chart on resize). */
  modelForBounds(bounds: RangeBounds, definition?: ChartDefinition): ChartModel;
  /** The grid host element, for its viewport rect + attachment check. */
  readonly gridElement: HTMLElement;
  localize(key: string, params?: Record<string, string | number>, fallback?: string): string;
  /** The view's row and column counts, the most a range can grow to from the keyboard. */
  extent?(): { rows: number; cols: number };
  /** Read a message out through the grid's live region (a keyboard resize). */
  announce?(message: string): void;
}

/** One chart linked to a persistent source range, with its in-grid overlay + handle. */
interface ChartLink {
  bounds: RangeBounds;
  readonly outline: HTMLDivElement;
  readonly handle: HTMLButtonElement;
}

// The grid's brand colour (carried onto the overlay, which lives on the body),
// so a charted range reads as the grid's own selection colour in every theme.
const OUTLINE_COLOR = 'var(--_ag-brand, #0d6fd3)';

/**
 * Enterprise feature: the **in-grid range handle**. When a chart is opened from a
 * cell-range selection, that source range becomes a persistent, live-linked
 * *charted range*: the manager draws an outline + a bottom-right drag handle over
 * the source cells (on `document.body`, like the chart affordance + dialogs, so it
 * is never clipped by the grid), and dragging the handle resizes the source range
 * and pushes a freshly computed {@link ChartModel} into the linked chart so it
 * redraws live.
 *
 * A plain manager the grid owns (not a feature module): the grid links a chart on
 * open, unlinks it on close, and asks the manager to reposition on scroll / resize
 * / view-change. Entirely enterprise-side; no core change.
 */
export class ChartRangeManager {
  readonly #links = new Map<ApexGridChart, ChartLink>();
  #dragging: { chart: ApexGridChart; link: ChartLink } | null = null;

  constructor(private host: ChartRangeHost) {}

  /** Whether a chart currently has a linked source range. */
  public has(chart: ApexGridChart): boolean {
    return this.#links.has(chart);
  }

  /** Link a chart to a source range and draw its overlay. */
  public link(chart: ApexGridChart, bounds: RangeBounds): void {
    if (this.#links.has(chart)) this.unlink(chart);

    const outline = document.createElement('div');
    outline.setAttribute('part', 'chart-range-outline');
    outline.setAttribute('aria-hidden', 'true');
    Object.assign(outline.style, {
      position: 'fixed',
      zIndex: '10850',
      pointerEvents: 'none',
      border: `2px solid ${OUTLINE_COLOR}`,
      borderRadius: '2px',
      boxShadow: `0 0 0 1px color-mix(in srgb, ${OUTLINE_COLOR} 20%, transparent)`,
      display: 'none',
    });

    const handle = document.createElement('button');
    handle.type = 'button';
    const label = this.host.localize('chart.rangeHandle', undefined, 'Resize chart source range');
    handle.title = label;
    handle.setAttribute('aria-label', label);
    handle.setAttribute('part', 'chart-range-handle');
    Object.assign(handle.style, {
      position: 'fixed',
      zIndex: '10851',
      width: '12px',
      height: '12px',
      padding: '0',
      boxSizing: 'border-box',
      border: '2px solid var(--_ag-surface, #fff)',
      background: OUTLINE_COLOR,
      borderRadius: '2px',
      cursor: 'nwse-resize',
      boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
      display: 'none',
      touchAction: 'none',
    });
    handle.addEventListener('pointerdown', (event) => this.#onHandleDown(event, chart));
    handle.addEventListener('pointermove', this.#onHandleMove);
    handle.addEventListener('pointerup', this.#onHandleUp);
    handle.addEventListener('pointercancel', this.#onHandleUp);
    handle.addEventListener('keydown', (event) => this.#onHandleKey(event, chart));

    carryGridTheme(this.host.gridElement, outline);
    carryGridTheme(this.host.gridElement, handle);
    document.body.appendChild(outline);
    document.body.appendChild(handle);
    this.#links.set(chart, { bounds, outline, handle });
    this.reposition();
  }

  /** Remove a chart's overlay + link. */
  public unlink(chart: ApexGridChart): void {
    const link = this.#links.get(chart);
    if (!link) return;
    link.outline.remove();
    link.handle.remove();
    this.#links.delete(chart);
    if (this.#dragging?.chart === chart) this.#dragging = null;
  }

  /** Remove every overlay + link (grid disconnect). */
  public destroy(): void {
    for (const chart of [...this.#links.keys()]) this.unlink(chart);
    this.#dragging = null;
  }

  /**
   * Re-drive every linked chart from its range, then reposition. A range is held in view
   * coordinates, so after a sort, filter, edit or column move other cells sit under it: the chart
   * follows the cells the outline shows.
   */
  public refresh(): void {
    for (const [chart, link] of this.#links) {
      const model = this.host.modelForBounds(link.bounds);
      // Reassigning redraws the chart (see chart-panel): only when other values sit under it.
      if (JSON.stringify(model) !== JSON.stringify(chart.staticModel)) chart.staticModel = model;
    }
    this.reposition();
  }

  /** Reposition every overlay from its range's current on-screen rect. */
  public reposition = (): void => {
    if (!this.#links.size) return;
    const attached = this.host.gridElement.isConnected;
    if (!attached) this.#dragging = null;
    const clip = this.host.gridElement.getBoundingClientRect();
    for (const link of this.#links.values()) {
      // An overlay is on the page only while its grid is: a detached grid takes it off, and the
      // next reposition after a re-attach puts it back.
      if (attached !== link.outline.isConnected) {
        if (attached) document.body.append(link.outline, link.handle);
        else {
          link.outline.remove();
          link.handle.remove();
        }
      }
      const rect = attached ? this.host.boundsClientRect(link.bounds) : null;
      // Hide when the range is scrolled out of the body or the rect leaves the grid box, on
      // either axis: the outline lives on the body and would otherwise paint over the page.
      if (
        !rect ||
        rect.bottom <= clip.top ||
        rect.top >= clip.bottom ||
        rect.right <= clip.left ||
        rect.left >= clip.right
      ) {
        link.outline.style.display = 'none';
        link.handle.style.display = 'none';
        continue;
      }
      const top = Math.max(rect.top, clip.top);
      const bottom = Math.min(rect.bottom, clip.bottom);
      const left = Math.max(rect.left, clip.left);
      const right = Math.min(rect.right, clip.right);
      Object.assign(link.outline.style, {
        display: 'block',
        top: `${top}px`,
        left: `${left}px`,
        width: `${right - left}px`,
        height: `${bottom - top}px`,
      });
      // Handle centered on the range's trailing bottom corner (only when that corner
      // is in view). Under RTL the trailing edge is the physical left one, matching
      // where the selection's own fill handle sits; the direction is the computed
      // one the grid's own layout follows.
      const x = isRTL(this.host.gridElement) ? rect.left : rect.right;
      const cornerVisible =
        rect.bottom <= clip.bottom + 2 && x >= clip.left - 2 && x <= clip.right + 2;
      link.handle.style.display = cornerVisible ? 'block' : 'none';
      if (cornerVisible) {
        link.handle.style.top = `${rect.bottom - 6}px`;
        link.handle.style.left = `${x - 6}px`;
      }
    }
  };

  // --- drag ----------------------------------------------------------------

  #onHandleDown(event: PointerEvent, chart: ApexGridChart): void {
    const link = this.#links.get(chart);
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    this.#dragging = { chart, link };
    // Capture so moves anywhere route to the handle; harmless if the env rejects it.
    try {
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      /* no active pointer (e.g. synthetic events) — moves still target the handle */
    }
  }

  #onHandleMove = (event: PointerEvent): void => {
    if (!this.#dragging) return;
    event.preventDefault();
    const { chart, link } = this.#dragging;
    const cell = this.host.cellAtPoint(event.clientX, event.clientY);
    if (!cell) return;
    this.#resize(chart, link, cell.row, cell.col);
  };

  /**
   * Move the range's trailing corner to `row` / `col` (never above or before its leading one) and
   * re-drive the chart. Returns whether the range changed.
   */
  #resize(chart: ApexGridChart, link: ChartLink, row: number, col: number): boolean {
    const { top, left } = link.bounds;
    const next: RangeBounds = { top, left, bottom: Math.max(top, row), right: Math.max(left, col) };
    if (next.bottom === link.bounds.bottom && next.right === link.bounds.right) return false;
    link.bounds = next;
    this.reposition();
    // Reassigning `staticModel` triggers the chart's redraw (see chart-panel).
    chart.staticModel = this.host.modelForBounds(next);
    return true;
  }

  /**
   * The handle from the keyboard: the arrow keys grow or shrink the range by one row or column
   * (mirrored under RTL, where the trailing edge is on the left), and the new size is announced.
   * A key moves only its own axis, so it never trims the other edge to the current view.
   */
  #onHandleKey(event: KeyboardEvent, chart: ApexGridChart): void {
    const link = this.#links.get(chart);
    const step = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] }[
      event.key
    ];
    if (!link || !step) return;
    event.preventDefault();
    event.stopPropagation();
    const [down, across] = step;
    const extent = this.host.extent?.() ?? {
      rows: Number.POSITIVE_INFINITY,
      cols: Number.POSITIVE_INFINITY,
    };
    const dir = isRTL(this.host.gridElement) ? -1 : 1;
    const { top, left, bottom, right } = link.bounds;
    // Move only the edge the key names. A grow key stops at the view's last row or column but
    // never pulls back an edge already past it: a filter can shorten the view under a range,
    // and clearing it should bring those rows back.
    const move = (edge: number, delta: number, last: number): number =>
      delta > 0 ? Math.min(edge + delta, Math.max(edge, last)) : edge + delta;
    const row = move(bottom, down, extent.rows - 1);
    const col = move(right, across * dir, extent.cols - 1);
    if (!this.#resize(chart, link, row, col)) return;
    const rows = link.bounds.bottom - top + 1;
    const cols = link.bounds.right - left + 1;
    this.host.announce?.(
      this.host.localize(
        'chart.rangeResized',
        { rows, cols },
        'Chart source range: {rows} × {cols} cells'
      )
    );
  }

  #onHandleUp = (event: PointerEvent): void => {
    if (!this.#dragging) return;
    try {
      (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
    } catch {
      /* capture may never have been granted */
    }
    this.#dragging = null;
  };
}
