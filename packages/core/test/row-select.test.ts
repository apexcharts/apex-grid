import { expect, fixture, fixtureCleanup, html, nextFrame, waitUntil } from '@open-wc/testing';
import { resetMouse, sendKeys, sendMouse } from '@web/test-runner-commands';
import type { ReactiveController } from 'lit';
import { ApexGrid } from '../src/components/grid.js';
import ApexGridHeaderRow from '../src/components/header-row.js';
import type ApexGridRow from '../src/components/row.js';
import { StateController } from '../src/controllers/state.js';
import type {
  GridFeatureModule,
  PresentedRow,
  RowPresenter,
  RowTransformer,
} from '../src/internal/feature-module.js';
import type { ColumnConfiguration, GridHost } from '../src/internal/types.js';
import { settle as settleLayout } from './utils/settle.js';

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
  await settleLayout(grid);
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

describe('Row selection cell: cancelled rowSelecting', () => {
  afterEach(async () => {
    await resetMouse();
    fixtureCleanup();
  });

  it('clicking the row checkbox leaves it unchecked', async () => {
    const grid = await mount();
    grid.addEventListener('rowSelecting', (event) => event.preventDefault());
    await clickBox(grid, 0);
    await nextFrame();
    expect(grid.selectedRows.length, 'nothing selected').to.equal(0);
    expect(rowBox(grid, 0).checked, 'the box shows the real state').to.be.false;
  });

  it('clicking the selection cell padding leaves the box unchecked', async () => {
    const grid = await mount();
    grid.addEventListener('rowSelecting', (event) => event.preventDefault());
    await clickCellPadding(grid, 1);
    await nextFrame();
    expect(grid.selectedRows.length).to.equal(0);
    expect(rowBox(grid, 1).checked).to.be.false;
  });

  it('a refused deselect leaves the box checked', async () => {
    const grid = await mount();
    await clickBox(grid, 0);
    grid.addEventListener('rowSelecting', (event) => event.preventDefault());
    await clickBox(grid, 0);
    await nextFrame();
    expect(grid.selectedRows).to.deep.equal([data[0]]);
    expect(rowBox(grid, 0).checked).to.be.true;
  });

  it('the header select-all box keeps its unchecked and mixed state', async () => {
    const grid = await mount();
    await clickBox(grid, 0);
    grid.addEventListener('rowSelecting', (event) => event.preventDefault());
    const headerRow = grid.renderRoot.querySelector<ApexGridHeaderRow<Row>>(
      ApexGridHeaderRow.tagName
    )!;
    const box = headerRow.renderRoot.querySelector<HTMLInputElement>(
      '[part="selection-header"] input'
    )!;
    expect(box.indeterminate, 'mixed before the click').to.be.true;
    const rect = box.getBoundingClientRect();
    await sendMouse({
      type: 'click',
      position: [Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2)],
    });
    await grid.updateComplete;
    await headerRow.updateComplete;
    await nextFrame();
    expect(grid.selectedRows.length).to.equal(1);
    expect(box.checked, 'select all was refused').to.be.false;
    expect(box.indeterminate, 'still mixed').to.be.true;
  });
});

