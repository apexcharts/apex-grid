import { expect, html, nextFrame } from '@open-wc/testing';
import { emulateMedia } from '@web/test-runner-commands';
import type { ApexGrid } from '../src/components/grid.js';
import type { StateController } from '../src/controllers/state.js';
import type { ColumnConfiguration } from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import { settle } from './utils/settle.js';
import data, { type TestData } from './utils/test-data.js';

/**
 * The row FLIP of a programmatic sort: `grid.sort()` and `grid.clearSort()`
 * on a rendered grid animate the rows the way a header click does, while
 * staying silent (no `sorting` or `sorted` event, no announcement of the
 * sort). An assigned or restored sort (`sortExpressions`, `setState`) applies
 * without motion. Every test runs in both keyings; the 8 rows are 36px tall
 * and all rendered, so record k sorted descending moves by (2k - 9) rows.
 */
class SortFlipFixture<T extends TestData> extends GridTestFixture<T> {
  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number', sort: true },
      { key: 'name', sort: true },
    ] as ColumnConfiguration<T>[];
  }

  public override async setUp() {
    this.data = JSON.parse(JSON.stringify(data)) as T[];
    await super.setUp();
  }

  public override setupTemplate() {
    return html`<apex-grid .data=${this.data} .columns=${this.columnConfig}></apex-grid>`;
  }

  public get stateController(): StateController<T> {
    return (this.grid as unknown as { stateController: StateController<T> }).stateController;
  }

  public ids(grid: ApexGrid<T> = this.grid): number[] {
    return grid.pageItems.map((row) => (row as TestData).id);
  }

  /** The pipeline run, its render, and the frames that start any FLIP. */
  public async flipped(grid: ApexGrid<T> = this.grid): Promise<void> {
    await (grid as unknown as { pipelineSettled(): Promise<void> }).pipelineSettled();
    await settle(grid);
  }
}

/** A row FLIP as started: the record its row renders, and its vertical delta. */
interface Flip {
  id: number;
  dy: number;
}

/**
 * Records every row FLIP started while installed, by wrapping `Element.animate`.
 * `animations[i]` is the animation of `flips[i]`, kept apart so a failing
 * assertion on `flips` never carries a live animation (and its element) into
 * the runner's report.
 */
function recordFlips(): { flips: Flip[]; animations: Animation[]; restore: () => void } {
  const flips: Flip[] = [];
  const animations: Animation[] = [];
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (
    this: Element,
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions
  ) {
    const animation = animate.call(this, keyframes, options);
    if (typeof options === 'object' && options.id === 'apex-flip-y' && Array.isArray(keyframes)) {
      const match = /translate\([^,]+,\s*(-?[\d.]+)px\)/.exec(String(keyframes[0]?.transform));
      const record = (this as Element & { data?: TestData }).data;
      if (match && record) {
        flips.push({ id: record.id, dy: Number(match[1]) });
        animations.push(animation);
      }
    }
    return animation;
  };
  return { flips, animations, restore: () => (Element.prototype.animate = animate) };
}

function expectDeltas(flips: ReadonlyArray<Flip>, expected: Record<number, number>): void {
  const actual = Object.fromEntries(flips.map(({ id, dy }) => [id, dy]));
  expect(Object.keys(actual).map(Number).sort(), 'records that FLIP').to.deep.equal(
    Object.keys(expected).map(Number).sort()
  );
  for (const [id, dy] of Object.entries(expected)) {
    expect(actual[Number(id)], `record ${id}`).to.be.closeTo(dy, 1);
  }
}

/** The deltas of a sort from ids 1..8 to 8..1, or back. */
const REVERSED = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((id) => [id, (2 * id - 9) * 36]));
const RESTORED = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((id) => [id, (9 - 2 * id) * 36]));

const ASCENDING = [1, 2, 3, 4, 5, 6, 7, 8];
const DESCENDING = [8, 7, 6, 5, 4, 3, 2, 1];

const fx = new SortFlipFixture(data);
let recorder: ReturnType<typeof recordFlips>;

