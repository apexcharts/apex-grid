import { expect, html } from '@open-wc/testing';
import type { StateController } from '../src/controllers/state.js';
import type {
  ColumnConfiguration,
  GridRowPinningConfiguration,
  GridRowReorderingConfiguration,
} from '../src/internal/types.js';
import type { FilterExpression } from '../src/operations/filter/types.js';
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
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: {
    clientX: number;
    clientY: number;
    pointerId?: number;
    button?: number;
    buttons?: number;
  }
): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    composed: true,
    pointerId: init.pointerId ?? 1,
    button: init.button ?? 0,
    // A real press reports the primary button as held until the release.
    buttons: init.buttons ?? (type === 'pointerup' || type === 'pointercancel' ? 0 : 1),
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

const lowImportance = [
  { key: 'importance', condition: 'equals', searchTerm: 'low' },
] as unknown as FilterExpression<TestData>[];

const freshCopy = () => JSON.parse(JSON.stringify(data)) as TestData[];

describe('Row reorder: a move under a filter keeps hidden rows in place', () => {
  afterEach(() => TDD.tearDown());

  it('manual order: hidden rows keep their slots after the filter clears', async () => {
    TDD.rowReordering = { enabled: true };
    await TDD.setUp();
    TDD.grid.filter(lowImportance);
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([2, 4, 7]);

    expect(TDD.grid.moveRow(2, 0, 'before')).to.be.true;
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([7, 2, 4]);

    TDD.grid.clearFilter();
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([1, 7, 2, 3, 4, 5, 6, 8]);
  });

  it('applyToData: only the moved row changes slot in grid.data', async () => {
    TDD.rowReordering = { enabled: true, applyToData: true };
    await TDD.setUp();
    TDD.grid.filter(lowImportance);
    await TDD.waitForUpdate();
    expect(TDD.grid.moveRow(0, 2, 'after')).to.be.true;
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([4, 7, 2]);
    expect(TDD.grid.data.map((row) => row.id)).to.deep.equal([1, 3, 4, 5, 6, 7, 2, 8]);
  });

  it('applyToData under a quick filter keeps the hidden rows in place', async () => {
    TDD.rowReordering = { enabled: true, applyToData: true };
    await TDD.setUp();
    TDD.grid.quickFilter = 'high';
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([5, 8]);
    expect(TDD.grid.moveRow(1, 0, 'before')).to.be.true;
    await TDD.waitForUpdate();
    expect(TDD.grid.data.map((row) => row.id)).to.deep.equal([1, 2, 3, 4, 8, 5, 6, 7]);
  });

  it('a filtered move on a sorted grid keeps the sorted slots of hidden rows', async () => {
    TDD.rowReordering = { enabled: true };
    await TDD.setUp();
    TDD.grid.sortExpressions = [{ key: 'id', direction: 'descending' }];
    TDD.grid.filter(lowImportance);
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([7, 4, 2]);
    expect(TDD.grid.moveRow(2, 0, 'before')).to.be.true;
    await TDD.waitForUpdate();
    TDD.grid.clearFilter();
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([8, 2, 7, 6, 5, 4, 3, 1]);
  });
});

