import { expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
import { sendMouse, setViewport } from '@web/test-runner-commands';
import type { PropertyValues } from 'lit';
import { ApexGrid } from '../../src/components/grid.js';
import ApexGridRow from '../../src/components/row.js';
import ApexVirtualizer from '../../src/components/virtualizer.js';
import type { ActiveNode, ColumnConfiguration } from '../../src/internal/types.js';
import type { SortExpression } from '../../src/operations/sort/types.js';

/**
 * Row recycling benchmark (plan `plans/core/2026-10-27-row-recycling-plan.md`,
 * section 11.1). Manual only, never a CI gate on wall time:
 *
 *   npx wtr --config web-test-runner.bench.config.mjs
 *
 * Every scenario runs on a fresh grid, `REPEATS` times, for each column count
 * and row keying, and reports the median of each figure. Results print as one
 * `BENCH <json>` line per (columns, keying) and a closing `BENCH_TABLE`.
 *
 * Row counters come from a `MutationObserver` on `<apex-virtualizer>`, per
 * operation and counting row elements only (lit marker comments move too):
 * created = added and still attached at the end, removed = detached and not
 * re-added, moved = detached and re-added, transient = added then detached
 * within the same operation, kept = attached before and after, untouched.
 */

/** Number of times each scenario runs on a fresh fixture; the median is reported. */
const REPEATS = 3;
const COLUMN_COUNTS = [20, 100];
const MODES = ['item', 'spike'] as const;

const ROWS = 10_000;
const COLUMN_WIDTH = '90px';
const HOST_HEIGHT = '800px';
/**
 * The window the earlier baseline was measured in (the runner's default). The
 * upstream layout clips its viewport to the window, so this sets the range:
 * about 44 rows at the top, 73 mid-list.
 */
const VIEWPORT = { width: 800, height: 600 };

const SEED = 20261027;
const RANDOM_JUMPS = 40;
const STRIDES = [64, 128, 1000];
const STRIDE_JUMPS = 10;
/** Rows kept clear of both ends of the list for every jump target. */
const MARGIN = 200;
const FRAMES_AFTER_JUMP = 2;

const SCROLL_FRAMES = 300;
const SCROLL_STEP = 40;
const LONG_FRAME_MS = 20;
/**
 * A scroll frame counts as dropped when it lasts more than this many idle
 * frame intervals, so a single missed vsync shows at 60Hz and at 120Hz alike.
 */
const DROPPED_FRAME_FACTOR = 1.5;
/** Idle frames timed before the scenarios to measure the display cadence. */
const IDLE_FRAMES = 60;

const KEY_PRESSES = 50;
/** Row the keyboard scenario starts on: rendered and visible at the top. */
const KEY_START_ROW = 3;

type Mode = (typeof MODES)[number];
type Row = Record<string, string | number>;

type Internals = {
  scrollContainer: ApexVirtualizer;
  stateController: { active: ActiveNode<Row> };
  pipelineSettled(): Promise<void>;
};
const internals = (grid: ApexGrid<Row>) => grid as unknown as Internals;

/** The test-only keying switch on the virtualizer (P0 item 2). */
const keying = ApexVirtualizer as unknown as { rowKeying?: Mode };

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

/**
 * Median time between idle frames, measured once in `before`. Baselines taken
 * at different cadences (60Hz, 120Hz) are not comparable, so it is reported in
 * `BENCH_ENV`.
 */
let frameIntervalMs = Number.NaN;

async function measureFrameInterval() {
  const deltas: number[] = [];
  let last = await frame();
  for (let i = 0; i < IDLE_FRAMES; i++) {
    const now = await frame();
    deltas.push(now - last);
    last = now;
  }
  return median(deltas);
}

async function frames(count: number) {
  for (let i = 0; i < count; i++) await frame();
}

/** The bench's only output channel: the runner prints browser console lines. */
function report(line: string) {
  // biome-ignore lint/suspicious/noConsole: the results are the console output
  console.log(line);
}

function collectGarbage() {
  (globalThis as { gc?: () => void }).gc?.();
}

function median(values: number[]): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const round = (value: number) => Math.round(value * 10) / 10;

/** Seeded PRNG (mulberry32), so every run jumps to the same targets. */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const datasets = new Map<number, { data: Row[]; columns: ColumnConfiguration<Row>[] }>();

/**
 * Every third column holds a string `name <n>` with `n` a scrambled index (so
 * a sort by it reorders the whole list), the others numbers. Built once per
 * column count and shared by every fixture.
 */
function dataset(cols: number) {
  let set = datasets.get(cols);
  if (!set) {
    const columns: ColumnConfiguration<Row>[] = Array.from({ length: cols }, (_, k) => ({
      key: `c${k}`,
      type: k % 3 === 0 ? 'string' : 'number',
      width: COLUMN_WIDTH,
      sort: true,
    }));
    const data: Row[] = Array.from({ length: ROWS }, (_, i) => {
      const row: Row = {};
      for (let k = 0; k < cols; k++) {
        // 7919 is prime and coprime with ROWS, so this is a permutation.
        row[`c${k}`] =
          k % 3 === 0 ? `name ${(i * 7919 + k) % ROWS}` : ((i + 1) * (k * 131 + 17)) % 9973;
      }
      return row;
    });
    set = { data, columns };
    datasets.set(cols, set);
  }
  return set;
}

interface Bench {
  grid: ApexGrid<Row>;
  body: ApexVirtualizer;
  scroller: HTMLElement;
  /** Uniform row height, as the layout estimates it. */
  rowSize: number;
  /** Offset of the body's first row inside the scroller's content. */
  origin: number;
  counter: RowMutations;
}

async function settle(grid: ApexGrid<Row>) {
  await grid.updateComplete;
  await internals(grid).scrollContainer.settled();
  await frames(2);
}

/** Fails when the keying switch did not reach the virtualizer, so a missing hook cannot benchmark item keys twice. */
function assertKeying(body: ApexVirtualizer, mode: Mode) {
  const item = {};
  const key = body.keyFunction?.(item, 130);
  if (mode === 'item') {
    expect(key, 'item mode keys rows by their record').to.equal(item);
  } else {
    expect(
      key,
      'spike mode keys rows by index % 128 (is ApexVirtualizer.rowKeying wired?)'
    ).to.equal(2);
  }
}

async function mount(cols: number, mode: Mode): Promise<Bench> {
  const { data, columns } = dataset(cols);
  keying.rowKeying = mode;

  const parentNode = document.createElement('div');
  parentNode.style.height = HOST_HEIGHT;
  const grid = await fixture<ApexGrid<Row>>(
    html`<apex-grid
      .data=${data.slice()}
      .columns=${columns}
      .sortConfiguration=${{ multiple: false, triState: true }}
    ></apex-grid>`,
    { parentNode }
  );
  await settle(grid);

  const body = internals(grid).scrollContainer;
  assertKeying(body, mode);

  // The grid host owns vertical scrolling (`scroller = false` on the body).
  const scroller = grid as HTMLElement;
  expect(scroller.scrollHeight, 'the grid host scrolls').to.be.greaterThan(scroller.clientHeight);
  const rowSize = body.offsetHeight / ROWS;
  expect(rowSize, 'row size').to.be.greaterThan(0);
  const origin =
    body.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top -
    scroller.clientTop +
    scroller.scrollTop;

  return { grid, body, scroller, rowSize, origin, counter: new RowMutations(body) };
}

async function unmount(bench: Bench) {
  bench.counter.disconnect();
  await fixtureCleanup();
  collectGarbage();
  await frames(2);
}

/** Mounts a fresh fixture, runs `scenario` on it and tears it down. */
async function onFresh<R>(cols: number, mode: Mode, scenario: (bench: Bench) => Promise<R>) {
  const bench = await mount(cols, mode);
  try {
    return await scenario(bench);
  } finally {
    await unmount(bench);
  }
}

// ---------------------------------------------------------------------------
// Row counters
// ---------------------------------------------------------------------------

interface OpCounts {
  created: number;
  removed: number;
  moved: number;
  transient: number;
  kept: number;
  /** Rows rendered after the operation. */
  range: number;
}

const isRow = (node: Node): node is ApexGridRow<Row> =>
  node.nodeType === Node.ELEMENT_NODE &&
  (node as Element).localName === ApexGridRow.tagName.toLowerCase();

const renderedRows = (body: Element) => Array.from(body.children).filter(isRow);

class RowMutations {
  readonly #body: Element;
  readonly #observer: MutationObserver;
  #records: MutationRecord[] = [];
  #before = new Set<Element>();

  constructor(body: Element) {
    this.#body = body;
    this.#observer = new MutationObserver((records) => this.#records.push(...records));
    this.#observer.observe(body, { childList: true });
  }

  /** Marks the start of an operation, dropping anything recorded before it. */
  public start() {
    this.#observer.takeRecords();
    this.#records = [];
    this.#before = new Set(renderedRows(this.#body));
  }

  /** Classifies every row mutation since `start()`. */
  public take(): OpCounts {
    const records = [...this.#records, ...this.#observer.takeRecords()];
    this.#records = [];
    // First and last thing that happened to each row element in this operation.
    const seen = new Map<Node, { first: 'add' | 'remove'; last: 'add' | 'remove' }>();
    const note = (node: Node, event: 'add' | 'remove') => {
      if (!isRow(node)) return;
      const entry = seen.get(node);
      if (entry) entry.last = event;
      else seen.set(node, { first: event, last: event });
    };
    for (const record of records) {
      // A record that both removes and adds (a replace) removes first.
      for (const node of record.removedNodes) note(node, 'remove');
      for (const node of record.addedNodes) note(node, 'add');
    }

    const counts: OpCounts = { created: 0, removed: 0, moved: 0, transient: 0, kept: 0, range: 0 };
    for (const { first, last } of seen.values()) {
      if (first === 'add') counts[last === 'add' ? 'created' : 'transient']++;
      else counts[last === 'add' ? 'moved' : 'removed']++;
    }
    const after = renderedRows(this.#body);
    counts.range = after.length;
    counts.kept = after.filter((row) => this.#before.has(row) && !seen.has(row)).length;
    return counts;
  }

  public disconnect() {
    this.#observer.disconnect();
  }
}

const COUNT_KEYS = ['created', 'removed', 'moved', 'transient', 'kept', 'range'] as const;

/** Median per operation and total, for each counter. */
function summarizeCounts(ops: OpCounts[]) {
  const summary: Record<string, { perOp: number; total: number }> = {};
  for (const key of COUNT_KEYS) {
    const values = ops.map((op) => op[key]);
    summary[key] = { perOp: median(values), total: values.reduce((a, b) => a + b, 0) };
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

interface JumpRun {
  ms: number;
  msPerOp: number;
  /** Jumps whose target row was still not rendered after the wait. */
  missed: number;
  /** Stride runs only: times the walk turned back at the end of the list. */
  reversals: number;
  counts: ReturnType<typeof summarizeCounts>;
}

/** Jumps to each target in turn, timing the scroll plus `FRAMES_AFTER_JUMP` frames. */
async function jumps(bench: Bench, start: number | null, targets: number[]): Promise<JumpRun> {
  const { body, scroller, rowSize, origin, counter } = bench;
  if (start !== null) {
    scroller.scrollTop = origin + start * rowSize;
    await settle(bench.grid);
  }

  const ops: OpCounts[] = [];
  const times: number[] = [];
  let missed = 0;
  for (const target of targets) {
    counter.start();
    const t0 = performance.now();
    scroller.scrollTop = origin + target * rowSize;
    await frames(FRAMES_AFTER_JUMP);
    times.push(performance.now() - t0);
    ops.push(counter.take());
    if (!body.isRendered(target)) missed++;
  }
  return {
    ms: times.reduce((a, b) => a + b, 0),
    msPerOp: median(times),
    missed,
    reversals: 0,
    counts: summarizeCounts(ops),
  };
}

function randomTargets(): number[] {
  const random = mulberry32(SEED);
  const span = ROWS - 2 * MARGIN;
  return Array.from({ length: RANDOM_JUMPS }, () => MARGIN + Math.floor(random() * span));
}

/**
 * Start row and `STRIDE_JUMPS` targets each exactly `stride` rows from the
 * last. A walk that fits is centred mid-list; a longer one (+1000) starts at
 * the margin and turns back at the end of the list, so every jump still moves
 * by the stride.
 */
function strideWalk(stride: number) {
  const span = STRIDE_JUMPS * stride;
  const fits = span <= ROWS - 2 * MARGIN;
  const start = fits ? Math.floor((ROWS - span) / 2) : MARGIN;
  const targets: number[] = [];
  let position = start;
  let direction = 1;
  let reversals = 0;
  for (let i = 0; i < STRIDE_JUMPS; i++) {
    const next = position + direction * stride;
    if (next > ROWS - MARGIN || next < MARGIN) {
      direction = -direction;
      reversals++;
    }
    position += direction * stride;
    targets.push(position);
  }
  return { start, targets, reversals };
}

const SORTS: SortExpression<Row>[] = [
  { key: 'c0', direction: 'ascending' },
  { key: 'c1', direction: 'descending' },
  { key: 'c0', direction: 'descending' },
  { key: 'c1', direction: 'ascending' },
  { key: 'c2', direction: 'ascending' },
  { key: 'c2', direction: 'descending' },
];

async function sorts(bench: Bench) {
  const { grid, counter } = bench;
  const ops: OpCounts[] = [];
  const times: number[] = [];
  for (const expression of SORTS) {
    counter.start();
    const t0 = performance.now();
    // `grid.sort` adds to the current sort; clearing first makes each one a
    // single-key sort that reorders the whole list.
    grid.clearSort();
    grid.sort(expression);
    await internals(grid).pipelineSettled();
    await grid.updateComplete;
    await frame();
    times.push(performance.now() - t0);
    ops.push(counter.take());
    // Untimed: the rows on screen show the sorted records, so the timed
    // window covered the whole render.
    const items = grid.pageItems;
    const stale = renderedRows(bench.body).filter((row) => row.data !== items[row.index]);
    expect(stale.length, `rows showing stale records after sorting by ${expression.key}`).to.equal(
      0
    );
  }
  return {
    ms: times.reduce((a, b) => a + b, 0),
    msPerOp: median(times),
    counts: summarizeCounts(ops),
  };
}

/** Scrolls `SCROLL_STEP` px per frame and records the time between frames. */
async function smoothScroll(bench: Bench) {
  const { scroller, counter } = bench;
  counter.start();
  const deltas = await new Promise<number[]>((resolve) => {
    const out: number[] = [];
    let last = 0;
    const step = (timestamp: number) => {
      if (last) out.push(timestamp - last);
      last = timestamp;
      if (out.length === SCROLL_FRAMES) return resolve(out);
      scroller.scrollTop += SCROLL_STEP;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  const counts = counter.take();
  return {
    longFrames: deltas.filter((ms) => ms > LONG_FRAME_MS).length,
    droppedFrames: deltas.filter((ms) => ms > DROPPED_FRAME_FACTOR * frameIntervalMs).length,
    medianMs: median(deltas),
    p95Ms: percentile(deltas, 95),
    // The whole scroll is one counted operation, so most rows enter and leave
    // inside it (transient): count those as both created and removed.
    created: counts.created + counts.transient,
    removed: counts.removed + counts.transient,
    moved: counts.moved,
    kept: counts.kept,
  };
}

/** The focused element at the bottom of the shadow-root chain. */
function deepActiveElement(): Element | null {
  let active: Element | null = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

function rowAt(body: ApexVirtualizer, index: number) {
  return renderedRows(body).find((row) => row.index === index);
}

type Updatable = { update(changed: PropertyValues): void };

async function arrowDown(bench: Bench) {
  const { grid, body, counter } = bench;
  const state = internals(grid).stateController;

  const start = rowAt(body, KEY_START_ROW);
  expect(start, 'start row rendered').to.exist;
  const cell = start!.cells[1];
  const rect = cell.getBoundingClientRect();
  await sendMouse({
    type: 'click',
    position: [Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2)],
  });
  await settle(grid);
  expect(state.active.row, 'the click activates the start row').to.equal(KEY_START_ROW);

  // Lifecycle callbacks are cached at define time, but `update` is a plain
  // method lookup, so patching the prototype counts every row render.
  const proto = ApexGridRow.prototype as unknown as Updatable;
  const original = proto.update;
  let updates = 0;
  proto.update = function (this: Updatable, changed: PropertyValues) {
    updates++;
    return original.call(this, changed);
  };

  const times: number[] = [];
  const rowUpdates: number[] = [];
  const ops: OpCounts[] = [];
  try {
    for (let i = 0; i < KEY_PRESSES; i++) {
      const from = state.active.row;
      const target = deepActiveElement();
      expect(target, 'a focused element inside the grid').to.exist;
      updates = 0;
      counter.start();
      const t0 = performance.now();
      target!.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          bubbles: true,
          composed: true,
          cancelable: true,
        })
      );
      await grid.updateComplete;
      await body.updateComplete;
      await rowAt(body, from + 1)?.updateComplete;
      times.push(performance.now() - t0);
      // A frame for focus to follow the active cell before the next key.
      await frame();
      rowUpdates.push(updates);
      ops.push(counter.take());
      expect(state.active.row, `ArrowDown ${i + 1} advances the active row`).to.equal(from + 1);
    }
  } finally {
    proto.update = original;
  }

  return {
    msPerKey: median(times),
    rowUpdatesPerKey: median(rowUpdates),
    counts: summarizeCounts(ops),
  };
}

// ---------------------------------------------------------------------------
// Aggregation and output
// ---------------------------------------------------------------------------

/** Element-wise median across repeats of a JSON-shaped result. */
function medianOfRuns<T>(runs: T[]): T {
  const first = runs[0] as unknown;
  if (typeof first === 'number') return round(median(runs as number[])) as T;
  if (first && typeof first === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(first)) {
      out[key] = medianOfRuns(runs.map((run) => (run as Record<string, unknown>)[key]));
    }
    return out as T;
  }
  return first as T;
}

async function repeat<R>(cols: number, mode: Mode, scenario: (bench: Bench) => Promise<R>) {
  const runs: R[] = [];
  for (let i = 0; i < REPEATS; i++) runs.push(await onFresh(cols, mode, scenario));
  return medianOfRuns(runs);
}

type Result = Awaited<ReturnType<typeof runAll>>;

async function runAll(cols: number, mode: Mode) {
  const random = await repeat(cols, mode, (bench) => jumps(bench, null, randomTargets()));
  const strides: Record<string, JumpRun> = {};
  for (const stride of STRIDES) {
    const walk = strideWalk(stride);
    strides[`+${stride}`] = await repeat(cols, mode, async (bench) => ({
      ...(await jumps(bench, walk.start, walk.targets)),
      reversals: walk.reversals,
    }));
  }
  return {
    cols,
    mode,
    repeats: REPEATS,
    jumps: { random, strides },
    sorts: await repeat(cols, mode, sorts),
    scroll: await repeat(cols, mode, smoothScroll),
    keys: await repeat(cols, mode, arrowDown),
  };
}

const results: Result[] = [];

function table(rows: Result[]): string {
  const header = [
    'cols',
    'keys',
    `random x${RANDOM_JUMPS} ms`,
    ...STRIDES.map((s) => `+${s} x${STRIDE_JUMPS} ms`),
    'random created/moved/kept per op',
    `sorts x${SORTS.length} ms`,
    'sort created/moved/kept per op',
    `scroll frames > ${LONG_FRAME_MS}ms`,
    `scroll frames > ${DROPPED_FRAME_FACTOR}x interval`,
    'scroll median / p95 ms',
    'ms per key',
    'row updates per key',
  ];
  const perOp = (counts: ReturnType<typeof summarizeCounts>) =>
    `${counts.created.perOp} / ${counts.moved.perOp} / ${counts.kept.perOp}`;
  const lines = rows.map((r) =>
    [
      r.cols,
      r.mode,
      r.jumps.random.ms,
      ...STRIDES.map((s) => r.jumps.strides[`+${s}`].ms),
      perOp(r.jumps.random.counts),
      r.sorts.ms,
      perOp(r.sorts.counts),
      r.scroll.longFrames,
      r.scroll.droppedFrames,
      `${r.scroll.medianMs} / ${r.scroll.p95Ms}`,
      r.keys.msPerKey,
      r.keys.rowUpdatesPerKey,
    ].join(' | ')
  );
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...lines.map((line) => `| ${line} |`),
  ].join('\n');
}

describe('row recycling benchmark', () => {
  const initialKeying = keying.rowKeying;

  before(async () => {
    ApexGrid.register();
    await setViewport(VIEWPORT);
    frameIntervalMs = await measureFrameInterval();
    report(
      `BENCH_ENV ${JSON.stringify({
        userAgent: navigator.userAgent,
        viewport: VIEWPORT,
        frameIntervalMs: round(frameIntervalMs),
        gc: typeof (globalThis as { gc?: unknown }).gc === 'function',
        rows: ROWS,
        hostHeight: HOST_HEIGHT,
        columnWidth: COLUMN_WIDTH,
        repeats: REPEATS,
        seed: SEED,
      })}`
    );
    // Warm-up, untimed: the first grid on the page pays for compilation.
    await onFresh(COLUMN_COUNTS[0], 'item', async (bench) => {
      await jumps(bench, null, randomTargets().slice(0, 10));
      await sorts(bench);
    });
  });

  after(() => {
    keying.rowKeying = initialKeying;
    if (results.length) report(`BENCH_TABLE\n${table(results)}`);
  });

  for (const cols of COLUMN_COUNTS) {
    for (const mode of MODES) {
      it(`${cols} columns, ${mode} keys`, async () => {
        const result = await runAll(cols, mode);
        results.push(result);
        report(`BENCH ${JSON.stringify(result)}`);
      });
    }
  }
});
