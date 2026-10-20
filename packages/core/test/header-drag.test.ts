import { expect, fixture, fixtureCleanup, html, nextFrame, waitUntil } from '@open-wc/testing';
import { resetMouse, sendMouse } from '@web/test-runner-commands';
import { ApexGrid } from '../src/components/grid.js';
import type ApexGridHeader from '../src/components/header.js';
import ApexGridHeaderRow from '../src/components/header-row.js';
import type { StateController } from '../src/controllers/state.js';
import type { ColumnConfiguration } from '../src/internal/types.js';
import data, { type TestData } from './utils/test-data.js';

/**
 * Header drag, resize and autosize driven through the header itself. The drag
 * cases use real mouse input (sendMouse) on purpose: synthetic events
 * dispatched on the source header bypass hit testing and pointer capture,
 * which is exactly where the live swap used to lose the drag.
 */

type Header = ApexGridHeader<TestData>;
type Grid = ApexGrid<TestData>;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fixed = (key: keyof TestData, extra: Partial<ColumnConfiguration<TestData>> = {}) =>
  ({ key, width: '120px', ...extra }) as ColumnConfiguration<TestData>;

function stateOf(grid: Grid) {
  return (grid as unknown as { stateController: StateController<TestData> }).stateController;
}

function headers(grid: Grid) {
  const row = grid.renderRoot.querySelector(ApexGridHeaderRow.tagName) as unknown as {
    headers: Header[];
  };
  return new Map(row.headers.map((h) => [String(h.column.key), h]));
}

const keys = (grid: Grid) => grid.columns.map((c) => String(c.key));

async function mount(columns: ColumnConfiguration<TestData>[], dir: 'ltr' | 'rtl' = 'ltr') {
  ApexGrid.register();
  const parentNode = document.createElement('div');
  Object.assign(parentNode.style, { width: '800px', height: '500px' });
  parentNode.dir = dir;
  const grid = await fixture<Grid>(
    html`<apex-grid column-reordering .data=${data} .columns=${columns}></apex-grid>`,
    { parentNode }
  );
  await grid.updateComplete;
  await nextFrame();
  await waitUntil(() => grid.rows.length > 0, 'body rows never rendered');
  await nextFrame();
  return grid;
}

/** Presses on `header` at `x`, steps the mouse by `step` px `count` times, releases. */
async function drag(header: HTMLElement, x: number, step: number, count: number) {
  const r = header.getBoundingClientRect();
  const y = Math.round(r.top + r.height / 2);
  await sendMouse({ type: 'move', position: [Math.round(x), y] });
  await sendMouse({ type: 'down' });
  for (let i = 1; i <= count; i++) {
    await sendMouse({ type: 'move', position: [Math.round(x + step * i), y] });
    await pause(30);
  }
  await sendMouse({ type: 'up' });
}

const reorderCols = () => [
  fixed('id', { type: 'number' }),
  fixed('name'),
  fixed('active', { type: 'boolean' }),
  fixed('importance'),
];

