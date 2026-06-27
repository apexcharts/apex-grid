import { expect, html } from '@open-wc/testing';
import type { StateController } from '../src/controllers/state.js';
import type {
  ColumnConfiguration,
  GridRowPinningConfiguration,
  GridRowReorderingConfiguration,
} from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

class ReorderFixture<T extends TestData> extends GridTestFixture<T> {
  public rowReordering: GridRowReorderingConfiguration = { enabled: true };
  public rowPinning?: GridRowPinningConfiguration;

  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number', sort: true },
      { key: 'name', sort: true },
      { key: 'active', type: 'boolean' },
      { key: 'importance' },
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
      .rowPinning=${this.rowPinning}
    ></apex-grid>`;
  }

  public get stateController(): StateController<T> {
    return (this.grid as unknown as { stateController: StateController<T> }).stateController;
  }

  public ids(): number[] {
    return this.grid.pageItems.map((row) => (row as TestData).id);
  }

  public key(k: string, init: KeyboardEventInit = {}): void {
    this.stateController.navigation.navigate(new KeyboardEvent('keydown', { key: k, ...init }));
  }
}

const TDD = new ReorderFixture(data);

describe('Row reorder — manual order', () => {
  beforeEach(async () => await TDD.setUp());
  afterEach(() => TDD.tearDown());

  it('moveRow reorders the view (after)', async () => {
    expect(TDD.ids()).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(TDD.grid.moveRow(0, 2, 'after')).to.be.true;
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([2, 3, 1, 4, 5, 6, 7, 8]);
  });

  it('moveRow reorders the view (before)', async () => {
    expect(TDD.grid.moveRow(4, 1, 'before')).to.be.true;
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([1, 5, 2, 3, 4, 6, 7, 8]);
  });

  it('emits rowMoved with the from/to/data payload', async () => {
    let detail: { from: number; to: number; id: number } | null = null;
    TDD.grid.addEventListener('rowMoved', (event) => {
      detail = {
        from: event.detail.from,
        to: event.detail.to,
        id: (event.detail.data as TestData).id,
      };
    });
    TDD.grid.moveRow(0, 2, 'after');
    await TDD.waitForUpdate();
    expect(detail).to.deep.equal({ from: 0, to: 2, id: 1 });
  });

  it('aborts the move when rowMoving is cancelled', async () => {
    TDD.grid.addEventListener('rowMoving', (event) => event.preventDefault());
    expect(TDD.grid.moveRow(0, 2, 'after')).to.be.false;
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('applying a sort clears the manual order', async () => {
    TDD.grid.moveRow(0, 2, 'after');
    await TDD.waitForUpdate();
    expect(TDD.stateController.rowReorder.hasManualOrder).to.be.true;
    expect(TDD.ids()).to.deep.equal([2, 3, 1, 4, 5, 6, 7, 8]);

    TDD.grid.sortExpressions = [{ key: 'id', direction: 'descending' }];
    await TDD.waitForUpdate();

    expect(TDD.stateController.rowReorder.hasManualOrder).to.be.false;
    expect(TDD.ids()).to.deep.equal([8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it('is a no-op when row reordering is disabled', async () => {
    TDD.grid.rowReordering = { enabled: false };
    await TDD.waitForUpdate();
    expect(TDD.grid.moveRow(0, 2, 'after')).to.be.false;
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('Row reorder — keyboard', () => {
  beforeEach(async () => await TDD.setUp());
  afterEach(() => TDD.tearDown());

  it('grabs with Space, moves with Arrow, drops with Enter', async () => {
    TDD.stateController.active = { column: 'id' as never, row: 0 };
    const reorder = TDD.stateController.rowReorder;

    TDD.key(' ');
    expect(reorder.isGrabbing).to.be.true;
    expect(reorder.grabbed).to.equal(TDD.grid.pageItems[0]);

    TDD.key('ArrowDown');
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([2, 1, 3, 4, 5, 6, 7, 8]);
    expect(TDD.stateController.active.row).to.equal(1);

    TDD.key('Enter');
    expect(reorder.isGrabbing).to.be.false;
    expect(TDD.ids()).to.deep.equal([2, 1, 3, 4, 5, 6, 7, 8]);
  });

  it('Escape cancels the grab and reverts the order', async () => {
    TDD.stateController.active = { column: 'id' as never, row: 0 };
    TDD.key(' ');
    TDD.key('ArrowDown');
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([2, 1, 3, 4, 5, 6, 7, 8]);

    TDD.key('Escape');
    await TDD.waitForUpdate();
    expect(TDD.stateController.rowReorder.isGrabbing).to.be.false;
    expect(TDD.ids()).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

class ApplyToDataFixture<T extends TestData> extends ReorderFixture<T> {
  public override rowReordering: GridRowReorderingConfiguration = {
    enabled: true,
    applyToData: true,
  };
}

describe('Row reorder — applyToData', () => {
  const app = new ApplyToDataFixture(data);
  beforeEach(async () => await app.setUp());
  afterEach(() => app.tearDown());

  it('splices grid.data in place to match the new order', async () => {
    app.grid.moveRow(0, 2, 'after');
    await app.waitForUpdate();

    expect(app.grid.data.map((row) => row.id)).to.deep.equal([2, 3, 1, 4, 5, 6, 7, 8]);
    // With applyToData the data array carries the order, so no manual order
    // remains and sorting is available again.
    expect(app.stateController.rowReorder.hasManualOrder).to.be.false;
  });
});

class PinnedReorderFixture<T extends TestData> extends ReorderFixture<T> {
  public override rowPinning: GridRowPinningConfiguration = { enabled: true };
}

describe('Row reorder — coexists with pinned rows', () => {
  const fx = new PinnedReorderFixture(data);
  beforeEach(async () => await fx.setUp());
  afterEach(() => fx.tearDown());

  it('reorders the body while a pinned row stays pinned', async () => {
    const pinned = fx.grid.data[7]; // id 8
    fx.grid.pinRow(pinned, 'bottom');
    await fx.waitForUpdate();
    expect(fx.ids()).to.deep.equal([1, 2, 3, 4, 5, 6, 7]); // body excludes pinned

    fx.grid.moveRow(0, 1, 'after');
    await fx.waitForUpdate();

    expect(fx.ids()).to.deep.equal([2, 1, 3, 4, 5, 6, 7]);
    expect(fx.grid.pinnedRows.bottom).to.deep.equal([pinned]);
  });
});
