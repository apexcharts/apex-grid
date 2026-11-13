import { type VirtualizeDirectiveConfig, virtualize } from '@lit-labs/virtualizer/virtualize.js';
import { type ChildPart, noChange, nothing, type RootPart, render } from 'lit';
import { Directive, type DirectiveResult, directive } from 'lit/directive.js';
import {
  getCommittedValue,
  insertPart,
  removePart,
  setChildPartValue,
  setCommittedValue,
} from 'lit/directive-helpers.js';
import { repeat } from 'lit/directives/repeat.js';
import { deepActiveElement } from '../controllers/navigation.js';

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
 * In `'slot'` mode the rows render through the slot reconciler
 * ({@link SlotRowsDirective}) instead of upstream's keyed `repeat`.
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
  /** Children `_measureChildren` measures next (it reads only the keys). */
  _toBeMeasured: Map<Element, unknown>;
  /** Measures those children and schedules a reflow with the sizes. */
  _measureChildren(): void;
}

/** Attribute upstream stamps on its sizer element, which is not a row. */
const SIZER_ATTRIBUTE = 'virtualizer-sizer';

/**
 * How the directive maps rows to elements. `'item'` is upstream's `repeat` by
 * key, so an element follows its record. `'slot'` re-binds elements by
 * position, so an element shows whatever record its slot holds next.
 */
export type RowMode = 'item' | 'slot';

/** The rows directive's config: upstream's, plus the row mapping. */
export type VirtualizeRowsConfig = VirtualizeDirectiveConfig<unknown> & { mode?: RowMode };

/**
 * Most rows a shrinking range sets aside for when it grows again. A guess:
 * plan section 14, open question 6.
 */
const SPARE_LIMIT = 32;

/**
 * The slot reconciler: renders `values` (the rows for indexes `first`,
 * `first + 1`, ...) into child parts in index order, with no keys.
 *
 * - A part whose index stays in range keeps its place, so a row that stays
 *   on screen is not touched beyond its (usually unchanged) values.
 * - Parts whose index left the range take the indexes entering it, moved as
 *   one block to the other end, so a k-row step moves k rows. DOM order stays
 *   index order, which upstream relies on to place the i-th child at index
 *   `first + i`. Each renders its new row before it moves, since the move
 *   reconnects its elements (see `#place`).
 * - When the old and new ranges do not overlap (a jump), and when they are
 *   the same (a sort, a filter that keeps the range), every part is re-bound
 *   where it stands: nothing moves.
 * - The range grows with spare parts first, then new ones. Parts a shrinking
 *   range drops wait, disconnected, in a detached fragment (up to
 *   `SPARE_LIMIT`); the rest are removed.
 *
 * A new instance on a part another directive rendered (a mode switch from
 * `repeat`) removes those rows and builds its own, once.
 */
class SlotRowsDirective extends Directive {
  /** Parts in DOM order; null until this instance first updates. */
  #parts: ChildPart[] | null = null;
  /** Item index the first part shows. */
  #first = 0;
  #spares: ChildPart[] = [];
  /** Lit's parent for the spares: disconnected, so their directives are too. */
  #spareRoot: RootPart | null = null;

  public render(_values: unknown[], _first: number): unknown {
    return noChange;
  }

