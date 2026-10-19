import { expect } from '@open-wc/testing';
import { PIPELINE } from '../src/internal/constants.js';
import type { ColumnConfiguration, Keys } from '../src/internal/types.js';
import type { SortExpression, SortState } from '../src/operations/sort/types.js';
import SortDataOperation from '../src/operations/sort.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { importanceComparer, type TestData } from './utils/test-data.js';

function runSort<T extends object>(rows: T[], ...expressions: Partial<SortExpression<T>>[]) {
  const state: SortState<T> = new Map();
  for (const expr of expressions) {
    state.set(
      expr.key as Keys<T>,
      {
        direction: 'ascending',
        caseSensitive: false,
        ...expr,
      } as SortExpression<T>
    );
  }
  return new SortDataOperation<T>().apply(rows.slice(), state);
}

type Sparse = { id: number; name: string | null | undefined; score: number | null | undefined };

const sparse: Sparse[] = [
  { id: 1, name: 'd', score: 5 },
  { id: 2, name: null, score: undefined },
  { id: 3, name: 'b', score: 3 },
  { id: 4, name: undefined, score: 9 },
  { id: 5, name: 'c', score: Number.NaN },
  { id: 6, name: 'a', score: 1 },
  { id: 7, name: null, score: 7 },
  { id: 8, name: 'e', score: 2 },
];

describe('Sort: empty values (core-sort-filter-controllers-1)', () => {
  it('sorts real strings and puts null and undefined last, ascending', () => {
    const result = runSort(sparse, { key: 'name' });
    expect(result.map((r) => r.name)).to.eql(['a', 'b', 'c', 'd', 'e', null, undefined, null]);
    // Empties keep their original relative order.
    expect(result.slice(5).map((r) => r.id)).to.eql([2, 4, 7]);
  });

  it('puts empties last in descending order too', () => {
    const result = runSort(sparse, { key: 'name', direction: 'descending' });
    expect(result.map((r) => r.name)).to.eql(['e', 'd', 'c', 'b', 'a', null, undefined, null]);
    expect(result.slice(5).map((r) => r.id)).to.eql([2, 4, 7]);
  });

  it('sorts numbers with NaN and undefined last in both directions', () => {
    expect(runSort(sparse, { key: 'score' }).map((r) => r.id)).to.eql([6, 8, 3, 1, 7, 4, 2, 5]);
    expect(runSort(sparse, { key: 'score', direction: 'descending' }).map((r) => r.id)).to.eql([
      4, 7, 1, 3, 8, 6, 2, 5,
    ]);
  });

  it('treats an invalid Date as empty', () => {
    const rows = [
      { id: 1, at: new Date(2024, 2, 1) },
      { id: 2, at: new Date('nope') },
      { id: 3, at: new Date(2023, 0, 1) },
    ];
    expect(runSort(rows, { key: 'at' }).map((r) => r.id)).to.eql([3, 1, 2]);
    expect(runSort(rows, { key: 'at', direction: 'descending' }).map((r) => r.id)).to.eql([
      1, 3, 2,
    ]);
  });

  it('falls through to the next expression on a tie between empties', () => {
    const result = runSort(sparse, { key: 'name' }, { key: 'id', direction: 'descending' });
    expect(result.slice(5).map((r) => r.id)).to.eql([7, 4, 2]);
  });

  it('sorts a sparse column through the grid API', async () => {
    const TDD = new GridTestFixture<Sparse>(sparse.map((r) => ({ ...r })));
    await TDD.setUp();
    try {
      TDD.grid.sort({ key: 'name', direction: 'ascending' });
      await TDD.waitForUpdate();
      expect(TDD.grid.dataView.map((r) => r.name)).to.eql([
        'a',
        'b',
        'c',
        'd',
        'e',
        null,
        undefined,
        null,
      ]);
    } finally {
      await TDD.tearDown();
    }
  });
});

type Ticket = { id: number; priority: string };
const ORDER = ['Low', 'Medium', 'High'];

describe('Sort: custom comparer gets raw values (core-types-2, core-sort-filter-controllers-2)', () => {
  const tickets: Ticket[] = [
    { id: 1, priority: 'High' },
    { id: 2, priority: 'Low' },
    { id: 3, priority: 'Medium' },
    { id: 4, priority: 'Low' },
  ];

  it('passes the cell values unchanged to the comparer', () => {
    const seen = new Set<string>();
    const comparer = (a: string, b: string) => {
      seen.add(a).add(b);
      return ORDER.indexOf(a) - ORDER.indexOf(b);
    };
    const result = runSort(tickets, { key: 'priority', comparer } as Partial<
      SortExpression<Ticket>
    >);
    expect(
      [...seen].every((v) => ORDER.includes(v)),
      `saw ${[...seen]}`
    ).to.be.true;
    expect(result.map((r) => r.id)).to.eql([2, 4, 3, 1]);
  });

  it('sorts by a column config comparer from the header', async () => {
    const TDD = new (class extends GridTestFixture<Ticket> {
      public override updateConfig() {
        this.columnConfig = [
          { key: 'id' },
          {
            key: 'priority',
            sort: { comparer: (a, b) => ORDER.indexOf(a) - ORDER.indexOf(b) },
          },
        ] as ColumnConfiguration<Ticket>[];
      }
    })(tickets.map((r) => ({ ...r })));
    await TDD.setUp();
    try {
      await TDD.sortHeader('priority');
      expect(TDD.grid.dataView.map((r) => r.priority)).to.eql(['Low', 'Low', 'Medium', 'High']);
      await TDD.sortHeader('priority');
      expect(TDD.grid.dataView.map((r) => r.priority)).to.eql(['High', 'Medium', 'Low', 'Low']);
    } finally {
      await TDD.tearDown();
    }
  });

  it('keeps the default string compare case insensitive', () => {
    const rows = [{ v: 'b' }, { v: 'B' }, { v: 'a' }, { v: 'A' }];
    expect(runSort(rows, { key: 'v' }).map((r) => r.v)).to.eql(['a', 'A', 'b', 'B']);
  });
});

