import { expect, html } from '@open-wc/testing';
import type { ColumnConfiguration, GridSelectionConfiguration } from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

class SelectionFixture<T extends TestData> extends GridTestFixture<T> {
  public selection: GridSelectionConfiguration = {
    enabled: true,
    mode: 'multiple',
    showCheckboxColumn: true,
  };
  public records!: T[];

  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number' },
      { key: 'name' },
      { key: 'active', type: 'boolean' },
      { key: 'importance' },
    ] as ColumnConfiguration<T>[];
  }

  public override async setUp() {
    this.records = JSON.parse(JSON.stringify(data)) as T[];
    this.data = this.records;
    await super.setUp();
  }

  public override setupTemplate() {
    return html`<apex-grid
      .data=${this.data}
      .columns=${this.columnConfig}
      .selection=${this.selection}
    ></apex-grid>`;
  }

  public headerCheckbox(): HTMLInputElement | null {
    return this.headerRow.renderRoot.querySelector<HTMLInputElement>(
      '[part="selection-header"] input[type="checkbox"]'
    );
  }

  public rowCheckbox(rowIndex: number): HTMLInputElement | null {
    return this.rows
      .get(rowIndex)
      .element.renderRoot.querySelector<HTMLInputElement>(
        '[part="selection-cell"] input[type="checkbox"]'
      );
  }

  public rowSelectedAttr(rowIndex: number): boolean {
    return this.rows.get(rowIndex).element.hasAttribute('selected');
  }
}

const TDD = new SelectionFixture(data);

describe('Row selection — public API', () => {
  beforeEach(async () => {
    TDD.selection = { enabled: true, mode: 'multiple', showCheckboxColumn: true };
    await TDD.setUp();
  });
  afterEach(() => TDD.tearDown());

  it('selectedRows is empty by default', () => {
    expect(TDD.grid.selectedRows).to.deep.equal([]);
  });

  it('selectRow adds a single row', async () => {
    const ok = await TDD.grid.selectRow(TDD.records[2]);
    expect(ok).to.be.true;
    expect(TDD.grid.selectedRows).to.deep.equal([TDD.records[2]]);
  });

  it('selectRow on a second row leaves both selected in multi mode', async () => {
    await TDD.grid.selectRow(TDD.records[0]);
    await TDD.grid.selectRow(TDD.records[3]);
    expect(TDD.grid.selectedRows).to.have.length(2);
  });

  it('deselectRow removes a row from the set', async () => {
    await TDD.grid.selectRow(TDD.records[0]);
    await TDD.grid.selectRow(TDD.records[1]);
    await TDD.grid.deselectRow(TDD.records[0]);
    expect(TDD.grid.selectedRows).to.deep.equal([TDD.records[1]]);
  });

  it('toggleRowSelection flips selection', async () => {
    await TDD.grid.toggleRowSelection(TDD.records[2]);
    expect(TDD.grid.isRowSelected(TDD.records[2])).to.be.true;
    await TDD.grid.toggleRowSelection(TDD.records[2]);
    expect(TDD.grid.isRowSelected(TDD.records[2])).to.be.false;
  });

  it('selectAllRows selects every row in dataView', async () => {
    await TDD.grid.selectAllRows();
    expect(TDD.grid.selectedRows).to.have.length(TDD.records.length);
  });

  it('clearSelection empties the set', async () => {
    await TDD.grid.selectAllRows();
    await TDD.grid.clearSelection();
    expect(TDD.grid.selectedRows).to.deep.equal([]);
  });

  it('selectedRows setter replaces selection', async () => {
    TDD.grid.selectedRows = [TDD.records[1], TDD.records[3]];
    await TDD.waitForUpdate();
    expect(TDD.grid.selectedRows).to.have.length(2);
    expect(TDD.grid.isRowSelected(TDD.records[1])).to.be.true;
    expect(TDD.grid.isRowSelected(TDD.records[3])).to.be.true;
    expect(TDD.grid.isRowSelected(TDD.records[0])).to.be.false;
  });
});

describe('Row selection — events', () => {
  beforeEach(async () => {
    TDD.selection = { enabled: true, mode: 'multiple', showCheckboxColumn: true };
    await TDD.setUp();
  });
  afterEach(() => TDD.tearDown());

  it('emits cancellable rowSelecting then rowSelected on selectRow', async () => {
    const seen: string[] = [];
    TDD.grid.addEventListener('rowSelecting', (event) => {
      seen.push(
        `selecting:added=${event.detail.added.length}/removed=${event.detail.removed.length}`
      );
    });
    TDD.grid.addEventListener('rowSelected', (event) => {
      seen.push(`selected:total=${event.detail.selected.length}`);
    });
    await TDD.grid.selectRow(TDD.records[2]);
    expect(seen).to.deep.equal(['selecting:added=1/removed=0', 'selected:total=1']);
  });

  it('rowSelecting.preventDefault() aborts the change', async () => {
    TDD.grid.addEventListener('rowSelecting', (event) => event.preventDefault());
    const ok = await TDD.grid.selectRow(TDD.records[0]);
    expect(ok).to.be.false;
    expect(TDD.grid.selectedRows).to.deep.equal([]);
  });

  it('does not emit when nothing actually changes', async () => {
    await TDD.grid.selectRow(TDD.records[0]);
    let count = 0;
    TDD.grid.addEventListener('rowSelecting', () => count++);
    await TDD.grid.selectRow(TDD.records[0]); // already selected
    expect(count).to.equal(0);
  });
});

