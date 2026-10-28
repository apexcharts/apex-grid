import { virtualizerRef } from '@lit-labs/virtualizer/virtualize.js';
import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { ApexGridEnterprise, enterpriseModules, type MasterDetailConfig } from '../src/index.js';
import { settle } from './settle.js';

// Master-detail under `rowRecycling`: the master's body rows are re-bound to
// whatever record their slot shows next, and the detail grids follow their
// records. Every grid here sets `rowRecycling` itself, so these run in both
// suite groups. See plans/core/2026-10-27-row-recycling-plan.md, sections 6.3,
// 6.4 and 9.

type Line = { sku: string; qty: number };

interface Order {
  id: number;
  customer: string;
}

/** A detail grid as the tests read it: the core grid's public surface plus its body. */
type DetailGrid = HTMLElement & {
  rowRecycling: boolean;
  sortExpressions: Array<{ key: string; direction: string }>;
  sort(expression: { key: string; direction: 'ascending' | 'descending' }): void;
  updateComplete: Promise<unknown>;
};

type Row = HTMLElement & { data: Order; index: number };

/** The body virtualizer: its row mode and the upstream jump target. */
type Body = HTMLElement & { rowMode?: string; element(index: number): Element | undefined };

/** Upstream's flow layout, for its per-index size cache. */
type FlowLayout = { _metricsCache: { getChildSize(index: number): number | undefined } };

const COLUMNS: ColumnConfiguration<Order>[] = [
  { key: 'id', type: 'number', headerText: 'ID' },
  { key: 'customer', headerText: 'Customer' },
];

const DETAIL_COLUMNS: ColumnConfiguration<Record<string, unknown>>[] = [
  { key: 'sku', headerText: 'SKU', sort: true },
  { key: 'qty', type: 'number', headerText: 'Qty' },
];

const orders = (count: number): Order[] =>
  Array.from({ length: count }, (_, i) => ({ id: i + 1, customer: `Customer ${i + 1}` }));

const lines = (order: Order): Line[] =>
  Array.from({ length: 3 }, (_, i) => ({ sku: `${order.id}-${i + 1}`, qty: i + 1 }));

function config(overrides: Partial<MasterDetailConfig<Order>> = {}): MasterDetailConfig<Order> {
  return {
    columns: DETAIL_COLUMNS,
    getDetailData: lines,
    detailHeight: 180,
    ...overrides,
  };
}

async function mount(options: {
  recycling: boolean;
  data?: Order[];
  masterDetail?: MasterDetailConfig<Order>;
}): Promise<ApexGridEnterprise<Order>> {
  const host = document.createElement('div');
  host.style.height = '600px';
  const grid = await fixture<ApexGridEnterprise<Order>>(
    html`<apex-grid-enterprise
      .rowRecycling=${options.recycling}
      .data=${options.data ?? orders(6)}
      .columns=${COLUMNS}
      .masterDetail=${options.masterDetail ?? config()}
    ></apex-grid-enterprise>`,
    { parentNode: host }
  );
  await settle(grid);
  return grid;
}

function bodyOf(grid: HTMLElement): Body {
  return grid.shadowRoot!.querySelector<Body>('apex-virtualizer')!;
}

function bodyRows(grid: HTMLElement): Row[] {
  return Array.from(bodyOf(grid).querySelectorAll<Row>(':scope > apex-grid-row'));
}

function rowOf(grid: HTMLElement, record: Order): Row {
  const row = bodyRows(grid).find((each) => each.data === record);
  expect(row, `a row shows record ${record.id}`).to.exist;
  return row!;
}

/** The detail grids a master row renders, in its detail panel. */
function detailsIn(row: Row): DetailGrid[] {
  return Array.from(
    row.shadowRoot!.querySelectorAll<DetailGrid>('[part="detail-panel"] [part="detail-grid"]')
  );
}

function sortOf(grid: DetailGrid) {
  return grid.sortExpressions.map(({ key, direction }) => ({ key, direction }));
}

function layoutOf(grid: HTMLElement): FlowLayout {
  const body = bodyOf(grid) as unknown as Record<symbol, { _layout: FlowLayout }>;
  return body[virtualizerRef]._layout;
}

