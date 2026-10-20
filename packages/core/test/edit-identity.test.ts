import { expect, fixture, html, nextFrame } from '@open-wc/testing';
import type { ReactiveController } from 'lit';
import type ApexGridCell from '../src/components/cell.js';
import { ApexGrid } from '../src/components/grid.js';
import type ApexGridRow from '../src/components/row.js';
import { StateController } from '../src/controllers/state.js';
import type {
  CellDecoration,
  CellDecorator,
  CellDecoratorContext,
  GridFeatureModule,
} from '../src/internal/feature-module.js';
import type {
  ApexEditorContext,
  ColumnConfiguration,
  GridEditingConfiguration,
  GridHost,
  GridRowPinningConfiguration,
} from '../src/internal/types.js';
import { custom, min, required } from '../src/internal/validators.js';
import GridTestFixture from './utils/grid-fixture.js';

// The open editor is bound to the record it shows, not to a view index: a
// view change (live data, sort, filter, paging, pinned rows) never moves the
// editor onto another record, and a commit always lands on the record the
// user saw. Row mode shows and validates the staged row.

interface Row {
  id: number;
  name: string;
  start: number;
  end: number;
  active: boolean;
  when?: Date;
}

const SOURCE: Row[] = [
  { id: 1, name: 'A', start: 1, end: 2, active: false },
  { id: 2, name: 'B', start: 10, end: 12, active: false },
  { id: 3, name: 'C', start: 3, end: 4, active: true },
  { id: 4, name: 'D', start: 5, end: 6, active: false },
  { id: 5, name: 'E', start: 7, end: 8, active: true },
];

const endAfterStart = custom<Row>((value, ctx) =>
  (value as number) < ctx.data.start ? 'End before start' : null
);

class IdentityFixture extends GridTestFixture<Row> {
  public editing: GridEditingConfiguration = { enabled: true, mode: 'cell' };
  public rowPinning: GridRowPinningConfiguration = { enabled: false };

  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number', editable: true, validators: [min(0)] },
      { key: 'name', editable: true, validators: [required()] },
      { key: 'start', type: 'number', editable: true },
      { key: 'end', type: 'number', editable: true, validators: [endAfterStart] },
      { key: 'active', type: 'boolean', editable: true },
    ] as ColumnConfiguration<Row>[];
  }

  public override async setUp() {
    this.data = structuredClone(SOURCE);
    await super.setUp();
  }

  public override setupTemplate() {
    return html`<apex-grid
      .data=${this.data}
      .columns=${this.columnConfig}
      .editing=${this.editing}
      .rowPinning=${this.rowPinning}
    ></apex-grid>`;
  }

  /** The rendered row (body or pinned band) showing `record`. */
  public rowOf(record: Row): ApexGridRow<Row> | undefined {
    return Array.from(
      this.grid.renderRoot.querySelectorAll<ApexGridRow<Row>>('apex-grid-row')
    ).find((row) => row.data === record);
  }

  public cellOf(record: Row, key: keyof Row): ApexGridCell<Row> {
    return this.rowOf(record)!.cells.find((cell) => cell.column.key === key)!;
  }

  /** Every open text/number editor in the grid, with the record its row shows. */
  public openEditors(): Array<{ record: Row; input: HTMLInputElement }> {
    return Array.from(this.grid.renderRoot.querySelectorAll<ApexGridRow<Row>>('apex-grid-row'))
      .flatMap((row) => row.cells.map((cell) => ({ row, cell })))
      .map(({ row, cell }) => ({
        record: row.data,
        input: cell.shadowRoot?.querySelector<HTMLInputElement>('input[data-apex-editor]'),
      }))
      .filter((entry): entry is { record: Row; input: HTMLInputElement } => !!entry.input);
  }

  public type(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  public async press(input: HTMLInputElement, key: string) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true }));
    await this.waitForUpdate();
  }
}

const F = new IdentityFixture(SOURCE);

