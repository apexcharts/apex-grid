import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ReactiveController } from 'lit';
import { ApexGrid } from '../src/components/grid.js';
import { StateController } from '../src/controllers/state.js';
import type { GridFeatureModule, SerializableModule } from '../src/internal/feature-module.js';
import {
  applyColumnLayout,
  type ColumnLayoutState,
  deserializeFilter,
  type RowRef,
  resolveRowRefs,
  serializeColumnLayout,
  serializeFilter,
  serializeRowRefs,
  serializeSort,
} from '../src/internal/state-snapshot.js';
import type { ColumnConfiguration, GridHost } from '../src/internal/types.js';
import type { FilterExpression } from '../src/operations/filter/types.js';
import type { SortExpression } from '../src/operations/sort/types.js';
import data, { type TestData } from './utils/test-data.js';

/** Reaches the protected `stateController` field for assertions. */
function stateOf<T extends object>(grid: ApexGrid<T>): StateController<T> {
  return (grid as unknown as { stateController: StateController<T> }).stateController;
}

const columns = [
  { key: 'id', type: 'number' },
  { key: 'name' },
  { key: 'active', type: 'boolean' },
  { key: 'importance' },
] as ColumnConfiguration<TestData>[];

describe('state-snapshot — pure functions', () => {
  describe('column layout', () => {
    it('serializes order, width, pinning, and visibility', () => {
      const cols = [
        { key: 'id', width: '80px', pinned: 'start' },
        { key: 'name' },
        { key: 'active', hidden: true },
      ] as ColumnConfiguration<TestData>[];
      const layout = serializeColumnLayout(cols);
      expect(layout).to.deep.equal([
        { key: 'id', width: '80px', pinned: 'start', hidden: undefined },
        { key: 'name', width: undefined, pinned: undefined, hidden: undefined },
        { key: 'active', width: undefined, pinned: undefined, hidden: true },
      ]);
    });

    it('reorders columns and applies layout, preserving non-layout props', () => {
      const cols = [
        { key: 'id', type: 'number', headerText: 'ID' },
        { key: 'name', headerText: 'Name' },
        { key: 'active', type: 'boolean' },
      ] as ColumnConfiguration<TestData>[];
      const layout: ColumnLayoutState[] = [
        { key: 'name', width: '200px', pinned: 'start' },
        { key: 'id', hidden: true },
        { key: 'active' },
      ];
      const applied = applyColumnLayout(cols, layout);
      expect(applied.map((c) => c.key)).to.deep.equal(['name', 'id', 'active']);
      expect(applied[0]).to.include({ width: '200px', pinned: 'start', headerText: 'Name' });
      expect(applied[1]).to.include({ hidden: true, type: 'number', headerText: 'ID' });
    });

    it('appends current columns the layout omits, unchanged', () => {
      const cols = [{ key: 'id' }, { key: 'name' }] as ColumnConfiguration<TestData>[];
      const applied = applyColumnLayout(cols, [{ key: 'name' }]);
      expect(applied.map((c) => c.key)).to.deep.equal(['name', 'id']);
    });
  });

  describe('sort', () => {
    it('captures key/direction/caseSensitive, dropping the comparer', () => {
      const expressions = [
        { key: 'name', direction: 'descending', caseSensitive: true, comparer: () => 0 },
      ] as unknown as SortExpression<TestData>[];
      expect(serializeSort(expressions)).to.deep.equal([
        { key: 'name', direction: 'descending', caseSensitive: true },
      ]);
    });
  });

  describe('filter', () => {
    it('captures the condition by operand name', () => {
      const expressions = [
        {
          key: 'name',
          condition: { name: 'contains', unary: false, logic: () => true },
          searchTerm: 'a',
          caseSensitive: false,
        },
      ] as unknown as FilterExpression<TestData>[];
      expect(serializeFilter(expressions)).to.deep.equal([
        {
          key: 'name',
          operand: 'contains',
          searchTerm: 'a',
          criteria: undefined,
          caseSensitive: false,
        },
      ]);
    });

    it('resolves an operand name back to a live FilterOperation', () => {
      const rebuilt = deserializeFilter<TestData>(
        [{ key: 'name', operand: 'contains', searchTerm: 'a' }],
        (key) => columns.find((c) => String(c.key) === key)
      );
      expect(rebuilt).to.have.lengthOf(1);
      const condition = rebuilt[0].condition as { name: string };
      expect(condition.name).to.equal('contains');
      expect(rebuilt[0].searchTerm).to.equal('a');
    });

    it('drops entries with an unknown column or operand', () => {
      expect(
        deserializeFilter<TestData>([{ key: 'nope', operand: 'contains' }], () => undefined)
      ).to.have.lengthOf(0);
      expect(
        deserializeFilter<TestData>([{ key: 'name', operand: 'bogusOperand' }], (key) =>
          columns.find((c) => String(c.key) === key)
        )
      ).to.have.lengthOf(0);
    });
  });

  describe('row refs', () => {
    it('serializes by index when no rowId resolver is given', () => {
      const refs = serializeRowRefs([data[2], data[5]], data);
      expect(refs).to.deep.equal([{ index: 2 }, { index: 5 }]);
    });

    it('serializes by id when a rowId resolver is given', () => {
      const refs = serializeRowRefs([data[2], data[5]], data, (r) => r.id);
      expect(refs).to.deep.equal([{ id: 3 }, { id: 6 }]);
    });

    it('resolves index refs positionally', () => {
      const rows = resolveRowRefs<TestData>([{ index: 1 }, { index: 4 }], data);
      expect(rows).to.deep.equal([data[1], data[4]]);
    });

    it('resolves id refs against a fresh data array via rowId', () => {
      const reloaded = data.map((r) => ({ ...r })); // new object identities
      const refs: RowRef[] = [{ id: 3 }, { id: 6 }];
      const rows = resolveRowRefs(refs, reloaded, (r) => r.id);
      expect(rows.map((r) => r.id)).to.deep.equal([3, 6]);
      expect(rows[0]).to.equal(reloaded[2]); // resolved against the new array
    });

    it('skips unresolvable refs (bad index, or id without resolver)', () => {
      expect(resolveRowRefs<TestData>([{ index: 999 }], data)).to.have.lengthOf(0);
      expect(resolveRowRefs<TestData>([{ id: 3 }], data)).to.have.lengthOf(0);
    });
  });
});

