import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { ApexGridEnterprise, RANGE_CHANGED_EVENT, type RangeChangedDetail } from '../src/index.js';

interface Row {
  id: number;
  name: string;
  amount: number;
  score: number;
}

const data: Row[] = [
  { id: 1, name: 'A', amount: 10, score: 100 },
  { id: 2, name: 'B', amount: 20, score: 200 },
  { id: 3, name: 'C', amount: 30, score: 300 },
  { id: 4, name: 'D', amount: 40, score: 400 },
];
const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number', headerText: 'ID' },
  { key: 'name', type: 'string', headerText: 'Name' },
  { key: 'amount', type: 'number', headerText: 'Amount' },
  { key: 'score', type: 'number', headerText: 'Score' },
];

/** A sized parent so the virtualizer actually renders body rows in tests. */
function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '600px';
  return node;
}

/** Waits for the virtualizer's first layout so `grid.rows`/cells are populated. */
async function layoutComplete(grid: ApexGridEnterprise<Row>) {
  await grid.updateComplete;
  const scrollContainer = (
    grid as unknown as { scrollContainer?: { layoutComplete?: Promise<unknown> } }
  ).scrollContainer;
  await scrollContainer?.layoutComplete;
  await nextFrame();
}

async function mount() {
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`,
    { parentNode: sizedParent() }
  );
  await layoutComplete(grid);
  return grid;
}

/** The rendered cell at (rowIndex, columnKey), or undefined. */
function renderedCell(grid: ApexGridEnterprise<Row>, rowIndex: number, key: keyof Row) {
  for (const row of grid.rows) {
    if (row.index !== rowIndex) continue;
    return row.cells.find((cell) => String(cell.column.key) === key);
  }
  return undefined;
}

/** Drive a forwarded cell interaction straight at the range controller. */
function interact(
  grid: ApexGridEnterprise<Row>,
  kind: 'down' | 'over' | 'up',
  rowIndex: number,
  key: keyof Row,
  opts: { shift?: boolean } = {}
): void {
  const controller = (
    grid as unknown as {
      stateController: { module(id: string): { handleCellInteraction(i: unknown): void } };
    }
  ).stateController.module('range-selection');
  const column = grid.columns.find((c) => c.key === key)!;
  controller.handleCellInteraction({
    kind,
    row: grid.pageItems[rowIndex],
    rowIndex,
    column,
    shiftKey: Boolean(opts.shift),
    ctrlKey: false,
    metaKey: false,
    originalEvent: new PointerEvent(`pointer${kind === 'over' ? 'move' : kind}`, { button: 0 }),
  });
}

/** Drag-select a rectangle [r0,c0] → [r1,c1]. */
function dragSelect(
  grid: ApexGridEnterprise<Row>,
  r0: number,
  c0: keyof Row,
  r1: number,
  c1: keyof Row
): void {
  interact(grid, 'down', r0, c0);
  interact(grid, 'over', r1, c1);
  interact(grid, 'up', r1, c1);
}

function deepQueryAll(root: ShadowRoot | Element, selector: string): Element[] {
  const out: Element[] = [];
  const visit = (node: ShadowRoot | Element) => {
    for (const el of node.querySelectorAll(selector)) out.push(el);
    for (const el of node.querySelectorAll('*')) if (el.shadowRoot) visit(el.shadowRoot);
  };
  visit(root);
  return out;
}

describe('Range selection', () => {
  before(() => ApexGridEnterprise.register());
  afterEach(() => fixtureCleanup());

  it('computes bounds over a dragged rectangle', async () => {
    const grid = await mount();
    dragSelect(grid, 0, 'amount', 2, 'score');
    expect(grid.getSelectionBounds()).to.eql({ top: 0, bottom: 2, left: 2, right: 3 });
  });

  it('aggregates numeric stats over the selected range', async () => {
    const grid = await mount();
    // amount [10,20,30] + score [100,200,300]
    dragSelect(grid, 0, 'amount', 2, 'score');
    const stats = grid.getSelectionStats();
    expect(stats.count).to.equal(6);
    expect(stats.numericCount).to.equal(6);
    expect(stats.sum).to.equal(660);
    expect(stats.average).to.equal(110);
    expect(stats.min).to.equal(10);
    expect(stats.max).to.equal(300);
  });

  it('serializes the range to TSV', async () => {
    const grid = await mount();
    dragSelect(grid, 0, 'amount', 2, 'score');
    expect(grid.getSelectionTSV()).to.equal('10\t100\n20\t200\n30\t300');
  });

  it('extends the range with shift-click from the existing anchor', async () => {
    const grid = await mount();
    interact(grid, 'down', 1, 'amount'); // anchor at (1, amount)
    interact(grid, 'up', 1, 'amount');
    interact(grid, 'down', 3, 'score', { shift: true }); // extend
    expect(grid.getSelectionBounds()).to.eql({ top: 1, bottom: 3, left: 2, right: 3 });
  });

  it('decorates the cells inside the range with edge tokens on the perimeter', async () => {
    const grid = await mount();
    dragSelect(grid, 0, 'amount', 1, 'score');
    await grid.updateComplete;
    await nextFrame();
    await nextFrame();

    const decorated = deepQueryAll(grid.shadowRoot!, 'apex-grid-cell[data-range]');
    expect(decorated.length, '2 rows x 2 cols = 4 cells').to.equal(4);

    // Top-left corner carries both `top` and `left` edges.
    const corner = renderedCell(grid, 0, 'amount');
    expect(corner?.getAttribute('data-range')).to.contain('selected');
    expect(corner?.getAttribute('data-range-edge')).to.contain('top');
    expect(corner?.getAttribute('data-range-edge')).to.contain('left');
  });

  it('clears the selection', async () => {
    const grid = await mount();
    dragSelect(grid, 0, 'amount', 2, 'score');
    expect(grid.getSelectionBounds()).to.not.be.null;

    grid.clearRangeSelection();
    expect(grid.getSelectionBounds()).to.be.null;
    expect(grid.getSelectionTSV()).to.equal('');
  });

  it('is inert when range selection is disabled', async () => {
    const grid = await mount();
    grid.rangeSelection = false;
    await grid.updateComplete;

    dragSelect(grid, 0, 'amount', 2, 'score');
    expect(grid.getSelectionBounds()).to.be.null;
  });

  it('fires apex-range-changed with bounds + stats', async () => {
    const grid = await mount();
    let detail: RangeChangedDetail | null = null;
    grid.addEventListener(RANGE_CHANGED_EVENT, (event) => {
      detail = (event as CustomEvent<RangeChangedDetail>).detail;
    });

    dragSelect(grid, 0, 'amount', 1, 'amount');
    expect(detail).to.not.be.null;
    expect(detail!.bounds).to.eql({ top: 0, bottom: 1, left: 2, right: 2 });
    expect(detail!.stats.sum).to.equal(30); // 10 + 20
  });

  it('wires real pointer events from body cells into a selection', async () => {
    const grid = await mount();
    const cell = renderedCell(grid, 0, 'amount');
    expect(cell, 'a body cell rendered').to.exist;

    cell!.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, composed: true, button: 0 })
    );
    cell!.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, composed: true, button: 0 })
    );
    await grid.updateComplete;

    expect(grid.getSelectionBounds()).to.eql({ top: 0, bottom: 0, left: 2, right: 2 });
  });
});
