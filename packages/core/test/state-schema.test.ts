import { expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
import { ApexGrid } from '../src/components/grid.js';
import type { ColumnConfiguration } from '../src/internal/types.js';
import { getFilterOperandsFor } from '../src/internal/utils.js';
import data, { type TestData } from './utils/test-data.js';

const columns = [
  { key: 'id', type: 'number', sort: true, filter: true },
  { key: 'name', filter: true, editable: true },
  { key: 'active', type: 'boolean' },
  { key: 'importance', hidden: true, pinned: 'start' },
] as ColumnConfiguration<TestData>[];

describe('ApexGrid.getSchema', () => {
  afterEach(() => fixtureCleanup());

  async function mount(): Promise<ApexGrid<TestData>> {
    ApexGrid.register();
    const grid = await fixture<ApexGrid<TestData>>(html`
      <apex-grid
        .data=${[...data]}
        .columns=${columns}
        .selection=${{ enabled: true, mode: 'single' }}
        .pagination=${{ enabled: true, pageSize: 4 }}
        .rowPinning=${{ enabled: true }}
        .rowReordering=${{ enabled: true }}
      ></apex-grid>
    `);
    await grid.updateComplete;
    return grid;
  }

  it('describes version, columns, capabilities, and embedded state', async () => {
    const grid = await mount();
    const schema = grid.getSchema();
    expect(schema.version).to.equal(1);
    expect(schema.columns.map((c) => c.key)).to.deep.equal(['id', 'name', 'active', 'importance']);
    expect(schema.state).to.deep.equal(grid.getState());
    expect(() => JSON.stringify(schema)).to.not.throw();
  });

  it('reflects per-column config (sortable / filterable / editable / hidden / pinned / type)', async () => {
    const grid = await mount();
    const byKey = Object.fromEntries(grid.getSchema().columns.map((c) => [c.key, c]));

    expect(byKey.id).to.include({ dataType: 'number', sortable: true, filterable: true });
    expect(byKey.name).to.include({ filterable: true, editable: true, sortable: false });
    expect(byKey.active).to.include({ dataType: 'boolean', filterable: false });
    expect(byKey.importance).to.include({ hidden: true, pinned: 'start' });
  });

  it('lists filter operands for filterable columns, from the same source as the apply path', async () => {
    const grid = await mount();
    const byKey = Object.fromEntries(grid.getSchema().columns.map((c) => [c.key, c]));

    expect(byKey.id.filterOperands).to.deep.equal(Object.keys(getFilterOperandsFor(columns[0])));
    expect(byKey.name.filterOperands).to.deep.equal(Object.keys(getFilterOperandsFor(columns[1])));
    // Non-filterable column advertises no operands.
    expect(byKey.active.filterOperands).to.deep.equal([]);
  });

  it('describes grid-level capabilities', async () => {
    const grid = await mount();
    const { capabilities } = grid.getSchema();

    expect(capabilities.sort.directions).to.deep.equal(['ascending', 'descending']);
    expect(capabilities.sort.multi).to.equal(true); // grid default
    expect(capabilities.pagination).to.equal(true);
    expect(capabilities.selection).to.equal('single');
    expect(capabilities.rowPinning).to.equal(true);
    expect(capabilities.rowReordering).to.equal(true);
    expect(Object.keys(capabilities.filter.operandsByType)).to.include.members([
      'number',
      'string',
      'boolean',
    ]);
  });

  it('reflects single-sort and disabled selection', async () => {
    const grid = await mount();
    grid.sortConfiguration = { ...grid.sortConfiguration, multiple: false };
    grid.selection = { enabled: false };
    await grid.updateComplete;

    const { capabilities } = grid.getSchema();
    expect(capabilities.sort.multi).to.equal(false);
    expect(capabilities.selection).to.equal(false);
  });
});
