import { expect, html } from '@open-wc/testing';
import type ApexGridRow from '../src/components/row.js';
import type { StateController } from '../src/controllers/state.js';
import type {
  ColumnConfiguration,
  GridRowPinningConfiguration,
  GridSelectionConfiguration,
} from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

/**
 * `selection.isRowSelectable`: a row the predicate rejects renders no
 * checkbox, carries no aria-selected and is refused by every selection path
 * (GitHub #38: a pinned total row). Pinned rows stay selectable by default.
 */
class SelectableFixture extends GridTestFixture<TestData> {
  public selection: GridSelectionConfiguration<TestData> = {};
  public rowPinning: GridRowPinningConfiguration = { enabled: true };
  public records!: TestData[];

  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number' },
      { key: 'name' },
      { key: 'active', type: 'boolean' },
      { key: 'importance' },
    ] as ColumnConfiguration<TestData>[];
  }

  public override async setUp() {
    this.records = JSON.parse(JSON.stringify(data)) as TestData[];
    this.data = this.records;
    await super.setUp();
  }

  public override setupTemplate() {
    return html`<apex-grid
      .data=${this.data}
      .columns=${this.columnConfig}
      .rowPinning=${this.rowPinning}
      .selection=${this.selection}
    ></apex-grid>`;
  }

  public rowFor(record: TestData): ApexGridRow<TestData> {
    const rows = Array.from(
      this.grid.renderRoot.querySelectorAll('apex-grid-row')
    ) as unknown as ApexGridRow<TestData>[];
    return rows.find((row) => row.data === record)!;
  }

  public selectionCell(record: TestData): HTMLElement {
    return this.rowFor(record).renderRoot.querySelector<HTMLElement>('[part="selection-cell"]')!;
  }

  public checkbox(record: TestData): HTMLInputElement | null {
    return this.selectionCell(record).querySelector('input');
  }

  public headerCheckbox(): HTMLInputElement {
    return this.headerRow.renderRoot.querySelector<HTMLInputElement>(
      '[part="selection-header"] input'
    )!;
  }

  public async pinTotal(): Promise<TestData> {
    const total = this.records.at(-1)!;
    this.grid.pinRow(total, 'bottom');
    await this.waitForUpdate();
    return total;
  }

  public async press(record: TestData, init: KeyboardEventInit) {
    const state = (this.grid as unknown as { stateController: StateController<TestData> })
      .stateController;
    state.active = { column: 'name', row: this.grid.pageItems.indexOf(record) };
    await this.waitForUpdate();
    await this.fireNavigationEvent(init);
  }
}

const TDD = new SelectableFixture(data);
const BASE: GridSelectionConfiguration<TestData> = {
  enabled: true,
  mode: 'multiple',
  showCheckboxColumn: true,
};