describe('Row parts', () => {
  afterEach(() => fixtureCleanup());

  const SUMMARY: Row = { id: -1, name: 'summary' };
  const GROUP: Row = { id: -2, name: 'group' };

  class PresenterStub implements ReactiveController, RowTransformer<Row>, RowPresenter<Row> {
    constructor(host: GridHost<Row>) {
      host.addController(this);
    }
    hostConnected() {}
    processRows(rows: ReadonlyArray<Row>): Row[] {
      return [SUMMARY, GROUP, ...rows];
    }
    presentRow(row: Row): PresentedRow | null {
      if (row === SUMMARY) {
        return {
          part: 'summary-row',
          exportParts: ['summary-label'],
          content: html`<span part="summary-label">Summary</span>`,
        };
      }
      if (row === GROUP) return { content: html`<span part="group-label">Group</span>` };
      return null;
    }
  }

  const presenterModule: GridFeatureModule<Row> = {
    id: 'row-parts-stub',
    create: (host) => new PresenterStub(host),
  };

  class PartsGrid<T extends object> extends ApexGrid<T> {
    public static override get tagName() {
      return 'apex-grid-row-parts-test';
    }
    public static override register() {
      ApexGrid.register();
      if (!customElements.get(PartsGrid.tagName)) {
        customElements.define(PartsGrid.tagName, PartsGrid);
      }
    }
    protected override createStateController(): StateController<T> {
      return new StateController<T>(this, [presenterModule as unknown as GridFeatureModule<T>]);
    }
  }

  const COLORS: Record<string, string> = {
    'selection-cell': 'rgb(1, 1, 1)',
    'selection-checkbox': 'rgb(2, 2, 2)',
    'expansion-cell': 'rgb(3, 3, 3)',
    'expansion-toggle': 'rgb(4, 4, 4)',
    'detail-panel': 'rgb(5, 5, 5)',
    'row-number': 'rgb(6, 6, 6)',
    'reorder-handle': 'rgb(7, 7, 7)',
    'summary-row': 'rgb(8, 8, 8)',
    'summary-label': 'rgb(9, 9, 9)',
    'group-row': 'rgb(10, 10, 10)',
    'my-detail': 'rgb(11, 11, 11)',
    cell: 'rgb(12, 12, 12)',
  };

  async function mountParts() {
    PartsGrid.register();
    const grid = await fixture<PartsGrid<Row>>(
      html`<apex-grid-row-parts-test
        .data=${data}
        .columns=${columns}
        .coordinateHints=${true}
        .rowReordering=${{ enabled: true }}
        .selection=${{ enabled: true, mode: 'multiple', showCheckboxColumn: true }}
        .expansion=${{
          enabled: true,
          exportParts: ['my-detail'],
          detailTemplate: () => html`<span part="my-detail">detail</span>`,
        }}
      ></apex-grid-row-parts-test>`,
      { parentNode: sizedParent() }
    );
    await settle(grid);
    return grid;
  }

  function rowFor(grid: ApexGrid<Row>, record: Row) {
    return grid.rows.find((row) => row.data === record) as ApexGridRow<Row>;
  }

  function outline(row: ApexGridRow<Row>, part: string) {
    const el = row.renderRoot.querySelector<HTMLElement>(`[part="${part}"]`);
    expect(el, `part ${part} renders`).to.exist;
    return getComputedStyle(el!).outlineColor;
  }

  it('apex-grid::part() reaches every part a row renders', async () => {
    const style = document.createElement('style');
    style.textContent = Object.entries(COLORS)
      .map(([part, color]) => `apex-grid-row-parts-test::part(${part}){outline:3px solid ${color}}`)
      .join('\n');
    document.head.append(style);
    try {
      const grid = await mountParts();
      await grid.expandRow(data[0]);
      await settle(grid);

      const dataRow = rowFor(grid, data[0]);
      for (const part of [
        'cell',
        'selection-cell',
        'selection-checkbox',
        'expansion-cell',
        'expansion-toggle',
        'detail-panel',
        'my-detail',
        'row-number',
        'reorder-handle',
      ]) {
        expect(outline(dataRow, part), part).to.equal(COLORS[part]);
      }

      const summary = rowFor(grid, SUMMARY);
      expect(outline(summary, 'summary-row'), 'presenter part').to.equal(COLORS['summary-row']);
      expect(outline(summary, 'summary-label'), 'declared child part').to.equal(
        COLORS['summary-label']
      );
      const group = rowFor(grid, GROUP);
      expect(outline(group, 'group-row'), 'default presenter part').to.equal(COLORS['group-row']);
    } finally {
      style.remove();
    }
  });

  it('exportparts follows the presented row when the element is reused', async () => {
    const grid = await mountParts();
    const summary = rowFor(grid, SUMMARY);
    expect(summary.getAttribute('exportparts')).to.contain('summary-label');

    summary.data = data[5];
    await summary.updateComplete;
    const parts = summary.getAttribute('exportparts')!.split(',');
    expect(parts).to.not.include('summary-label');
    expect(parts).to.not.include('summary-row');
    expect(parts).to.include('selection-checkbox');
  });
});
