import { expect, html } from '@open-wc/testing';
import type ApexFilterRow from '../src/components/filter-row.js';
import { EN_LOCALE, type GridLocaleKey, type GridLocaleText } from '../src/i18n/en.js';
import { esLocale } from '../src/i18n/es.js';
import type {
  ColumnConfiguration,
  GridEditingConfiguration,
  ValidatorContext,
} from '../src/internal/types.js';
import { max, min, pattern, required } from '../src/internal/validators.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

/**
 * The strings that used to be hard-coded English and now resolve through
 * `localeText`. Each English default is the exact text the grid rendered
 * before, so English output does not change.
 */
const ENGLISH: Partial<Record<GridLocaleKey, string>> = {
  'filter.and': 'and',
  'filter.or': 'or',
  'toolbar.exportCsv': 'Export CSV',
  'cell.rating': '{value} of {max}',
  'cell.true': 'true',
  'cell.false': 'false',
  'validation.required': 'This field is required',
  'validation.min': 'Must be at least {limit}',
  'validation.max': 'Must be at most {limit}',
  'validation.pattern': 'Invalid format',
  'filterBuilder.true': 'true',
  'filterBuilder.false': 'false',
  'contextMenu.groupBy': 'Group by this column',
  'contextMenu.ungroupAll': 'Un-group all',
  'contextMenu.expandGroups': 'Expand all groups',
  'contextMenu.collapseGroups': 'Collapse all groups',
};

describe('i18n: keys for strings that bypassed localeText', () => {
  it('keeps the exact English text as each default', () => {
    for (const [key, text] of Object.entries(ENGLISH)) {
      expect(EN_LOCALE[key as GridLocaleKey], key).to.equal(text);
    }
  });

  it('translates every one of them in esLocale, placeholders intact', () => {
    for (const key of Object.keys(ENGLISH) as GridLocaleKey[]) {
      const spanish = esLocale[key];
      expect(spanish, key).to.be.a('string').and.not.equal(EN_LOCALE[key]);
      const tokens = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
      expect(tokens(spanish!), key).to.deep.equal(tokens(EN_LOCALE[key]));
    }
  });
});

describe('i18n: built-in validator messages', () => {
  const bare = {} as ValidatorContext<TestData>;
  const through = (overrides: GridLocaleText) =>
    ({
      localize: (key, params) =>
        (overrides[key] ?? EN_LOCALE[key]).replace(/\{(\w+)\}/g, (_, name: string) =>
          String(params?.[name])
        ),
    }) as ValidatorContext<TestData>;

  it('reads the English defaults without a grid', () => {
    expect(required<TestData>()('', bare)).to.equal('This field is required');
    expect(min<TestData>(10)(5, bare)).to.equal('Must be at least 10');
    expect(max<TestData>(2.5)(3, bare)).to.equal('Must be at most 2.5');
    expect(pattern<TestData>(/^x$/)('y', bare)).to.equal('Invalid format');
    // Called with no context at all, as plain functions.
    const call = (validate: (value: unknown, context?: unknown) => string | null, value: unknown) =>
      validate(value);
    expect(call(required<TestData>() as never, null)).to.equal('This field is required');
    expect(call(min<TestData>(1) as never, 0)).to.equal('Must be at least 1');
  });

  it('resolves the validation.* keys through the context', () => {
    const es = through(esLocale);
    expect(required<TestData>()('', es)).to.equal('Este campo es obligatorio');
    expect(min<TestData>(10)(5, es)).to.equal('Debe ser como mínimo 10');
    expect(max<TestData>(5)(6, es)).to.equal('Debe ser como máximo 5');
    expect(pattern<TestData>(/^x$/)('y', es)).to.equal('Formato no válido');
  });

  it('prefers an explicit message over the locale key', () => {
    const es = through(esLocale);
    expect(required<TestData>('Name is required')('', es)).to.equal('Name is required');
    expect(min<TestData>(10, 'Too small')(5, es)).to.equal('Too small');
    expect(max<TestData>(5, 'Too big')(6, es)).to.equal('Too big');
    expect(pattern<TestData>(/^x$/, 'Not x')('y', es)).to.equal('Not x');
    // An empty message still means "pass", as before.
    expect(required<TestData>('')('', es)).to.equal('');
  });
});

