import { expect, html } from '@open-wc/testing';
import type { ColumnConfiguration, GridEditingConfiguration } from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

class SelectFixture<T extends TestData> extends GridTestFixture<T> {
  public editing: GridEditingConfiguration = {
    enabled: true,
    mode: 'cell',
    trigger: 'doubleClick',
  };

  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number' },
      { key: 'name' },
      {
        key: 'importance',
        type: 'select',
        editable: true,
        options: [
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
        ],
      },
    ] as ColumnConfiguration<T>[];
  }

  public records!: T[];

  public override async setUp() {
    this.records = JSON.parse(JSON.stringify(data)) as T[];
    this.data = this.records;
    await super.setUp();
  }

  public override setupTemplate() {
    return html`<apex-grid
      .data=${this.data}
      .columns=${this.columnConfig}
      .editing=${this.editing}
    ></apex-grid>`;
  }

  public cellText(rowIndex: number, columnKey: string): string {
    const row = this.rows.get(rowIndex);
    const cell = row.cells.get(columnKey as never).element;
    return (cell.shadowRoot!.textContent ?? '').trim();
  }

  public cellSelect(rowIndex: number, columnKey: string): HTMLSelectElement | null {
    const row = this.rows.get(rowIndex);
    const cell = row.cells.get(columnKey as never).element;
    return cell.shadowRoot!.querySelector<HTMLSelectElement>('select[data-apex-editor]');
  }
}

const TDD = new SelectFixture(data);

describe('Column type: select', () => {
  beforeEach(async () => await TDD.setUp());
  afterEach(() => TDD.tearDown());

  describe('display', () => {
    it('renders the matching option label rather than the raw value', () => {
      // data[0].importance === 'medium' → label 'Medium'
      expect(TDD.cellText(0, 'importance')).to.equal('Medium');
    });

    it('falls back to the raw value when no option matches', async () => {
      // Mutate a row to a value not in the options list and ensure we don't blow up.
      await TDD.updateProperty('data', [
        { ...TDD.records[0], importance: 'unknown' as never },
        ...TDD.records.slice(1),
      ]);
      expect(TDD.cellText(0, 'importance')).to.equal('unknown');
    });

    it('accepts plain string options (no label needed)', async () => {
      await TDD.updateColumns({
        key: 'importance',
        type: 'select',
        editable: true,
        options: ['low', 'medium', 'high'] as never,
      });
      expect(TDD.cellText(0, 'importance')).to.equal('medium');
    });
  });

  describe('editor', () => {
    it('renders a native <select> with all options on edit-mode entry', async () => {
      await TDD.grid.editCell(0, 'importance');
      await TDD.waitForUpdate();
      const select = TDD.cellSelect(0, 'importance');
      expect(select).to.exist;
      expect(select!.options.length).to.equal(3);
      expect(select!.options[1].textContent?.trim()).to.equal('Medium');
    });

    it('preselects the current value', async () => {
      await TDD.grid.editCell(0, 'importance');
      await TDD.waitForUpdate();
      const select = TDD.cellSelect(0, 'importance')!;
      expect(select.options[select.selectedIndex].textContent?.trim()).to.equal('Medium');
    });

    it('commits the chosen value on change', async () => {
      await TDD.grid.editCell(0, 'importance');
      await TDD.waitForUpdate();

      const select = TDD.cellSelect(0, 'importance')!;
      select.selectedIndex = 2; // 'high'
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await TDD.waitForUpdate();

      expect(TDD.grid.editingCell).to.be.null;
      expect(TDD.records[0].importance).to.equal('high');
      expect(TDD.cellText(0, 'importance')).to.equal('High');
    });

    it('cancels on Escape without mutating the value', async () => {
      const before = TDD.records[0].importance;
      await TDD.grid.editCell(0, 'importance');
      await TDD.waitForUpdate();

      const select = TDD.cellSelect(0, 'importance')!;
      select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await TDD.waitForUpdate();

      expect(TDD.grid.editingCell).to.be.null;
      expect(TDD.records[0].importance).to.equal(before);
    });

    it('emits cellValueChanging + cellValueChanged for select commits', async () => {
      const seen: string[] = [];
      TDD.grid.addEventListener('cellValueChanging', (event) => {
        seen.push(`changing:${event.detail.oldValue}->${event.detail.newValue}`);
      });
      TDD.grid.addEventListener('cellValueChanged', (event) => {
        seen.push(`changed:${event.detail.value}`);
      });

      await TDD.grid.editCell(0, 'importance');
      await TDD.waitForUpdate();
      const select = TDD.cellSelect(0, 'importance')!;
      select.selectedIndex = 2;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await TDD.waitForUpdate();

      expect(seen).to.deep.equal(['changing:medium->high', 'changed:high']);
    });
  });

  describe('integration with cellTemplate / editorTemplate', () => {
    it('cellTemplate takes precedence over the type renderer for display', async () => {
      await TDD.updateColumns({
        key: 'importance',
        type: 'select',
        editable: true,
        options: [{ value: 'medium', label: 'Medium' }] as never,
        cellTemplate: (ctx) => html`<span data-custom>${ctx.value}-custom</span>`,
      });
      const row = TDD.rows.get(0);
      const cell = row.cells.get('importance' as never).element;
      expect(cell.shadowRoot!.querySelector('[data-custom]')).to.exist;
      expect(TDD.cellText(0, 'importance')).to.equal('medium-custom');
    });

    it('editorTemplate takes precedence over the type editor', async () => {
      await TDD.updateColumns({
        key: 'importance',
        type: 'select',
        editable: true,
        options: [{ value: 'medium', label: 'Medium' }] as never,
        editorTemplate: () => html`<textarea data-apex-editor></textarea>`,
      });

      await TDD.grid.editCell(0, 'importance');
      await TDD.waitForUpdate();

      const row = TDD.rows.get(0);
      const cell = row.cells.get('importance' as never).element;
      expect(cell.shadowRoot!.querySelector('textarea')).to.exist;
      expect(cell.shadowRoot!.querySelector('select')).to.be.null;
    });
  });
});
