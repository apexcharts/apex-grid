import { expect, html } from '@open-wc/testing';
import type { ColumnConfiguration } from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

class PinningFixture<T extends TestData> extends GridTestFixture<T> {
  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number', width: '80px' },
      { key: 'name', width: '120px' },
      { key: 'active', type: 'boolean', width: '100px' },
      { key: 'importance', width: '120px' },
    ] as ColumnConfiguration<T>[];
  }

  public override setupTemplate() {
    return html`<apex-grid .data=${this.data} .columns=${this.columnConfig}></apex-grid>`;
  }

  public displayKeys() {
    return this.grid.displayColumns.map((column) => column.key);
  }

  public renderedHeaderKeys() {
    return this.headerRow.headers.map((header) => header.column.key);
  }

  public renderedRowKeys() {
    return this.rows.first.element.cells.map((cell) => cell.column.key);
  }
}

const TDD = new PinningFixture(data);

describe('Column pinning — display order', () => {
  beforeEach(async () => await TDD.setUp());
  afterEach(() => TDD.tearDown());

  it('preserves original order when nothing is pinned', () => {
    expect(TDD.displayKeys()).to.deep.equal(['id', 'name', 'active', 'importance']);
  });

  it('moves start-pinned columns to the front (preserving relative order)', async () => {
    await TDD.updateColumns([
      { key: 'importance', pinned: 'start' },
      { key: 'active', pinned: 'start' },
    ]);
    // 'active' precedes 'importance' in the source array; relative order is preserved.
    expect(TDD.displayKeys()).to.deep.equal(['active', 'importance', 'id', 'name']);
  });

  it('moves end-pinned columns to the back (preserving relative order)', async () => {
    await TDD.updateColumns([
      { key: 'id', pinned: 'end' },
      { key: 'name', pinned: 'end' },
    ]);
    expect(TDD.displayKeys()).to.deep.equal(['active', 'importance', 'id', 'name']);
  });

  it('combines start- and end-pinned around the unpinned middle', async () => {
    await TDD.updateColumns([
      { key: 'id', pinned: 'start' },
      { key: 'importance', pinned: 'end' },
    ]);
    expect(TDD.displayKeys()).to.deep.equal(['id', 'name', 'active', 'importance']);
  });

  it('does not mutate the user-supplied columns array', async () => {
    const originalKeys = TDD.grid.columns.map((c) => c.key);
    await TDD.updateColumns({ key: 'active', pinned: 'start' });
    expect(TDD.grid.columns.map((c) => c.key)).to.deep.equal(originalKeys);
  });

  it('renders headers and body cells in display order', async () => {
    await TDD.updateColumns([
      { key: 'active', pinned: 'start' },
      { key: 'name', pinned: 'end' },
    ]);
    expect(TDD.renderedHeaderKeys()).to.deep.equal(['active', 'id', 'importance', 'name']);
    expect(TDD.renderedRowKeys()).to.deep.equal(['active', 'id', 'importance', 'name']);
  });
});

describe('Column pinning — pinColumn() API + events', () => {
  beforeEach(async () => await TDD.setUp());
  afterEach(() => TDD.tearDown());

  it('emits cancellable columnPinning and columnPinned around the change', async () => {
    const seen: string[] = [];
    TDD.grid.addEventListener('columnPinning', (event) => {
      seen.push(`pinning:${event.detail.next}`);
    });
    TDD.grid.addEventListener('columnPinned', (event) => {
      seen.push(`pinned:${event.detail.pinned}`);
    });

    const applied = await TDD.grid.pinColumn('name', 'start');
    expect(applied).to.be.true;
    expect(seen).to.deep.equal(['pinning:start', 'pinned:start']);
    expect(TDD.grid.getColumn('name')?.pinned).to.equal('start');
  });

  it('cancellation aborts the change and leaves pinned state untouched', async () => {
    TDD.grid.addEventListener('columnPinning', (event) => event.preventDefault());
    const applied = await TDD.grid.pinColumn('name', 'start');
    expect(applied).to.be.false;
    expect(TDD.grid.getColumn('name')?.pinned).to.be.undefined;
  });

  it('is a no-op when the pin position does not change', async () => {
    await TDD.grid.pinColumn('name', 'start');
    let firedAgain = false;
    TDD.grid.addEventListener('columnPinning', () => {
      firedAgain = true;
    });
    const applied = await TDD.grid.pinColumn('name', 'start');
    expect(applied).to.be.false;
    expect(firedAgain).to.be.false;
  });

  it('unpinColumn() removes the pin position', async () => {
    await TDD.grid.pinColumn('name', 'end');
    expect(TDD.grid.getColumn('name')?.pinned).to.equal('end');
    const applied = await TDD.grid.unpinColumn('name');
    await TDD.waitForUpdate();
    expect(applied).to.be.true;
    expect(TDD.grid.getColumn('name')?.pinned ?? null).to.be.null;
  });

  it('reflects pin changes in the rendered display order without mutating columns', async () => {
    await TDD.grid.pinColumn('active', 'start');
    await TDD.waitForUpdate();
    expect(TDD.renderedHeaderKeys()).to.deep.equal(['active', 'id', 'name', 'importance']);
  });

  it('returns false for an unknown column key', async () => {
    const applied = await TDD.grid.pinColumn('does-not-exist' as never, 'start');
    expect(applied).to.be.false;
  });
});

describe('Column pinning — DOM markers', () => {
  beforeEach(async () => await TDD.setUp());
  afterEach(() => TDD.tearDown());

  it('applies data-pinned and data-pin-edge attributes to header cells', async () => {
    await TDD.updateColumns([
      { key: 'id', pinned: 'start' },
      { key: 'active', pinned: 'start' },
      { key: 'importance', pinned: 'end' },
    ]);

    const headers = TDD.headerRow.headers;
    const byKey = new Map(headers.map((h) => [h.column.key, h]));

    expect(byKey.get('id')!.getAttribute('data-pinned')).to.equal('start');
    expect(byKey.get('id')!.getAttribute('data-pin-edge')).to.equal('none');

    // 'active' is the last start-pinned in display order — marked as edge.
    expect(byKey.get('active')!.getAttribute('data-pinned')).to.equal('start');
    expect(byKey.get('active')!.getAttribute('data-pin-edge')).to.equal('start');

    // 'importance' is the first end-pinned — also edge.
    expect(byKey.get('importance')!.getAttribute('data-pinned')).to.equal('end');
    expect(byKey.get('importance')!.getAttribute('data-pin-edge')).to.equal('end');

    // 'name' is unpinned.
    expect(byKey.get('name')!.getAttribute('data-pinned')).to.equal('none');
  });
});