describe('ApexGrid.getState / setState', () => {
  afterEach(() => fixtureCleanup());

  async function mount(): Promise<ApexGrid<TestData>> {
    ApexGrid.register();
    const grid = await fixture<ApexGrid<TestData>>(html`
      <apex-grid
        .data=${[...data]}
        .columns=${columns}
        .selection=${{ enabled: true, mode: 'multiple' }}
        .pagination=${{ enabled: true, pageSize: 4 }}
      ></apex-grid>
    `);
    await grid.updateComplete;
    return grid;
  }

  it('captures sort, filter, quick-filter, pagination, selection, and column layout', async () => {
    const grid = await mount();
    grid.sort([{ key: 'name', direction: 'descending' } as SortExpression<TestData>]);
    grid.filter([
      { key: 'importance', condition: 'contains', searchTerm: 'low' } as FilterExpression<TestData>,
    ]);
    grid.quickFilter = 'a';
    grid.selectedRows = [data[0], data[2]];
    grid.page = 0;
    await grid.updateComplete;

    const snapshot = grid.getState();
    expect(snapshot.version).to.equal(1);
    expect(snapshot.sort).to.deep.equal([
      { key: 'name', direction: 'descending', caseSensitive: false },
    ]);
    expect(snapshot.filter[0]).to.include({
      key: 'importance',
      operand: 'contains',
      searchTerm: 'low',
    });
    expect(snapshot.quickFilter).to.equal('a');
    expect(snapshot.pagination).to.deep.equal({ page: 0, pageSize: 4 });
    expect(snapshot.selection).to.deep.equal([{ index: 0 }, { index: 2 }]);
    expect(snapshot.columns.map((c) => c.key)).to.deep.equal([
      'id',
      'name',
      'active',
      'importance',
    ]);
    // JSON-safe: no functions survive serialization.
    expect(() => JSON.stringify(snapshot)).to.not.throw();
  });

  it('round-trips a snapshot: capture → reset → restore reproduces the view', async () => {
    const grid = await mount();
    grid.sort([{ key: 'name', direction: 'descending' } as SortExpression<TestData>]);
    grid.selectedRows = [data[1], data[3]];
    grid.page = 1;
    await grid.updateComplete;

    const snapshot = grid.getState();
    const beforeView = grid.dataView.map((r) => r.id);

    // Reset everything.
    grid.clearSort();
    grid.selectedRows = [];
    grid.page = 0;
    await grid.updateComplete;
    expect(grid.selectedRows).to.have.lengthOf(0);

    // Restore.
    grid.setState(snapshot);
    await grid.updateComplete;

    expect(grid.dataView.map((r) => r.id)).to.deep.equal(beforeView);
    expect(grid.selectedRows.map((r) => r.id)).to.deep.equal([2, 4]);
    expect(grid.page).to.equal(1);
    expect(grid.sortExpressions[0]).to.include({ key: 'name', direction: 'descending' });
  });

  it('applies only the slices present (partial setState)', async () => {
    const grid = await mount();
    grid.sort([{ key: 'name', direction: 'ascending' } as SortExpression<TestData>]);
    grid.selectedRows = [data[0]];
    await grid.updateComplete;

    // Only change sort; selection must be untouched.
    grid.setState({ sort: [{ key: 'id', direction: 'descending' }] });
    await grid.updateComplete;

    expect(grid.sortExpressions[0]).to.include({ key: 'id', direction: 'descending' });
    expect(grid.selectedRows.map((r) => r.id)).to.deep.equal([1]);
  });

  it('clears an operation when a present-but-empty array is passed', async () => {
    const grid = await mount();
    grid.sort([{ key: 'name', direction: 'ascending' } as SortExpression<TestData>]);
    await grid.updateComplete;
    expect(grid.sortExpressions).to.have.lengthOf(1);

    grid.setState({ sort: [] });
    await grid.updateComplete;
    expect(grid.sortExpressions).to.have.lengthOf(0);
  });

  it('restores selection across a data reload using rowId', async () => {
    const grid = await mount();
    grid.rowId = (row) => row.id;
    grid.selectedRows = [data[2], data[5]];
    await grid.updateComplete;

    const snapshot = grid.getState();
    expect(snapshot.selection).to.deep.equal([{ id: 3 }, { id: 6 }]);

    // Swap in a fresh data array with new object identities.
    grid.data = data.map((r) => ({ ...r }));
    grid.selectedRows = [];
    await grid.updateComplete;

    grid.setState(snapshot);
    await grid.updateComplete;
    expect(grid.selectedRows.map((r) => r.id)).to.deep.equal([3, 6]);
  });
});

