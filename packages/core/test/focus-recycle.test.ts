import { aTimeout, expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import { sendKeys } from '@web/test-runner-commands';
import type ApexGridCell from '../src/components/cell.js';
import { ApexGrid } from '../src/components/grid.js';
import type ApexGridRow from '../src/components/row.js';
import type ApexVirtualizer from '../src/components/virtualizer.js';
import type { StateController } from '../src/controllers/state.js';
import type {
  ColumnConfiguration,
  GridEditingConfiguration,
  GridExpansionConfiguration,
  PaginationConfiguration,
} from '../src/internal/types.js';
import { required } from '../src/internal/validators.js';
import { settle } from './utils/settle.js';

// Focus under the slot reconciler: a row element keeps its place and shows
// whatever record its slot holds next, so focus that sat on it stays there
// while the record under it changes. The body tracks whether it owns focus
// and reconciles after each render. Every grid here sets `rowRecycling`
// itself, so these pins run in both suite groups.
// See plans/core/2026-10-27-row-recycling-plan.md, sections 5.4 and 5.5.

interface Row {
  id: number;
  name: string;
  age: number;
}

const COLUMNS: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number' },
  { key: 'name', editable: true },
  { key: 'age', type: 'number' },
];

const records = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: i, name: `n${i}`, age: 20 + (i % 50) }));

type Internals = { scrollContainer: ApexVirtualizer; stateController: StateController<Row> };
const internals = (grid: ApexGrid<Row>) => grid as unknown as Internals;
const bodyOf = (grid: ApexGrid<Row>) => internals(grid).scrollContainer;
const activeOf = (grid: ApexGrid<Row>) => ({ ...internals(grid).stateController.active });

interface MountOptions {
  data?: Row[];
  editing?: GridEditingConfiguration;
  pagination?: PaginationConfiguration;
  height?: string;
  recycling?: boolean;
  columns?: ColumnConfiguration<Row>[];
  expansion?: GridExpansionConfiguration<Row>;
}

async function mount(options: MountOptions = {}): Promise<ApexGrid<Row>> {
  ApexGrid.register();
  const host = document.createElement('div');
  host.style.height = options.height ?? '400px';
  host.style.width = '600px';
  const grid = await fixture<ApexGrid<Row>>(
    html`<apex-grid
      .rowRecycling=${options.recycling ?? true}
      .data=${options.data ?? records(2000)}
      .columns=${options.columns ?? COLUMNS}
      .editing=${options.editing}
      .pagination=${options.pagination}
      .expansion=${options.expansion}
    ></apex-grid>`,
    { parentNode: host }
  );
  await settle(grid);
  return grid;
}

function renderedRows<T extends object>(grid: ApexGrid<T>): ApexGridRow<T>[] {
  const body = (grid as unknown as { scrollContainer: ApexVirtualizer }).scrollContainer;
  return Array.from(body.querySelectorAll('apex-grid-row')) as unknown as ApexGridRow<T>[];
}

function cellAt<T extends object>(grid: ApexGrid<T>, row: number, key: string) {
  const el = renderedRows(grid).find((r) => r.index === row);
  return el?.cells.find((c) => c.column.key === key) as ApexGridCell<T> | undefined;
}

function deepActive(): Element | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

/** Elements in the body that are in the tab order: the roving model keeps exactly one. */
function bodyTabStops(grid: ApexGrid<Row>): number {
  let stops = bodyOf(grid).tabIndex === 0 ? 1 : 0;
  for (const row of renderedRows(grid)) {
    for (const cell of row.cells) if ((cell as HTMLElement).tabIndex === 0) stops++;
  }
  return stops;
}

function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, composed: true, ...init })
  );
}

async function waitFor(check: () => boolean, ms = 1000): Promise<boolean> {
  const end = performance.now() + ms;
  while (!check() && performance.now() < end) await aTimeout(4);
  return check();
}

function editorOf(cell: ApexGridCell<Row> | undefined): HTMLInputElement | null {
  return cell?.shadowRoot?.querySelector<HTMLInputElement>('input[data-apex-editor]') ?? null;
}

