import { expect, html } from '@open-wc/testing';
import { sendKeys, sendMouse } from '@web/test-runner-commands';
import type ApexGridCell from '../src/components/cell.js';
import type { StateController } from '../src/controllers/state.js';
import type { ColumnConfiguration, GridEditingConfiguration } from '../src/internal/types.js';
import { required } from '../src/internal/validators.js';
import GridTestFixture from './utils/grid-fixture.js';

// The typed draft of an open editor must survive re-renders, focus loss and
// programmatic commits, and Tab must move to the next cell after committing.

interface Row {
  id: number;
  name: string;
  qty: number;
  price: number;
  joinedAt: string | null;
  active: boolean;
  note?: string;
}

const SOURCE: Row[] = [
  { id: 1, name: 'A', qty: 1, price: 10, joinedAt: '2025-01-15', active: false, note: 'n1' },
  { id: 2, name: 'B', qty: 2, price: 20, joinedAt: '2025-02-15', active: true, note: 'n2' },
  { id: 3, name: 'C', qty: 3, price: 30, joinedAt: '2025-03-15', active: false, note: 'n3' },
];

class DraftFixture extends GridTestFixture<Row> {
  public editing: GridEditingConfiguration = {
    enabled: true,
    mode: 'cell',
    trigger: 'doubleClick',
  };

  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number' },
      { key: 'name', editable: true, validators: [required()] },
      { key: 'qty', type: 'number', editable: true },
      { key: 'price', type: 'currency', editable: true },
      { key: 'joinedAt', type: 'date', editable: true, format: 'short' },
      { key: 'active', type: 'boolean', editable: true },
      {
        key: 'note',
        editable: true,
        editorTemplate: (ctx) =>
          html`<button data-apex-editor data-clear @click=${() => ctx.commit(undefined)}>
            Clear
          </button>`,
      },
    ] as ColumnConfiguration<Row>[];
  }

  public override async setUp() {
    this.data = JSON.parse(JSON.stringify(SOURCE)) as Row[];
    await super.setUp();
  }

  public override setupTemplate() {
    return html`<apex-grid
        .data=${this.data}
        .columns=${this.columnConfig}
        .editing=${this.editing}
      ></apex-grid
      ><button id="outside" style="position: fixed; inset: 0 auto auto 0; z-index: 10">
        outside
      </button>`;
  }

  public cell(rowIndex: number, key: keyof Row): ApexGridCell<Row> {
    return this.rows.get(rowIndex).cells.get(key as never).element as ApexGridCell<Row>;
  }

  public input(rowIndex: number, key: keyof Row): HTMLInputElement | null {
    return this.cell(rowIndex, key).shadowRoot!.querySelector<HTMLInputElement>(
      'input[data-apex-editor]'
    );
  }

  public async open(rowIndex: number, key: keyof Row): Promise<HTMLInputElement> {
    await this.grid.editCell(rowIndex, key);
    await this.waitForUpdate();
    const input = this.input(rowIndex, key)!;
    input.focus();
    return input;
  }

  /** The deepest focused element, through shadow roots. */
  public deepActive(): Element | null {
    let el: Element | null = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  public async clickOutside(): Promise<HTMLButtonElement> {
    const button = document.getElementById('outside') as HTMLButtonElement;
    const rect = button.getBoundingClientRect();
    await sendMouse({
      type: 'click',
      position: [Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2)],
    });
    await this.waitForUpdate();
    return button;
  }
}

const F = new DraftFixture(SOURCE);

