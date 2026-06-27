import { expect, html } from '@open-wc/testing';
import type ApexGridCell from '../src/components/cell.js';
import type {
  ColumnConfiguration,
  GridEditingConfiguration,
  ValidatorContext,
} from '../src/internal/types.js';
import { custom, max, min, pattern, required, runValidators } from '../src/internal/validators.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

// Minimal context for the pure-function tests — the built-in validators never
// read it.
const CTX = {} as ValidatorContext<TestData>;

describe('Built-in validators', () => {
  it('required rejects blank values and accepts the rest', () => {
    const validate = required<TestData>();
    expect(validate(null, CTX)).to.be.a('string');
    expect(validate(undefined, CTX)).to.be.a('string');
    expect(validate('', CTX)).to.be.a('string');
    expect(validate('   ', CTX)).to.be.a('string');
    expect(validate('x', CTX)).to.be.null;
    expect(validate(0, CTX)).to.be.null;
    expect(validate(false, CTX)).to.be.null;
  });

  it('min rejects values below the limit, passes empty / non-numeric', () => {
    const validate = min<TestData>(10);
    expect(validate(9, CTX)).to.be.a('string');
    expect(validate(10, CTX)).to.be.null;
    expect(validate(11, CTX)).to.be.null;
    expect(validate('', CTX)).to.be.null;
    expect(validate(null, CTX)).to.be.null;
    expect(validate('abc', CTX)).to.be.null;
  });

  it('max rejects values above the limit, passes empty / non-numeric', () => {
    const validate = max<TestData>(5);
    expect(validate(6, CTX)).to.be.a('string');
    expect(validate(5, CTX)).to.be.null;
    expect(validate(4, CTX)).to.be.null;
    expect(validate('', CTX)).to.be.null;
    expect(validate('abc', CTX)).to.be.null;
  });

  it('pattern rejects non-matching strings, passes empty', () => {
    const validate = pattern<TestData>(/^[A-Z]+$/);
    expect(validate('abc', CTX)).to.be.a('string');
    expect(validate('ABC', CTX)).to.be.null;
    expect(validate('', CTX)).to.be.null;
    expect(validate(null, CTX)).to.be.null;
  });

  it('custom wraps a predicate verbatim', () => {
    const fn = custom<TestData>((value) => (value === 'bad' ? 'nope' : null));
    expect(fn('bad', CTX)).to.equal('nope');
    expect(fn('ok', CTX)).to.be.null;
  });

  it('runValidators collects every error, in order', () => {
    const validators = [
      custom<TestData>((v) => (String(v).length < 3 ? 'too short' : null)),
      custom<TestData>((v) => (/\d/.test(String(v)) ? null : 'needs a digit')),
    ];
    expect(runValidators(validators, 'x', CTX)).to.deep.equal(['too short', 'needs a digit']);
    expect(runValidators(validators, 'abc1', CTX)).to.deep.equal([]);
    expect(runValidators(undefined, 'x', CTX)).to.deep.equal([]);
  });

  it('custom validators receive the candidate value and context', () => {
    const seen: Array<{ value: unknown; rowIndex: number }> = [];
    const fn = custom<TestData>((value, context) => {
      seen.push({ value, rowIndex: context.rowIndex });
      return null;
    });
    fn('v', { column: {} as ColumnConfiguration<TestData>, data: {} as TestData, rowIndex: 3 });
    expect(seen).to.deep.equal([{ value: 'v', rowIndex: 3 }]);
  });
});

class ValidationFixture<T extends TestData> extends GridTestFixture<T> {
  public editing: GridEditingConfiguration = {
    enabled: true,
    mode: 'cell',
    trigger: 'doubleClick',
  };

  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number', editable: true, validators: [min(10)] },
      { key: 'name', editable: true, validators: [required()] },
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

  public cellEl(rowIndex: number, columnKey: string): ApexGridCell<T> {
    return this.rows.get(rowIndex).cells.get(columnKey as never).element;
  }

  public cellInput(rowIndex: number, columnKey: string): HTMLInputElement | null {
    return this.cellEl(rowIndex, columnKey).shadowRoot!.querySelector<HTMLInputElement>(
      'input[data-apex-editor]'
    );
  }

  public errorNode(rowIndex: number, columnKey: string): HTMLElement | null {
    return this.cellEl(rowIndex, columnKey).shadowRoot!.querySelector<HTMLElement>(
      '[part~="cell-error"]'
    );
  }

  public async typeAndEnter(rowIndex: number, columnKey: string, value: string) {
    const input = this.cellInput(rowIndex, columnKey)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await this.waitForUpdate();
  }
}

const TDD = new ValidationFixture(data);

