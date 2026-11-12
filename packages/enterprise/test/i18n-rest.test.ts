import { expect, fixture, fixtureCleanup, html, nextFrame, waitUntil } from '@open-wc/testing';
import {
  type ColumnConfiguration,
  EN_LOCALE,
  esLocale,
  type GridLocaleKey,
  type GridLocaleText,
  localize,
} from 'apex-grid';
import * as formulaErrors from '../src/features/formula/errors.js';
import {
  FormulaCellEditor,
  type FormulaEditorContext,
  type FormulaEditorController,
} from '../src/features/formula/index.js';
import {
  ApexGridChart,
  ApexGridEnterprise,
  ApexGridSetFilter,
  enterpriseModules,
  ParseError,
  type ParseErrorCode,
  type ParseErrorParams,
  parseFormula,
} from '../src/index.js';
import { settle } from './settle.js';

// No render animation: a late frame could outlive fixtureCleanup().
(window as unknown as { Apex?: unknown }).Apex = { chart: { animations: { enabled: false } } };

interface Row {
  region: string;
  amount: number | null;
}

const data: Row[] = [
  { region: 'East', amount: 1000.25 },
  { region: 'East', amount: 1000 },
  { region: 'West', amount: 30 },
];

const columns: ColumnConfiguration<Row>[] = [
  { key: 'region', type: 'string', headerText: 'Region' },
  { key: 'amount', type: 'number', headerText: 'Amount' },
];

function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '500px';
  return node;
}

