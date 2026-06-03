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

  public popover(rowIndex: number, columnKey: string): HTMLElement | null {
    const row = this.rows.get(rowIndex);
    const cell = row.cells.get(columnKey as never).element;
    return cell.shadowRoot!.querySelector<HTMLElement>('[part~="select-popover"]');
  }

  public options(rowIndex: number, columnKey: string): HTMLElement[] {
    const pop = this.popover(rowIndex, columnKey);
    return pop ? Array.from(pop.querySelectorAll<HTMLElement>('[part~="select-option"]')) : [];
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

    it('does not render the listbox popover until edit mode is entered', () => {
      expect(TDD.popover(0, 'importance')).to.be.null;
    });
  });

  describe('editor', () => {
    it('renders a listbox popover with all options on edit-mode entry', async () => {
      await TDD.grid.editCell(0, 'importance');
      await TDD.waitForUpdate();
      const popover = TDD.popover(0, 'importance');
      expect(popover).to.exist;
      expect(popover!.getAttribute('role')).to.equal('listbox');
      const options = TDD.options(0, 'importance');
      expect(options).to.have.length(3);
      expect(options[1].textContent?.trim()).to.equal('Medium');
    });

    it('marks the current value as aria-selected', async () => {
      await TDD.grid.editCell(0, 'importance');
      await TDD.waitForUpdate();
      const options = TDD.options(0, 'importance');
      expect(options[1].getAttribute('aria-selected')).to.equal('true');
      expect(options[0].getAttribute('aria-selected')).to.equal('false');
      expect(options[2].getAttribute('aria-selected')).to.equal('false');
    });

    it('commits the clicked option value', async () => {
      await TDD.grid.editCell(0, 'importance');
      await TDD.waitForUpdate();

      const options = TDD.options(0, 'importance');
      options[2].click(); // 'high'
      await TDD.waitForUpdate();

      expect(TDD.grid.editingCell).to.be.null;
      expect(TDD.records[0].importance).to.equal('high');
      expect(TDD.cellText(0, 'importance')).to.equal('High');
    });

    it('commits the focused option on Enter', async () => {
      await TDD.grid.editCell(0, 'importance');
      await TDD.waitForUpdate();

      const options = TDD.options(0, 'importance');
      // Simulate keyboard nav landing on the third option then pressing Enter.
      options[2].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true })
      );
      await TDD.waitForUpdate();

      expect(TDD.records[0].importance).to.equal('high');
      expect(TDD.grid.editingCell).to.be.null;
    });

    it('cancels on Escape without mutating the value', async () => {
      const before = TDD.records[0].importance;
      await TDD.grid.editCell(0, 'importance');
      await TDD.waitForUpdate();

      const popover = TDD.popover(0, 'importance')!;
      popover.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })
      );
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
      TDD.options(0, 'importance')[2].click();
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
      expect(cell.shadowRoot!.querySelector('[part~="select-popover"]')).to.be.null;
    });
  });

  describe('cell-level editing flow', () => {
    it('Tab key while editing exits the editor (cell-level handler)', async () => {
      await TDD.grid.editCell(0, 'importance');
      await TDD.waitForUpdate();

      const popover = TDD.popover(0, 'importance')!;
      popover.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, composed: true })
      );
      await TDD.waitForUpdate();

      expect(TDD.grid.editingCell).to.be.null;
    });

    it('focus-out to outside the cell exits the editor', async () => {
      await TDD.grid.editCell(0, 'importance');
      await TDD.waitForUpdate();

      const cell = TDD.rows.get(0).cells.get('importance' as never).element;
      cell.dispatchEvent(
        new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: null })
      );
      await TDD.waitForUpdate();

      expect(TDD.grid.editingCell).to.be.null;
    });

    it('focus-out within the same cell does NOT exit the editor', async () => {
      await TDD.grid.editCell(0, 'importance');
      await TDD.waitForUpdate();

      const cell = TDD.rows.get(0).cells.get('importance' as never).element;
      const option = TDD.options(0, 'importance')[1];
      cell.dispatchEvent(
        new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: option })
      );
      await TDD.waitForUpdate();

      expect(TDD.grid.editingCell).to.not.be.null;
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

    it('clicking the currently-rated star clears the rating to 0', async () => {
      // data[2].id === 3 → clicking the third star clears to 0.
      await RTDD.grid.editCell(2, 'id');
      await RTDD.waitForUpdate();

      const stars = RTDD.stars(2);
      stars[2].click(); // rank 3 === current → clear
      await RTDD.waitForUpdate();

      expect(RTDD.records[2].id).to.equal(0);
    });

    it('cancels on Escape without mutating the value', async () => {
      const before = RTDD.records[2].id;
      await RTDD.grid.editCell(2, 'id');
      await RTDD.waitForUpdate();

      const editor = RTDD.ratingEditor(2)!;
      editor.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })
      );
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