describe('Cell validation — cell mode', () => {
  beforeEach(async () => await TDD.setUp());
  afterEach(() => TDD.tearDown());

  it('blocks the write, keeps the editor open and emits cellValidationFailed', async () => {
    const failures: Array<{ key: string; errors: readonly string[] }> = [];
    TDD.grid.addEventListener('cellValidationFailed', (event) => {
      failures.push({ key: String(event.detail.key), errors: event.detail.errors });
    });

    await TDD.grid.editCell(0, 'name');
    await TDD.waitForUpdate();
    await TDD.typeAndEnter(0, 'name', '');

    // Value not written, editor still open.
    expect(TDD.grid.data[0].name).to.equal('A');
    expect(TDD.grid.editingCell).to.deep.equal({ rowIndex: 0, columnKey: 'name' });
    expect(failures).to.have.lengthOf(1);
    expect(failures[0].key).to.equal('name');
    expect(failures[0].errors).to.have.lengthOf(1);
  });

  it('marks the cell aria-invalid and renders an alert error node', async () => {
    await TDD.grid.editCell(0, 'name');
    await TDD.waitForUpdate();
    await TDD.typeAndEnter(0, 'name', '');

    const cell = TDD.cellEl(0, 'name');
    expect(cell.getAttribute('aria-invalid')).to.equal('true');
    expect(cell.getAttribute('aria-errormessage')).to.equal('apex-cell-error');
    expect(cell.hasAttribute('data-invalid')).to.be.true;

    const error = TDD.errorNode(0, 'name');
    expect(error, 'error node rendered').to.exist;
    expect(error!.getAttribute('role')).to.equal('alert');
    expect(error!.textContent).to.have.length.greaterThan(0);
  });

  it('writes normally and stays valid when validation passes', async () => {
    await TDD.grid.editCell(0, 'name');
    await TDD.waitForUpdate();
    await TDD.typeAndEnter(0, 'name', 'Valid');

    expect(TDD.grid.data[0].name).to.equal('Valid');
    expect(TDD.grid.editingCell).to.be.null;
    expect(TDD.cellEl(0, 'name').hasAttribute('aria-invalid')).to.be.false;
    expect(TDD.errorNode(0, 'name')).to.not.exist;
  });

  it('clears the invalid state once a valid value is committed', async () => {
    await TDD.grid.editCell(0, 'name');
    await TDD.waitForUpdate();
    await TDD.typeAndEnter(0, 'name', '');
    expect(TDD.cellEl(0, 'name').getAttribute('aria-invalid')).to.equal('true');

    // Editor stayed open — fix the value and re-commit.
    await TDD.typeAndEnter(0, 'name', 'Fixed');
    expect(TDD.grid.data[0].name).to.equal('Fixed');
    expect(TDD.cellEl(0, 'name').hasAttribute('aria-invalid')).to.be.false;
    expect(TDD.grid.editingCell).to.be.null;
  });

  it('clears the invalid state when the edit is cancelled with Escape', async () => {
    await TDD.grid.editCell(0, 'name');
    await TDD.waitForUpdate();
    await TDD.typeAndEnter(0, 'name', '');
    expect(TDD.cellEl(0, 'name').getAttribute('aria-invalid')).to.equal('true');

    const input = TDD.cellInput(0, 'name')!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await TDD.waitForUpdate();

    expect(TDD.grid.editingCell).to.be.null;
    expect(TDD.cellEl(0, 'name').hasAttribute('aria-invalid')).to.be.false;
  });

  it('validates numeric columns via the min validator', async () => {
    await TDD.grid.editCell(0, 'id');
    await TDD.waitForUpdate();
    await TDD.typeAndEnter(0, 'id', '5');
    expect(TDD.grid.data[0].id).to.equal(1);
    expect(TDD.cellEl(0, 'id').getAttribute('aria-invalid')).to.equal('true');

    await TDD.typeAndEnter(0, 'id', '42');
    expect(TDD.grid.data[0].id).to.equal(42);
  });
});

class RowValidationFixture<T extends TestData> extends ValidationFixture<T> {
  public override editing: GridEditingConfiguration = { enabled: true, mode: 'row' };
}

describe('Cell validation — row mode', () => {
  const rowTDD = new RowValidationFixture(data);
  beforeEach(async () => await rowTDD.setUp());
  afterEach(() => rowTDD.tearDown());

  it('aborts the whole row commit without a partial write when a cell is invalid', async () => {
    const failures: string[] = [];
    rowTDD.grid.addEventListener('cellValidationFailed', (event) =>
      failures.push(String(event.detail.key))
    );

    await rowTDD.grid.editRow(0);

    // Stage a valid id and an invalid (blank) name.
    await rowTDD.grid.editCell(0, 'id');
    await rowTDD.waitForUpdate();
    let input = rowTDD.cellInput(0, 'id')!;
    input.value = '50';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await rowTDD.waitForUpdate();

    await rowTDD.grid.editCell(0, 'name');
    await rowTDD.waitForUpdate();
    input = rowTDD.cellInput(0, 'name')!;
    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await rowTDD.waitForUpdate();

    const committed = await rowTDD.grid.commitEdit();
    await rowTDD.waitForUpdate();

    expect(committed).to.be.false;
    // Neither pending value was written (atomic abort).
    expect(rowTDD.grid.data[0].id).to.equal(1);
    expect(rowTDD.grid.data[0].name).to.equal('A');
    // Row stays in edit mode and the failing cell is marked.
    expect(rowTDD.grid.editingRow).to.equal(0);
    expect(failures).to.include('name');
    expect(rowTDD.cellEl(0, 'name').getAttribute('aria-invalid')).to.equal('true');
  });

  it('commits the row when every staged cell is valid', async () => {
    await rowTDD.grid.editRow(0);

    await rowTDD.grid.editCell(0, 'name');
    await rowTDD.waitForUpdate();
    const input = rowTDD.cellInput(0, 'name')!;
    input.value = 'Renamed';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await rowTDD.waitForUpdate();

    const committed = await rowTDD.grid.commitEdit();
    await rowTDD.waitForUpdate();

    expect(committed).to.be.true;
    expect(rowTDD.grid.data[0].name).to.equal('Renamed');
    expect(rowTDD.grid.editingRow).to.be.null;
  });
});