describe('ApexGrid.getState / setState — row pinning + manual order', () => {
  afterEach(() => fixtureCleanup());

  async function mount(): Promise<ApexGrid<TestData>> {
    ApexGrid.register();
    const grid = await fixture<ApexGrid<TestData>>(html`
      <apex-grid
        .data=${[...data]}
        .columns=${columns}
        .rowPinning=${{ enabled: true }}
        .rowReordering=${{ enabled: true }}
      ></apex-grid>
    `);
    await grid.updateComplete;
    return grid;
  }

  it('captures pinned rows per band, by RowRef', async () => {
    const grid = await mount();
    grid.pinRow(data[1], 'top');
    grid.pinRow(data[3], 'bottom');
    await grid.updateComplete;

    const snapshot = grid.getState();
    expect(snapshot.rowPinning).to.deep.equal({ top: [{ index: 1 }], bottom: [{ index: 3 }] });
    expect(() => JSON.stringify(snapshot)).to.not.throw();
  });

  it('round-trips pinned rows: capture → clear → restore', async () => {
    const grid = await mount();
    grid.pinRow(data[2], 'top');
    grid.pinRow(data[5], 'bottom');
    await grid.updateComplete;
    const snapshot = grid.getState();

    grid.unpinRow(data[2]);
    grid.unpinRow(data[5]);
    await grid.updateComplete;
    expect(grid.pinnedRows.top).to.have.lengthOf(0);

    grid.setState(snapshot);
    await grid.updateComplete;
    expect(grid.pinnedRows.top.map((r) => r.id)).to.deep.equal([3]);
    expect(grid.pinnedRows.bottom.map((r) => r.id)).to.deep.equal([6]);
  });

  it('restores pinned rows across a data reload using rowId', async () => {
    const grid = await mount();
    grid.rowId = (row) => row.id;
    grid.pinRow(data[0], 'top');
    await grid.updateComplete;
    const snapshot = grid.getState();
    expect(snapshot.rowPinning?.top).to.deep.equal([{ id: 1 }]);

    grid.data = data.map((r) => ({ ...r }));
    await grid.updateComplete;

    grid.setState(snapshot);
    await grid.updateComplete;
    expect(grid.pinnedRows.top.map((r) => r.id)).to.deep.equal([1]);
  });

  it('captures and round-trips a manual row order', async () => {
    const grid = await mount();
    // Move the first row to the end.
    grid.moveRow(0, grid.pageItems.length - 1, 'after');
    await grid.updateComplete;

    const snapshot = grid.getState();
    expect(snapshot.rowOrder).to.be.an('array');
    const reordered = grid.dataView.map((r) => r.id);

    // Clear the manual order by applying (then clearing) a sort.
    grid.sort([{ key: 'id', direction: 'ascending' } as SortExpression<TestData>]);
    await grid.updateComplete;

    grid.setState(snapshot);
    await grid.updateComplete;
    expect(grid.dataView.map((r) => r.id)).to.deep.equal(reordered);
    expect(grid.sortExpressions).to.have.lengthOf(0);
  });

  it('emits rowOrder = null when no manual order is active', async () => {
    const grid = await mount();
    expect(grid.getState().rowOrder).to.equal(null);
  });

  it('drops rowOrder when the same snapshot also carries an active sort', async () => {
    const grid = await mount();
    grid.setState({
      sort: [{ key: 'id', direction: 'descending' }],
      rowOrder: [{ index: 3 }, { index: 0 }, { index: 1 }],
    });
    await grid.updateComplete;

    expect(stateOf(grid).rowReorder.hasManualOrder).to.equal(false);
    expect(grid.sortExpressions[0]).to.include({ key: 'id', direction: 'descending' });
  });
});