interface DateData extends TestData {
  joinedAt: string;
}

const dateData: DateData[] = data.map((row, idx) => ({
  ...row,
  joinedAt: `2025-0${idx + 1}-15`, // 2025-01-15 .. 2025-08-15
}));

class DateFixture<T extends DateData> extends GridTestFixture<T> {
  public editing: GridEditingConfiguration = {
    enabled: true,
    mode: 'cell',
    trigger: 'doubleClick',
  };

  public records!: T[];

  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number' },
      { key: 'joinedAt', type: 'date', editable: true, format: 'short' },
    ] as ColumnConfiguration<T>[];
  }

  public override async setUp() {
    this.records = JSON.parse(JSON.stringify(dateData)) as T[];
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

  public cellText(rowIndex: number): string {
    const row = this.rows.get(rowIndex);
    const cell = row.cells.get('joinedAt' as never).element;
    return (cell.shadowRoot!.textContent ?? '').trim();
  }

  public dateInput(rowIndex: number): HTMLInputElement | null {
    const row = this.rows.get(rowIndex);
    const cell = row.cells.get('joinedAt' as never).element;
    return cell.shadowRoot!.querySelector<HTMLInputElement>('input[type="date"][data-apex-editor]');
  }
}

const DTDD = new DateFixture(dateData);

