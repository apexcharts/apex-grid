import { expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { type GroupingController, getGroupMeta } from '../src/features/grouping.js';
import { getPivotMeta, type PivotController } from '../src/features/pivot.js';
import { ApexGridEnterprise, enterpriseModules } from '../src/index.js';
import { settle } from './settle.js';

// A body row re-bound to another record (a recycled slot; this suite's second
// group recycles body rows) must show that record's group and pivot
// chevrons as they are, not rotate from the previous record's. Core marks
// such a row `data-rebound` for a frame and zeroes the motion tokens under it,
// and the chevrons' rotation reads those tokens, so it stays put. The
// scenario: a programmatic sort, a jump and a 5-row scroll step over groups
// that alternate open and shut.
// See plans/core/2026-10-27-row-recycling-plan.md, sections 4.3 and 10 (P3).

interface Row {
  region: string;
  product: string;
  quarter: string;
  amount: number;
}

/** 40 regions x 3 products x 2 quarters. */
function makeData(): Row[] {
  const rows: Row[] = [];
  for (let r = 0; r < 40; r++) {
    for (const product of ['A', 'B', 'C']) {
      for (const quarter of ['Q1', 'Q2']) {
        rows.push({
          region: `R${String(r).padStart(2, '0')}`,
          product,
          quarter,
          amount: (r * 37 + product.charCodeAt(0)) % 100,
        });
      }
    }
  }
  return rows;
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'region' },
  { key: 'product' },
  { key: 'quarter' },
  { key: 'amount', type: 'number' },
];

/** Long enough that a rotation a re-bind starts is still running when the test looks. */
const SLOW_MOTION = '--ag-dur-fast: 20s; --ag-dur-med: 20s; --ag-dur-slow: 20s;';

/** Whether this run recycles body rows, so a sort or a jump re-binds them in place. */
const rebinding = () => Boolean((globalThis as { __apexRowKeying?: string }).__apexRowKeying);

function modules(grid: ApexGridEnterprise<Row>) {
  return (grid as unknown as { stateController: { modules: Map<string, unknown> } }).stateController
    .modules;
}

/**
 * Every animation in the document and in every shadow root below it. A
 * root's `getAnimations()` covers only its own tree, so `document` alone
 * misses everything a row renders.
 */
function allAnimations(): Animation[] {
  const found: Animation[] = [];
  const visit = (root: Document | ShadowRoot) => {
    found.push(...root.getAnimations());
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  };
  visit(document);
  return found;
}

/** Every CSS transition still running, as `property on <tag or part>`. */
function runningTransitions(): string[] {
  return allAnimations()
    .filter((animation) => animation instanceof CSSTransition)
    .filter((animation) => animation.playState === 'running')
    .map((animation) => {
      const transition = animation as CSSTransition;
      const target = (transition.effect as KeyframeEffect | null)?.target as Element | null;
      const where = target?.getAttribute('part') ?? target?.localName ?? '?';
      return `${transition.transitionProperty} on ${where}`;
    });
}

function finishAll() {
  for (const animation of allAnimations()) animation.finish();
}

type RowElement = HTMLElement & { data: unknown };

function bodyRows(grid: ApexGridEnterprise<Row>): RowElement[] {
  const body = grid.renderRoot.querySelector('apex-virtualizer')!;
  return Array.from(body.querySelectorAll<RowElement>(':scope > apex-grid-row'));
}

/** How many rendered body rows show another record than before `step` ran. */
async function step(grid: ApexGridEnterprise<Row>, run: () => void) {
  finishAll();
  const before = new Map(bodyRows(grid).map((row) => [row, row.data]));
  run();
  await settle(grid);
  const rebound = bodyRows(grid).filter(
    (row) => before.has(row) && before.get(row) !== row.data
  ).length;
  return { rebound, running: runningTransitions() };
}

async function expectNoTransitionsAcrossRebinds(grid: ApexGridEnterprise<Row>) {
  const rowHeight = bodyRows(grid)[0].getBoundingClientRect().height;
  const sorted = await step(grid, () =>
    grid.sort({ key: 'region', direction: 'descending' } as never)
  );
  expect(sorted.running, 'after a sort').to.deep.equal([]);
  const jumped = await step(grid, () => {
    grid.scrollTop = 64 * rowHeight;
  });
  expect(jumped.running, 'after a jump').to.deep.equal([]);
  const stepped = await step(grid, () => {
    grid.scrollTop += 5 * rowHeight;
  });
  expect(stepped.running, 'after a 5-row scroll step').to.deep.equal([]);
  // The assertions above mean something only where rows did re-bind.
  if (rebinding()) {
    expect(sorted.rebound + jumped.rebound + stepped.rebound, 'nothing re-bound').to.be.greaterThan(
      0
    );
  }
}

async function mount(extra: Partial<ApexGridEnterprise<Row>>) {
  const host = document.createElement('div');
  host.style.height = '600px';
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise
      style=${SLOW_MOTION}
      .data=${makeData()}
      .columns=${columns}
      .groupBy=${extra.groupBy ?? []}
      .pivotOn=${extra.pivotOn}
      .pivotRows=${extra.pivotRows}
      .pivotValues=${extra.pivotValues}
      .pivotOptions=${extra.pivotOptions ?? {}}
    ></apex-grid-enterprise>`,
    { parentNode: host }
  );
  await settle(grid);
  return grid;
}

describe('Group and pivot chevrons on a row re-bind', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  it('grouped rows: a sort, a jump and a scroll step leave no chevron turning', async () => {
    const grid = await mount({ groupBy: ['region'] });
    const grouping = modules(grid).get('grouping') as GroupingController<Row>;
    // Every other group shut, so a slot moves between open and shut chevrons.
    const headers = (grid.pageItems as readonly Row[]).filter((row) => getGroupMeta(row));
    for (const [i, header] of headers.entries()) {
      if (i % 2 === 1) grouping.collapseGroup(getGroupMeta(header)!.key);
    }
    await settle(grid);

    await expectNoTransitionsAcrossRebinds(grid);
  });

  it('pivot rows: a sort, a jump and a scroll step leave no chevron turning', async () => {
    const grid = await mount({
      pivotOn: 'quarter',
      pivotRows: ['region', 'product'],
      pivotValues: { amount: ['sum'] },
      pivotOptions: { expandable: true },
    } as Partial<ApexGridEnterprise<Row>>);
    const pivot = modules(grid).get('pivot') as PivotController<Row>;
    // Every other region shut, so a slot moves between open and shut chevrons.
    const parents = (grid.pageItems as readonly Row[])
      .map((row) => getPivotMeta(row))
      .filter((meta) => meta?.expandable && meta.depth === 0);
    expect(parents.length, 'no expandable pivot rows').to.be.greaterThan(10);
    for (const [i, meta] of parents.entries()) {
      if (i % 2 === 1) pivot.toggleExpand(meta!.key ?? '');
    }
    await settle(grid);

    await expectNoTransitionsAcrossRebinds(grid);
  });
});
