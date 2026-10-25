import {
  elementUpdated,
  expect,
  fixture,
  fixtureCleanup,
  html,
  nextFrame,
  waitUntil,
} from '@open-wc/testing';
import { ApexGrid } from '../src/components/grid.js';
import type ApexGridHeader from '../src/components/header.js';
import ApexGridHeaderRow from '../src/components/header-row.js';
import type { StateController } from '../src/controllers/state.js';
import type { ColumnConfiguration, ColumnGroupConfiguration } from '../src/internal/types.js';
import data, { type TestData } from './utils/test-data.js';

/**
 * Header, paginator and toolbar chrome: the column menu and the column drag
 * ghost paint above every other band, and the consumer styling hooks reach
 * every element they name.
 */

type Grid = ApexGrid<TestData>;
type Header = ApexGridHeader<TestData>;

ApexGrid.register();

async function settle(grid: Grid) {
  await elementUpdated(grid);
  await nextFrame();
  await nextFrame();
  await elementUpdated(grid);
}

async function mount(
  props: Record<string, unknown>,
  { style = '', height = '500px', dir = 'ltr' } = {}
): Promise<Grid> {
  const parentNode = document.createElement('div');
  Object.assign(parentNode.style, { width: '800px', height });
  parentNode.dir = dir;
  const grid = await fixture<Grid>(html`<apex-grid style=${style}></apex-grid>`, { parentNode });
  Object.assign(grid, { data, ...props });
  await settle(grid);
  return grid;
}

function header(grid: Grid, key: keyof TestData): Header {
  const row = grid.renderRoot.querySelector(ApexGridHeaderRow.tagName) as unknown as {
    headers: Header[];
  };
  return row.headers.find((h) => h.column.key === key)!;
}

function stateOf(grid: Grid) {
  return (grid as unknown as { stateController: StateController<TestData> }).stateController;
}

