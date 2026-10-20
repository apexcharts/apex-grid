import { expect, fixture, fixtureCleanup, html, nextFrame, waitUntil } from '@open-wc/testing';
import type { ApexCellValueChangedEvent } from '../src/components/grid.js';
import { ApexGrid } from '../src/components/grid.js';
import type { ColumnConfiguration, PaginationConfiguration } from '../src/internal/types.js';

// Undo history and bulk edits: history follows data replacement, nested
// batches flatten into one undo step, replay reports where the record is now,
// and applyEdits can address any record, not only the current page.

interface Row {
  id: number;
  name: string;
  amount: number;
  code: string;
}

function rows(count = 6): Row[] {
  return Array.from({ length: count }, (_, id) => ({
    id,
    name: `Row ${id}`,
    amount: id * 10,
    code: 'A',
  }));
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number' },
  { key: 'name', editable: true },
  {
    key: 'amount',
    type: 'number',
    editable: true,
    validators: [(value: unknown) => (Number(value) >= 0 ? null : 'no negatives')],
  },
  { key: 'code', editable: true },
];

async function mount(options: { data?: Row[]; pagination?: PaginationConfiguration } = {}) {
  ApexGrid.register();
  const parent = document.createElement('div');
  parent.style.height = '500px';
  const grid = await fixture<ApexGrid<Row>>(
    html`<apex-grid
      .data=${options.data ?? rows()}
      .columns=${columns}
      .editing=${{ enabled: true, history: { enabled: true } }}
      .pagination=${options.pagination ?? { enabled: false }}
    ></apex-grid>`,
    { parentNode: parent }
  );
  await grid.updateComplete;
  await nextFrame();
  await waitUntil(() => grid.rows.length > 0, 'body rows never rendered');
  return grid;
}

function changedEvents(grid: ApexGrid<Row>) {
  const events: ApexCellValueChangedEvent<Row>[] = [];
  grid.addEventListener('cellValueChanged', (event) => {
    events.push((event as CustomEvent<ApexCellValueChangedEvent<Row>>).detail);
  });
  return events;
}

describe('undo history and bulk edits', () => {
  afterEach(() => fixtureCleanup());

  describe('data replacement', () => {
    it('clears history when grid.data is replaced by new records', async () => {
      const grid = await mount();
      grid.applyEdits([{ rowIndex: 0, column: 'name', value: 'Renamed' }]);
      expect(grid.canUndo).to.be.true;

      // The app reloads fresh rows (new object identities).
      grid.data = structuredClone(grid.data);
      await grid.updateComplete;

      const events = changedEvents(grid);
      const canUndoAfterReset = grid.canUndo;
      grid.undo();
      await grid.updateComplete;

      const detached = events.filter((d) => !grid.data.includes(d.data));
      expect({ canUndoAfterReset, detachedEvents: detached.length }).to.deep.equal({
        canUndoAfterReset: false,
        detachedEvents: 0,
      });
      expect(grid.data[0].name).to.equal('Renamed');
    });

    it('keeps history when the new data keeps the edited records', async () => {
      const grid = await mount();
      grid.applyEdits([{ rowIndex: 0, column: 'name', value: 'Renamed' }]);

      grid.data = [...grid.data, { id: 99, name: 'New', amount: 1, code: 'A' }];
      await grid.updateComplete;

      expect(grid.canUndo).to.be.true;
      grid.undo();
      await grid.updateComplete;
      expect(grid.data[0].name).to.equal('Row 0');
    });

    it('a row model can keep history for records it caches outside data', async () => {
      // Stands in for a server-side row model: collapsing a group drops its
      // rows from `data`, but the model keeps them and re-expands the same
      // objects, so their undo history must survive.
      const tag = 'history-window-grid';
      if (!customElements.get(tag)) {
        customElements.define(
          tag,
          class extends ApexGrid<Row> {
            public cache: Row[] = [];
            protected override historyRecords(): Iterable<Row> {
              return [...this.data, ...this.cache];
            }
          }
        );
      }
      const parent = await fixture<HTMLDivElement>(html`<div style="height: 500px"></div>`);
      const grid = document.createElement(tag) as ApexGrid<Row> & { cache: Row[] };
      const all = rows();
      grid.cache = all;
      grid.columns = columns;
      grid.editing = { enabled: true, history: { enabled: true } };
      grid.pagination = { enabled: false };
      grid.data = all;
      parent.append(grid);
      await grid.updateComplete;

      grid.applyEdits([{ rowIndex: 1, column: 'name', value: 'Edited' }]);
      grid.data = all.slice(2); // collapse the group holding row 1
      await grid.updateComplete;
      expect(grid.canUndo, 'cached record keeps history').to.be.true;

      grid.cache = []; // the model discards its cache (a refresh)
      grid.data = all.slice(3);
      await grid.updateComplete;
      expect(grid.canUndo, 'discarded record clears history').to.be.false;
      expect(all[1].name).to.equal('Edited');
    });
  });

  describe('nested batches', () => {
    it('a listener batch inside an outer batch still undoes as one step', async () => {
      const grid = await mount();
      // Derive `code` from `name` through a nested applyEdits.
      const derive = (event: Event) => {
        const { key, data } = (event as CustomEvent<ApexCellValueChangedEvent<Row>>).detail;
        if (key !== 'name') return;
        grid.applyEdits([{ rowIndex: grid.pageItems.indexOf(data), column: 'code', value: 'B' }]);
      };
      grid.addEventListener('cellValueChanged', derive);

      grid.applyEdits([
        { rowIndex: 0, column: 'name', value: 'X' },
        { rowIndex: 1, column: 'name', value: 'Y' },
      ]);
      await grid.updateComplete;
      expect(grid.data.map((r) => r.code).slice(0, 2)).to.eql(['B', 'B']);

      // Replay re-emits cellValueChanged; keep the listener out of the undo.
      grid.removeEventListener('cellValueChanged', derive);
      grid.undo();
      await grid.updateComplete;
      expect(grid.data.slice(0, 2).map((r) => [r.name, r.code])).to.eql([
        ['Row 0', 'A'],
        ['Row 1', 'A'],
      ]);
      expect(grid.canUndo, 'one step reverts the whole batch').to.be.false;
    });
  });

  describe('replay', () => {
    it('reads the view once per undo, not once per change', async () => {
      const grid = await mount({ data: rows(40) });
      grid.applyEdits(
        grid.data.map((_, rowIndex) => ({ rowIndex, column: 'name' as const, value: 'Z' }))
      );

      const descriptor = Object.getOwnPropertyDescriptor(ApexGrid.prototype, 'pageItems')!;
      let reads = 0;
      Object.defineProperty(grid, 'pageItems', {
        configurable: true,
        get() {
          reads += 1;
          return descriptor.get!.call(this);
        },
      });
      try {
        grid.undo();
      } finally {
        delete (grid as unknown as Record<string, unknown>).pageItems;
      }
      expect(grid.data[39].name).to.equal('Row 39');
      expect(reads, 'pageItems reads during one undo of 40 cells').to.be.at.most(1);
    });

    it('reports rowIndex -1 when the undone record is on another page', async () => {
      const grid = await mount({ pagination: { enabled: true, pageSize: 3 } });
      grid.applyEdits([{ rowIndex: 2, column: 'name', value: 'Renamed' }]);
      await grid.gotoPage(1);
      await grid.updateComplete;

      const events = changedEvents(grid);
      grid.undo();
      expect(events).to.have.length(1);
      expect(events[0].data).to.equal(grid.data[2]);
      expect(events[0].rowIndex).to.equal(-1);
    });
  });
});