describe('Column type: date', () => {
  beforeEach(async () => await DTDD.setUp());
  afterEach(() => DTDD.tearDown());

  describe('display', () => {
    it('formats stored ISO YYYY-MM-DD strings via Intl.DateTimeFormat', () => {
      // Don't assert exact locale text (runner-dependent); just ensure we
      // produced something non-empty that doesn't look like raw ISO.
      const text = DTDD.cellText(0);
      expect(text).to.not.equal('2025-01-15');
      expect(text.length).to.be.greaterThan(0);
    });

    it('renders empty for null / invalid values without throwing', async () => {
      await DTDD.updateProperty('data', [
        { ...DTDD.records[0], joinedAt: null as never },
        { ...DTDD.records[1], joinedAt: 'not a date' as never },
        ...DTDD.records.slice(2),
      ]);
      expect(DTDD.cellText(0)).to.equal('');
      expect(DTDD.cellText(1)).to.equal('');
    });

    it('changes format presets at runtime', async () => {
      const short = DTDD.cellText(0);
      await DTDD.updateColumns({ key: 'joinedAt', type: 'date', editable: true, format: 'long' });
      const long = DTDD.cellText(0);
      // 'long' is verbose-er than 'short'; assert they differ.
      expect(long).to.not.equal(short);
      expect(long.length).to.be.greaterThan(short.length);
    });
  });

  describe('editor', () => {
    it('renders a native <input type="date"> preset to the current value', async () => {
      await DTDD.grid.editCell(0, 'joinedAt');
      await DTDD.waitForUpdate();
      const input = DTDD.dateInput(0)!;
      expect(input).to.exist;
      expect(input.value).to.equal('2025-01-15');
    });

    it('commits the chosen date in the same string shape as the source', async () => {
      await DTDD.grid.editCell(0, 'joinedAt');
      await DTDD.waitForUpdate();

      const input = DTDD.dateInput(0)!;
      input.value = '2025-12-25';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await DTDD.waitForUpdate();

      expect(DTDD.grid.editingCell).to.be.null;
      expect(DTDD.records[0].joinedAt).to.equal('2025-12-25');
    });

    it('cancels on Escape without mutating the value', async () => {
      const before = DTDD.records[0].joinedAt;
      await DTDD.grid.editCell(0, 'joinedAt');
      await DTDD.waitForUpdate();

      const input = DTDD.dateInput(0)!;
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })
      );
      await DTDD.waitForUpdate();

      expect(DTDD.grid.editingCell).to.be.null;
      expect(DTDD.records[0].joinedAt).to.equal(before);
    });

    it('emits cellValueChanging + cellValueChanged for date commits', async () => {
      const seen: string[] = [];
      DTDD.grid.addEventListener('cellValueChanging', (event) => {
        seen.push(`changing:${event.detail.oldValue}->${event.detail.newValue}`);
      });
      DTDD.grid.addEventListener('cellValueChanged', (event) => {
        seen.push(`changed:${event.detail.value}`);
      });

      await DTDD.grid.editCell(0, 'joinedAt');
      await DTDD.waitForUpdate();
      const input = DTDD.dateInput(0)!;
      input.value = '2026-06-01';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await DTDD.waitForUpdate();

      expect(seen).to.deep.equal(['changing:2025-01-15->2026-06-01', 'changed:2026-06-01']);
    });

    it('commits null when the input is cleared', async () => {
      await DTDD.grid.editCell(0, 'joinedAt');
      await DTDD.waitForUpdate();

      const input = DTDD.dateInput(0)!;
      input.value = '';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await DTDD.waitForUpdate();

      expect(DTDD.records[0].joinedAt).to.equal(null);
    });
  });
});

class BooleanFixture<T extends TestData> extends GridTestFixture<T> {
  public editing: GridEditingConfiguration = {
    enabled: true,
    mode: 'cell',
    trigger: 'doubleClick',
  };

  public records!: T[];
  public editable = false;

  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number' },
      { key: 'active', type: 'boolean', editable: this.editable },
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

  public mark(rowIndex: number): HTMLInputElement | null {
    const row = this.rows.get(rowIndex);
    const cell = row.cells.get('active' as never).element;
    return cell.shadowRoot!.querySelector<HTMLInputElement>('input[part~="boolean-mark"]');
  }
}

const BTDD = new BooleanFixture(data);

describe('Column type: boolean (read-only)', () => {
  before(() => {
    BTDD.editable = false;
  });
  beforeEach(async () => await BTDD.setUp());
  afterEach(() => BTDD.tearDown());

  it('renders a checked checkbox for true values', () => {
    // data[2].active === true
    const mark = BTDD.mark(2)!;
    expect(mark).to.exist;
    expect(mark.type).to.equal('checkbox');
    expect(mark.checked).to.be.true;
    expect(mark.getAttribute('part')).to.contain('checked');
    expect(mark.getAttribute('aria-label')).to.equal('true');
  });

  it('renders an unchecked checkbox for false values', () => {
    // data[0].active === false
    const mark = BTDD.mark(0)!;
    expect(mark).to.exist;
    expect(mark.checked).to.be.false;
    expect(mark.getAttribute('part')).to.not.contain('checked');
    expect(mark.getAttribute('aria-label')).to.equal('false');
  });

  it('marks the checkbox as non-interactive (tabindex=-1, aria-readonly)', () => {
    const mark = BTDD.mark(0)!;
    expect(mark.getAttribute('tabindex')).to.equal('-1');
    expect(mark.getAttribute('aria-readonly')).to.equal('true');
  });
});