/** The open editor's cell, wherever its record is rendered. */
function editingCell(grid: ApexGrid<Row>): ApexGridCell<Row> | undefined {
  return renderedRows(grid)
    .flatMap((row) => row.cells as ApexGridCell<Row>[])
    .find((cell) => editorOf(cell));
}

afterEach(() => fixtureCleanup());

describe('Focus under row recycling', () => {
  it('a sort keeps focus on the active cell, with one tab stop', async () => {
    // Regression pin: the slot keeps its element, so focus never moves.
    const grid = await mount();
    const cell = cellAt(grid, 3, 'name')!;
    cell.click();
    await settle(grid);
    expect(deepActive()).to.equal(cell);

    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);

    expect(activeOf(grid)).to.deep.equal({ column: 'name', row: 3 });
    expect(deepActive(), 'focus on the active cell').to.equal(cellAt(grid, 3, 'name'));
    expect(cellAt(grid, 3, 'name')!.row.data.id).to.equal(1996);
    expect(bodyTabStops(grid)).to.equal(1);
  });

  it('a sort while editing keeps the editor on its record without select-all', async () => {
    const grid = await mount({ data: records(20), editing: { enabled: true, mode: 'cell' } });
    const record = grid.pageItems[3];
    cellAt(grid, 3, 'name')!.click();
    await settle(grid);
    await grid.editCell(3, 'name');
    await settle(grid);
    const input = editorOf(cellAt(grid, 3, 'name'))!;
    expect(deepActive()).to.equal(input);
    input.value = 'typed';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.setSelectionRange(5, 5);

    // Every row stays rendered and record 3 moves to index 16: the slot that
    // showed it now shows another record and drops its editor.
    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);

    const cell = editingCell(grid)!;
    expect(cell.row.data, 'the editor follows its record').to.equal(record);
    expect(cell.row.index).to.equal(16);
    const editor = editorOf(cell)!;
    expect(deepActive(), 'focus on the moved editor').to.equal(editor);
    expect(editor.value).to.equal('typed');
    expect([editor.selectionStart, editor.selectionEnd], 'no select-all').to.deep.equal([5, 5]);
    expect(grid.editingCell).to.deep.equal({ rowIndex: cell.row.index, columnKey: 'name' });
  });

  it('a sort while editing moves the active cell with the record; the keyboard carries on from it', async () => {
    const grid = await mount({ data: records(20), editing: { enabled: true, mode: 'cell' } });
    cellAt(grid, 3, 'name')!.click();
    await settle(grid);
    await grid.editCell(3, 'name');
    await settle(grid);

    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);
    expect(activeOf(grid), 'the active cell is the edited one').to.deep.equal({
      column: 'name',
      row: 16,
    });
    expect(cellAt(grid, 3, 'name')!.active, 'no second outline').to.equal(false);

    await sendKeys({ press: 'Enter' });
    await settle(grid);
    await sendKeys({ press: 'ArrowDown' });
    await settle(grid);
    expect(activeOf(grid)).to.deep.equal({ column: 'name', row: 17 });
    expect(deepActive()).to.equal(cellAt(grid, 17, 'name'));
  });

  for (const recycling of [true, false]) {
    it(`${recycling ? 'recycled' : 'item'} rows: a record added above an open edit moves the active cell along`, async () => {
      const grid = await mount({
        recycling,
        data: records(20),
        editing: { enabled: true, mode: 'cell' },
      });
      cellAt(grid, 3, 'name')!.click();
      await settle(grid);
      await grid.editCell(3, 'name');
      await settle(grid);

      grid.data = [{ id: 99, name: 'new', age: 1 }, ...grid.data];
      await settle(grid);
      expect(grid.editingCell).to.deep.equal({ rowIndex: 4, columnKey: 'name' });
      expect(activeOf(grid)).to.deep.equal({ column: 'name', row: 4 });
    });
  }

  it('a filter that drops the edited record puts focus on the active cell, not the page', async () => {
    // The slot keeps its place and shows the next record, so its editor goes
    // and nothing else takes the focus it held.
    const grid = await mount({ editing: { enabled: true, mode: 'cell' } });
    cellAt(grid, 3, 'name')!.click();
    await settle(grid);
    await grid.editCell(3, 'name');
    await settle(grid);
    expect(deepActive()).to.equal(editorOf(cellAt(grid, 3, 'name')));

    grid.filter({ key: 'name', condition: 'doesNotEqual', searchTerm: 'n3' });
    await settle(grid);

    expect(grid.editingCell, 'edit closed with its record').to.equal(null);
    expect(cellAt(grid, 3, 'name')!.row.data.id).to.equal(4);
    expect(deepActive(), 'focus on the active cell').to.equal(cellAt(grid, 3, 'name'));
    expect(bodyTabStops(grid)).to.equal(1);
  });

  it('a sort that moves the edited record out of range puts focus on the active cell', async () => {
    const grid = await mount({ editing: { enabled: true, mode: 'cell' } });
    const record = grid.pageItems[3];
    cellAt(grid, 3, 'name')!.click();
    await settle(grid);
    await grid.editCell(3, 'name');
    await settle(grid);

    // Record 3 moves to index 1996, far outside the rendered rows.
    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);

    expect(grid.editingCell, 'the edit stays open').to.deep.equal({
      rowIndex: grid.pageItems.indexOf(record),
      columnKey: 'name',
    });
    expect(editingCell(grid)).to.equal(undefined);
    expect(deepActive(), 'focus on the active cell').to.equal(cellAt(grid, 3, 'name'));
    expect(bodyTabStops(grid)).to.equal(1);
  });

  it('a re-bound editor does not take focus back from outside the grid', async () => {
    // A rejected draft keeps the editor open after focus left for an input
    // outside; a sort then re-binds the editor into another row.
    const grid = await mount({ data: records(20), editing: { enabled: true, mode: 'cell' } });
    grid.columns = COLUMNS.map((column) =>
      column.key === 'name' ? { ...column, validators: [required()] } : column
    ) as ColumnConfiguration<Row>[];
    await settle(grid);
    const outside = document.createElement('input');
    grid.parentElement!.before(outside);
    await grid.editCell(3, 'name');
    await settle(grid);
    const input = editorOf(cellAt(grid, 3, 'name'))!;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    outside.focus();
    await settle(grid);
    expect(grid.editingCell, 'rejected edit stays open').to.not.equal(null);

    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);

    expect(editingCell(grid)!.row.index, 'the editor followed its record').to.equal(16);
    expect(document.activeElement, 'focus outside kept').to.equal(outside);
    outside.remove();
  });

  it('a focused row scrolled out leaves focus on the body; ArrowDown resumes', async () => {
    // Regression pin: the pre-render range handoff, which recycling keeps.
    const grid = await mount();
    cellAt(grid, 0, 'id')!.click();
    await settle(grid);

    grid.scrollTop = 20000;
    await waitFor(() => !renderedRows(grid).some((r) => r.index === 0));
    await settle(grid);
    expect(deepActive(), 'focus on the scroll container').to.equal(bodyOf(grid));
    expect(bodyOf(grid).tabIndex).to.equal(0);
    expect(bodyTabStops(grid)).to.equal(1);

    press(bodyOf(grid), 'ArrowDown');
    expect(await waitFor(() => deepActive() === cellAt(grid, 1, 'id'))).to.equal(true);
    expect(activeOf(grid)).to.deep.equal({ column: 'id', row: 1 });
  });

  it('an input outside the grid keeps focus through a scroll and a sort', async () => {
    // Regression pin for the reconcile: it never takes focus back once focus
    // left the grid, even right after the body owned it.
    const grid = await mount();
    const input = document.createElement('input');
    grid.parentElement!.before(input);
    cellAt(grid, 2, 'name')!.click();
    await settle(grid);
    input.focus();

    grid.scrollTop = 3000;
    await settle(grid);
    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);
    grid.scrollTop = 0;
    await settle(grid);
    expect(document.activeElement, 'focus outside kept').to.equal(input);
    input.remove();
  });

  it('a filter that removes the focused row moves focus to the active cell, not the page', async () => {
    const grid = await mount();
    cellAt(grid, 30, 'name')!.click();
    await settle(grid);
    expect(deepActive()).to.equal(cellAt(grid, 30, 'name'));

    // The range shrinks to 10 rows: the focused slot leaves the DOM and the
    // active row clamps to the last one.
    grid.filter({ key: 'id', condition: 'lessThan', searchTerm: 10 });
    await settle(grid);

    expect(activeOf(grid)).to.deep.equal({ column: 'name', row: 9 });
    expect(deepActive(), 'focus on the clamped active cell').to.equal(cellAt(grid, 9, 'name'));
    expect(bodyTabStops(grid)).to.equal(1);
  });

  it('a blur to the page is not undone by a later sort', async () => {
    // The user clicked a non-focusable part of the page (or the window lost
    // focus): the cell stays in the document, so the body gave up focus.
    const grid = await mount();
    const cell = cellAt(grid, 3, 'name')!;
    cell.click();
    await settle(grid);
    expect(deepActive()).to.equal(cell);

    cell.blur();
    await settle(grid);
    expect(document.activeElement).to.equal(document.body);
    expect(internals(grid).stateController.navigation.ownsFocus).to.equal(false);

    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);
    expect(document.activeElement, 'focus stays on the page').to.equal(document.body);
  });

  it('an element its own template removed does not pull focus back on a later refresh', async () => {
    // No re-bind removed it, so no reconcile repairs it: the loss is the
    // same as in item mode, and later renders leave focus on the page.
    const loaded = new Set<Row>();
    const grid = await mount({
      data: records(20),
      expansion: {
        enabled: true,
        detailTemplate: ({ data }) =>
          loaded.has(data) ? html`<p>loaded</p>` : html`<button class="load">Load</button>`,
      },
    });
    const record = grid.data[2];
    cellAt(grid, 0, 'name')!.click();
    await grid.expandRow(record);
    await settle(grid);
    const row = renderedRows(grid).find((each) => each.data === record)!;
    const button = row.renderRoot.querySelector<HTMLButtonElement>('button.load')!;
    button.focus();
    expect(deepActive()).to.equal(button);

    loaded.add(record);
    for (const each of renderedRows(grid)) each.requestUpdate();
    await settle(grid);
    expect(button.isConnected, 'the button replaced itself').to.equal(false);
    expect(document.activeElement).to.equal(document.body);
    expect(internals(grid).stateController.navigation.ownsFocus).to.equal(false);

    grid.data = [...grid.data];
    await settle(grid);
    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);
    expect(document.activeElement, 'focus stays on the page').to.equal(document.body);
  });

  it('a grid detached while focused and attached later does not take focus on a sort', async () => {
    const grid = await mount();
    cellAt(grid, 3, 'name')!.click();
    await settle(grid);
    const host = grid.parentElement!;
    const parent = host.parentNode!;

    host.remove();
    await aTimeout(50);
    const owned = internals(grid).stateController.navigation.ownsFocus;
    parent.appendChild(host);
    await settle(grid);
    expect(owned, 'no focus while out of the document').to.equal(false);
    expect(document.activeElement).to.equal(document.body);

    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);
    grid.scrollTop = 200;
    await settle(grid);
    expect(document.activeElement, 'focus stays on the page').to.equal(document.body);
  });

  it('focus on a row that now shows another record moves to the active cell', async () => {
    // A cell focused without becoming active (a script, a focusable element
    // in a template): after a sort its slot shows another record, so focus
    // goes back to the roving tab stop.
    const grid = await mount();
    cellAt(grid, 0, 'id')!.click();
    await settle(grid);
    const other = cellAt(grid, 5, 'name')!;
    other.focus();
    expect(deepActive()).to.equal(other);
    expect(activeOf(grid)).to.deep.equal({ column: 'id', row: 0 });

    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);

    expect(other.row.data.id, 'the slot shows another record').to.equal(1994);
    expect(deepActive(), 'focus on the active cell').to.equal(cellAt(grid, 0, 'id'));
    expect(bodyTabStops(grid)).to.equal(1);
  });

  it('an editor without a focusable input gives focus to its own cell after a sort', async () => {
    // The moved cell finds no editor element to focus, so the reconcile
    // focuses the edited record's cell rather than the active one.
    const columns = COLUMNS.map((column) =>
      column.key === 'name'
        ? {
            ...column,
            editorTemplate: () => html`<span class="ed" tabindex="-1">editing</span>`,
          }
        : column
    ) as ColumnConfiguration<Row>[];
    const grid = await mount({
      data: records(20),
      columns,
      editing: { enabled: true, mode: 'cell' },
    });
    const record = grid.pageItems[3];
    cellAt(grid, 3, 'name')!.click();
    await settle(grid);
    await grid.editCell(3, 'name');
    await settle(grid);
    const span = cellAt(grid, 3, 'name')!.shadowRoot!.querySelector<HTMLElement>('.ed')!;
    span.focus();
    expect(deepActive()).to.equal(span);

    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);

    const cell = cellAt(grid, 16, 'name')!;
    expect(cell.row.data, 'the edit follows its record').to.equal(record);
    expect(deepActive(), 'focus on the edited cell').to.equal(cell);
  });

  it('an editor removed with the active row out of range leaves focus on the body', async () => {
    // Neither the edited record nor the active row is rendered after the
    // change, so focus goes to the body, the keyboard entry point.
    const grid = await mount({ editing: { enabled: true, mode: 'cell' } });
    cellAt(grid, 3, 'name')!.click();
    await settle(grid);
    await grid.editCell(3, 'name');
    await settle(grid);
    expect(deepActive()).to.equal(editorOf(cellAt(grid, 3, 'name')));
    internals(grid).stateController.active = { row: 1500, column: 'name' };
    await settle(grid);
    expect(deepActive(), 'still editing').to.equal(editorOf(cellAt(grid, 3, 'name')));

    grid.filter({ key: 'name', condition: 'doesNotEqual', searchTerm: 'n3' });
    await settle(grid);

    expect(grid.editingCell, 'edit closed with its record').to.equal(null);
    expect(renderedRows(grid).some((row) => row.index === 1500)).to.equal(false);
    expect(deepActive(), 'focus on the body').to.equal(bodyOf(grid));
    expect(bodyTabStops(grid)).to.equal(1);
  });

  it('6 of 6 back-to-back keyboard jumps focus their target without waiting out a settle', async () => {
    const grid = await mount({ height: '600px' });
    cellAt(grid, 0, 'id')!.click();
    await settle(grid);

    const last = grid.pageItems.length - 1;
    const landed: boolean[] = [];
    const latency: number[] = [];
    for (let i = 0; i < 6; i++) {
      const end = i % 2 === 0;
      const target = end ? { row: last, key: 'age' } : { row: 0, key: 'id' };
      const from = deepActive()!;
      const start = performance.now();
      press(from, end ? 'End' : 'Home', { ctrlKey: true });
      const ok = await waitFor(() => deepActive() === cellAt(grid, target.row, target.key));
      latency.push(performance.now() - start);
      // A stale reveal from the previous jump must not pull the body back.
      await aTimeout(300);
      landed.push(ok && deepActive() === cellAt(grid, target.row, target.key));
    }
    expect(landed).to.deep.equal([true, true, true, true, true, true]);
    // A jump that waits out the virtualizer's settle timeout (250ms) fails;
    // the margin below it absorbs a slow CI runner.
    expect(Math.max(...latency), `latencies ${latency.map(Math.round)}`).to.be.below(150);
  });

  for (const recycling of [true, false]) {
    it(`${recycling ? 'recycled' : 'item'} rows: a scroll to the row past the rendered ones lands on it when the rows grew after they were measured`, async () => {
      const grid = await mount({
        recycling,
        height: '520px',
        data: records(500),
        expansion: {
          enabled: true,
          detailTemplate: () => html`<div style="height: 150px">detail</div>`,
        },
      });
      // Measure rows collapsed, then grow every one: the size estimates for
      // rows not rendered since are now far too small.
      for (let top = 0; top <= 4000; top += 200) {
        grid.scrollTop = top;
        await nextFrame();
        await nextFrame();
      }
      grid.scrollTop = 0;
      await settle(grid);
      await grid.expandAllRows();
      await settle(grid);

      // What ArrowDown from the last rendered row asks for.
      const body = bodyOf(grid);
      const target = Math.max(...renderedRows(grid).map((row) => row.index)) + 1;
      const before = grid.scrollTop;
      body.element(target)!.scrollIntoView({ block: 'nearest' });
      await body.revealed();

      expect(grid.scrollTop, 'never scrolls back').to.be.greaterThan(before);
      const row = renderedRows(grid).find((each) => each.index === target);
      expect(row, 'the row is rendered').to.exist;
      const box = grid.getBoundingClientRect();
      const rect = row!.getBoundingClientRect();
      expect(rect.top >= box.top && rect.bottom <= box.bottom + 1, 'the row is in view').to.equal(
        true
      );
    });
  }
});