describe('Sort: cost does not grow with comparisons', () => {
  it('case folds each string once per row, not once per comparison', () => {
    const n = 2000;
    const rows = Array.from({ length: n }, (_, i) => ({
      name: `Name ${(i * 7919) % n}`,
    }));
    const original = String.prototype.toLowerCase;
    let calls = 0;
    String.prototype.toLowerCase = function (this: string) {
      calls++;
      return original.call(this);
    };
    try {
      runSort(rows, { key: 'name' });
    } finally {
      String.prototype.toLowerCase = original;
    }
    expect(calls).to.be.at.most(n);
  });
});

class SortableFixture extends GridTestFixture<TestData> {
  public override updateConfig(): void {
    this.columnConfig = this.columnConfig.map((c) => ({ ...c, sort: true }));
  }
}

function headerEl(f: SortableFixture, key: keyof TestData) {
  return f.headerRow.headers.find(({ column }) => column.key === key)!;
}

async function menuSort(f: SortableFixture, key: keyof TestData, index: 0 | 1) {
  const h = headerEl(f, key);
  (h.shadowRoot!.querySelector('[part~="menu-btn"]') as HTMLElement).click();
  await h.updateComplete;
  const items = h.shadowRoot!.querySelectorAll('[part="col-menu-item"]');
  (items[index] as HTMLElement).click();
  await f.waitForUpdate();
}

describe('Sort: column menu matches a header click (core-header-2)', () => {
  let f: SortableFixture;
  beforeEach(async () => {
    f = new SortableFixture(data);
    await f.setUp();
  });
  afterEach(() => f.tearDown());

  it('replaces the existing sort', async () => {
    await f.sortHeader('name');
    await menuSort(f, 'importance', 1);
    expect(f.grid.sortExpressions.map((e) => [e.key, e.direction])).to.eql([
      ['importance', 'descending'],
    ]);
  });

  it('fires sorting and sorted', async () => {
    const events: string[] = [];
    f.grid.addEventListener('sorting', () => events.push('sorting'));
    f.grid.addEventListener('sorted', () => events.push('sorted'));
    await menuSort(f, 'importance', 0);
    expect(events).to.eql(['sorting', 'sorted']);
  });

  it('is cancelled by preventDefault on sorting', async () => {
    f.grid.addEventListener('sorting', (e) => e.preventDefault());
    await menuSort(f, 'importance', 0);
    expect(f.grid.sortExpressions.length).to.equal(0);
  });
});

describe('Sort: header click state (core-sort-filter-controllers-3, -4)', () => {
  let f: SortableFixture;
  beforeEach(async () => {
    f = new SortableFixture(data);
    await f.setUp();
  });
  afterEach(() => f.tearDown());

  it('a cancelled click leaves the stored direction untouched', async () => {
    await f.sortHeader('id');
    f.grid.addEventListener('sorting', (e) => e.preventDefault(), { once: true });
    await f.sortHeader('id');
    expect(f.grid.sortExpressions.map((e) => e.direction)).to.eql(['ascending']);

    f.grid.requestUpdate(PIPELINE);
    await f.waitForUpdate();
    expect(f.grid.dataView[0].id).to.equal(1);
  });

  it('a cancelled clear in tri-state mode keeps the sort', async () => {
    await f.updateProperty('sortConfiguration', { multiple: true, triState: true });
    await f.sortHeader('id');
    await f.sortHeader('id');
    f.grid.addEventListener('sorting', (e) => e.preventDefault(), { once: true });
    await f.sortHeader('id');
    expect(f.grid.sortExpressions.map((e) => e.direction)).to.eql(['descending']);
  });

  it('keeps a comparer supplied through grid.sort() across header clicks', async () => {
    f.grid.sort({ key: 'importance', direction: 'ascending', comparer: importanceComparer });
    await f.waitForUpdate();
    await f.sortHeader('importance');
    // A boolean assertion: a failing diff that holds a function stalls the runner.
    expect(f.grid.sortExpressions[0].comparer === importanceComparer, 'comparer kept').to.be.true;
    expect(f.grid.dataView.map((r) => r.importance)).to.eql([
      'high',
      'high',
      'medium',
      'medium',
      'medium',
      'low',
      'low',
      'low',
    ]);
  });
});
