import { expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
import type { ReactiveController } from 'lit';
import type ApexGridCell from '../src/components/cell.js';
import { ApexGrid } from '../src/components/grid.js';
import type ApexGridRow from '../src/components/row.js';
import { StateController } from '../src/controllers/state.js';
import type { GridFeatureModule, PresentedRow } from '../src/internal/feature-module.js';
import type {
  ApexCellContext,
  ApexEditorContext,
  ColumnConfiguration,
  GridEditingConfiguration,
  GridExpansionConfiguration,
  GridHost,
  GridSelectionConfiguration,
} from '../src/internal/types.js';
import { required } from '../src/internal/validators.js';
import { settle } from './utils/settle.js';

// Recycle safety: a row element (and its cells) may be re-bound to another
// record without being rebuilt. The pinned bands already do this today (an
// unkeyed `rows.map`), and the body rows recycle by default (`rowRecycling`;
// the suite's item group turns it off) so a sort re-binds them in place too. Whatever a row or cell shows must
// come from the record it shows now, never from the one it showed before.
// See plans/core/2026-10-27-row-recycling-plan.md, sections 5.4, 6.3 and 7.

interface Row {
  id: number;
  name: string;
  active: boolean;
}

/** Same/X/Y/Same: records 1 and 4 share a name, so a slot that swaps them sees no `.value` change. */
const SOURCE: Row[] = [
  { id: 1, name: 'Same', active: false },
  { id: 2, name: 'X', active: false },
  { id: 3, name: 'Y', active: true },
  { id: 4, name: 'Same', active: false },
];

interface Config {
  columns?: ColumnConfiguration<Row>[];
  editing?: GridEditingConfiguration;
  expansion?: GridExpansionConfiguration<Row>;
  selection?: GridSelectionConfiguration<Row>;
  pinning?: boolean;
  tag?: string;
}

const DEFAULT_COLUMNS: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number' },
  { key: 'name', editable: true, validators: [required()] },
  { key: 'active', type: 'boolean', editable: true },
] as ColumnConfiguration<Row>[];

async function mount(config: Config = {}): Promise<ApexGrid<Row>> {
  ApexGrid.register();
  const host = document.createElement('div');
  host.style.height = '600px';
  const data = structuredClone(SOURCE);
  const grid = await fixture<ApexGrid<Row>>(
    html`<apex-grid
      .data=${data}
      .columns=${config.columns ?? DEFAULT_COLUMNS}
      .editing=${config.editing ?? { enabled: true, mode: 'cell' }}
      .expansion=${config.expansion}
      .selection=${config.selection}
      .rowPinning=${{ enabled: Boolean(config.pinning) }}
    ></apex-grid>`,
    { parentNode: host }
  );
  await settle(grid);
  return grid;
}

/** Every rendered row element, body and pinned bands alike. */
function rowsOf(grid: HTMLElement): ApexGridRow<Row>[] {
  return Array.from((grid.shadowRoot ?? grid).querySelectorAll<ApexGridRow<Row>>('apex-grid-row'));
}

function bodyRows(grid: ApexGrid<Row>): ApexGridRow<Row>[] {
  return rowsOf(grid).filter((row) => !row.closest('[part~="pinned-rows"]'));
}

function pinnedRows(grid: ApexGrid<Row>): ApexGridRow<Row>[] {
  return rowsOf(grid).filter((row) => row.closest('[part~="pinned-rows"]'));
}

/** Whether this run's grids recycle their body rows (the default group, not the item group). */
function slotKeyed(): boolean {
  return ApexGrid.defaultRowRecycling;
}

function cellOf(row: ApexGridRow<Row>, key: keyof Row): ApexGridCell<Row> {
  return row.cells.find((cell) => cell.column.key === key)!;
}

function editorOf(cell: ApexGridCell<Row>): HTMLInputElement | null {
  return cell.shadowRoot!.querySelector<HTMLInputElement>('input[data-apex-editor]');
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function press(input: HTMLInputElement, key: string) {
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true }));
}

