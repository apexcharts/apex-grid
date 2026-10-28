import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ReactiveController } from 'lit';
import type ApexGridCell from '../src/components/cell.js';
import { ApexGrid } from '../src/components/grid.js';
import type ApexGridRow from '../src/components/row.js';
import { StateController } from '../src/controllers/state.js';
import type { GridFeatureModule, PresentedRow } from '../src/internal/feature-module.js';
import type {
  ColumnConfiguration,
  GridExpansionConfiguration,
  GridHost,
  GridSelectionConfiguration,
  GridTreeConfiguration,
} from '../src/internal/types.js';
import { settle } from './utils/settle.js';

// A row element re-bound to another record (a pinned band today, a body slot
// under row recycling, which the suite's second group turns on) must
// show the new record as it is, not animate from the previous record's look:
// a progress bar growing from the old value, a selected wash fading out, a
// chevron rotating shut. The row marks such a re-bind with `data-rebound`
// for a frame, which zeroes the duration tokens for the row and everything
// it renders, the cells' shadow roots included. A real toggle keeps its record
// and still animates.
// See plans/core/2026-10-27-row-recycling-plan.md, sections 4.3 and 7.

interface Row {
  id: number;
  name: string;
  health: number;
  active: boolean;
  path?: string[];
  photo?: string;
}

/** Long enough that a transition a re-bind starts is still running when the test looks. */
const SLOW_MOTION = '--ag-dur-fast: 20s; --ag-dur-med: 20s; --ag-dur-slow: 20s;';