class LocaleGridFixture extends GridTestFixture<TestData> {
  public localeText?: GridLocaleText;
  public editing: GridEditingConfiguration = { enabled: true, mode: 'cell' };

  public override updateConfig() {
    this.columnConfig = [
      {
        key: 'id',
        type: 'rating',
        max: 5,
        editable: true,
        filter: true,
        validators: [required(), min(3), max(6)],
      },
      { key: 'name', filter: true, editable: true, validators: [pattern(/^[A-Z]$/)] },
      { key: 'active', type: 'boolean' },
      { key: 'importance' },
    ] as ColumnConfiguration<TestData>[];
  }

  public override async setUp() {
    this.data = JSON.parse(JSON.stringify(data)) as TestData[];
    await super.setUp();
  }

  public override setupTemplate() {
    return html`<apex-grid
      .data=${this.data}
      .columns=${this.columnConfig}
      .editing=${this.editing}
      .localeText=${this.localeText}
    ></apex-grid>`;
  }

  public cell(rowIndex: number, key: keyof TestData) {
    return this.rows.get(rowIndex).cells.get(key as never).element;
  }

  public ratingLabel(rowIndex: number) {
    return this.cell(rowIndex, 'id')
      .shadowRoot!.querySelector('[part~="rating"]')!
      .getAttribute('aria-label');
  }

  public booleanLabel(rowIndex: number) {
    return this.cell(rowIndex, 'active')
      .shadowRoot!.querySelector('input[part~="boolean-mark"]')!
      .getAttribute('aria-label');
  }

  public async starLabels(rowIndex: number) {
    await this.grid.editCell(rowIndex, 'id');
    await this.waitForUpdate();
    const editor = this.cell(rowIndex, 'id').shadowRoot!.querySelector('[part="rating-editor"]')!;
    return Array.from(editor.querySelectorAll('button'), (b) => b.getAttribute('aria-label'));
  }

  /** The chip texts and criteria toggles of the open filter panel, in order. */
  public async chips() {
    this.grid.filter([
      { key: 'name', condition: 'contains', searchTerm: 'a' },
      { key: 'name', condition: 'notEmpty', criteria: 'or' },
      { key: 'name', condition: 'empty', criteria: 'and' },
    ] as never);
    await this.waitForUpdate();
    this.filterRow.open('name');
    await this.waitForUpdate();
    const panel = this.filterRow.element as ApexFilterRow<TestData>;
    const root = panel.shadowRoot!;
    return {
      chips: Array.from(root.querySelectorAll('[part~="chip-body"] span'), (s) =>
        s.textContent!.trim()
      ),
      criteria: Array.from(root.querySelectorAll('button[part~="criteria"]'), (b) =>
        b.textContent!.trim()
      ),
    };
  }

  /** Commits `value` into the `key` cell of row 0 and returns the reported errors. */
  public async commitErrors(key: keyof TestData, value: unknown) {
    const errors: string[][] = [];
    this.grid.addEventListener('cellValidationFailed', (event) => {
      errors.push([...event.detail.errors]);
    });
    this.grid.applyEdits([{ rowIndex: 0, column: key, value } as never]);
    await this.waitForUpdate();
    return errors.flat();
  }
}