/** The deepest element painted at (x, y), walking into shadow roots. */
function hitAt(x: number, y: number): Element | null {
  let el: Element | null = document.elementFromPoint(x, y);
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

function centre(el: Element): [number, number] {
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}

async function openMenu(grid: Grid, key: keyof TestData) {
  const h = header(grid, key);
  h.renderRoot.querySelector<HTMLElement>('[part~="menu-btn"]')!.click();
  await settle(grid);
  await elementUpdated(h);
  const menu = h.renderRoot.querySelector<HTMLElement>('[part="col-menu"]')!;
  expect(menu, 'menu rendered').to.exist;
  return { h, menu, items: Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')) };
}

function expectItemsOnTop(items: HTMLElement[]) {
  expect(items.length).to.be.greaterThan(0);
  for (const item of items) {
    const hit = hitAt(...centre(item));
    expect(
      hit === item || item.contains(hit),
      `${item.textContent?.trim()} is covered by ${hit?.tagName}[part=${hit?.getAttribute('part')}]`
    ).to.be.true;
  }
}

const columns = [
  { key: 'id', sort: true },
  { key: 'name', sort: true, resizable: true },
  { key: 'active' },
] as ColumnConfiguration<TestData>[];

describe('Chrome styles', () => {
  afterEach(() => fixtureCleanup());

  describe('column menu (core-styles-chrome-1)', () => {
    it('paints above the pinned-top rows', async () => {
      const grid = await mount({ columns, rowPinning: { enabled: true } });
      grid.pinRow(data[0], 'top');
      grid.pinRow(data[1], 'top');
      await settle(grid);
      const { items } = await openMenu(grid, 'name');
      expectItemsOnTop(items);
      // Nothing but the menu takes the pointer: a body cell beside it still hits.
      const bodyRow = () => grid.renderRoot.querySelector('apex-virtualizer apex-grid-row');
      await waitUntil(bodyRow, 'a body row renders');
      const row = bodyRow()!;
      const cell = row.shadowRoot!.querySelector('apex-grid-cell')!;
      expect(hitAt(...centre(cell))).to.equal(cell);
    });

    it('paints above the paginator and outside the grid in a short grid', async () => {
      const grid = await mount(
        { columns, pagination: { enabled: true, pageSize: 2 }, showQuickFilter: true },
        { height: '200px' }
      );
      const { items } = await openMenu(grid, 'name');
      expectItemsOnTop(items);
    });

    for (const dir of ['ltr', 'rtl'] as const) {
      it(`${dir}: sits below the header cell, aligned to its inline-end edge`, async () => {
        const grid = await mount({ columns }, { dir });
        const { h, menu } = await openMenu(grid, 'name');
        const hr = h.getBoundingClientRect();
        const mr = menu.getBoundingClientRect();
        expect(mr.top).to.be.closeTo(hr.bottom, 0.5);
        if (dir === 'ltr') expect(mr.right).to.be.closeTo(hr.right, 0.5);
        else expect(mr.left).to.be.closeTo(hr.left, 0.5);
      });
    }

    it('follows the header cell when the grid scrolls horizontally', async () => {
      const wide = columns.map((c) => ({ ...c, width: '400px' }));
      const grid = await mount({ columns: wide });
      const { h, menu } = await openMenu(grid, 'name');
      grid.scrollLeft = 120;
      grid.dispatchEvent(new Event('scroll'));
      await nextFrame();
      await nextFrame();
      expect(menu.getBoundingClientRect().right).to.be.closeTo(
        h.getBoundingClientRect().right,
        0.5
      );
    });

    it('follows the header cell when a scroller inside a shadow root scrolls', async () => {
      // Scroll is not composed, so a scroll in an app shell's shadow root never
      // reaches window: the menu must still move with its cell.
      const shell = document.createElement('div');
      document.body.append(shell);
      const scroller = document.createElement('div');
      Object.assign(scroller.style, { height: '300px', overflow: 'auto' });
      scroller.innerHTML = '<div style="height:100px"></div>';
      shell.attachShadow({ mode: 'open' }).append(scroller);
      const grid = document.createElement('apex-grid') as Grid;
      grid.style.height = '200px';
      scroller.append(
        grid,
        Object.assign(document.createElement('div'), { style: 'height:1000px' })
      );
      try {
        Object.assign(grid, { data, columns });
        await settle(grid);
        const { h, menu } = await openMenu(grid, 'name');
        scroller.scrollTop = 60;
        await nextFrame();
        await nextFrame();
        expect(menu.getBoundingClientRect().top).to.be.closeTo(
          h.getBoundingClientRect().bottom,
          0.5
        );
      } finally {
        shell.remove();
      }
    });

    it('follows the header cell when the layout shifts without any event', async () => {
      const grid = await mount({ columns });
      const box = grid.parentElement!;
      box.style.display = 'flex';
      const spacer = document.createElement('div');
      box.prepend(spacer);
      grid.style.flex = '1';
      await settle(grid);
      const { h, menu } = await openMenu(grid, 'name');
      spacer.style.flex = '0 0 100px';
      await nextFrame();
      await nextFrame();
      const hr = h.getBoundingClientRect();
      const mr = menu.getBoundingClientRect();
      expect(mr.right).to.be.closeTo(hr.right, 0.5);
      expect(mr.top).to.be.closeTo(hr.bottom, 0.5);
    });

    it('closes once its kebab scrolls out of the grid', async () => {
      const wide = columns.map((c) => ({ ...c, width: '400px' }));
      const grid = await mount({ columns: wide });
      const { h, items } = await openMenu(grid, 'id');
      items[0].focus();
      grid.scrollLeft = 400;
      const scrolled = grid.scrollLeft;
      expect(scrolled).to.be.greaterThan(0);
      await nextFrame();
      await nextFrame();
      await elementUpdated(h);
      await nextFrame();
      expect(h.renderRoot.querySelector('[part="col-menu"]')).to.be.null;
      // Focus goes back to the kebab, and closing does not scroll the grid back.
      expect((h.renderRoot as ShadowRoot).activeElement?.getAttribute('part')).to.contain(
        'menu-btn'
      );
      expect(grid.scrollLeft).to.equal(scrolled);
    });

    it('keeps focus inside and returns it to the kebab on Escape', async () => {
      const grid = await mount({ columns, rowPinning: { enabled: true } });
      const { h, items } = await openMenu(grid, 'name');
      items[0].focus();
      expect((h.renderRoot as ShadowRoot).activeElement).to.equal(items[0]);
      items[0].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })
      );
      await settle(grid);
      await nextFrame();
      expect(h.renderRoot.querySelector('[part="col-menu"]')).to.be.null;
      expect((h.renderRoot as ShadowRoot).activeElement?.getAttribute('part')).to.contain(
        'menu-btn'
      );
    });

    it('stops following the cell once the grid is removed with the menu open', async () => {
      const grid = await mount({ columns });
      const { h } = await openMenu(grid, 'name');
      grid.remove();
      // A frame left running would try to show the detached menu and throw.
      await nextFrame();
      await nextFrame();
      expect(h.renderRoot.querySelector('[part="col-menu"]')?.matches(':popover-open')).to.not.be
        .true;
    });

    it('closes on an outside pointerdown', async () => {
      const grid = await mount({ columns });
      const { h } = await openMenu(grid, 'name');
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await elementUpdated(h);
      expect(h.renderRoot.querySelector('[part="col-menu"]')).to.be.null;
    });
  });

  describe('column drag ghost (core-styles-chrome-2)', () => {
    it('paints above the group header row and the pinned-top band', async () => {
      const groups: ColumnGroupConfiguration[] = [{ id: 'g', headerText: 'Group' }];
      const grid = await mount({
        columnGroups: groups,
        columnReordering: true,
        rowPinning: { enabled: true },
        columns: [
          { key: 'id', group: 'g' },
          { key: 'name', group: 'g' },
          { key: 'active' },
        ] as ColumnConfiguration<TestData>[],
      });
      grid.pinRow(data[0], 'top');
      grid.pinRow(data[1], 'top');
      await settle(grid);
      const r = header(grid, 'name').getBoundingClientRect();
      const reorder = stateOf(grid).reordering;
      const cx = r.left + 20;
      const cy = r.top + r.height / 2;
      reorder.start('name', r, cx, cy, 'NAME');
      await settle(grid);
      const ghost = () => {
        const headerRow = grid.renderRoot.querySelector(ApexGridHeaderRow.tagName)!;
        return (grid.renderRoot.querySelector('[part~="drag-ghost"]') ??
          headerRow.renderRoot.querySelector('[part~="drag-ghost"]')) as HTMLElement;
      };
      try {
        for (const dy of [-30, 50]) {
          reorder.move(cx, cy + dy);
          await settle(grid);
          const g = ghost();
          g.style.pointerEvents = 'auto';
          const gr = g.getBoundingClientRect();
          const hit = hitAt(gr.left + 10, gr.top + gr.height / 2);
          expect(hit, `dy ${dy}: ${hit?.tagName}[part=${hit?.getAttribute('part')}]`).to.equal(g);
        }
      } finally {
        reorder.end();
      }
      await settle(grid);
      expect(ghost()).to.be.null;
    });
  });
});
