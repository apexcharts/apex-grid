import { expect, html } from '@open-wc/testing';
import { sendKeys, sendMouse } from '@web/test-runner-commands';
import type ApexGridCell from '../src/components/cell.js';
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
});