describe('Row reorder: the manual order follows grid.data', () => {
  afterEach(() => TDD.tearDown());

  it('a row added after a move is a valid move target', async () => {
    TDD.rowReordering = { enabled: true };
    await TDD.setUp();
    TDD.grid.moveRow(0, 1, 'after');
    await TDD.waitForUpdate();
    const added = { id: 9, name: 'z', active: true, importance: 'low' } as TestData;
    TDD.grid.data = [...TDD.grid.data, added];
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([2, 1, 3, 4, 5, 6, 7, 8, 9]);

    expect(TDD.grid.moveRow(0, 8, 'after')).to.be.true;
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([1, 3, 4, 5, 6, 7, 8, 9, 2]);
  });

  it('fresh objects without rowId drop the dead order and restore sorting', async () => {
    TDD.rowReordering = { enabled: true };
    await TDD.setUp();
    TDD.grid.moveRow(0, 2, 'after');
    await TDD.waitForUpdate();
    const reorder = TDD.stateController.rowReorder;
    expect(reorder.hasManualOrder).to.be.true;

    TDD.grid.data = freshCopy();
    await TDD.waitForUpdate();
    expect(reorder.hasManualOrder).to.be.false;
    expect(TDD.stateController.sorting.isSortable(TDD.grid.getColumn('id')!)).to.be.true;
    expect(TDD.grid.moveRow(0, 2, 'after')).to.be.true;
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([2, 3, 1, 4, 5, 6, 7, 8]);
  });

  it('fresh objects with rowId keep the order on the new objects', async () => {
    TDD.rowReordering = { enabled: true };
    await TDD.setUp();
    TDD.grid.rowId = (row) => row.id;
    TDD.grid.moveRow(0, 2, 'after');
    await TDD.waitForUpdate();

    const fresh = freshCopy();
    TDD.grid.data = fresh;
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([2, 3, 1, 4, 5, 6, 7, 8]);
    expect(TDD.grid.pageItems[0]).to.equal(fresh[1]);
    expect(TDD.grid.getState().rowOrder).to.deep.equal(
      [2, 3, 1, 4, 5, 6, 7, 8].map((id) => ({ id }))
    );
  });

  it('a partial reload keeps the surviving rows in their manual order', async () => {
    TDD.rowReordering = { enabled: true };
    await TDD.setUp();
    TDD.grid.moveRow(0, 2, 'after');
    await TDD.waitForUpdate();
    const [r1, r2, r3, ...rest] = TDD.grid.data;
    TDD.grid.data = [r1, r3, ...rest.slice(0, 2)];
    await TDD.waitForUpdate();
    expect(r2.id).to.equal(2);
    expect(TDD.ids()).to.deep.equal([3, 1, 4, 5]);
  });

  it('replacing the data ends a keyboard grab whose row left', async () => {
    TDD.rowReordering = { enabled: true };
    await TDD.setUp();
    TDD.stateController.active = { column: 'id' as never, row: 0 };
    TDD.key(' ');
    expect(TDD.stateController.rowReorder.isGrabbing).to.be.true;
    TDD.grid.data = freshCopy();
    await TDD.waitForUpdate();
    expect(TDD.stateController.rowReorder.isGrabbing).to.be.false;
  });

  it('a keyboard grab survives an app that re-sets data on rowMoved', async () => {
    TDD.rowReordering = { enabled: true };
    await TDD.setUp();
    TDD.grid.addEventListener('rowMoved', () => {
      TDD.grid.data = [...TDD.grid.pageItems];
    });
    TDD.stateController.active = { column: 'id' as never, row: 0 };
    TDD.key(' ');
    TDD.key('ArrowDown');
    await TDD.waitForUpdate();
    expect(TDD.stateController.rowReorder.isGrabbing).to.be.true;
    TDD.key('ArrowDown');
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([2, 3, 1, 4, 5, 6, 7, 8]);
  });

  it('with rowId a grab follows its row onto fresh objects and Escape reverts', async () => {
    TDD.rowReordering = { enabled: true, applyToData: true };
    await TDD.setUp();
    TDD.grid.rowId = (row) => row.id;
    TDD.stateController.active = { column: 'id' as never, row: 0 };
    TDD.key(' ');
    TDD.key('ArrowDown');
    await TDD.waitForUpdate();
    const fresh = TDD.grid.data.map((row) => ({ ...row }));
    const grabbed = fresh[1];
    TDD.grid.data = fresh;
    await TDD.waitForUpdate();
    expect(TDD.stateController.rowReorder.grabbed).to.equal(grabbed);
    TDD.key('ArrowDown');
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([2, 3, 1, 4, 5, 6, 7, 8]);
    TDD.key('Escape');
    await TDD.waitForUpdate();
    expect(TDD.grid.data.map((row) => row.id)).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(TDD.grid.data[0]).to.equal(grabbed);
  });

  it('a pointer drag survives an app that re-sets data on rowMoved', async () => {
    TDD.rowReordering = { enabled: true };
    await TDD.setUp();
    TDD.grid.addEventListener('rowMoved', () => {
      TDD.grid.data = [...TDD.grid.pageItems];
    });
    const row0 = rowEl(TDD, 0);
    const handle = row0.shadowRoot?.querySelector('[part="reorder-handle"]') as HTMLElement;
    const r0 = row0.getBoundingClientRect();
    const r1 = rowEl(TDD, 1).getBoundingClientRect();
    const r2 = rowEl(TDD, 2).getBoundingClientRect();
    const x = r0.left + 8;
    handle.dispatchEvent(pointerEvent('pointerdown', { clientX: x, clientY: r0.top + 8 }));
    row0.dispatchEvent(
      pointerEvent('pointermove', { clientX: x, clientY: r1.top + r1.height * 0.75 })
    );
    await TDD.waitForUpdate();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(TDD.stateController.rowReorder.dragging).to.not.be.null;
    TDD.grid.dispatchEvent(
      pointerEvent('pointermove', { clientX: x, clientY: r2.top + r2.height * 0.75 })
    );
    await TDD.waitForUpdate();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(TDD.ids()).to.deep.equal([2, 3, 1, 4, 5, 6, 7, 8]);
    document.body.dispatchEvent(pointerEvent('pointerup', { clientX: 0, clientY: 0 }));
    expect(TDD.stateController.rowReorder.dragging).to.be.null;
  });
});

