import { expect } from '@open-wc/testing';
import { EN_LOCALE, type GridLocaleKey, type GridLocaleText } from '../src/i18n/en.js';
import { esLocale } from '../src/i18n/es.js';

/**
 * Keys added for the enterprise strings that used to be English whatever
 * `localeText` said: the chart dialog's default title, the trend and forecast
 * overlay series, and the formula editor's parse errors. Each English default
 * is the exact text shown before.
 */
const ENGLISH: Partial<Record<GridLocaleKey, string>> = {
  'chart.title': 'Chart',
  'chart.series.trend': 'Trend',
  'chart.series.forecast': 'Forecast',
  'chart.series.forecastUpper': 'Upper',
  'chart.series.forecastLower': 'Lower',
  'formula.parse.empty': 'empty formula',
  'formula.parse.unterminatedString': 'unterminated string literal',
  'formula.parse.unexpectedChar': 'unexpected character "{char}"',
  'formula.parse.unexpectedToken': 'unexpected token "{token}"',
  'formula.parse.unexpectedEnd': 'unexpected end of formula',
  'formula.parse.numberOutOfRange': 'number out of range',
  'formula.parse.expectedCloseParen': 'expected ")"',
  'formula.parse.expectedOpenParen': 'expected "(" after "{name}"',
  'formula.parse.expectedRangeEnd': 'expected a cell reference after ":"',
  'formula.parse.invalidRef': 'invalid cell reference "{ref}"',
  'formula.parse.invalidRow': 'invalid row number in "{ref}" (rows are 1-based)',
  'formula.parse.position': '{message} (position {position})',
};

/** Keys nothing renders, kept so typed localeText objects still compile. */
const KEPT_UNUSED: GridLocaleKey[] = [
  'filter.filter',
  'chart.placeholder',
  'ai.answer',
  'formula.error.ref',
  'formula.error.name',
  'formula.error.div0',
  'formula.error.value',
  'formula.error.cycle',
];

const tokens = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe('i18n: chart, series and formula parse keys', () => {
  it('keeps the exact English text as each default', () => {
    for (const [key, text] of Object.entries(ENGLISH)) {
      expect(EN_LOCALE[key as GridLocaleKey], key).to.equal(text);
    }
  });

  it('translates every one of them in esLocale, placeholders intact', () => {
    for (const key of Object.keys(ENGLISH) as GridLocaleKey[]) {
      const spanish = esLocale[key];
      expect(spanish, key).to.be.a('string').and.not.equal(EN_LOCALE[key]);
      expect(tokens(spanish!), key).to.deep.equal(tokens(EN_LOCALE[key]));
    }
  });

  it('keeps the unused keys in both dictionaries', () => {
    for (const key of KEPT_UNUSED) {
      expect(EN_LOCALE[key], key).to.be.a('string');
      expect(esLocale[key], key).to.be.a('string');
    }
  });

  it('still takes any partial map of strings as localeText', () => {
    const partial: Partial<Record<GridLocaleKey, string>> = { 'filter.reset': 'Borrar' };
    const text: GridLocaleText = partial;
    const back: Partial<Record<GridLocaleKey, string>> = text;
    expect(back['filter.reset']).to.equal('Borrar');
  });
});

describe('i18n: esLocale register', () => {
  // Second person informal imperatives (tu) the bundle used beside the
  // formal (usted) forms of the rest of the dictionary.
  const INFORMAL =
    /\b(Deja|Haz|haz|Selecciona|agrupa|dinamiza|Intercambia|Pide|Prueba|Usa|Pulsa|Arrastra|Busca|Escribe)\b/;

  it('addresses the user as usted throughout', () => {
    const informal = Object.entries(esLocale).filter(([, text]) => INFORMAL.test(text!));
    expect(informal).to.deep.equal([]);
  });

  it('calls the grid "tabla", never "cuadrícula"', () => {
    // 'chart.gridlines' names a chart's gridlines, not the grid.
    const mixed = Object.entries(esLocale).filter(
      ([key, text]) => key !== 'chart.gridlines' && /cuadr[ií]cula/i.test(text!)
    );
    expect(mixed).to.deep.equal([]);
  });

  it('uses the usted form for the chart and AI hints', () => {
    expect(esLocale['chart.emptyRange']).to.equal('Seleccione un rango de celdas, o');
    expect(esLocale['chart.emptyView']).to.equal('agrupe o dinamice la tabla');
    expect(esLocale['chart.renameHint']).to.equal('Haga doble clic para cambiar el nombre');
    expect(esLocale['ai.abstainedHint']).to.equal(
      'Pruebe a ordenar, filtrar o agrupar, o haga una pregunta sobre los datos.'
    );
  });
});
