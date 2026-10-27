import { type VirtualizeDirectiveConfig, virtualize } from '@lit-labs/virtualizer/virtualize.js';
import { type ChildPart, noChange } from 'lit';
import { type DirectiveResult, directive } from 'lit/directive.js';
import { repeat } from 'lit/directives/repeat.js';

/**
 * The body's fork of the upstream `virtualize` directive.
 *
 * Upstream's directive is the only thing that constructs and drives its
 * `Virtualizer` (layout, scrolling, `rangeChanged`, `layoutComplete`), and the
 * package does not export that class. So the fork keeps the upstream directive
 * for all of that and subclasses it, replacing only what it renders and adding
 * the hooks the body needs around each render:
 *
 * - every `rangeChanged` listener runs before the rows re-render
 *   ({@link VirtualizedRows.holdRender});
 * - a row element that stands at a new index after a render is measured again
 *   (upstream caches sizes by index and only measures what its children
 *   `ResizeObserver` reports);
 * - a render that changed nothing upstream can observe still lets
 *   `layoutComplete` settle ({@link VirtualizedRows.armLayoutComplete});
 * - {@link VirtualizedRows.rendered} resolves after the latest render.
 *
 * Built against `@lit-labs/virtualizer` 2.1.1 exactly (pinned in package.json).
 * The private members it touches are pinned by
 * `test/virtualizer-private-api.test.ts`.
 *
 * @see plans/core/2026-10-27-row-recycling-plan.md, sections 3.1 and 3.5.
 */

/** Upstream's `VirtualizeDirective` class, which the package does not export. */
type UpstreamDirectiveClass =
  ReturnType<typeof virtualize> extends DirectiveResult<infer C> ? C : never;

const UpstreamDirective = (virtualize() as unknown as { _$litDirective$: UpstreamDirectiveClass })
  ._$litDirective$;

/** The private members of upstream's `Virtualizer` this file relies on. */
interface UpstreamVirtualizer {
  /** Observes every rendered row; its callback is what measures them. */
  _childrenRO: ResizeObserver | null;
  /** Created lazily by the `layoutComplete` getter; null when nobody waits. */
  _layoutCompletePromise: Promise<void> | null;
  /** The frame upstream already scheduled to resolve the promise, if any. */
  _pendingLayoutComplete: number | null;
  /** Called at the end of every children `ResizeObserver` callback, and only there. */
  _scheduleLayoutComplete(): void;
  _resolveLayoutCompletePromise(): void;
}

/** Attribute upstream stamps on its sizer element, which is not a row. */
const SIZER_ATTRIBUTE = 'virtualizer-sizer';

/**
 * How the directive maps rows to elements. Only `'item'` (upstream's `repeat`
 * by key) exists today; the slot reconciler lands as `'slot'` in a later phase.
 */
export type RowMode = 'item';

/** What the body virtualizer asks of its rows directive. */
export interface VirtualizedRows {
  /** Row mapping in use. A field of the one directive, never a second class. */
  mode: RowMode;
  /**
   * Runs `dispatch` (the `rangeChanged` dispatch) with the rows' re-render
   * held back until it returns, so every listener, whenever it registered,
   * still sees the rows of the previous range.
   */
  holdRender<R>(dispatch: () => R): R;
  /**
   * Lets a pending `layoutComplete` settle within two frames when the layout is
   * quiet: no render, children resize or deferred render for two frames.
   * `updatePending` is whether the host has an update queued, which is not quiet.
   */
  armLayoutComplete(updatePending: boolean): void;
  /** Resolves after the latest render has committed and its rows have updated. */
  rendered(): Promise<void>;
}

const directives = new WeakMap<Element, VirtualizedRows>();

/** The rows directive rendering into `host`, once it has rendered. */
export function virtualizedRows(host: Element): VirtualizedRows | undefined {
  return directives.get(host);
}

/** Marks that no re-render is held. */
const NOTHING_HELD = Symbol('nothing held');

class VirtualizeRowsDirective extends UpstreamDirective implements VirtualizedRows {
  public mode: RowMode = 'item';

  #host: Element | null = null;

  /** `holdRender` nesting depth, and the render it held back. */
  #holding = 0;
  #held: unknown = NOTHING_HELD;

  /** The rendered rows in DOM order, and the index each was last rendered at. */
  #rows: Element[] = [];
  #indexOf = new WeakMap<Element, number>();

  /** The upstream instance whose children observer callback is wrapped. */
  #observed: UpstreamVirtualizer | null = null;

  /**
   * Bumped by everything that may still change the layout: a render, a
   * children `ResizeObserver` callback, an update whose rows render later.
   */
  #epoch = 0;
  /**
   * The two-frame probes in flight: the epoch each waits on and the pending
   * `layoutComplete` promise when it started, the only one it may settle.
   */
  #probes: Array<{ epoch: number; promise: Promise<void> | null }> = [];
  /** The epoch last found quiet: nothing happened for two frames after it. */
  #quiet = -1;

  /** Settles when the render an update deferred commits. */
  #next: { promise: Promise<void>; resolve: () => void } | null = null;

  public override render(config?: VirtualizeDirectiveConfig<unknown>): unknown {
    // Upstream's own `update()` and range listener never pass a config.
    if (config) return super.render(config);
    const itemsToRender: unknown[] = [];
    if (this._first >= 0 && this._last >= this._first) {
      for (let i = this._first; i <= this._last; i++) {
        itemsToRender.push(this._items[i]);
      }
    }
    // Item branch: upstream's render, byte for byte. The slot branch joins it
    // here, behind `mode`, with the slot reconciler.
    return repeat(itemsToRender, this._keyFunction, this._renderItem);
  }

