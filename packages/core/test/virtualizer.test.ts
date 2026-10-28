import { elementUpdated, expect, fixtureCleanup, nextFrame } from '@open-wc/testing';
import { ApexGrid } from '../src/components/grid.js';
import { virtualizedRows } from '../src/components/virtualize-rows.js';
import type ApexVirtualizer from '../src/components/virtualizer.js';
import { GRID_BODY } from '../src/internal/tags.js';

interface Row {
  id: number;
  name: string;
}

const data: Row[] = Array.from({ length: 160 }, (_, i) => ({ id: i + 1, name: `Row ${i + 1}` }));

async function settle(grid: ApexGrid<Row>, frames = 8) {
  await elementUpdated(grid);
  for (let i = 0; i < frames; i++) await nextFrame();
}

/**
 * Frame-count waits are load-sensitive, and recovery costs an observer delivery
 * plus two frames plus a render. Poll to a deadline instead: without the fix
 * nothing ever recovers, so this still fails on a regression, it just does not
 * fail on a busy machine.
 */
async function waitForRows(grid: ApexGrid<Row>, frames = 40) {
  for (let i = 0; i < frames && renderedRows(grid) === 0; i++) await nextFrame();
  return renderedRows(grid);
}

function makeBox(styles: Partial<CSSStyleDeclaration>) {
  const box = document.createElement('div');
  Object.assign(box.style, { width: '600px', height: '400px' }, styles);
  document.body.append(box);
  return box;
}

function mount(parent: HTMLElement, rows: Row[] = data) {
  ApexGrid.register();
  const grid = document.createElement('apex-grid') as ApexGrid<Row>;
  grid.columns = [{ key: 'id' }, { key: 'name' }];
  grid.data = rows;
  parent.append(grid);
  return grid;
}

function bodyOf(grid: ApexGrid<Row>) {
  return grid.shadowRoot!.querySelector(GRID_BODY) as ApexVirtualizer;
}

function renderedRows(grid: ApexGrid<Row>) {
  return bodyOf(grid).querySelectorAll('apex-grid-row').length;
}

function renderedRowElements(grid: ApexGrid<Row>): Element[] {
  return Array.from(bodyOf(grid).querySelectorAll('apex-grid-row'));
}

/**
 * Guards the suite-wide keying switch: the slot group must really recycle the
 * body rows, or a broken hook would rerun item keys and pass vacuously.
 */
describe('virtualizer row keying switch', () => {
  afterEach(() => fixtureCleanup());

  it('recycles the body rows under the slot run and keys them by record otherwise', async () => {
    const keying = (globalThis as { __apexRowKeying?: unknown }).__apexRowKeying;
    // Any other value is a runner config this switch no longer understands.
    expect([undefined, 'slot'], 'page global __apexRowKeying').to.include(keying);
    const slot = keying === 'slot';
    // Removed afterwards: the boxes are not fixtures, and one left in the flow
    // would push the later suites' grids below the window.
    const box = makeBox({});
    const grid = mount(box);
    await settle(grid, 2);
    const body = bodyOf(grid);
    const item = { id: 131 };
    const key = body.keyFunction(item, 130);
    const elements = renderedRowElements(grid);
    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid, 4);
    const kept = renderedRowElements(grid).filter((row) => elements.includes(row)).length;
    box.remove();

    expect(ApexGrid.defaultRowRecycling).to.equal(slot);
    expect(grid.rowRecycling).to.equal(slot);
    expect(body.rowMode).to.equal(slot ? 'slot' : 'item');
    expect(virtualizedRows(body)?.mode).to.equal(slot ? 'slot' : 'item');
    // The item branch keeps upstream's record key in both runs.
    expect(key).to.equal(item);
    // A sort of the whole list re-binds rows in place only when they recycle.
    expect(kept, 'row elements kept across a sort').to.equal(slot ? elements.length : 0);
  });
});

/**
 * Regression cover for https://github.com/apexcharts/apex-grid/issues/31: a grid
 * that settles with a correct row count and scroll extent but no rendered rows,
 * because the upstream virtualizer measured a zero-height viewport and has no
 * signal that would make it measure again.
 */
describe('virtualizer viewport recovery', () => {
  afterEach(() => fixtureCleanup());

  it('renders rows when the grid is moved into view without resizing or scrolling', async () => {
    // `fixed` keeps the document height constant, so moving the grid changes
    // nothing the virtualizer's own ResizeObserver or scroll listeners see.
    const box = makeBox({ position: 'fixed', top: '900px', left: '0' });
    const grid = mount(box);
    await settle(grid);

    // Laid out below the window: an empty range is the correct render here.
    expect(renderedRows(grid)).to.equal(0);

    box.style.top = '10px';
    expect(await waitForRows(grid)).to.be.greaterThan(0);
  });

  it('leaves a grid that has no visible slice empty, without retrying forever', async () => {
    const box = makeBox({ position: 'fixed', top: '900px', left: '0' });
    const grid = mount(box);
    await settle(grid);
    expect(renderedRows(grid)).to.equal(0);

    // Nothing moved, so nothing should be re-measured or re-rendered.
    const before = bodyOf(grid).items;
    await settle(grid, 12);
    expect(renderedRows(grid)).to.equal(0);
    expect(bodyOf(grid).items).to.equal(before);
  });

  it('keeps the body alive after the grid is moved to another parent', async () => {
    const grid = mount(makeBox({}));
    await settle(grid);
    expect(renderedRows(grid)).to.be.greaterThan(5);

    // A move disconnects and reconnects the body. Awaiting virtualizer state in
    // `connectedCallback` used to deadlock here and leave it permanently stale.
    makeBox({}).append(grid);
    await settle(grid);

    grid.data = data.slice(0, 5);
    await settle(grid);
    for (let i = 0; i < 40 && renderedRows(grid) !== 5; i++) await nextFrame();
    expect(renderedRows(grid)).to.equal(5);
  });
});
