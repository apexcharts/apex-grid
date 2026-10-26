import { aTimeout, expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import { sendKeys } from '@web/test-runner-commands';
import type { ColumnConfiguration } from 'apex-grid';
import { ApexGridEnterprise, enterpriseModules } from '../src/index.js';

/**
 * `showHeader = false` on the enterprise grid (GitHub #35): the header rows
 * (column groups included) take no room and no focus with every enterprise
 * module registered, and come back unchanged.
 */

interface Row {
  region: string;
  product: string;
  amount: number;
}

const DATA: Row[] = [
  { region: 'EMEA', product: 'A', amount: 10 },
  { region: 'AMER', product: 'B', amount: 20 },
  { region: 'APAC', product: 'C', amount: 30 },
  { region: 'EMEA', product: 'D', amount: 40 },
];

const COLUMNS: ColumnConfiguration<Row>[] = [
  { key: 'region', group: 'where', sort: true, filter: true, resizable: true },
  { key: 'product', group: 'what', sort: true },
  { key: 'amount', type: 'number', group: 'what', sort: true },
];

const frames = async (n = 4) => {
  for (let i = 0; i < n; i++) await nextFrame();
};

function deepActive(): Element | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

function within(node: Node | null, container: Element): boolean {
  let current: Node | null = node;
  while (current) {
    if (current === container) return true;
    current = current.parentNode ?? (current instanceof ShadowRoot ? current.host : null);
  }
  return false;
}

describe('ApexGridEnterprise showHeader', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  it('hides the group and column header rows and keeps them for assistive technology', async () => {
    const wrap = await fixture<HTMLDivElement>(html`<div>
      <button id="before">before</button>
      <apex-grid-enterprise
        style="height: 160px; min-height: 0; width: 420px"
        .columnGroups=${[{ id: 'where', headerText: 'Where' }, { id: 'what', headerText: 'What' }]}
        .data=${DATA.map((row) => ({ ...row }))}
        .columns=${COLUMNS.map((column) => ({ ...column }))}
      ></apex-grid-enterprise>
    </div>`);
    const grid = wrap.querySelector('apex-grid-enterprise') as ApexGridEnterprise<Row>;
    await grid.updateComplete;
    await aTimeout(50);
    await frames();
    const root = grid.renderRoot as ShadowRoot;
    const group = root.querySelector<HTMLElement>('apex-grid-group-header-row')!;
    const header = root.querySelector<HTMLElement>('apex-grid-header-row')!;
    const firstRow = () => root.querySelector<HTMLElement>('apex-virtualizer apex-grid-row')!;
    const top = () => grid.getBoundingClientRect().top + grid.clientTop;
    const withHeader = firstRow().getBoundingClientRect().top - top();
    expect(withHeader).to.be.greaterThan(40);

    grid.showHeader = false;
    await grid.updateComplete;
    await frames();

    expect(firstRow().getBoundingClientRect().top - top()).to.be.at.most(0.5);
    for (const row of [group, header]) {
      expect(row.isConnected).to.be.true;
      expect(row.getAttribute('role')).to.equal('row');
      expect(getComputedStyle(row).clipPath).to.not.equal('none');
    }
    expect(root.querySelector('apex-filter-row')).to.be.null;

    wrap.querySelector<HTMLButtonElement>('#before')!.focus();
    await sendKeys({ press: 'Tab' });
    await frames();
    expect(within(deepActive(), grid), 'Tab moved into the grid').to.be.true;
    expect(within(deepActive(), header), 'Tab skipped the header').to.be.false;

    grid.showHeader = true;
    await grid.updateComplete;
    await frames();
    expect(getComputedStyle(header).clipPath).to.equal('none');
    expect(firstRow().getBoundingClientRect().top - top()).to.be.closeTo(withHeader, 0.5);
  });

  it('closes a column menu opened from the header when the header hides', async () => {
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      style="height: 160px; min-height: 0; width: 420px"
      .data=${DATA.map((row) => ({ ...row }))}
      .columns=${COLUMNS.map((column) => ({ ...column }))}
    ></apex-grid-enterprise>`);
    await grid.updateComplete;
    await aTimeout(50);
    await frames();
    const menu = () => document.querySelector('.apex-grid-context-menu');
    const header = (grid.renderRoot as ShadowRoot).querySelector<HTMLElement>(
      'apex-grid-header-row'
    )!;
    const cell = header.shadowRoot!.querySelector<HTMLElement>('apex-grid-header')!;
    cell.shadowRoot!.querySelector<HTMLElement>('[part~="menu-btn"]')!.click();
    await frames();
    expect(menu(), 'menu opened').to.exist;

    grid.showHeader = false;
    await grid.updateComplete;
    await frames();
    expect(menu(), 'menu closed with the header').to.be.null;

    // A menu opened on a body cell has nothing to do with the header.
    grid.showHeader = true;
    await grid.updateComplete;
    await frames();
    const body = (grid.renderRoot as ShadowRoot).querySelector('apex-virtualizer apex-grid-row')!;
    const bodyCell = (body.shadowRoot ?? body).querySelector<HTMLElement>('apex-grid-cell')!;
    const box = bodyCell.getBoundingClientRect();
    bodyCell.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        composed: true,
        cancelable: true,
        clientX: box.left + 5,
        clientY: box.top + 5,
      })
    );
    await frames();
    expect(menu(), 'cell menu opened').to.exist;
    grid.showHeader = false;
    await grid.updateComplete;
    await frames();
    expect(menu(), 'cell menu stays').to.exist;
    for (const m of document.querySelectorAll('.apex-grid-context-menu')) m.remove();
  });
});
