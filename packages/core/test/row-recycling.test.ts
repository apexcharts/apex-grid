import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import { setViewport } from '@web/test-runner-commands';
import { nothing } from 'lit';
import { AsyncDirective, directive } from 'lit/async-directive.js';
import { ApexGrid } from '../src/components/grid.js';
import type ApexGridRow from '../src/components/row.js';
import { virtualizedRows } from '../src/components/virtualize-rows.js';
import type ApexVirtualizer from '../src/components/virtualizer.js';
import type { GridDOMController } from '../src/controllers/dom.js';
import type { ColumnConfiguration, GridExpansionConfiguration } from '../src/internal/types.js';
import { settle } from './utils/settle.js';

// The slot reconciler behind `rowRecycling`: a row element is re-bound to
// whatever index its slot shows next instead of following its record. Every
// grid here sets `rowRecycling` itself, so these pins run in both suite groups.
// See plans/core/2026-10-27-row-recycling-plan.md, sections 3.1, 3.2 and 11.3.

interface Row {
  id: number;
  name: string;
}

const COLUMNS: ColumnConfiguration<Row>[] = [{ key: 'id' }, { key: 'name' }];

const records = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Row ${i + 1}` }));

/** The runner's default window, restored after a test that resizes it. */
const DEFAULT_VIEWPORT = { width: 800, height: 600 };

interface MountOptions {
  data?: Row[];
  height?: string;
  recycling?: boolean;
  expansion?: GridExpansionConfiguration<Row>;
}

async function mount(options: MountOptions = {}): Promise<ApexGrid<Row>> {
  ApexGrid.register();
  const host = document.createElement('div');
  host.style.height = options.height ?? '600px';
  const grid = await fixture<ApexGrid<Row>>(
    html`<apex-grid
      .rowRecycling=${options.recycling ?? true}
      .data=${options.data ?? records(2000)}
      .columns=${COLUMNS}
      .expansion=${options.expansion}
    ></apex-grid>`,
    { parentNode: host }
  );
  await settle(grid);
  return grid;
}

function bodyOf(grid: ApexGrid<Row>): ApexVirtualizer {
  return grid.renderRoot.querySelector('apex-virtualizer') as ApexVirtualizer;
}

const isRow = (node: Node): node is ApexGridRow<Row> =>
  node.nodeType === Node.ELEMENT_NODE && (node as Element).localName === 'apex-grid-row';

/** Body rows in DOM order. */
function bodyRows(grid: ApexGrid<Row>): ApexGridRow<Row>[] {
  return Array.from(bodyOf(grid).children).filter(isRow);
}

/** Offset of the first body row inside the grid's scrolled content. */
function originOf(grid: ApexGrid<Row>): number {
  return (
    bodyOf(grid).getBoundingClientRect().top -
    grid.getBoundingClientRect().top -
    grid.clientTop +
    grid.scrollTop
  );
}

/** Uniform row height; fails when rows differ, since steps rely on it. */
function rowHeight(grid: ApexGrid<Row>): number {
  const heights = new Set(bodyRows(grid).map((row) => row.getBoundingClientRect().height));
  expect([...heights], 'uniform row heights').to.have.length(1);
  return [...heights][0];
}

/**
 * Row element changes between `start()` and `take()`, from a MutationObserver
 * on the body. Rows only: lit's part markers move with every row.
 */
class RowMutations {
  readonly #observer: MutationObserver;
  #records: MutationRecord[] = [];

  constructor(body: Element) {
    this.#observer = new MutationObserver((records) => this.#records.push(...records));
    this.#observer.observe(body, { childList: true });
  }

  public start() {
    this.#observer.takeRecords();
    this.#records = [];
  }

  /** created = new and attached, moved = detached and re-attached, removed = detached. */
  public take() {
    const records = [...this.#records, ...this.#observer.takeRecords()];
    this.#records = [];
    const seen = new Map<Node, { first: 'add' | 'remove'; last: 'add' | 'remove' }>();
    const note = (node: Node, event: 'add' | 'remove') => {
      if (!isRow(node)) return;
      const entry = seen.get(node);
      if (entry) entry.last = event;
      else seen.set(node, { first: event, last: event });
    };
    for (const record of records) {
      for (const node of record.removedNodes) note(node, 'remove');
      for (const node of record.addedNodes) note(node, 'add');
    }
    const counts = { created: 0, moved: 0, removed: 0, transient: 0 };
    for (const { first, last } of seen.values()) {
      if (first === 'add') counts[last === 'add' ? 'created' : 'transient']++;
      else counts[last === 'add' ? 'moved' : 'removed']++;
    }
    return counts;
  }

  public disconnect() {
    this.#observer.disconnect();
  }
}

/**
 * Every rendered row shows the record at its index, indexes are unique and
 * DOM order is index order, which upstream relies on to place the rows.
 */
function rangeFaults(grid: ApexGrid<Row>): string[] {
  const rows = bodyRows(grid);
  const items = grid.pageItems;
  const faults: string[] = [];
  const seen = new Set<number>();
  rows.forEach((row, i) => {
    if (seen.has(row.index)) faults.push(`${row.index}: duplicate`);
    seen.add(row.index);
    if (i > 0 && row.index !== rows[i - 1].index + 1) {
      faults.push(`${rows[i - 1].index} then ${row.index}`);
    }
    if (row.data !== items[row.index]) faults.push(`${row.index}: shows ${row.data?.id}`);
  });
  return faults;
}

describe('Row recycling: slot reconciler', () => {
  afterEach(() => fixtureCleanup());

  describe('DOM counts', () => {
    let grid: ApexGrid<Row>;
    let counter: RowMutations;
    let h: number;
    let origin: number;

    /** Scrolls to `row` at the top, mid-list, and lets the layout settle. */
    async function scrollToRow(row: number) {
      grid.scrollTop = origin + row * h;
      await settle(grid);
    }

    beforeEach(async () => {
      grid = await mount();
      h = rowHeight(grid);
      origin = originOf(grid);
      // Warm-up: mid-list, with every row of the range measured.
      await scrollToRow(800);
      await scrollToRow(801);
      counter = new RowMutations(bodyOf(grid));
    });

    afterEach(() => counter.disconnect());

    /** Runs `operation` and returns its row counts, asserting the range kept its length. */
    async function counted(operation: () => Promise<void>) {
      const before = bodyRows(grid).length;
      counter.start();
      await operation();
      const counts = counter.take();
      expect(bodyRows(grid).length, 'range length').to.equal(before);
      expect(rangeFaults(grid)).to.eql([]);
      return counts;
    }

    for (const k of [1, 5, -5]) {
      it(`a ${Math.abs(k)}-row step ${k > 0 ? 'down' : 'up'} moves exactly ${Math.abs(k)} rows`, async () => {
        const first = bodyRows(grid)[0].index;
        const counts = await counted(async () => {
          grid.scrollTop += k * h;
          await settle(grid);
        });
        expect(bodyRows(grid)[0].index, 'the range moved by the step').to.equal(first + k);
        expect(counts).to.eql({ created: 0, moved: Math.abs(k), removed: 0, transient: 0 });
      });
    }

    it('a 30-row fling over several frames moves exactly 30 rows', async () => {
      const first = bodyRows(grid)[0].index;
      const top = grid.scrollTop;
      const counts = await counted(async () => {
        // Set from animation frames, as an animated scroll does: each step's
        // range change then runs inside a children ResizeObserver callback,
        // where a fresh observation of a re-bound row waits a frame.
        for (let frame = 1; frame <= 10; frame++) {
          grid.scrollTop = top + frame * 3 * h;
          await nextFrame();
        }
        await settle(grid);
      });
      expect(bodyRows(grid)[0].index, 'no scroll correction').to.equal(first + 30);
      expect(counts).to.eql({ created: 0, moved: 30, removed: 0, transient: 0 });
    });

    it('a jump re-binds every row in place', async () => {
      const elements = bodyRows(grid);
      const last = elements.at(-1)!.index;
      const counts = await counted(() => scrollToRow(1300));
      expect(bodyRows(grid)[0].index, 'no overlap with the old range').to.be.greaterThan(last);
      expect(counts).to.eql({ created: 0, moved: 0, removed: 0, transient: 0 });
      expect(bodyRows(grid)).to.eql(elements);
    });

    it('a sort re-binds every row in place', async () => {
      const elements = bodyRows(grid);
      const counts = await counted(async () => {
        grid.sort({ key: 'id', direction: 'descending' });
        await settle(grid);
      });
      expect(counts).to.eql({ created: 0, moved: 0, removed: 0, transient: 0 });
      expect(bodyRows(grid)).to.eql(elements);
      expect(bodyRows(grid)[0].data.id).to.equal(2000 - bodyRows(grid)[0].index);
    });

    it('keeps the rows that stay in range on their element', async () => {
      const before = new Map(bodyRows(grid).map((row) => [row.index, row]));
      await counted(async () => {
        grid.scrollTop += 5 * h;
        await settle(grid);
      });
      const stayed = bodyRows(grid).filter((row) => before.has(row.index));
      expect(stayed.length).to.be.greaterThan(10);
      for (const row of stayed) expect(row, `row ${row.index}`).to.equal(before.get(row.index));
    });
  });

  describe('uniqueness', () => {
    let style: HTMLStyleElement;

    beforeEach(async () => {
      await setViewport({ width: 1200, height: 2200 });
      // 20px rows, so the range is far longer than any fixed pool of keys.
      style = document.createElement('style');
      style.textContent =
        'apex-grid.short-rows::part(row) { height: 20px; min-height: 0; overflow: hidden; }';
      document.head.append(style);
    });

    afterEach(async () => {
      style.remove();
      await setViewport(DEFAULT_VIEWPORT);
    });

    it('renders each index once and in order, across jumps and steps on a long range', async () => {
      const grid = await mount({ data: records(6000), height: '2100px' });
      grid.classList.add('short-rows');
      await settle(grid);
      const h = rowHeight(grid);
      expect(h).to.equal(20);
      const origin = originOf(grid);

      const faults: string[] = [];
      const check = (label: string) =>
        faults.push(...rangeFaults(grid).map((fault) => `${label}: ${fault}`));
      check('mount');
      for (const target of [3000, 3007, 2990, 4500, 130, 5200, 5130]) {
        grid.scrollTop = origin + target * h;
        await settle(grid);
        check(`row ${target}`);
      }
      expect(bodyRows(grid).length, 'range longer than 128 rows').to.be.greaterThan(128);
      expect(faults).to.eql([]);
    });
  });

  describe('adjacency', () => {
    const expansion: GridExpansionConfiguration<Row> = {
      enabled: true,
      detailTemplate: ({ data }) => html`<div style="height: 200px">detail ${data.id}</div>`,
    };

    /** Gaps or overlaps between rendered neighbours, as `index: gap` strings. */
    function gaps(grid: ApexGrid<Row>): string[] {
      const rows = bodyRows(grid);
      const faults: string[] = [];
      for (let i = 1; i < rows.length; i++) {
        const gap =
          rows[i].getBoundingClientRect().top - rows[i - 1].getBoundingClientRect().bottom;
        if (Math.abs(gap) > 1) faults.push(`${rows[i].index}: ${gap.toFixed(1)}px`);
      }
      return faults;
    }

    it('keeps variable-height rows contiguous across jumps and a smooth scroll', async () => {
      const data = records(4000);
      const grid = await mount({ data, expansion });
      grid.expandedRows = data.filter((_, i) => i % 4 === 0);
      await settle(grid);

      const faults: string[] = [];
      for (const target of [1500, 2600, 900, 3100, 1800, 2213, 702, 2901]) {
        bodyOf(grid).element(target)?.scrollIntoView({ block: 'start' });
        await settle(grid);
        faults.push(...gaps(grid).map((fault) => `jump ${target} ${fault}`));
        faults.push(...rangeFaults(grid).map((fault) => `jump ${target} ${fault}`));
      }
      for (let frame = 0; frame < 50; frame++) {
        grid.scrollTop += 40;
        await nextFrame();
      }
      await settle(grid);
      faults.push(...gaps(grid).map((fault) => `scroll ${fault}`));
      faults.push(...rangeFaults(grid).map((fault) => `scroll ${fault}`));
      expect(faults).to.eql([]);
    });
  });

  describe('range shrink and growth', () => {
    /** Connected instances of a probe directive rendered next to every row. */
    const connected = new Set<object>();

    class ConnectionProbe extends AsyncDirective {
      constructor(part: ConstructorParameters<typeof AsyncDirective>[0]) {
        super(part);
        connected.add(this);
      }
      public render() {
        return nothing;
      }
      protected override disconnected() {
        connected.delete(this);
      }
      protected override reconnected() {
        connected.add(this);
      }
    }
    const probe = directive(ConnectionProbe);

    afterEach(() => connected.clear());

    it('keeps rows that leave a shrinking range for when it grows again', async () => {
      const grid = await mount({ data: records(1000) });
      grid.pagination = { enabled: true, pageSize: 100 };
      await settle(grid);
      const seen = new Set(bodyRows(grid));
      const full = seen.size;
      // Longer than the spares plus the shrunk page, or the cap goes untested.
      expect(full, 'range longer than spares + shrunk page').to.be.greaterThan(10 + 32);

      grid.pageSize = 10;
      await settle(grid);
      expect(bodyRows(grid).length).to.equal(10);
      expect(rangeFaults(grid)).to.eql([]);

      grid.pageSize = 100;
      await settle(grid);
      const rows = bodyRows(grid);
      expect(rows.length).to.equal(full);
      expect(rangeFaults(grid)).to.eql([]);
      // 32 rows wait as spares; only the ones beyond that are built again.
      const fresh = rows.filter((row) => !seen.has(row)).length;
      expect(fresh).to.equal(Math.max(0, full - 10 - 32));
    });

    it('disconnects the directives of rows set aside and reconnects them on reuse', async () => {
      const grid = await mount({ data: records(1000) });
      const dom = (grid as unknown as { DOM: GridDOMController<Row> }).DOM;
      const rowRenderer = dom.rowRenderer;
      dom.rowRenderer = (data, index) => html`${probe()}${rowRenderer(data, index)}`;
      grid.pagination = { enabled: true, pageSize: 100 };
      await settle(grid);
      const full = bodyRows(grid).length;
      expect(connected.size).to.equal(full);

      grid.pageSize = 10;
      await settle(grid);
      expect(connected.size, 'only the rendered rows are connected').to.equal(10);

      grid.pageSize = 100;
      await settle(grid);
      expect(bodyRows(grid).length).to.equal(full);
      expect(connected.size, 'every rendered row is connected again').to.equal(full);
    });
  });

  describe('mode switch', () => {
    it('switches a live grid between slot and item rows on the one directive', async () => {
      const errors: string[] = [];
      const onError = (event: ErrorEvent) => errors.push(event.message);
      window.addEventListener('error', onError);
      const grid = await mount();
      const body = bodyOf(grid);
      const directive = virtualizedRows(body);
      expect(directive?.mode).to.equal('slot');

      // Upstream adds a `rangeChanged` listener per directive instance and never
      // removes it, so a switch that swapped directives would leave two.
      const added: string[] = [];
      const addEventListener = body.addEventListener;
      body.addEventListener = function (
        this: ApexVirtualizer,
        ...args: Parameters<typeof addEventListener>
      ) {
        added.push(String(args[0]));
        return addEventListener.apply(this, args);
      } as typeof addEventListener;
      let renders = 0;
      body.addEventListener('rangeChanged', () => renders++);
      added.length = 0;

      try {
        for (const recycling of [false, true, false, true]) {
          const before = bodyRows(grid);
          grid.rowRecycling = recycling;
          await settle(grid);
          expect(virtualizedRows(body), 'same directive').to.equal(directive);
          expect(directive?.mode).to.equal(recycling ? 'slot' : 'item');
          expect(rangeFaults(grid), `rowRecycling ${recycling}`).to.eql([]);
          // A switch rebuilds the rows once, so no element carries the other
          // mode's bookkeeping.
          expect(bodyRows(grid).filter((row) => before.includes(row))).to.eql([]);

          grid.scrollTop += 2000;
          await settle(grid);
          expect(rangeFaults(grid), `scrolled, rowRecycling ${recycling}`).to.eql([]);
        }
        expect(added, 'listeners added during the switches').to.eql([]);
        expect(renders).to.be.greaterThan(0);
      } finally {
        body.addEventListener = addEventListener;
        window.removeEventListener('error', onError);
      }
      expect(errors).to.eql([]);
    });

    it('reads the row-recycling attribute', async () => {
      ApexGrid.register();
      const host = document.createElement('div');
      host.style.height = '400px';
      const grid = await fixture<ApexGrid<Row>>(
        html`<apex-grid row-recycling .data=${records(50)} .columns=${COLUMNS}></apex-grid>`,
        { parentNode: host }
      );
      await settle(grid);
      expect(grid.rowRecycling).to.equal(true);
      expect(virtualizedRows(bodyOf(grid))?.mode).to.equal('slot');
    });

    it('turns recycling off with row-recycling="false"', async () => {
      ApexGrid.register();
      const host = document.createElement('div');
      host.style.height = '400px';
      const grid = await fixture<ApexGrid<Row>>(
        html`<apex-grid row-recycling="false" .data=${records(50)} .columns=${COLUMNS}></apex-grid>`,
        { parentNode: host }
      );
      await settle(grid);
      expect(grid.rowRecycling).to.equal(false);
      expect(virtualizedRows(bodyOf(grid))?.mode).to.equal('item');

      grid.setAttribute('row-recycling', '');
      await settle(grid);
      expect(grid.rowRecycling, 'any other value turns it on').to.equal(true);
      expect(virtualizedRows(bodyOf(grid))?.mode).to.equal('slot');
    });

    it('restores the default when rowRecycling is set to undefined or null', async () => {
      // A framework wrapper unsets a dropped prop by assigning `undefined`
      // (React through @lit/react does), which must not read as an opt-out.
      const fallback = ApexGrid.defaultRowRecycling;
      const fallbackMode = fallback ? 'slot' : 'item';
      for (const empty of [undefined, null]) {
        const grid = await mount({ data: records(50), height: '400px', recycling: !fallback });
        expect(grid.rowRecycling).to.equal(!fallback);

        grid.rowRecycling = empty as unknown as boolean;
        await settle(grid);
        expect(grid.rowRecycling, `after ${empty}`).to.equal(fallback);
        expect(virtualizedRows(bodyOf(grid))?.mode, `after ${empty}`).to.equal(fallbackMode);
        fixtureCleanup();
      }
    });
  });
});
