import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import { ApexGrid } from '../src/components/grid.js';
import type { GridState } from '../src/internal/state-snapshot.js';
import type { ColumnConfiguration } from '../src/internal/types.js';
import type { SortExpression } from '../src/operations/sort/types.js';
import data, { type TestData } from './utils/test-data.js';

const columns = [
  { key: 'id', type: 'number' },
  { key: 'name' },
  { key: 'active', type: 'boolean' },
  { key: 'importance' },
] as ColumnConfiguration<TestData>[];

describe('ApexGrid stateChanged event', () => {
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

  it('fires once with the new snapshot when state changes', async () => {
    const grid = await mount();
    const seen: GridState[] = [];
    grid.addEventListener('stateChanged', (e) => seen.push(e.detail.state));

    grid.sort([{ key: 'name', direction: 'descending' } as SortExpression<TestData>]);
    await grid.updateComplete;
    await nextFrame();

    expect(seen).to.have.lengthOf(1);
    expect(seen[0].sort[0]).to.include({ key: 'name', direction: 'descending' });
  });

  it('coalesces a multi-slice setState into a single emit', async () => {
    const grid = await mount();
    let count = 0;
    grid.addEventListener('stateChanged', () => count++);

    grid.setState({
      sort: [{ key: 'id', direction: 'ascending' }],
      quickFilter: 'a',
      pagination: { page: 0, pageSize: 4 },
    });
    await grid.updateComplete;
    await nextFrame();

    expect(count).to.equal(1);
  });

  it('does not fire when the applied state is unchanged', async () => {
    const grid = await mount();
    let count = 0;
    grid.addEventListener('stateChanged', () => count++);

    grid.setState(grid.getState());
    await grid.updateComplete;
    await nextFrame();

    expect(count).to.equal(0);
  });

  it('does not replay prior renders: first emit is the first change after subscribing', async () => {
    const grid = await mount();
    const seen: GridState[] = [];
    grid.addEventListener('stateChanged', (e) => seen.push(e.detail.state));
    await nextFrame();
    expect(seen).to.have.lengthOf(0);

    grid.page = 1;
    await grid.updateComplete;
    await nextFrame();
    expect(seen).to.have.lengthOf(1);
    expect(seen[0].pagination.page).to.equal(1);
  });

  it('stops emitting after the listener is removed', async () => {
    const grid = await mount();
    let count = 0;
    const handler = (): void => {
      count += 1;
    };
    grid.addEventListener('stateChanged', handler);

    grid.sort([{ key: 'id', direction: 'ascending' } as SortExpression<TestData>]);
    await grid.updateComplete;
    await nextFrame();
    expect(count).to.equal(1);

    grid.removeEventListener('stateChanged', handler);
    grid.sort([{ key: 'id', direction: 'descending' } as SortExpression<TestData>]);
    await grid.updateComplete;
    await nextFrame();
    expect(count).to.equal(1);
  });
});
