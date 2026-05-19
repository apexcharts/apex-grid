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

class RatingFixture<T extends TestData> extends GridTestFixture<T> {
  public editing: GridEditingConfiguration = {
    enabled: true,
    mode: 'cell',
    trigger: 'doubleClick',
  };

  public records!: T[];

  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'rating', editable: true, max: 5 },
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
      .editing=${this.editing}
    ></apex-grid>`;
  }

  public ratingHost(rowIndex: number): HTMLElement | null {
    const row = this.rows.get(rowIndex);
    const cell = row.cells.get('id' as never).element;
    return cell.shadowRoot!.querySelector<HTMLElement>('[part~="rating"]');
  }

  public ratingEditor(rowIndex: number): HTMLElement | null {
    const row = this.rows.get(rowIndex);
    const cell = row.cells.get('id' as never).element;
    return cell.shadowRoot!.querySelector<HTMLElement>('[part="rating-editor"]');
  }

  public stars(rowIndex: number): HTMLElement[] {
    const host = this.ratingHost(rowIndex) ?? this.ratingEditor(rowIndex);
    return host ? Array.from(host.querySelectorAll<HTMLElement>('[part~="rating-star"]')) : [];
  }
}

const RTDD = new RatingFixture(data);

describe('Column type: rating', () => {
  beforeEach(async () => await RTDD.setUp());
  afterEach(() => RTDD.tearDown());

  describe('display', () => {
    it('renders `max` stars with `value` filled', () => {
      // data[2].id === 3 → 3 filled, 2 empty
      const stars = RTDD.stars(2);
      expect(stars).to.have.length(5);
      expect(stars.filter((s) => s.getAttribute('part')?.includes('filled'))).to.have.length(3);
    });

    it('clamps values outside [0, max]', async () => {
      await RTDD.updateProperty('data', [
        { ...RTDD.records[0], id: 99 as never },
        { ...RTDD.records[1], id: -3 as never },
        ...RTDD.records.slice(2),
      ]);
      const overflow = RTDD.stars(0).filter((s) => s.getAttribute('part')?.includes('filled'));
      const underflow = RTDD.stars(1).filter((s) => s.getAttribute('part')?.includes('filled'));
      expect(overflow).to.have.length(5);
      expect(underflow).to.have.length(0);
    });

    it('honors a custom `max`', async () => {
      await RTDD.updateColumns({ key: 'id', type: 'rating', editable: true, max: 10 });
      expect(RTDD.stars(0)).to.have.length(10);
    });

    it('falls back to max=5 when max is missing or invalid', async () => {
      await RTDD.updateColumns({ key: 'id', type: 'rating', editable: true });
      expect(RTDD.stars(0)).to.have.length(5);
    });
  });

  describe('editor', () => {
    it('renders an interactive radiogroup of star buttons on edit-mode entry', async () => {
      await RTDD.grid.editCell(0, 'id');
      await RTDD.waitForUpdate();

      const editor = RTDD.ratingEditor(0);
      expect(editor).to.exist;
      expect(editor!.getAttribute('role')).to.equal('radiogroup');
      const buttons = RTDD.stars(0);
      expect(buttons.every((b) => b.tagName === 'BUTTON')).to.be.true;
    });

    it('commits the clicked star value', async () => {
      await RTDD.grid.editCell(2, 'id');
      await RTDD.waitForUpdate();

      const stars = RTDD.stars(2);
      stars[3].click(); // 4th star → value 4
      await RTDD.waitForUpdate();

      expect(RTDD.grid.editingCell).to.be.null;
      expect(RTDD.records[2].id).to.equal(4);
    });

    it('cancels on Escape without mutating the value', async () => {
      const before = RTDD.records[2].id;
      await RTDD.grid.editCell(2, 'id');
      await RTDD.waitForUpdate();

      const editor = RTDD.ratingEditor(2)!;
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await RTDD.waitForUpdate();

      expect(RTDD.grid.editingCell).to.be.null;
      expect(RTDD.records[2].id).to.equal(before);
    });

    it('emits cellValueChanging + cellValueChanged for rating commits', async () => {
      const seen: string[] = [];
      RTDD.grid.addEventListener('cellValueChanging', (event) => {
        seen.push(`changing:${event.detail.oldValue}->${event.detail.newValue}`);
      });
      RTDD.grid.addEventListener('cellValueChanged', (event) => {
        seen.push(`changed:${event.detail.value}`);
      });

      await RTDD.grid.editCell(2, 'id'); // current = 3
      await RTDD.waitForUpdate();
      RTDD.stars(2)[0].click(); // → 1
      await RTDD.waitForUpdate();

      expect(seen).to.deep.equal(['changing:3->1', 'changed:1']);
    });
  });
});