describe('Row selection — single mode', () => {
  beforeEach(async () => {
    TDD.selection = { enabled: true, mode: 'single', showCheckboxColumn: true };
    await TDD.setUp();
  });
  afterEach(() => TDD.tearDown());

  it('keeps at most one row selected', async () => {
    await TDD.grid.selectRow(TDD.records[0]);
    await TDD.grid.selectRow(TDD.records[3]);
    expect(TDD.grid.selectedRows).to.deep.equal([TDD.records[3]]);
  });

  it('selectAllRows is a no-op in single mode', async () => {
    const ok = await TDD.grid.selectAllRows();
    expect(ok).to.be.false;
    expect(TDD.grid.selectedRows).to.deep.equal([]);
  });

  it('setting selectedRows to an array keeps only the first entry', async () => {
    TDD.grid.selectedRows = [TDD.records[0], TDD.records[1], TDD.records[2]];
    await TDD.waitForUpdate();
    expect(TDD.grid.selectedRows).to.deep.equal([TDD.records[0]]);
  });
});

describe('Row selection — UI', () => {
  beforeEach(async () => {
    TDD.selection = { enabled: true, mode: 'multiple', showCheckboxColumn: true };
    await TDD.setUp();
  });
  afterEach(() => TDD.tearDown());

  it('renders a checkbox cell at the start of each row when enabled', () => {
    expect(TDD.rowCheckbox(0)).to.exist;
    expect(TDD.rowCheckbox(0)!.type).to.equal('checkbox');
  });

  it('row checkbox reflects selection state', async () => {
    expect(TDD.rowCheckbox(2)!.checked).to.be.false;
    await TDD.grid.selectRow(TDD.records[2]);
    await TDD.waitForUpdate();
    expect(TDD.rowCheckbox(2)!.checked).to.be.true;
  });

  it('reflects [selected] attribute on the row element', async () => {
    expect(TDD.rowSelectedAttr(0)).to.be.false;
    await TDD.grid.selectRow(TDD.records[0]);
    await TDD.waitForUpdate();
    expect(TDD.rowSelectedAttr(0)).to.be.true;
  });

  it('toggling the row checkbox commits selection', async () => {
    const checkbox = TDD.rowCheckbox(1)!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await TDD.waitForUpdate();
    expect(TDD.grid.isRowSelected(TDD.records[1])).to.be.true;
  });

  it('header select-all checkbox toggles every row in view', async () => {
    const header = TDD.headerCheckbox()!;
    header.checked = true;
    header.dispatchEvent(new Event('change', { bubbles: true }));
    await TDD.waitForUpdate();
    expect(TDD.grid.selectedRows).to.have.length(TDD.records.length);
  });

  it('header checkbox unchecks to clear the selection', async () => {
    await TDD.grid.selectAllRows();
    await TDD.waitForUpdate();
    const header = TDD.headerCheckbox()!;
    expect(header.checked).to.be.true;
    header.checked = false;
    header.dispatchEvent(new Event('change', { bubbles: true }));
    await TDD.waitForUpdate();
    expect(TDD.grid.selectedRows).to.deep.equal([]);
  });

  it('header checkbox reads indeterminate when some — but not all — rows are selected', async () => {
    await TDD.grid.selectRow(TDD.records[0]);
    await TDD.waitForUpdate();
    expect(TDD.headerCheckbox()!.indeterminate).to.be.true;
  });
});

class NoSelectionFixture<T extends TestData> extends GridTestFixture<T> {
  public records!: T[];

  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number' },
      { key: 'name' },
    ] as ColumnConfiguration<T>[];
  }

  public override async setUp() {
    this.records = JSON.parse(JSON.stringify(data)) as T[];
    this.data = this.records;
    await super.setUp();
  }

  public override setupTemplate() {
    return html`<apex-grid
      .data=${this.data}
      .columns=${this.columnConfig}
    ></apex-grid>`;
  }
}

describe('Row selection — opt-out', () => {
  const offTDD = new NoSelectionFixture(data);
  beforeEach(async () => await offTDD.setUp());
  afterEach(() => offTDD.tearDown());

  it('selection API is no-op when not enabled', async () => {
    const ok = await offTDD.grid.selectRow(offTDD.records[0]);
    expect(ok).to.be.false;
    expect(offTDD.grid.selectedRows).to.deep.equal([]);
  });

  it('no checkbox column is rendered when selection is disabled', () => {
    const cell = offTDD.rows.get(0).element.renderRoot.querySelector('[part="selection-cell"]');
    expect(cell).to.be.null;
  });
});