describe('Focus under row recycling: pagination', () => {
  it('a page change moves focus from the focused cell to the body', async () => {
    const grid = await mount({ pagination: { enabled: true, pageSize: 25 } });
    const cell = cellAt(grid, 3, 'name')!;
    cell.click();
    await settle(grid);

    await grid.gotoPage(1);
    await settle(grid);

    expect(cellAt(grid, 3, 'name')!.row.data.id, 'the slot shows page 2').to.equal(28);
    expect(deepActive(), 'focus on the body, not the re-bound cell').to.equal(bodyOf(grid));
    expect(bodyTabStops(grid)).to.equal(1);
    press(bodyOf(grid), 'ArrowDown');
    expect(await waitFor(() => deepActive() === cellAt(grid, 4, 'name'))).to.equal(true);
  });

  it('a page change with a held draft keeps focus in the body and paging back resumes it', async () => {
    const grid = await mount({
      editing: { enabled: true, mode: 'cell' },
      pagination: { enabled: true, pageSize: 25 },
    });
    const record = grid.pageItems[3];
    cellAt(grid, 3, 'name')!.click();
    await settle(grid);
    await grid.editCell(3, 'name');
    await settle(grid);
    const input = editorOf(cellAt(grid, 3, 'name'))!;
    input.value = 'held';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    await grid.gotoPage(1);
    await settle(grid);
    expect(editingCell(grid), 'no editor on the other page').to.equal(undefined);
    expect(deepActive(), 'focus on the body, not the page').to.equal(bodyOf(grid));
    expect(record.name, 'the draft is not committed').to.equal('n3');

    await grid.gotoPage(0);
    await settle(grid);
    const editor = editorOf(editingCell(grid))!;
    expect(editingCell(grid)!.row.data).to.equal(record);
    expect(editor.value).to.equal('held');
    expect(deepActive(), 'the resumed editor takes focus back').to.equal(editor);
  });

  it('pageSize 100 -> 10 -> 100 parks focus only when the record under it changed', async () => {
    const grid = await mount({
      pagination: { enabled: true, pageSize: 100 },
      height: '600px',
    });
    await grid.gotoPage(2);
    await settle(grid);
    cellAt(grid, 5, 'name')!.click();
    await settle(grid);
    expect(cellAt(grid, 5, 'name')!.row.data.id).to.equal(205);

    // Back to page 1: the slot now shows record 5.
    await grid.setPageSize(10);
    await settle(grid);
    expect(renderedRows(grid).length).to.equal(10);
    expect(deepActive(), 'focus on the body at pageSize 10').to.equal(bodyOf(grid));
    expect(bodyTabStops(grid)).to.equal(1);

    // Still page 1, and the slot still shows record 5: focus stays on it.
    const cell = cellAt(grid, 5, 'name')!;
    cell.click();
    await settle(grid);
    await grid.setPageSize(100);
    await settle(grid);
    expect(renderedRows(grid).length).to.be.greaterThan(10);
    expect(cellAt(grid, 5, 'name')!.row.data.id).to.equal(5);
    expect(deepActive(), 'focus kept at pageSize 100').to.equal(cellAt(grid, 5, 'name'));
    expect(bodyTabStops(grid)).to.equal(1);
    // Every rendered index once, in order, each showing its own record.
    const rows = renderedRows(grid);
    expect(rows.map((row) => row.index)).to.deep.equal(rows.map((_, i) => rows[0].index + i));
    expect(rows.every((row) => row.data === grid.pageItems[row.index])).to.equal(true);
  });

  it('a short last page clamps the active row and keeps focus in the body', async () => {
    const grid = await mount({ data: records(55), pagination: { enabled: true, pageSize: 25 } });
    cellAt(grid, 20, 'name')!.click();
    await settle(grid);

    await grid.gotoPage(2);
    await settle(grid);

    expect(renderedRows(grid).length).to.equal(5);
    expect(activeOf(grid)).to.deep.equal({ column: 'name', row: 4 });
    expect(deepActive(), 'focus on the body, not the page').to.equal(bodyOf(grid));
    expect(bodyTabStops(grid)).to.equal(1);
    press(bodyOf(grid), 'ArrowUp');
    expect(await waitFor(() => deepActive() === cellAt(grid, 3, 'name'))).to.equal(true);
  });
});

