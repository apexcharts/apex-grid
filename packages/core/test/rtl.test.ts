import { expect, fixture, fixtureCleanup, html, waitUntil } from '@open-wc/testing';
import { ApexGrid } from '../src/components/grid.js';
import ApexGridHeaderRow from '../src/components/header-row.js';
import type { ColumnConfiguration } from '../src/internal/types.js';
import { isRTL } from '../src/internal/utils.js';
import { settle } from './utils/settle.js';

interface Row {
  id: number;
  name: string;
  city: string;
}

const data: Row[] = Array.from({ length: 12 }, (_, id) => ({
  id,
  name: `Row ${id}`,
  city: 'Cairo',
}));
const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number', resizable: true },
  { key: 'name', resizable: true },
  { key: 'city', resizable: true },
];

/**
 * The stylesheets are written entirely in logical properties, so layout mirrors
 * under `dir="rtl"` for free. What does not mirror by itself is code reasoning
 * in physical pixels or physical key names, which is what these cover.
 */
async function mount(dir: 'ltr' | 'rtl') {
  ApexGrid.register();
  const parent = document.createElement('div');
  parent.style.height = '500px';
  parent.dir = dir;
  const grid = await fixture<ApexGrid<Row>>(
    html`<apex-grid .data=${data} .columns=${columns}></apex-grid>`,
    { parentNode: parent }
  );
  await settle(grid);
  await waitUntil(() => grid.rows.length > 0, 'body rows never rendered');
  return grid;
}

/** The active cell's column key, via the navigation state. */
function activeColumn(grid: ApexGrid<Row>): string | undefined {
  const active = (grid as unknown as { stateController: { active?: { column?: string } } })
    .stateController.active;
  return active?.column;
}

function pressArrow(grid: ApexGrid<Row>, key: 'ArrowLeft' | 'ArrowRight') {
  const cell = grid.rows[0].cells[0];
  cell.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true })
  );
}

describe('RTL', () => {
  afterEach(() => fixtureCleanup());

  it('isRTL reads the inherited computed direction, not just a dir attribute', async () => {
    const ltr = await mount('ltr');
    expect(isRTL(ltr), 'ltr grid').to.be.false;
    fixtureCleanup();

    const rtl = await mount('rtl');
    // `dir` is on the parent, so an attribute check on the grid would miss it.
    expect(rtl.hasAttribute('dir'), 'grid carries no dir of its own').to.be.false;
    expect(isRTL(rtl), 'rtl grid').to.be.true;
  });

  it('mirrors the grid box without any physical CSS', async () => {
    const rtl = await mount('rtl');
    const headerRow = rtl.renderRoot.querySelector<Element & { headers: Element[] }>(
      ApexGridHeaderRow.tagName
    )!;
    const [first, last] = [headerRow.headers[0], headerRow.headers.at(-1)!];
    // First column paints on the right when the grid flows right-to-left.
    expect(first.getBoundingClientRect().left).to.be.greaterThan(last.getBoundingClientRect().left);
  });

  it('ArrowLeft moves to the next column in RTL and the previous in LTR', async () => {
    const ltr = await mount('ltr');
    (ltr as unknown as { stateController: { active: unknown } }).stateController.active = {
      column: 'name',
      row: 0,
    };
    pressArrow(ltr, 'ArrowLeft');
    await ltr.updateComplete;
    expect(activeColumn(ltr), 'LTR ArrowLeft goes back a column').to.equal('id');
    fixtureCleanup();

    const rtl = await mount('rtl');
    (rtl as unknown as { stateController: { active: unknown } }).stateController.active = {
      column: 'name',
      row: 0,
    };
    pressArrow(rtl, 'ArrowLeft');
    await rtl.updateComplete;
    // Leftwards is forwards when the columns run right-to-left.
    expect(activeColumn(rtl), 'RTL ArrowLeft goes forward a column').to.equal('city');
  });

  it('ArrowRight mirrors too', async () => {
    const rtl = await mount('rtl');
    (rtl as unknown as { stateController: { active: unknown } }).stateController.active = {
      column: 'name',
      row: 0,
    };
    pressArrow(rtl, 'ArrowRight');
    await rtl.updateComplete;
    expect(activeColumn(rtl)).to.equal('id');
  });

  it('resizing measures the width from the fixed inline-start edge', async () => {
    // The real handler: pointerdown on the resize grip, then a pointermove.
    // In RTL the inline-start edge is the physical right one, so a pointer 140px
    // to its left is a 140px-wide column — the LTR arithmetic would have read
    // that same position as a clamped-to-minimum width.
    for (const dir of ['ltr', 'rtl'] as const) {
      const grid = await mount(dir);
      const headerRow = grid.renderRoot.querySelector<Element & { headers: Element[] }>(
        ApexGridHeaderRow.tagName
      )!;
      const header = headerRow.headers[0] as HTMLElement;
      const grip = header.shadowRoot?.querySelector<HTMLElement>('[part~="resizable"]');
      expect(grip, `${dir}: resize grip must exist for this test to mean anything`).to.exist;
      if (!grip) return;
      const widths: number[] = [];
      (
        header as unknown as {
          resizeController: { resize(c: unknown, w: number, x?: number): void };
        }
      ).resizeController.resize = (_column, width) => widths.push(width);

      const rect = header.getBoundingClientRect();
      grip.dispatchEvent(
        new PointerEvent('pointerdown', { pointerId: 1, bubbles: true, composed: true })
      );
      // 140px inside the column from whichever edge is inline-start; comfortably
      // above MIN_COL_RESIZE_WIDTH so the clamp cannot mask the arithmetic.
      const clientX = dir === 'rtl' ? rect.right - 140 : rect.left + 140;
      grip.dispatchEvent(
        new PointerEvent('pointermove', { pointerId: 1, clientX, bubbles: true, composed: true })
      );

      expect(widths.at(-1), `${dir} width from the inline-start edge`).to.be.closeTo(140, 1);
      fixtureCleanup();
    }
  });
});