/** The focused element, through every open shadow root. */
function deepActive(): Element | null {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  return element;
}

/** Whether `element` lies inside the grid's visible box. */
function inView(grid: HTMLElement, element: Element): boolean {
  const box = element.getBoundingClientRect();
  const view = grid.getBoundingClientRect();
  return box.top >= view.top && box.bottom <= view.bottom;
}

/** A 400px tall cell-mode grid over `count` rows named `n00`, `n01`, ... */
async function mountRows(count: number, rename?: Record<number, string>): Promise<ApexGrid<Row>> {
  ApexGrid.register();
  const host = document.createElement('div');
  host.style.height = '400px';
  const data: Row[] = Array.from({ length: count }, (_, i) => ({
    id: i,
    name: rename?.[i] ?? `n${String(i).padStart(2, '0')}`,
    active: false,
  }));
  const columns = DEFAULT_COLUMNS.map((column) =>
    column.key === 'name' ? { ...column, sort: true } : column
  ) as ColumnConfiguration<Row>[];
  const grid = await fixture<ApexGrid<Row>>(
    html`<apex-grid
      .data=${data}
      .columns=${columns}
      .editing=${{ enabled: true, mode: 'cell' }}
    ></apex-grid>`,
    { parentNode: host }
  );
  await settle(grid);
  return grid;
}

/** The rendered body row at view index `index`. */
function rowAt(grid: ApexGrid<Row>, index: number): ApexGridRow<Row> {
  const row = bodyRows(grid).find((entry) => entry.index === index);
  if (!row) throw new Error(`row ${index} is not rendered`);
  return row;
}

/** What the name cell of `row` shows: its value, its text, and its error state. */
function nameState(row: ApexGridRow<Row>) {
  const cell = cellOf(row, 'name');
  return {
    id: row.data.id,
    value: cell.value,
    text: (cell.shadowRoot!.textContent ?? '').trim(),
    invalid: cell.getAttribute('aria-invalid'),
    error: Boolean(cell.shadowRoot!.querySelector('[part="cell-error"]')),
  };
}

/** Stages a rejected (empty, required) name on `record` in row mode. */
async function stageInvalidName(grid: ApexGrid<Row>, row: ApexGridRow<Row>) {
  cellOf(row, 'name').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
  await settle(grid);
  const editor = editorOf(cellOf(row, 'name'))!;
  type(editor, '');
  press(editor, 'Enter');
  await settle(grid);
  expect(await grid.commitEdit(), 'the empty name is rejected').to.equal(false);
  await settle(grid);
}