  public override update(container: ChildPart, [values, first]: [unknown[], number]): unknown {
    let parts = this.#parts;
    if (!parts) {
      const inherited = getCommittedValue(container);
      if (Array.isArray(inherited)) {
        for (const part of inherited as ChildPart[]) removePart(part);
      }
      parts = [];
    }

    const count = values.length;
    const next: ChildPart[] = new Array(count);
    const start = Math.max(first, this.#first);
    const end = Math.min(first + count, this.#first + parts.length);

    // Parts that stay where they stand, which take their values last.
    let keptFrom: number;
    let keptTo: number;
    if (end <= start) {
      // No index survives (a jump, or a first render): re-bind in place.
      keptFrom = 0;
      keptTo = Math.min(parts.length, count);
      for (let i = 0; i < keptTo; i++) next[i] = parts[i];
      for (let i = keptTo; i < parts.length; i++) this.#setAside(parts[i]);
      for (let i = keptTo; i < count; i++) {
        next[i] = this.#place(container, undefined, this.#spares.pop(), values[i]);
      }
    } else {
      keptFrom = start - first;
      keptTo = end - first;
      for (let index = start; index < end; index++) {
        next[index - first] = parts[index - this.#first];
      }
      // At most one end of the range loses parts while the other gains slots
      // (or both shrink, or both grow).
      const leftHead = parts.slice(0, start - this.#first);
      const leftTail = parts.slice(end - this.#first);
      const head = start - first;
      const tail = first + count - end;

      // Scrolling down: the parts above the range become the rows below it.
      for (let i = 0; i < tail; i++) {
        const index = end - first + i;
        const part = leftHead.shift() ?? this.#spares.pop();
        next[index] = this.#place(container, undefined, part, values[index]);
      }
      // Scrolling up: the parts below the range become the rows above it.
      const ref = next[head];
      for (let i = 0; i < head; i++) {
        const part = leftTail.shift() ?? this.#spares.pop();
        next[i] = this.#place(container, ref, part, values[i]);
      }
      for (const part of leftHead) this.#setAside(part);
      for (const part of leftTail) this.#setAside(part);
    }

    for (let i = keptFrom; i < keptTo; i++) setChildPartValue(next[i], values[i]);
    this.#parts = next;
    this.#first = first;
    setCommittedValue(container, next);
    return noChange;
  }

  /**
   * Inserts `part` (a part that left the range, or a spare) before `ref` (the
   * end when undefined) showing `value`, or a new part when there is none.
   *
   * The move disconnects and reconnects every custom element in the part, so
   * the part renders `value` first, all the way down: an element that reads
   * its data in `connectedCallback` sees the record it is about to show, not
   * the one it leaves (GitHub issue #39).
   */
  #place(
    container: ChildPart,
    ref: ChildPart | undefined,
    part: ChildPart | undefined,
    value: unknown
  ): ChildPart {
    if (!part) {
      // Built straight into the container: its elements connect already set.
      const created = insertPart(container, ref) as ChildPart;
      setChildPartValue(created, value);
      return created;
    }
    const focused = deepActiveElement();
    setChildPartValue(part, value);
    for (let node = part.startNode?.nextSibling ?? null; node && node !== part.endNode; ) {
      const following: ChildNode | null = node.nextSibling;
      if (node instanceof Element) flushUpdates(node);
      node = following;
    }
    // Rendering the new row can focus something in it: an edit still open on
    // the record resumes its editor. Rendered after the move, as before, it
    // kept that focus, so it keeps it across the move too. A spare renders
    // detached, where focus is a no-op: its cell takes it on connect.
    const gained = deepActiveElement();
    const keep =
      gained !== focused && gained instanceof HTMLElement && partContains(part, gained)
        ? gained
        : null;
    if (keep) moveWithFocus(container, ref, part);
    const placed = insertPart(container, ref, part) as ChildPart;
    if (keep && deepActiveElement() !== keep) keep.focus({ preventScroll: true });
    return placed;
  }

  /** Keeps a part the range no longer needs as a spare, or removes it. */
  #setAside(part: ChildPart): void {
    if (this.#spares.length >= SPARE_LIMIT) {
      removePart(part);
      return;
    }
    // Inserting into another container reparents the part, and lit notifies
    // its directives that it left the document.
    this.#spareRoot ??= render(nothing, document.createDocumentFragment(), {
      isConnected: false,
    });
    insertPart(this.#spareRoot, undefined, part);
    this.#spares.push(part);
  }
}

const slotRows = directive(SlotRowsDirective);

/** Whether `node` renders inside `part`, through shadow roots. */
function partContains(part: ChildPart, node: Node): boolean {
  const top = new Set<Node>();
  for (let child = part.startNode?.nextSibling ?? null; child && child !== part.endNode; ) {
    top.add(child);
    child = child.nextSibling;
  }
  for (let current: Node | null = node; current; ) {
    if (top.has(current)) return true;
    current = current.parentNode ?? (current instanceof ShadowRoot ? current.host : null);
  }
  return false;
}

type MovingParent = ParentNode & { moveBefore?(node: Node, child: Node | null): void };

/**
 * Moves the part's nodes to where `insertPart` puts them with `moveBefore`,
 * which keeps focus and fires no `focusout`; `insertPart` then finds them in
 * place. Without it (Firefox, WebKit) `insertPart` moves them, which drops
 * focus without a `focusout` there, and the caller focuses again.
 */
function moveWithFocus(container: ChildPart, ref: ChildPart | undefined, part: ChildPart): void {
  const parent = part.startNode?.parentNode as MovingParent | null | undefined;
  const refNode = ref ? ref.startNode : container.endNode;
  if (!parent?.moveBefore || !parent.isConnected || refNode?.parentNode !== parent) return;
  const stop = part.endNode?.nextSibling ?? null;
  for (let node: Node | null = part.startNode; node && node !== stop; ) {
    const following: Node | null = node.nextSibling;
    parent.moveBefore(node, refNode);
    node = following;
  }
}

/** The part of a Lit element's update cycle {@link flushUpdates} drives. */
interface UpdatingElement extends Element {
  isUpdatePending: boolean;
  hasUpdated: boolean;
  renderRoot: Element | ShadowRoot;
  performUpdate(): void;
}

/**
 * Whether `element` updates when Lit schedules it, so running its update now
 * only runs it early. An element that overrides `scheduleUpdate` (to wait a
 * frame, say) is left to it. Checked by where the method is defined: on the
 * base class that also defines `addController`, unless a subclass overrides
 * it. Lit keeps both names in minified builds, and any copy of Lit matches.
 */
function schedulesByDefault(element: Element): boolean {
  let owner: object | null = Object.getPrototypeOf(element);
  while (owner && !Object.hasOwn(owner, 'scheduleUpdate')) owner = Object.getPrototypeOf(owner);
  return !!owner && Object.hasOwn(owner, 'addController');
}

/**
 * Runs, now, the updates a new value set off in `element` and below it: a row
 * renders its cells, each cell its content, and so on down. Lit runs them a
 * microtask later otherwise, after the move that reconnects them.
 *
 * Only elements that have rendered before: a new one renders once connected.
 * Only elements that keep Lit's own update schedule (see
 * {@link schedulesByDefault}). Only render roots whose host just updated,
 * since nothing else in them changed. A light-DOM child is always visited,
 * as its parent may set it.
 */
function flushUpdates(element: Element): void {
  const updating = element as Partial<UpdatingElement>;
  let root: ParentNode | undefined;
  if (
    updating.isUpdatePending &&
    updating.hasUpdated &&
    updating.performUpdate &&
    schedulesByDefault(element)
  ) {
    try {
      updating.performUpdate();
    } catch (error) {
      // Reported as Lit reports a failed scheduled update, without stopping
      // the rows still to render.
      queueMicrotask(() => {
        throw error;
      });
    }
    root = updating.renderRoot;
  }
  for (let child = element.firstElementChild; child; child = child.nextElementSibling) {
    flushUpdates(child);
  }
  if (root && root !== element) {
    for (let child = root.firstElementChild; child; child = child.nextElementSibling) {
      flushUpdates(child);
    }
  }
}

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
    if (this.mode === 'slot') {
      return slotRows(
        itemsToRender.map((item, i) => this._renderItem(item, i)),
        this._first
      );
    }
    // Item branch: upstream's render, byte for byte.
    return repeat(itemsToRender, this._keyFunction, this._renderItem);
  }