describe('Selectable rows (isRowSelectable)', () => {
  afterEach(() => TDD.tearDown());

  describe('without a predicate', () => {
    beforeEach(async () => {
      TDD.selection = { ...BASE };
      await TDD.setUp();
    });

    it('a pinned row keeps its checkbox and can be selected', async () => {
      const total = await TDD.pinTotal();
      const box = TDD.checkbox(total);
      expect(box, 'pinned checkbox').to.exist;
      box!.click();
      await TDD.waitForUpdate();
      expect(TDD.grid.selectedRows).to.deep.equal([total]);
      expect(TDD.rowFor(total).getAttribute('aria-selected')).to.equal('true');
    });
  });

  describe('a pinned total row the predicate rejects', () => {
    let total: TestData;

    beforeEach(async () => {
      TDD.selection = { ...BASE, isRowSelectable: (row) => row.name !== 'd' };
      await TDD.setUp();
      total = await TDD.pinTotal();
    });

    it('renders the selection cell without a checkbox or aria-selected', () => {
      const cell = TDD.selectionCell(total);
      expect(cell, 'cell kept for alignment').to.exist;
      expect(cell.getAttribute('role')).to.equal('gridcell');
      expect(cell.querySelector('input, button, [tabindex]')).to.be.null;
      expect(TDD.rowFor(total).hasAttribute('aria-selected')).to.be.false;
      // Selectable rows still announce their state.
      expect(TDD.rowFor(TDD.records[0]).getAttribute('aria-selected')).to.equal('false');
      expect(TDD.checkbox(TDD.records[0])).to.exist;
    });

    it('a click on the empty selection cell selects nothing', async () => {
      TDD.selectionCell(total).click();
      await TDD.waitForUpdate();
      expect(TDD.grid.selectedRows).to.deep.equal([]);
    });

    it('Shift and Ctrl clicks on the cell select nothing', async () => {
      await TDD.grid.selectRow(TDD.records[0]);
      const cell = TDD.selectionCell(total);
      cell.dispatchEvent(
        new MouseEvent('click', { bubbles: true, composed: true, shiftKey: true })
      );
      await TDD.waitForUpdate();
      expect(TDD.grid.selectedRows, 'after Shift+click').to.deep.equal([TDD.records[0]]);
      cell.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, ctrlKey: true }));
      await TDD.waitForUpdate();
      expect(TDD.grid.selectedRows, 'after Ctrl+click').to.deep.equal([TDD.records[0]]);
    });

    it('selectRow, toggleRowSelection and the selectedRows setter refuse it', async () => {
      expect(await TDD.grid.selectRow(total)).to.be.false;
      expect(await TDD.grid.toggleRowSelection(total)).to.be.false;
      TDD.grid.selectedRows = [TDD.records[0], total];
      await TDD.waitForUpdate();
      expect(TDD.grid.selectedRows).to.deep.equal([TDD.records[0]]);
      expect(TDD.grid.isRowSelected(total)).to.be.false;
    });

    it('Select all skips it and the header counts only selectable rows', async () => {
      TDD.headerCheckbox().click();
      await TDD.waitForUpdate();
      expect(TDD.grid.selectedRows).to.not.include(total);
      expect(TDD.grid.selectedRows).to.have.length(TDD.records.length - 1);
      expect(TDD.headerCheckbox().checked, 'all selectable selected').to.be.true;
      expect(TDD.headerCheckbox().indeterminate).to.be.false;

      await TDD.grid.deselectRow(TDD.records[0]);
      await TDD.waitForUpdate();
      expect(TDD.headerCheckbox().checked).to.be.false;
      expect(TDD.headerCheckbox().indeterminate).to.be.true;
    });

    it('selecting every selectable row one by one checks the header', async () => {
      for (const row of TDD.records.slice(0, -1)) await TDD.grid.selectRow(row);
      await TDD.waitForUpdate();
      expect(TDD.headerCheckbox().checked).to.be.true;
      expect(TDD.headerCheckbox().indeterminate).to.be.false;
    });

    it('setState skips it with a warning, and getState never lists it', async () => {
      const result = TDD.grid.setState({ selection: [{ index: 0 }, { index: 7 }] });
      await TDD.waitForUpdate();
      expect(TDD.grid.selectedRows).to.deep.equal([TDD.records[0]]);
      expect(result.applied).to.include('selection');
      expect(result.warnings.some((w) => w.startsWith('selection') && /selectable/.test(w))).to.be
        .true;
      expect(TDD.grid.getState().selection).to.deep.equal([{ index: 0 }]);
    });
  });

  describe('a body row the predicate rejects', () => {
    let blocked: TestData;

    beforeEach(async () => {
      TDD.selection = { ...BASE, isRowSelectable: (row) => row.id !== 3 };
      await TDD.setUp();
      blocked = TDD.records[2];
    });

    it('a Shift+click range from the anchor skips it', async () => {
      TDD.checkbox(TDD.records[0])!.click();
      await TDD.waitForUpdate();
      TDD.selectionCell(TDD.records[4]).dispatchEvent(
        new MouseEvent('click', { bubbles: true, composed: true, shiftKey: true })
      );
      await TDD.waitForUpdate();
      expect(TDD.grid.selectedRows).to.have.members([
        TDD.records[0],
        TDD.records[1],
        TDD.records[3],
        TDD.records[4],
      ]);
    });

    it('a Shift+click that lands on it selects nothing', async () => {
      TDD.checkbox(TDD.records[0])!.click();
      await TDD.waitForUpdate();
      TDD.selectionCell(blocked).dispatchEvent(
        new MouseEvent('click', { bubbles: true, composed: true, shiftKey: true })
      );
      await TDD.waitForUpdate();
      expect(TDD.grid.selectedRows).to.deep.equal([TDD.records[0]]);
    });

    it('Space and Shift+Space on it select nothing', async () => {
      await TDD.press(blocked, { key: ' ' });
      expect(TDD.grid.selectedRows, 'after Space').to.deep.equal([]);
      await TDD.press(blocked, { key: ' ', shiftKey: true });
      expect(TDD.grid.selectedRows, 'after Shift+Space').to.deep.equal([]);
      // Space still works on a selectable row.
      await TDD.press(TDD.records[1], { key: ' ' });
      expect(TDD.grid.selectedRows).to.deep.equal([TDD.records[1]]);
    });

    it('single mode: a refused row leaves the current selection alone', async () => {
      TDD.grid.selection = { ...TDD.grid.selection, mode: 'single' };
      await TDD.waitForUpdate();
      await TDD.grid.selectRow(TDD.records[0]);
      expect(await TDD.grid.selectRow(blocked)).to.be.false;
      expect(TDD.grid.selectedRows).to.deep.equal([TDD.records[0]]);
    });
  });

  describe('re-evaluation', () => {
    beforeEach(async () => {
      TDD.selection = { ...BASE };
      await TDD.setUp();
    });

    it('a new predicate drops selected rows it rejects through rowSelecting', async () => {
      await TDD.grid.selectRow(TDD.records[0]);
      await TDD.grid.selectRow(TDD.records[1]);
      const removed: TestData[][] = [];
      let selected: TestData[] = [];
      TDD.grid.addEventListener('rowSelecting', (e) => removed.push(e.detail.removed));
      TDD.grid.addEventListener('rowSelected', (e) => {
        selected = e.detail.selected;
      });

      TDD.grid.selection = { ...BASE, isRowSelectable: (row) => row.id !== 1 };
      await TDD.waitForUpdate();

      expect(removed).to.deep.equal([[TDD.records[0]]]);
      expect(selected).to.deep.equal([TDD.records[1]]);
      expect(TDD.grid.selectedRows).to.deep.equal([TDD.records[1]]);
      expect(TDD.checkbox(TDD.records[0])).to.be.null;
      expect(TDD.grid.getState().selection).to.deep.equal([{ index: 1 }]);
    });

    it('a data change drops selected rows the predicate now rejects', async () => {
      TDD.grid.selection = { ...BASE, isRowSelectable: (row) => row.name !== 'Total' };
      await TDD.waitForUpdate();
      await TDD.grid.selectRow(TDD.records[0]);
      await TDD.grid.selectRow(TDD.records[1]);
      let fired = 0;
      TDD.grid.addEventListener('rowSelected', () => fired++);

      TDD.records[0].name = 'Total';
      TDD.grid.data = [...TDD.records];
      await TDD.waitForUpdate();

      expect(fired).to.equal(1);
      expect(TDD.grid.selectedRows).to.deep.equal([TDD.records[1]]);
      expect(TDD.checkbox(TDD.records[0])).to.be.null;
    });

    it('a grid property a listener writes during the drop takes effect', async () => {
      await TDD.grid.selectRow(TDD.records[0]);
      TDD.grid.addEventListener('rowSelected', () => {
        TDD.grid.sortExpressions = [{ key: 'id', direction: 'descending' }];
      });

      TDD.grid.selection = { ...BASE, isRowSelectable: (row) => row.id !== 1 };
      await TDD.waitForUpdate();
      await TDD.waitForUpdate();

      expect(TDD.grid.selectedRows).to.deep.equal([]);
      const ids = TDD.records.map((row) => row.id).sort((a, b) => b - a);
      expect((TDD.grid.dataView[0] as TestData).id, 'sorted descending').to.equal(ids[0]);
      expect(TDD.grid.rows[0].data.id, 'rendered sorted').to.equal(ids[0]);
    });

    it('without a predicate a switch to single mode keeps the selection', async () => {
      TDD.grid.selectedRows = TDD.records.slice(0, 3);
      await TDD.waitForUpdate();
      let events = 0;
      TDD.grid.addEventListener('rowSelecting', () => events++);

      TDD.grid.selection = { ...BASE, mode: 'single' };
      TDD.grid.data = [...TDD.records];
      await TDD.waitForUpdate();

      expect(events).to.equal(0);
      expect(TDD.grid.selectedRows).to.deep.equal(TDD.records.slice(0, 3));
    });

    it('with a predicate a switch to single mode only drops rejected rows', async () => {
      TDD.grid.selectedRows = TDD.records.slice(0, 3);
      await TDD.waitForUpdate();

      TDD.grid.selection = { ...BASE, mode: 'single', isRowSelectable: (row) => row.id !== 1 };
      await TDD.waitForUpdate();

      expect(TDD.grid.selectedRows).to.deep.equal(TDD.records.slice(1, 3));
    });
  });

  describe('a selected row that stops being selectable in place', () => {
    let row: TestData;

    beforeEach(async () => {
      // Pinned rows are not selectable: pinning a selected row rejects it
      // without reassigning selection or data, so no drop runs.
      TDD.selection = {
        ...BASE,
        isRowSelectable: (r) => !TDD.grid.pinnedRows.bottom.includes(r),
      };
      await TDD.setUp();
      row = TDD.records[2];
      await TDD.grid.selectRow(row);
      TDD.grid.pinRow(row, 'bottom');
      await TDD.waitForUpdate();
    });

    it('keeps its checkbox and aria-selected so it can be deselected', async () => {
      expect(TDD.grid.selectedRows).to.deep.equal([row]);
      expect(TDD.rowFor(row).getAttribute('aria-selected')).to.equal('true');
      const box = TDD.checkbox(row);
      expect(box, 'checkbox kept').to.exist;
      expect(box!.checked).to.be.true;

      box!.click();
      await TDD.waitForUpdate();
      expect(TDD.grid.selectedRows).to.deep.equal([]);
      expect(TDD.checkbox(row), 'gone once deselected').to.be.null;
      expect(TDD.rowFor(row).hasAttribute('aria-selected')).to.be.false;
      expect(await TDD.grid.toggleRowSelection(row), 'not re-selectable').to.be.false;
    });

    it('toggleRowSelection and Ctrl+click deselect it', async () => {
      expect(await TDD.grid.toggleRowSelection(row)).to.be.true;
      expect(TDD.grid.selectedRows).to.deep.equal([]);

      TDD.grid.unpinRow(row);
      await TDD.waitForUpdate();
      await TDD.grid.selectRow(row);
      TDD.grid.pinRow(row, 'bottom');
      await TDD.waitForUpdate();
      TDD.selectionCell(row).dispatchEvent(
        new MouseEvent('click', { bubbles: true, composed: true, ctrlKey: true })
      );
      await TDD.waitForUpdate();
      expect(TDD.grid.selectedRows).to.deep.equal([]);
    });
  });
});