describe('SerializableModule seam', () => {
  afterEach(() => fixtureCleanup());

  class CounterController implements ReactiveController, SerializableModule {
    public value = 0;
    constructor(host: GridHost<TestData>) {
      host.addController(this);
    }
    hostConnected() {}
    serializeState(): unknown {
      return { value: this.value };
    }
    restoreState(data: unknown): void {
      if (data && typeof data === 'object' && 'value' in data) {
        this.value = Number((data as { value: unknown }).value) || 0;
      }
    }
  }

  const counterModule: GridFeatureModule<TestData> = {
    id: 'counter',
    create: (host) => new CounterController(host),
  };

  class CounterGrid<T extends object> extends ApexGrid<T> {
    public static override get tagName() {
      return 'apex-grid-counter-test';
    }
    public static override register() {
      if (!customElements.get(CounterGrid.tagName)) {
        customElements.define(CounterGrid.tagName, CounterGrid);
      }
    }
    protected override createStateController(): StateController<T> {
      return new StateController<T>(this, [counterModule as unknown as GridFeatureModule<T>]);
    }
  }

  async function mount(): Promise<CounterGrid<TestData>> {
    CounterGrid.register();
    const grid = await fixture<CounterGrid<TestData>>(
      html`<apex-grid-counter-test .data=${[...data]} .columns=${columns}></apex-grid-counter-test>`
    );
    await grid.updateComplete;
    return grid;
  }

  it('includes module state in getState under the module id', async () => {
    const grid = await mount();
    const module = stateOf(grid).module<CounterController>('counter')!;
    module.value = 5;

    const snapshot = grid.getState();
    expect(snapshot.modules).to.deep.equal({ counter: { value: 5 } });
  });

  it('dispatches module state back on setState', async () => {
    const grid = await mount();
    const module = stateOf(grid).module<CounterController>('counter')!;
    module.value = 7;
    const snapshot = grid.getState();

    module.value = 0;
    grid.setState(snapshot);
    expect(module.value).to.equal(7);
  });

  it('the community grid contributes an empty modules map', async () => {
    ApexGrid.register();
    const grid = await fixture<ApexGrid<TestData>>(
      html`<apex-grid .data=${[...data]} .columns=${columns}></apex-grid>`
    );
    await grid.updateComplete;
    await nextFrame();
    expect(grid.getState().modules).to.deep.equal({});
  });
});