/** The fixture grid's rendered rows, with the record each one shows. */
function bodyRows(grid: ApexGrid<TestData> = fx.grid): Array<HTMLElement & { data: TestData }> {
  return grid.rows as unknown as Array<HTMLElement & { data: TestData }>;
}

/** Waits for every running row animation to finish, or to be cancelled. */
async function rowFlipsFinished(): Promise<void> {
  await Promise.all(
    bodyRows()
      .flatMap((row) => row.getAnimations())
      .map((animation) => animation.finished.catch(() => undefined))
  );
}

describe('Programmatic sort FLIP', () => {
  beforeEach(async () => {
    await fx.setUp();
    recorder = recordFlips();
  });
  afterEach(() => {
    recorder.restore();
    return fx.tearDown();
  });

  it('grid.sort() animates the rows with the deltas of a header click', async () => {
    fx.grid.sort({ key: 'id', direction: 'descending' });
    await fx.flipped();
    expect(fx.ids()).to.deep.equal(DESCENDING);
    expectDeltas(recorder.flips, REVERSED);
  });

  it('grid.sort() updates sortExpressions and getState() before it returns', () => {
    fx.grid.sort({ key: 'id', direction: 'descending' });
    expect(fx.grid.sortExpressions.map((e) => [e.key, e.direction])).to.eql([['id', 'descending']]);
    expect(fx.grid.getState().sort.map((e) => [e.key, e.direction])).to.eql([['id', 'descending']]);
  });

  it('grid.sort() returns undefined, as before', () => {
    const returned: unknown = fx.grid.sort({ key: 'id', direction: 'descending' });
    expect(returned).to.equal(undefined);
  });

  it('a sort that leaves the order as it is does not animate', async () => {
    fx.grid.sort({ key: 'id', direction: 'ascending' });
    await fx.flipped();
    expect(fx.ids()).to.deep.equal(ASCENDING);
    expect(recorder.flips).to.be.empty;
  });

  it('fires no sorting or sorted event and announces nothing', async () => {
    const events: string[] = [];
    fx.grid.addEventListener('sorting', () => events.push('sorting'));
    fx.grid.addEventListener('sorted', () => events.push('sorted'));
    const announced: string[] = [];
    fx.grid.announce = (message: string) => void announced.push(message);

    fx.grid.sort({ key: 'id', direction: 'descending' });
    await fx.flipped();
    fx.grid.clearSort();
    await fx.flipped();

    expect(fx.ids()).to.deep.equal(ASCENDING);
    expect(recorder.flips.length, 'both changes animated').to.equal(16);
    expect(events).to.eql([]);
    expect(announced).to.eql([]);
  });

  it('grid.clearSort() animates the rows back to their unsorted order', async () => {
    fx.grid.setState({ sort: [{ key: 'id', direction: 'descending' }] });
    await fx.flipped();
    expect(fx.ids()).to.deep.equal(DESCENDING);
    recorder.flips.length = recorder.animations.length = 0;

    fx.grid.clearSort();
    expect(fx.grid.sortExpressions).to.eql([]);
    await fx.flipped();
    expect(fx.ids()).to.deep.equal(ASCENDING);
    expectDeltas(recorder.flips, RESTORED);
  });

  it('grid.clearSort(key) animates too', async () => {
    fx.grid.setState({ sort: [{ key: 'id', direction: 'descending' }] });
    await fx.flipped();
    recorder.flips.length = recorder.animations.length = 0;

    fx.grid.clearSort('id');
    await fx.flipped();
    expect(fx.ids()).to.deep.equal(ASCENDING);
    expectDeltas(recorder.flips, RESTORED);
  });

  it('setState({ sort }) and the sortExpressions setter apply without motion', async () => {
    fx.grid.setState({ sort: [{ key: 'id', direction: 'descending' }] });
    await fx.flipped();
    expect(fx.ids()).to.deep.equal(DESCENDING);

    fx.grid.sortExpressions = [{ key: 'id', direction: 'ascending' } as never];
    await fx.flipped();
    expect(fx.ids()).to.deep.equal(ASCENDING);
    expect(recorder.flips, 'no FLIP for an assigned or restored sort').to.be.empty;

    // The same change through sort() does animate, so the above is not vacuous.
    fx.grid.sort({ key: 'id', direction: 'descending' });
    await fx.flipped();
    expectDeltas(recorder.flips, REVERSED);
  });

  it('does not animate under prefers-reduced-motion', async () => {
    await emulateMedia({ reducedMotion: 'reduce' });
    try {
      fx.grid.sort({ key: 'id', direction: 'descending' });
      await fx.flipped();
      expect(fx.ids()).to.deep.equal(DESCENDING);
      expect(recorder.flips, 'no FLIP under reduced motion').to.be.empty;
    } finally {
      await emulateMedia({ reducedMotion: 'no-preference' });
    }

    fx.grid.sort({ key: 'id', direction: 'ascending' });
    await fx.flipped();
    expectDeltas(recorder.flips, RESTORED);
  });

  it('a second sort before the first FLIP ends replaces it instead of stacking', async () => {
    fx.grid.sort({ key: 'id', direction: 'descending' });
    await (fx.grid as unknown as { pipelineSettled(): Promise<void> }).pipelineSettled();
    await nextFrame();
    const first = recorder.flips.length;
    expect(first, 'the first sort started its FLIP').to.equal(8);

    fx.grid.sort({ key: 'id', direction: 'ascending' });
    await (fx.grid as unknown as { pipelineSettled(): Promise<void> }).pipelineSettled();
    await nextFrame();
    expect(fx.ids()).to.deep.equal(ASCENDING);

    // Each row runs at most one row FLIP: the second replaced the first. Each
    // second FLIP starts where the row stood mid-flight, so it is no longer
    // than a move from rest.
    for (const row of bodyRows()) {
      const running = row.getAnimations().filter((a) => a.id === 'apex-flip-y');
      expect(running.length, `FLIPs on record ${row.data.id}`).to.be.at.most(1);
    }
    for (const { id, dy } of recorder.flips.slice(first)) {
      expect(Math.abs(dy), `record ${id}`).to.be.at.most(Math.abs(RESTORED[id]) + 1);
    }

    // Once the motion ends, every record sits on its ascending slot.
    await rowFlipsFinished();
    const tops = new Map(bodyRows().map((row) => [row.data.id, row.getBoundingClientRect().top]));
    const origin = tops.get(ASCENDING[0])!;
    ASCENDING.forEach((id, slot) => {
      expect(tops.get(id)! - origin, `record ${id}`).to.be.closeTo(slot * 36, 1);
    });
  });

  it('a programmatic sort racing a header click replaces the click FLIP', async () => {
    const column = fx.grid.columns.find((c) => c.key === 'id')!;
    const click = fx.stateController.sorting.sortFromUI(column, { direction: 'descending' });
    fx.grid.sort({ key: 'name', direction: 'descending' });
    await click;
    await fx.flipped();

    // The header click replaced the sort with `id`; sort() added `name` behind it.
    expect(fx.grid.sortExpressions.map((e) => e.key)).to.eql(['id', 'name']);
    expect(fx.ids()).to.deep.equal(DESCENDING);
    // Both captured the rows at rest before the one render, so the click
    // started 8 FLIPs and sort() started 8 more over the same distance. The
    // later ones cancelled the earlier ones instead of stacking on them.
    expect(recorder.flips.length, 'the click and sort() both animated').to.equal(16);
    expectDeltas(recorder.flips.slice(0, 8), REVERSED);
    expectDeltas(recorder.flips.slice(8), REVERSED);
    recorder.flips.slice(0, 8).forEach(({ id }, i) => {
      expect(recorder.animations[i].playState, `earlier FLIP of record ${id}`).to.equal('idle');
    });
    for (const row of bodyRows()) {
      const running = row.getAnimations().filter((a) => a.id === 'apex-flip-y');
      expect(running.length, `FLIPs on record ${row.data.id}`).to.be.at.most(1);
    }
  });

  it('clearSort(key) while an assigned sort is pending applies it without motion', async () => {
    fx.grid.sortExpressions = [
      { key: 'id', direction: 'descending' },
      { key: 'name', direction: 'ascending' },
    ] as never;
    fx.grid.clearSort('name');
    expect(fx.grid.sortExpressions.map((e) => e.key)).to.eql(['id']);
    await fx.flipped();
    expect(fx.ids()).to.deep.equal(DESCENDING);
    expect(recorder.flips, 'the assigned sort applies without a FLIP').to.be.empty;
  });

  it('clearSort() drops a pending assigned sort and animates from the applied one', async () => {
    fx.grid.setState({ sort: [{ key: 'id', direction: 'descending' }] });
    await fx.flipped();
    expect(fx.ids()).to.deep.equal(DESCENDING);

    fx.grid.sortExpressions = [{ key: 'name', direction: 'ascending' }] as never;
    fx.grid.clearSort();
    expect(fx.grid.sortExpressions).to.eql([]);
    await fx.flipped();
    expect(fx.ids()).to.deep.equal(ASCENDING);
    expectDeltas(recorder.flips, RESTORED);
  });

  it('does not animate, or throw, on a disconnected grid', async () => {
    const { grid } = fx;
    const parent = grid.parentElement!;
    grid.remove();
    expect(() => grid.sort({ key: 'id', direction: 'descending' })).to.not.throw();
    expect(() => grid.clearSort()).to.not.throw();
    expect(() => grid.sort({ key: 'id', direction: 'descending' })).to.not.throw();
    expect(grid.sortExpressions.map((e) => e.direction)).to.eql(['descending']);

    parent.append(grid);
    await fx.flipped();
    expect(fx.ids()).to.deep.equal(DESCENDING);
    expect(recorder.flips).to.be.empty;
  });

  it('does not animate a sort made before the first render', async () => {
    // Its own grid in view: the fixture grid would push it below the fold,
    // where the body renders no rows.
    await fx.tearDown();
    const parent = document.createElement('div');
    parent.style.height = '800px';
    const grid = document.createElement('apex-grid') as unknown as ApexGrid<TestData>;
    grid.data = JSON.parse(JSON.stringify(data)) as TestData[];
    grid.columns = fx.columnConfig as ColumnConfiguration<TestData>[];
    expect(() => grid.sort({ key: 'id', direction: 'descending' })).to.not.throw();
    expect(grid.sortExpressions.map((e) => e.direction)).to.eql(['descending']);

    document.body.append(parent);
    try {
      parent.append(grid);
      await fx.flipped(grid);
      expect(fx.ids(grid)).to.deep.equal(DESCENDING);
      expect(recorder.flips, 'no FLIP for the first render').to.be.empty;

      // Once rendered, the same grid animates.
      grid.sort({ key: 'id', direction: 'ascending' });
      await fx.flipped(grid);
      expectDeltas(recorder.flips, RESTORED);
    } finally {
      parent.remove();
    }
  });

  it('does not animate, or reject, a sort made right after connecting', async () => {
    await fx.tearDown();
    const parent = document.createElement('div');
    parent.style.height = '800px';
    const grid = document.createElement('apex-grid') as unknown as ApexGrid<TestData>;
    grid.data = JSON.parse(JSON.stringify(data)) as TestData[];
    grid.columns = fx.columnConfig as ColumnConfiguration<TestData>[];
    const rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent) => void rejections.push(event.reason);
    window.addEventListener('unhandledrejection', onRejection);

    document.body.append(parent);
    try {
      // Connected but not yet rendered: no row exists to animate from.
      parent.append(grid);
      expect(() => grid.sort({ key: 'id', direction: 'descending' })).to.not.throw();
      expect(grid.sortExpressions.map((e) => e.direction)).to.eql(['descending']);
      await fx.flipped(grid);
      expect(fx.ids(grid)).to.deep.equal(DESCENDING);
      expect(recorder.flips, 'no FLIP for the first render').to.be.empty;
      expect(rejections).to.be.empty;
    } finally {
      window.removeEventListener('unhandledrejection', onRejection);
      parent.remove();
    }
  });
});
