import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration, FilterExpression } from 'apex-grid';
import { ApexGridEnterprise, ApexGridSetFilter } from '../src/index.js';

interface Row {
  id: number;
  department: string;
}

const data: Row[] = [
  { id: 1, department: 'Engineering' },
  { id: 2, department: 'Sales' },
  { id: 3, department: 'Engineering' },
  { id: 4, department: 'Marketing' },
  { id: 5, department: 'Sales' },
];
const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number', headerText: 'ID' },
  { key: 'department', type: 'string', headerText: 'Department', filter: true },
];

type AnyGrid = ApexGridEnterprise<any>;

async function mount<R extends object>(rows: R[], cols: ColumnConfiguration<R>[], column: string) {
  const grid = await fixture<AnyGrid>(
    html`<apex-grid-enterprise .data=${rows} .columns=${cols}></apex-grid-enterprise>`
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

async function settle(grid: AnyGrid, filter?: ApexGridSetFilter) {
  await grid.updateComplete;
  await filter?.updateComplete;
  await nextFrame();
}

function departments(grid: AnyGrid): string[] {
  return (grid.dataView as Row[]).map((row) => row.department);
}

function toggle(filter: ApexGridSetFilter, label: string, checked: boolean) {
  const option = [...filter.shadowRoot!.querySelectorAll('[part~="option"]')].find(
    (el) => el.querySelector('[part="label"]')?.textContent?.trim() === label
  );
  const box = option!.querySelector('[part="checkbox"]') as HTMLInputElement;
  box.checked = checked;
  box.dispatchEvent(new Event('change'));
}

describe('ApexGridSetFilter: sync with the applied filter', () => {
  before(() => {
    ApexGridEnterprise.register();
    ApexGridSetFilter.register();
  });
  afterEach(() => fixtureCleanup());

  // ent-setfilter-xlsx-2
  it('refresh() after a data change keeps the checklist in step with the grid', async () => {
    const { grid, filter } = await mount(
      data.map((r) => ({ ...r })),
      columns,
      'department'
    );
    filter.setSelectedTokens(['Engineering', 'Marketing']);
    await settle(grid, filter);

    grid.data = [...grid.data, { id: 6, department: 'Support' }];
    await grid.updateComplete;
    filter.refresh();
    await settle(grid, filter);

    const shown = new Set(departments(grid));
    expect(filter.distinctValues.map((v) => v.token)).to.include('Support');
    // Every checked token has its rows visible, every unchecked one is hidden.
    for (const value of filter.distinctValues) {
      const checked = filter.selectedTokens.includes(value.token);
      expect(shown.has(value.token), value.token).to.equal(checked);
    }
    expect(filter.selectedTokens.sort()).to.eql(['Engineering', 'Marketing']);
    // The select-all box reflects a partial selection, not "nothing filtered".
    const all = filter.shadowRoot!.querySelector<HTMLInputElement>(
      '[part~="select-all"] [part="checkbox"]'
    )!;
    expect(all.checked).to.equal(false);
    expect(all.indeterminate).to.equal(true);
  });

  it('a fresh panel reads its checked state from the applied filter', async () => {
    const { grid, filter } = await mount(
      data.map((r) => ({ ...r })),
      columns,
      'department'
    );
    filter.setSelectedTokens(['Sales']);
    await settle(grid, filter);
    const second = await fixture<ApexGridSetFilter>(
      html`<apex-grid-set-filter
        .grid=${grid as unknown as ApexGridSetFilter['grid']}
        .column=${'department'}
      ></apex-grid-set-filter>`
    );
    await second.updateComplete;
    expect(second.selectedTokens).to.eql(['Sales']);

    // Clearing the column's filter elsewhere shows everything checked on refresh.
    grid.clearFilter('department');
    await settle(grid);
    second.refresh();
    expect(second.selectedTokens.sort()).to.eql(['Engineering', 'Marketing', 'Sales']);
  });

  // ent-setfilter-xlsx-4
  it('an applied set filter round-trips through getState and setState', async () => {
    const { grid, filter } = await mount(
      data.map((r) => ({ ...r })),
      columns,
      'department'
    );
    filter.setSelectedTokens(['Engineering']);
    await settle(grid, filter);
    expect(departments(grid)).to.eql(['Engineering', 'Engineering']);

    const state = JSON.parse(JSON.stringify(grid.getState()));
    expect(state.filter).to.have.length(1);
    expect(state.filter[0].operand).to.equal('set');
    expect(state.filter[0].searchTerm).to.eql(['Engineering']);

    grid.clearFilter();
    await settle(grid);
    expect(grid.dataView.length).to.equal(5);

    const result = grid.setState(state);
    await settle(grid);
    expect(result.warnings).to.eql([]);
    expect(departments(grid)).to.eql(['Engineering', 'Engineering']);

    filter.refresh();
    expect(filter.selectedTokens).to.eql(['Engineering']);
  });

  it('setState(getState()) with a set filter keeps the scroll position', async () => {
    const names = ['Engineering', 'Sales', 'Marketing', 'Support'];
    const rows = Array.from({ length: 2000 }, (_, i) => ({ id: i + 1, department: names[i % 4] }));
    const { grid, filter } = await mount(rows, columns, 'department');
    grid.style.display = 'block';
    grid.style.height = '300px';
    filter.setSelectedTokens(['Engineering', 'Sales', 'Marketing']);
    await settle(grid, filter);
    grid.scrollTop = 4000;
    await settle(grid);
    const before = grid.scrollTop;
    expect(before).to.be.greaterThan(0);
    grid.setState(grid.getState());
    await settle(grid);
    await nextFrame();
    expect(grid.scrollTop).to.equal(before);
  });

  it('a saved set filter without a selection is dropped with a warning', async () => {
    const { grid } = await mount(
      data.map((r) => ({ ...r })),
      columns,
      'department'
    );
    const result = grid.setState({
      filter: [{ key: 'department', operand: 'set', criteria: 'and', caseSensitive: false }],
    });
    await settle(grid);
    expect(grid.dataView.length).to.equal(5);
    expect(result.warnings.join(' ')).to.contain('needs a searchTerm');
  });

  it('applies a set expression given by operand name', async () => {
    const { grid, filter } = await mount(
      data.map((r) => ({ ...r })),
      columns,
      'department'
    );
    grid.filter({
      key: 'department',
      condition: 'set',
      searchTerm: ['Marketing'],
    } as unknown as FilterExpression<any>);
    await settle(grid);
    expect(departments(grid)).to.eql(['Marketing']);
    filter.refresh();
    expect(filter.selectedTokens).to.eql(['Marketing']);
  });

  // ent-setfilter-xlsx-5
  it('toggling keeps the other conditions on the same column', async () => {
    const { grid, filter } = await mount(
      data.map((r) => ({ ...r })),
      columns,
      'department'
    );
    grid.filter({ key: 'department', condition: 'contains', searchTerm: 'ing' });
    await settle(grid, filter);
    expect(departments(grid).sort()).to.eql(['Engineering', 'Engineering', 'Marketing']);

    toggle(filter, 'Marketing', false);
    await settle(grid, filter);
    expect(departments(grid)).to.eql(['Engineering', 'Engineering']);
    const names = grid.filterExpressions.map((e) =>
      typeof e.condition === 'string' ? e.condition : e.condition.name
    );
    expect(names).to.eql(['contains', 'set']);

    // Re-checking drops only the set filter's own expression.
    toggle(filter, 'Marketing', true);
    await settle(grid, filter);
    expect(departments(grid).sort()).to.eql(['Engineering', 'Engineering', 'Marketing']);
    expect(grid.filterExpressions.map((e) => (e.condition as { name: string }).name)).to.eql([
      'contains',
    ]);
  });

  it('editing a getState() snapshot in place leaves the live filter alone', async () => {
    const { grid, filter } = await mount(
      data.map((r) => ({ ...r })),
      columns,
      'department'
    );
    filter.setSelectedTokens(['Engineering']);
    await settle(grid, filter);

    const snapshot = grid.getState();
    (snapshot.filter![0].searchTerm as string[]).push('Sales');
    expect(grid.getState().filter![0].searchTerm).to.eql(['Engineering']);
    expect(departments(grid)).to.eql(['Engineering', 'Engineering']);

    // Restoring the edited snapshot shows what it says, and editing it again
    // afterwards does not reach the grid.
    grid.setState(snapshot);
    await settle(grid);
    expect(departments(grid)).to.eql(['Engineering', 'Sales', 'Engineering', 'Sales']);
    expect(grid.getState().filter![0].searchTerm).to.eql(['Engineering', 'Sales']);
    (snapshot.filter![0].searchTerm as string[]).push('Marketing');
    expect(grid.getState().filter![0].searchTerm).to.eql(['Engineering', 'Sales']);
  });

  it('an or condition on the column cannot let unchecked values through', async () => {
    const { grid, filter } = await mount(
      data.map((r) => ({ ...r })),
      columns,
      'department'
    );
    grid.filter([
      { key: 'department', condition: 'contains', searchTerm: 'Eng' },
      { key: 'department', condition: 'contains', searchTerm: 'Sal', criteria: 'or' },
    ]);
    await settle(grid, filter);
    filter.refresh();
    filter.setSelectedTokens(['Engineering', 'Marketing']);
    await settle(grid, filter);
    expect(departments(grid)).to.eql(['Engineering', 'Engineering', 'Marketing']);
    expect(grid.filterExpressions.map((e) => (e.condition as { name: string }).name)).to.eql([
      'set',
    ]);
  });

  it('a string searchTerm on the set expression selects that one value', async () => {
    const { grid, filter } = await mount(
      data.map((r) => ({ ...r })),
      columns,
      'department'
    );
    filter.setSelectedTokens(['Engineering', 'Marketing']);
    await settle(grid, filter);
    // As the core filter row does when its chip input is edited.
    const expression = grid.filterExpressions[0];
    expression.searchTerm = 'Marketing';
    grid.filter(expression);
    await settle(grid, filter);
    expect(departments(grid)).to.eql(['Marketing']);
    filter.refresh();
    expect(filter.selectedTokens).to.eql(['Marketing']);
  });

  it('select all stays partial while a selection is applied', async () => {
    const { grid, filter } = await mount(
      data.map((r) => ({ ...r })),
      columns,
      'department'
    );
    toggle(filter, 'Sales', false);
    await settle(grid, filter);
    grid.data = grid.data.filter((row: Row) => row.department !== 'Sales');
    await grid.updateComplete;
    filter.refresh();
    await settle(grid, filter);

    const all = filter.shadowRoot!.querySelector<HTMLInputElement>(
      '[part~="select-all"] [part="checkbox"]'
    )!;
    expect(filter.selectedTokens.sort()).to.eql(['Engineering', 'Marketing']);
    expect(all.checked).to.equal(false);
    expect(all.indeterminate).to.equal(true);

    // Checking it clears the selection, so a returning value shows again.
    all.click();
    await settle(grid, filter);
    expect(grid.filterExpressions).to.have.length(0);
    expect(all.checked).to.equal(true);
    expect(all.indeterminate).to.equal(false);
  });

  // ent-setfilter-xlsx-7
  it('sorts Date values by time and labels agree with tokens', async () => {
    interface DRow {
      id: number;
      when: Date;
    }
    const rows: DRow[] = [
      { id: 1, when: new Date(2024, 0, 10) },
      { id: 2, when: new Date(2024, 0, 2) },
      { id: 3, when: new Date(2024, 0, 2, 15, 0) },
      { id: 4, when: new Date(2021, 0, 1) },
      { id: 5, when: new Date(2024, 0, 2) },
    ];
    const cols: ColumnConfiguration<DRow>[] = [
      { key: 'id', type: 'number' },
      { key: 'when', type: 'date' },
    ];
    const { grid, filter } = await mount(rows, cols, 'when');
    const values = filter.distinctValues;
    expect(values.map((v) => (v.value as Date).getTime())).to.eql(
      [rows[3], rows[1], rows[2], rows[0]].map((r) => r.when.getTime())
    );
    // Distinct tokens have distinct labels.
    expect(new Set(values.map((v) => v.label)).size).to.equal(values.length);

    filter.setSelectedTokens([values[1].token]);
    await settle(grid, filter);
    expect((grid.dataView as DRow[]).map((r) => r.id)).to.eql([2, 5]);
  });

  // ent-setfilter-xlsx-9
  it('caps the rendered options for a high-cardinality column', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ id: i, department: `D${i}` }));
    const { grid, filter } = await mount(rows, columns, 'department');
    const options = filter.shadowRoot!.querySelectorAll('[part="option"]');
    expect(options.length).to.be.lessThan(1001);
    const more = filter.shadowRoot!.querySelector('[part="more"]');
    expect(more?.textContent?.trim()).to.equal(
      `Showing ${options.length} of 5000 values. Search to narrow the list.`
    );

    grid.localeText = {
      'setFilter.more': 'Mostrando {shown} de {total} valores. Busque para acotar la lista.',
    };
    await grid.updateComplete;
    filter.requestUpdate();
    await filter.updateComplete;
    expect(filter.shadowRoot!.querySelector('[part="more"]')?.textContent?.trim()).to.equal(
      `Mostrando ${options.length} de 5000 valores. Busque para acotar la lista.`
    );

    // A narrow search renders every match and no refine row.
    const search = filter.shadowRoot!.querySelector('[part="search"]') as HTMLInputElement;
    search.value = 'D499';
    search.dispatchEvent(new Event('input'));
    await filter.updateComplete;
    expect(filter.shadowRoot!.querySelectorAll('[part="option"]').length).to.equal(11);
    expect(filter.shadowRoot!.querySelector('[part="more"]')).to.equal(null);

    // Every value still takes part in select-all and the filter.
    filter.clearAll();
    await settle(grid, filter);
    expect(grid.dataView.length).to.equal(0);
    filter.selectAll();
    await settle(grid, filter);
    expect(grid.dataView.length).to.equal(5000);
  });
});