describe('Row reorder: a move on a sorted grid replaces the sort', () => {
  afterEach(() => TDD.tearDown());

  it('applyToData: the move is visible and the sort is cleared', async () => {
    TDD.rowReordering = { enabled: true, applyToData: true };
    await TDD.setUp();
    TDD.grid.sortExpressions = [{ key: 'id', direction: 'descending' }];
    await TDD.waitForUpdate();
    expect(TDD.grid.moveRow(0, 2, 'after')).to.be.true;
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([7, 6, 8, 5, 4, 3, 2, 1]);
    expect(TDD.grid.data.map((row) => row.id)).to.deep.equal([7, 6, 8, 5, 4, 3, 2, 1]);
    expect(TDD.grid.sortExpressions).to.deep.equal([]);
  });

  it('manual order: getState carries the order alone and round trips', async () => {
    TDD.rowReordering = { enabled: true };
    await TDD.setUp();
    TDD.grid.sortExpressions = [{ key: 'id', direction: 'descending' }];
    await TDD.waitForUpdate();
    expect(TDD.grid.moveRow(0, 2, 'after')).to.be.true;
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([7, 6, 8, 5, 4, 3, 2, 1]);

    const snapshot = TDD.grid.getState();
    expect(snapshot.sort).to.deep.equal([]);
    expect(snapshot.rowOrder).to.not.equal(null);
    TDD.grid.setState(JSON.parse(JSON.stringify(snapshot)));
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([7, 6, 8, 5, 4, 3, 2, 1]);
  });

  it('a pointer drag on a sorted grid keeps the swapped order', async () => {
    TDD.rowReordering = { enabled: true, applyToData: true };
    await TDD.setUp();
    TDD.grid.sortExpressions = [{ key: 'id', direction: 'descending' }];
    await TDD.waitForUpdate();
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
    document.body.dispatchEvent(pointerEvent('pointerup', { clientX: 0, clientY: 0 }));
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([7, 8, 6, 5, 4, 3, 2, 1]);
  });
});

