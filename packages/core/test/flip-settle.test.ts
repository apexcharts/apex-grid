import { expect, html, nextFrame } from '@open-wc/testing';
import type ApexVirtualizer from '../src/components/virtualizer.js';
import type { StateController } from '../src/controllers/state.js';
import type {
  ColumnConfiguration,
  DataPipelineConfiguration,
  GridRowReorderingConfiguration,
} from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import { delayRangeReports } from './utils/range-report.js';
import { settle } from './utils/settle.js';
import data, { type TestData } from './utils/test-data.js';

/**
 * Row FLIP deltas after a sort or a row move (plan sections 4.3 and 4.4).
 * Both wait on one settle helper before measuring the "Last" rects, so the
 * deltas are exact even when the pipeline resolves after the grid's update.
 * Every test runs in both keyings; the 8 rows are 36px tall and all rendered.
 */
class FlipFixture<T extends TestData> extends GridTestFixture<T> {
  public rowReordering: GridRowReorderingConfiguration = { enabled: true };
  public pipeline?: DataPipelineConfiguration<T>;

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
    return html`<apex-grid
      .data=${this.data}
      .columns=${this.columnConfig}
      .rowReordering=${this.rowReordering}
      .dataPipelineConfiguration=${this.pipeline}
    ></apex-grid>`;
  }

  public get stateController(): StateController<T> {
    return (this.grid as unknown as { stateController: StateController<T> }).stateController;
  }

  public ids(): number[] {
    return this.grid.pageItems.map((row) => (row as TestData).id);
  }

  public key(k: string): void {
    this.stateController.navigation.navigate(new KeyboardEvent('keydown', { key: k }));
  }

  public get body(): ApexVirtualizer {
    return this.grid.renderRoot.querySelector('apex-virtualizer') as ApexVirtualizer;
  }

  /** The pipeline run, its render, and the frames that start any FLIP. */
  public async flipped(): Promise<void> {
    await (this.grid as unknown as { pipelineSettled(): Promise<void> }).pipelineSettled();
    await settle(this.grid);
  }
}

/** A row FLIP as started: the record its row renders, and its vertical delta. */
interface Flip {
  id: number;
  dy: number;
}

/** Records every row FLIP started while installed, by wrapping `Element.animate`. */
function recordFlips(): { flips: Flip[]; restore: () => void } {
  const flips: Flip[] = [];
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (
    this: Element,
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions
  ) {
    if (typeof options === 'object' && options.id === 'apex-flip-y' && Array.isArray(keyframes)) {
      const match = /translate\([^,]+,\s*(-?[\d.]+)px\)/.exec(String(keyframes[0]?.transform));
      const record = (this as Element & { data?: TestData }).data;
      if (match && record) flips.push({ id: record.id, dy: Number(match[1]) });
    }
    return animate.call(this, keyframes, options);
  };
  return { flips, restore: () => (Element.prototype.animate = animate) };
}

/** Each FLIP's delta by record id. */
function byRecord(flips: ReadonlyArray<Flip>): Record<number, number> {
  return Object.fromEntries(flips.map(({ id, dy }) => [id, dy]));
}

function expectDeltas(flips: ReadonlyArray<Flip>, expected: Record<number, number>): void {
  const actual = byRecord(flips);
  expect(Object.keys(actual).map(Number).sort(), 'records that FLIP').to.deep.equal(
    Object.keys(expected).map(Number).sort()
  );
  for (const [id, dy] of Object.entries(expected)) {
    expect(actual[Number(id)], `record ${id}`).to.be.closeTo(dy, 1);
  }
}

const fx = new FlipFixture(data);
let recorder: ReturnType<typeof recordFlips>;

