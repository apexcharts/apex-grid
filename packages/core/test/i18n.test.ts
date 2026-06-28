import { expect, html } from '@open-wc/testing';
import { EN_LOCALE, type GridLocaleKey } from '../src/i18n/en.js';
import { esLocale } from '../src/i18n/es.js';
import { interpolate, localize } from '../src/i18n/localize.js';
import type { PaginationConfiguration } from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

describe('i18n — localize()', () => {
  it('returns the built-in English default when no overrides are given', () => {
    expect(localize(undefined, 'pagination.rowsPerPage')).to.equal('Rows per page');
    expect(localize({}, 'filter.operator.contains')).to.equal('Contains');
  });

  it('prefers a consumer override over the English default', () => {
    const overrides = { 'pagination.rowsPerPage': 'Filas por página' };
    expect(localize(overrides, 'pagination.rowsPerPage')).to.equal('Filas por página');
    // Keys left out of the override still fall back to English.
    expect(localize(overrides, 'filter.close')).to.equal('Close');
  });

  it('interpolates {placeholder} tokens from params', () => {
    expect(localize(undefined, 'pagination.summary', { start: 1, end: 25, total: 100 })).to.equal(
      '1-25 of 100'
    );
    expect(
      localize({ 'pagination.summary': '{start}–{end} de {total}' }, 'pagination.summary', {
        start: 1,
        end: 25,
        total: 100,
      })
    ).to.equal('1–25 de 100');
  });

  it('uses the explicit fallback for keys outside the built-in set', () => {
    // Mimics a custom filter operand whose key is not part of EN_LOCALE.
    const key = 'filter.operator.between' as GridLocaleKey;
    expect(localize(undefined, key, undefined, 'Between')).to.equal('Between');
    // An override still wins over the fallback.
    expect(localize({ [key]: 'Entre' }, key, undefined, 'Between')).to.equal('Entre');
  });

  it('returns the key itself as a last resort', () => {
    const key = 'totally.unknown.key' as GridLocaleKey;
    expect(localize(undefined, key)).to.equal('totally.unknown.key');
  });
});

describe('i18n — interpolate()', () => {
  it('replaces every matching token', () => {
    expect(interpolate('{a} and {b}', { a: 'x', b: 'y' })).to.equal('x and y');
  });

  it('leaves tokens with no matching param untouched', () => {
    expect(interpolate('{a} and {b}', { a: 'x' })).to.equal('x and {b}');
  });

  it('returns the template unchanged when no params are given', () => {
    expect(interpolate('no tokens here')).to.equal('no tokens here');
  });
});

describe('i18n — Spanish dictionary', () => {
  it('translates every key in the English source of truth', () => {
    const missing = (Object.keys(EN_LOCALE) as GridLocaleKey[]).filter((key) => !(key in esLocale));
    expect(missing, `untranslated keys: ${missing.join(', ')}`).to.have.lengthOf(0);
  });

  it('introduces no keys absent from the English source of truth', () => {
    const extra = Object.keys(esLocale).filter((key) => !(key in EN_LOCALE));
    expect(extra, `unknown keys: ${extra.join(', ')}`).to.have.lengthOf(0);
  });
});

class LocaleFixture<T extends TestData> extends GridTestFixture<T> {
  public initialPagination: PaginationConfiguration = {
    enabled: true,
    pageSize: 3,
    pageSizeOptions: [3, 5, 10],
  };

  public override setupTemplate() {
    return html`<apex-grid
      .data=${this.data}
      .columns=${this.columnConfig}
      .pagination=${this.initialPagination}
    ></apex-grid>`;
  }

  public paginatorPart(part: string) {
    const paginator = this.grid.renderRoot.querySelector('apex-grid-paginator');
    return paginator!.shadowRoot!.querySelector(`[part~="${part}"]`) as HTMLElement;
  }

  public paginatorSelect() {
    const paginator = this.grid.renderRoot.querySelector('apex-grid-paginator');
    return paginator!.shadowRoot!.querySelector('select') as HTMLSelectElement;
  }
}

const TDD = new LocaleFixture(data);

describe('i18n — grid integration', () => {
  beforeEach(async () => await TDD.setUp());
  afterEach(() => TDD.tearDown());

  it('renders built-in English text by default', () => {
    expect(TDD.paginatorPart('paginator-info').textContent?.trim()).to.equal('1-3 of 8');
    expect(TDD.paginatorSelect().getAttribute('aria-label')).to.equal('Rows per page');
  });

  it('renders the whole UI in Spanish when localeText = esLocale', async () => {
    await TDD.updateProperty('localeText', esLocale);
    expect(TDD.paginatorPart('paginator-info').textContent?.trim()).to.equal('1-3 de 8');
    expect(TDD.paginatorSelect().getAttribute('aria-label')).to.equal('Filas por página');
    expect(TDD.paginatorPart('paginator').getAttribute('aria-label')).to.equal(
      'Paginación de la tabla'
    );
  });

  it('honors a partial override and falls back to English elsewhere', async () => {
    await TDD.updateProperty('localeText', { 'pagination.rowsPerPage': 'Per page' });
    expect(TDD.paginatorSelect().getAttribute('aria-label')).to.equal('Per page');
    // Untranslated key still English.
    expect(TDD.paginatorPart('paginator').getAttribute('aria-label')).to.equal('Grid pagination');
  });

  it('exposes localize() on the grid honoring overrides', async () => {
    expect(TDD.grid.localize('filter.operator.contains')).to.equal('Contains');
    await TDD.updateProperty('localeText', esLocale);
    expect(TDD.grid.localize('filter.operator.contains')).to.equal('Contiene');
    expect(TDD.grid.localize('pagination.summary', { start: 4, end: 6, total: 8 })).to.equal(
      '4-6 de 8'
    );
  });
});
