import { virtualizerRef } from '@lit-labs/virtualizer/virtualize.js';
import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { TemplateResult } from 'lit';
import { ApexGrid } from '../src/components/grid.js';
import type ApexGridRow from '../src/components/row.js';
import type ApexVirtualizer from '../src/components/virtualizer.js';
import type { ColumnConfiguration, GridExpansionConfiguration } from '../src/internal/types.js';
import { delayRangeReports } from './utils/range-report.js';
import { settle } from './utils/settle.js';

// The body virtualizer substrate: the forked rows directive and what it adds on
// top of upstream (measure on reuse, the `layoutComplete` fallback, the reveal
// token, `rendered()` and the range listener order). Everything here runs in
// both keyings; the default group recycles the body rows, which is where a
// reused row element stands at a new index, and the item group keys them by
// record.
// See plans/core/2026-10-27-row-recycling-plan.md, sections 3.1 and 3.5.

interface Row {
  id: number;
  name: string;
}

const COLUMNS: ColumnConfiguration<Row>[] = [{ key: 'id' }, { key: 'name' }];

const records = (count: number, name = (id: number) => `Row ${id}`): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: i + 1, name: name(i + 1) }));

interface MountOptions {
  columns?: ColumnConfiguration<Row>[];
  expansion?: GridExpansionConfiguration<Row>;
  rowReordering?: boolean;
}

async function mount(data: Row[], options: MountOptions = {}): Promise<ApexGrid<Row>> {
  ApexGrid.register();
  const host = document.createElement('div');
  host.style.height = '600px';
  const grid = await fixture<ApexGrid<Row>>(
    html`<apex-grid
      .data=${data}
      .columns=${options.columns ?? COLUMNS}
      .expansion=${options.expansion}
      .rowReordering=${{ enabled: Boolean(options.rowReordering) }}
    ></apex-grid>`,
    { parentNode: host }
  );
  await settle(grid);
  return grid;
}

function bodyOf(grid: ApexGrid<Row>): ApexVirtualizer {
  return grid.renderRoot.querySelector('apex-virtualizer') as ApexVirtualizer;
}

function bodyRows(grid: ApexGrid<Row>): ApexGridRow<Row>[] {
  return Array.from(bodyOf(grid).querySelectorAll<ApexGridRow<Row>>(':scope > apex-grid-row'));
}

/** Upstream's flow layout, for its per-index size cache. */
function layoutOf(grid: ApexGrid<Row>): {
  _metricsCache: { getChildSize(index: number): number | undefined };
} {
  const body = bodyOf(grid) as unknown as Record<symbol, { _layout: unknown }>;
  return body[virtualizerRef]._layout as ReturnType<typeof layoutOf>;
}

/** Whether `promise` settles within `frames` animation frames. */
async function settlesWithin(promise: Promise<unknown> | undefined, frames: number) {
  let settled = false;
  void promise?.then(
    () => (settled = true),
    () => (settled = true)
  );
  for (let i = 0; i < frames && !settled; i++) await nextFrame();
  return settled;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * Gaps and overlaps between rendered neighbours, as `index: gap` strings, plus
 * every rendered index the layout has no measured size for.
 */
function layoutFaults(grid: ApexGrid<Row>): string[] {
  const rows = bodyRows(grid).sort((a, b) => a.index - b.index);
  const cache = layoutOf(grid)._metricsCache;
  const faults: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (cache.getChildSize(rows[i].index) === undefined) faults.push(`${rows[i].index}: unsized`);
    if (i === 0 || rows[i].index !== rows[i - 1].index + 1) continue;
    const gap = rows[i].getBoundingClientRect().top - rows[i - 1].getBoundingClientRect().bottom;
    if (Math.abs(gap) > 1) faults.push(`${rows[i].index}: ${gap.toFixed(1)}px`);
  }
  return faults;
}

