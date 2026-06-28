import { expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
import { ApexGrid } from '../src/components/grid.js';
import type { GridState } from '../src/internal/state-snapshot.js';
import type { ColumnConfiguration } from '../src/internal/types.js';
import data, { type TestData } from './utils/test-data.js';

const columns = [
  { key: 'id', type: 'number' },
  { key: 'name' },
  { key: 'active', type: 'boolean' },
  { key: 'importance' },
] as ColumnConfiguration<TestData>[];

describe('ApexGrid.setState — defensive apply', () => {
  afterEach(() => fixtureCleanup());

  async function mount(): Promise<ApexGrid<TestData>> {
    ApexGrid.register();
    const grid = await fixture<ApexGrid<TestData>>(html`
      <apex-grid
        .data=${[...data]}
        .columns=${columns}
        .selection=${{ enabled: true, mode: 'multiple' }}
        .pagination=${{ enabled: true, pageSize: 4 }}
      ></apex-grid>
    `);
    await grid.updateComplete;
    return grid;
  }

  it('reports applied and skipped slices', async () => {
    const grid = await mount();
    const result = grid.setState({ sort: [{ key: 'id', direction: 'ascending' }] });
    expect(result.applied).to.deep.equal(['sort']);
    expect(result.warnings).to.have.lengthOf(0);
    expect(result.skipped).to.include.members(['columns', 'filter', 'selection', 'pagination']);
  });

  it('treats an empty object as a no-op (all slices skipped)', async () => {
    const grid = await mount();
    const result = grid.setState({});
    expect(result.applied).to.have.lengthOf(0);
    expect(result.warnings).to.have.lengthOf(0);
    expect(result.skipped).to.have.lengthOf(11);
  });

  it('drops a filter on an unknown column and reports it', async () => {
    const grid = await mount();
    const result = grid.setState({
      filter: [{ key: 'nope', operand: 'contains', searchTerm: 'a' }],
    });
    expect(result.applied).to.include('filter');
    expect(result.warnings.some((w) => w.includes('nope') && w.includes('unknown column'))).to.be
      .true;
    expect(grid.filterExpressions).to.have.lengthOf(0);
  });

  it('drops a filter with an unknown operand and reports it', async () => {
    const grid = await mount();
    const result = grid.setState({ filter: [{ key: 'name', operand: 'bogusOperand' }] });
    expect(result.warnings.some((w) => w.includes('unknown operand'))).to.be.true;
    expect(grid.filterExpressions).to.have.lengthOf(0);
  });

  it('drops a sort on an unknown column', async () => {
    const grid = await mount();
    const result = grid.setState({ sort: [{ key: 'ghost', direction: 'ascending' }] });
    expect(result.warnings.some((w) => w.includes('ghost') && w.includes('unknown column'))).to.be
      .true;
    expect(grid.sortExpressions).to.have.lengthOf(0);
  });

  it('clamps an out-of-range page and reports it', async () => {
    const grid = await mount();
    const result = grid.setState({ pagination: { page: 99, pageSize: 4 } });
    await grid.updateComplete;
    expect(grid.page).to.equal(1); // 8 rows / 4 = 2 pages → max index 1
    expect(result.warnings.some((w) => w.includes('out of range'))).to.be.true;
  });

  it('ignores an invalid pageSize', async () => {
    const grid = await mount();
    const result = grid.setState({ pagination: { page: 0, pageSize: 0 } });
    expect(result.warnings.some((w) => w.includes('invalid pageSize'))).to.be.true;
  });

  it('warns on unresolvable row references', async () => {
    const grid = await mount();
    const result = grid.setState({ selection: [{ index: 0 }, { index: 999 }] });
    await grid.updateComplete;
    expect(grid.selectedRows.map((r) => r.id)).to.deep.equal([1]);
    expect(result.warnings.some((w) => w.includes('1 of 2'))).to.be.true;
  });

  it('warns on an unsupported snapshot version but still applies recognized slices', async () => {
    const grid = await mount();
    const result = grid.setState({
      version: 2,
      sort: [{ key: 'id', direction: 'descending' }],
    } as unknown as Partial<GridState>);
    expect(result.warnings.some((w) => w.includes('version'))).to.be.true;
    expect(grid.sortExpressions[0]).to.include({ key: 'id', direction: 'descending' });
  });

  it('never throws on wrong-typed slices; it skips them with warnings', async () => {
    const grid = await mount();
    let result!: ReturnType<ApexGrid<TestData>['setState']>;
    expect(() => {
      result = grid.setState({
        sort: 'nonsense',
        pagination: 42,
        columns: {},
        selection: 'x',
      } as unknown as Partial<GridState>);
    }).to.not.throw();
    expect(result.warnings.length).to.be.greaterThan(3);
    expect(result.applied).to.have.lengthOf(0);
  });

  it('strict mode throws on the first problem', async () => {
    const grid = await mount();
    expect(() =>
      grid.setState({ sort: [{ key: 'ghost', direction: 'ascending' }] }, { strict: true })
    ).to.throw(/setState/);
  });
});
