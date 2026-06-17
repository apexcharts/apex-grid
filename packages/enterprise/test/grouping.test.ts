import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { render } from 'lit';
import { type GroupingController, getGroupMeta } from '../src/features/grouping.js';
import { type AggregationConfig, ApexGridEnterprise } from '../src/index.js';

interface Row {
  region: string;
  product: string;
  amount: number;
}

function makeData(): Row[] {
  return [
    { region: 'EMEA', product: 'A', amount: 10 },
    { region: 'EMEA', product: 'B', amount: 20 },
    { region: 'AMER', product: 'A', amount: 30 },
    { region: 'AMER', product: 'A', amount: 40 },
  ];
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'region' },
  { key: 'product' },
  { key: 'amount' },
];

/** Reaches the protected `stateController` for assertions. */
function stateOf(grid: ApexGridEnterprise<Row>) {
  return (grid as unknown as { stateController: { modules: Map<string, unknown> } })
    .stateController;
}

async function mount(groupBy: string[], aggregations: AggregationConfig = {}) {
  const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
    .data=${makeData()}
    .columns=${columns}
    .groupBy=${groupBy}
    .aggregations=${aggregations}
  ></apex-grid-enterprise>`);
  await grid.updateComplete;
  await nextFrame();
  return grid;
}

/** Splits the rendered view into group-header rows and leaf rows. */
function partition(grid: ApexGridEnterprise<Row>) {
  const items = grid.pageItems as readonly Row[];
  const headers = items.filter((row) => getGroupMeta(row));
  const leaves = items.filter((row) => !getGroupMeta(row));
  return { items, headers, leaves };
}

describe('ApexGridEnterprise row grouping', () => {
  before(() => ApexGridEnterprise.register());
  afterEach(() => fixtureCleanup());

  it('registers the grouping module alongside aggregation', async () => {
    const grid = await mount([]);
    const { modules } = stateOf(grid);
    expect(modules.size).to.equal(3);
    expect(modules.has('grouping')).to.be.true;
    expect(modules.has('aggregation')).to.be.true;
    expect(modules.has('pivot')).to.be.true;
  });

  it('groups by a single key: one header per distinct value, leaves under each', async () => {
    const grid = await mount(['region']);
    const { items, headers, leaves } = partition(grid);

    expect(headers.length, 'two region groups').to.equal(2);
    expect(headers.map((h) => getGroupMeta(h)!.label)).to.eql(['EMEA', 'AMER']);
    expect(getGroupMeta(headers[0])!.count, 'EMEA leaf count').to.equal(2);
    expect(getGroupMeta(headers[1])!.count, 'AMER leaf count').to.equal(2);
    // 2 headers + all 4 leaves visible (expanded by default).
    expect(items.length).to.equal(6);
    expect(leaves.length).to.equal(4);
  });

  it('groups by multiple keys (nested headers)', async () => {
    const grid = await mount(['region', 'product']);
    const { headers } = partition(grid);

    const depths = headers.map((h) => getGroupMeta(h)!.depth);
    expect(depths.filter((d) => d === 0).length, 'region headers').to.equal(2);
    // EMEA → {A, B}; AMER → {A} ⇒ three product sub-headers.
    expect(depths.filter((d) => d === 1).length, 'product sub-headers').to.equal(3);
  });

  it('collapsing a group hides its leaves', async () => {
    const grid = await mount(['region']);
    expect(partition(grid).items.length).to.equal(6);

    const emea = grid.getGroups().find((g) => g.label === 'EMEA')!;
    grid.collapseGroup(emea.key);
    await grid.updateComplete;
    await nextFrame();

    // EMEA header (collapsed, no leaves) + AMER header + 2 AMER leaves = 4.
    expect(partition(grid).items.length).to.equal(4);
  });

  it('computes per-group aggregates over the group leaves', async () => {
    const grid = await mount(['region'], { amount: ['sum', 'count'] });
    const groups = grid.getGroups();
    const emea = groups.find((g) => g.label === 'EMEA')!;
    const amer = groups.find((g) => g.label === 'AMER')!;

    expect(emea.aggregates.amount).to.eql({ sum: 30, count: 2 });
    expect(amer.aggregates.amount).to.eql({ sum: 70, count: 2 });
  });

  it('aggregates reflect the filtered leaves (filtered-data aggregation)', async () => {
    const grid = await mount(['region'], { amount: ['sum'] });
    grid.quickFilter = 'AMER';
    await grid.updateComplete;
    await nextFrame();
    await nextFrame();

    const groups = grid.getGroups();
    expect(groups.length, 'only the matching group remains').to.equal(1);
    expect(groups[0].label).to.equal('AMER');
    expect(groups[0].aggregates.amount).to.eql({ sum: 70 });
  });

  it('presents group rows full-width with level + header content', async () => {
    const grid = await mount(['region']);
    const grouping = stateOf(grid).modules.get('grouping') as GroupingController<Row>;
    const headerRow = (grid.pageItems as readonly Row[]).find((row) => getGroupMeta(row))!;

    const presented = grouping.presentRow(headerRow, { columns, rowIndex: 0 });
    expect(presented, 'group row is presented').to.not.be.null;
    expect(presented!.level).to.equal(1);
    expect(presented!.expanded).to.equal(true);

    // Render the presenter template to a detached node and inspect it.
    const host = document.createElement('div');
    render(presented!.content, host);
    expect(host.querySelector('[part="group-header"]'), 'full-width header part').to.exist;
    expect(host.querySelector('[part="group-toggle"]'), 'chevron toggle').to.exist;
    expect(host.textContent).to.contain('EMEA');
    expect(host.textContent).to.contain('(2)');
  });
});