describe('Row reorder: Escape undoes the keyboard grab', () => {
  afterEach(() => TDD.tearDown());

  const grabAndStep = async () => {
    TDD.stateController.active = { column: 'id' as never, row: 0 };
    TDD.key(' ');
    TDD.key('ArrowDown');
    await TDD.waitForUpdate();
  };

  it('applyToData: restores grid.data and reports the way back', async () => {
    TDD.rowReordering = { enabled: true, applyToData: true };
    await TDD.setUp();
    const moved: Array<{ from: number; to: number; toIndex: number }> = [];
    TDD.grid.addEventListener('rowMoved', ({ detail }) => {
      moved.push({ from: detail.from, to: detail.to, toIndex: detail.toIndex });
    });
    await grabAndStep();
    expect(TDD.grid.data.map((row) => row.id)).to.deep.equal([2, 1, 3, 4, 5, 6, 7, 8]);

    TDD.key('Escape');
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(TDD.grid.data.map((row) => row.id)).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(moved).to.deep.equal([
      { from: 0, to: 1, toIndex: 1 },
      { from: 1, to: 0, toIndex: 0 },
    ]);
  });

  it('manual order: reports the reverting move with rowMoved', async () => {
    TDD.rowReordering = { enabled: true };
    await TDD.setUp();
    let moved = 0;
    TDD.grid.addEventListener('rowMoved', () => moved++);
    await grabAndStep();
    TDD.key('Escape');
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(moved).to.equal(2);
  });

  it('a cancelled grab on a sorted grid brings the sort back', async () => {
    TDD.rowReordering = { enabled: true };
    await TDD.setUp();
    TDD.grid.sortExpressions = [{ key: 'id', direction: 'descending' }];
    await TDD.waitForUpdate();
    await grabAndStep();
    expect(TDD.ids()).to.deep.equal([7, 8, 6, 5, 4, 3, 2, 1]);
    TDD.key('Escape');
    await TDD.waitForUpdate();
    expect(TDD.ids()).to.deep.equal([8, 7, 6, 5, 4, 3, 2, 1]);
    expect(TDD.grid.sortExpressions.map((expr) => expr.key)).to.deep.equal(['id']);
    expect(TDD.stateController.rowReorder.hasManualOrder).to.be.false;
  });

  it('Escape without a net move emits nothing', async () => {
    TDD.rowReordering = { enabled: true };
    await TDD.setUp();
    let moved = 0;
    TDD.grid.addEventListener('rowMoved', () => moved++);
    TDD.stateController.active = { column: 'id' as never, row: 0 };
    TDD.key(' ');
    TDD.key('Escape');
    await TDD.waitForUpdate();
    expect(moved).to.equal(0);
  });
});

