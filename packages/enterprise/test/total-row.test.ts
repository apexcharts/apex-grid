import { expect, fixture, fixtureCleanup, html, nextFrame, waitUntil } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { ApexGridEnterprise, enterpriseModules, isTotalRow } from '../src/index.js';

interface Row {
  id: number;
  region: string;
  amount: number;
}

const data: Row[] = [
  { id: 1, region: 'East', amount: 10 },
  { id: 2, region: 'East', amount: 20 },
  { id: 3, region: 'West', amount: 30 },
  { id: 4, region: 'West', amount: 40 },
];
const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number' },
  { key: 'region', filter: true },
  { key: 'amount', type: 'number' },
];

function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '600px';
  return node;
}

async function mount() {
  ApexGridEnterprise.use(...enterpriseModules);
  ApexGridEnterprise.register();
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise
      .data=${data.map((row) => ({ ...row }))}
      .columns=${columns}
    ></apex-grid-enterprise>`,
    { parentNode: sizedParent() }
  );
  await grid.updateComplete;
  await nextFrame();
  await waitUntil(() => grid.rows.length > 0, 'body rows never rendered');
  return grid;
}

async function settle(grid: ApexGridEnterprise<Row>) {
  await grid.updateComplete;
  await nextFrame();
}

describe('grand-total row', () => {
  afterEach(() => fixtureCleanup());

  it('is inert until configured', async () => {
    const grid = await mount();
    expect(grid.pageItems.length).to.equal(data.length);
    expect(grid.pageItems.some(isTotalRow), 'no synthesized row').to.be.false;
    expect(grid.getTotals()).to.eql({});
  });

  it('appends one row totalling the whole view', async () => {
    const grid = await mount();
    grid.totalRow = { aggregations: { amount: ['sum', 'avg'] } };
    await settle(grid);

    expect(grid.pageItems.length).to.equal(data.length + 1);
    expect(isTotalRow(grid.pageItems.at(-1)), 'total row is last').to.be.true;
    expect(grid.getTotals().amount).to.eql({ sum: 100, avg: 25 });
  });

  it('honours position: top', async () => {
    const grid = await mount();
    grid.totalRow = { aggregations: { amount: ['sum'] }, position: 'top' };
    await settle(grid);
    expect(isTotalRow(grid.pageItems[0]), 'total row is first').to.be.true;
  });

  it('totals what the view shows, not the whole dataset', async () => {
    const grid = await mount();
    grid.totalRow = { aggregations: { amount: ['sum'] } };
    await settle(grid);
    expect(grid.getTotals().amount?.sum).to.equal(100);

    grid.filter({ key: 'region', condition: 'equals', searchTerm: 'East' } as never);
    await settle(grid);
    expect(grid.getTotals().amount?.sum, 'follows the filter').to.equal(30);
  });

  it('excludes group headers so their aggregates are not counted twice', async () => {
    const grid = await mount();
    grid.aggregations = { amount: ['sum'] };
    grid.groupBy = ['region'];
    grid.totalRow = { aggregations: { amount: ['sum'] } };
    await settle(grid);

    // Two group headers are interleaved; the total must still be the leaf sum.
    expect(grid.pageItems.length, 'leaves + 2 group rows + total').to.equal(data.length + 3);
    expect(grid.getTotals().amount?.sum).to.equal(100);
  });

  it('renders as a full-width row with its own part', async () => {
    const grid = await mount();
    grid.totalRow = { aggregations: { amount: ['sum'] } };
    await settle(grid);

    const row = grid.rows.find((r) => isTotalRow(grid.pageItems[r.index]));
    expect(row, 'total row rendered').to.exist;
    const content = row?.renderRoot.querySelector('[part="total-row-content"]');
    expect(content, 'full-width content').to.exist;
    expect(content?.textContent).to.contain('Grand Total');
    expect(content?.textContent).to.contain('100');
  });

  it('takes a custom label', async () => {
    const grid = await mount();
    grid.totalRow = { aggregations: { amount: ['sum'] }, label: 'All regions' };
    await settle(grid);
    const row = grid.rows.find((r) => isTotalRow(grid.pageItems[r.index]));
    expect(row?.renderRoot.querySelector('[part="total-row-label"]')?.textContent).to.contain(
      'All regions'
    );
  });

  it('drops the row again when unset', async () => {
    const grid = await mount();
    grid.totalRow = { aggregations: { amount: ['sum'] } };
    await settle(grid);
    expect(grid.pageItems.length).to.equal(data.length + 1);

    grid.totalRow = null;
    await settle(grid);
    expect(grid.pageItems.length).to.equal(data.length);
    expect(grid.pageItems.some(isTotalRow)).to.be.false;
  });

  it('renders nothing for an empty aggregation config', async () => {
    const grid = await mount();
    grid.totalRow = { aggregations: {} };
    await settle(grid);
    expect(grid.pageItems.length).to.equal(data.length);
  });

  it('lets ::part() style the total row and group header content', async () => {
    const parts = ['total-row-content', 'total-row-label', 'total-row-value', 'group-label'];
    const style = document.createElement('style');
    style.textContent = parts
      .map((part) => `apex-grid-enterprise::part(${part}){outline:3px solid rgb(1, 2, 3)}`)
      .join('\n');
    document.head.append(style);
    try {
      const grid = await mount();
      grid.groupBy = ['region'];
      grid.totalRow = { aggregations: { amount: ['sum'] } };
      await settle(grid);
      for (const part of parts) {
        const el = grid.rows
          .map((row) => row.renderRoot.querySelector<HTMLElement>(`[part="${part}"]`))
          .find(Boolean);
        expect(el, `${part} renders`).to.exist;
        expect(getComputedStyle(el!).outlineColor, part).to.equal('rgb(1, 2, 3)');
      }
    } finally {
      style.remove();
    }
  });
});
