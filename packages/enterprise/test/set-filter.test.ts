import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { ApexGridEnterprise, ApexGridSetFilter } from '../src/index.js';

interface Row {
  id: number;
  name: string;
  department: string;
}

const data: Row[] = [
  { id: 1, name: 'A', department: 'Engineering' },
  { id: 2, name: 'B', department: 'Sales' },
  { id: 3, name: 'C', department: 'Engineering' },
  { id: 4, name: 'D', department: 'Marketing' },
  { id: 5, name: 'E', department: 'Sales' },
];
const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number', headerText: 'ID' },
  { key: 'name', type: 'string', headerText: 'Name' },
  { key: 'department', type: 'string', headerText: 'Department' },
];

async function mount(column = 'department') {
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise
      .data=${data.map((row) => ({ ...row }))}
      .columns=${columns}
    ></apex-grid-enterprise>`
  );
  const filter = await fixture<ApexGridSetFilter>(
    html`<apex-grid-set-filter
      .grid=${grid as unknown as ApexGridSetFilter['grid']}
      .column=${column}
    ></apex-grid-set-filter>`
  );
  await grid.updateComplete;
  await filter.updateComplete;
  return { grid, filter };
}

async function settle(grid: ApexGridEnterprise<Row>, filter: ApexGridSetFilter) {
  await grid.updateComplete;
  await filter.updateComplete;
  await nextFrame();
}

function departments(grid: ApexGridEnterprise<Row>): string[] {
  return (grid.pageItems as Row[]).map((row) => row.department);
}

describe('ApexGridSetFilter', () => {
  before(() => {
    ApexGridEnterprise.register();
    ApexGridSetFilter.register();
  });
  afterEach(() => fixtureCleanup());

  it('lists the column distinct values, sorted', async () => {
    const { filter } = await mount();
    expect(filter.distinctValues.map((value) => value.label)).to.eql([
      'Engineering',
      'Marketing',
      'Sales',
    ]);
  });

  it('renders a checklist option per distinct value plus select-all', async () => {
    const { filter } = await mount();
    const options = filter.shadowRoot!.querySelectorAll('[part~="option"]');
    // 3 values + the "(Select all)" row.
    expect(options.length).to.equal(4);
  });

  it('filters rows to the selected values', async () => {
    const { grid, filter } = await mount();
    filter.setSelectedTokens(['Engineering']);
    await settle(grid, filter);
    expect(departments(grid)).to.eql(['Engineering', 'Engineering']);
  });

  it('selecting a subset keeps only those values', async () => {
    const { grid, filter } = await mount();
    filter.setSelectedTokens(['Engineering', 'Marketing']);
    await settle(grid, filter);
    expect(departments(grid).sort()).to.eql(['Engineering', 'Engineering', 'Marketing']);
  });

  it('clearAll hides every row; selectAll restores them', async () => {
    const { grid, filter } = await mount();
    filter.clearAll();
    await settle(grid, filter);
    expect(grid.pageItems.length).to.equal(0);

    filter.selectAll();
    await settle(grid, filter);
    expect(grid.pageItems.length).to.equal(5);
  });

  it('toggling a checkbox applies the filter live', async () => {
    const { grid, filter } = await mount();
    // Uncheck the "Sales" option (find by label).
    const option = [...filter.shadowRoot!.querySelectorAll('[part~="option"]')].find((el) =>
      el.querySelector('[part="label"]')?.textContent?.includes('Sales')
    );
    const checkbox = option!.querySelector('[part="checkbox"]') as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    await settle(grid, filter);

    expect(departments(grid)).to.not.include('Sales');
    expect(grid.pageItems.length).to.equal(3);
  });

  it('search narrows the visible options without changing the filter', async () => {
    const { grid, filter } = await mount();
    const search = filter.shadowRoot!.querySelector('[part="search"]') as HTMLInputElement;
    search.value = 'sal';
    search.dispatchEvent(new Event('input'));
    await filter.updateComplete;

    const labels = [...filter.shadowRoot!.querySelectorAll('[part~="option"] [part="label"]')].map(
      (el) => el.textContent?.trim()
    );
    // Only "(Select all)" + the matching "Sales" option remain rendered.
    expect(labels).to.eql(['(Select all)', 'Sales']);
    // Searching alone doesn't filter the grid.
    expect(grid.pageItems.length).to.equal(5);
  });

  it('fires apex-set-filter-changed on apply', async () => {
    const { grid, filter } = await mount();
    let detail: { column: string; selected: string[] } | null = null;
    filter.addEventListener('apex-set-filter-changed', (event) => {
      detail = (event as CustomEvent).detail;
    });
    filter.setSelectedTokens(['Engineering']);
    await settle(grid, filter);
    expect(detail).to.not.be.null;
    expect(detail!.column).to.equal('department');
    expect(detail!.selected).to.eql(['Engineering']);
  });
});