describe('Row reorder: the pointer gesture ends wherever the button is released', () => {
  beforeEach(async () => {
    TDD.rowReordering = { enabled: true };
    await TDD.setUp();
  });
  afterEach(() => TDD.tearDown());

  const press = () => {
    const row0 = rowEl(TDD, 0);
    const handle = row0.shadowRoot?.querySelector('[part="reorder-handle"]') as HTMLElement;
    const r0 = row0.getBoundingClientRect();
    handle.dispatchEvent(
      pointerEvent('pointerdown', { clientX: r0.left + 8, clientY: r0.top + 8 })
    );
    return { row0, r0 };
  };

  it('a release outside the grid disarms the press', async () => {
    const { row0, r0 } = press();
    document.body.dispatchEvent(pointerEvent('pointerup', { clientX: 5, clientY: 5 }));
    row0.dispatchEvent(
      pointerEvent('pointermove', { clientX: r0.left + 8, clientY: r0.top + 40, buttons: 0 })
    );
    await TDD.waitForUpdate();
    expect(TDD.stateController.rowReorder.dragging).to.be.null;
    expect(TDD.stateController.rowReorder.ghost).to.be.null;
  });

  it('a buttonless move ends the gesture without moving rows', async () => {
    let moved = 0;
    TDD.grid.addEventListener('rowMoved', () => moved++);
    const { row0, r0 } = press();
    const r1 = rowEl(TDD, 1).getBoundingClientRect();
    row0.dispatchEvent(
      pointerEvent('pointermove', {
        clientX: r0.left + 8,
        clientY: r1.top + r1.height * 0.75,
        buttons: 0,
      })
    );
    await TDD.waitForUpdate();
    expect(TDD.stateController.rowReorder.dragging).to.be.null;
    expect(moved).to.equal(0);
    expect(TDD.ids()).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('a pointercancel outside the grid ends an engaged drag', async () => {
    const { row0, r0 } = press();
    row0.dispatchEvent(pointerEvent('pointermove', { clientX: r0.left + 8, clientY: r0.top + 20 }));
    await TDD.waitForUpdate();
    expect(TDD.stateController.rowReorder.dragging).to.not.be.null;
    document.body.dispatchEvent(pointerEvent('pointercancel', { clientX: 0, clientY: 0 }));
    expect(TDD.stateController.rowReorder.dragging).to.be.null;
    expect(TDD.stateController.rowReorder.ghost).to.be.null;
  });

  it('a grid detached mid-drag drops its ghost', async () => {
    const { row0, r0 } = press();
    row0.dispatchEvent(pointerEvent('pointermove', { clientX: r0.left + 8, clientY: r0.top + 20 }));
    await TDD.waitForUpdate();
    const reorder = TDD.stateController.rowReorder;
    expect(reorder.ghost).to.not.be.null;
    const parent = TDD.grid.parentElement!;
    TDD.grid.remove();
    expect(reorder.dragging).to.be.null;
    expect(reorder.ghost).to.be.null;
    parent.append(TDD.grid);
  });
});

describe('Row reorder: rowMoving and rowMoved report where the row lands', () => {
  beforeEach(async () => {
    TDD.rowReordering = { enabled: true };
    await TDD.setUp();
  });
  afterEach(() => TDD.tearDown());

  it('a move that changes nothing returns false and emits nothing', async () => {
    const events: string[] = [];
    TDD.grid.addEventListener('rowMoving', () => events.push('moving'));
    TDD.grid.addEventListener('rowMoved', () => events.push('moved'));
    expect(TDD.grid.moveRow(0, 1, 'before')).to.be.false;
    expect(TDD.grid.moveRow(3, 2, 'after')).to.be.false;
    await TDD.waitForUpdate();
    expect(events).to.deep.equal([]);
    expect(TDD.stateController.rowReorder.hasManualOrder).to.be.false;
  });

  it('a move across a synthesized parent that changes nothing is a no-op', async () => {
    TDD.grid.tree = {
      enabled: true,
      getDataPath: (row) => [row.id <= 4 ? 'A' : 'B', String(row.id)],
      defaultExpanded: true,
    };
    await TDD.waitForUpdate();
    const view = TDD.grid.pageItems;
    const from = view.indexOf(TDD.grid.data[3]);
    const to = view.indexOf(TDD.grid.data[4]);
    // Row 4 sits right before parent B, which sits right before row 5.
    expect(to - from).to.equal(2);
    let events = 0;
    TDD.grid.addEventListener('rowMoving', () => events++);
    expect(TDD.grid.moveRow(from, to, 'before')).to.be.false;
    expect(events).to.equal(0);
    expect(TDD.stateController.rowReorder.hasManualOrder).to.be.false;
  });

  it('carries the drop position and the resolved index', async () => {
    const details: unknown[] = [];
    const record = ({ detail }: CustomEvent) => {
      const { from, to, position, toIndex } = detail;
      details.push({ from, to, position, toIndex, id: detail.data.id });
    };
    TDD.grid.addEventListener('rowMoving', record);
    TDD.grid.addEventListener('rowMoved', record);

    expect(TDD.grid.moveRow(0, 5, 'before')).to.be.true;
    await TDD.waitForUpdate();
    expect(TDD.ids().indexOf(1)).to.equal(4);
    expect(TDD.grid.moveRow(5, 1, 'after')).to.be.true;
    await TDD.waitForUpdate();
    expect(TDD.ids().indexOf(6)).to.equal(2);

    const first = { from: 0, to: 5, position: 'before', toIndex: 4, id: 1 };
    const second = { from: 5, to: 1, position: 'after', toIndex: 2, id: 6 };
    expect(details).to.deep.equal([first, first, second, second]);
  });
});

describe('Row pinning: pins follow grid.data and rowPinning.enabled', () => {
  afterEach(() => fxPin.tearDown());
  const fxPin = new PinnedReorderFixture(data);

  it('drops pins whose row left the data (no rowId)', async () => {
    await fxPin.setUp();
    fxPin.grid.pinRow(fxPin.grid.data[2], 'top');
    await fxPin.waitForUpdate();
    fxPin.grid.data = freshCopy();
    await fxPin.waitForUpdate();
    expect(fxPin.grid.pinnedRows.top).to.deep.equal([]);
    expect(fxPin.ids()).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(fxPin.grid.shadowRoot!.querySelector('[part~="pinned-top"]')).to.be.null;
  });

  it('remaps pins to the fresh objects by rowId', async () => {
    await fxPin.setUp();
    fxPin.grid.rowId = (row) => row.id;
    fxPin.grid.pinRow(fxPin.grid.data[2], 'top');
    fxPin.grid.pinRow(fxPin.grid.data[5], 'bottom');
    await fxPin.waitForUpdate();
    const fresh = freshCopy();
    fresh[2].name = 'C-updated';
    fxPin.grid.data = fresh;
    await fxPin.waitForUpdate();
    expect(fxPin.grid.pinnedRows.top).to.deep.equal([fresh[2]]);
    expect(fxPin.grid.pinnedRows.top[0]).to.equal(fresh[2]);
    expect(fxPin.grid.pinnedRows.bottom[0]).to.equal(fresh[5]);
    expect(fxPin.ids()).to.deep.equal([1, 2, 4, 5, 7, 8]);
    expect(fxPin.grid.getState().rowPinning).to.deep.equal({
      top: [{ id: 3 }],
      bottom: [{ id: 6 }],
    });
  });

  it('disabling pinning reports no pins and re-enabling restores them', async () => {
    await fxPin.setUp();
    const baseline = fxPin.grid.getAttribute('aria-rowcount');
    const pinned = fxPin.grid.data[0];
    fxPin.grid.pinRow(pinned, 'top');
    await fxPin.waitForUpdate();
    expect(fxPin.grid.getAttribute('aria-rowcount')).to.equal(baseline);

    fxPin.grid.rowPinning = { enabled: false };
    await fxPin.waitForUpdate();
    expect(fxPin.grid.pinnedRows).to.deep.equal({ top: [], bottom: [] });
    expect(fxPin.stateController.rowPin.isPinned(pinned)).to.be.false;
    expect(fxPin.grid.getAttribute('aria-rowcount')).to.equal(baseline);
    const row0 = rowEl(fxPin, 0);
    expect(row0.getAttribute('aria-rowindex')).to.equal('2');
    expect(row0.shadowRoot?.querySelector('[part="reorder-handle"]')).to.exist;

    fxPin.grid.rowPinning = { enabled: true };
    await fxPin.waitForUpdate();
    expect(fxPin.grid.pinnedRows.top).to.deep.equal([pinned]);
    expect(fxPin.ids()).to.deep.equal([2, 3, 4, 5, 6, 7, 8]);
  });

  it('a snapshot taken while pinning is off keeps the pins', async () => {
    await fxPin.setUp();
    const pinned = fxPin.grid.data[2];
    fxPin.grid.pinRow(pinned, 'bottom');
    fxPin.grid.rowPinning = { enabled: false };
    await fxPin.waitForUpdate();
    const snapshot = fxPin.grid.getState();
    fxPin.grid.setState(snapshot);
    fxPin.grid.rowPinning = { enabled: true };
    await fxPin.waitForUpdate();
    expect(fxPin.grid.pinnedRows.bottom).to.deep.equal([pinned]);
  });
});