describe('Editing draft', () => {
  beforeEach(async () => await F.setUp());
  afterEach(() => F.tearDown());

  describe('re-render while editing (core-cell-1, core-cell-5)', () => {
    it('keeps the typed draft when the editing cell re-renders', async () => {
      await F.open(0, 'name');
      await sendKeys({ press: 'Backspace' });
      await sendKeys({ type: 'Hello' });
      F.cell(0, 'name').requestUpdate();
      await F.waitForUpdate();
      expect(F.input(0, 'name')!.value).to.equal('Hello');
      await sendKeys({ press: 'Enter' });
      await F.waitForUpdate();
      expect(F.grid.data[0].name).to.equal('Hello');
    });

    it('re-validates the visible draft on a second Enter after a failed commit', async () => {
      let failures = 0;
      F.grid.addEventListener('cellValidationFailed', () => failures++);
      await F.open(0, 'name');
      await sendKeys({ press: 'Backspace' });
      await sendKeys({ press: 'Enter' });
      await F.waitForUpdate();
      expect(F.input(0, 'name'), 'open after first invalid Enter').to.exist;
      await sendKeys({ press: 'Enter' });
      await F.waitForUpdate();
      expect(F.input(0, 'name'), 'open after second invalid Enter').to.exist;
      expect(failures).to.equal(2);
      expect(F.grid.data[0].name).to.equal('A');
    });

    it('keeps the caret where it was across a re-render', async () => {
      const input = await F.open(0, 'name');
      await sendKeys({ press: 'End' });
      await sendKeys({ type: 'BCD' });
      input.setSelectionRange(2, 2);
      F.cell(0, 'name').requestUpdate();
      await F.waitForUpdate();
      expect([input.selectionStart, input.selectionEnd]).to.deep.equal([2, 2]);
    });
  });

  describe('programmatic commit (core-editing-history-3, core-types-5)', () => {
    it('grid.commitEdit() writes the typed text', async () => {
      await F.open(0, 'name');
      await sendKeys({ press: 'Backspace' });
      await sendKeys({ type: 'Typed' });
      const ok = await F.grid.commitEdit();
      await F.waitForUpdate();
      expect(ok).to.be.true;
      expect(F.grid.data[0].name).to.equal('Typed');
      expect(F.grid.editingCell).to.be.null;
    });

    it('grid.editCell() on another cell auto-commits the typed text', async () => {
      await F.open(0, 'name');
      await sendKeys({ press: 'Backspace' });
      await sendKeys({ type: 'Typed' });
      await F.grid.editCell(1, 'name');
      await F.waitForUpdate();
      expect(F.grid.data[0].name).to.equal('Typed');
      expect(F.grid.editingCell).to.deep.equal({ rowIndex: 1, columnKey: 'name' });
    });

    it('grid.editCell() elsewhere keeps an invalid draft open and returns false', async () => {
      let failures = 0;
      F.grid.addEventListener('cellValidationFailed', () => failures++);
      await F.open(0, 'name');
      await sendKeys({ press: 'Backspace' });
      expect(await F.grid.editCell(1, 'name')).to.be.false;
      await F.waitForUpdate();
      expect(failures).to.equal(1);
      expect(F.grid.editingCell).to.deep.equal({ rowIndex: 0, columnKey: 'name' });
      expect(F.input(0, 'name')!.value).to.equal('');
      expect(F.grid.data[0].name).to.equal('A');
    });

    it('a click on another cell keeps an invalid draft open, validated once', async () => {
      let failures = 0;
      F.grid.addEventListener('cellValidationFailed', () => failures++);
      F.grid.editing = { enabled: true, mode: 'cell', trigger: 'click' };
      await F.waitForUpdate();
      await F.open(0, 'name');
      await sendKeys({ press: 'Backspace' });
      const rect = F.cell(1, 'name').getBoundingClientRect();
      await sendMouse({
        type: 'click',
        position: [Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2)],
      });
      await F.waitForUpdate();
      expect(failures).to.equal(1);
      expect(F.grid.editingCell).to.deep.equal({ rowIndex: 0, columnKey: 'name' });
      expect(F.cell(0, 'name').getAttribute('aria-invalid')).to.equal('true');
      expect(F.cell(1, 'name').hasAttribute('aria-invalid')).to.be.false;
      expect(F.grid.data[0].name).to.equal('A');
    });

    it('commitEdit() without typing leaves the value alone', async () => {
      const changed: unknown[] = [];
      F.grid.addEventListener('cellValueChanged', (e) => changed.push(e.detail.value));
      await F.open(1, 'name');
      expect(await F.grid.commitEdit()).to.be.true;
      expect(changed).to.deep.equal([]);
    });

    it('a cancelled edit does not leak its draft into the next edit', async () => {
      await F.open(0, 'name');
      await sendKeys({ type: 'zzz' });
      F.grid.cancelEdit();
      await F.waitForUpdate();
      await F.grid.editCell(1, 'name');
      await F.waitForUpdate();
      await F.grid.commitEdit();
      await F.waitForUpdate();
      expect(F.grid.data[0].name).to.equal('A');
      expect(F.grid.data[1].name).to.equal('B');
    });

    it('an editor ctx.commit(undefined) writes undefined', async () => {
      const changed: unknown[] = [];
      F.grid.addEventListener('cellValueChanged', (e) => changed.push(e.detail.value));
      await F.grid.editCell(0, 'note');
      await F.waitForUpdate();
      F.cell(0, 'note').shadowRoot!.querySelector<HTMLButtonElement>('[data-clear]')!.click();
      await F.waitForUpdate();
      expect(changed).to.deep.equal([undefined]);
      expect(F.grid.data[0].note).to.be.undefined;
      expect(F.grid.editingCell).to.be.null;
    });
  });

  describe('focus loss (core-cell-4, core-cell-7)', () => {
    it('an invalid draft stays open with its error when focus leaves', async () => {
      let failures = 0;
      F.grid.addEventListener('cellValidationFailed', () => failures++);
      await F.open(0, 'name');
      await sendKeys({ press: 'Backspace' });
      const button = await F.clickOutside();
      expect(failures, 'one validation per focus loss').to.equal(1);
      expect(F.grid.editingCell).to.deep.equal({ rowIndex: 0, columnKey: 'name' });
      expect(F.cell(0, 'name').getAttribute('aria-invalid')).to.equal('true');
      expect(F.grid.data[0].name).to.equal('A');
      expect(F.deepActive(), 'focus stays on the clicked control').to.equal(button);
    });

    it('a pointer exit after a failed Enter does not pull focus back', async () => {
      await F.open(0, 'name');
      await sendKeys({ press: 'Backspace' });
      await sendKeys({ press: 'Enter' });
      await F.waitForUpdate();
      F.input(0, 'name')!.focus();
      await sendKeys({ type: 'Valid' });
      const button = await F.clickOutside();
      expect(F.grid.data[0].name).to.equal('Valid');
      expect(F.grid.editingCell).to.be.null;
      expect(F.deepActive()).to.equal(button);
    });
  });

  describe('Tab (core-cell-6)', () => {
    it('commits and moves to the next cell', async () => {
      await F.open(0, 'name');
      await sendKeys({ press: 'Backspace' });
      await sendKeys({ type: 'X' });
      await sendKeys({ press: 'Tab' });
      await F.waitForUpdate();
      expect(F.grid.data[0].name).to.equal('X');
      expect(F.grid.editingCell).to.be.null;
      expect(F.deepActive()).to.equal(F.cell(0, 'qty'));
    });

    it('Shift+Tab commits and moves to the previous cell', async () => {
      await F.open(0, 'qty');
      await sendKeys({ press: 'Shift+Tab' });
      await F.waitForUpdate();
      expect(F.deepActive()).to.equal(F.cell(0, 'name'));
    });

    it('wraps to the first cell of the next row from the last column', async () => {
      await F.grid.editCell(0, 'note');
      await F.waitForUpdate();
      F.cell(0, 'note').shadowRoot!.querySelector<HTMLButtonElement>('[data-clear]')!.focus();
      await sendKeys({ press: 'Tab' });
      await F.waitForUpdate();
      expect(F.grid.editingCell).to.be.null;
      expect(F.deepActive()).to.equal(F.cell(1, 'id'));
    });

    it('stays on the cell when the commit fails', async () => {
      await F.open(0, 'name');
      await sendKeys({ press: 'Backspace' });
      await sendKeys({ press: 'Tab' });
      await F.waitForUpdate();
      expect(F.grid.editingCell).to.deep.equal({ rowIndex: 0, columnKey: 'name' });
      expect(F.deepActive()).to.equal(F.input(0, 'name'));
    });

    it('stays on the cell from the last column of the last row', async () => {
      await F.grid.editCell(2, 'note');
      await F.waitForUpdate();
      F.cell(2, 'note').shadowRoot!.querySelector<HTMLButtonElement>('[data-clear]')!.focus();
      await sendKeys({ press: 'Tab' });
      await F.waitForUpdate();
      expect(F.grid.editingCell).to.be.null;
      expect(F.deepActive()).to.equal(F.cell(2, 'note'));
    });

    it('skips a full-width row when wrapping', async () => {
      const header = F.grid.data[1];
      const state = (F.grid as unknown as { stateController: StateController<Row> })
        .stateController;
      state.presentRow = (row) => (row === header ? { content: html`<span>Group</span>` } : null);
      for (const row of F.grid.rows) row.requestUpdate();
      await F.waitForUpdate();
      await F.grid.editCell(0, 'note');
      await F.waitForUpdate();
      F.cell(0, 'note').shadowRoot!.querySelector<HTMLButtonElement>('[data-clear]')!.focus();
      await sendKeys({ press: 'Tab' });
      await F.waitForUpdate();
      expect(F.deepActive()).to.equal(F.cell(2, 'id'));
    });

    it('keeps focus on the cell when no row below renders cells', async () => {
      const state = (F.grid as unknown as { stateController: StateController<Row> })
        .stateController;
      const rest = new Set(F.grid.data.slice(1));
      state.presentRow = (row) => (rest.has(row) ? { content: html`<span>Group</span>` } : null);
      for (const row of F.grid.rows) row.requestUpdate();
      await F.waitForUpdate();
      await F.grid.editCell(0, 'note');
      await F.waitForUpdate();
      F.cell(0, 'note').shadowRoot!.querySelector<HTMLButtonElement>('[data-clear]')!.focus();
      await sendKeys({ press: 'Tab' });
      await F.waitForUpdate();
      expect(F.grid.editingCell).to.be.null;
      expect(F.deepActive()).to.equal(F.cell(0, 'note'));
    });

    it('moves from the edited record when the commit re-sorts the rows', async () => {
      await F.sort({ key: 'name', direction: 'ascending' });
      const edited = F.grid.data[0];
      await F.open(0, 'name');
      await sendKeys({ type: 'Z' });
      await sendKeys({ press: 'Tab' });
      await F.waitForUpdate();
      expect(edited.name).to.equal('Z');
      expect(F.grid.pageItems.indexOf(edited)).to.equal(2);
      expect(F.deepActive()).to.equal(F.cell(2, 'qty'));
    });

    it('lands on a cell when the commit moves full-width rows to the old index', async () => {
      await F.sort({ key: 'name', direction: 'ascending' });
      const state = (F.grid as unknown as { stateController: StateController<Row> })
        .stateController;
      const rest = new Set(F.grid.data.slice(1));
      state.presentRow = (row) => (rest.has(row) ? { content: html`<span>Group</span>` } : null);
      for (const row of F.grid.rows) row.requestUpdate();
      await F.waitForUpdate();
      await F.open(0, 'name');
      await sendKeys({ type: 'Z' });
      await sendKeys({ press: 'Tab' });
      await F.waitForUpdate();
      expect(F.deepActive()).to.equal(F.cell(2, 'qty'));
      expect(state.active).to.deep.equal({ row: 2, column: 'qty' });
    });

    it('scrolls the cell it lands on into view', async () => {
      F.grid.style.width = '400px';
      F.grid.columns = F.grid.columns.map((column) => ({ ...column, width: '200px' }));
      await F.waitForUpdate();
      await F.open(0, 'qty');
      await sendKeys({ press: 'Tab' });
      await F.waitForUpdate();
      await sendKeys({ press: 'Enter' });
      await F.waitForUpdate();
      F.input(0, 'price')!.focus();
      await sendKeys({ press: 'Tab' });
      await F.waitForUpdate();
      const landed = F.cell(0, 'joinedAt');
      expect(F.deepActive()).to.equal(landed);
      const box = F.grid.getBoundingClientRect();
      const rect = landed.getBoundingClientRect();
      expect(rect.left, 'left edge visible').to.be.at.least(box.left - 1);
      expect(rect.right, 'right edge visible').to.be.at.most(box.right + 1);
    });
  });

  describe('typed editors (core-column-types-1, -3, -4)', () => {
    it('date: one ArrowUp does not commit or close the editor', async () => {
      const changed: unknown[] = [];
      F.grid.addEventListener('cellValueChanged', (e) => changed.push(e.detail.value));
      await F.open(0, 'joinedAt');
      await sendKeys({ press: 'ArrowUp' });
      await F.waitForUpdate();
      expect(changed).to.deep.equal([]);
      expect(F.grid.editingCell).to.not.be.null;
    });

    // The segment order of <input type="date"> follows the host locale, so
    // these step the focused segment with ArrowUp instead of typing digits.
    it('date: keyboard edits commit once, on Enter', async () => {
      const changed: unknown[] = [];
      F.grid.addEventListener('cellValueChanged', (e) => changed.push(e.detail.value));
      const input = await F.open(0, 'joinedAt');
      for (let i = 0; i < 3; i++) await sendKeys({ press: 'ArrowUp' });
      await F.waitForUpdate();
      expect(changed, 'nothing committed while editing').to.deep.equal([]);
      const typed = input.value;
      expect(typed).to.not.equal('2025-01-15');
      await sendKeys({ press: 'Enter' });
      await F.waitForUpdate();
      expect(changed).to.deep.equal([typed]);
    });

    it('date: keyboard edits commit on Tab', async () => {
      const input = await F.open(0, 'joinedAt');
      await sendKeys({ press: 'ArrowUp' });
      await sendKeys({ press: 'ArrowUp' });
      const typed = input.value;
      expect(typed).to.not.equal('2025-01-15');
      expect(F.grid.editingCell, 'still editing before Tab').to.not.be.null;
      await sendKeys({ press: 'Tab' });
      await F.waitForUpdate();
      expect(F.grid.data[0].joinedAt).to.equal(typed);
    });

    it('date: a pick without typing still commits at once', async () => {
      const input = await F.open(0, 'joinedAt');
      input.value = '2026-12-25';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await F.waitForUpdate();
      expect(F.grid.editingCell).to.be.null;
      expect(F.grid.data[0].joinedAt).to.equal('2026-12-25');
    });

    it('date: a leading 0 does not erase the stored date', async () => {
      const changed: unknown[] = [];
      F.grid.addEventListener('cellValueChanged', (e) => changed.push(e.detail.value));
      await F.open(0, 'joinedAt');
      await sendKeys({ type: '0' });
      await F.waitForUpdate();
      expect(changed).to.deep.equal([]);
      expect(F.grid.data[0].joinedAt).to.equal('2025-01-15');
    });

    it('date: Enter on a half-typed date keeps the stored date', async () => {
      const changed: unknown[] = [];
      F.grid.addEventListener('cellValueChanged', (e) => changed.push(e.detail.value));
      await F.open(0, 'joinedAt');
      await sendKeys({ type: '0' });
      await sendKeys({ press: 'Enter' });
      await F.waitForUpdate();
      expect(changed).to.deep.equal([]);
      expect(F.grid.data[0].joinedAt).to.equal('2025-01-15');
      expect(F.grid.editingCell, 'editor stays open').to.not.be.null;
    });

    it('date: Enter after clearing one segment keeps the stored date', async () => {
      await F.open(0, 'joinedAt');
      await sendKeys({ press: 'Backspace' });
      await sendKeys({ press: 'Enter' });
      await F.waitForUpdate();
      expect(F.grid.data[0].joinedAt).to.equal('2025-01-15');
      expect(F.grid.editingCell).to.not.be.null;
    });

    it('currency: the typed amount commits on Tab', async () => {
      await F.open(0, 'price');
      await sendKeys({ press: 'Backspace' });
      await sendKeys({ press: 'Backspace' });
      await sendKeys({ type: '99' });
      await sendKeys({ press: 'Tab' });
      await F.waitForUpdate();
      expect(F.grid.data[0].price).to.equal(99);
    });

    it('boolean: a rejected toggle puts the checkbox back', async () => {
      F.grid.addEventListener('cellValueChanging', (e) => e.preventDefault());
      const box = F.cell(0, 'active').shadowRoot!.querySelector<HTMLInputElement>(
        'input[type="checkbox"]'
      )!;
      expect(box.checked).to.be.false;
      box.click();
      await F.waitForUpdate();
      expect(F.grid.data[0].active).to.be.false;
      expect(box.checked).to.be.false;
    });

    it('boolean: the default editor reverts a rejected toggle', async () => {
      F.grid.addEventListener('cellValueChanging', (e) => e.preventDefault());
      await F.grid.editCell(0, 'active');
      await F.waitForUpdate();
      const box = F.input(0, 'active')!;
      expect(box.checked).to.be.false;
      box.click();
      await F.waitForUpdate();
      expect(F.grid.data[0].active).to.be.false;
      expect(F.input(0, 'active')!.checked).to.be.false;
    });
  });
});