describe('i18n: grid strings that bypassed localeText', () => {
  const TDD = new LocaleGridFixture(data);
  afterEach(() => TDD.tearDown());

  describe('English (no localeText)', () => {
    beforeEach(async () => {
      TDD.localeText = undefined;
      await TDD.setUp();
    });

    it('labels the CSV export item "Export CSV"', () => {
      expect(TDD.grid.exportFormats.map((f) => f.label)).to.deep.equal(['Export CSV']);
    });

    it('reads a rating as "{value} of {max}" in display and editor', async () => {
      expect(TDD.ratingLabel(2)).to.equal('3 of 5');
      expect(await TDD.starLabels(0)).to.deep.equal([
        '1 of 5',
        '2 of 5',
        '3 of 5',
        '4 of 5',
        '5 of 5',
      ]);
    });

    it('names a boolean mark "true" / "false"', () => {
      expect(TDD.booleanLabel(2)).to.equal('true');
      expect(TDD.booleanLabel(0)).to.equal('false');
    });

    it('shows "and" / "or" toggles and an operator label on a unary chip', async () => {
      const { chips, criteria } = await TDD.chips();
      expect(criteria).to.deep.equal(['or', 'and']);
      // A unary chip used to show the operand id ('notEmpty').
      expect(chips).to.deep.equal(['a', 'Not empty', 'Empty']);
    });

    it('reports the English validator messages', async () => {
      expect(await TDD.commitErrors('id', 2)).to.deep.equal(['Must be at least 3']);
      expect(await TDD.commitErrors('id', 9)).to.deep.equal(['Must be at most 6']);
      expect(await TDD.commitErrors('name', 'abc')).to.deep.equal(['Invalid format']);
      expect(await TDD.commitErrors('id', '')).to.deep.equal(['This field is required']);
    });
  });

  describe('Spanish (esLocale)', () => {
    beforeEach(async () => {
      TDD.localeText = esLocale;
      await TDD.setUp();
    });

    it('translates every string', async () => {
      expect(TDD.grid.exportFormats.map((f) => f.label)).to.deep.equal(['Exportar CSV']);
      expect(TDD.ratingLabel(2)).to.equal('3 de 5');
      expect(TDD.booleanLabel(2)).to.equal('verdadero');
      expect(TDD.booleanLabel(0)).to.equal('falso');
      const { chips, criteria } = await TDD.chips();
      expect(criteria).to.deep.equal(['o', 'y']);
      expect(chips).to.deep.equal(['a', 'No vacío', 'Vacío']);
      expect((await TDD.starLabels(0))[0]).to.equal('1 de 5');
    });

    it('translates the default validator messages', async () => {
      expect(await TDD.commitErrors('id', 2)).to.deep.equal(['Debe ser como mínimo 3']);
      expect(await TDD.commitErrors('name', 'abc')).to.deep.equal(['Formato no válido']);
    });
  });

  describe('custom localeText', () => {
    beforeEach(async () => {
      TDD.localeText = {
        'toolbar.exportCsv': 'CSV',
        'cell.rating': '★{value}/{max}',
        'cell.true': 'yes',
        'filter.and': 'AND',
        'filter.or': 'OR',
        'filter.operator.notEmpty': 'Has a value',
        'validation.max': 'Up to {limit}',
      };
      await TDD.setUp();
    });

    it('applies each override', async () => {
      expect(TDD.grid.exportFormats[0].label).to.equal('CSV');
      expect(TDD.ratingLabel(2)).to.equal('★3/5');
      expect(TDD.booleanLabel(2)).to.equal('yes');
      // Keys left out still fall back to English.
      expect(TDD.booleanLabel(0)).to.equal('false');
      const { chips, criteria } = await TDD.chips();
      expect(criteria).to.deep.equal(['OR', 'AND']);
      expect(chips).to.deep.equal(['a', 'Has a value', 'Empty']);
      expect(await TDD.commitErrors('id', 9)).to.deep.equal(['Up to 6']);
      expect(await TDD.commitErrors('id', 2)).to.deep.equal(['Must be at least 3']);
    });

    it('follows a localeText change at runtime for the export item', async () => {
      await TDD.updateProperty('localeText', esLocale);
      expect(TDD.grid.exportFormats[0].label).to.equal('Exportar CSV');
    });
  });
});
