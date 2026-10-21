import { expect, fixture, fixtureCleanup, html, nextFrame, waitUntil } from '@open-wc/testing';
import { resetMouse, sendKeys, sendMouse } from '@web/test-runner-commands';
import { ApexGrid } from '../src/components/grid.js';
import type { ColumnConfiguration } from '../src/internal/types.js';

interface Row {
  id: number;
  name: string;
}

const data: Row[] = Array.from({ length: 12 }, (_, id) => ({ id, name: `Row ${id}` }));
const columns: ColumnConfiguration<Row>[] = [{ key: 'id', type: 'number' }, { key: 'name' }];

function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '500px';
  return node;
}

async function settle<T extends object>(grid: ApexGrid<T>) {
  await grid.updateComplete;
  await (grid as unknown as { scrollContainer?: { layoutComplete?: Promise<unknown> } })
    .scrollContainer?.layoutComplete;
  await nextFrame();
  await waitUntil(() => grid.rows.length > 0, 'rows never rendered', { timeout: 3000 });
  await Promise.all(grid.rows.map((row) => row.updateComplete));
}

async function mount(mode: 'single' | 'multiple' = 'multiple') {
  ApexGrid.register();
  const grid = await fixture<ApexGrid<Row>>(
    html`<apex-grid
      .data=${data}
      .columns=${columns}
      .selection=${{ enabled: true, mode, showCheckboxColumn: true }}
    ></apex-grid>`,
    { parentNode: sizedParent() }
  );
  await settle(grid);
  return grid;
}

function selectionCell(grid: ApexGrid<Row>, index: number) {
  return grid.rows[index].renderRoot.querySelector<HTMLElement>('[part="selection-cell"]')!;
}

function rowBox(grid: ApexGrid<Row>, index: number) {
  return selectionCell(grid, index).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
}

/** A real click on the selection cell padding, clear of the 14px checkbox. */
async function clickCellPadding(grid: ApexGrid<Row>, index: number, key?: 'Shift' | 'Meta') {
  const cell = selectionCell(grid, index);
  const rect = cell.getBoundingClientRect();
  const box = rowBox(grid, index).getBoundingClientRect();
  const x = Math.round(rect.left + 2);
  const y = Math.round(rect.top + rect.height / 2);
  expect(x < box.left, 'the click lands beside the checkbox').to.be.true;
  if (key) await sendKeys({ down: key });
  await sendMouse({ type: 'click', position: [x, y] });
  if (key) await sendKeys({ up: key });
  await grid.updateComplete;
  await Promise.all(grid.rows.map((row) => row.updateComplete));
}

/** A real click on the checkbox itself. */
async function clickBox(grid: ApexGrid<Row>, index: number, key?: 'Shift' | 'Meta') {
  const rect = rowBox(grid, index).getBoundingClientRect();
  if (key) await sendKeys({ down: key });
  await sendMouse({
    type: 'click',
    position: [Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2)],
  });
  if (key) await sendKeys({ up: key });
  await grid.updateComplete;
  await Promise.all(grid.rows.map((row) => row.updateComplete));
}

describe('Row selection cell: modifier clicks', () => {
  afterEach(async () => {
    await resetMouse();
    fixtureCleanup();
  });

  it('Shift+click on the cell padding selects the range from the anchor', async () => {
    const grid = await mount();
    await clickBox(grid, 0);
    expect(grid.selectedRows).to.deep.equal([data[0]]);

    await clickCellPadding(grid, 3, 'Shift');
    expect(grid.selectedRows.length, 'rows 0 to 3').to.equal(4);
    expect(rowBox(grid, 2).checked, 'a row inside the range is checked').to.be.true;
  });

  it('Shift+click on the cell padding matches Shift+click on the box', async () => {
    const grid = await mount();
    await clickBox(grid, 1);
    await clickBox(grid, 4, 'Shift');
    const viaBox = grid.selectedRows.length;

    grid.selectedRows = [];
    await grid.updateComplete;
    await clickBox(grid, 1);
    await clickCellPadding(grid, 4, 'Shift');
    expect(grid.selectedRows.length, 'same as on the box').to.equal(viaBox);
    expect(viaBox, 'rows 1 to 4').to.equal(4);
  });

  it('Ctrl or Cmd+click on the cell padding keeps the range anchor', async () => {
    const grid = await mount();
    await clickBox(grid, 0);
    await clickCellPadding(grid, 2, 'Meta');
    expect(grid.selectedRows.length, 'additive select').to.equal(2);

    // An additive deselect leaves the anchor on row 2, so the next Shift+click
    // extends from there. A plain toggle would clear the anchor and the
    // Shift+click would select a single row.
    await clickCellPadding(grid, 2, 'Meta');
    expect(grid.selectedRows).to.deep.equal([data[0]]);
    await clickBox(grid, 4, 'Shift');
    expect(grid.selectedRows.length, 'rows 0, 2, 3 and 4').to.equal(4);
  });

  it('a plain click on the cell padding still toggles once', async () => {
    const grid = await mount();
    await clickCellPadding(grid, 1);
    expect(grid.selectedRows).to.deep.equal([data[1]]);
    expect(rowBox(grid, 1).checked).to.be.true;
    await clickCellPadding(grid, 1);
    expect(grid.selectedRows.length).to.equal(0);
    expect(rowBox(grid, 1).checked).to.be.false;
  });

  it('single mode ignores the modifiers, as on the box', async () => {
    const grid = await mount('single');
    await clickCellPadding(grid, 0);
    await clickCellPadding(grid, 3, 'Shift');
    expect(grid.selectedRows).to.deep.equal([data[3]]);
  });
});