describe('Recycle safety', () => {
  afterEach(() => fixtureCleanup());

  describe('cells follow their record (F1)', () => {
    it('a staged value and its error stay on their record across a sort (Same/X/Y/Same)', async () => {
      const grid = await mount({ editing: { enabled: true, mode: 'row' } });
      const [first, , , fourth] = grid.data;
      await stageInvalidName(grid, bodyRows(grid)[0]);
      expect(nameState(bodyRows(grid)[0])).to.deep.include({ id: 1, value: '', invalid: 'true' });

      grid.sort({ key: 'id', direction: 'descending' });
      await settle(grid);

      for (const row of bodyRows(grid)) {
        const state = nameState(row);
        if (row.data === first) {
          expect(state, 'the staged record').to.deep.include({ value: '', invalid: 'true' });
        } else {
          expect(state, `record ${row.data.id}`).to.deep.equal({
            id: row.data.id,
            value: row.data.name,
            text: row.data.name,
            invalid: null,
            error: false,
          });
        }
      }
      expect(bodyRows(grid)[0].data, 'slot 0 now shows record 4').to.equal(fourth);
    });
  });

  describe('ctx.commit writes the record the context was built for (F3)', () => {
    /** An editable name column whose template commits after awaiting `gate`. */
    function gatedColumns(gate: Promise<void>, seen: ApexCellContext<Row>[]) {
      return DEFAULT_COLUMNS.map((column) =>
        column.key === 'name'
          ? {
              ...column,
              cellTemplate: (ctx: ApexCellContext<Row>) => {
                seen.push(ctx);
                return html`<button
                  @click=${async () => {
                    await gate;
                    await ctx.commit?.('Z' as never);
                  }}
                >
                  ${ctx.value}
                </button>`;
              },
            }
          : column
      ) as ColumnConfiguration<Row>[];
    }

    it('an async commit issued before a sort lands on the original record', async () => {
      let open!: () => void;
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      const seen: ApexCellContext<Row>[] = [];
      const grid = await mount({ columns: gatedColumns(gate, seen) });
      const first = grid.data[0];
      cellOf(bodyRows(grid)[0], 'name').shadowRoot!.querySelector('button')!.click();

      grid.sort({ key: 'id', direction: 'descending' });
      await settle(grid);
      open();
      await settle(grid);

      expect(
        grid.data.map((record) => record.name),
        'only the clicked record changed'
      ).to.deep.equal(['Z', 'X', 'Y', 'Same']);
      expect(first.name).to.equal('Z');
    });

    it('an async commit lands on its record after a pinned row above it is unpinned', async () => {
      // Pinned bands re-bind row elements positionally under any keying.
      let open!: () => void;
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      const seen: ApexCellContext<Row>[] = [];
      const grid = await mount({ columns: gatedColumns(gate, seen), pinning: true });
      const [first, second, third] = grid.data;
      for (const record of [first, second, third]) grid.pinRow(record, 'top');
      await settle(grid);
      const pinnedSecond = pinnedRows(grid)[1];
      expect(pinnedSecond.data).to.equal(second);
      cellOf(pinnedSecond, 'name').shadowRoot!.querySelector('button')!.click();

      grid.unpinRow(first);
      await settle(grid);
      open();
      await settle(grid);

      expect(second.name, 'the clicked record').to.equal('Z');
      expect(grid.data.map((record) => record.name)).to.deep.equal(['Same', 'Z', 'Y', 'Same']);
    });

    it('exposes the record as ctx.data', async () => {
      const seen: ApexCellContext<Row>[] = [];
      const grid = await mount({ columns: gatedColumns(Promise.resolve(), seen) });
      const ctx = seen.find((entry) => entry.value === 'X')!;
      expect(ctx.data).to.equal(grid.data[1]);
    });

    it('exposes the record as ctx.data to an editor template', async () => {
      const seen: ApexEditorContext<Row>[] = [];
      const columns = DEFAULT_COLUMNS.map((column) =>
        column.key === 'name'
          ? {
              ...column,
              editorTemplate: (ctx: ApexEditorContext<Row>) => {
                seen.push(ctx);
                return html`<input data-apex-editor .value=${String(ctx.value)} />`;
              },
            }
          : column
      ) as ColumnConfiguration<Row>[];
      const grid = await mount({ columns });
      expect(await grid.editCell(1, 'name')).to.equal(true);
      await settle(grid);
      expect(seen.at(-1)?.data).to.equal(grid.data[1]);
    });
  });

  describe('checkboxes show the record they render (F8)', () => {
    it('a selection checkbox re-bound in the render that selects shows its own record (live binding)', async () => {
      const grid = await mount({
        selection: { enabled: true, mode: 'multiple', showCheckboxColumn: true },
      });
      const first = grid.data[0];
      const checkbox = bodyRows(grid)[0].renderRoot.querySelector<HTMLInputElement>(
        '[part="selection-checkbox"]'
      )!;

      // An app that reorders on selection: the re-bind lands in the same
      // render as the selection change. This guards the `live` binding; the
      // click handler's record capture writes the same state the old re-read
      // did.
      grid.addEventListener('rowSelected', () => {
        grid.data = [...grid.data].reverse();
      });
      checkbox.click();
      await settle(grid);

      expect(grid.selectedRows).to.deep.equal([first]);
      for (const row of bodyRows(grid)) {
        const box = row.renderRoot.querySelector<HTMLInputElement>('[part="selection-checkbox"]')!;
        expect(box.checked, `record ${row.data.id}`).to.equal(row.data === first);
      }
    });
  });

  describe('regression bed: interactive cells across a re-bind', () => {
    it('a boolean cell toggle that re-sorts its record checks the toggled record only', async () => {
      // Sorted by the toggled column: the commit itself moves the record, so
      // its row element re-binds in the render that applies the new value.
      // The commit is synchronous here, so this pins today's behavior rather
      // than one fix: the async ctx.commit cases above guard F3.
      const columns = DEFAULT_COLUMNS.map((column) =>
        column.key === 'active' ? { ...column, sort: true } : column
      ) as ColumnConfiguration<Row>[];
      const grid = await mount({ columns });
      grid.sort({ key: 'active', direction: 'ascending' });
      await settle(grid);
      const first = grid.data[0];
      expect(bodyRows(grid)[0].data).to.equal(first);
      const box = (row: ApexGridRow<Row>) =>
        cellOf(row, 'active').shadowRoot!.querySelector<HTMLInputElement>(
          'input[type="checkbox"]'
        )!;

      box(bodyRows(grid)[0]).click();
      await settle(grid);

      expect(first.active, 'the clicked record toggled').to.equal(true);
      for (const row of bodyRows(grid)) {
        expect(box(row).checked, `record ${row.data.id}`).to.equal(row.data.active);
      }
    });
  });

  describe('presented rows carry no data-row state', () => {
    const HEADER_NAME = 'HEADER';

    class HeaderPresenter implements ReactiveController {
      constructor(host: GridHost<Row>) {
        host.addController(this);
      }
      hostConnected() {}
      presentRow(row: Row): PresentedRow | null {
        return row.name === HEADER_NAME
          ? { content: html`<span part="group-label">${row.name}</span>` }
          : null;
      }
    }

    const presenterModule: GridFeatureModule<Row> = {
      id: 'recycle-header-presenter',
      create: (host) => new HeaderPresenter(host),
    };

    class PresenterGrid<T extends object> extends ApexGrid<T> {
      public static override get tagName() {
        return 'apex-grid-recycle-presenter-test';
      }
      public static override register() {
        if (!customElements.get(PresenterGrid.tagName)) {
          customElements.define(PresenterGrid.tagName, PresenterGrid);
        }
      }
      protected override createStateController(): StateController<T> {
        return new StateController<T>(this, [presenterModule as unknown as GridFeatureModule<T>]);
      }
    }

    it('a row element that switches to a presented row drops [expanded]', async () => {
      ApexGrid.register();
      PresenterGrid.register();
      const data: Row[] = [...structuredClone(SOURCE), { id: 0, name: HEADER_NAME, active: false }];
      const grid = await fixture<PresenterGrid<Row>>(
        html`<apex-grid-recycle-presenter-test
          .data=${data}
          .columns=${DEFAULT_COLUMNS}
          .expansion=${{
            enabled: true,
            detailTemplate: ({ data: record }: { data: Row }) => html`detail-${record.id}`,
          }}
        ></apex-grid-recycle-presenter-test>`
      );
      await settle(grid);
      await grid.expandRow(data[0]);
      await settle(grid);
      expect(rowsOf(grid)[0].expanded).to.equal(true);

      grid.sort({ key: 'id', direction: 'ascending' });
      await settle(grid);

      const header = rowsOf(grid).find((row) => row.data.name === HEADER_NAME)!;
      expect(header.presentedCell, 'the header is presented').to.not.equal(null);
      expect(header.expanded, 'header expanded').to.equal(false);
      expect(header.hasAttribute('expanded'), 'header [expanded]').to.equal(false);
      expect(header.selected).to.equal(false);
      const expanded = rowsOf(grid).filter((row) => row.expanded);
      expect(expanded.map((row) => row.data)).to.deep.equal([data[0]]);
    });

    it('pinned band: a presented row taking an expanded row element drops [expanded]', async () => {
      // Pinned bands re-bind row elements positionally under any keying.
      ApexGrid.register();
      PresenterGrid.register();
      const data: Row[] = [...structuredClone(SOURCE), { id: 0, name: HEADER_NAME, active: false }];
      const header = data[4];
      const grid = await fixture<PresenterGrid<Row>>(
        html`<apex-grid-recycle-presenter-test
          .data=${data}
          .columns=${DEFAULT_COLUMNS}
          .rowPinning=${{ enabled: true }}
          .expansion=${{
            enabled: true,
            detailTemplate: ({ data: record }: { data: Row }) => html`detail-${record.id}`,
          }}
        ></apex-grid-recycle-presenter-test>`
      );
      await settle(grid);
      grid.pinRow(data[0], 'top');
      grid.pinRow(header, 'top');
      await grid.expandRow(data[0]);
      await settle(grid);
      const band = () => rowsOf(grid).filter((row) => row.closest('[part~="pinned-rows"]'));
      expect(band().map((row) => row.data)).to.deep.equal([data[0], header]);
      const element = band()[0];
      expect(element.expanded).to.equal(true);

      grid.unpinRow(data[0]);
      await settle(grid);

      expect(band()[0], 'the same element').to.equal(element);
      expect(element.data).to.equal(header);
      expect(element.presentedCell, 'the header is presented').to.not.equal(null);
      expect(element.expanded, 'header expanded').to.equal(false);
      expect(element.hasAttribute('expanded'), 'header [expanded]').to.equal(false);
    });
  });

  describe('the detail panel follows its record', () => {
    const noteDetail: GridExpansionConfiguration<Row> = {
      enabled: true,
      detailTemplate: ({ data }) => html`<input class="note" aria-label="note ${data.id}" />`,
    };

    function noteOf(row: ApexGridRow<Row>): HTMLInputElement | null {
      return row.renderRoot.querySelector<HTMLInputElement>('[part="detail-panel"] input.note');
    }

    it('pinned band: unpinning the first row leaks no detail input or staged edit', async () => {
      const grid = await mount({
        editing: { enabled: true, mode: 'row' },
        expansion: noteDetail,
        pinning: true,
      });
      // Pinned order S (staged), E (expanded, typed), X (expanded). S and E
      // share a name, so the element that showed S sees no `.value` change.
      const [staged, , other, expanded] = grid.data;
      for (const record of [staged, expanded, other]) grid.pinRow(record, 'top');
      await grid.expandRow(expanded);
      await grid.expandRow(other);
      await settle(grid);
      expect(pinnedRows(grid).map((row) => row.data)).to.deep.equal([staged, expanded, other]);
      noteOf(pinnedRows(grid)[1])!.value = 'typed';
      await stageInvalidName(grid, pinnedRows(grid)[0]);
      expect(nameState(pinnedRows(grid)[0])).to.deep.include({ value: '', invalid: 'true' });

      grid.unpinRow(staged);
      await settle(grid);

      const [showsExpanded, showsOther] = pinnedRows(grid);
      expect(showsExpanded.data).to.equal(expanded);
      expect(showsOther.data).to.equal(other);
      expect(nameState(showsExpanded), 'no staged value on E').to.deep.equal({
        id: expanded.id,
        value: 'Same',
        text: 'Same',
        invalid: null,
        error: false,
      });
      expect(noteOf(showsOther)?.value, "no typed note on X (E's note)").to.equal('');
      const body = bodyRows(grid).find((row) => row.data === staged)!;
      expect(nameState(body), 'S keeps its staged edit').to.deep.include({
        value: '',
        invalid: 'true',
      });
    });

    it('body: no typed detail input or nested sort leaks to another record across a master sort', async () => {
      const nested = [{ n: 1 }, { n: 2 }, { n: 3 }];
      const grid = await mount({
        expansion: {
          enabled: true,
          detailTemplate: ({ data }) =>
            html`<input class="note" aria-label="note ${data.id}" /><apex-grid
                style="height: 160px"
                .data=${nested}
                .columns=${[{ key: 'n', sort: true }]}
              ></apex-grid>`,
        },
      });
      const first = grid.data[0];
      for (const record of grid.data) await grid.expandRow(record);
      await settle(grid);
      const row0 = bodyRows(grid)[0];
      expect(row0.data).to.equal(first);
      noteOf(row0)!.value = 'typed';
      const nestedGrid = row0.renderRoot.querySelector<ApexGrid<{ n: number }>>(
        '[part="detail-panel"] apex-grid'
      )!;
      nestedGrid.sort({ key: 'n', direction: 'descending' });
      await settle(nestedGrid);

      grid.sort({ key: 'id', direction: 'descending' });
      await settle(grid);

      if (!slotKeyed()) {
        // Item keys move the row element with its record, detail DOM and all.
        // An unstable detail key would rebuild it and lose both.
        const own = bodyRows(grid).find((row) => row.data === first)!;
        expect(noteOf(own)?.value, 'the record keeps its note').to.equal('typed');
        const ownNested = own.renderRoot.querySelector<ApexGrid<{ n: number }>>(
          '[part="detail-panel"] apex-grid'
        )!;
        expect(
          ownNested.sortExpressions.map(({ key, direction }) => ({ key, direction })),
          'the record keeps its nested sort'
        ).to.deep.equal([{ key: 'n', direction: 'descending' }]);
      }
      for (const row of bodyRows(grid)) {
        if (row.data === first) continue;
        const nestedOf = row.renderRoot.querySelector<ApexGrid<{ n: number }>>(
          '[part="detail-panel"] apex-grid'
        )!;
        expect(noteOf(row)?.value, `record ${row.data.id} note`).to.equal('');
        expect(nestedOf.sortExpressions, `record ${row.data.id} nested sort`).to.deep.equal([]);
      }
    });
  });

  describe('focus after a keyboard commit or cancel (F5)', () => {
    for (const key of ['Enter', 'Escape']) {
      it(`${key} after the grid scrolled while editing brings the cell back into view`, async () => {
        const grid = await mountRows(60);
        expect(await grid.editCell(0, 'name')).to.equal(true);
        await settle(grid);
        const cell = cellOf(rowAt(grid, 0), 'name');
        const editor = editorOf(cell)!;
        type(editor, 'n7');
        grid.scrollTop = 300;
        await settle(grid);
        expect(grid.scrollTop, 'the grid scrolled').to.be.greaterThan(0);
        expect(deepActive(), 'the editor kept focus').to.equal(editor);

        press(editor, key);
        await settle(grid);

        expect(deepActive(), 'focus is back on the cell').to.equal(cell);
        expect(inView(grid, cell), 'the cell is visible').to.equal(true);
      });
    }

    it('Enter on a pinned row an app replaces with a copy keeps focus on its cell', async () => {
      const grid = await mount({ pinning: true });
      grid.rowId = (row) => row.id;
      grid.pinRow(grid.data[3], 'top');
      await settle(grid);
      // The immutable-data pattern: every commit replaces the records with
      // copies, so the pinned element re-binds in the update that closes it.
      grid.addEventListener('cellValueChanged', () => {
        grid.data = grid.data.map((row) => ({ ...row }));
      });
      const cell = cellOf(pinnedRows(grid)[0], 'name');
      cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
      await settle(grid);
      const editor = editorOf(cell)!;
      type(editor, '77');
      press(editor, 'Enter');
      await settle(grid);

      const focused = deepActive() as ApexGridCell<Row> | null;
      expect(focused?.localName, 'focus is on a cell').to.equal('apex-grid-cell');
      expect(focused, 'the pinned cell').to.equal(cellOf(pinnedRows(grid)[0], 'name'));
      expect(focused!.row.data.id).to.equal(4);
      expect(focused!.row.data.name).to.equal('77');
    });

    it('pinned band: a cell re-bound away from a still-open edit does not take focus', async () => {
      // Pinned bands re-bind row elements positionally under any keying.
      const grid = await mount({ pinning: true });
      const [first, second, third] = grid.data;
      for (const record of [first, second, third]) grid.pinRow(record, 'top');
      await settle(grid);
      const cell = cellOf(pinnedRows(grid)[1], 'name');
      cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
      await settle(grid);
      // A rejected Enter keeps the editor open with its refocus pending.
      type(editorOf(cell)!, '');
      press(editorOf(cell)!, 'Enter');
      await settle(grid);
      expect(grid.editingCell, 'the empty name is rejected').to.not.equal(null);

      grid.unpinRow(first);
      await settle(grid);

      const [showsSecond, showsThird] = pinnedRows(grid);
      expect(showsSecond.data).to.equal(second);
      expect(showsThird.data).to.equal(third);
      expect(grid.editingCell, 'the edit is still open').to.not.equal(null);
      expect(deepActive(), 'the resumed editor keeps focus').to.equal(
        editorOf(cellOf(showsSecond, 'name'))
      );
    });

    it('body: a cell re-bound away from a still-open edit does not take focus', async function () {
      if (!slotKeyed()) this.skip(); // item keys move the element with its record
      const grid = await mount();
      const fourth = grid.data[3];
      expect(await grid.editCell(3, 'name')).to.equal(true);
      await settle(grid);
      const editor = editorOf(cellOf(rowAt(grid, 3), 'name'))!;
      type(editor, '');
      press(editor, 'Enter');
      await settle(grid);
      expect(grid.editingCell, 'the empty name is rejected').to.not.equal(null);

      // Record 4 moves up to slot 0; slot 3, which held its editor, now
      // shows record 1 and renders after the resumed editor.
      grid.sort({ key: 'id', direction: 'descending' });
      await settle(grid);

      const row = bodyRows(grid).find((entry) => entry.data === fourth)!;
      expect(row.index).to.equal(0);
      expect(deepActive(), 'the resumed editor keeps focus').to.equal(
        editorOf(cellOf(row, 'name'))
      );
    });
  });

  describe('a re-rendered editor (F6)', () => {
    it('a sort while editing does not select-all the resumed editor', async () => {
      const grid = await mount();
      const second = grid.data[1];
      expect(await grid.editCell(1, 'name')).to.equal(true);
      await settle(grid);
      const editor = editorOf(cellOf(bodyRows(grid)[1], 'name'))!;
      type(editor, 'TYPED');
      editor.setSelectionRange(5, 5);

      grid.sort({ key: 'id', direction: 'descending' });
      await settle(grid);

      if (!slotKeyed()) {
        // Item keys move the focused row element, which drops focus, so the
        // focus-loss path commits the draft and closes the editor (5.3).
        expect(grid.editingCell).to.equal(null);
        expect(second.name).to.equal('TYPED');
        return;
      }
      const row = bodyRows(grid).find((entry) => entry.data === second)!;
      const resumed = editorOf(cellOf(row, 'name'))!;
      expect(resumed.value, 'the editor shows the draft').to.equal('TYPED');
      expect(
        [resumed.selectionStart, resumed.selectionEnd],
        'the draft is not selected'
      ).to.deep.equal([5, 5]);
    });

    it('a sort that moves the edited record out of view resumes its editor without a scroll', async function () {
      if (!slotKeyed()) this.skip(); // item keys commit on the focus loss (see above)
      // `n02` renamed to sort right after `n14`: view index 2 moves to 14,
      // below the 400px viewport but inside the rendered overhang.
      const grid = await mountRows(60, { 2: 'n14x' });
      const moved = grid.data[2];
      expect(await grid.editCell(2, 'name')).to.equal(true);
      await settle(grid);
      type(editorOf(cellOf(rowAt(grid, 2), 'name'))!, 'n14y');
      const before = grid.scrollTop;

      grid.sort({ key: 'name', direction: 'ascending' });
      await settle(grid);

      const row = bodyRows(grid).find((entry) => entry.data === moved)!;
      expect(row?.index, 'the record moved down').to.equal(14);
      const resumed = editorOf(cellOf(row, 'name'))!;
      expect(inView(grid, resumed), 'the resumed editor sits out of view').to.equal(false);
      expect(deepActive(), 'the resumed editor has focus').to.equal(resumed);
      expect(grid.scrollTop, 'no scroll jump').to.equal(before);
    });
  });
});