describe('Column type: boolean (editable)', () => {
  before(() => {
    BTDD.editable = true;
  });
  beforeEach(async () => await BTDD.setUp());
  afterEach(() => BTDD.tearDown());
  after(() => {
    BTDD.editable = false;
  });

  it('marks the checkbox as interactive (tabindex=0, aria-readonly=false)', () => {
    const mark = BTDD.mark(0)!;
    expect(mark.getAttribute('tabindex')).to.equal('0');
    expect(mark.getAttribute('aria-readonly')).to.equal('false');
  });

  it('toggles the underlying value when the checkbox is clicked', async () => {
    // data[0].active === false → click → true
    const mark = BTDD.mark(0)!;
    mark.click();
    await BTDD.waitForUpdate();
    expect(BTDD.records[0].active).to.equal(true);
  });

  it('does not enter edit mode when toggling (no editor reflow)', async () => {
    const mark = BTDD.mark(0)!;
    mark.click();
    await BTDD.waitForUpdate();
    expect(BTDD.grid.editingCell).to.be.null;
  });

  it('emits cellValueChanging + cellValueChanged on toggle', async () => {
    const seen: string[] = [];
    BTDD.grid.addEventListener('cellValueChanging', (event) => {
      seen.push(`changing:${event.detail.oldValue}->${event.detail.newValue}`);
    });
    BTDD.grid.addEventListener('cellValueChanged', (event) => {
      seen.push(`changed:${event.detail.value}`);
    });

    BTDD.mark(0)!.click();
    await BTDD.waitForUpdate();

    expect(seen).to.deep.equal(['changing:false->true', 'changed:true']);
  });
});

interface ImageData extends TestData {
  avatar: string;
}

const imageData: ImageData[] = data.map((row, idx) => ({
  ...row,
  avatar: `https://example.test/avatar-${idx + 1}.png`,
}));

class ImageFixture<T extends ImageData> extends GridTestFixture<T> {
  public records!: T[];

  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number' },
      { key: 'avatar', type: 'image', shape: 'circle', alt: 'User avatar' },
    ] as ColumnConfiguration<T>[];
  }

  public override async setUp() {
    this.records = JSON.parse(JSON.stringify(imageData)) as T[];
    this.data = this.records;
    await super.setUp();
  }

  public img(rowIndex: number): HTMLImageElement | null {
    const row = this.rows.get(rowIndex);
    const cell = row.cells.get('avatar' as never).element;
    return cell.shadowRoot!.querySelector<HTMLImageElement>('img[part~="image"]');
  }
}

const ITDD = new ImageFixture(imageData);

describe('Column type: image', () => {
  beforeEach(async () => await ITDD.setUp());
  afterEach(() => ITDD.tearDown());

  it('renders an <img> with the value as src', () => {
    const img = ITDD.img(0)!;
    expect(img).to.exist;
    expect(img.getAttribute('src')).to.equal('https://example.test/avatar-1.png');
  });

  it('applies the circle shape via the part attribute', () => {
    const img = ITDD.img(0)!;
    expect(img.getAttribute('part')).to.contain('circle');
  });

  it('falls back to square shape (no circle part) when shape is unset', async () => {
    await ITDD.updateColumns({ key: 'avatar', type: 'image', shape: undefined as never });
    const img = ITDD.img(0)!;
    expect(img.getAttribute('part')).to.contain('image');
    expect(img.getAttribute('part')).to.not.contain('circle');
  });

  it('renders nothing for null / empty values', async () => {
    await ITDD.updateProperty('data', [
      { ...ITDD.records[0], avatar: '' as never },
      { ...ITDD.records[1], avatar: null as never },
      ...ITDD.records.slice(2),
    ]);
    expect(ITDD.img(0)).to.be.null;
    expect(ITDD.img(1)).to.be.null;
  });

  it('uses the configured `alt` text', () => {
    expect(ITDD.img(0)!.alt).to.equal('User avatar');
  });
});
