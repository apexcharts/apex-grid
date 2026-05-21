import { expect, html } from '@open-wc/testing';
import type { ColumnConfiguration } from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

class ReorderFixture<T extends TestData> extends GridTestFixture<T> {
  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number' },
      { key: 'name' },
      { key: 'active', type: 'boolean' },
      { key: 'importance' },
    ] as ColumnConfiguration<T>[];
  }

  public override setupTemplate() {
    return html`<apex-grid
      column-reordering
      .data=${this.data}
      .columns=${this.columnConfig}
    ></apex-grid>`;
  }

  public keys() {
    return this.grid.columns.map((column) => column.key);
  }

  public renderedHeaderKeys() {
    return this.headerRow.headers.map((header) => header.column.key);
  }
}

const TDD = new ReorderFixture(data);

describe('Column reordering — moveColumn() API', () => {
  beforeEach(async () => await TDD.setUp());
  afterEach(() => TDD.tearDown());

  it('moves a column before another, mutating columns array order', async () => {
    const applied = await TDD.grid.moveColumn('importance', 'name', 'before');
    expect(applied).to.be.true;
    expect(TDD.keys()).to.deep.equal(['id', 'importance', 'name', 'active']);
  });

  it('moves a column after another', async () => {
    const applied = await TDD.grid.moveColumn('id', 'active', 'after');
    expect(applied).to.be.true;
    expect(TDD.keys()).to.deep.equal(['name', 'active', 'id', 'importance']);
  });

  it('returns false for a no-op move', async () => {
    const applied = await TDD.grid.moveColumn('id', 'id');
    expect(applied).to.be.false;
  });

  it('returns false for an unknown key', async () => {
    const applied = await TDD.grid.moveColumn('does-not-exist' as never, 'name');
    expect(applied).to.be.false;
  });

  it('emits cancellable columnMoving and columnMoved around a move', async () => {
    const seen: string[] = [];
    TDD.grid.addEventListener('columnMoving', (event) => {
      seen.push(`moving:${event.detail.key}->${event.detail.toKey}/${event.detail.position}`);
    });
    TDD.grid.addEventListener('columnMoved', (event) => {
      seen.push(`moved:${event.detail.key}@${event.detail.toIndex}`);
    });

    const applied = await TDD.grid.moveColumn('importance', 'name', 'before');
    expect(applied).to.be.true;
    expect(seen).to.deep.equal(['moving:importance->name/before', 'moved:importance@1']);
  });

  it('cancellation aborts the move', async () => {
    TDD.grid.addEventListener('columnMoving', (event) => event.preventDefault());
    const applied = await TDD.grid.moveColumn('importance', 'name', 'before');
    expect(applied).to.be.false;
    expect(TDD.keys()).to.deep.equal(['id', 'name', 'active', 'importance']);
  });

  it('reflects the new order in rendered header cells', async () => {
    await TDD.grid.moveColumn('importance', 'id', 'before');
    await TDD.waitForUpdate();
    expect(TDD.renderedHeaderKeys()).to.deep.equal(['importance', 'id', 'name', 'active']);
  });
});

describe('Column reordering — pinning group constraint', () => {
  beforeEach(async () => await TDD.setUp());
  afterEach(() => TDD.tearDown());

  it('rejects moves between different pinning groups', async () => {
    await TDD.updateColumns({ key: 'id', pinned: 'start' });
    const applied = await TDD.grid.moveColumn('id', 'name', 'before');
    expect(applied).to.be.false;
    expect(TDD.keys()).to.deep.equal(['id', 'name', 'active', 'importance']);
  });

  it('allows moves within the same pinning group', async () => {
    await TDD.updateColumns([
      { key: 'id', pinned: 'start' },
      { key: 'name', pinned: 'start' },
    ]);
    const applied = await TDD.grid.moveColumn('name', 'id', 'before');
    expect(applied).to.be.true;
    expect(TDD.keys()).to.deep.equal(['name', 'id', 'active', 'importance']);
  });
});

class NoReorderFixture<T extends TestData> extends GridTestFixture<T> {
  public override setupTemplate() {
    return html`<apex-grid
      .data=${this.data}
      .columns=${this.columnConfig}
    ></apex-grid>`;
  }
}