describe('Focus under row recycling: a grid nested in a detail panel', () => {
  type Item = { sku: string; qty: number };
  type Order = { id: number; customer: string; items: Item[] };
  const orders = (): Order[] =>
    Array.from({ length: 4 }, (_, i) => ({
      id: i,
      customer: `c${i}`,
      items: [
        { sku: `s${i}a`, qty: 3 },
        { sku: `s${i}b`, qty: 1 },
        { sku: `s${i}c`, qty: 2 },
      ],
    }));

  async function nested() {
    ApexGrid.register();
    const detail = new WeakMap<Order, ApexGrid<Item>>();
    const expansion: GridExpansionConfiguration<Order> = {
      enabled: true,
      // The app keeps one nested grid per record, so the grid follows its
      // record into whichever row shows it (the enterprise pattern).
      detailTemplate: ({ data }) => {
        let inner = detail.get(data);
        if (!inner) {
          inner = document.createElement('apex-grid') as ApexGrid<Item>;
          inner.rowRecycling = true;
          inner.style.height = '160px';
          inner.columns = [{ key: 'sku' }, { key: 'qty', type: 'number' }];
          inner.data = data.items;
          detail.set(data, inner);
        }
        return html`<div>${inner}</div>`;
      },
    };
    const host = document.createElement('div');
    host.style.height = '800px';
    host.style.width = '600px';
    const data = orders();
    const outer = await fixture<ApexGrid<Order>>(
      html`<apex-grid
        .rowRecycling=${true}
        .data=${data}
        .columns=${[{ key: 'id', type: 'number' }, { key: 'customer' }]}
        .expansion=${expansion}
      ></apex-grid>`,
      { parentNode: host }
    );
    await settle(outer);
    await outer.expandRow(data[0]);
    await outer.expandRow(data[1]);
    await settle(outer);
    const inner = detail.get(data[0])!;
    await settle(inner);
    await waitFor(() => renderedRows(inner).length > 0);
    return { outer, inner, data };
  }

  it('a master sort keeps the nested active cell and its focus', async () => {
    const { outer, inner, data } = await nested();
    const cell = cellAt(inner, 1, 'qty')!;
    cell.click();
    await settle(inner);
    expect(deepActive()).to.equal(cell);

    outer.sort({ key: 'id', direction: 'descending' });
    await settle(outer);
    await settle(inner);
    await waitFor(() => deepActive() !== document.body && deepActive() !== null, 500);

    const row = renderedRows(outer).find((r) => r.data === data[0])!;
    expect(row.index, 'record 0 moved').to.equal(3);
    expect(row.renderRoot.contains(inner), 'its nested grid moved with it').to.equal(true);
    expect(deepActive(), 'never the page').to.not.equal(document.body);
    expect(
      (inner as unknown as Internals).stateController.active,
      'nested active cell kept'
    ).to.deep.equal({ column: 'qty', row: 1 });
    expect(deepActive(), 'nested focus kept').to.equal(cellAt(inner, 1, 'qty'));
  });

  it('the master reconcile never moves focus off a focused nested cell', async () => {
    // Regression pin: a master render with focus in a nested grid that
    // stays put (a selection change re-renders every master row).
    const { outer, inner, data } = await nested();
    cellAt(outer, 0, 'customer')!.click();
    await settle(outer);
    const cell = cellAt(inner, 2, 'sku')!;
    cell.click();
    await settle(inner);

    outer.selection = { enabled: true, mode: 'multiple' };
    await settle(outer);
    await outer.selectRow(data[3]);
    await settle(outer);
    outer.scrollTop = 40;
    await settle(outer);
    expect(deepActive()).to.equal(cell);
  });
});

