import { isRTL } from 'apex-commons';
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
      // Hide when the range is scrolled out of the body or the rect leaves the grid box.
      if (!rect || rect.bottom <= clip.top || rect.top >= clip.bottom) {
        link.outline.style.display = 'none';
        link.handle.style.display = 'none';
        continue;
      }
      const top = Math.max(rect.top, clip.top);
      const bottom = Math.min(rect.bottom, clip.bottom);
      Object.assign(link.outline.style, {
        display: 'block',
        top: `${top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        height: `${Math.max(0, bottom - top)}px`,
      });
      // Handle centered on the range's trailing bottom corner (only when that corner
      // is in view). Under `dir="rtl"` the trailing edge is the physical left one,
      // matching where the selection's own fill handle sits.
      const cornerVisible = rect.bottom > clip.top && rect.bottom <= clip.bottom + 2;
      link.handle.style.display = cornerVisible ? 'block' : 'none';
      if (cornerVisible) {
        const rtl = isRTL('auto', this.host.gridElement);
        link.handle.style.top = `${rect.bottom - 6}px`;
        link.handle.style.left = `${(rtl ? rect.left : rect.right) - 6}px`;
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
    const next: RangeBounds = {
      top: link.bounds.top,
      left: link.bounds.left,
      bottom: Math.max(link.bounds.top, cell.row),
      right: Math.max(link.bounds.left, cell.col),
    };
    if (
      next.bottom === link.bounds.bottom &&
      next.right === link.bounds.right &&
      next.top === link.bounds.top &&
      next.left === link.bounds.left
    ) {
      return;
    }
    link.bounds = next;
    this.reposition();
    // Reassigning `staticModel` triggers the chart's redraw (see chart-panel).
    chart.staticModel = this.host.modelForBounds(next);
  };

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