// Tab after a commit that moves the edited record past the rows the
// virtualizer renders, or replaces it: focus must stay inside the grid.

interface LongRow {
  id: number;
  name: string;
  qty: number;
  joinedAt: string;
}

const LONG: LongRow[] = Array.from({ length: 200 }, (_, i) => ({
  id: i,
  name: `A${i}`,
  qty: i,
  joinedAt: '2025-01-15',
}));

class LongFixture extends GridTestFixture<LongRow> {
  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number' },
      { key: 'name', editable: true, validators: [required()] },
      { key: 'qty', type: 'number', editable: true },
      { key: 'joinedAt', type: 'date', editable: true },
    ] as ColumnConfiguration<LongRow>[];
  }

  public override async setUp() {
    this.data = LONG.map((row) => ({ ...row }));
    await super.setUp();
  }

  public override setupParentNode() {
    const parent = document.createElement('div');
    Object.assign(parent.style, { height: '400px', width: '600px' });
    return parent;
  }

  public override setupTemplate() {
    return html`<apex-grid
      .data=${this.data}
      .columns=${this.columnConfig}
      .editing=${{ enabled: true, mode: 'cell', trigger: 'doubleClick' }}
    ></apex-grid>`;
  }

  public get state() {
    return (this.grid as unknown as { stateController: StateController<LongRow> }).stateController;
  }

  /** The rendered cell at a view row index, if its row is rendered. */
  public cellAt(rowIndex: number, key: keyof LongRow): ApexGridCell<LongRow> | undefined {
    return this.grid.rows
      .find((row) => row.index === rowIndex)
      ?.cells.find((cell) => cell.column.key === key) as ApexGridCell<LongRow> | undefined;
  }

  public async open(rowIndex: number, key: keyof LongRow) {
    await this.grid.editCell(rowIndex, key);
    await this.waitForUpdate();
    this.cellAt(rowIndex, key)!.shadowRoot!.querySelector<HTMLInputElement>('input')!.focus();
  }

  public async tab(shift = false) {
    await sendKeys({ press: shift ? 'Shift+Tab' : 'Tab' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await this.waitForUpdate();
  }

  public deepActive(): Element | null {
    let el: Element | null = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }
}

const L = new LongFixture(LONG);

describe('Tab past the rendered rows', () => {
  beforeEach(async () => await L.setUp());
  afterEach(() => L.tearDown());

  it('follows the edited record when the commit sorts it past the rendered rows', async () => {
    await L.sort({ key: 'name', direction: 'ascending' });
    const edited = L.grid.pageItems[0];
    await L.open(0, 'name');
    await sendKeys({ type: 'ZZZ' });
    await L.tab();
    expect(edited.name).to.equal('ZZZ');
    expect(L.grid.pageItems.indexOf(edited)).to.equal(199);
    expect(L.state.active).to.deep.equal({ row: 199, column: 'qty' });
    expect(L.deepActive()).to.equal(L.cellAt(199, 'qty'));
  });

  it('follows the edited record on Shift+Tab past the rendered rows', async () => {
    await L.sort({ key: 'name', direction: 'ascending' });
    const edited = L.grid.pageItems[3];
    await L.open(3, 'name');
    await sendKeys({ type: 'ZZZ' });
    await L.tab(true);
    expect(L.grid.pageItems.indexOf(edited)).to.equal(199);
    expect(L.state.active).to.deep.equal({ row: 199, column: 'id' });
    expect(L.deepActive()).to.equal(L.cellAt(199, 'id'));
  });

  it('keeps focus in the grid when a listener replaces the edited record', async () => {
    L.grid.addEventListener('cellValueChanged', (event) => {
      const { data, key, value } = event.detail;
      L.grid.data = L.grid.data.map((row) => (row === data ? { ...row, [key]: value } : row));
    });
    await L.open(1, 'name');
    await sendKeys({ type: 'Z' });
    await L.tab();
    expect(L.grid.data[1].name).to.equal('Z');
    expect(L.state.active).to.deep.equal({ row: 1, column: 'name' });
    expect(L.deepActive()).to.equal(L.cellAt(1, 'name'));
  });

  it('lands again when a deferred listener replaces the edited record', async () => {
    L.grid.addEventListener('cellValueChanged', (event) => {
      const { data, key, value } = event.detail;
      setTimeout(() => {
        L.grid.data = L.grid.data.map((row) => (row === data ? { ...row, [key]: value } : row));
      });
    });
    await L.open(1, 'name');
    await sendKeys({ type: 'Z' });
    await L.tab();
    expect(L.grid.data[1].name).to.equal('Z');
    expect(L.state.active).to.deep.equal({ row: 1, column: 'qty' });
    expect(L.deepActive()).to.equal(L.cellAt(1, 'qty'));
  });
});