/** Gives every record a date and adds an editable, required date column. */
async function addDateColumn() {
  F.grid.data.forEach((record, i) => {
    record.when = new Date(2024, i, i + 1);
  });
  F.grid.columns = [
    ...F.grid.columns,
    { key: 'when', type: 'date', editable: true, validators: [required()] },
  ] as ColumnConfiguration<Row>[];
  await F.waitForUpdate();
}

/** Clears a date input from the keyboard (stages a null draft). */
function clearDate(input: HTMLInputElement) {
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, composed: true })
  );
  input.value = '';
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Picks a date from the calendar popup (no typing: commits at once). */
function pickDate(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Edit identity', () => {
  afterEach(() => F.tearDown());

  describe('the open editor follows its record (core-editing-history-1, core-dom-sizing-reorder-1)', () => {
    beforeEach(async () => {
      F.editing = { enabled: true, mode: 'cell' };
      F.rowPinning = { enabled: false };
      await F.setUp();
    });

    it('a live prepend keeps the editor on the edited record', async () => {
      const recordB = F.grid.data[1];
      await F.grid.editCell(1, 'name');
      await F.waitForUpdate();
      const changed: unknown[] = [];
      F.grid.addEventListener('cellValueChanged', (e) => changed.push(e.detail));

      F.grid.data = [{ id: 99, name: 'NEW', start: 0, end: 1, active: false }, ...F.grid.data];
      await F.waitForUpdate();

      const editors = F.openEditors();
      expect(editors.length, 'one open editor').to.equal(1);
      expect(editors[0].record, 'editor shows the edited record').to.equal(recordB);
      expect(editors[0].input.value).to.equal('B');
      expect(F.grid.editingCell).to.deep.equal({ rowIndex: 2, columnKey: 'name' });

      await F.press(editors[0].input, 'Enter');
      expect(recordB.name, 'untouched Enter writes nothing').to.equal('B');
      expect(changed.length).to.equal(0);
    });

    it('a typed value lands on the record the editor showed after a sort', async () => {
      const recordB = F.grid.data[1];
      await F.grid.editCell(1, 'name');
      await F.waitForUpdate();
      F.grid.sort({ key: 'start', direction: 'descending' });
      await F.waitForUpdate();

      const [editor] = F.openEditors();
      expect(editor.record).to.equal(recordB);
      const indexes: number[] = [];
      F.grid.addEventListener('cellValueChanged', (e) => indexes.push(e.detail.rowIndex));
      F.type(editor.input, 'TYPED');
      await F.press(editor.input, 'Enter');

      expect(recordB.name).to.equal('TYPED');
      expect(F.grid.data.filter((row) => row.name === 'TYPED').length).to.equal(1);
      expect(indexes, 'event carries the live view index').to.deep.equal([
        F.grid.pageItems.indexOf(recordB),
      ]);
    });

    it('cancels the edit when its record leaves the view', async () => {
      const recordB = F.grid.data[1];
      await F.grid.editCell(1, 'name');
      await F.waitForUpdate();
      F.type(F.openEditors()[0].input, 'TYPED');
      F.grid.filter({ key: 'name', condition: 'equals', searchTerm: 'A' });
      await F.waitForUpdate();

      expect(F.grid.editingCell, 'edit closed').to.equal(null);
      expect(F.openEditors().length).to.equal(0);
      await F.grid.commitEdit();
      expect(recordB.name).to.equal('B');
    });
  });

  describe('a rejected edit on another page does not block editing', () => {
    // Sorting by start ascending moves B (start 10) from page 1 to the last page.
    beforeEach(async () => {
      F.rowPinning = { enabled: false };
    });

    async function rejectThenPageAway(
      mode: 'cell' | 'row',
      key: 'name' | 'end' = 'name',
      typed = ''
    ) {
      F.editing = { enabled: true, mode };
      await F.setUp();
      F.grid.pagination = { enabled: true, pageSize: 2 };
      await F.waitForUpdate();
      const recordB = F.grid.pageItems[1];
      await F.grid.editCell(1, key);
      await F.waitForUpdate();
      F.type(F.openEditors()[0].input, typed);
      await F.press(F.openEditors()[0].input, 'Enter');
      F.grid.sort({ key: 'start', direction: 'ascending' });
      await F.waitForUpdate();
      expect(F.grid.pageItems.includes(recordB), 'edited record off the page').to.equal(false);
      return recordB;
    }

    it('cell mode: a new edit cancels the hidden rejected editor', async () => {
      const recordB = await rejectThenPageAway('cell');
      expect(F.grid.editingCell, 'rejected edit still open').to.deep.equal({
        rowIndex: -1,
        columnKey: 'name',
      });

      expect(await F.grid.editCell(0, 'id')).to.equal(true);
      await F.waitForUpdate();
      expect(F.grid.editingCell).to.deep.equal({ rowIndex: 0, columnKey: 'id' });
      expect(recordB.name).to.equal('B');
    });

    it('row mode: a new row edit cancels the hidden rejected row', async () => {
      const ended: unknown[] = [];
      const recordB = await rejectThenPageAway('row');
      F.grid.addEventListener('rowEditEnded', (e) => ended.push(e.detail));

      expect(await F.grid.editCell(0, 'id')).to.equal(true);
      await F.waitForUpdate();
      expect(ended).to.deep.equal([{ rowIndex: -1, committed: false }]);
      expect(F.grid.editingRow).to.equal(0);
      expect(recordB.name).to.equal('B');
    });

    it('paging back shows the held draft, and Enter commits what it shows', async () => {
      // end 5 < start 10 is rejected; B then leaves the page, its start drops
      // to 0 so the held draft becomes valid, and B comes back.
      const recordB = await rejectThenPageAway('cell', 'end', '5');
      recordB.start = 0;
      F.grid.clearSort();
      await F.waitForUpdate();

      const [editor] = F.openEditors();
      expect(editor.record).to.equal(recordB);
      expect(editor.input.value, 'editor shows the held draft').to.equal('5');
      await F.press(editor.input, 'Enter');
      expect(F.grid.editingCell).to.equal(null);
      expect(recordB.end, 'Enter committed what the editor showed').to.equal(5);
    });

    it('paging back shows a rejected empty draft, still rejected', async () => {
      const recordB = await rejectThenPageAway('cell');
      F.grid.clearSort();
      await F.waitForUpdate();

      const [editor] = F.openEditors();
      expect(editor.input.value, 'editor shows the held draft').to.equal('');
      expect(F.cellOf(recordB, 'name').getAttribute('aria-invalid')).to.equal('true');
      await F.press(editor.input, 'Enter');
      expect(F.grid.editingCell).to.deep.equal({ rowIndex: 1, columnKey: 'name' });
      expect(recordB.name).to.equal('B');
    });

    it('an editor built from ctx re-opens on the held draft', async () => {
      // Type registry editors keep a draft through ctx.setDraft, which the
      // public editor context type does not list.
      const seen: unknown[] = [];
      const editorTemplate = (ctx: ApexEditorContext<Row, 'name'>) => {
        const { setDraft } = ctx as unknown as { setDraft: (next: unknown) => void };
        seen.push(ctx.value);
        return html`<input
          data-apex-editor
          .value=${String(ctx.value ?? '')}
          @input=${(e: Event) => setDraft((e.target as HTMLInputElement).value)}
        />`;
      };
      F.editing = { enabled: true, mode: 'cell' };
      await F.setUp();
      F.grid.columns = F.grid.columns.map((column) =>
        column.key === 'name' ? { ...column, editorTemplate } : column
      ) as ColumnConfiguration<Row>[];
      F.grid.pagination = { enabled: true, pageSize: 2 };
      await F.waitForUpdate();
      await F.grid.editCell(1, 'name');
      await F.waitForUpdate();
      F.type(F.openEditors()[0].input, '');
      await F.grid.commitEdit();
      await F.waitForUpdate();
      F.grid.sort({ key: 'start', direction: 'ascending' });
      await F.waitForUpdate();
      seen.length = 0;
      F.grid.clearSort();
      await F.waitForUpdate();

      expect(seen.at(-1), 'ctx.value is the held draft').to.equal('');
      expect(F.openEditors()[0].input.value).to.equal('');
    });

    it('a date editor resumed on a cleared draft still writes a Date', async () => {
      // The null draft carries no shape; a calendar pick must still write a
      // Date into a Date field.
      F.editing = { enabled: true, mode: 'cell' };
      await F.setUp();
      await addDateColumn();
      F.grid.pagination = { enabled: true, pageSize: 2 };
      await F.waitForUpdate();
      const recordB = F.grid.pageItems[1];
      await F.grid.editCell(1, 'when');
      await F.waitForUpdate();
      clearDate(F.openEditors()[0].input);
      await F.press(F.openEditors()[0].input, 'Enter');
      expect(F.grid.editingCell, 'rejected, still open').to.not.equal(null);
      F.grid.sort({ key: 'start', direction: 'ascending' });
      await F.waitForUpdate();
      F.grid.clearSort();
      await F.waitForUpdate();

      const [editor] = F.openEditors();
      expect(editor.input.value, 'editor shows the held draft').to.equal('');
      pickDate(editor.input, '2024-05-06');
      await F.waitForUpdate();
      expect(F.grid.editingCell).to.equal(null);
      expect(recordB.when).to.be.instanceOf(Date);
      expect(recordB.when!.getDate()).to.equal(6);
    });

    it('a rejected editor in sight still blocks a new edit', async () => {
      F.editing = { enabled: true, mode: 'cell' };
      await F.setUp();
      await F.grid.editCell(1, 'name');
      await F.waitForUpdate();
      F.type(F.openEditors()[0].input, '');
      await F.press(F.openEditors()[0].input, 'Enter');

      expect(await F.grid.editCell(0, 'id')).to.equal(false);
      expect(F.grid.editingCell).to.deep.equal({ rowIndex: 1, columnKey: 'name' });
    });
  });

  describe('pinned rows edit the pinned record (sweep-editing-state-1, core-state-seam-1)', () => {
    beforeEach(async () => {
      F.editing = { enabled: true, mode: 'cell' };
      F.rowPinning = { enabled: true };
      await F.setUp();
    });

    it('the checkbox in a pinned row toggles the pinned record only', async () => {
      const pinned = F.grid.data[3];
      F.grid.pinRow(pinned, 'top');
      await F.waitForUpdate();
      const body0 = F.grid.pageItems[0];

      const input = F.cellOf(pinned, 'active').shadowRoot!.querySelector<HTMLInputElement>(
        'input[type="checkbox"]'
      )!;
      input.click();
      await F.waitForUpdate();

      expect(pinned.active, 'pinned record toggled').to.equal(true);
      expect(body0.active, 'body row 0 untouched').to.equal(false);
    });

    it('double-click on a pinned cell edits the pinned record in the pinned row', async () => {
      const pinned = F.grid.data[3];
      F.grid.pinRow(pinned, 'top');
      await F.waitForUpdate();
      const body0 = F.grid.pageItems[0];

      F.cellOf(pinned, 'name').dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, composed: true })
      );
      await F.waitForUpdate();

      const editors = F.openEditors();
      expect(editors.length).to.equal(1);
      expect(editors[0].record, 'editor in the pinned row').to.equal(pinned);
      expect(F.grid.editingCell).to.deep.equal({ rowIndex: -1, columnKey: 'name' });

      F.type(editors[0].input, 'PINNED');
      await F.press(editors[0].input, 'Enter');
      expect(pinned.name).to.equal('PINNED');
      expect(body0.name).to.equal('A');
    });
  });

  describe('row mode shows and validates the staged row', () => {
    beforeEach(async () => {
      F.editing = { enabled: true, mode: 'row' };
      F.rowPinning = { enabled: false };
      await F.setUp();
    });

    it('a staged cell shows its staged value, also when re-opened (core-editing-history-4)', async () => {
      const record = F.grid.data[0];
      await F.grid.editCell(0, 'name');
      await F.waitForUpdate();
      const [editor] = F.openEditors();
      F.type(editor.input, 'Staged');
      await F.press(editor.input, 'Enter');

      expect(F.grid.editingRow).to.equal(0);
      expect(record.name, 'not yet committed').to.equal('A');
      expect(F.cellOf(record, 'name').value, 'cell shows the staged value').to.equal('Staged');

      await F.grid.editCell(0, 'name');
      await F.waitForUpdate();
      const [reopened] = F.openEditors();
      expect(reopened.input.value, 're-opened editor shows staged').to.equal('Staged');
      await F.press(reopened.input, 'Enter');
      expect(F.cellOf(record, 'name').value, 'untouched re-open keeps it staged').to.equal(
        'Staged'
      );

      F.grid.cancelEdit();
      await F.waitForUpdate();
      expect(F.cellOf(record, 'name').value, 'cancel shows the record again').to.equal('A');
    });

    it('re-entering the original value unstages it (core-editing-history-5)', async () => {
      const record = F.grid.data[0];
      await F.grid.editCell(0, 'id');
      await F.waitForUpdate();
      F.type(F.openEditors()[0].input, '-5');
      await F.press(F.openEditors()[0].input, 'Enter');
      expect(await F.grid.commitEdit(), 'invalid row rejected').to.equal(false);

      await F.grid.editCell(0, 'id');
      await F.waitForUpdate();
      F.type(F.openEditors()[0].input, '1');
      await F.press(F.openEditors()[0].input, 'Enter');
      expect(await F.grid.commitEdit(), 'restored row commits').to.equal(true);
      await F.waitForUpdate();
      expect(record.id).to.equal(1);
      expect(F.cellOf(record, 'id').hasAttribute('aria-invalid')).to.equal(false);
    });

    it('a cancelled cell aborts the whole row before any write (core-editing-history-6)', async () => {
      const record = F.grid.data[0];
      const changed: string[] = [];
      F.grid.addEventListener('cellValueChanging', (e) => {
        if (e.detail.key === 'start') e.preventDefault();
      });
      F.grid.addEventListener('cellValueChanged', (e) => changed.push(String(e.detail.key)));
      await F.grid.editCell(0, 'name');
      await F.waitForUpdate();
      F.type(F.openEditors()[0].input, 'N');
      await F.press(F.openEditors()[0].input, 'Enter');
      await F.grid.editCell(0, 'start');
      await F.waitForUpdate();
      F.type(F.openEditors()[0].input, '0');
      await F.press(F.openEditors()[0].input, 'Enter');

      expect(await F.grid.commitEdit()).to.equal(false);
      expect(record.name, 'no partial write').to.equal('A');
      expect(changed).to.deep.equal([]);
      expect(F.grid.editingRow, 'row stays open').to.equal(0);
    });

    it('validates against the staged row (sweep-editing-state-5)', async () => {
      const record = F.grid.data[1]; // start 10, end 12
      await F.grid.editRow(1);
      await F.grid.editCell(1, 'start');
      await F.waitForUpdate();
      F.type(F.openEditors()[0].input, '1');
      await F.press(F.openEditors()[0].input, 'Enter');
      await F.grid.editCell(1, 'end');
      await F.waitForUpdate();
      F.type(F.openEditors()[0].input, '5');
      await F.press(F.openEditors()[0].input, 'Enter');
      expect(await F.grid.commitEdit(), 'start 1, end 5 is a valid row').to.equal(true);
      expect([record.start, record.end]).to.deep.equal([1, 5]);

      await F.grid.editCell(1, 'start');
      await F.waitForUpdate();
      F.type(F.openEditors()[0].input, '20');
      await F.press(F.openEditors()[0].input, 'Enter');
      expect(await F.grid.commitEdit(), 'start 20 makes end 5 invalid').to.equal(false);
      await F.waitForUpdate();
      expect(record.start).to.equal(1);
      expect(F.cellOf(record, 'end').getAttribute('aria-invalid')).to.equal('true');
    });

    it('clears the error of a cell that now passes (core-editing-history-11)', async () => {
      const record = F.grid.data[0];
      await F.grid.editCell(0, 'name');
      await F.waitForUpdate();
      F.type(F.openEditors()[0].input, '');
      await F.press(F.openEditors()[0].input, 'Enter');
      await F.grid.editCell(0, 'id');
      await F.waitForUpdate();
      F.type(F.openEditors()[0].input, '-1');
      await F.press(F.openEditors()[0].input, 'Enter');
      expect(await F.grid.commitEdit()).to.equal(false);
      await F.waitForUpdate();
      expect(F.cellOf(record, 'name').getAttribute('aria-invalid')).to.equal('true');

      await F.grid.editCell(0, 'name');
      await F.waitForUpdate();
      F.type(F.openEditors()[0].input, 'Fixed');
      await F.press(F.openEditors()[0].input, 'Enter');
      expect(await F.grid.commitEdit()).to.equal(false);
      await F.waitForUpdate();
      expect(F.cellOf(record, 'name').hasAttribute('aria-invalid'), 'name now passes').to.equal(
        false
      );
      expect(F.cellOf(record, 'id').getAttribute('aria-invalid')).to.equal('true');
    });

    it('a committed cell shows the record value, also when a listener restores it', async () => {
      const record = F.grid.data[0];
      F.grid.addEventListener('cellValueChanged', (e) => {
        (e.detail.data as Row).name = 'A';
      });
      await F.grid.editCell(0, 'name');
      await F.waitForUpdate();
      F.type(F.openEditors()[0].input, 'X');
      await F.press(F.openEditors()[0].input, 'Enter');
      expect(F.cellOf(record, 'name').value, 'staged').to.equal('X');

      expect(await F.grid.commitEdit()).to.equal(true);
      await F.waitForUpdate();
      expect(record.name).to.equal('A');
      expect(F.cellOf(record, 'name').value, 'cell shows the record').to.equal('A');
    });

    it('runs a validator that cannot read the staged copy against the record', async () => {
      class Account {
        #limit = 10;
        constructor(
          public id: number,
          public name: string,
          public start: number,
          public end: number,
          public active: boolean
        ) {}
        get limit() {
          return this.#limit;
        }
      }
      const record = new Account(1, 'A', 1, 50, false) as unknown as Row;
      F.grid.columns = F.grid.columns.map((column) =>
        column.key === 'start'
          ? {
              ...column,
              validators: [
                custom<Row>((value, ctx) =>
                  (value as number) > (ctx.data as unknown as Account).limit ? 'Over limit' : null
                ),
              ],
            }
          : column
      ) as ColumnConfiguration<Row>[];
      F.grid.data = [record];
      await F.waitForUpdate();

      await F.grid.editCell(0, 'start');
      await F.waitForUpdate();
      F.type(F.openEditors()[0].input, '3');
      await F.press(F.openEditors()[0].input, 'Enter');
      expect(await F.grid.commitEdit()).to.equal(true);
      expect(record.start).to.equal(3);

      await F.grid.editCell(0, 'start');
      await F.waitForUpdate();
      F.type(F.openEditors()[0].input, '30');
      await F.press(F.openEditors()[0].input, 'Enter');
      expect(await F.grid.commitEdit(), 'over the limit').to.equal(false);
      expect(record.start).to.equal(3);
    });

    it('a date editor re-opened on a staged clear still writes a Date', async () => {
      await addDateColumn();
      const record = F.grid.data[0];
      await F.grid.editCell(0, 'when');
      await F.waitForUpdate();
      clearDate(F.openEditors()[0].input);
      await F.press(F.openEditors()[0].input, 'Tab');
      expect(F.cellOf(record, 'when').value, 'clear staged').to.equal(null);

      await F.grid.editCell(0, 'when');
      await F.waitForUpdate();
      pickDate(F.openEditors()[0].input, '2024-05-06');
      await F.waitForUpdate();
      expect(await F.grid.commitEdit()).to.equal(true);
      expect(record.when).to.be.instanceOf(Date);
      expect(record.when!.getDate()).to.equal(6);
    });

    it('a checkbox toggle joins the row buffer (sweep-editing-state-6)', async () => {
      const record = F.grid.data[0];
      await F.grid.editRow(0);
      await F.waitForUpdate();
      const box = () =>
        F.cellOf(record, 'active').shadowRoot!.querySelector<HTMLInputElement>(
          'input[type="checkbox"]'
        )!;
      box().click();
      await F.waitForUpdate();
      expect(record.active, 'staged, not written').to.equal(false);
      expect(box().checked, 'shows the staged value').to.equal(true);

      F.grid.cancelEdit();
      await F.waitForUpdate();
      expect(record.active).to.equal(false);
      expect(box().checked, 'cancel restores the record value').to.equal(false);
    });
  });
});

