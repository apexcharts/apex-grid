import { aTimeout, expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import { sendKeys } from '@web/test-runner-commands';
import { nothing } from 'lit';
import { AsyncDirective, directive } from 'lit/async-directive.js';
import { ApexGrid } from '../src/components/grid.js';
import type ApexGridRow from '../src/components/row.js';
import type { ColumnConfiguration, GridExpansionConfiguration } from '../src/internal/types.js';
import { settle } from './utils/settle.js';

// Core `detailTemplate` content under `rowRecycling`: a body row element shows
// whatever record its slot holds next, so the detail panel content is kept per
// record and moves into whichever row shows that record. Every grid here sets
// `rowRecycling` itself, so these run in both suite groups.
// See plans/core/2026-10-27-row-recycling-plan.md, section 6.3.

interface Row {
  id: number;
  name: string;
}

interface Nested {
  n: number;
}

type NestedGrid = ApexGrid<Nested>;

const COLUMNS: ColumnConfiguration<Row>[] = [{ key: 'id', type: 'number' }, { key: 'name' }];

const records = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Row ${i + 1}` }));

const NESTED: Nested[] = [{ n: 1 }, { n: 2 }, { n: 3 }];

/** Record ids whose detail directives were disconnected. */
const disconnected: number[] = [];

/** Notes a disconnect, as a subscription in a user's detail template would. */
const watch = directive(
  class extends AsyncDirective {
    #id = 0;
    public render(id: number) {
      this.#id = id;
      return nothing;
    }
    protected override disconnected() {
      disconnected.push(this.#id);
    }
  }
);

/** A typed note and a sortable nested grid: the two kinds of detail state. */
const DETAIL: GridExpansionConfiguration<Row> = {
  enabled: true,
  detailTemplate: ({ data }) =>
    html`${watch(data.id)}<input class="note" aria-label="note ${data.id}" /><apex-grid
        style="height: 160px"
        .data=${NESTED}
        .columns=${[{ key: 'n', sort: true }]}
      ></apex-grid>`,
};

async function mount(options: { recycling: boolean; data?: Row[] }): Promise<ApexGrid<Row>> {
  ApexGrid.register();
  const host = document.createElement('div');
  host.style.height = '600px';
  const grid = await fixture<ApexGrid<Row>>(
    html`<apex-grid
      .rowRecycling=${options.recycling}
      .data=${options.data ?? records(6)}
      .columns=${COLUMNS}
      .expansion=${DETAIL}
      .rowReordering=${{ enabled: true }}
    ></apex-grid>`,
    { parentNode: host }
  );
  await settle(grid);
  return grid;
}

function bodyRows(grid: ApexGrid<Row>): ApexGridRow<Row>[] {
  const body = grid.renderRoot.querySelector('apex-virtualizer')!;
  return Array.from(body.querySelectorAll<ApexGridRow<Row>>(':scope > apex-grid-row'));
}

function rowOf(grid: ApexGrid<Row>, record: Row): ApexGridRow<Row> {
  const row = bodyRows(grid).find((each) => each.data === record);
  expect(row, `a row shows record ${record.id}`).to.exist;
  return row!;
}

function noteOf(row: ApexGridRow<Row>): HTMLInputElement | null {
  return row.renderRoot.querySelector<HTMLInputElement>('[part="detail-panel"] input.note');
}

function nestedOf(row: ApexGridRow<Row>): NestedGrid | null {
  return row.renderRoot.querySelector<NestedGrid>('[part="detail-panel"] apex-grid');
}

function sortOf(grid: NestedGrid) {
  return grid.sortExpressions.map(({ key, direction }) => ({ key, direction }));
}

/** What one record's detail shows: the row element is free to differ. */
interface Snapshot {
  note: HTMLInputElement;
  nested: NestedGrid;
}

function snapshot(grid: ApexGrid<Row>, record: Row): Snapshot {
  const row = rowOf(grid, record);
  return { note: noteOf(row)!, nested: nestedOf(row)! };
}

describe('Detail panel under row recycling', () => {
  afterEach(() => fixtureCleanup());

  it('keeps typed text and a nested sort on their records across moveRow and a master sort', async () => {
    const grid = await mount({ recycling: true });
    const [, a, , b] = grid.data;
    await grid.expandRow(a);
    await grid.expandRow(b);
    await settle(grid);

    const before = new Map<Row, Snapshot>([
      [a, snapshot(grid, a)],
      [b, snapshot(grid, b)],
    ]);
    before.get(a)!.note.value = 'note A';
    before.get(b)!.note.value = 'note B';
    before.get(a)!.nested.sort({ key: 'n', direction: 'descending' });
    before.get(b)!.nested.sort({ key: 'n', direction: 'ascending' });
    await settle(before.get(a)!.nested);
    await settle(before.get(b)!.nested);
    const elements = bodyRows(grid);

    const check = (step: string) => {
      for (const [record, own] of before) {
        const row = rowOf(grid, record);
        const label = `${step}, record ${record.id}`;
        expect(noteOf(row), `${label}: its own note`).to.equal(own.note);
        expect(own.note.value, `${label}: typed text`).to.equal(`note ${record === a ? 'A' : 'B'}`);
        expect(nestedOf(row), `${label}: its own nested grid`).to.equal(own.nested);
        expect(sortOf(own.nested), `${label}: nested sort`).to.deep.equal([
          { key: 'n', direction: record === a ? 'descending' : 'ascending' },
        ]);
      }
      // Each detail shows in exactly one row, and only expanded records have one.
      for (const row of bodyRows(grid)) {
        const expanded = row.data === a || row.data === b;
        expect(
          row.renderRoot.querySelectorAll('[part="detail-panel"]').length,
          `${step}, record ${row.data.id}: detail panels`
        ).to.equal(expanded ? 1 : 0);
      }
    };

    // A (index 1) lands after B (index 3): the slots in between re-bind.
    expect(grid.moveRow(1, 3, 'after')).to.equal(true);
    await settle(grid);
    expect(grid.pageItems.indexOf(a), 'A moved past B').to.be.greaterThan(
      grid.pageItems.indexOf(b)
    );
    expect(bodyRows(grid), 'the rows were re-bound, not rebuilt').to.eql(elements);
    check('moveRow');

    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);
    expect(grid.pageItems[0].id, 'the master is sorted').to.equal(6);
    check('master sort');
  });

  for (const change of ['insert above', 'remove above'] as const) {
    it(`typing into a detail input carries on after an ${change} moves its record`, async () => {
      const grid = await mount({ recycling: true, data: records(12) });
      const record = grid.data[5];
      await grid.expandRow(record);
      await settle(grid);
      const note = noteOf(rowOf(grid, record))!;
      note.focus();
      await sendKeys({ type: 'abc' });

      // The record changes row, and its detail follows it into that row.
      grid.data =
        change === 'insert above' ? [{ id: 99, name: 'new' }, ...grid.data] : grid.data.slice(1);
      await settle(grid);
      await nextFrame();
      expect(noteOf(rowOf(grid, record)), 'the same input').to.equal(note);
      await sendKeys({ type: 'XYZ' });

      expect(note.value).to.equal('abcXYZ');
      let focused: Element | null = document.activeElement;
      while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
      expect(focused, 'focus stays in the input').to.equal(note);
    });
  }

  it('a click out of a detail input is not undone by a later data change', async () => {
    const grid = await mount({ recycling: true, data: records(12) });
    const record = grid.data[5];
    await grid.expandRow(record);
    await settle(grid);
    noteOf(rowOf(grid, record))!.focus();
    (document.activeElement as HTMLElement).blur();

    grid.data = [{ id: 99, name: 'new' }, ...grid.data];
    await settle(grid);
    await nextFrame();
    expect(document.activeElement).to.equal(document.body);
  });

  for (const recycling of [true, false]) {
    const mode = recycling ? 'recycled rows' : 'item rows';

    it(`${mode}: builds fresh detail for a record that left the rendered rows`, async () => {
      // Pin for the cache's drop rule (entries live only while a body row shows
      // them), run against item keys too, so the two modes stay alike.
      const grid = await mount({ recycling, data: records(400) });
      const record = grid.data[2];
      await grid.expandRow(record);
      await settle(grid);
      const own = snapshot(grid, record);
      own.note.value = 'typed';
      own.nested.sort({ key: 'n', direction: 'descending' });
      await settle(own.nested);
      disconnected.length = 0;

      grid.scrollTop = grid.scrollHeight;
      await settle(grid);
      expect(
        bodyRows(grid).some((row) => row.data === record),
        'scrolled away'
      ).to.equal(false);
      expect(disconnected, 'its directives were disconnected').to.include(record.id);
      grid.scrollTop = 0;
      await settle(grid);

      const back = snapshot(grid, record);
      expect(back.note, 'a new note').to.not.equal(own.note);
      expect(back.note.value).to.equal('');
      expect(back.nested, 'a new nested grid').to.not.equal(own.nested);
      expect(sortOf(back.nested)).to.deep.equal([]);
    });

    it(`${mode}: builds fresh detail after a collapse the row rendered, not one it did not`, async () => {
      // Pin, same rule in both modes: the panel survives only if its row never
      // rendered the record collapsed.
      const grid = await mount({ recycling });
      const record = grid.data[1];
      await grid.expandRow(record);
      await settle(grid);
      const own = snapshot(grid, record);
      own.note.value = 'typed';

      // Collapsed and expanded again before the row updates: it never closed.
      void grid.collapseRow(record);
      void grid.expandRow(record);
      await settle(grid);
      expect(snapshot(grid, record).note, 'the same note').to.equal(own.note);
      expect(own.note.value).to.equal('typed');

      // Collapsed, rendered, and expanded again within the frame: it closed.
      const row = rowOf(grid, record);
      await grid.collapseRow(record);
      await grid.updateComplete;
      await row.updateComplete;
      expect(noteOf(row), 'rendered collapsed').to.equal(null);
      await grid.expandRow(record);
      await settle(grid);
      const fresh = snapshot(grid, record);
      expect(fresh.note, 'a new note').to.not.equal(own.note);
      expect(fresh.note.value).to.equal('');
    });
  }

  for (const recycling of [true, false]) {
    const mode = recycling ? 'recycled rows' : 'item rows';

    it(`${mode}: a filter that empties the body, cleared, builds fresh detail`, async () => {
      // No row renders while the body is empty, so the rows that leave it
      // prune the detail roots themselves.
      const grid = await mount({ recycling });
      grid.expansion = {
        enabled: true,
        detailTemplate: ({ data }) => html`${watch(data.id)}<input class="note" />`,
      };
      const record = grid.data[0];
      await grid.expandRow(record);
      await settle(grid);
      const own = noteOf(rowOf(grid, record))!;
      own.value = 'typed';
      disconnected.length = 0;

      grid.filter({ key: 'id', condition: 'greaterThan', searchTerm: 100 });
      await settle(grid);
      expect(bodyRows(grid).length, 'no rows').to.equal(0);
      await aTimeout(100);
      expect(disconnected, 'its directives were disconnected').to.include(record.id);

      grid.clearFilter();
      await settle(grid);
      const back = noteOf(rowOf(grid, record))!;
      expect(back, 'a new note').to.not.equal(own);
      expect(back.value).to.equal('');
    });

    it(`${mode}: every expanded row shows its detail after a filter shrinks the range and clears`, async () => {
      // A row set aside as a spare keeps the root node it committed after
      // another row took that node; shown that record again, it must commit
      // the node anew rather than skip it as unchanged.
      const grid = await mount({ recycling, data: records(60) });
      grid.expansion = {
        enabled: true,
        detailTemplate: ({ data }) =>
          html`<div class="d" style="height: 20px">detail ${data.id}</div>`,
      };
      for (const record of grid.data) void grid.expandRow(record);
      await settle(grid);

      const faults = () =>
        bodyRows(grid)
          .map((row) => ({
            id: row.data.id,
            text: row.renderRoot.querySelector('[part="detail-panel"] .d')?.textContent ?? '',
          }))
          .filter(({ id, text }) => text !== `detail ${id}`);
      expect(faults(), 'before').to.eql([]);

      grid.filter({ key: 'name', condition: 'contains', searchTerm: 'Row 1' });
      await settle(grid);
      expect(faults(), 'filtered').to.eql([]);
      grid.clearFilter();
      await settle(grid);
      for (let i = 0; i < 6; i++) await nextFrame();
      expect(bodyRows(grid).length, 'rows rendered').to.be.greaterThan(16);
      expect(faults(), 'cleared').to.eql([]);
    });
  }

  it('drops the detail of a record whose row was set aside as a spare', async () => {
    const grid = await mount({ recycling: true, data: records(400) });
    grid.pagination = { enabled: true, pageSize: 100 };
    await settle(grid);
    const record = grid.pageItems[14];
    await grid.expandRow(record);
    await settle(grid);
    rowOf(grid, record);
    disconnected.length = 0;

    // Index 14 leaves the page: its row waits, disconnected, in the spares.
    grid.pageSize = 10;
    await settle(grid);
    await nextFrame();
    await nextFrame();
    expect(bodyRows(grid).length).to.equal(10);
    expect(disconnected, 'its directives were disconnected').to.include(record.id);
  });

  it('keeps detail roots while the grid is out of the document', async () => {
    const grid = await mount({ recycling: true });
    const record = grid.data[1];
    await grid.expandRow(record);
    await settle(grid);
    const own = snapshot(grid, record);
    own.note.value = 'typed';
    own.nested.sort({ key: 'n', direction: 'descending' });
    await settle(own.nested);
    disconnected.length = 0;

    const host = grid.parentElement!;
    const parent = host.parentNode!;
    host.remove();
    await nextFrame();
    await nextFrame();
    await aTimeout(20);
    parent.appendChild(host);
    await settle(grid);
    // A master sort re-renders every row: a dropped root would build anew.
    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);

    expect(disconnected, 'nothing disconnected').to.eql([]);
    const back = snapshot(grid, record);
    expect(back.note, 'the same note').to.equal(own.note);
    expect(own.note.value).to.equal('typed');
    expect(back.nested, 'the same nested grid').to.equal(own.nested);
    expect(sortOf(own.nested)).to.deep.equal([{ key: 'n', direction: 'descending' }]);
  });

  it('gives a pinned band row keyed detail, not the body root', async () => {
    // A band row re-binds when the band shifts, and the record left the body:
    // like item rows, the band builds its own detail.
    const grid = await mount({ recycling: true });
    grid.rowPinning = { enabled: true };
    await settle(grid);
    const record = grid.data[1];
    await grid.expandRow(record);
    await settle(grid);
    const own = snapshot(grid, record);
    own.note.value = 'typed';

    grid.pinRow(record, 'top');
    await settle(grid);
    const band = grid.renderRoot.querySelector<HTMLElement>('[part~="pinned-top"]')!;
    const row = band.querySelector<ApexGridRow<Row>>('apex-grid-row')!;
    expect(row.data).to.equal(record);
    const region = row.renderRoot.querySelector('[part="detail-panel"] [role="region"]')!;
    expect(
      Array.from(region.children).map((child) => child.localName),
      'the template output, unwrapped'
    ).to.eql(['input', 'apex-grid']);
    expect(noteOf(row), 'a new note').to.not.equal(own.note);
    expect(noteOf(row)!.value).to.equal('');
  });

  it('renders the template straight into the panel when rows are not recycled', async () => {
    // Pin: with `rowRecycling` off the panel is today's keyed template, no container.
    const grid = await mount({ recycling: false });
    const record = grid.data[1];
    await grid.expandRow(record);
    await settle(grid);
    const region = rowOf(grid, record).renderRoot.querySelector(
      '[part="detail-panel"] [role="region"]'
    )!;
    expect(
      Array.from(region.children).map((child) => child.localName),
      'the template output, unwrapped'
    ).to.eql(['input', 'apex-grid']);
  });

  it('re-renders the detail content with the current row index', async () => {
    const grid = await mount({ recycling: true });
    grid.expansion = {
      enabled: true,
      detailTemplate: ({ data, rowIndex }) => html`<span class="at">${data.id}@${rowIndex}</span>`,
    };
    const record = grid.data[1];
    await grid.expandRow(record);
    await settle(grid);
    const label = () =>
      rowOf(grid, record).renderRoot.querySelector('[part="detail-panel"] .at')?.textContent;
    expect(label()).to.equal('2@1');

    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);
    expect(label(), 'the index it shows now').to.equal('2@4');
  });
});
