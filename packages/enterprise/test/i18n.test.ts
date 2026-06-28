import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import { type ColumnConfiguration, esLocale } from 'apex-grid';
import { ApexGridEnterprise, ApexGridSetFilter, ApexGridStatusBar } from '../src/index.js';

interface Row {
  id: number;
  name: string;
  department: string;
}

const data: Row[] = [
  { id: 1, name: 'A', department: 'Engineering' },
  { id: 2, name: 'B', department: 'Sales' },
  { id: 3, name: 'C', department: 'Engineering' },
];
const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number', headerText: 'ID' },
  { key: 'name', type: 'string', headerText: 'Name' },
  { key: 'department', type: 'string', headerText: 'Department' },
];

function text(root: ParentNode, selector: string): string {
  return (root.querySelector(selector)?.textContent ?? '').trim();
}

describe('enterprise i18n', () => {
  before(() => {
    ApexGridEnterprise.register();
    ApexGridSetFilter.register();
    ApexGridStatusBar.register();
  });
  afterEach(() => fixtureCleanup());

  async function mountGrid(localeText?: typeof esLocale) {
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise
        .data=${data.map((row) => ({ ...row }))}
        .columns=${columns}
        .localeText=${localeText}
      ></apex-grid-enterprise>`
    );
    await grid.updateComplete;
    return grid;
  }

  it('inherits localize() on the enterprise grid', async () => {
    const english = await mountGrid();
    expect(english.localize('contextMenu.copy')).to.equal('Copy');
    expect(english.localize('statusBar.sum')).to.equal('Sum');

    const spanish = await mountGrid(esLocale);
    expect(spanish.localize('contextMenu.copy')).to.equal('Copiar');
    expect(spanish.localize('toolbar.exportXlsx')).to.equal('Exportar XLSX');
  });

  it('renders the set filter in Spanish via grid.localeText', async () => {
    const grid = await mountGrid(esLocale);
    const filter = await fixture<ApexGridSetFilter>(
      html`<apex-grid-set-filter
        .grid=${grid as unknown as ApexGridSetFilter['grid']}
        .column=${'department'}
      ></apex-grid-set-filter>`
    );
    await filter.updateComplete;
    await nextFrame();

    const root = filter.shadowRoot!;
    expect(root.querySelector('[part="search"]')!.getAttribute('placeholder')).to.equal(
      'Buscar valores…'
    );
    expect(text(root, '[part~="select-all"] [part="label"]')).to.equal('(Seleccionar todo)');
    expect(text(root, '[part="clear"]')).to.equal('Borrar filtro');
  });

  it('renders the status bar hint in Spanish via grid.localeText', async () => {
    const grid = await mountGrid(esLocale);
    const bar = await fixture<ApexGridStatusBar>(
      html`<apex-grid-status-bar
        .grid=${grid as unknown as ApexGridStatusBar['grid']}
      ></apex-grid-status-bar>`
    );
    await bar.updateComplete;
    expect(text(bar.shadowRoot!, '[part="hint"]')).to.equal('Seleccione un rango de celdas');
  });

  it('keeps English when no localeText is set', async () => {
    const grid = await mountGrid();
    const filter = await fixture<ApexGridSetFilter>(
      html`<apex-grid-set-filter
        .grid=${grid as unknown as ApexGridSetFilter['grid']}
        .column=${'department'}
      ></apex-grid-set-filter>`
    );
    await filter.updateComplete;
    await nextFrame();
    expect(text(filter.shadowRoot!, '[part~="select-all"] [part="label"]')).to.equal(
      '(Select all)'
    );
  });
});