describe('Column reordering — opt-out', () => {
  const offTDD = new NoReorderFixture(data);
  beforeEach(async () => await offTDD.setUp());
  afterEach(() => offTDD.tearDown());

  it('moveColumn still works even when drag is disabled (API is always available)', async () => {
    const applied = await offTDD.grid.moveColumn(
      offTDD.grid.columns[1].key,
      offTDD.grid.columns[0].key,
      'before'
    );
    expect(applied).to.be.true;
  });

  it('isDraggable() reports false for all columns when columnReordering is off', () => {
    // @ts-expect-error - protected access for the test
    const reorder = offTDD.grid.stateController.reordering;
    for (const column of offTDD.grid.columns) {
      expect(reorder.isDraggable(column)).to.be.false;
    }
  });
});

describe('Column reordering — pointer drag UX', () => {
  beforeEach(async () => await TDD.setUp());
  afterEach(() => TDD.tearDown());

  function headersByKey() {
    return new Map(TDD.headerRow.headers.map((h) => [h.column.key, h as unknown as HTMLElement]));
  }

  function pointerEvent(
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    init: { clientX: number; clientY: number; pointerId?: number; button?: number }
  ) {
    return new PointerEvent(type, {
      bubbles: true,
      composed: true,
      pointerId: init.pointerId ?? 1,
      button: init.button ?? 0,
      clientX: init.clientX,
      clientY: init.clientY,
    });
  }

  it('pointerdown alone does not start a drag (waits for movement threshold)', async () => {
    await TDD.waitForUpdate();
    const header = headersByKey().get('name')!;
    const rect = header.getBoundingClientRect();
    header.dispatchEvent(
      pointerEvent('pointerdown', { clientX: rect.left + 10, clientY: rect.top + 8 })
    );
    await TDD.waitForUpdate();

    expect(header.hasAttribute('data-dragging')).to.be.false;
    // @ts-expect-error - protected access for the test
    expect(TDD.grid.stateController.reordering.state).to.be.null;
  });

  it('moving past the drag threshold starts the drag and exposes ghost state', async () => {
    await TDD.waitForUpdate();
    const header = headersByKey().get('name')!;
    const rect = header.getBoundingClientRect();
    header.dispatchEvent(
      pointerEvent('pointerdown', { clientX: rect.left + 10, clientY: rect.top + 8 })
    );
    header.dispatchEvent(
      pointerEvent('pointermove', { clientX: rect.left + 40, clientY: rect.top + 8 })
    );
    await TDD.waitForUpdate();

    expect(header.hasAttribute('data-dragging')).to.be.true;
    // @ts-expect-error - protected access for the test
    const state = TDD.grid.stateController.reordering.state!;
    expect(state.sourceKey).to.equal('name');
    expect(state.ghostWidth).to.be.greaterThan(0);
    expect(state.label).to.equal('name');
  });

  it('live-swaps with the target column when the cursor crosses its midpoint', async () => {
    await TDD.waitForUpdate();
    const headers = headersByKey();
    const source = headers.get('name')!;
    const target = headers.get('active')!;
    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    source.dispatchEvent(
      pointerEvent('pointerdown', { clientX: sourceRect.left + 10, clientY: sourceRect.top + 8 })
    );
    source.dispatchEvent(
      pointerEvent('pointermove', {
        clientX: targetRect.left + targetRect.width * 0.75,
        clientY: targetRect.top + 8,
      })
    );
    await TDD.waitForUpdate();

    expect(TDD.keys()).to.deep.equal(['id', 'active', 'name', 'importance']);
  });

  it('pointerup ends the drag and leaves columns in their current order', async () => {
    await TDD.waitForUpdate();
    const headers = headersByKey();
    const source = headers.get('importance')!;
    const target = headers.get('id')!;
    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    source.dispatchEvent(
      pointerEvent('pointerdown', { clientX: sourceRect.left + 10, clientY: sourceRect.top + 8 })
    );
    source.dispatchEvent(
      pointerEvent('pointermove', {
        clientX: targetRect.left + targetRect.width * 0.25,
        clientY: targetRect.top + 8,
      })
    );
    source.dispatchEvent(
      pointerEvent('pointerup', { clientX: targetRect.left, clientY: targetRect.top + 8 })
    );
    await TDD.waitForUpdate();

    expect(TDD.keys()).to.deep.equal(['importance', 'id', 'name', 'active']);
    expect(source.hasAttribute('data-dragging')).to.be.false;
    // @ts-expect-error - protected access for the test
    expect(TDD.grid.stateController.reordering.state).to.be.null;
  });
});
