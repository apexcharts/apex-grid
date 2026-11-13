import { expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
import { LitElement } from 'lit';
import type ApexGridCellChart from '../src/components/chart-cell.js';
import {
  type ApexChartsInstanceLike,
  type ChartCellState,
  setApexCharts,
} from '../src/components/chart-cell.js';
import { ApexGrid } from '../src/components/grid.js';
import type { ColumnConfiguration } from '../src/internal/types.js';
import { required } from '../src/internal/validators.js';
import { settle } from './utils/settle.js';

// Row recycling moves the rows that left the range to its other end. A moved
// row's elements are disconnected and reconnected, and they must hold the
// record they are about to show by then: a cell element that builds itself
// in connectedCallback otherwise builds for the row it is leaving.
// GitHub issue #39. Every grid sets `rowRecycling` itself, so these run in
// both suite groups.

interface Row {
  id: number;
  name: string;
  trend: number[] | null;
}

/** Row `id`'s trend starts at `id`; every fourth row has none. */
const records = (count: number): Row[] =>
  Array.from({ length: count }, (_, id) => ({
    id,
    name: `Row ${id}`,
    trend: id % 4 === 3 ? null : [id, id + 3, id + 1, id + 6],
  }));

/** The issue's probe: counts connects that saw a record about to change. */
const log = { connects: 0, disconnects: 0, moves: 0, connectedWithPreviousRecord: 0 };

class RecordProbe extends HTMLElement {
  #record: unknown;

  public set record(record: unknown) {
    this.#record = record;
  }

  public get record(): unknown {
    return this.#record;
  }

  public connectedCallback(): void {
    log.connects++;
    const atConnect = this.#record;
    queueMicrotask(() => {
      if (this.#record !== atConnect) log.connectedWithPreviousRecord++;
    });
  }

  public disconnectedCallback(): void {
    log.disconnects++;
    queueMicrotask(() => {
      if (this.isConnected) log.moves++;
    });
  }
}
customElements.define('recycle-order-probe', RecordProbe);

/** Renders that ran outside the element's own `scheduleUpdate`. */
const lazy = { renders: 0, unscheduled: 0 };

/** A Lit element that renders a frame after its update is requested. */
class LazyProbe extends LitElement {
  static override properties = { record: { attribute: false } };
  declare record: unknown;
  #scheduled = false;

  protected override async scheduleUpdate(): Promise<void> {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    this.#scheduled = true;
    try {
      super.scheduleUpdate();
    } finally {
      this.#scheduled = false;
    }
  }

  protected override render() {
    lazy.renders++;
    if (!this.#scheduled) lazy.unscheduled++;
    return html`${(this.record as Row | undefined)?.id}`;
  }
}
customElements.define('recycle-order-lazy', LazyProbe);

/** Walks up through shadow roots to the row element that renders `node`. */
function rowOf(node: Node): (Element & { data: Row }) | null {
  let current: Node | null = node;
  while (current) {
    if (current instanceof Element && current.localName === 'apex-grid-row') {
      return current as Element & { data: Row };
    }
    current = current.parentNode ?? (current as ShadowRoot).host ?? null;
  }
  return null;
}

/** Charts built, each with the record its row showed at that moment. */
const builds: { drew: number; rowShows: number | undefined }[] = [];

/** A stand-in ApexCharts that records which row each chart was built for. */
class RecordingCharts implements ApexChartsInstanceLike {
  public series: unknown[];

  constructor(element: HTMLElement, options: { series: unknown[] }) {
    this.series = options.series;
    builds.push({ drew: firstPoint(options.series), rowShows: rowOf(element)?.data?.id });
  }

  public render(): Promise<unknown> {
    return Promise.resolve();
  }

  public updateSeries(series: unknown[]): void {
    this.series = series;
  }

  public updateOptions(options: { series: unknown[] }): void {
    this.series = options.series;
  }

  public destroy(): void {}
}

function firstPoint(series: unknown[]): number {
  return (series[0] as { data: number[] }).data[0];
}

async function mount(columns: ColumnConfiguration<Row>[], count: number): Promise<ApexGrid<Row>> {
  ApexGrid.register();
  const host = document.createElement('div');
  host.style.height = '400px';
  host.style.width = '600px';
  const grid = await fixture<ApexGrid<Row>>(
    html`<apex-grid .rowRecycling=${true} .data=${records(count)} .columns=${columns}></apex-grid>`,
    { parentNode: host }
  );
  await settle(grid);
  return grid;
}

/** One scroll step per frame, the way a wheel or a drag scrolls. */
async function scrollThrough(grid: ApexGrid<Row>, to: number, step: number): Promise<void> {
  const down = to > grid.scrollTop;
  for (let y = grid.scrollTop; down ? y < to : y > to; y += down ? step : -step) {
    grid.scrollTop = y;
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  }
  grid.scrollTop = to;
  await settle(grid);
}

function deepActiveElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

function deepAll(root: Node, out: Element[] = []): Element[] {
  if (root instanceof Element) out.push(root);
  const shadow = (root as Element).shadowRoot;
  if (shadow) deepAll(shadow, out);
  for (const child of Array.from((root as ParentNode).children ?? [])) deepAll(child, out);
  return out;
}

describe('Row recycling: a moved row holds its new record before it reconnects', function () {
  this.timeout(30000);

  afterEach(() => fixtureCleanup());

  it('a cell element never connects with the record of the row it is leaving', async () => {
    const grid = await mount(
      [
        { key: 'id', type: 'number' },
        {
          key: 'name',
          cellTemplate: (ctx) =>
            html`<recycle-order-probe .record=${ctx.data}></recycle-order-probe>`,
        },
      ],
      600
    );
    Object.assign(log, { connects: 0, disconnects: 0, moves: 0, connectedWithPreviousRecord: 0 });

    await scrollThrough(grid, grid.scrollHeight, 120);
    await scrollThrough(grid, 0, 120);

    // The scroll recycled rows, by moving them rather than rebuilding them.
    expect(log.moves, 'moves').to.be.greaterThan(100);
    expect(log.connectedWithPreviousRecord, JSON.stringify(log)).to.equal(0);
    // Every probe on the page shows its row's record.
    for (const probe of deepAll(grid).filter((el) => el.localName === 'recycle-order-probe')) {
      expect((probe as RecordProbe).record).to.equal(rowOf(probe)?.data);
    }
  });

  it('an open edit scrolled away and back a step at a time takes focus back', async () => {
    // The row that brings the edited record back renders it before it moves,
    // and the editor it resumes keeps the focus it takes across the move.
    const grid = await mount(
      [
        { key: 'id', type: 'number' },
        { key: 'name', editable: true, validators: [required()] },
      ],
      600
    );
    grid.editing = { enabled: true, mode: 'cell' };
    await settle(grid);
    const editorAt = (index: number) =>
      deepAll(grid)
        .filter((el) => el.localName === 'apex-grid-row')
        .map((row) => row as Element & { index: number; shadowRoot: ShadowRoot })
        .find((row) => row.index === index)
        ?.shadowRoot.querySelector('apex-grid-cell[data-cell-type="string"]')
        ?.shadowRoot?.querySelector<HTMLInputElement>('input[data-apex-editor]') ?? null;

    await grid.editCell(3, 'name');
    await settle(grid);
    const input = editorAt(3)!;
    // An empty name fails `required`, so the edit stays open off screen.
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(deepActiveElement(), 'editing').to.equal(input);

    const step = deepAll(grid)
      .find((el) => el.localName === 'apex-grid-row')!
      .getBoundingClientRect().height;
    await scrollThrough(grid, step * 80, step);
    expect(editorAt(3), 'scrolled away').to.equal(null);
    expect(grid.editingCell, 'the rejected edit stays open').to.not.equal(null);
    await scrollThrough(grid, 0, step);

    const resumed = editorAt(3);
    expect(resumed, 'the editor is back').to.not.equal(null);
    expect(deepActiveElement(), 'and has focus').to.equal(resumed);
  });

  it('an open edit brought back through a spare row takes focus back', async () => {
    // A jump to the end shrinks the range and sets rows aside as spares; a
    // jump back that overlaps it brings the edited record back in one. The
    // spare renders it detached, where focus is a no-op, so its cell takes
    // the focus once inserted.
    const grid = await mount(
      [
        { key: 'id', type: 'number' },
        { key: 'name', editable: true, validators: [required()] },
      ],
      600
    );
    grid.editing = { enabled: true, mode: 'cell' };
    await settle(grid);
    const rowsNow = () =>
      deepAll(grid)
        .filter((el) => el.localName === 'apex-grid-row')
        .map((row) => row as Element & { index: number; shadowRoot: ShadowRoot })
        .sort((a, b) => a.index - b.index);
    const editorAt = (index: number) =>
      rowsNow()
        .find((row) => row.index === index)
        ?.shadowRoot.querySelector('apex-grid-cell[data-cell-type="string"]')
        ?.shadowRoot?.querySelector<HTMLInputElement>('input[data-apex-editor]') ?? null;

    for (const back of [0, 1, 2, 3]) {
      grid.scrollTop = grid.scrollHeight / 2;
      await settle(grid);
      const box = grid.getBoundingClientRect();
      const rows = rowsNow();
      const visible = rows.filter((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top >= box.top && rect.bottom <= box.bottom;
      });
      const index = visible[visible.length - 1 - back].index;
      await grid.editCell(index, 'name');
      await settle(grid);
      const start = grid.scrollTop;
      const input = editorAt(index)!;
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      grid.scrollTop = grid.scrollHeight;
      await settle(grid);
      expect(editorAt(index), `${index} scrolled away`).to.equal(null);
      expect(rowsNow().length, 'the range shrank').to.be.lessThan(rows.length);
      grid.scrollTop = start - rows[0].getBoundingClientRect().height * 4 * (back + 1);
      await settle(grid);

      const resumed = editorAt(index);
      expect(resumed, `${index} is back`).to.not.equal(null);
      expect(deepActiveElement(), `${index} has focus`).to.equal(resumed);
      grid.cancelEdit();
      await settle(grid);
    }
  });

  it('a Lit element with its own update schedule keeps it', async () => {
    // Rendering a moved row before the move runs the Lit updates it sets
    // off at once, except in an element that schedules its own.
    const grid = await mount(
      [
        { key: 'id', type: 'number' },
        {
          key: 'name',
          cellTemplate: (ctx) =>
            html`<recycle-order-lazy .record=${ctx.data}></recycle-order-lazy>`,
        },
      ],
      300
    );
    Object.assign(lazy, { renders: 0, unscheduled: 0 });

    await scrollThrough(grid, grid.scrollHeight, 120);
    await scrollThrough(grid, 0, 120);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await settle(grid);

    expect(lazy.renders, 'renders').to.be.greaterThan(100);
    expect(lazy.unscheduled, 'renders outside its schedule').to.equal(0);
    for (const probe of deepAll(grid).filter((el) => el.localName === 'recycle-order-lazy')) {
      expect((probe as LazyProbe).record).to.equal(rowOf(probe)?.data);
      expect(probe.shadowRoot?.textContent?.trim()).to.equal(String(rowOf(probe)?.data.id));
    }
  });

  it("a type: 'chart' cell never builds its chart for another row", async () => {
    setApexCharts(RecordingCharts as never);
    const grid = await mount(
      [
        { key: 'id', type: 'number' },
        { key: 'trend', type: 'chart' },
      ],
      300
    );
    builds.length = 0;

    await scrollThrough(grid, grid.scrollHeight, 120);
    await scrollThrough(grid, 0, 120);

    // Rows without a trend drop their chart element, so the scroll builds new ones.
    expect(builds.length, 'charts built').to.be.greaterThan(0);
    expect(builds.filter((build) => build.drew !== build.rowShows)).to.eql([]);
    // And each chart left on the page draws its own row.
    const cells = deepAll(grid).filter(
      (el): el is ApexGridCellChart => el.localName === 'apex-grid-cell-chart'
    );
    expect(cells.length).to.be.greaterThan(0);
    for (const cell of cells) {
      const state = cell.state as ChartCellState;
      const chart = cell.chart as RecordingCharts;
      expect(firstPoint(chart.series), 'drawn').to.equal(rowOf(cell)?.data.id);
      expect(firstPoint(state.series), 'state').to.equal(rowOf(cell)?.data.id);
    }
  });
});
