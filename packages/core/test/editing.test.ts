import { expect, html } from '@open-wc/testing';
import type { ColumnConfiguration, GridEditingConfiguration } from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

class EditingFixture<T extends TestData> extends GridTestFixture<T> {
  public editing: GridEditingConfiguration = {
    enabled: true,
    mode: 'cell',
    trigger: 'doubleClick',
  };

  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number' },
      { key: 'name', editable: true },
      { key: 'active', type: 'boolean', editable: true },
      { key: 'importance' },
    ] as ColumnConfiguration<T>[];
  }

  public override async setUp() {
    // Editing mutates source rows by design, so reset the fixture's data to a
    // fresh clone before every test so mutations don't leak.
    this.data = JSON.parse(JSON.stringify(data)) as T[];
    await super.setUp();
  }

  public override setupTemplate() {
    return html`<apex-grid
      .data=${this.data}
      .columns=${this.columnConfig}
      .editing=${this.editing}
    ></apex-grid>`;
  }

  public cellInput(rowIndex: number, columnKey: string): HTMLInputElement | null {
    const row = this.rows.get(rowIndex);
    const cell = row.cells.get(columnKey as never).element;
    return cell.shadowRoot!.querySelector<HTMLInputElement>('input[data-apex-editor]');
  }
}

const TDD = new EditingFixture(data);

describe('Inline editing — cell mode', () => {
  beforeEach(async () => await TDD.setUp());
  afterEach(() => TDD.tearDown());

  it('does nothing for columns without `editable: true`', async () => {
    const applied = await TDD.grid.editCell(0, 'id');
    expect(applied).to.be.false;
    expect(TDD.grid.editingCell).to.be.null;
  });

  it('begins editing an editable cell and renders an input', async () => {
    const applied = await TDD.grid.editCell(0, 'name');
    await TDD.waitForUpdate();
    expect(applied).to.be.true;
    expect(TDD.grid.editingCell).to.deep.equal({ rowIndex: 0, columnKey: 'name' });
    expect(TDD.cellInput(0, 'name')).to.exist;
  });

  it('renders a text input for string columns and a number input for number columns', async () => {
    await TDD.updateColumns({ key: 'id', editable: true });
    await TDD.grid.editCell(0, 'name');
    await TDD.waitForUpdate();
    expect(TDD.cellInput(0, 'name')!.type).to.equal('text');

    TDD.grid.cancelEdit();
    await TDD.waitForUpdate();
    await TDD.grid.editCell(0, 'id');
    await TDD.waitForUpdate();
    expect(TDD.cellInput(0, 'id')!.type).to.equal('number');
  });

  it('renders a checkbox for boolean columns', async () => {
    await TDD.grid.editCell(0, 'active');
    await TDD.waitForUpdate();
    const input = TDD.cellInput(0, 'active');
    expect(input).to.exist;
    expect(input!.type).to.equal('checkbox');
  });

  it('commits a text edit through cellValueChanging + cellValueChanged', async () => {
    const seen: string[] = [];
    TDD.grid.addEventListener('cellValueChanging', (event) => {
      seen.push(`changing:${event.detail.oldValue}->${event.detail.newValue}`);
    });
    TDD.grid.addEventListener('cellValueChanged', (event) => {
      seen.push(`changed:${event.detail.value}`);
    });

    await TDD.grid.editCell(0, 'name');
    await TDD.waitForUpdate();
    const input = TDD.cellInput(0, 'name')!;
    input.value = 'Renamed';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await TDD.waitForUpdate();

    expect(seen).to.deep.equal(['changing:A->Renamed', 'changed:Renamed']);
    expect(TDD.grid.data[0].name).to.equal('Renamed');
    expect(TDD.grid.editingCell).to.be.null;
  });

  it('aborts the commit when cellValueChanging is cancelled', async () => {
    TDD.grid.addEventListener('cellValueChanging', (event) => event.preventDefault());

    await TDD.grid.editCell(0, 'name');
    await TDD.waitForUpdate();
    const input = TDD.cellInput(0, 'name')!;
    input.value = 'WontStick';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await TDD.waitForUpdate();

    expect(TDD.grid.data[0].name).to.equal('A');
  });

  it('Escape discards the in-flight value', async () => {
    await TDD.grid.editCell(0, 'name');
    await TDD.waitForUpdate();
    const input = TDD.cellInput(0, 'name')!;
    input.value = 'Discarded';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await TDD.waitForUpdate();

    expect(TDD.grid.data[0].name).to.equal('A');
    expect(TDD.grid.editingCell).to.be.null;
  });

  it('toggling the checkbox writes a boolean immediately', async () => {
    await TDD.grid.editCell(0, 'active');
    await TDD.waitForUpdate();
    const input = TDD.cellInput(0, 'active')!;
    input.checked = !input.checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await TDD.waitForUpdate();

    expect(TDD.grid.data[0].active).to.equal(true);
  });
});

class RowEditingFixture<T extends TestData> extends EditingFixture<T> {
  public override editing: GridEditingConfiguration = { enabled: true, mode: 'row' };
}

describe('Inline editing — row mode', () => {
  const rowTDD = new RowEditingFixture(data);
  beforeEach(async () => await rowTDD.setUp());
  afterEach(() => rowTDD.tearDown());

  it('editRow opens the row and emits rowEditStarted', async () => {
    const seen: number[] = [];
    rowTDD.grid.addEventListener('rowEditStarted', (event) => seen.push(event.detail.rowIndex));

    const applied = await rowTDD.grid.editRow(0);
    expect(applied).to.be.true;
    expect(rowTDD.grid.editingRow).to.equal(0);
    expect(seen).to.deep.equal([0]);
  });

  it('stages cell edits until commitEdit batches them', async () => {
    const cellChanged: string[] = [];
    rowTDD.grid.addEventListener('cellValueChanged', (event) =>
      cellChanged.push(`${String(event.detail.key)}=${event.detail.value}`)
    );
    let endedWith: boolean | null = null;
    rowTDD.grid.addEventListener('rowEditEnded', (event) => {
      endedWith = event.detail.committed;
    });

    await rowTDD.grid.editRow(0);

    await rowTDD.grid.editCell(0, 'name');
    await rowTDD.waitForUpdate();
    const nameInput = rowTDD.cellInput(0, 'name')!;
    nameInput.value = 'Updated';
    nameInput.dispatchEvent(new Event('input'));
    nameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await rowTDD.waitForUpdate();

    // Row is still open and the source hasn't been mutated yet.
    expect(rowTDD.grid.data[0].name).to.equal('A');
    expect(rowTDD.grid.editingRow).to.equal(0);

    await rowTDD.grid.commitEdit();
    await rowTDD.waitForUpdate();

    expect(rowTDD.grid.data[0].name).to.equal('Updated');
    expect(cellChanged).to.deep.equal(['name=Updated']);
    expect(endedWith).to.equal(true);
    expect(rowTDD.grid.editingRow).to.be.null;
  });

  it('cancelEdit discards all pending edits', async () => {
    await rowTDD.grid.editRow(0);
    await rowTDD.grid.editCell(0, 'name');
    await rowTDD.waitForUpdate();
    const nameInput = rowTDD.cellInput(0, 'name')!;
    nameInput.value = 'Discarded';
    nameInput.dispatchEvent(new Event('input'));
    nameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await rowTDD.waitForUpdate();

    rowTDD.grid.cancelEdit();
    await rowTDD.waitForUpdate();
    expect(rowTDD.grid.data[0].name).to.equal('A');
    expect(rowTDD.grid.editingRow).to.be.null;
  });
});
