import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import { ApexGrid } from '../src/components/grid.js';
import { PIPELINE } from '../src/internal/constants.js';
import type {
  ColumnConfiguration,
  DataPipelineConfiguration,
  GridTreeConfiguration,
} from '../src/internal/types.js';
import type { FilterExpression } from '../src/operations/filter/types.js';
import type { SortExpression } from '../src/operations/sort/types.js';

ApexGrid.register();

interface Row {
  id: number;
  name: string;
}

const rows = (count = 12): Row[] =>
  Array.from({ length: count }, (_, id) => ({ id, name: id < 3 ? `x${id}` : `y${id}` }));

const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number', sort: true },
  { key: 'name', sort: true, filter: true },
];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A promise resolved from outside, to control the order async hooks settle in. */
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

async function mount(
  props: Partial<Pick<ApexGrid<Row>, 'pagination' | 'dataPipelineConfiguration' | 'tree'>> & {
    data?: Row[];
  } = {}
): Promise<ApexGrid<Row>> {
  const parentNode = document.createElement('div');
  parentNode.style.height = '500px';
  const grid = await fixture<ApexGrid<Row>>(
    html`<apex-grid
      .data=${props.data ?? rows()}
      .columns=${columns}
      .pagination=${props.pagination}
      .tree=${props.tree}
      .dataPipelineConfiguration=${props.dataPipelineConfiguration}
    ></apex-grid>`,
    { parentNode }
  );
  await grid.updateComplete;
  await nextFrame();
  return grid;
}

const ids = (grid: ApexGrid<Row>) => grid.dataView.map((row) => row.id);

/** Wait for the hooks and the render that follows them. */
async function settle(grid: ApexGrid<Row>, ms = 0) {
  await delay(ms);
  await grid.updateComplete;
  await nextFrame();
  await grid.updateComplete;
}

