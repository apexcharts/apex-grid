import { elementUpdated, expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ReactiveController } from 'lit';
import { ApexGrid } from '../src/components/grid.js';
import ApexGridRow from '../src/components/row.js';
import type { GridDOMController } from '../src/controllers/dom.js';
import { StateController } from '../src/controllers/state.js';
import { PIPELINE } from '../src/internal/constants.js';
import type {
  CellDecoration,
  CellDecorator,
  GridFeatureModule,
  RowTransformer,
} from '../src/internal/feature-module.js';
import type { ColumnConfiguration } from '../src/internal/types.js';
import data, { type TestData } from './utils/test-data.js';

function stateOf<T extends object>(grid: ApexGrid<T>): StateController<T> {
  return (grid as unknown as { stateController: StateController<T> }).stateController;
}

function domOf<T extends object>(grid: ApexGrid<T>): GridDOMController<T> {
  return (grid as unknown as { DOM: GridDOMController<T> }).DOM;
}

function virtualizerItems(grid: ApexGrid<any>): unknown {
  return (grid.renderRoot.querySelector('apex-virtualizer') as unknown as { items: unknown }).items;
}

/** Waits for a pipeline run and the render that follows it. */
async function settle(grid: HTMLElement & { updateComplete: Promise<boolean> }) {
  await grid.updateComplete;
  await (grid as unknown as { pipelineSettled(): Promise<void> }).pipelineSettled();
  await nextFrame();
  await grid.updateComplete;
}

/** The body rows the view should hold: the view minus pins, then the page. */
function expectedPage(grid: ApexGrid<TestData>): TestData[] {
  const rowPin = stateOf(grid).rowPin;
  const body = grid.dataView.filter((row) => !rowPin.isPinned(row));
  if (!grid.pagination?.enabled) return body;
  const start = grid.page * grid.pageSize;
  return body.slice(start, start + grid.pageSize);
}

const columns: ColumnConfiguration<TestData>[] = [
  { key: 'id' },
  { key: 'name' },
  { key: 'active' },
  { key: 'importance' },
];