describe('Focus under row recycling: item mode is untouched', () => {
  it('a page change in item mode drops focus as before', async () => {
    // Pins today's item-mode behavior (the record's row is removed with the
    // page), so the slot-mode handling stays behind `rowRecycling`.
    ApexGrid.register();
    const host = document.createElement('div');
    host.style.height = '400px';
    const grid = await fixture<ApexGrid<Row>>(
      html`<apex-grid
        .rowRecycling=${false}
        .data=${records(100)}
        .columns=${COLUMNS}
        .pagination=${{ enabled: true, pageSize: 25 }}
      ></apex-grid>`,
      { parentNode: host }
    );
    await settle(grid);
    cellAt(grid, 3, 'name')!.click();
    await settle(grid);
    await grid.gotoPage(1);
    await settle(grid);
    await nextFrame();
    expect(deepActive()).to.not.equal(bodyOf(grid));
  });

  it('a filter that drops the edited record leaves focus where item mode left it', async () => {
    const grid = await mount({ recycling: false, editing: { enabled: true, mode: 'cell' } });
    cellAt(grid, 3, 'name')!.click();
    await settle(grid);
    await grid.editCell(3, 'name');
    await settle(grid);
    expect(deepActive()).to.equal(editorOf(cellAt(grid, 3, 'name')));

    grid.filter({ key: 'name', condition: 'doesNotEqual', searchTerm: 'n3' });
    await settle(grid);
    await nextFrame();
    expect(grid.editingCell).to.equal(null);
    expect(deepActive(), 'the removed row took focus with it').to.equal(document.body);
  });

  it('a resumed editor takes focus back as before', async () => {
    // Pins today's item-mode behavior: an open edit scrolled away and back
    // builds a new editor, which takes focus even though focus left the grid.
    const grid = await mount({ recycling: false, editing: { enabled: true, mode: 'cell' } });
    grid.columns = COLUMNS.map((column) =>
      column.key === 'name' ? { ...column, validators: [required()] } : column
    ) as ColumnConfiguration<Row>[];
    await settle(grid);
    const outside = document.createElement('input');
    grid.parentElement!.before(outside);
    await grid.editCell(3, 'name');
    await settle(grid);
    const input = editorOf(cellAt(grid, 3, 'name'))!;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    outside.focus();
    await settle(grid);
    expect(grid.editingCell, 'rejected edit stays open').to.not.equal(null);

    grid.scrollTop = 20000;
    await waitFor(() => !renderedRows(grid).some((row) => row.index === 3));
    await settle(grid);
    grid.scrollTop = 0;
    await waitFor(() => renderedRows(grid).some((row) => row.index === 3));
    await settle(grid);

    const editor = editorOf(cellAt(grid, 3, 'name'));
    expect(editor, 'a new editor').to.exist;
    expect(deepActive(), 'the resumed editor took focus').to.equal(editor);
    outside.remove();
  });
});