describe('Row FLIP deltas', () => {
  beforeEach(async () => {
    fx.pipeline = undefined;
    await fx.setUp();
    recorder = recordFlips();
  });
  afterEach(() => {
    recorder.restore();
    return fx.tearDown();
  });

  it('moveRow plays exact deltas on 36px rows', async () => {
    expect(fx.grid.moveRow(0, 2, 'after')).to.be.true;
    await fx.flipped();
    expect(fx.ids()).to.deep.equal([2, 3, 1, 4, 5, 6, 7, 8]);
    expectDeltas(recorder.flips, { 1: -72, 2: 36, 3: 36 });
  });

  it('a UI sort plays exact deltas on 36px rows', async () => {
    const column = fx.grid.columns.find((c) => c.key === 'id')!;
    void fx.stateController.sorting.sortFromUI(column, { direction: 'descending' });
    await fx.flipped();
    expect(fx.ids()).to.deep.equal([8, 7, 6, 5, 4, 3, 2, 1]);
    // Record k moves from index k - 1 to index 8 - k.
    expectDeltas(recorder.flips, Object.fromEntries(fx.ids().map((id) => [id, (2 * id - 9) * 36])));
  });

  it('three rapid grab moves start each FLIP where the row stands', async () => {
    fx.stateController.active = { column: 'id' as never, row: 0 };
    fx.key(' ');
    const moves: Flip[][] = [];
    for (let i = 0; i < 3; i++) {
      const from = recorder.flips.length;
      fx.key('ArrowDown');
      await (fx.grid as unknown as { pipelineSettled(): Promise<void> }).pipelineSettled();
      await nextFrame();
      moves.push(recorder.flips.slice(from));
    }
    await settle(fx.grid);
    expect(fx.ids()).to.deep.equal([2, 3, 4, 1, 5, 6, 7, 8]);

    // The record each move displaces moves up one row, from rest.
    moves.forEach((flips, i) => {
      expect(byRecord(flips)[i + 2], `move ${i + 1}, record ${i + 2}`).to.be.closeTo(36, 1);
    });
    // The first move starts the grabbed record from rest; each later one
    // replaces the running FLIP, so it starts where that FLIP had it: one row
    // further down, plus whatever of the earlier moves is still to play.
    expect(byRecord(moves[0])[1]).to.be.closeTo(-36, 1);
    for (const [i, flips] of moves.entries()) {
      const dy = byRecord(flips)[1];
      expect(dy, `move ${i + 1}, grabbed record`).to.be.at.most(-36 + 1);
      expect(dy, `move ${i + 1}, grabbed record`).to.be.at.least(-36 * (i + 1) - 1);
    }
  });

  /** Rebuilds the grid with a filter step that resolves 20ms after each run. */
  async function withAsyncPipeline(): Promise<void> {
    recorder.restore();
    fx.tearDown();
    fx.pipeline = {
      filter: async ({ data }) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return data;
      },
    };
    await fx.setUp();
    recorder = recordFlips();
  }

  it('moveRow plays exact deltas when the pipeline resolves after the update', async () => {
    await withAsyncPipeline();

    expect(fx.grid.moveRow(0, 2, 'after')).to.be.true;
    await fx.flipped();
    expect(fx.ids()).to.deep.equal([2, 3, 1, 4, 5, 6, 7, 8]);
    expectDeltas(recorder.flips, { 1: -72, 2: 36, 3: 36 });
  });

  // The sorted records reach the rows only once the body reports its range.
  // With that report late, only the wait on the body's render keeps the
  // "Last" rects from being measured on the unsorted rows.
  it('a UI sort plays exact deltas when the range report comes late', async () => {
    const restore = delayRangeReports(fx.body, 30);
    try {
      const column = fx.grid.columns.find((c) => c.key === 'id')!;
      await fx.stateController.sorting.sortFromUI(column, { direction: 'descending' });
    } finally {
      restore();
    }
    expect(fx.ids()).to.deep.equal([8, 7, 6, 5, 4, 3, 2, 1]);
    expectDeltas(recorder.flips, Object.fromEntries(fx.ids().map((id) => [id, (2 * id - 9) * 36])));
  });

  it('a drag swap plays exact deltas when the pipeline resolves after the update', async () => {
    await withAsyncPipeline();
    const rows = fx.grid.rows as unknown as HTMLElement[];
    const handle = rows[0].shadowRoot?.querySelector('[part="reorder-handle"]') as HTMLElement;
    const r0 = rows[0].getBoundingClientRect();
    const r2 = rows[2].getBoundingClientRect();
    const at = (type: string, clientY: number) =>
      new PointerEvent(type, {
        bubbles: true,
        composed: true,
        pointerId: 1,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: r0.left + 8,
        clientY,
      });

    handle.dispatchEvent(at('pointerdown', r0.top + 8));
    rows[0].dispatchEvent(at('pointermove', r2.top + r2.height * 0.75));
    await fx.flipped();
    rows[0].dispatchEvent(at('pointerup', r2.top + r2.height * 0.75));

    expect(fx.ids()).to.deep.equal([2, 3, 1, 4, 5, 6, 7, 8]);
    expectDeltas(recorder.flips, { 1: -72, 2: 36, 3: 36 });
  });
});