describe('Header drag: reorder', function () {
  this.timeout(20000);
  afterEach(async () => {
    await resetMouse();
    fixtureCleanup();
  });

  for (const dir of ['ltr', 'rtl'] as const) {
    it(`${dir}: a drag toward later columns keeps tracking after a swap and ends`, async () => {
      const grid = await mount(reorderCols(), dir);
      const source = headers(grid).get('id')!;
      const r = source.getBoundingClientRect();
      // Later columns sit to the right in LTR and to the left under RTL.
      const rtl = dir === 'rtl';
      await drag(source, rtl ? r.right - 20 : r.left + 20, rtl ? -15 : 15, 24);
      await grid.updateComplete;
      await nextFrame();

      expect(stateOf(grid).reordering.state, 'drag ended on pointerup').to.equal(null);
      expect(source.hasAttribute('data-dragging'), 'data-dragging cleared').to.equal(false);
      expect(keys(grid).indexOf('id'), 'dragged past more than one column').to.be.greaterThan(1);

      // A plain hover afterwards (no button) must not resume the drag.
      const now = source.getBoundingClientRect();
      await sendMouse({
        type: 'move',
        position: [Math.round(now.left + 30), Math.round(now.top + 8)],
      });
      await sendMouse({
        type: 'move',
        position: [Math.round(now.left + 60), Math.round(now.top + 8)],
      });
      await grid.updateComplete;
      expect(stateOf(grid).reordering.state, 'hover does not drag').to.equal(null);
    });
  }

  it('a press released outside the header does not leave a drag armed', async () => {
    const grid = await mount(reorderCols());
    const header = headers(grid).get('name')!;
    const rect = header.getBoundingClientRect();
    const x = Math.round(rect.left + 10);
    // A quick flick from near the bottom edge: the first sampled move is
    // already outside the header, and so is the release.
    await sendMouse({ type: 'move', position: [x, Math.round(rect.bottom - 2)] });
    await sendMouse({ type: 'down' });
    await sendMouse({ type: 'move', position: [x, Math.round(rect.bottom + 200)] });
    await sendMouse({ type: 'up' });
    await grid.updateComplete;
    // Hover only, no button pressed.
    await sendMouse({ type: 'move', position: [x + 30, Math.round(rect.top + rect.height / 2)] });
    await grid.updateComplete;

    expect(stateOf(grid).reordering.state).to.equal(null);
    expect(header.hasAttribute('data-dragging')).to.equal(false);
  });

  it('a mouse move with no button pressed disarms a press whose release was lost', async () => {
    const grid = await mount(reorderCols());
    const header = headers(grid).get('name')!;
    const r = header.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const pe = (type: string, x: number, buttons: number) =>
      new PointerEvent(type, {
        bubbles: true,
        composed: true,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        buttons,
        clientX: x,
        clientY: y,
      });
    header.dispatchEvent(pe('pointerdown', r.left + 10, 1));
    // The release never arrives; the next move elsewhere has no button down.
    document.body.dispatchEvent(pe('pointermove', r.left + 80, 0));
    document.body.dispatchEvent(pe('pointermove', r.left + 120, 1));
    await grid.updateComplete;

    expect(stateOf(grid).reordering.state).to.equal(null);
    expect(header.hasAttribute('data-dragging')).to.equal(false);
  });

  it('a press on contenteditable="false" headerTemplate content still drags', async () => {
    const columns = reorderCols();
    columns[1] = fixed('name', {
      headerTemplate: () => html`<span data-probe contenteditable="false">Name</span>`,
    });
    const grid = await mount(columns);
    const header = headers(grid).get('name')!;
    const probe = header.renderRoot.querySelector<HTMLElement>('[data-probe]')!;
    const r = probe.getBoundingClientRect();
    const y = Math.round(r.top + r.height / 2);
    await sendMouse({ type: 'move', position: [Math.round(r.left + 4), y] });
    await sendMouse({ type: 'down' });
    await sendMouse({ type: 'move', position: [Math.round(r.left + 40), y] });
    await grid.updateComplete;

    expect(stateOf(grid).reordering.state?.sourceKey).to.equal('name');
    await sendMouse({ type: 'up' });
    await grid.updateComplete;
    expect(stateOf(grid).reordering.state).to.equal(null);
  });

  it('a press inside interactive headerTemplate content does not arm a reorder', async () => {
    const columns = reorderCols();
    columns[1] = fixed('name', {
      headerTemplate: () => html`<input data-probe aria-label="probe" style="width: 80px" />`,
    });
    const grid = await mount(columns);
    const header = headers(grid).get('name')!;
    const input = header.renderRoot.querySelector<HTMLInputElement>('[data-probe]')!;
    const r = input.getBoundingClientRect();
    const y = Math.round(r.top + r.height / 2);
    await sendMouse({ type: 'move', position: [Math.round(r.left + 4), y] });
    await sendMouse({ type: 'down' });
    await sendMouse({ type: 'move', position: [Math.round(r.left + 60), y] });
    await grid.updateComplete;

    expect(stateOf(grid).reordering.state, 'no drag from the input').to.equal(null);
    expect(header.hasAttribute('data-dragging')).to.equal(false);
    await sendMouse({ type: 'up' });
    expect(keys(grid)).to.deep.equal(['id', 'name', 'active', 'importance']);
  });

  it('a vetoed columnMoving is asked once per target, not on every pointermove', async () => {
    const grid = await mount(reorderCols());
    let moving = 0;
    grid.addEventListener('columnMoving', (e) => {
      moving++;
      e.preventDefault();
    });
    const pe = (type: string, x: number, y: number) =>
      new PointerEvent(type, {
        bubbles: true,
        composed: true,
        pointerId: 1,
        button: 0,
        clientX: x,
        clientY: y,
      });
    const hs = headers(grid);
    const src = hs.get('name')!;
    const s = src.getBoundingClientRect();
    const t = hs.get('active')!.getBoundingClientRect();
    src.dispatchEvent(pe('pointerdown', s.left + 10, s.top + 8));
    for (let i = 0; i < 10; i++) {
      src.dispatchEvent(pe('pointermove', t.left + t.width * 0.75 + (i % 2), t.top + 8));
      await grid.updateComplete;
      await nextFrame();
    }
    expect(moving, 'one request for the vetoed target').to.equal(1);

    // Leaving the target and coming back asks again.
    src.dispatchEvent(pe('pointermove', s.left + 10, s.top + 8));
    await nextFrame();
    src.dispatchEvent(pe('pointermove', t.left + t.width * 0.75, t.top + 8));
    await grid.updateComplete;
    await nextFrame();
    src.dispatchEvent(pe('pointerup', t.left + t.width * 0.75, t.top + 8));
    expect(moving, 'a fresh crossing asks again').to.equal(2);
    expect(keys(grid)).to.deep.equal(['id', 'name', 'active', 'importance']);
  });
});