describe('Data pipeline orchestration', () => {
  afterEach(() => fixtureCleanup());

  describe('stale async runs', () => {
    it('keeps the latest quick filter when an older async run resolves last', async () => {
      const slow = gate();
      const pipeline: DataPipelineConfiguration<Row> = {
        quickFilter: async ({ data, grid }) => {
          const term = grid.quickFilter;
          if (term === 'x') await slow.promise;
          return term ? data.filter((row) => row.name.includes(term)) : data;
        },
      };
      const grid = await mount({ dataPipelineConfiguration: pipeline });

      grid.quickFilter = 'x';
      await grid.updateComplete;
      grid.quickFilter = 'y1';
      await settle(grid);
      expect(ids(grid)).to.eql([10, 11]);

      slow.open();
      await settle(grid, 10);
      expect(grid.quickFilter).to.equal('y1');
      expect(ids(grid), 'the dropped run must not overwrite the view').to.eql([10, 11]);
    });

    it('does not reclamp the page from a dropped run', async () => {
      const slow = gate();
      const pipeline: DataPipelineConfiguration<Row> = {
        quickFilter: async ({ data, grid }) => {
          const term = grid.quickFilter;
          if (term === 'x') {
            await slow.promise;
            return data.filter((row) => row.name.startsWith('x'));
          }
          return data;
        },
      };
      const grid = await mount({
        dataPipelineConfiguration: pipeline,
        pagination: { enabled: true, pageSize: 2 },
      });

      grid.quickFilter = 'x';
      await grid.updateComplete;
      grid.quickFilter = '';
      await settle(grid);
      await grid.gotoPage(4);
      expect(grid.page).to.equal(4);

      // The dropped run holds 3 rows (2 pages): applying it would clamp to 1.
      slow.open();
      await settle(grid, 10);
      expect(grid.page).to.equal(4);
      expect(grid.totalItems).to.equal(12);
    });

    it('settles the page once the latest run settles past a hung superseded one', async () => {
      const pipeline: DataPipelineConfiguration<Row> = {
        quickFilter: ({ data, grid }) =>
          grid.quickFilter === 'x' ? new Promise<Row[]>(() => {}) : data,
      };
      const grid = await mount({
        dataPipelineConfiguration: pipeline,
        pagination: { enabled: true, pageSize: 2 },
      });
      grid.quickFilter = 'x';
      await grid.updateComplete;
      grid.quickFilter = '';
      await settle(grid);
      const pages: number[] = [];
      grid.addEventListener('pageChanged', (event) => pages.push(event.detail.page));
      grid.page = 2;
      await settle(grid);
      expect(grid.page).to.equal(2);
      expect(pages, 'the page setter still treated the view as stale').to.eql([2]);
    });
  });

  describe('one run per update', () => {
    let runs = 0;
    const counting: DataPipelineConfiguration<Row> = {
      quickFilter: ({ data, grid }) => {
        runs++;
        const term = grid.quickFilter;
        return term ? data.filter((row) => row.name.includes(term)) : data;
      },
    };

    async function countedMount(extra: Parameters<typeof mount>[0] = {}) {
      const grid = await mount({ dataPipelineConfiguration: counting, ...extra });
      await settle(grid);
      runs = 0;
      return grid;
    }

    it('runs once for setState with a quick filter and a sort', async () => {
      const grid = await countedMount();
      grid.setState({ quickFilter: 'y', sort: [{ key: 'id', direction: 'descending' }] });
      await settle(grid);
      expect(runs).to.equal(1);
      expect(ids(grid)[0]).to.equal(11);
    });

    it('runs once for a data swap and a sort in the same tick', async () => {
      const grid = await countedMount();
      grid.data = rows(6);
      grid.sort({ key: 'id', direction: 'descending' } as SortExpression<Row>);
      await settle(grid);
      expect(runs).to.equal(1);
      expect(ids(grid)).to.eql([5, 4, 3, 2, 1, 0]);
    });

    it('runs once for a pagination reassignment and a pipeline request', async () => {
      const grid = await countedMount({ pagination: { enabled: true, pageSize: 4 } });
      grid.pagination = { enabled: true, pageSize: 3 };
      grid.quickFilter = 'y';
      grid.requestUpdate(PIPELINE);
      await settle(grid);
      expect(runs).to.equal(1);
      expect(grid.pageCount).to.equal(3);
    });
  });

  describe('events after the run they caused', () => {
    it('fires quickFilterChanged after an async quick filter hook resolved', async () => {
      const hook = gate();
      const pipeline: DataPipelineConfiguration<Row> = {
        quickFilter: async ({ data, grid }) => {
          if (!grid.quickFilter) return data;
          await hook.promise;
          return data.filter((row) => row.name.includes(grid.quickFilter));
        },
      };
      const grid = await mount({ dataPipelineConfiguration: pipeline });
      let seen = -1;
      grid.addEventListener('quickFilterChanged', () => {
        seen = grid.totalItems;
      });
      const done = grid.setQuickFilter('x');
      await delay(20);
      expect(seen, 'fired before the hook resolved').to.equal(-1);
      hook.open();
      expect(await done).to.be.true;
      expect(seen).to.equal(3);
    });

    it('fires sorted after an async sort hook resolved', async () => {
      const pipeline: DataPipelineConfiguration<Row> = {
        sort: async ({ data, grid }) => {
          await delay(30);
          const [expression] = grid.sortExpressions;
          if (!expression || expression.direction === 'none') return data;
          return [...data].sort((a, b) =>
            expression.direction === 'descending' ? b.id - a.id : a.id - b.id
          );
        },
      };
      const grid = await mount({ dataPipelineConfiguration: pipeline });
      const firstAtSorted = new Promise<number>((resolve) => {
        grid.addEventListener('sorted', () => resolve(grid.dataView[0].id), { once: true });
      });
      // @ts-expect-error - protected member access
      const sorting = grid.stateController.sorting;
      void sorting.sortFromUI(grid.getColumn('id')!, { direction: 'descending' });
      expect(await firstAtSorted).to.equal(11);
    });

    it('fires filtered after an async filter hook resolved', async () => {
      const pipeline: DataPipelineConfiguration<Row> = {
        filter: async ({ data, grid }) => {
          await delay(30);
          return grid.filterExpressions.length ? data.filter((row) => row.id < 2) : data;
        },
      };
      const grid = await mount({ dataPipelineConfiguration: pipeline });
      let seen = -1;
      grid.addEventListener('filtered', () => {
        seen = grid.totalItems;
      });
      // @ts-expect-error - protected member access
      const filtering = grid.stateController.filtering;
      const expression = {
        key: 'name',
        condition: 'contains',
        searchTerm: 'x',
      } as unknown as FilterExpression<Row>;
      await filtering.filterWithEvent(expression, 'add');
      expect(seen).to.equal(2);
    });

    it('settles an earlier setQuickFilter when its superseded hook never settles', async () => {
      const pipeline: DataPipelineConfiguration<Row> = {
        quickFilter: ({ data, grid }) => {
          const term = grid.quickFilter;
          if (term === 'x') return new Promise<Row[]>(() => {});
          return term ? data.filter((row) => row.name.includes(term)) : data;
        },
      };
      const grid = await mount({ dataPipelineConfiguration: pipeline });
      const fired: string[] = [];
      grid.addEventListener('quickFilterChanged', (event) => fired.push(event.detail.value));
      const first = grid.setQuickFilter('x');
      await delay(5);
      const second = grid.setQuickFilter('x1');
      const results = await Promise.race([
        Promise.all([first, second]),
        delay(500).then(() => 'timed out'),
      ]);
      expect(results).to.eql([true, true]);
      expect(fired).to.eql(['x1', 'x1']);
      expect(ids(grid)).to.eql([1]);
    });

    it('fires sorted for an earlier sort when its superseded hook never settles', async () => {
      let calls = 0;
      const pipeline: DataPipelineConfiguration<Row> = {
        sort: ({ data }) => {
          calls++;
          if (calls === 1) return new Promise<Row[]>(() => {});
          return [...data].reverse();
        },
      };
      const grid = await mount({ dataPipelineConfiguration: pipeline });
      calls = 0;
      let sorted = 0;
      grid.addEventListener('sorted', () => sorted++);
      // @ts-expect-error - protected member access
      const sorting = grid.stateController.sorting;
      const first = sorting.sortFromUI(grid.getColumn('id')!, { direction: 'descending' });
      await delay(5);
      const second = sorting.sortFromUI(grid.getColumn('name')!, { direction: 'ascending' });
      const settled = await Promise.race([
        Promise.all([first, second]).then(() => 'settled'),
        delay(500).then(() => 'timed out'),
      ]);
      expect(settled).to.equal('settled');
      expect(sorted).to.equal(2);
    });

    it('does not hold an earlier caller until a slow superseded run settles', async () => {
      const pipeline: DataPipelineConfiguration<Row> = {
        quickFilter: async ({ data, grid }) => {
          const term = grid.quickFilter;
          await delay(term === 'x' ? 300 : 10);
          return term ? data.filter((row) => row.name.includes(term)) : data;
        },
      };
      const grid = await mount({ dataPipelineConfiguration: pipeline });
      const start = performance.now();
      const first = grid.setQuickFilter('x').then(() => performance.now() - start);
      await delay(5);
      await grid.setQuickFilter('x1');
      expect(await first, 'waited for the superseded run').to.be.below(200);
      expect(ids(grid)).to.eql([1]);
    });

    it('fires pageChanged after an async remote page hook resolved', async () => {
      const pipeline: DataPipelineConfiguration<Row> = {
        sort: async ({ data, grid }) => {
          await delay(30);
          const start = grid.page * grid.pageSize;
          return data.slice(start, start + grid.pageSize);
        },
      };
      const grid = await mount({
        dataPipelineConfiguration: pipeline,
        pagination: { enabled: true, mode: 'remote', pageSize: 4, totalItems: 12 },
      });
      await settle(grid, 40);
      let first = -1;
      grid.addEventListener('pageChanged', () => {
        first = grid.dataView[0].id;
      });
      expect(await grid.gotoPage(1)).to.be.true;
      expect(first).to.equal(4);
    });
  });

  describe('setQuickFilter', () => {
    it('keeps a value a quickFilterChanging listener substitutes', async () => {
      const grid = await mount();
      grid.addEventListener('quickFilterChanging', (event) => {
        grid.quickFilter = event.detail.nextValue.trim();
      });
      let reported: string | undefined;
      grid.addEventListener('quickFilterChanged', (event) => {
        reported = event.detail.value;
      });
      expect(await grid.setQuickFilter('  x1  ')).to.be.true;
      expect(grid.quickFilter).to.equal('x1');
      expect(reported).to.equal('x1');
      expect(ids(grid)).to.eql([1]);
    });

    it('treats a substitute equal to the current value as a no-op', async () => {
      const grid = await mount({ pagination: { enabled: true, pageSize: 1 } });
      await grid.setQuickFilter('x');
      await grid.gotoPage(2);
      grid.addEventListener('quickFilterChanging', (event) => {
        grid.quickFilter = event.detail.nextValue.trim();
      });
      const events: string[] = [];
      grid.addEventListener('pageChanged', () => events.push('pageChanged'));
      grid.addEventListener('quickFilterChanged', () => events.push('quickFilterChanged'));
      expect(await grid.setQuickFilter('x ')).to.be.false;
      expect(grid.quickFilter).to.equal('x');
      expect(grid.page).to.equal(2);
      expect(events).to.eql([]);
    });

    it('fires pageChanged and announces when it moves to the first page', async () => {
      const grid = await mount({ pagination: { enabled: true, pageSize: 2 } });
      await grid.gotoPage(3);
      const events: string[] = [];
      grid.addEventListener('pageChanging', () => events.push('pageChanging'));
      grid.addEventListener('pageChanged', (event) =>
        events.push(`pageChanged:${event.detail.page}`)
      );
      grid.addEventListener('quickFilterChanged', () => events.push('quickFilterChanged'));
      await grid.setQuickFilter('y');
      expect(grid.page).to.equal(0);
      expect(events).to.eql(['pageChanged:0', 'quickFilterChanged']);
      await settle(grid);
      const region = grid.renderRoot.querySelector('[part="live-region"]');
      expect(region?.textContent?.replace('\u200B', '').trim()).to.equal(
        `Page 1 of ${grid.pageCount}`
      );
    });

    it('stays silent about the page when it is already on the first page', async () => {
      const grid = await mount({ pagination: { enabled: true, pageSize: 2 } });
      const events: string[] = [];
      grid.addEventListener('pageChanged', () => events.push('pageChanged'));
      await grid.setQuickFilter('y');
      expect(events).to.eql([]);
    });

    it('keeps the quickFilter property path silent about the page', async () => {
      const grid = await mount({ pagination: { enabled: true, pageSize: 2 } });
      await grid.gotoPage(1);
      const events: string[] = [];
      grid.addEventListener('pageChanged', () => events.push('pageChanged'));
      grid.quickFilter = 'x';
      await settle(grid);
      expect(events).to.eql([]);
    });
  });

  describe('tree changes after the first render', () => {
    interface Node extends Row {
      path: string[];
    }
    const org = (): Node[] => [
      { id: 0, name: 'Adrian', path: ['Adrian'] },
      { id: 1, name: 'Bryan', path: ['Adrian', 'Bryan'] },
      { id: 2, name: 'Chris', path: ['Adrian', 'Bryan', 'Chris'] },
      { id: 3, name: 'Cheryl', path: ['Cheryl'] },
    ];
    const tree: GridTreeConfiguration<Row> = {
      enabled: true,
      getDataPath: (row) => (row as Node).path,
    };

    it('reshapes the rows when tree mode is enabled', async () => {
      const grid = await mount({ data: org() });
      expect(grid.pageItems.length).to.equal(4);
      grid.tree = tree;
      await settle(grid);
      expect(grid.pageItems.map((row) => row.name)).to.eql(['Adrian', 'Cheryl']);
    });

    it('shows every row again when tree mode is disabled', async () => {
      const grid = await mount({ data: org(), tree });
      expect(grid.pageItems.length).to.equal(2);
      grid.tree = { ...tree, enabled: false };
      await settle(grid);
      expect(grid.pageItems.length).to.equal(4);
    });
  });

  describe('nullish data', () => {
    let rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent) => {
      rejections.push(event.reason);
      event.preventDefault();
    };
    beforeEach(() => {
      rejections = [];
      window.addEventListener('unhandledrejection', onRejection);
    });
    afterEach(() => window.removeEventListener('unhandledrejection', onRejection));

    for (const empty of [undefined, null]) {
      it(`treats data set to ${empty} as an empty array`, async () => {
        const grid = await mount();
        expect(grid.totalItems).to.equal(12);
        grid.data = empty as unknown as Row[];
        await settle(grid, 10);
        expect(rejections).to.eql([]);
        expect(grid.data).to.eql([]);
        expect(grid.totalItems).to.equal(0);
        expect(grid.rows.length).to.equal(0);
        expect(() => grid.getState()).not.to.throw();
        grid.data = rows(3);
        await settle(grid);
        expect(grid.totalItems).to.equal(3);
      });
    }

    it('keeps the same empty array for a repeated nullish value', async () => {
      const grid = await mount();
      grid.data = undefined as unknown as Row[];
      const empty = grid.data;
      await settle(grid);
      grid.data = undefined as unknown as Row[];
      grid.data = null as unknown as Row[];
      expect(grid.data).to.equal(empty);
      expect(grid.isUpdatePending, 'a repeated nullish value requested an update').to.be.false;
    });
  });

  describe('moveColumn', () => {
    it('does not emit columnMoving for a move that changes nothing', async () => {
      const grid = await mount();
      const events: string[] = [];
      grid.addEventListener('columnMoving', () => events.push('columnMoving'));
      grid.addEventListener('columnMoved', () => events.push('columnMoved'));
      expect(await grid.moveColumn('id', 'name', 'before')).to.be.false;
      expect(events).to.eql([]);
      expect(await grid.moveColumn('id', 'name', 'after')).to.be.true;
      expect(events).to.eql(['columnMoving', 'columnMoved']);
    });
  });
});