describe('Cell decoration on pinned rows (core-state-seam-1)', () => {
  const seen: Array<{ row: Row; rowIndex: number }> = [];

  class Recorder implements ReactiveController, CellDecorator<Row> {
    constructor(host: GridHost<Row>) {
      host.addController(this);
    }
    hostConnected() {}
    decorateCell(ctx: CellDecoratorContext<Row>): CellDecoration | null {
      if (ctx.column.key === 'id') seen.push({ row: ctx.row, rowIndex: ctx.rowIndex });
      return null;
    }
  }

  const recorder: GridFeatureModule<Row> = {
    id: 'edit-identity-recorder',
    create: (host) => new Recorder(host as GridHost<Row>),
  };

  class RecorderGrid<T extends object> extends ApexGrid<T> {
    public static override get tagName() {
      return 'apex-grid-edit-identity-test';
    }
    public static override register() {
      if (!customElements.get(RecorderGrid.tagName)) {
        customElements.define(RecorderGrid.tagName, RecorderGrid);
      }
    }
    protected override createStateController(): StateController<T> {
      return new StateController<T>(this, [recorder as unknown as GridFeatureModule<T>]);
    }
  }

  afterEach(() => F.tearDown());

  it('reports a pinned row as outside the body view', async () => {
    RecorderGrid.register();
    const rows = structuredClone(SOURCE);
    const grid = await fixture<RecorderGrid<Row>>(
      html`<apex-grid-edit-identity-test
        .data=${rows}
        .columns=${[{ key: 'id' }, { key: 'name' }]}
        .rowPinning=${{ enabled: true }}
      ></apex-grid-edit-identity-test>`
    );
    await grid.updateComplete;
    await nextFrame();
    seen.length = 0;
    grid.pinRow(rows[3], 'top');
    await grid.updateComplete;
    // Re-decorate every rendered cell against the settled view.
    // @ts-expect-error - protected member access
    (grid.stateController as StateController<Row>).bumpDecoration();
    await grid.updateComplete;
    await nextFrame();

    const pinned = seen.filter((entry) => entry.row === rows[3]);
    expect(pinned.length, 'pinned row decorated').to.be.greaterThan(0);
    expect([...new Set(pinned.map((entry) => entry.rowIndex))]).to.deep.equal([-1]);
    const body = seen.filter((entry) => entry.row !== rows[3]);
    expect(body.length, 'shifted body rows re-decorated').to.be.greaterThan(0);
    for (const entry of body) {
      expect(entry.rowIndex).to.equal(grid.pageItems.indexOf(entry.row));
    }
  });
});