describe('Header drag: resize indicator', function () {
  this.timeout(20000);
  afterEach(async () => {
    await resetMouse();
    fixtureCleanup();
  });

  for (const dir of ['ltr', 'rtl'] as const) {
    it(`${dir}: the indicator sits on the dragged edge from pointerdown through the drag`, async () => {
      const grid = await mount(
        [fixed('id', { resizable: true, width: '150px' }), fixed('name', { resizable: true })],
        dir
      );
      const header = headers(grid).get('id')!;
      const rect = header.getBoundingClientRect();
      const grip = header.renderRoot.querySelector<HTMLElement>('[part~="resizable"]')!;
      const g = grip.getBoundingClientRect();
      const y = Math.round(g.top + g.height / 2);
      await sendMouse({ type: 'move', position: [Math.round(g.left + g.width / 2), y] });
      await sendMouse({ type: 'down' });
      await grid.updateComplete;
      const indicator = () =>
        grid.renderRoot.querySelector<HTMLElement>('[part~="resize-indicator"]')!;
      const edge = dir === 'rtl' ? rect.left : rect.right;
      expect(indicator().getBoundingClientRect().left, 'on pointerdown').to.be.closeTo(edge, 3);

      const clientX = Math.round(dir === 'rtl' ? rect.right - 140 : rect.left + 140);
      await sendMouse({ type: 'move', position: [clientX, y] });
      await grid.updateComplete;
      expect(indicator().getBoundingClientRect().left, 'follows the pointer').to.be.closeTo(
        clientX,
        3
      );
      await sendMouse({ type: 'up' });
    });
  }

  // Columns wider than the grid: under RTL the header row then overflows to
  // the left of the grid, so a header offset would land the line outside it.
  for (const dir of ['ltr', 'rtl'] as const) {
    for (const scroll of [0, 150]) {
      for (const [key, pinned] of [
        ['id', false],
        ['name', false],
        ['importance', true],
      ] as const) {
        it(`${dir}, overflowing, scrolled ${scroll}px, ${key}${pinned ? ' pinned' : ''}: the indicator stays on the dragged edge`, async () => {
          const grid = await mount(
            [
              fixed('id', { resizable: true, width: '200px' }),
              fixed('name', { resizable: true, width: '300px' }),
              fixed('active', { resizable: true, width: '300px' }),
              fixed('importance', {
                resizable: true,
                width: '300px',
                pinned: pinned ? 'end' : undefined,
              }),
            ],
            dir
          );
          grid.parentElement!.style.width = '600px';
          await nextFrame();
          expect(grid.scrollWidth, 'columns overflow').to.be.greaterThan(grid.clientWidth);
          grid.scrollLeft = dir === 'rtl' ? -scroll : scroll;
          await nextFrame();
          await nextFrame();

          const header = headers(grid).get(key)!;
          const rect = header.getBoundingClientRect();
          const grip = header.renderRoot.querySelector<HTMLElement>('[part~="resizable"]')!;
          const g = grip.getBoundingClientRect();
          const y = Math.round(g.top + g.height / 2);
          await sendMouse({ type: 'move', position: [Math.round(g.left + g.width / 2), y] });
          await sendMouse({ type: 'down' });
          await grid.updateComplete;
          const indicator = () =>
            grid.renderRoot.querySelector<HTMLElement>('[part~="resize-indicator"]')!;
          const edge = dir === 'rtl' ? rect.left : rect.right;
          expect(indicator().getBoundingClientRect().left, 'on pointerdown').to.be.closeTo(edge, 3);

          const clientX = Math.round(dir === 'rtl' ? rect.right - 160 : rect.left + 160);
          await sendMouse({ type: 'move', position: [clientX, y] });
          await grid.updateComplete;
          expect(indicator().getBoundingClientRect().left, 'follows the pointer').to.be.closeTo(
            clientX,
            3
          );
          await sendMouse({ type: 'up' });
        });
      }
    }
  }
});
