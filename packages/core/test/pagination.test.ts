import { aTimeout, expect, html } from '@open-wc/testing';
import type { PaginationConfiguration } from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

class PaginationFixture<T extends TestData> extends GridTestFixture<T> {
  public initialPagination: PaginationConfiguration = {
    enabled: true,
    pageSize: 3,
    pageSizeOptions: [3, 5, 10],
  };

  public override setupTemplate() {
    return html`<apex-grid
      .data=${this.data}
      .columns=${this.columnConfig}
      .pagination=${this.initialPagination}
    ></apex-grid>`;
  }
}

const TDD = new PaginationFixture(data);

describe('Grid pagination — local mode', () => {
  beforeEach(async () => await TDD.setUp());
  afterEach(() => TDD.tearDown());

  it('renders only the first page slice on mount', async () => {
    expect(TDD.grid.page).to.equal(0);
    expect(TDD.grid.pageSize).to.equal(3);
    expect(TDD.grid.pageCount).to.equal(Math.ceil(data.length / 3));
    expect(TDD.grid.pageItems).lengthOf(3);
    expect(TDD.grid.totalItems).to.equal(data.length);
    expect(TDD.grid.rows).lengthOf(3);
    expect(TDD.grid.rows[0].data.id).to.equal(1);
    expect(TDD.grid.rows[2].data.id).to.equal(3);
  });

  it('exposes a built-in <apex-grid-paginator> when enabled', async () => {
    const paginator = TDD.grid.renderRoot.querySelector('apex-grid-paginator');
    expect(paginator).to.exist;
    expect(paginator!.shadowRoot!.querySelector('[part="paginator"]')).to.exist;
  });

  it('hides the paginator when pagination is disabled', async () => {
    await TDD.updateProperty('pagination', { enabled: false });
    expect(TDD.grid.renderRoot.querySelector('apex-grid-paginator')).to.be.null;
    expect(TDD.grid.pageItems).lengthOf(data.length);
  });

  it('gotoPage() emits cancellable pageChanging and pageChanged', async () => {
    const calls: string[] = [];
    TDD.grid.addEventListener('pageChanging', () => calls.push('changing'));
    TDD.grid.addEventListener('pageChanged', () => calls.push('changed'));

    const applied = await TDD.grid.gotoPage(1);
    await TDD.waitForUpdate();

    expect(applied).to.be.true;
    expect(calls).to.deep.equal(['changing', 'changed']);
    expect(TDD.grid.page).to.equal(1);
    expect(TDD.grid.rows.map((r) => r.data.id)).to.deep.equal([4, 5, 6]);
  });

  it('cancellation aborts the page change', async () => {
    TDD.grid.addEventListener('pageChanging', (event) => event.preventDefault());

    const applied = await TDD.grid.gotoPage(1);
    expect(applied).to.be.false;
    expect(TDD.grid.page).to.equal(0);
    expect(TDD.grid.rows[0].data.id).to.equal(1);
  });

  it('clamps gotoPage() into the valid range', async () => {
    await TDD.grid.gotoPage(999);
    await TDD.waitForUpdate();
    expect(TDD.grid.page).to.equal(TDD.grid.pageCount - 1);

    await TDD.grid.gotoPage(-5);
    await TDD.waitForUpdate();
    expect(TDD.grid.page).to.equal(0);
  });

  it('nextPage/previousPage/firstPage/lastPage navigate correctly', async () => {
    await TDD.grid.nextPage();
    await TDD.waitForUpdate();
    expect(TDD.grid.page).to.equal(1);

    await TDD.grid.lastPage();
    await TDD.waitForUpdate();
    expect(TDD.grid.page).to.equal(TDD.grid.pageCount - 1);

    await TDD.grid.previousPage();
    await TDD.waitForUpdate();
    expect(TDD.grid.page).to.equal(TDD.grid.pageCount - 2);

    await TDD.grid.firstPage();
    await TDD.waitForUpdate();
    expect(TDD.grid.page).to.equal(0);
  });

  it('setPageSize() resets the page and re-clamps when needed', async () => {
    await TDD.grid.gotoPage(2);
    await TDD.waitForUpdate();
    expect(TDD.grid.page).to.equal(2);

    const applied = await TDD.grid.setPageSize(5);
    await TDD.waitForUpdate();

    expect(applied).to.be.true;
    expect(TDD.grid.pageSize).to.equal(5);
    expect(TDD.grid.page).to.equal(0);
    expect(TDD.grid.pageItems).lengthOf(5);
  });

  it('totalItems and pageCount reflect filtered data, not raw data', async () => {
    await TDD.updateColumns({ key: 'importance', type: 'string' });
    await TDD.filter([{ key: 'importance', condition: 'equals', searchTerm: 'low' }]);

    const lowCount = data.filter((d) => d.importance === 'low').length;
    expect(TDD.grid.totalItems).to.equal(lowCount);
    expect(TDD.grid.pageCount).to.equal(Math.ceil(lowCount / TDD.grid.pageSize));
  });

  it('updating pagination property reflects in the controller state', async () => {
    await TDD.updateProperty('pagination', {
      enabled: true,
      pageSize: 5,
      page: 1,
    });
    expect(TDD.grid.pageSize).to.equal(5);
    expect(TDD.grid.page).to.equal(1);
    expect(TDD.grid.rows.map((r) => r.data.id)).to.deep.equal([6, 7, 8]);
  });

  it('emits ApexPageChangedEvent with the resolved pagination state', async () => {
    let payload: unknown;
    TDD.grid.addEventListener('pageChanged', (event) => {
      payload = event.detail;
    });
    await TDD.grid.gotoPage(1);
    await TDD.waitForUpdate();
    await aTimeout(0);

    expect(payload).to.deep.include({
      page: 1,
      pageSize: 3,
      pageCount: Math.ceil(data.length / 3),
      totalItems: data.length,
    });
  });
});

class RemotePaginationFixture<T extends TestData> extends GridTestFixture<T> {
  public override setupTemplate() {
    return html`<apex-grid
      .data=${this.data.slice(0, 3)}
      .columns=${this.columnConfig}
      .pagination=${
        {
          enabled: true,
          mode: 'remote',
          pageSize: 3,
          page: 0,
          totalItems: this.data.length,
        } as PaginationConfiguration
      }
    ></apex-grid>`;
  }
}

describe('Grid pagination — remote mode', () => {
  const remoteTDD = new RemotePaginationFixture(data);
  beforeEach(async () => await remoteTDD.setUp());
  afterEach(() => remoteTDD.tearDown());

  it('uses consumer-supplied totalItems for pageCount and does not slice', () => {
    expect(remoteTDD.grid.totalItems).to.equal(data.length);
    expect(remoteTDD.grid.pageCount).to.equal(Math.ceil(data.length / 3));
    expect(remoteTDD.grid.pageItems).lengthOf(3);
  });
});
