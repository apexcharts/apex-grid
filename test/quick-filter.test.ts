import { expect, html } from '@open-wc/testing';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

class QuickFilterFixture<T extends TestData> extends GridTestFixture<T> {
  public override setupTemplate() {
    return html`<apex-grid
      show-quick-filter
      .data=${this.data}
      .columns=${this.columnConfig}
    ></apex-grid>`;
  }
}

const TDD = new QuickFilterFixture(data);

describe('Grid quick filter (global search)', () => {
  beforeEach(async () => await TDD.setUp());
  afterEach(() => TDD.tearDown());

  it('renders the toolbar only when showQuickFilter is true', async () => {
    expect(TDD.grid.renderRoot.querySelector('apex-grid-toolbar')).to.exist;
    await TDD.updateProperty('showQuickFilter', false);
    expect(TDD.grid.renderRoot.querySelector('apex-grid-toolbar')).to.be.null;
  });

  it('does no filtering when the quickFilter value is empty', async () => {
    expect(TDD.grid.totalItems).to.equal(data.length);
  });

  it('filters case-insensitively across visible columns', async () => {
    await TDD.updateProperty('quickFilter', 'high');
    expect(TDD.grid.totalItems).to.equal(data.filter((d) => d.importance === 'high').length);

    await TDD.updateProperty('quickFilter', 'HIGH');
    expect(TDD.grid.totalItems).to.equal(data.filter((d) => d.importance === 'high').length);
  });

  it('matches numeric column values as substrings', async () => {
    await TDD.updateProperty('quickFilter', '8');
    expect(TDD.grid.totalItems).to.equal(1);
    expect(TDD.grid.rows[0].data.id).to.equal(8);
  });

  it('clears when given an empty string', async () => {
    await TDD.updateProperty('quickFilter', 'high');
    expect(TDD.grid.totalItems).to.be.lessThan(data.length);
    await TDD.updateProperty('quickFilter', '');
    expect(TDD.grid.totalItems).to.equal(data.length);
  });

  it('emits cancellable quickFilterChanging + quickFilterChanged from setQuickFilter()', async () => {
    const calls: string[] = [];
    TDD.grid.addEventListener('quickFilterChanging', () => calls.push('changing'));
    TDD.grid.addEventListener('quickFilterChanged', () => calls.push('changed'));

    const applied = await TDD.grid.setQuickFilter('high');
    expect(applied).to.be.true;
    expect(calls).to.deep.equal(['changing', 'changed']);
    expect(TDD.grid.quickFilter).to.equal('high');
  });

  it('cancellation aborts the change', async () => {
    TDD.grid.addEventListener('quickFilterChanging', (event) => event.preventDefault());
    const applied = await TDD.grid.setQuickFilter('high');
    expect(applied).to.be.false;
    expect(TDD.grid.quickFilter).to.equal('');
  });

  it('resets pagination to the first page when applied alongside pagination', async () => {
    await TDD.updateProperty('pagination', { enabled: true, pageSize: 2 });
    await TDD.grid.gotoPage(2);
    expect(TDD.grid.page).to.equal(2);
    await TDD.grid.setQuickFilter('high');
    expect(TDD.grid.page).to.equal(0);
  });

  it('skips hidden columns when matching', async () => {
    await TDD.updateColumns({ key: 'importance', hidden: true });
    await TDD.updateProperty('quickFilter', 'high');
    // The match relied on `importance` which is now hidden; with the other
    // columns there is no row whose stringified value contains "high".
    expect(TDD.grid.totalItems).to.equal(0);
  });

  it('respects a custom dataPipelineConfiguration.quickFilter hook', async () => {
    let invoked = 0;
    await TDD.updateProperty('dataPipelineConfiguration', {
      quickFilter: ({ data }) => {
        invoked += 1;
        return data.filter((row) => row.id % 2 === 0);
      },
    });
    await TDD.updateProperty('quickFilter', 'anything');
    expect(invoked).to.be.greaterThan(0);
    expect(TDD.grid.totalItems).to.equal(data.filter((d) => d.id % 2 === 0).length);
  });
});
