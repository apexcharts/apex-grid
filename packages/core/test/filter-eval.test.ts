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
import type { ColumnConfiguration } from '../src/internal/types.js';
import type { FilterExpression } from '../src/operations/filter/types.js';

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