describe('Render path: display columns', () => {
  before(() => ApexGrid.register());
  afterEach(() => fixtureCleanup());

  type Wide = Record<string, number>;
  const COLS = 20;
  const ROWS = 2000;

  it('a scroll step re-renders only the rows that scrolled in', async () => {
    const wide: Wide[] = Array.from({ length: ROWS }, (_, r) => {
      const row: Wide = {};
      for (let c = 0; c < COLS; c++) row[`c${c}`] = r * COLS + c;
      return row;
    });
    const wideColumns = Array.from(
      { length: COLS },
      (_, c) => ({ key: `c${c}`, width: '80px' }) as ColumnConfiguration<Wide>
    );
    const parent = document.createElement('div');
    parent.style.height = '800px';
    const grid = await fixture<ApexGrid<Wide>>(
      html`<apex-grid .data=${wide} .columns=${wideColumns}></apex-grid>`,
      { parentNode: parent }
    );
    await elementUpdated(grid);
    const rowsOf = () => grid.rows as unknown as ApexGridRow<Wide>[];
    for (let i = 0; i < 10 && rowsOf().length === 0; i++) await nextFrame();

    const proto = ApexGridRow.prototype as unknown as {
      update: (changed: Map<PropertyKey, unknown>) => void;
    };
    const original = proto.update;
    const rendered = new Set<ApexGridRow<Wide>>();
    proto.update = function (this: ApexGridRow<Wide>, changed: Map<PropertyKey, unknown>) {
      rendered.add(this);
      return original.call(this, changed);
    };
    const before = new Map(rowsOf().map((row) => [row, row.data]));
    expect(before.size).to.be.greaterThan(10);
    try {
      for (let step = 0; step < 10; step++) {
        grid.scrollTop += 37;
        for (let i = 0; i < 3; i++) await nextFrame();
      }
      await elementUpdated(grid);
    } finally {
      proto.update = original;
    }

    const stable = rowsOf().filter((row) => before.get(row) === row.data);
    const scrolledIn = rowsOf().filter((row) => before.get(row) !== row.data);
    expect(scrolledIn.length, 'the scroll changed the rendered range').to.be.greaterThan(0);
    expect(stable.length).to.be.greaterThan(10);
    expect(
      stable.filter((row) => rendered.has(row)).length,
      'rows that stayed in range re-rendered'
    ).to.equal(0);
    // Every rendered row still shows every column.
    expect(scrolledIn[0].shadowRoot!.querySelectorAll('apex-grid-cell').length).to.equal(COLS);
  });

  it('resolves the display columns once per host update', async () => {
    const grid = await fixture<ApexGrid<TestData>>(
      html`<apex-grid .data=${data} .columns=${columns.map((c) => ({ ...c }))}></apex-grid>`
    );
    await settle(grid);
    // The first rows can wait on a resize observation under load.
    for (let i = 0; i < 10 && grid.rows.length === 0; i++) await nextFrame();
    const first = domOf(grid).displayColumns;
    expect(domOf(grid).displayColumns, 'two reads').to.equal(first);
    const rowOf = () => grid.rows[0] as unknown as ApexGridRow<TestData>;
    expect(rowOf().columns).to.equal(first);
    // A host update hands the rows a new array, which is what re-renders them
    // for state they read in render (selection, expansion).
    grid.requestUpdate();
    await grid.updateComplete;
    expect(domOf(grid).displayColumns).to.not.equal(first);
    expect(rowOf().columns).to.equal(domOf(grid).displayColumns);
  });

  it('resolves a new array when the order, a pin or a hidden flag changes', async () => {
    const grid = await fixture<ApexGrid<TestData>>(
      html`<apex-grid .data=${data} .columns=${columns.map((c) => ({ ...c }))}></apex-grid>`
    );
    await settle(grid);
    const dom = domOf(grid);
    const keys = () => dom.displayColumns.map((c) => c.key);
    const cellsOf = () =>
      (grid.rows[0] as unknown as ApexGridRow<TestData>).shadowRoot!.querySelectorAll(
        'apex-grid-cell'
      );

    // Pinning the first column keeps the order: only the pinned flag moves.
    let previous = dom.displayColumns;
    await grid.pinColumn('id', 'start');
    await grid.updateComplete;
    expect(dom.displayColumns).to.not.equal(previous);
    expect(keys()).to.deep.equal(['id', 'name', 'active', 'importance']);
    expect(cellsOf()[0].getAttribute('data-pinned')).to.equal('start');

    previous = dom.displayColumns;
    await grid.pinColumn('importance', 'start');
    await grid.updateComplete;
    expect(dom.displayColumns).to.not.equal(previous);
    expect(keys()).to.deep.equal(['id', 'importance', 'name', 'active']);

    // A flag set in place, then a plain update, still reaches the rows.
    previous = dom.displayColumns;
    grid.columns.find((c) => c.key === 'name')!.hidden = true;
    grid.requestUpdate();
    await grid.updateComplete;
    await nextFrame();
    expect(dom.displayColumns).to.not.equal(previous);
    expect(cellsOf().length).to.equal(3);

    previous = dom.displayColumns;
    grid.columns = [...grid.columns, { key: 'extra' as keyof TestData }];
    await grid.updateComplete;
    expect(dom.displayColumns).to.not.equal(previous);
    expect(keys()).to.include('extra');
  });
});

