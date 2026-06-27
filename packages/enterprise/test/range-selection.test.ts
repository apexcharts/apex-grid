import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  ApexGridEnterprise,
  enterpriseModules,
  RANGE_CHANGED_EVENT,
  type RangeChangedDetail,
} from '../src/index.js';

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
  // Clone the data so mutating features (paste / fill) can't leak across tests.
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise .data=${data.map((row) => ({ ...row }))} .columns=${columns}></apex-grid-enterprise>`,
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
  opts: { shift?: boolean; ctrl?: boolean } = {}
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
    ctrlKey: Boolean(opts.ctrl),
    metaKey: false,
    originalEvent: new PointerEvent(`pointer${kind === 'over' ? 'move' : kind}`, { button: 0 }),
  });
}

/** Reads a numeric cell value straight from the grid's data. */
function cellValue(grid: ApexGridEnterprise<Row>, rowIndex: number, key: keyof Row): unknown {
  return (grid.pageItems[rowIndex] as Row)[key];
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
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  it('computes bounds over a dragged rectangle', async () => {
    const grid = await mount();
    dragSelect(grid, 0, 'amount', 2, 'score');
    expect(grid.getSelectionBounds()).to.eql({ top: 0, bottom: 2, left: 2, right: 3 });
  });

  it('selects a range programmatically by row + column key', async () => {
    const grid = await mount();
    grid.selectRange({ row: 0, column: 'amount' }, { row: 2, column: 'score' });
    expect(grid.getSelectionBounds()).to.eql({ top: 0, bottom: 2, left: 2, right: 3 });
    expect(grid.getSelectionStats().sum).to.equal(660);
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

  it('exposes the active range as a labeled grid (columns + value matrix)', async () => {
    const grid = await mount();
    dragSelect(grid, 0, 'name', 2, 'amount');
    const controller = (
      grid as unknown as {
        stateController: {
          module(id: string): {
            getActiveGrid(): { columns: { key: unknown }[]; rows: unknown[][] } | null;
          };
        };
      }
    ).stateController.module('range-selection');
    const active = controller.getActiveGrid()!;
    expect(active.columns.map((c) => c.key)).to.eql(['name', 'amount']);
    expect(active.rows).to.eql([
      ['A', 10],
      ['B', 20],
      ['C', 30],
    ]);
  });

  it('getActiveGrid is null without a selection', async () => {
    const grid = await mount();
    const controller = (
      grid as unknown as {
        stateController: { module(id: string): { getActiveGrid(): unknown } };
      }
    ).stateController.module('range-selection');
    expect(controller.getActiveGrid()).to.equal(null);
  });

  it('extends the range with shift-click from the existing anchor', async () => {
    const grid = await mount();
    interact(grid, 'down', 1, 'amount'); // anchor at (1, amount)
    interact(grid, 'up', 1, 'amount');
    interact(grid, 'down', 3, 'score', { shift: true }); // extend
    expect(grid.getSelectionBounds()).to.eql({ top: 1, bottom: 3, left: 2, right: 3 });
  });

  it('moves the active cell to a new selection so a prior click outline does not linger', async () => {
    const grid = await mount();
    const activeNode = () =>
      (grid as unknown as { stateController: { active: { column: string; row: number } } })
        .stateController.active;

    // Click one cell, then drag-select a different rectangle.
    interact(grid, 'down', 3, 'name');
    interact(grid, 'up', 3, 'name');
    expect(activeNode()).to.include({ column: 'name', row: 3 });

    dragSelect(grid, 0, 'amount', 1, 'score');
    // Active follows the new selection's anchor; the old (name, 3) outline is gone.
    expect(activeNode()).to.include({ column: 'amount', row: 0 });

    // Shift-extend keeps the existing anchor active.
    interact(grid, 'down', 3, 'score', { shift: true });
    expect(activeNode()).to.include({ column: 'amount', row: 0 });
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

  // --- multi-range (Ctrl-click) ------------------------------------------

  it('adds a second rectangle with Ctrl-click', async () => {
    const grid = await mount();
    interact(grid, 'down', 0, 'amount');
    interact(grid, 'up', 0, 'amount');
    interact(grid, 'down', 2, 'score', { ctrl: true });
    interact(grid, 'up', 2, 'score');

    const ranges = grid.getSelectionRanges();
    expect(ranges.length).to.equal(2);
    expect(ranges).to.deep.include({ top: 0, bottom: 0, left: 2, right: 2 });
    expect(ranges).to.deep.include({ top: 2, bottom: 2, left: 3, right: 3 });
  });

  it('aggregates stats across multiple ranges (deduped)', async () => {
    const grid = await mount();
    interact(grid, 'down', 0, 'amount'); // amount[0] = 10
    interact(grid, 'up', 0, 'amount');
    interact(grid, 'down', 2, 'score', { ctrl: true }); // score[2] = 300
    interact(grid, 'up', 2, 'score');

    const stats = grid.getSelectionStats();
    expect(stats.count).to.equal(2);
    expect(stats.sum).to.equal(310);
  });

  it('serializes multiple ranges as TSV blocks', async () => {
    const grid = await mount();
    interact(grid, 'down', 0, 'amount');
    interact(grid, 'up', 0, 'amount');
    interact(grid, 'down', 2, 'score', { ctrl: true });
    interact(grid, 'up', 2, 'score');
    expect(grid.getSelectionTSV()).to.equal('10\n\n300');
  });

  // --- clipboard paste ----------------------------------------------------

  it('pastes a TSV block from the active anchor (coerced to column type)', async () => {
    const grid = await mount();
    grid.selectRange({ row: 0, column: 'amount' });
    grid.pasteText('5\t6\n7\t8');
    await grid.updateComplete;

    expect(cellValue(grid, 0, 'amount')).to.equal(5);
    expect(cellValue(grid, 0, 'score')).to.equal(6);
    expect(cellValue(grid, 1, 'amount')).to.equal(7);
    expect(cellValue(grid, 1, 'score')).to.equal(8);
    // Selection expands to cover the pasted block.
    expect(grid.getSelectionBounds()).to.eql({ top: 0, bottom: 1, left: 2, right: 3 });
  });

  it('paste emits cellValueChanged for each changed cell (edit choke point)', async () => {
    const grid = await mount();
    const changed: string[] = [];
    grid.addEventListener('cellValueChanged', (event) => {
      const detail = (event as CustomEvent<{ key: unknown; value: unknown }>).detail;
      changed.push(`${String(detail.key)}=${detail.value}`);
    });

    grid.selectRange({ row: 0, column: 'amount' });
    grid.pasteText('5\t6'); // amount[0] 10->5, score[0] 100->6
    await grid.updateComplete;

    expect(changed).to.deep.equal(['amount=5', 'score=6']);
  });

  it('paste respects cellValueChanging cancellation (validation gate)', async () => {
    const grid = await mount();
    grid.addEventListener('cellValueChanging', (event) => {
      const detail = (event as CustomEvent<{ key: unknown }>).detail;
      if (String(detail.key) === 'amount') event.preventDefault();
    });

    grid.selectRange({ row: 0, column: 'amount' });
    grid.pasteText('5\t6'); // amount blocked, score allowed
    await grid.updateComplete;

    expect(cellValue(grid, 0, 'amount')).to.equal(10); // cancelled — unchanged
    expect(cellValue(grid, 0, 'score')).to.equal(6); // applied
  });

  // --- fill handle --------------------------------------------------------

  it('fill copies a single source cell down the column', async () => {
    const grid = await mount();
    grid.selectRange({ row: 0, column: 'score' }); // score[0] = 100
    grid.fillTo({ row: 2, column: 'score' });
    await grid.updateComplete;

    expect(cellValue(grid, 1, 'score')).to.equal(100);
    expect(cellValue(grid, 2, 'score')).to.equal(100);
    expect(grid.getSelectionBounds()).to.eql({ top: 0, bottom: 2, left: 3, right: 3 });
  });

  it('fill extrapolates a numeric series down the column', async () => {
    const grid = await mount();
    // Seed a source with step 3 that does NOT match the (linear) sample data.
    grid.selectRange({ row: 0, column: 'amount' });
    grid.pasteText('2\n5'); // amount[0]=2, amount[1]=5
    await grid.updateComplete;

    grid.selectRange({ row: 0, column: 'amount' }, { row: 1, column: 'amount' });
    grid.fillTo({ row: 3, column: 'amount' });
    await grid.updateComplete;

    expect(cellValue(grid, 2, 'amount')).to.equal(8); // 2 + 3*2
    expect(cellValue(grid, 3, 'amount')).to.equal(11); // 2 + 3*3
  });

  it('shows a fill handle on the active range corner only', async () => {
    const grid = await mount();
    grid.selectRange({ row: 0, column: 'amount' }, { row: 1, column: 'score' });
    await grid.updateComplete;
    await nextFrame();
    await nextFrame();

    const corner = renderedCell(grid, 1, 'score'); // bottom-right
    expect(corner?.hasAttribute('data-range-handle'), 'corner has handle').to.be.true;
    const inner = renderedCell(grid, 0, 'amount'); // top-left
    expect(inner?.hasAttribute('data-range-handle'), 'non-corner has no handle').to.be.false;
  });
});