describe('virtualizer substrate', () => {
  afterEach(() => fixtureCleanup());

  describe('measure on reuse', () => {
    const expansion: GridExpansionConfiguration<Row> = {
      enabled: true,
      detailTemplate: ({ data }) => html`<div style="height: 200px">detail ${data.id}</div>`,
    };

    // Under slot recycling a jump re-binds row elements to new indexes in place.
    // Upstream measures only what its ResizeObserver reports, so without a
    // fresh observation those indexes keep an estimated size and rows overlap.
    it('keeps rendered rows contiguous and measured across jumps and a smooth scroll', async () => {
      const data = records(4000);
      const grid = await mount(data, { expansion });
      grid.expandedRows = data.filter((_, i) => i % 4 === 0);
      await settle(grid);

      const faults: string[] = [];
      for (const target of [1500, 2600, 900, 3100, 1800, 2213, 702, 2901]) {
        bodyOf(grid).element(target)?.scrollIntoView({ block: 'start' });
        await settle(grid);
        faults.push(...layoutFaults(grid).map((fault) => `jump ${target} ${fault}`));
      }

      for (let frame = 0; frame < 50; frame++) {
        grid.scrollTop += 40;
        await nextFrame();
      }
      await settle(grid);
      faults.push(...layoutFaults(grid).map((fault) => `scroll ${fault}`));

      expect(faults).to.eql([]);
    });
  });

  describe('layoutComplete', () => {
    // Raw `layoutComplete` on purpose: these tests are about the promise itself.

    it('settles within 3 frames after moveRow re-renders the rows', async () => {
      const grid = await mount(records(3), { rowReordering: true });
      expect(grid.moveRow(0, 2, 'after')).to.equal(true);
      await grid.updateComplete;
      expect(await settlesWithin(bodyOf(grid).layoutComplete, 3)).to.equal(true);
      expect(bodyRows(grid).map((row) => row.data.id)).to.eql([2, 3, 1]);
    });

    it('settles within 3 frames after a sort re-renders the rows', async () => {
      const grid = await mount(records(40));
      grid.sort({ key: 'id', direction: 'descending' });
      await grid.updateComplete;
      expect(await settlesWithin(bodyOf(grid).layoutComplete, 3)).to.equal(true);
      expect(bodyRows(grid)[0].data.id).to.equal(40);
    });

    // Read once the sorted rows have rendered, while the probe that render
    // started (before anyone waited) is still in flight.
    it('settles within 3 frames when read after a sort has rendered', async () => {
      const grid = await mount(records(40));
      grid.sort({ key: 'id', direction: 'descending' });
      await grid.updateComplete;
      await bodyOf(grid).rendered();
      expect(bodyRows(grid)[0].data.id).to.equal(40);
      expect(await settlesWithin(bodyOf(grid).layoutComplete, 3)).to.equal(true);
    });

    it('settles within 3 frames when read with nothing left to lay out', async () => {
      const grid = await mount(records(40));
      for (let i = 0; i < 4; i++) await nextFrame();
      expect(await settlesWithin(bodyOf(grid).layoutComplete, 3)).to.equal(true);
    });

    it('settles only after the rows a measure brings in have been measured too', async () => {
      const height = (ctx: { value: unknown }): TemplateResult =>
        html`<div style=${`height: ${ctx.value === 'tall' ? 90 : 20}px`}>${ctx.value}</div>`;
      const columns: ColumnConfiguration<Row>[] = [
        { key: 'id' },
        { key: 'name', cellTemplate: height } as ColumnConfiguration<Row>,
      ];
      const grid = await mount(
        records(400, () => 'tall'),
        { columns }
      );
      const before = bodyRows(grid).length;

      // Shorter rows: once the first batch is measured the range grows, and
      // the rows that brings in need a measure of their own before it settles.
      grid.data = records(400, () => 'short');
      await grid.updateComplete;
      await bodyOf(grid).layoutComplete;

      const rows = bodyRows(grid);
      const cache = layoutOf(grid)._metricsCache;
      expect(rows.length).to.be.greaterThan(before);
      for (const row of rows) {
        expect(cache.getChildSize(row.index), `size of ${row.index}`).to.be.closeTo(
          row.getBoundingClientRect().height,
          1
        );
      }
      expect(layoutFaults(grid)).to.eql([]);
    });

    // Upstream resolves the first promise in the same frame the fallback's own
    // probe lands. A promise read from that resolution's continuation, right
    // after a far scroll, is a new one: it must wait for the range the scroll
    // brings in, not settle with the probe that was already in flight.
    it('does not settle a promise read after an upstream resolution with the old range', async () => {
      const grid = await mount(records(5000));
      const body = bodyOf(grid);
      grid.scrollTop = 2000;
      const result = await new Promise<{ rendered: boolean; max: number }>((done) => {
        void body.layoutComplete!.then(() => {
          grid.scrollTop = 100000;
          void body.layoutComplete!.then(() => {
            const indexes = bodyRows(grid).map((row) => row.index);
            const max = Math.max(...indexes);
            done({ rendered: body.isRendered(Math.floor(100000 / 36)), max });
          });
        });
      });
      expect(result.rendered, `rendered up to ${result.max}`).to.equal(true);
    });

    // A row that resizes while the fallback's probe is in flight is a measure
    // the probe has to wait out: the promise settles no sooner than upstream's
    // own two frames after that measure.
    it('waits two frames after a row resizes inside the probe', async () => {
      const grid = await mount(records(40));
      const body = bodyOf(grid);
      for (let i = 0; i < 4; i++) await nextFrame();
      let frames = -1;
      const promise = body.layoutComplete!.then(() => frames);

      await nextFrame();
      // Within the probe's first frame; the row's observer reports it this frame.
      bodyRows(grid)[0].style.height = '80px';
      frames = 0;
      const count = () => {
        frames++;
        if (frames < 10) requestAnimationFrame(count);
      };
      requestAnimationFrame(count);

      expect(await promise, 'frames after the resize').to.be.at.least(2);
    });

    // New items render only once the layout reports the range, delayed here
    // well past the fallback's two frames. Neither a read made while the body
    // still has the update queued, nor one made after the update ran but
    // before its rows render, is quiet: both wait for the new rows.
    for (const when of ['while the update is queued', 'before the deferred render'] as const) {
      it(`waits for new items to render when read ${when}`, async () => {
        const grid = await mount(records(40));
        const body = bodyOf(grid);
        for (let i = 0; i < 4; i++) await nextFrame();
        const restore = delayRangeReports(body, 150);
        try {
          body.items = records(40, (id) => `Next ${id}`);
          if (when === 'while the update is queued') {
            expect(body.isUpdatePending).to.equal(true);
          } else {
            await body.updateComplete;
            expect(bodyRows(grid)[0].data.name, 'not rendered yet').to.equal('Row 1');
          }
          let name = '';
          await body.layoutComplete!.then(() => {
            name = bodyRows(grid)[0].data.name;
          });
          expect(name).to.equal('Next 1');
        } finally {
          restore();
        }
      });
    }
  });

  describe('reveal token', () => {
    it('drops a deferred reveal once a newer scroll has been asked for', async () => {
      const grid = await mount(records(4000));
      const body = bodyOf(grid);
      const late = deferred();
      // The first reveal waits on a settle that only ends when the test says so.
      body.settled = () => late.promise;

      expect(body.isRendered(2000), 'the first target starts unrendered').to.equal(false);
      body.element(2000)!.scrollIntoView({ block: 'start' });
      for (let i = 0; i < 4; i++) await nextFrame();
      expect(body.isRendered(1990), 'the second target is rendered').to.equal(true);
      body.element(1990)!.scrollIntoView({ block: 'start' });
      for (let i = 0; i < 2; i++) await nextFrame();
      const scrollTop = grid.scrollTop;

      late.resolve();
      for (let i = 0; i < 4; i++) await nextFrame();
      expect(grid.scrollTop).to.equal(scrollTop);
    });
  });

  describe('rendered()', () => {
    it('resolves once new items have rendered and their rows have updated', async () => {
      const grid = await mount(records(100));
      const body = bodyOf(grid);
      const reversed = [...(body.items as Row[])].reverse();

      body.items = reversed;
      await body.rendered();

      const rows = bodyRows(grid);
      expect(rows[0].data).to.equal(reversed[rows[0].index]);
      expect(rows.every((row) => !row.isUpdatePending)).to.equal(true);
    });

    // New items reach the rows only once upstream reports the range. Delaying
    // that report past any microtask chain makes the wait on the deferred
    // render the only thing that can hold `rendered()` back.
    it('waits for the deferred render however late the range report comes', async () => {
      const grid = await mount(records(100));
      const body = bodyOf(grid);
      const restore = delayRangeReports(body, 30);
      try {
        const reversed = [...(body.items as Row[])].reverse();
        body.items = reversed;
        await body.rendered();

        const rows = bodyRows(grid);
        expect(rows[0].data).to.equal(reversed[rows[0].index]);
        expect(rows.every((row) => !row.isUpdatePending)).to.equal(true);
      } finally {
        restore();
      }
    });

    // A disconnected body never reports a range, so the deferred render would
    // never come; `rendered()` (and the FLIP waiting on it) must not hang.
    it('resolves when the body is disconnected before new items render', async () => {
      const grid = await mount(records(100));
      const body = bodyOf(grid);
      body.items = [...(body.items as Row[])].reverse();
      grid.remove();
      expect(await settlesWithin(body.rendered(), 4)).to.equal(true);
    });
  });

  describe('range listener order', () => {
    it('lets every rangeChanged listener see the rows of the previous range', async () => {
      const grid = await mount(records(4000));
      const body = bodyOf(grid);
      const before = new Map(bodyRows(grid).map((row) => [row, row.index]));
      const focused = bodyRows(grid)[5];
      focused.cells[0].focus();
      const seen: string[] = [];
      // Registered after the rows directive's own listener.
      body.addEventListener(
        'rangeChanged',
        () => {
          for (const row of bodyRows(grid)) {
            if (before.get(row) !== row.index) seen.push(`${before.get(row)} -> ${row.index}`);
          }
          seen.push(`focused ${focused.index}`);
        },
        { once: true }
      );

      // Far enough that index 5 leaves the range, so slot recycling re-binds its row in place.
      grid.scrollTop = 130 * bodyRows(grid)[0].getBoundingClientRect().height;
      await settle(grid);

      expect(body.isRendered(5)).to.equal(false);
      expect(seen).to.eql(['focused 5']);
    });
  });
});
