import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  ApexGridEnterprise,
  enterpriseModules,
  type RangeChangedDetail,
  type RowsLoadedDetail,
} from '../src/index.js';
import { settle } from './settle.js';

// The assertions here are partly compile-time: CI runs `tsc --noEmit` over the
// test suite (`npm run typecheck`), which rejects these listeners unless the
// enterprise grid types its own events on addEventListener.

type Row = { region: string; amount: number };
const data: Row[] = [
  { region: 'EMEA', amount: 10 },
  { region: 'AMER', amount: 20 },
  { region: 'APAC', amount: 30 },
];
const columns: ColumnConfiguration<Row>[] = [
  { key: 'region', type: 'string' },
  { key: 'amount', type: 'number' },
];

async function mount() {
  const parent = document.createElement('div');
  parent.style.height = '400px';
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`,
    { parentNode: parent }
  );
  await settle(grid);
  return grid;
}

describe('enterprise event types (CI typecheck)', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  it('types apex-range-changed listeners with their detail', async () => {
    const grid = await mount();
    const seen: RangeChangedDetail[] = [];
    const onRange = (event: CustomEvent<RangeChangedDetail>) => seen.push(event.detail);
    grid.addEventListener('apex-range-changed', onRange);

    grid.selectRange({ row: 0, column: 'amount' }, { row: 1, column: 'amount' });
    expect(seen.length).to.be.greaterThan(0);
    expect(seen.at(-1)?.stats.sum).to.equal(30);

    const count = seen.length;
    grid.removeEventListener('apex-range-changed', onRange);
    grid.selectRange({ row: 2, column: 'amount' });
    expect(seen.length).to.equal(count);
  });

  it('types apex-view-changed and still types the core events', async () => {
    const grid = await mount();
    let viewDetail: null | undefined;
    grid.addEventListener('apex-view-changed', (event) => {
      viewDetail = event.detail;
    });
    // Compile-time only: a core event keeps its typed detail on the
    // enterprise grid. Whether a given sort fires it is not under test here.
    const sortedKeys: (keyof Row)[] = [];
    grid.addEventListener('sorted', (event) => {
      sortedKeys.push(event.detail.key);
    });

    grid.sort({ key: 'amount', direction: 'descending' });
    await grid.updateComplete;
    await nextFrame();
    expect(viewDetail).to.equal(null);
  });

  it('rejects event names neither map knows', async () => {
    const grid = await mount();
    const rowsLoaded = (event: CustomEvent<RowsLoadedDetail>) => event.detail.rowCount;
    grid.addEventListener('apex-rows-loaded', rowsLoaded);
    grid.removeEventListener('apex-rows-loaded', rowsLoaded);
    // @ts-expect-error not an event the grid fires
    grid.addEventListener('apex-no-such-event', () => {});
    expect(grid.isConnected).to.equal(true);
  });
});
