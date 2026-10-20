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
});
