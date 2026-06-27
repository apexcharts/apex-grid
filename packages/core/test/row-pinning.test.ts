import { expect, html } from '@open-wc/testing';
import type ApexGridRow from '../src/components/row.js';
import type {
  ColumnConfiguration,
  GridRowPinningConfiguration,
  GridSelectionConfiguration,
} from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

class PinFixture<T extends TestData> extends GridTestFixture<T> {
  public rowPinning: GridRowPinningConfiguration = { enabled: true };
  public selection: GridSelectionConfiguration = { enabled: true, mode: 'multiple' };

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
      .data=${this.data}
      .columns=${this.columnConfig}
      .rowPinning=${this.rowPinning}
      .selection=${this.selection}
    ></apex-grid>`;
  }

  public band(position: 'top' | 'bottom'): HTMLElement | null {
    return this.grid.renderRoot.querySelector<HTMLElement>(`[part~="pinned-${position}"]`);
  }

  public bandRows(position: 'top' | 'bottom'): ApexGridRow<T>[] {
    return Array.from(
      this.band(position)?.querySelectorAll('apex-grid-row') ?? []
    ) as unknown as ApexGridRow<T>[];
  }
}

const TDD = new PinFixture(data);
const TOTAL = data.length;

describe('Row pinning', () => {
  beforeEach(async () => await TDD.setUp());
  afterEach(() => TDD.tearDown());

  it('pins a row to the top band and reports it via the API', async () => {
    const row = TDD.grid.data[0];
    expect(TDD.grid.pinRow(row, 'top')).to.be.true;
    await TDD.waitForUpdate();

    expect(TDD.grid.pinnedRows.top).to.deep.equal([row]);
    expect(TDD.grid.pinnedRows.bottom).to.be.empty;
  });

  it('excludes pinned rows from the scrollable body (pageItems)', async () => {
    const row = TDD.grid.data[0];
    expect(TDD.grid.pageItems).to.have.lengthOf(TOTAL);
    expect(TDD.grid.pageItems).to.include(row);

    TDD.grid.pinRow(row, 'top');
    await TDD.waitForUpdate();

    expect(TDD.grid.pageItems).to.have.lengthOf(TOTAL - 1);
    expect(TDD.grid.pageItems).to.not.include(row);
  });

  it('renders the pinned row in the sticky top band', async () => {
    const row = TDD.grid.data[0];
    TDD.grid.pinRow(row, 'top');
    await TDD.waitForUpdate();

    const rows = TDD.bandRows('top');
    expect(rows).to.have.lengthOf(1);
    expect(rows[0].data).to.equal(row);
    expect(TDD.band('bottom')).to.not.exist;
  });

  it('pins to the bottom band', async () => {
    const row = TDD.grid.data[2];
    TDD.grid.pinRow(row, 'bottom');
    await TDD.waitForUpdate();

    expect(TDD.grid.pinnedRows.bottom).to.deep.equal([row]);
    expect(TDD.bandRows('bottom')).to.have.lengthOf(1);
    expect(TDD.band('top')).to.not.exist;
  });

  it('moves a row between bands without duplicating it', async () => {
    const row = TDD.grid.data[0];
    TDD.grid.pinRow(row, 'top');
    await TDD.waitForUpdate();
    TDD.grid.pinRow(row, 'bottom');
    await TDD.waitForUpdate();

    expect(TDD.grid.pinnedRows.top).to.be.empty;
    expect(TDD.grid.pinnedRows.bottom).to.deep.equal([row]);
  });

  it('unpins a row back into the body', async () => {
    const row = TDD.grid.data[0];
    TDD.grid.pinRow(row, 'top');
    await TDD.waitForUpdate();
    expect(TDD.grid.unpinRow(row)).to.be.true;
    await TDD.waitForUpdate();

    expect(TDD.grid.pinnedRows.top).to.be.empty;
    expect(TDD.grid.pageItems).to.include(row);
    expect(TDD.grid.pageItems).to.have.lengthOf(TOTAL);
    expect(TDD.band('top')).to.not.exist;
  });

  it('emits rowPinned with the target position', async () => {
    const seen: Array<{ position: unknown }> = [];
    TDD.grid.addEventListener('rowPinned', (event) =>
      seen.push({ position: event.detail.position })
    );

    const row = TDD.grid.data[0];
    TDD.grid.pinRow(row, 'top');
    await TDD.waitForUpdate();
    TDD.grid.unpinRow(row);
    await TDD.waitForUpdate();

    expect(seen).to.deep.equal([{ position: 'top' }, { position: null }]);
  });

  it('aborts pinning when rowPinning is cancelled', async () => {
    TDD.grid.addEventListener('rowPinning', (event) => event.preventDefault());

    const row = TDD.grid.data[0];
    expect(TDD.grid.pinRow(row, 'top')).to.be.false;
    await TDD.waitForUpdate();

    expect(TDD.grid.pinnedRows.top).to.be.empty;
    expect(TDD.grid.pageItems).to.include(row);
  });

  it('keeps a pinned row selected (selection is reference-based)', async () => {
    const row = TDD.grid.data[0];
    TDD.grid.selectRow(row);
    await TDD.waitForUpdate();
    expect(TDD.grid.selectedRows).to.include(row);

    TDD.grid.pinRow(row, 'top');
    await TDD.waitForUpdate();

    // Selection survives the pin, and the band row reflects it.
    expect(TDD.grid.selectedRows).to.include(row);
    expect(TDD.bandRows('top')[0].selected).to.be.true;
  });

  it('aria-rowcount counts pinned + body rows (total unchanged by pinning)', async () => {
    const before = TDD.grid.getAttribute('aria-rowcount');
    TDD.grid.pinRow(TDD.grid.data[0], 'top');
    await TDD.waitForUpdate();
    expect(TDD.grid.getAttribute('aria-rowcount')).to.equal(before);
  });

  it('pinned band rows expose role="row"', async () => {
    TDD.grid.pinRow(TDD.grid.data[0], 'top');
    await TDD.waitForUpdate();
    expect(TDD.bandRows('top')[0].getAttribute('role')).to.equal('row');
  });
});

class DisabledPinFixture<T extends TestData> extends PinFixture<T> {
  public override rowPinning: GridRowPinningConfiguration = { enabled: false };
}

describe('Row pinning — disabled', () => {
  const off = new DisabledPinFixture(data);
  beforeEach(async () => await off.setUp());
  afterEach(() => off.tearDown());

  it('is a no-op when rowPinning is not enabled', async () => {
    const row = off.grid.data[0];
    expect(off.grid.pinRow(row, 'top')).to.be.false;
    await off.waitForUpdate();

    expect(off.grid.pinnedRows.top).to.be.empty;
    expect(off.grid.pageItems).to.have.lengthOf(TOTAL);
    expect(off.band('top')).to.not.exist;
  });
});