describe('Render path: pageItems', () => {
  before(() => ApexGrid.register());
  afterEach(() => fixtureCleanup());

  async function mount(props: { pagination?: ApexGrid<TestData>['pagination'] } = {}) {
    const grid = await fixture<ApexGrid<TestData>>(
      html`<apex-grid
        .data=${data.map((row) => ({ ...row }))}
        .columns=${columns}
        .rowPinning=${{ enabled: true }}
        .pagination=${props.pagination}
      ></apex-grid>`
    );
    await settle(grid);
    return grid;
  }

  it('keeps its identity across updates with a pinned row', async () => {
    const grid = await mount();
    grid.pinRow(grid.data[1], 'top');
    await grid.updateComplete;
    const items = grid.pageItems;
    const vzItems = virtualizerItems(grid);
    expect(grid.pageItems, 'two reads').to.equal(items);
    for (let i = 0; i < 3; i++) {
      stateOf(grid).active = { column: 'name', row: i };
      await grid.updateComplete;
    }
    expect(grid.pageItems, 'after updates').to.equal(items);
    expect(virtualizerItems(grid), 'virtualizer items').to.equal(vzItems);
    expect([...items]).to.deep.equal(expectedPage(grid));
  });

  it('keeps its identity across updates on a page', async () => {
    const grid = await mount({ pagination: { enabled: true, pageSize: 3 } });
    const items = grid.pageItems;
    expect(items.length).to.equal(3);
    expect(grid.pageItems, 'two reads').to.equal(items);
    grid.requestUpdate();
    await grid.updateComplete;
    expect(grid.pageItems, 'after an update').to.equal(items);
  });

  it('recomputes on every input that changes the body rows', async () => {
    const grid = await mount({ pagination: { enabled: true, pageSize: 3 } });
    let previous = grid.pageItems;
    const changed = async (label: string) => {
      await settle(grid);
      const next = grid.pageItems;
      expect([...next], label).to.deep.equal(expectedPage(grid));
      expect(next, `${label}: new identity`).to.not.equal(previous);
      previous = next;
    };

    const pinned = grid.pageItems[0];
    grid.pinRow(pinned, 'top');
    await changed('pin');
    expect(grid.pageItems).to.not.include(pinned);

    grid.rowPinning = { enabled: false };
    await changed('pinning disabled');
    expect(grid.pageItems).to.include(pinned);

    grid.rowPinning = { enabled: true };
    await changed('pinning enabled');

    grid.unpinRow(pinned);
    await changed('unpin');

    grid.setState({ rowPinning: { top: [2], bottom: [] } } as never);
    await changed('restored pins');

    grid.page = 1;
    await changed('page');

    grid.pageSize = 2;
    await changed('page size');

    grid.sort({ key: 'name', direction: 'descending' });
    await changed('sort');

    grid.filter({ key: 'name', condition: 'contains', searchTerm: 'a' } as never);
    await changed('filter');

    grid.clearFilter();
    await changed('filter cleared');

    grid.quickFilter = 'b';
    await changed('quick filter');

    grid.quickFilter = '';
    await changed('quick filter cleared');

    grid.data = data.map((row) => ({ ...row, name: `${row.name}!` }));
    await changed('data replaced');
    expect(grid.pageItems.every((row) => row.name.endsWith('!'))).to.be.true;

    grid.pinRow(grid.pageItems[1], 'bottom');
    await changed('pin on the new data');

    grid.pagination = { enabled: false };
    await changed('pagination disabled');
    expect(grid.pageItems.length).to.equal(grid.dataView.length - 1);
  });

  it('recomputes when a pipeline hook returns the same array with new contents', async () => {
    const cache: TestData[] = [];
    let reverse = true;
    const grid = await fixture<ApexGrid<TestData>>(
      html`<apex-grid
        .data=${data}
        .columns=${columns}
        .dataPipelineConfiguration=${{
          sort: ({ data: rows }: { data: TestData[] }) => {
            const next = reverse ? [...rows].reverse() : [...rows];
            cache.length = 0;
            cache.push(...next);
            return cache;
          },
        }}
        .pagination=${{ enabled: true, pageSize: 3 }}
      ></apex-grid>`
    );
    grid.requestUpdate(PIPELINE);
    await settle(grid);
    expect(grid.pageItems.map((row) => row.id)).to.deep.equal([8, 7, 6]);
    reverse = false;
    grid.requestUpdate(PIPELINE);
    await settle(grid);
    expect(grid.dataView, 'the hook handed back the same array').to.equal(cache);
    expect(grid.pageItems.map((row) => row.id)).to.deep.equal([1, 2, 3]);
  });
});