  public override update(part: ChildPart, args: [VirtualizeRowsConfig]): unknown {
    const host = part.parentNode as Element | null;
    if (host && host.nodeType === Node.ELEMENT_NODE && host !== this.#host) {
      this.#host = host;
      directives.set(host, this);
    }
    // A switch renders through the other branch's directive, which rebuilds
    // the rows once. This class (and so upstream's range listener) stays.
    this.mode = args[0].mode ?? 'item';
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
    const slot = this.mode === 'slot';
    const moved: Element[] = [];
    let changed = false;
    for (let child = host.firstElementChild; child; child = child.nextElementSibling) {
      if (child.hasAttribute(SIZER_ATTRIBUTE)) continue;
      const index = this._first + rows.length;
      const was = this.#indexOf.get(child);
      if (observer && was !== undefined && was !== index) {
        observer.unobserve(child);
        observer.observe(child);
      }
      if (slot && was !== index) moved.push(child);
      this.#indexOf.set(child, index);
      if (previous[rows.length] !== child) changed = true;
      rows.push(child);
    }
    if (rows.length !== previous.length) changed = true;
    this.#rows = rows;
    if (moved.length) void this.#measure(moved);

    this.#epoch++;
    // Rows added, removed or moved are observed (or re-observed) above or by
    // upstream, so its own path settles `layoutComplete`. Only a render that
    // kept every row element where it was can go unobserved.
    if (!changed) this.#probe();
  }

  /**
   * Slot mode: measures rows that stand at a new index once they have
   * rendered their new record, before the frame paints.
   *
   * The fresh observation above is not enough on its own here. A render that
   * a children `ResizeObserver` callback set off (a measure that moved the
   * range) observes rows no deeper in the tree than the ones that callback
   * just reported, and the browser holds such observations to the next frame.
   * Under item keys the same round also reports the rows it removed, which
   * sit outside the tree, so the new rows still land in that frame. Re-bound
   * rows have no such luck: through a fling the layout would stay a frame
   * behind, keep its unmeasured anchor, and finally correct the scroll offset.
   * The observation still runs, and is what settles `layoutComplete`.
   */
  async #measure(moved: Element[]): Promise<void> {
    await Promise.all(
      moved.map((row) => (row as Element & { updateComplete?: Promise<unknown> }).updateComplete)
    );
    const virtualizer = this.#virtualizer;
    const host = this.#host;
    if (!virtualizer?._childrenRO || !host?.isConnected) return;
    let pending = false;
    for (const row of moved) {
      // Only rows still where this render put them.
      const index = this.#indexOf.get(row);
      if (index === undefined || this.#rows[index - this._first] !== row) continue;
      virtualizer._toBeMeasured.set(row, null);
      pending = true;
    }
    if (pending) virtualizer._measureChildren();
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
export const virtualizeRows: (config: VirtualizeRowsConfig) => DirectiveResult =
  directive(VirtualizeRowsDirective);
