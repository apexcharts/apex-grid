import {
  aTimeout,
  elementUpdated,
  expect,
  fixture,
  fixtureCleanup,
  html,
  nextFrame,
} from '@open-wc/testing';
import { ApexGrid } from '../src/components/grid.js';
import type { ColumnConfiguration, DataType } from '../src/internal/types.js';
import type { FilterExpression } from '../src/operations/filter/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

// B10 (filter evaluation): string operands on non-string cells, numeric column
// types, OR criteria per column, null in numeric ranges, caseSensitive
// inheritance, no-op removals and the scroll reset on filtering.

type Loose = Record<string, unknown> & { id: number };

ApexGrid.register();

async function mount<T extends object>(
  rows: T[],
  columns: ColumnConfiguration<T>[],
  height = '600px'
): Promise<ApexGrid<T>> {
  const parentNode = document.createElement('div');
  parentNode.style.height = height;
  const grid = await fixture<ApexGrid<T>>(
    html`<apex-grid .data=${rows} .columns=${columns}></apex-grid>`,
    { parentNode }
  );
  await settle(grid);
  return grid;
}

async function settle(grid: ApexGrid<any>) {
  await elementUpdated(grid);
  await nextFrame();
  await nextFrame();
}

/** Collects window errors and unhandled rejections raised while `run` executes. */
async function collectErrors(run: () => Promise<void>): Promise<string[]> {
  const errors: string[] = [];
  const onError = (e: ErrorEvent) => {
    if (String(e.message).includes('ResizeObserver')) return;
    errors.push(String(e.message));
    e.preventDefault();
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    errors.push(String(e.reason?.message ?? e.reason));
    e.preventDefault();
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  try {
    await run();
    await aTimeout(20);
  } finally {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  }
  return errors;
}

const ids = (grid: ApexGrid<any>) => grid.dataView.map((row) => row.id);

describe('filter evaluation (B10)', () => {
  afterEach(() => fixtureCleanup());

  describe('string operands on non-string cell values', () => {
    const rows: Loose[] = [
      { id: 1, name: 'abc', created: new Date(2024, 0, 15) },
      { id: 2, name: null, created: null },
      { id: 3, name: 'xyz', created: undefined },
      { id: 4, name: 'bob', created: new Date(2023, 5, 1) },
      { id: 5, name: undefined, created: new Date(2022, 1, 2) },
    ];
    const columns: ColumnConfiguration<Loose>[] = [
      { key: 'id', filter: true },
      { key: 'name', filter: true },
      { key: 'created', type: 'date', filter: true },
    ];

    it('contains over null / undefined cells narrows without throwing', async () => {
      const grid = await mount(rows, columns);
      const errors = await collectErrors(async () => {
        grid.filter({ key: 'name', condition: 'contains', searchTerm: 'b' } as any);
        await settle(grid);
      });
      expect(errors).to.deep.equal([]);
      expect(ids(grid)).to.deep.equal([1, 4]);
    });

    it('treats null / undefined as empty text for every binary string operand', async () => {
      const grid = await mount(rows, columns);
      const cases: Array<[string, unknown, number[]]> = [
        ['doesNotContain', 'b', [2, 3, 5]],
        ['startsWith', 'x', [3]],
        ['endsWith', 'c', [1]],
        ['equals', 'bob', [4]],
        ['doesNotEqual', 'bob', [1, 2, 3, 5]],
        ['empty', undefined, [2, 5]],
        ['notEmpty', undefined, [1, 3, 4]],
      ];
      for (const [condition, searchTerm, expected] of cases) {
        const errors = await collectErrors(async () => {
          grid.filterExpressions = [{ key: 'name', condition, searchTerm } as any];
          await settle(grid);
        });
        expect(errors, condition).to.deep.equal([]);
        expect(ids(grid), condition).to.deep.equal(expected);
      }
    });

    it('matches an untyped numeric column by its text', async () => {
      const grid = await mount(rows, columns);
      const errors = await collectErrors(async () => {
        grid.filter({ key: 'id', condition: 'contains', searchTerm: '5' } as any);
        await settle(grid);
      });
      expect(errors).to.deep.equal([]);
      expect(ids(grid)).to.deep.equal([5]);
    });

    it('a date column holding Date objects filters without throwing', async () => {
      const grid = await mount(rows, columns);
      const errors = await collectErrors(async () => {
        grid.filter({ key: 'created', condition: 'contains', searchTerm: '2024' } as any);
        await settle(grid);
      });
      expect(errors).to.deep.equal([]);
      expect(ids(grid)).to.deep.equal([1]);
    });

    it('notEmpty on a numeric value in a string column keeps the row', async () => {
      const grid = await mount(rows, columns);
      grid.filter({ key: 'id', condition: 'notEmpty' } as any);
      await settle(grid);
      expect(ids(grid)).to.deep.equal([1, 2, 3, 4, 5]);
    });
  });

  describe('numeric column types', () => {
    type Product = { id: number; price: number | null; stars: number; done: number };
    const rows: Product[] = [
      { id: 1, price: 10, stars: 1, done: 15 },
      { id: 2, price: 20, stars: 3, done: 50 },
      { id: 3, price: 42, stars: 5, done: 95 },
    ];
    const columns: ColumnConfiguration<Product>[] = [
      { key: 'id', type: 'number' },
      { key: 'price', type: 'currency', filter: true },
      { key: 'stars', type: 'rating', filter: true },
      { key: 'done', type: 'progress', filter: true },
    ];

    it('one rule classifies the numeric types, exposed on the state controller', async () => {
      const grid = await mount(rows, columns);
      const state = (grid as any).stateController;
      const numeric: DataType[] = ['number', 'currency', 'rating', 'progress'];
      const other: Array<DataType | undefined> = [
        undefined,
        'string',
        'boolean',
        'date',
        'select',
        'sparkline',
      ];
      for (const type of numeric)
        expect(state.isNumericColumn({ key: 'x', type }), type).to.be.true;
      for (const type of other) expect(state.isNumericColumn({ key: 'x', type }), type).to.be.false;
    });

    it('notEmpty on a currency column keeps every row with a number', async () => {
      const grid = await mount(rows, columns);
      grid.filter({ key: 'price', condition: 'notEmpty' } as any);
      await settle(grid);
      expect(ids(grid)).to.deep.equal([1, 2, 3]);
    });

    it('greaterThan on currency, rating and progress columns filters numerically', async () => {
      const grid = await mount(rows, columns);
      for (const [key, term] of [
        ['price', 15],
        ['stars', 2],
        ['done', 20],
      ] as const) {
        grid.filterExpressions = [{ key, condition: 'greaterThan', searchTerm: term } as any];
        await settle(grid);
        expect(ids(grid), key).to.deep.equal([2, 3]);
      }
    });

    it('getSchema advertises the number operands for the numeric types', async () => {
      const grid = await mount(rows, columns);
      const byKey = Object.fromEntries(grid.getSchema().columns.map((c) => [c.key, c]));
      for (const key of ['price', 'stars', 'done']) {
        expect(byKey[key].filterOperands, key).to.include('greaterThan');
        expect(byKey[key].filterOperands, key).to.not.include('contains');
      }
    });

    for (const type of ['currency', 'rating', 'progress'] as const) {
      it(`typing a number into the ${type} panel narrows rows`, async () => {
        const fx = new GridTestFixture<TestData>(data);
        fx.updateConfig = function () {
          this.columnConfig = this.columnConfig.map((config) =>
            config.key === 'id'
              ? ({ ...config, type, filter: true } as ColumnConfiguration<TestData>)
              : { ...config, filter: true }
          );
        };
        await fx.setUp();
        try {
          const errors = await collectErrors(async () => {
            fx.filterRow.open('id');
            await fx.waitForUpdate();
            fx.filterRow.fireInputEvent('5');
            await fx.waitForUpdate();
          });
          expect(errors).to.deep.equal([]);
          expect(fx.grid.totalItems).to.equal(1);
        } finally {
          fx.tearDown();
        }
      });
    }
  });

  describe('OR criteria per column', () => {
    const columns: ColumnConfiguration<TestData>[] = [
      { key: 'id', type: 'number', filter: true },
      { key: 'name', filter: true },
      { key: 'active', type: 'boolean' },
      { key: 'importance', filter: true },
    ];

    it('(importance high OR low) AND (id 99 OR id 2) keeps id 2', async () => {
      const grid = await mount(data, columns);
      grid.filter([
        { key: 'importance', condition: 'equals', searchTerm: 'high' },
        { key: 'importance', condition: 'equals', searchTerm: 'low', criteria: 'or' },
        { key: 'id', condition: 'equals', searchTerm: 99 },
        { key: 'id', condition: 'equals', searchTerm: 2, criteria: 'or' },
      ] as any);
      await settle(grid);
      expect(ids(grid)).to.deep.equal([2]);
    });

    it('a column left with a single OR expression still filters', async () => {
      const grid = await mount(data, columns);
      grid.filter([
        { key: 'id', condition: 'equals', searchTerm: 1 },
        { key: 'id', condition: 'equals', searchTerm: 3, criteria: 'or' },
      ] as any);
      await settle(grid);
      expect(ids(grid)).to.deep.equal([1, 3]);

      const first = grid.filterExpressions.find((e) => e.searchTerm === 1)!;
      await (grid as any).stateController.filtering.removeExpression(first);
      await settle(grid);
      expect(grid.filterExpressions.length).to.equal(1);
      expect(ids(grid)).to.deep.equal([3]);
    });

    it('keeps the single-column (A and B) or C grouping', async () => {
      const grid = await mount(data, columns);
      grid.filter([
        { key: 'id', condition: 'greaterThan', searchTerm: 2 },
        { key: 'id', condition: 'lessThan', searchTerm: 5 },
        { key: 'id', condition: 'equals', searchTerm: 8, criteria: 'or' },
        { key: 'importance', condition: 'doesNotEqual', searchTerm: 'low' },
      ] as any);
      await settle(grid);
      expect(ids(grid)).to.deep.equal([3, 8]);
    });
  });

  describe('null in numeric range filters', () => {
    type Score = { id: number; score: number | null | undefined };
    const rows: Score[] = [
      { id: 1, score: 10 },
      { id: 2, score: null },
      { id: 3, score: 30 },
      { id: 4, score: undefined },
      { id: 5, score: 0 },
      { id: 6, score: '' as unknown as number },
      { id: 7, score: '  ' as unknown as number },
    ];
    const columns: ColumnConfiguration<Score>[] = [
      { key: 'id', type: 'number' },
      { key: 'score', type: 'number', filter: true },
    ];

    it('null, undefined and blank text never match a range operand', async () => {
      const grid = await mount(rows, columns);
      const cases: Array<[string, number, number[]]> = [
        ['lessThan', 20, [1, 5]],
        ['lessThanOrEqual', 0, [5]],
        ['greaterThanOrEqual', 0, [1, 3, 5]],
        ['greaterThan', -1, [1, 3, 5]],
        ['equals', 0, [5]],
      ];
      for (const [condition, searchTerm, expected] of cases) {
        grid.filterExpressions = [{ key: 'score', condition, searchTerm } as any];
        await settle(grid);
        expect(ids(grid), condition).to.deep.equal(expected);
      }
    });

    it('Empty matches null, undefined and blank text, Not empty the rest', async () => {
      const grid = await mount(rows, columns);
      grid.filterExpressions = [{ key: 'score', condition: 'empty' } as any];
      await settle(grid);
      expect(ids(grid)).to.deep.equal([2, 4, 6, 7]);
      grid.filterExpressions = [{ key: 'score', condition: 'notEmpty' } as any];
      await settle(grid);
      expect(ids(grid)).to.deep.equal([1, 3, 5]);
    });
  });

  describe('operand typings', () => {
    it('a Date field accepts the string operand names, not a Date', () => {
      type Dated = { created: Date };
      const ok: FilterExpression<Dated> = { key: 'created', condition: 'contains' };
      // @ts-expect-error a Date value is not an operand name
      const bad: FilterExpression<Dated> = { key: 'created', condition: new Date() };
      expect([ok, bad].length).to.equal(2);
    });

    it('a nullable or optional field keeps the operand names of its type', () => {
      type Priced = { price: number | null; qty?: number; flag: boolean | null };
      const ok: FilterExpression<Priced>[] = [
        { key: 'price', condition: 'greaterThan' },
        { key: 'qty', condition: 'lessThan' },
        { key: 'flag', condition: 'true' },
      ];
      // @ts-expect-error a nullable number takes no text operand
      const price: FilterExpression<Priced> = { key: 'price', condition: 'contains' };
      // @ts-expect-error an optional number takes no text operand
      const qty: FilterExpression<Priced> = { key: 'qty', condition: 'startsWith' };
      // @ts-expect-error a nullable boolean takes no text operand
      const flag: FilterExpression<Priced> = { key: 'flag', condition: 'contains' };
      expect([...ok, price, qty, flag].length).to.equal(6);
    });

    it('an unknown field keeps every operand name', () => {
      type Loose = Record<string, unknown>;
      type Mixed = { price: unknown; name: string };
      const loose: FilterExpression<Loose>[] = [
        { key: 'price', condition: 'greaterThan', searchTerm: 5 },
        { key: 'active', condition: 'true' },
        { key: 'name', condition: 'contains', searchTerm: 'a' },
      ];
      const mixed: FilterExpression<Mixed>[] = [
        { key: 'price', condition: 'greaterThan', searchTerm: 5 },
        { key: 'price', condition: 'false' },
        { key: 'price', condition: 'startsWith', searchTerm: '1' },
      ];
      // @ts-expect-error a string field still takes no number operand
      const name: FilterExpression<Mixed> = { key: 'name', condition: 'greaterThan' };
      expect([...loose, ...mixed, name].length).to.equal(7);
    });
  });
});