describe('Master/detail under row recycling', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  describe('the detail grid inherits rowRecycling', () => {
    for (const recycling of [false, true]) {
      it(`a master with rowRecycling = ${recycling} gets ${recycling ? 'slot' : 'item'} detail rows`, async () => {
        const grid = await mount({ recycling });
        const record = grid.data[0];
        await grid.expandRow(record);
        await settle(grid);
        const [detail] = detailsIn(rowOf(grid, record));
        expect(detail, 'a detail grid').to.exist;
        await settle(detail);
        expect(detail.rowRecycling).to.equal(recycling);
        expect(bodyOf(detail).rowMode).to.equal(recycling ? 'slot' : 'item');
      });
    }

    it('lets configureDetail override what the master passes down', async () => {
      const recycling = !ApexGridEnterprise.defaultRowRecycling;
      const grid = await mount({
        recycling,
        masterDetail: config({
          configureDetail: (detail) => {
            (detail as DetailGrid).rowRecycling = !recycling;
          },
        }),
      });
      const record = grid.data[0];
      await grid.expandRow(record);
      await settle(grid);
      const [detail] = detailsIn(rowOf(grid, record));
      await settle(detail);
      expect(detail.rowRecycling).to.equal(!recycling);
      expect(bodyOf(detail).rowMode).to.equal(recycling ? 'item' : 'slot');
    });
  });

  it('keeps each cached detail grid, and its sort, on its record across a master sort', async () => {
    // Pin: the manager's per-record cache already moved its node; this holds it
    // through the core per-record detail roots.
    const grid = await mount({ recycling: true });
    const [, a, , b] = grid.data;
    await grid.expandRow(a);
    await grid.expandRow(b);
    await settle(grid);
    const own = new Map<Order, DetailGrid>();
    for (const record of [a, b]) {
      const details = detailsIn(rowOf(grid, record));
      expect(details, `record ${record.id}: one detail grid`).to.have.length(1);
      own.set(record, details[0]);
    }
    own.get(a)!.sort({ key: 'sku', direction: 'descending' });
    own.get(b)!.sort({ key: 'sku', direction: 'ascending' });
    await settle(own.get(a)!);
    await settle(own.get(b)!);
    const elements = bodyRows(grid);

    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);

    expect(bodyRows(grid), 'the rows were re-bound, not rebuilt').to.eql(elements);
    expect(grid.pageItems[0].id, 'the master is sorted').to.equal(6);
    for (const [record, detail] of own) {
      expect(detailsIn(rowOf(grid, record)), `record ${record.id}: its own detail`).to.eql([
        detail,
      ]);
      expect(sortOf(detail), `record ${record.id}: nested sort`).to.deep.equal([
        { key: 'sku', direction: record === a ? 'descending' : 'ascending' },
      ]);
    }
    const shown = bodyRows(grid).flatMap(detailsIn);
    expect(shown, 'each detail in exactly one row').to.have.length(2);
    expect(new Set(shown).size).to.equal(2);
  });

  it('keeps detail rows contiguous and measured across jumps and a smooth scroll', async () => {
    const data = orders(2000);
    const grid = await mount({ recycling: true, data });
    grid.expandedRows = data.filter((_, i) => i % 4 === 0);
    await settle(grid);

    const faults: string[] = [];
    const check = (label: string) => {
      const rows = bodyRows(grid);
      const sizes = layoutOf(grid)._metricsCache;
      rows.forEach((row, i) => {
        const height = row.getBoundingClientRect().height;
        const cached = sizes.getChildSize(row.index);
        // The re-observe guard: a row re-bound to a new index is measured there.
        if (cached === undefined || Math.abs(cached - height) > 1) {
          faults.push(`${label} ${row.index}: cached ${cached}, real ${height.toFixed(1)}`);
        }
        if (row.data !== grid.pageItems[row.index]) {
          faults.push(`${label} ${row.index}: shows ${row.data.id}`);
        }
        if (i === 0) return;
        const gap = row.getBoundingClientRect().top - rows[i - 1].getBoundingClientRect().bottom;
        if (Math.abs(gap) > 1) faults.push(`${label} ${row.index}: gap ${gap.toFixed(1)}px`);
      });
    };

    for (const target of [750, 1300, 450, 1550, 900, 1107, 351, 1450]) {
      bodyOf(grid).element(target)?.scrollIntoView({ block: 'start' });
      await settle(grid);
      check(`jump ${target}`);
    }
    for (let frame = 0; frame < 50; frame++) {
      grid.scrollTop += 40;
      await nextFrame();
    }
    await settle(grid);
    check('scroll');
    expect(faults).to.eql([]);
    expect(
      bodyRows(grid).filter((row) => detailsIn(row).length > 0).length,
      'detail rows in range'
    ).to.be.greaterThan(1);
  });
});
