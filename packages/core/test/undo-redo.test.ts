import { aTimeout, elementUpdated, expect, html } from '@open-wc/testing';
import type { StateController } from '../src/controllers/state.js';
import type { ColumnConfiguration, GridEditingConfiguration } from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

class UndoFixture<T extends TestData> extends GridTestFixture<T> {
  public editing: GridEditingConfiguration = {
    enabled: true,
    mode: 'cell',
    trigger: 'doubleClick',
    history: { enabled: true },
  };

  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number', editable: true },
      { key: 'name', editable: true },
      { key: 'active', type: 'boolean', editable: true },
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
      .editing=${this.editing}
    ></apex-grid>`;
  }

  public get stateController(): StateController<T> {
    return (this.grid as unknown as { stateController: StateController<T> }).stateController;
  }

  public liveRegion(): HTMLElement | null {
    return this.grid.renderRoot.querySelector<HTMLElement>('[part="live-region"]');
  }

  /** Edit a cell and commit `value` through the public editor path. */
  public async edit(rowIndex: number, columnKey: string, value: string) {
    await this.grid.editCell(rowIndex, columnKey as never);
    await this.waitForUpdate();
    const row = this.rows.get(rowIndex);
    const cell = row.cells.get(columnKey as never).element;
    const input = cell.shadowRoot!.querySelector<HTMLInputElement>('input[data-apex-editor]')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await this.waitForUpdate();
  }
}

const TDD = new UndoFixture(data);

describe('Undo / redo — cell edits', () => {
  beforeEach(async () => await TDD.setUp());
  afterEach(() => TDD.tearDown());

  it('undoes and redoes a single cell edit', async () => {
    expect(TDD.grid.canUndo).to.be.false;

    await TDD.edit(0, 'name', 'Renamed');
    expect(TDD.grid.data[0].name).to.equal('Renamed');
    expect(TDD.grid.canUndo).to.be.true;
    expect(TDD.grid.canRedo).to.be.false;

    TDD.grid.undo();
    await TDD.waitForUpdate();
    expect(TDD.grid.data[0].name).to.equal('A');
    expect(TDD.grid.canUndo).to.be.false;
    expect(TDD.grid.canRedo).to.be.true;

    TDD.grid.redo();
    await TDD.waitForUpdate();
    expect(TDD.grid.data[0].name).to.equal('Renamed');
    expect(TDD.grid.canUndo).to.be.true;
    expect(TDD.grid.canRedo).to.be.false;
  });

  it('emits cellValueChanged on undo and redo (not cellValueChanging)', async () => {
    await TDD.edit(0, 'name', 'X');

    const changed: unknown[] = [];
    let changingCount = 0;
    TDD.grid.addEventListener('cellValueChanged', (event) => changed.push(event.detail.value));
    TDD.grid.addEventListener('cellValueChanging', () => {
      changingCount += 1;
    });

    TDD.grid.undo();
    await TDD.waitForUpdate();
    TDD.grid.redo();
    await TDD.waitForUpdate();

    expect(changed).to.deep.equal(['A', 'X']);
    expect(changingCount).to.equal(0);
  });

  it('emits historyChanged with canUndo / canRedo', async () => {
    const states: Array<{ canUndo: boolean; canRedo: boolean }> = [];
    TDD.grid.addEventListener('historyChanged', (event) =>
      states.push({ canUndo: event.detail.canUndo, canRedo: event.detail.canRedo })
    );

    await TDD.edit(0, 'name', 'X');
    TDD.grid.undo();
    await TDD.waitForUpdate();

    expect(states[0]).to.deep.equal({ canUndo: true, canRedo: false }); // recorded
    expect(states.at(-1)).to.deep.equal({ canUndo: false, canRedo: true }); // undone
  });

  it('clears the redo stack when a new edit is recorded', async () => {
    await TDD.edit(0, 'name', 'First');
    TDD.grid.undo();
    await TDD.waitForUpdate();
    expect(TDD.grid.canRedo).to.be.true;

    await TDD.edit(0, 'name', 'Second');
    expect(TDD.grid.canRedo).to.be.false;
    expect(TDD.grid.canUndo).to.be.true;
  });

  it('announces undo / redo through the live region', async () => {
    await TDD.edit(0, 'name', 'X');
    TDD.grid.undo();
    await aTimeout(0);
    await elementUpdated(TDD.grid);
    expect(TDD.liveRegion()!.textContent ?? '').to.match(/undo/i);

    TDD.grid.redo();
    await aTimeout(0);
    await elementUpdated(TDD.grid);
    expect(TDD.liveRegion()!.textContent ?? '').to.match(/redo/i);
  });

  it('undoes via Ctrl+Z and redoes via Ctrl+Y', async () => {
    await TDD.edit(0, 'name', 'Keyed');

    TDD.stateController.navigation.navigate(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })
    );
    await TDD.waitForUpdate();
    expect(TDD.grid.data[0].name).to.equal('A');

    TDD.stateController.navigation.navigate(
      new KeyboardEvent('keydown', { key: 'y', ctrlKey: true })
    );
    await TDD.waitForUpdate();
    expect(TDD.grid.data[0].name).to.equal('Keyed');
  });

  it('redoes via Ctrl+Shift+Z', async () => {
    await TDD.edit(0, 'name', 'Shifted');
    TDD.grid.undo();
    await TDD.waitForUpdate();

    TDD.stateController.navigation.navigate(
      new KeyboardEvent('keydown', { key: 'Z', ctrlKey: true, shiftKey: true })
    );
    await TDD.waitForUpdate();
    expect(TDD.grid.data[0].name).to.equal('Shifted');
  });

  it('evicts the oldest command past the configured stack size', async () => {
    TDD.grid.editing = { ...TDD.editing, history: { enabled: true, stackSize: 2 } };
    await TDD.waitForUpdate();

    await TDD.edit(0, 'name', 'X'); // A -> X (evicted)
    await TDD.edit(0, 'name', 'Y'); // X -> Y
    await TDD.edit(0, 'name', 'Z'); // Y -> Z

    TDD.grid.undo(); // -> Y
    await TDD.waitForUpdate();
    TDD.grid.undo(); // -> X
    await TDD.waitForUpdate();
    expect(TDD.grid.canUndo).to.be.false; // oldest (A -> X) was evicted

    TDD.grid.undo(); // no-op
    await TDD.waitForUpdate();
    expect(TDD.grid.data[0].name).to.equal('X');
  });

  it('clearHistory empties both stacks', async () => {
    await TDD.edit(0, 'name', 'X');
    TDD.grid.undo();
    await TDD.waitForUpdate();
    expect(TDD.grid.canRedo).to.be.true;

    TDD.grid.clearHistory();
    expect(TDD.grid.canUndo).to.be.false;
    expect(TDD.grid.canRedo).to.be.false;
  });

  it('is disabled (no recording) without editing.history', async () => {
    TDD.grid.editing = { enabled: true, mode: 'cell', trigger: 'doubleClick' };
    await TDD.waitForUpdate();

    await TDD.edit(0, 'name', 'X');
    expect(TDD.grid.data[0].name).to.equal('X');
    expect(TDD.grid.canUndo).to.be.false;
    TDD.grid.undo();
    await TDD.waitForUpdate();
    expect(TDD.grid.data[0].name).to.equal('X'); // undo is a no-op
  });
});

class RowUndoFixture<T extends TestData> extends UndoFixture<T> {
  public override editing: GridEditingConfiguration = {
    enabled: true,
    mode: 'row',
    history: { enabled: true },
  };
}

describe('Undo / redo — row mode', () => {
  const rowTDD = new RowUndoFixture(data);
  beforeEach(async () => await rowTDD.setUp());
  afterEach(() => rowTDD.tearDown());

  it('undoes a whole row commit as one step', async () => {
    await rowTDD.grid.editRow(0);

    await rowTDD.grid.editCell(0, 'name');
    await rowTDD.waitForUpdate();
    let input = rowTDD.rows
      .get(0)
      .cells.get('name' as never)
      .element.shadowRoot!.querySelector<HTMLInputElement>('input[data-apex-editor]')!;
    input.value = 'NewName';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await rowTDD.waitForUpdate();

    await rowTDD.grid.editCell(0, 'id');
    await rowTDD.waitForUpdate();
    input = rowTDD.rows
      .get(0)
      .cells.get('id' as never)
      .element.shadowRoot!.querySelector<HTMLInputElement>('input[data-apex-editor]')!;
    input.value = '999';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await rowTDD.waitForUpdate();

    await rowTDD.grid.commitEdit();
    await rowTDD.waitForUpdate();
    expect(rowTDD.grid.data[0].name).to.equal('NewName');
    expect(rowTDD.grid.data[0].id).to.equal(999);

    // One undo reverts both cells.
    rowTDD.grid.undo();
    await rowTDD.waitForUpdate();
    expect(rowTDD.grid.data[0].name).to.equal('A');
    expect(rowTDD.grid.data[0].id).to.equal(1);
    expect(rowTDD.grid.canUndo).to.be.false;
  });
});
