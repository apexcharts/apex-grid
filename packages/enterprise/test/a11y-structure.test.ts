import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import 'axe-core';
import type { ColumnConfiguration } from 'apex-grid';
import {
  ApexGridAI,
  ApexGridChart,
  ApexGridEnterprise,
  enterpriseModules,
  type ServerSideGetRowsParams,
  type ServerSideGetRowsResult,
} from '../src/index.js';

interface Row {
  region: string;
  product: string;
  amount: number;
}

const DATA: Row[] = [
  { region: 'EMEA', product: 'A', amount: 10 },
  { region: 'EMEA', product: 'B', amount: 20 },
  { region: 'AMER', product: 'A', amount: 30 },
  { region: 'AMER', product: 'B', amount: 40 },
];

const columns: ColumnConfiguration<Row>[] = [
  { key: 'region', headerText: 'Region' },
  { key: 'product', headerText: 'Product' },
  { key: 'amount', type: 'number', headerText: 'Amount' },
];

interface AxeResult {
  violations: { id: string; nodes: { target: string[]; failureSummary: string }[] }[];
}
const axe = (window as any).axe as { run(context: Element): Promise<AxeResult> };

/** Every axe violation inside `el`, one line each, so a failure names the rule and node. */
async function axeViolations(el: Element): Promise<string[]> {
  const { violations } = await axe.run(el);
  return violations.flatMap(({ id, nodes }) =>
    nodes.map((node) => `${id}: ${node.target.join(' ')}: ${node.failureSummary}`)
  );
}

/** Poll up to `tries` animation frames until `predicate` holds. */
async function waitFor(predicate: () => boolean, tries = 30): Promise<void> {
  for (let i = 0; i < tries && !predicate(); i += 1) await nextFrame();
}

/** Body and band rows rendered in the grid's own shadow root. */
function rowEls(grid: ApexGridEnterprise<Row>): HTMLElement[] {
  return [...grid.renderRoot.querySelectorAll<HTMLElement>('apex-grid-row')];
}

function table(grid: ApexGridEnterprise<Row>): HTMLElement {
  return grid.renderRoot.querySelector<HTMLElement>('[part~="table"]')!;
}

async function settle(grid: ApexGridEnterprise<Row>) {
  await grid.updateComplete;
  await waitFor(() => rowEls(grid).length > 0);
  await nextFrame();
  await grid.updateComplete;
}

async function mount(props: Partial<ApexGridEnterprise<Row>>) {
  const parentNode = document.createElement('div');
  parentNode.style.height = '600px';
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise .columns=${columns}></apex-grid-enterprise>`,
    { parentNode }
  );
  Object.assign(grid, props);
  await settle(grid);
  return grid;
}

/** Groups by the requested level, standing in for a server. */
const server = {
  getRows({ groupKeys, rowGroupCols }: ServerSideGetRowsParams<Row>): ServerSideGetRowsResult<Row> {
    const scoped = DATA.filter((row) =>
      groupKeys.every((value, i) => String(row[rowGroupCols[i] as keyof Row]) === value)
    );
    if (groupKeys.length === rowGroupCols.length) return { rows: scoped };
    const field = rowGroupCols[groupKeys.length] as keyof Row;
    const values = [...new Set(scoped.map((row) => String(row[field])))];
    return { rows: values.map((value) => ({ [field]: value }) as unknown as Row) };
  },
};

describe('ARIA structure (enterprise)', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    // The toolbar shows Create chart and Ask AI once their panels are registered.
    ApexGridChart.register();
    ApexGridAI.register();
  });
  afterEach(() => fixtureCleanup());

  it('a default grid with its toolbar actions has no violations', async () => {
    const grid = await mount({ data: DATA.map((row) => ({ ...row })) });
    expect(grid.renderRoot.querySelector('apex-grid-toolbar'), 'toolbar rendered').to.exist;
    expect(table(grid).getAttribute('role')).to.equal('grid');
    expect(await axeViolations(grid)).to.eql([]);
  });

  it('a grouped grid is a treegrid with no violations, and a grid again once ungrouped', async () => {
    const grid = await mount({
      data: DATA.map((row) => ({ ...row })),
      groupBy: ['region'],
      aggregations: { amount: ['sum'] },
    });
    expect(table(grid).getAttribute('role')).to.equal('treegrid');
    expect(rowEls(grid).some((row) => row.getAttribute('aria-level') === '1')).to.be.true;
    expect(await axeViolations(grid)).to.eql([]);

    grid.groupBy = [];
    await settle(grid);
    expect(table(grid).getAttribute('role')).to.equal('grid');
  });

  it('a pivot tree is a treegrid with no violations', async () => {
    const grid = await mount({
      data: DATA.map((row) => ({ ...row })),
      pivotOn: 'product',
      pivotRows: ['region', 'product'],
      pivotValues: { amount: ['sum'] },
      pivotOptions: { expandable: true },
    });
    expect(table(grid).getAttribute('role')).to.equal('treegrid');
    expect(rowEls(grid).some((row) => row.hasAttribute('aria-expanded'))).to.be.true;
    expect(await axeViolations(grid)).to.eql([]);
  });

  it('a flat pivot stays a grid', async () => {
    const grid = await mount({
      data: DATA.map((row) => ({ ...row })),
      pivotOn: 'product',
      pivotRows: ['region'],
      pivotValues: { amount: ['sum'] },
    });
    expect(table(grid).getAttribute('role')).to.equal('grid');
    expect(await axeViolations(grid)).to.eql([]);
  });

  it('server-side groups are a treegrid with no violations', async () => {
    const grid = await mount({
      serverSideRowModel: { datasource: server, rowGroupCols: ['region'] },
    });
    expect(table(grid).getAttribute('role')).to.equal('treegrid');
    expect(rowEls(grid).some((row) => row.getAttribute('aria-level') === '1')).to.be.true;
    expect(await axeViolations(grid)).to.eql([]);
  });

  it('a flat server-side request is a grid whose rows carry no level', async () => {
    const grid = await mount({ serverSideRowModel: { datasource: server, rowGroupCols: [] } });
    expect(table(grid).getAttribute('role')).to.equal('grid');
    expect(rowEls(grid).length).to.be.greaterThan(0);
    expect(rowEls(grid).some((row) => row.hasAttribute('aria-level'))).to.be.false;
    expect(await axeViolations(grid)).to.eql([]);
  });

  it('a grid with a total row has no violations', async () => {
    const grid = await mount({
      data: DATA.map((row) => ({ ...row })),
      totalRow: { aggregations: { amount: ['sum'] } },
    });
    expect(await axeViolations(grid)).to.eql([]);
  });

  it('a master-detail grid with an expanded row is a treegrid with no violations', async () => {
    const grid = await mount({
      data: DATA.map((row) => ({ ...row })),
      masterDetail: {
        columns: [{ key: 'product' }, { key: 'amount' }],
        getDetailData: (row: Row) => [{ product: row.product, amount: row.amount }],
      },
    });
    expect(table(grid).getAttribute('role')).to.equal('treegrid');
    await grid.expandRow(grid.data[0]);
    await settle(grid);
    const row = rowEls(grid)[0] as HTMLElement & { renderRoot: ShadowRoot };
    await waitFor(() => Boolean(row.renderRoot.querySelector('apex-grid-cell')));
    expect(row.renderRoot.querySelector('[part~="detail-panel"]')?.getAttribute('role')).to.equal(
      'gridcell'
    );
    expect(await axeViolations(grid)).to.eql([]);
  });
});