const flat = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Row ${String(i + 1).padStart(3, '0')}`,
    // Neighbours differ a lot, so any re-bind changes the bar width.
    health: (i * 37) % 100,
    active: i % 2 === 0,
  }));

/** 80 roots with one child each; every other root starts expanded. */
const forest = (): Row[] =>
  Array.from({ length: 80 }, (_, i) => {
    const root = `Root ${String(i + 1).padStart(3, '0')}`;
    return [
      { id: i * 2 + 1, name: root, health: (i * 37) % 100, active: true, path: [root] },
      {
        id: i * 2 + 2,
        name: `${root} child`,
        health: (i * 53) % 100,
        active: false,
        path: [root, 'child'],
      },
    ];
  }).flat();

interface MountOptions {
  columns?: ColumnConfiguration<Row>[];
  selection?: GridSelectionConfiguration<Row>;
  expansion?: GridExpansionConfiguration<Row>;
  tree?: GridTreeConfiguration<Row>;
  pinning?: boolean;
}

async function mount(data: Row[], options: MountOptions = {}): Promise<ApexGrid<Row>> {
  ApexGrid.register();
  const host = document.createElement('div');
  host.style.height = '600px';
  const grid = await fixture<ApexGrid<Row>>(
    html`<apex-grid
      style=${SLOW_MOTION}
      .data=${data}
      .columns=${options.columns ?? []}
      .selection=${options.selection}
      .expansion=${options.expansion}
      .tree=${options.tree}
      .rowPinning=${{ enabled: Boolean(options.pinning) }}
    ></apex-grid>`,
    { parentNode: host }
  );
  await settle(grid);
  return grid;
}

/**
 * Every animation in the document and in every shadow root below it. A
 * root's `getAnimations()` covers only its own tree, so `document` alone
 * misses everything a row or cell renders.
 */
function allAnimations(): Animation[] {
  const found: Animation[] = [];
  const visit = (root: Document | ShadowRoot) => {
    found.push(...root.getAnimations());
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  };
  visit(document);
  return found;
}

/** Every CSS transition still running anywhere, shadow roots included. */
function runningTransitions(): string[] {
  return allAnimations()
    .filter((animation) => animation instanceof CSSTransition)
    .filter((animation) => animation.playState === 'running')
    .map((animation) => {
      const transition = animation as CSSTransition;
      const target = (transition.effect as KeyframeEffect | null)?.target as Element | null;
      const where = target?.getAttribute('part') ?? target?.localName ?? '?';
      return `${transition.transitionProperty} on ${where}`;
    });
}

/** Stops every running animation, so one step's leftovers never count against the next. */
function finishAll() {
  for (const animation of allAnimations()) animation.finish();
}

function bodyRows(grid: ApexGrid<Row>): ApexGridRow<Row>[] {
  const body = grid.renderRoot.querySelector('apex-virtualizer')!;
  return Array.from(body.querySelectorAll<ApexGridRow<Row>>(':scope > apex-grid-row'));
}

/** Records shown by the rendered body rows, by element, to tell whether a step re-bound any. */
function boundRecords(grid: ApexGrid<Row>): Map<ApexGridRow<Row>, Row> {
  return new Map(bodyRows(grid).map((row) => [row, row.data]));
}

function reboundCount(before: Map<ApexGridRow<Row>, Row>, grid: ApexGrid<Row>): number {
  return bodyRows(grid).filter((row) => before.has(row) && before.get(row) !== row.data).length;
}

function bandRows(grid: ApexGrid<Row>): ApexGridRow<Row>[] {
  return grid.rows.filter((row) => row.closest('[part~="pinned-rows"]'));
}

/** Whether this run recycles body rows, so a sort or a jump re-binds them in place. */
const rebinding = () => Boolean((globalThis as { __apexRowKeying?: string }).__apexRowKeying);

const rowHeight = (grid: ApexGrid<Row>) => bodyRows(grid)[0].getBoundingClientRect().height;

/** Runs `step`, waits for the grid, and returns the transitions it left running. */
async function after(grid: ApexGrid<Row>, step: () => unknown) {
  finishAll();
  await step();
  await settle(grid);
  return runningTransitions();
}

/**
 * A programmatic sort, a jump and a 5-row scroll step. Under item keys none
 * of them re-binds a body row (nothing to animate); under slot keys each one
 * re-binds rows in place, and none may leave a transition behind.
 */
async function expectNoTransitionsAcrossRebinds(grid: ApexGrid<Row>, sortKey: keyof Row) {
  let records = boundRecords(grid);
  expect(
    await after(grid, () => grid.sort({ key: sortKey, direction: 'descending' } as never)),
    'after a sort'
  ).to.deep.equal([]);
  const sortRebinds = reboundCount(records, grid);

  records = boundRecords(grid);
  const step = rowHeight(grid);
  expect(
    await after(grid, () => {
      grid.scrollTop = 64 * step;
    }),
    'after a jump'
  ).to.deep.equal([]);
  const jumpRebinds = reboundCount(records, grid);

  records = boundRecords(grid);
  expect(
    await after(grid, () => {
      grid.scrollTop += 5 * step;
    }),
    'after a 5-row scroll step'
  ).to.deep.equal([]);
  const stepRebinds = reboundCount(records, grid);

  return { sortRebinds, jumpRebinds, stepRebinds };
}

describe('Transitions on a row re-bind', () => {
  afterEach(() => fixtureCleanup());

  it('a sort, a jump and a scroll step leave no transition running (progress, selection, expansion)', async () => {
    const data = flat(300);
    const grid = await mount(data, {
      columns: [
        { key: 'id', type: 'number' },
        { key: 'health', type: 'progress' },
        { key: 'active', type: 'boolean' },
      ] as ColumnConfiguration<Row>[],
      selection: { enabled: true, mode: 'multiple' },
      expansion: {
        enabled: true,
        detailTemplate: ({ data: row }) => html`<span>Detail ${row.id}</span>`,
      },
    });
    // Selected and expanded rows interleave with plain ones, so a re-bind
    // flips the selected wash, the checkbox and the expansion chevron too.
    for (const row of data) {
      if (row.id % 3 === 0) await grid.selectRow(row);
      if (row.id % 5 === 0) await grid.expandRow(row);
    }
    await settle(grid);
    finishAll();

    const counts = await expectNoTransitionsAcrossRebinds(grid, 'id');
    // The assertion above means something only where rows did re-bind.
    if (rebinding()) {
      expect(counts.sortRebinds, 'the sort re-bound no row').to.be.greaterThan(0);
      expect(
        counts.jumpRebinds + counts.stepRebinds,
        'scrolling re-bound no row'
      ).to.be.greaterThan(0);
    }
  });

  it('a sort, a jump and a scroll step leave no transition running (tree chevrons)', async () => {
    const grid = await mount(forest(), {
      columns: [{ key: 'name' }, { key: 'health', type: 'progress' }] as ColumnConfiguration<Row>[],
      tree: { enabled: true, getDataPath: (row) => row.path ?? [] },
    });
    // Every other root open, so a slot moves between open and shut chevrons.
    const roots = grid.data.filter((row) => row.path?.length === 1);
    for (const [i, root] of roots.entries()) {
      if (i % 2 === 0) await grid.expandTreeRow(root);
    }
    await settle(grid);
    finishAll();

    const counts = await expectNoTransitionsAcrossRebinds(grid, 'name');
    if (rebinding()) {
      expect(counts.sortRebinds, 'the sort re-bound no row').to.be.greaterThan(0);
    }
  });

  it('a pinned band re-bound by an unpin leaves no transition running (both keyings)', async () => {
    // The pinned bands re-bind positionally under any keying: unpinning the
    // first of three moves the other two up one element, and their band
    // index (stripe parity), selection and progress all change with it.
    const data = flat(20);
    const grid = await mount(data, {
      columns: [
        { key: 'id', type: 'number' },
        { key: 'health', type: 'progress' },
        { key: 'active', type: 'boolean' },
      ] as ColumnConfiguration<Row>[],
      selection: { enabled: true, mode: 'multiple' },
      pinning: true,
    });
    grid.pinRow(data[0]);
    grid.pinRow(data[1]);
    grid.pinRow(data[2]);
    await grid.selectRow(data[1]);
    await settle(grid);
    finishAll();

    const before = new Map(bandRows(grid).map((row) => [row, row.data]));
    expect(before.size).to.equal(3);

    const left = await after(grid, () => grid.unpinRow(data[0]));
    const rebound = [...before].filter(([row, record]) => row.isConnected && row.data !== record);
    expect(rebound.length, 'the unpin re-bound no pinned row').to.be.greaterThan(0);
    expect(left).to.deep.equal([]);
  });

  describe('module-rendered rows', () => {
    // The enterprise group, pivot and server-side group rows draw their
    // chevron with an inline `transition` that reads the motion tokens, inside
    // the row's shadow root. A stand-in presenter does the same here.
    class ChevronPresenter implements ReactiveController {
      constructor(host: GridHost<Row>) {
        host.addController(this);
      }
      hostConnected() {}
      presentRow(row: Row): PresentedRow | null {
        const open = row.id % 2 === 0;
        return {
          content: html`<svg
            part="group-chevron"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            style="transform:rotate(${open ? 90 : 0}deg);transition:transform var(--_ag-dur-med) var(--_ag-ease)"
          ></svg>`,
        };
      }
    }

    const chevronModule: GridFeatureModule<Row> = {
      id: 'rebind-chevron-presenter',
      create: (host) => new ChevronPresenter(host),
    };

    class ChevronGrid<T extends object> extends ApexGrid<T> {
      public static override get tagName() {
        return 'apex-grid-rebind-chevron-test';
      }
      public static override register() {
        if (!customElements.get(ChevronGrid.tagName)) {
          customElements.define(ChevronGrid.tagName, ChevronGrid);
        }
      }
      protected override createStateController(): StateController<T> {
        return new StateController<T>(this, [chevronModule as unknown as GridFeatureModule<T>]);
      }
    }

    it('an inline chevron rotation does not run when a pinned band re-binds (both keyings)', async () => {
      ApexGrid.register();
      ChevronGrid.register();
      const data = flat(20);
      const grid = (await fixture(
        html`<apex-grid-rebind-chevron-test
          style=${SLOW_MOTION}
          .data=${data}
          .columns=${[{ key: 'id' }]}
          .rowPinning=${{ enabled: true }}
        ></apex-grid-rebind-chevron-test>`
      )) as ApexGrid<Row>;
      await settle(grid);
      grid.pinRow(data[0]);
      grid.pinRow(data[1]);
      grid.pinRow(data[2]);
      await settle(grid);

      // Records 1 and 3 are shut, 2 is open: each band element turns over.
      const left = await after(grid, () => grid.unpinRow(data[0]));
      expect(bandRows(grid).map((row) => row.data.id)).to.deep.equal([2, 3]);
      expect(left).to.deep.equal([]);
    });
  });

  it('a real toggle keeps its record and still animates', async () => {
    const data = flat(20);
    const grid = await mount(data, {
      columns: [
        { key: 'id', type: 'number' },
        { key: 'health', type: 'progress' },
      ] as ColumnConfiguration<Row>[],
      selection: { enabled: true, mode: 'multiple' },
      expansion: {
        enabled: true,
        detailTemplate: ({ data: row }) => html`<span>Detail ${row.id}</span>`,
      },
    });
    finishAll();

    await grid.selectRow(data[0]);
    await grid.expandRow(data[1]);
    await settle(grid);
    const running = runningTransitions();
    // The selected wash on the row and the expansion chevron.
    expect(running).to.include('background-color on row');
    expect(running).to.include('transform on expansion-chevron');
    finishAll();
  });

  it('clears the mark once the re-bound frame has painted', async () => {
    const data = flat(20);
    const grid = await mount(data, {
      columns: [{ key: 'id', type: 'number' }] as ColumnConfiguration<Row>[],
      pinning: true,
    });
    grid.pinRow(data[0]);
    grid.pinRow(data[1]);
    await settle(grid);
    const [, second] = bandRows(grid);
    expect(second?.data).to.equal(data[1]);

    grid.unpinRow(data[0]);
    await grid.updateComplete;
    await Promise.all(grid.rows.map((row) => row.updateComplete));
    // The first band element now shows record 2 (it showed record 1).
    const [row] = bandRows(grid);
    expect(row.data).to.equal(data[1]);
    expect(row.hasAttribute('data-rebound'), 'the re-bound pinned row is not marked').to.be.true;
    // Still marked through the frame that paints the re-bind, gone after it.
    await nextFrame();
    expect(row.hasAttribute('data-rebound')).to.be.true;
    await nextFrame();
    await nextFrame();
    expect(row.hasAttribute('data-rebound')).to.be.false;
  });
});

describe('Image column on a re-bind', () => {
  afterEach(() => fixtureCleanup());

  // An `<img>` whose `src` changes keeps painting its old picture in some
  // engines until the new one has loaded and decoded, so a re-bound image cell
  // would show the previous record's picture for a while. (Chromium clears it
  // at once, so this runner cannot see the picture itself; it checks that the
  // cell never hands an `<img>` from one picture to another.)

  /** A distinct one-pixel picture per record, with no request to the server. */
  const photo = (id: number) =>
    `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3Ctitle%3E${id}%3C/title%3E%3C/svg%3E`;

  /** The `<img>` of each rendered photo cell, with the record the cell shows. */
  function images(rows: ApexGridRow<Row>[]) {
    return new Map(
      rows.flatMap((row) =>
        (row.cells as ApexGridCell<Row>[])
          .filter((cell) => cell.column.key === 'photo')
          .map((cell) => [cell, { img: cell.renderRoot.querySelector('img'), record: cell.record }])
      )
    );
  }

  /** Cells whose `<img>` element now shows a picture it did not show before. */
  function handedOver(before: ReturnType<typeof images>, after: ReturnType<typeof images>) {
    const moved: string[] = [];
    for (const [cell, now] of after) {
      const was = before.get(cell);
      if (!was?.img || !now.img || was.record.photo === now.record.photo) continue;
      if (was.img === now.img) moved.push(`${was.record.id} -> ${now.record.id}`);
    }
    return moved;
  }

  async function mountPhotos(data: Row[], pinning = false) {
    for (const row of data) row.photo = photo(row.id);
    return mount(data, {
      columns: [
        { key: 'id', type: 'number' },
        { key: 'photo', type: 'image' },
      ] as ColumnConfiguration<Row>[],
      pinning,
    });
  }

  it('a pinned band re-bind gives each new picture its own <img> (both keyings)', async () => {
    const data = flat(20);
    const grid = await mountPhotos(data, true);
    grid.pinRow(data[0]);
    grid.pinRow(data[1]);
    grid.pinRow(data[2]);
    await settle(grid);

    const before = images(bandRows(grid));
    expect(before.size).to.equal(3);
    // Unpinning the first moves records 2 and 3 up one pinned element each.
    grid.unpinRow(data[0]);
    await settle(grid);
    const after = images(bandRows(grid));
    expect([...after.values()].map(({ record }) => record.id)).to.deep.equal([2, 3]);
    for (const { img, record } of after.values()) {
      expect(img?.getAttribute('src')).to.equal(record.photo);
    }
    expect(handedOver(before, after)).to.deep.equal([]);
  });

  it('a sort gives each re-bound cell a fresh <img> for its record’s picture', async () => {
    const data = flat(300);
    const grid = await mountPhotos(data);

    const before = images(bodyRows(grid));
    grid.sort({ key: 'id', direction: 'descending' } as never);
    await settle(grid);
    const after = images(bodyRows(grid));
    for (const { img, record } of after.values()) {
      expect(img?.getAttribute('src')).to.equal(record.photo);
    }
    expect(handedOver(before, after)).to.deep.equal([]);
    if (rebinding()) {
      const rebound = [...after].filter(
        ([cell, now]) => before.has(cell) && before.get(cell)!.record !== now.record
      );
      expect(rebound.length, 'the sort re-bound no image cell').to.be.greaterThan(0);
    }
  });
});