  public override update(part: ChildPart, args: [VirtualizeDirectiveConfig<unknown>]): unknown {
    const host = part.parentNode as Element | null;
    if (host && host.nodeType === Node.ELEMENT_NODE && host !== this.#host) {
      this.#host = host;
      directives.set(host, this);
    }
    const value = super.update(part, args);
    this.#observeLayoutComplete();
    if (value === noChange) {
      // New items: the rows render once the layout reports the range.
      this.#epoch++;
      this.#next ??= deferred();
    } else {
      // Lit commits `value` as soon as this returns.
      queueMicrotask(() => this.#committed());
    }
    return value;
  }

  public override setValue(value: unknown): void {
    if (this.#holding) {
      this.#held = value;
      return;
    }
    super.setValue(value);
    this.#committed();
  }

  public holdRender<R>(dispatch: () => R): R {
    this.#holding++;
    try {
      return dispatch();
    } finally {
      this.#holding--;
      if (!this.#holding && this.#held !== NOTHING_HELD) {
        const value = this.#held;
        this.#held = NOTHING_HELD;
        this.setValue(value);
      }
    }
  }

  public armLayoutComplete(updatePending: boolean): void {
    if (updatePending) return;
    // Quiet already, or a probe of this epoch is in flight but started before
    // this promise existed and so will not settle it: give it two frames of
    // its own. Otherwise the activity since the last quiet epoch starts one.
    const epoch = this.#epoch;
    if (this.#quiet === epoch || this.#probes.some((probe) => probe.epoch === epoch)) {
      this.#probe();
    }
  }

  public async rendered(): Promise<void> {
    if (this.#next) await this.#next.promise;
    await Promise.all(
      this.#rows.map(
        (row) => (row as Element & { updateComplete?: Promise<unknown> }).updateComplete
      )
    );
  }

  get #virtualizer(): UpstreamVirtualizer | null {
    return this._virtualizer as unknown as UpstreamVirtualizer | null;
  }

  /**
   * Counts every children `ResizeObserver` callback as activity. Upstream ends
   * each one with `_scheduleLayoutComplete`, which it calls nowhere else.
   */
  #observeLayoutComplete(): void {
    const virtualizer = this.#virtualizer;
    if (!virtualizer || virtualizer === this.#observed) return;
    this.#observed = virtualizer;
    const schedule = virtualizer._scheduleLayoutComplete;
    virtualizer._scheduleLayoutComplete = () => {
      schedule.call(virtualizer);
      this.#epoch++;
      this.#probe();
    };
  }

  /** Runs after every render has committed to the DOM. */
  #committed(): void {
    this.#next?.resolve();
    this.#next = null;
    const host = this.#host;
    if (!host) return;

    // Upstream measures only the rows its children observer reports, and
    // caches the result by index. A row already rendered that now stands at
    // another index keeps its box, so nothing reports it and the new index
    // would keep its old (or estimated) size. Observing it afresh makes the
    // observer report it once, which runs upstream's own measure.
    const observer = this.#virtualizer?._childrenRO ?? null;
    const previous = this.#rows;
    const rows: Element[] = [];
    let changed = false;
    for (let child = host.firstElementChild; child; child = child.nextElementSibling) {
      if (child.hasAttribute(SIZER_ATTRIBUTE)) continue;
      const index = this._first + rows.length;
      const was = this.#indexOf.get(child);
      if (observer && was !== undefined && was !== index) {
        observer.unobserve(child);
        observer.observe(child);
      }
      this.#indexOf.set(child, index);
      if (previous[rows.length] !== child) changed = true;
      rows.push(child);
    }
    if (rows.length !== previous.length) changed = true;
    this.#rows = rows;

    this.#epoch++;
    // Rows added, removed or moved are observed (or re-observed) above or by
    // upstream, so its own path settles `layoutComplete`. Only a render that
    // kept every row element where it was can go unobserved.
    if (!changed) this.#probe();
  }

  /**
   * Two frames after the current epoch, with nothing else in between, the
   * layout is quiet: settle the `layoutComplete` promise that was pending when
   * the probe started, if upstream has not already scheduled it. A children
   * observer callback lands within the first of those frames, so this never
   * resolves ahead of a measure the render it follows triggers.
   *
   * A promise created after the probe started (say, read right after a scroll
   * the layout has not seen yet) is not that promise, so it waits for a probe
   * of its own or for upstream.
   */
  #probe(): void {
    const epoch = this.#epoch;
    const promise = this.#virtualizer?._layoutCompletePromise ?? null;
    if (this.#probes.some((probe) => probe.epoch === epoch && probe.promise === promise)) return;
    const probe = { epoch, promise };
    this.#probes.push(probe);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        this.#probes = this.#probes.filter((other) => other !== probe);
        if (epoch !== this.#epoch) return;
        this.#quiet = epoch;
        const virtualizer = this.#virtualizer;
        if (
          promise &&
          virtualizer?._layoutCompletePromise === promise &&
          virtualizer._pendingLayoutComplete === null
        ) {
          virtualizer._resolveLayoutCompletePromise();
        }
      })
    );
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * The body's `virtualize` directive. Annotated because the inferred type names
 * upstream's private members (TS2742 / TS4094).
 */
export const virtualizeRows: (config: VirtualizeDirectiveConfig<unknown>) => DirectiveResult =
  directive(VirtualizeRowsDirective);
