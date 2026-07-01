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

function pointerEvent(
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  init: { clientX: number; clientY: number; pointerId?: number; button?: number }
): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    composed: true,
    pointerId: init.pointerId ?? 1,
    button: init.button ?? 0,
    clientX: init.clientX,
    clientY: init.clientY,
  });
}

const rowEl = (fx: ReorderFixture<TestData>, index: number) =>
  fx.grid.rows[index] as unknown as HTMLElement;

describe('Row reorder — drag handle + ghost', () => {
  beforeEach(async () => await TDD.setUp());
  afterEach(() => TDD.tearDown());

  it('defaults to handle mode: a grip + header spacer + leading 36px track', async () => {
    const reorder = TDD.stateController.rowReorder;
    expect(reorder.handleMode).to.be.true;
    expect(reorder.showHandleColumn).to.be.true;

    expect(rowEl(TDD, 0).shadowRoot?.querySelector('[part="reorder-handle"]')).to.exist;
    expect(TDD.headerRow.shadowRoot?.querySelector('[part="reorder-handle-header"]')).to.exist;
    expect((TDD.headerRow as unknown as HTMLElement).style.gridTemplateColumns).to.match(/^36px/);
  });

  it('handle:false drops the grip, spacer, and leading track (whole-row drag)', async () => {
    TDD.grid.rowReordering = { enabled: true, handle: false };
    await TDD.waitForUpdate();
    const reorder = TDD.stateController.rowReorder;
    expect(reorder.handleMode).to.be.false;
    expect(reorder.showHandleColumn).to.be.false;

    expect(rowEl(TDD, 0).shadowRoot?.querySelector('[part="reorder-handle-cell"]')).to.be.null;
    expect(TDD.headerRow.shadowRoot?.querySelector('[part="reorder-handle-header"]')).to.be.null;
    expect((TDD.headerRow as unknown as HTMLElement).style.gridTemplateColumns).to.not.match(
      /^36px/
    );
  });

  it('a press off the handle does not start a drag in handle mode', async () => {
    const row0 = rowEl(TDD, 0);
    const cell = row0.shadowRoot?.querySelector('apex-grid-cell') as HTMLElement;
    const rect = cell.getBoundingClientRect();
    cell.dispatchEvent(
      pointerEvent('pointerdown', { clientX: rect.left + 8, clientY: rect.top + 8 })
    );
    row0.dispatchEvent(
      pointerEvent('pointermove', { clientX: rect.left + 8, clientY: rect.top + 40 })
    );
    await TDD.waitForUpdate();

    expect(TDD.stateController.rowReorder.dragging).to.be.null;
    expect(TDD.stateController.rowReorder.ghost).to.be.null;
  });

  it('dragging the grip past the threshold starts a drag and exposes ghost state', async () => {
    const row0 = rowEl(TDD, 0);
    const handle = row0.shadowRoot?.querySelector('[part="reorder-handle"]') as HTMLElement;
    const rect = row0.getBoundingClientRect();
    handle.dispatchEvent(
      pointerEvent('pointerdown', { clientX: rect.left + 8, clientY: rect.top + 8 })
    );
    row0.dispatchEvent(
      pointerEvent('pointermove', { clientX: rect.left + 8, clientY: rect.top + 20 })
    );
    await TDD.waitForUpdate();

    const reorder = TDD.stateController.rowReorder;
    expect(reorder.dragging).to.equal(TDD.grid.pageItems[0]);
    expect(reorder.ghost).to.not.be.null;
    expect(reorder.ghost?.cells.length).to.be.greaterThan(0);
    expect(reorder.ghost?.height).to.be.greaterThan(0);
  });

  it('a grip drag past the next row reorders, and dropping clears the ghost', async () => {
    const row0 = rowEl(TDD, 0);
    const handle = row0.shadowRoot?.querySelector('[part="reorder-handle"]') as HTMLElement;
    const r0 = row0.getBoundingClientRect();
    const r1 = rowEl(TDD, 1).getBoundingClientRect();

    handle.dispatchEvent(
      pointerEvent('pointerdown', { clientX: r0.left + 8, clientY: r0.top + 8 })
    );
    row0.dispatchEvent(
      pointerEvent('pointermove', { clientX: r0.left + 8, clientY: r1.top + r1.height * 0.75 })
    );
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([2, 1, 3, 4, 5, 6, 7, 8]);

    // The pointer-up plumbing lives on the grid host, so even though the live-
    // swap recycled the source row's DOM, the drop still ends the drag cleanly.
    const reorder = TDD.stateController.rowReorder;
    row0.dispatchEvent(
      pointerEvent('pointerup', { clientX: r0.left + 8, clientY: r1.top + r1.height * 0.75 })
    );
    expect(reorder.ghost).to.be.null;
    expect(reorder.dragging).to.be.null;
  });

  it('whole-row mode: a press on the row body starts a drag', async () => {
    TDD.grid.rowReordering = { enabled: true, handle: false };
    await TDD.waitForUpdate();
    const row0 = rowEl(TDD, 0);
    const cell = row0.shadowRoot?.querySelector('apex-grid-cell') as HTMLElement;
    const rect = row0.getBoundingClientRect();
    cell.dispatchEvent(
      pointerEvent('pointerdown', { clientX: rect.left + 20, clientY: rect.top + 8 })
    );
    row0.dispatchEvent(
      pointerEvent('pointermove', { clientX: rect.left + 20, clientY: rect.top + 20 })
    );
    await TDD.waitForUpdate();

    expect(TDD.stateController.rowReorder.dragging).to.equal(TDD.grid.pageItems[0]);
    expect(TDD.stateController.rowReorder.ghost).to.not.be.null;
  });

  it('moveGhost tracks the cursor; endDrag clears the ghost', () => {
    const reorder = TDD.stateController.rowReorder;
    const rect = { left: 100, top: 50, width: 400, height: 36 } as DOMRect;
    reorder.startDrag(TDD.grid.pageItems[0], {
      rect,
      clientX: 120,
      clientY: 60,
      cells: [{ text: '1', width: 60, align: 'right' }],
    });
    expect(reorder.ghost?.pointerOffsetX).to.equal(20);
    expect(reorder.ghost?.pointerOffsetY).to.equal(10);

    reorder.moveGhost(200, 140);
    expect(reorder.ghost?.x).to.equal(180); // 200 - 20
    expect(reorder.ghost?.y).to.equal(130); // 140 - 10

    reorder.endDrag();
    expect(reorder.ghost).to.be.null;
    expect(reorder.dragging).to.be.null;
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