describe('Render path: feature module seam', () => {
  afterEach(() => fixtureCleanup());

  const GROUP: TestData = { id: -1, name: 'GROUP', active: false, importance: 'low' };

  /** A transformer whose output depends on its own state, like enterprise grouping. */
  class Transformer implements ReactiveController, RowTransformer<TestData> {
    public enabled = false;
    constructor(host: { addController(c: ReactiveController): void }) {
      host.addController(this);
    }
    hostConnected() {}
    processRows(rows: ReadonlyArray<TestData>): TestData[] {
      return this.enabled ? [GROUP, ...rows] : [...rows];
    }
    isSyntheticRow(row: TestData) {
      return row === GROUP;
    }
  }

  class Decorator implements ReactiveController, CellDecorator<TestData> {
    public calls = 0;
    constructor(host: { addController(c: ReactiveController): void }) {
      host.addController(this);
    }
    hostConnected() {}
    decorateCell(): CellDecoration | null {
      this.calls++;
      return { attributes: { 'data-decorated': '' } };
    }
  }

  const transformModule: GridFeatureModule<TestData> = {
    id: 'transform-stub',
    create: (host) => new Transformer(host),
  };
  const decorateModule: GridFeatureModule<TestData> = {
    id: 'decorate-stub',
    create: (host) => new Decorator(host),
  };

  class SeamGrid<T extends object> extends ApexGrid<T> {
    public static override get tagName() {
      return 'apex-grid-render-path-seam';
    }
    public static override register() {
      if (!customElements.get(SeamGrid.tagName)) customElements.define(SeamGrid.tagName, SeamGrid);
    }
    protected override createStateController(): StateController<T> {
      return new StateController<T>(this, [
        transformModule as unknown as GridFeatureModule<T>,
        decorateModule as unknown as GridFeatureModule<T>,
      ]);
    }
  }

  it('a module transform change reaches pageItems with pins and paging', async () => {
    SeamGrid.register();
    const grid = await fixture<SeamGrid<TestData>>(
      html`<apex-grid-render-path-seam
        .data=${data}
        .columns=${columns}
        .rowPinning=${{ enabled: true }}
        .pagination=${{ enabled: true, pageSize: 4 }}
      ></apex-grid-render-path-seam>`
    );
    await settle(grid);
    grid.pinRow(data[0], 'bottom');
    await settle(grid);
    const before = grid.pageItems;
    expect(before[0]).to.not.equal(GROUP);

    const transformer = stateOf(grid).module<Transformer>('transform-stub')!;
    transformer.enabled = true;
    grid.requestUpdate(PIPELINE);
    await settle(grid);
    expect(grid.pageItems).to.not.equal(before);
    expect(grid.pageItems[0]).to.equal(GROUP);
    expect([...grid.pageItems]).to.deep.equal(expectedPage(grid));
    expect(stateOf(grid).isDataRow(GROUP)).to.be.false;
  });

  it('decorates through a registered decorator and skips the seam without one', async () => {
    SeamGrid.register();
    ApexGrid.register();
    const seam = await fixture<SeamGrid<TestData>>(
      html`<apex-grid-render-path-seam
        .data=${data}
        .columns=${columns}
      ></apex-grid-render-path-seam>`
    );
    await settle(seam);
    expect(stateOf(seam).hasCellDecorators).to.be.true;
    const decorator = stateOf(seam).module<Decorator>('decorate-stub')!;
    expect(decorator.calls).to.be.greaterThan(0);
    const cell = (seam.rows[0] as unknown as ApexGridRow<TestData>).shadowRoot!.querySelector(
      'apex-grid-cell'
    )!;
    expect(cell.hasAttribute('data-decorated')).to.be.true;

    const proto = StateController.prototype as unknown as { decorateCell: () => unknown };
    const original = proto.decorateCell;
    let calls = 0;
    proto.decorateCell = function (this: StateController<TestData>, ...args: unknown[]) {
      calls++;
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    };
    // Drop the seam grid so the plain grid's rows render in view.
    fixtureCleanup();
    try {
      const plain = await fixture<ApexGrid<TestData>>(
        html`<apex-grid .data=${data} .columns=${columns}></apex-grid>`
      );
      await settle(plain);
      expect(stateOf(plain).hasCellDecorators).to.be.false;
      expect(plain.rows.length).to.be.greaterThan(0);
      expect(calls, 'the community grid asks the decoration seam').to.equal(0);
    } finally {
      proto.decorateCell = original;
    }
  });
});
