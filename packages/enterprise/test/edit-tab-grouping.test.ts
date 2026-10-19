import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import { sendKeys } from '@web/test-runner-commands';
import type { ColumnConfiguration } from 'apex-grid';
import { ApexGridEnterprise, enterpriseModules } from '../src/index.js';

// Tab while editing in a grouped grid: when the commit regroups the rows (the
// grouped-by value changed), focus moves on from the edited record's new row
// instead of the row index it had before the commit.

interface Row {
  region: string;
  product: string;
  amount: number;
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'product', editable: true },
  { key: 'amount', type: 'number', editable: true },
  { key: 'region', editable: true },
];

type Grid = ApexGridEnterprise<Row> & {
  stateController: { active: { row: number; column: string } };
};

interface CellLike extends HTMLElement {
  column: { key: string };
  row: { index: number };
}

interface RowLike extends HTMLElement {
  index: number;
  cells: CellLike[];
}

function renderedRows(grid: Grid): RowLike[] {
  return Array.from(grid.shadowRoot!.querySelector('apex-virtualizer')!.children).filter(
    (el) => el.localName === 'apex-grid-row'
  ) as RowLike[];
}

function cellOf(grid: Grid, rowIndex: number, key: string): CellLike | undefined {
  return renderedRows(grid)
    .find((row) => row.index === rowIndex)
    ?.cells.find((cell) => cell.column.key === key);
}

function deepActive(): Element | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

const settle = async (grid: Grid, ms = 100) => {
  await grid.updateComplete;
  await nextFrame();
  await new Promise((resolve) => setTimeout(resolve, ms));
};

async function mount(): Promise<Grid> {
  const data: Row[] = [
    { region: 'EMEA', product: 'A', amount: 10 },
    { region: 'EMEA', product: 'B', amount: 20 },
    { region: 'AMER', product: 'A', amount: 30 },
    { region: 'AMER', product: 'C', amount: 40 },
  ];
  const wrapper = await fixture(html`<div style="height: 500px">
    <apex-grid-enterprise
      .data=${data}
      .columns=${columns}
      .groupBy=${['region']}
      .editing=${{ enabled: true }}
    ></apex-grid-enterprise>
  </div>`);
  const grid = wrapper.querySelector('apex-grid-enterprise') as Grid;
  await settle(grid, 150);
  return grid;
}

async function tabAfterRegroup(grid: Grid) {
  // pageItems: [EMEA, A, B, AMER, ...]; edit B's region.
  const edited = grid.pageItems[2] as Row;
  await grid.editCell(2, 'region');
  await settle(grid);
  cellOf(grid, 2, 'region')!.shadowRoot!.querySelector('input')!.focus();
  await sendKeys({ type: 'Z' });
  await sendKeys({ press: 'Tab' });
  await settle(grid, 200);
  return edited;
}

describe('Tab while editing a grouped grid', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  it('moves on from the edited record after the commit regroups the rows', async () => {
    const grid = await mount();
    const edited = await tabAfterRegroup(grid);
    expect(edited.region).to.equal('Z');
    const items = grid.pageItems as Row[];
    const from = items.indexOf(edited);
    expect(from).to.be.greaterThan(2);
    // The next cell after the edited record's last column: the first leaf of
    // the following group, past its header.
    const next = items.findIndex((row, index) => index > from && row.product !== undefined);
    expect(grid.stateController.active).to.deep.equal({ row: next, column: 'product' });
    expect(deepActive()).to.equal(cellOf(grid, next, 'product'));
  });

  it('stays on the edited record when no row below renders cells', async () => {
    const grid = await mount();
    const header = renderedRows(grid)[3];
    header.shadowRoot!.querySelector<HTMLElement>('button, [role="button"]')!.click();
    await settle(grid, 150);
    const edited = await tabAfterRegroup(grid);
    const from = (grid.pageItems as Row[]).indexOf(edited);
    expect(grid.stateController.active).to.deep.equal({ row: from, column: 'region' });
    expect(deepActive()).to.equal(cellOf(grid, from, 'region'));
  });

  it('follows the edited record when the commit regroups it past the rendered rows', async () => {
    const data: Row[] = Array.from({ length: 900 }, (_, i) => ({
      region: ['A1', 'M2', 'Z3'][Math.floor(i / 300)],
      product: `P${i}`,
      amount: i,
    }));
    const wrapper = await fixture(html`<div style="height: 400px">
      <apex-grid-enterprise
        .data=${data}
        .columns=${columns}
        .groupBy=${['region']}
        .editing=${{ enabled: true }}
      ></apex-grid-enterprise>
    </div>`);
    const grid = wrapper.querySelector('apex-grid-enterprise') as Grid;
    await settle(grid, 150);
    const edited = grid.pageItems[2] as Row;
    await grid.editCell(2, 'region');
    await settle(grid);
    const input = cellOf(grid, 2, 'region')!.shadowRoot!.querySelector('input')!;
    input.focus();
    input.select();
    await sendKeys({ type: 'Z3' });
    await sendKeys({ press: 'Tab' });
    await settle(grid, 300);
    const items = grid.pageItems as Row[];
    const from = items.indexOf(edited);
    expect(edited.region).to.equal('Z3');
    expect(from).to.be.greaterThan(300);
    const next = items.findIndex((row, index) => index > from && row.product !== undefined);
    expect(grid.stateController.active).to.deep.equal({ row: next, column: 'product' });
    expect(deepActive()).to.equal(cellOf(grid, next, 'product'));
  });
});
