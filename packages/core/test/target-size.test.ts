import { expect, fixture, fixtureCleanup, html, waitUntil } from '@open-wc/testing';
import { ApexGrid } from '../src/components/grid.js';
import ApexGridHeaderRow from '../src/components/header-row.js';
import ApexGridPaginator from '../src/components/paginator.js';
import type { ColumnConfiguration } from '../src/internal/types.js';
import { settle } from './utils/settle.js';

interface Row {
  id: number;
  name: string;
}

const data: Row[] = Array.from({ length: 30 }, (_, id) => ({ id, name: `Row ${id}` }));
const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number', sort: true, filter: true },
  { key: 'name', sort: true, filter: true },
];

/**
 * WCAG 2.2 AA target size (2.5.8): every pointer target is at least 24x24 CSS
 * pixels. Measured from real geometry rather than asserted against the
 * stylesheet, because several of these targets are larger than the box they
 * look like — the header actions grow via an invisible `::before` chip and the
 * selection checkbox borrows its cell — so only the rendered rect tells the
 * truth.
 */
const MIN = 24;

function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '500px';
  return node;
}

async function mount(paginate = false) {
  ApexGrid.register();
  ApexGridPaginator.register();
  const grid = await fixture<ApexGrid<Row>>(
    html`<apex-grid
      .data=${data}
      .columns=${columns}
      .selection=${{ enabled: true, mode: 'multiple', showCheckboxColumn: true }}
      .filtering=${{ enabled: true }}
      .pagination=${paginate ? { enabled: true, perPage: 10 } : undefined}
    ></apex-grid>`,
    { parentNode: sizedParent() }
  );
  // Let the virtualizer lay out, or `grid.rows` is still empty.
  await settle(grid);
  // The header row renders its headers in a later update than the grid's own,
  // so a fixed number of frames is a race on the first mount of the suite.
  await waitUntil(() => {
    const headerRow = grid.renderRoot.querySelector<Element & { headers?: Element[] }>(
      ApexGridHeaderRow.tagName
    );
    return Boolean(headerRow?.headers?.length) && grid.rows.length > 0;
  }, 'the header row and body rows never rendered');
  return grid;
}

/** The union rect of an element and its ::before chip, which is a real target. */
function targetRect(el: Element): { width: number; height: number } {
  const rect = el.getBoundingClientRect();
  const before = getComputedStyle(el, '::before');
  // A chip is inset by a negative amount on every side; parse one and grow.
  const inset = Number.parseFloat(before.getPropertyValue('inset-block-start') || '0');
  const grow = Number.isFinite(inset) && inset < 0 ? -inset * 2 : 0;
  return { width: rect.width + grow, height: rect.height + grow };
}

describe('target sizes (WCAG 2.2 AA 2.5.8)', () => {
  afterEach(() => fixtureCleanup());

  it('header action buttons hit 24x24 including their chip', async () => {
    const grid = await mount();
    // Headers live inside the header row's shadow root, not the grid's.
    const headerRow = grid.renderRoot.querySelector<Element & { headers: Element[] }>(
      ApexGridHeaderRow.tagName
    )!;
    const actions = headerRow.headers.flatMap((header) =>
      Array.from(
        (header as Element & { renderRoot?: ShadowRoot }).renderRoot?.querySelectorAll(
          '[part~="action"]'
        ) ?? []
      )
    );
    expect(actions.length, 'found header action buttons').to.be.greaterThan(0);

    for (const action of actions) {
      const { width, height } = targetRect(action);
      const part = action.getAttribute('part');
      expect(width, `${part} width`).to.be.at.least(MIN);
      expect(height, `${part} height`).to.be.at.least(MIN);
    }
  });

  it('paginator buttons are 24x24', async () => {
    const grid = await mount(true);
    const paginator = grid.renderRoot.querySelector('apex-grid-paginator');
    const buttons = Array.from(
      paginator?.renderRoot?.querySelectorAll('[part~="paginator-button"]') ?? []
    );
    expect(buttons.length, 'found paginator buttons').to.be.greaterThan(0);

    for (const button of buttons) {
      const rect = button.getBoundingClientRect();
      expect(rect.width, 'paginator button width').to.be.at.least(MIN);
      expect(rect.height, 'paginator button height').to.be.at.least(MIN);
    }
  });

  it('the selection cell is the target, not just the 14px checkbox', async () => {
    const grid = await mount();
    const row = grid.rows[0];
    const cell = row.renderRoot.querySelector('[part="selection-cell"]')!;
    const box = cell.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

    // The mark itself stays small by design — that is why the cell has to be
    // the target for the criterion to be met.
    expect(box.getBoundingClientRect().width, 'checkbox stays small').to.be.lessThan(MIN);
    const rect = cell.getBoundingClientRect();
    expect(rect.width, 'selection cell width').to.be.at.least(MIN);
    expect(rect.height, 'selection cell height').to.be.at.least(MIN);
  });

  it('clicking the selection cell outside the checkbox still toggles the row', async () => {
    const grid = await mount();
    const row = grid.rows[0];
    const cell = row.renderRoot.querySelector<HTMLElement>('[part="selection-cell"]')!;
    expect(grid.selectedRows.length).to.equal(0);

    // A click on the cell padding, not on the checkbox.
    cell.click();
    await grid.updateComplete;
    expect(grid.selectedRows.length, 'row selected from a cell click').to.equal(1);

    cell.click();
    await grid.updateComplete;
    expect(grid.selectedRows.length, 'and deselected again').to.equal(0);
  });

  it('clicking the checkbox itself toggles exactly once', async () => {
    const grid = await mount();
    const row = grid.rows[0];
    const box = row.renderRoot.querySelector<HTMLInputElement>(
      '[part="selection-cell"] input[type="checkbox"]'
    )!;

    // The cell's forward must not double-fire when the click lands on the box.
    box.click();
    await grid.updateComplete;
    expect(grid.selectedRows.length).to.equal(1);
  });

  it('clicking the select-all header cell outside the checkbox selects all', async () => {
    const grid = await mount();
    const headerRow = grid.renderRoot.querySelector<Element & { renderRoot: ShadowRoot }>(
      ApexGridHeaderRow.tagName
    )!;
    const cell = headerRow.renderRoot.querySelector<HTMLElement>('[part="selection-header"]')!;

    cell.click();
    await grid.updateComplete;
    expect(grid.selectedRows.length, 'all rows selected').to.equal(data.length);
  });
});