async function mountGrid(localeText?: GridLocaleText, rows: Row[] = data) {
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise
      .data=${rows.map((row) => ({ ...row }))}
      .columns=${columns}
      .localeText=${localeText}
    ></apex-grid-enterprise>`,
    { parentNode: sizedParent() }
  );
  await settle(grid);
  return grid;
}

/** The text of every rendered `[part=<part>]` across the grid's rows. */
function chipTexts(grid: ApexGridEnterprise<Row>, part: string): string[] {
  return grid.rows.flatMap((row) =>
    Array.from(row.renderRoot.querySelectorAll(`[part="${part}"]`), (el) =>
      el.textContent!.replace(/\s+/g, ' ').trim()
    )
  );
}

/** The runtime-locale text the chips use, as the status bar shows numbers. */
const num = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

describe('enterprise i18n: aggregate chips', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  it('labels a group chip with the header text, the function name and a locale number', async () => {
    const grid = await mountGrid();
    grid.groupBy = ['region'];
    grid.aggregations = { amount: ['sum', 'avg'] };
    await settle(grid);
    await waitUntil(() => chipTexts(grid, 'group-aggregate').length > 0, 'no group chips');
    expect(chipTexts(grid, 'group-aggregate')).to.include.members([
      `Amount Sum: ${num(2000.25)}`,
      `Amount Average: ${num(1000.125)}`,
      'Amount Sum: 30',
    ]);
  });

  it('translates the group and total chips with esLocale', async () => {
    const grid = await mountGrid({ ...esLocale });
    grid.columns = [columns[0], { ...columns[1], headerText: 'Importe' }];
    grid.groupBy = ['region'];
    grid.aggregations = { amount: ['sum'] };
    grid.totalRow = { aggregations: { amount: ['sum', 'max'] } };
    await settle(grid);
    await waitUntil(() => chipTexts(grid, 'total-row-value').length > 0, 'no total chips');
    expect(chipTexts(grid, 'group-aggregate')).to.include(`Importe Suma: ${num(2000.25)}`);
    expect(chipTexts(grid, 'total-row-value')).to.deep.equal([
      `Importe Suma: ${num(2030.25)}`,
      `Importe Máximo: ${num(1000.25)}`,
    ]);
  });

  it('falls back to the column key without a header text', async () => {
    const grid = await mountGrid();
    grid.columns = [columns[0], { key: 'amount', type: 'number' }];
    grid.totalRow = { aggregations: { amount: ['count'] } };
    await settle(grid);
    await waitUntil(() => chipTexts(grid, 'total-row-value').length > 0, 'no total chips');
    expect(chipTexts(grid, 'total-row-value')).to.deep.equal(['amount Count: 3']);
  });
});

describe('enterprise i18n: chart title and overlay series', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridChart.register();
  });
  afterEach(() => fixtureCleanup());

  async function emptyDialog(localeText?: GridLocaleText, heading?: string) {
    const grid = await mountGrid(localeText, []);
    const panel = await fixture<ApexGridChart>(
      html`<apex-grid-chart .grid=${grid as never} open></apex-grid-chart>`
    );
    if (heading !== undefined) panel.heading = heading;
    await panel.updateComplete;
    await nextFrame();
    await panel.updateComplete;
    return panel;
  }

  const headingOf = (panel: ApexGridChart) =>
    panel.querySelector('[part="heading"]')?.textContent?.trim();
  const dialogLabel = (panel: ApexGridChart) =>
    panel.querySelector('[aria-label][role="dialog"]')?.getAttribute('aria-label');

  it('keeps "Chart" as the default heading and title in English', async () => {
    const panel = await emptyDialog();
    expect(panel.heading).to.equal('Chart');
    expect(headingOf(panel)).to.equal('Chart');
    expect(dialogLabel(panel)).to.equal('Chart');
  });

  it('shows the localized title for the default and the empty heading', async () => {
    for (const heading of [undefined, '', 'Chart']) {
      const panel = await emptyDialog(esLocale, heading);
      expect(headingOf(panel), String(heading)).to.equal('Gráfico');
      expect(dialogLabel(panel), String(heading)).to.equal('Gráfico');
      fixtureCleanup();
    }
  });

  it('keeps an explicit heading as is', async () => {
    const panel = await emptyDialog(esLocale, 'Ventas');
    expect(headingOf(panel)).to.equal('Ventas');
  });

  async function overlayNames(localeText?: GridLocaleText) {
    const grid = await mountGrid(localeText);
    const panel = await fixture<ApexGridChart>(
      html`<apex-grid-chart mode="inline" source="view" type="line" .grid=${grid as never}></apex-grid-chart>`
    );
    await waitUntil(() => panel.getChart() != null, 'chart never rendered');
    panel.format = { trendline: true, forecast: 2, forecastBand: true };
    await panel.updateComplete;
    await panel.refresh();
    const config = (
      panel.getChart() as unknown as { w: { config: { series: { name: string }[] } } }
    ).w.config;
    return config.series.map((series) => series.name);
  }

  it('names the trend and forecast series in English by default', async () => {
    expect(await overlayNames()).to.include.members(['Trend', 'Forecast', 'Upper', 'Lower']);
  });

  it('names the trend and forecast series with esLocale', async () => {
    const names = await overlayNames(esLocale);
    expect(names).to.include.members(['Tendencia', 'Pronóstico', 'Superior', 'Inferior']);
    expect(names).to.not.include.members(['Trend']);
  });
});

describe('enterprise i18n: formula parse errors', () => {
  const codeOf = (src: string) => {
    try {
      parseFormula(src);
    } catch (error) {
      expect(error).to.be.instanceOf(ParseError);
      const { code, params, message, position } = error as ParseError;
      return { code, params, message, position };
    }
    throw new Error(`${src} parsed`);
  };

  it('sets a code and params at every throw site, message still English', () => {
    expect(codeOf('=')).to.deep.include({ code: 'empty', message: 'empty formula' });
    expect(codeOf('="abc')).to.deep.include({
      code: 'unterminatedString',
      message: 'unterminated string literal',
    });
    expect(codeOf('=1 # 2')).to.deep.include({
      code: 'unexpectedChar',
      params: { char: '#' },
      message: 'unexpected character "#"',
    });
    expect(codeOf('=1 2')).to.deep.include({
      code: 'unexpectedToken',
      params: { token: '2' },
      message: 'unexpected token "2"',
    });
    expect(codeOf('=1+')).to.deep.include({
      code: 'unexpectedEnd',
      message: 'unexpected end of formula',
      position: 3,
    });
    expect(codeOf('=1e999')).to.deep.include({
      code: 'numberOutOfRange',
      message: 'number out of range',
    });
    expect(codeOf('=(1')).to.deep.include({ code: 'expectedCloseParen', message: 'expected ")"' });
    expect(codeOf('=SUM')).to.deep.include({
      code: 'expectedOpenParen',
      params: { name: 'SUM' },
      message: 'expected "(" after "SUM"',
    });
    expect(codeOf('=A1:1')).to.deep.include({
      code: 'expectedRangeEnd',
      message: 'expected a cell reference after ":"',
    });
    expect(codeOf('=A0')).to.deep.include({
      code: 'invalidRow',
      params: { ref: 'A0' },
      message: 'invalid row number in "A0" (rows are 1-based)',
    });
  });

  it('keeps the English messages equal to the formula.parse.* defaults', () => {
    expect(Object.keys(formulaErrors.PARSE_ERROR_MESSAGES ?? {})).to.have.length(11);
    for (const [code, text] of Object.entries(formulaErrors.PARSE_ERROR_MESSAGES)) {
      expect(EN_LOCALE[`formula.parse.${code}` as GridLocaleKey], code).to.equal(text);
    }
  });

  it('still builds a ParseError from a message and position alone', () => {
    const error = new ParseError('custom', 4);
    expect(error.message).to.equal('custom');
    expect(error.position).to.equal(4);
    expect(error.code).to.equal(undefined);
    expect(error.params).to.equal(undefined);
  });

  it('types code and params with names the package entry exports', () => {
    const code: ParseErrorCode = 'unexpectedChar';
    const params: ParseErrorParams = { char: '#' };
    const error = new ParseError('unexpected character "#"', 3, code, params);
    expect(error.code).to.equal('unexpectedChar');
    expect(error.params).to.deep.equal({ char: '#' });
  });
});

describe('enterprise i18n: formula editor errors', () => {
  before(() => FormulaCellEditor.register());
  afterEach(() => fixtureCleanup());

  function controllerFor(localizer?: (key: string) => string): FormulaEditorController {
    return {
      getFormula: () => undefined,
      setFormula: () => {},
      clearFormula: () => {},
      localize: localizer,
    };
  }

  async function errorFor(controller: FormulaEditorController, text: string) {
    const ctx: FormulaEditorContext = {
      value: 0,
      column: { key: 'total' },
      row: { data: { total: 0 } },
      commit: async () => true,
      cancel: () => {},
    };
    const el = await fixture<FormulaCellEditor>(
      html`<apex-grid-formula-editor .ctx=${ctx} .controller=${controller}></apex-grid-formula-editor>`
    );
    await el.updateComplete;
    const input = el.renderRoot.querySelector('input')!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;
    return el.renderRoot.querySelector('[part~="formula-error"]')?.textContent?.trim();
  }

  it('shows the parse error in Spanish under esLocale', async () => {
    const spanish = controllerFor((key) => localize(esLocale, key as GridLocaleKey));
    expect(await errorFor(spanish, '=1+')).to.equal('final inesperado de la fórmula (posición 3)');
    expect(await errorFor(spanish, '=SUM')).to.equal(
      'se esperaba "(" después de "SUM" (posición 4)'
    );
  });

  it('shows the English message under the default locale', async () => {
    const english = controllerFor((key) => localize(undefined, key as GridLocaleKey));
    expect(await errorFor(english, '=1+')).to.equal('unexpected end of formula (position 3)');
  });

  it('falls back to English when the localizer does not know the keys', async () => {
    // An apex-grid release without the formula.parse.* keys answers with the key.
    expect(
      await errorFor(
        controllerFor((key) => key),
        '=1+'
      )
    ).to.equal('unexpected end of formula (position 3)');
    expect(await errorFor(controllerFor(), '=1+')).to.equal(
      'unexpected end of formula (position 3)'
    );
  });
});

describe('enterprise i18n: set filter blanks', () => {
  before(() => {
    ApexGridEnterprise.register();
    ApexGridSetFilter.register();
  });
  afterEach(() => fixtureCleanup());

  const rows: Row[] = [
    { region: 'Norte', amount: 1 },
    { region: '', amount: 2 },
    { region: 'Este', amount: 3 },
    { region: 'Zeta', amount: 4 },
  ];

  async function mountFilter(localeText?: GridLocaleText) {
    const grid = await mountGrid(localeText, rows);
    const filter = await fixture<ApexGridSetFilter>(
      html`<apex-grid-set-filter .grid=${grid as never} .column=${'region'}></apex-grid-set-filter>`
    );
    await filter.updateComplete;
    return filter;
  }

  async function search(filter: ApexGridSetFilter, text: string) {
    const input = filter.shadowRoot!.querySelector<HTMLInputElement>('[part="search"]')!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await filter.updateComplete;
    return Array.from(
      filter.shadowRoot!.querySelectorAll<HTMLElement>('[part~="option"][data-token]'),
      (option) => option.textContent!.trim()
    );
  }

  it('finds the blanks entry by its Spanish label', async () => {
    const filter = await mountFilter(esLocale);
    expect(await search(filter, 'vac')).to.deep.equal(['(Vacíos)']);
    expect(await search(filter, 'blank')).to.deep.equal([]);
  });

  it('sorts the blanks entry by the label it shows', async () => {
    const filter = await mountFilter({ 'setFilter.blanks': 'Sin valor' });
    expect(filter.distinctValues.map((value) => value.label)).to.deep.equal([
      'Este',
      'Norte',
      'Sin valor',
      'Zeta',
    ]);
  });

  it('keeps "(Blanks)" in English', async () => {
    const filter = await mountFilter();
    expect(await search(filter, 'blank')).to.deep.equal(['(Blanks)']);
    expect(filter.distinctValues[0].label).to.equal('(Blanks)');
  });
});
