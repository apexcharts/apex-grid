import { expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
import { type ColumnConfiguration, max } from 'apex-grid';
import { getGroupMeta } from '../src/features/grouping.js';
import { ApexGridEnterprise, enterpriseModules } from '../src/index.js';
import { settle } from './settle.js';

// Range paste and fill: the editing gate, formula history, type coercion,
// quoted TSV, synthetic rows, overlapping formula paste, series typing and
// the clipboard-event fallback.

interface Row {
  id: number; // A
  name: string; // B
  qty: number; // C
  price: number; // D
  total: number | null; // E
  zip?: string; // F
}

function editable<T extends object>(columns: ColumnConfiguration<T>[]): ColumnConfiguration<T>[] {
  return columns.map((column) => ({ ...column, editable: true }) as ColumnConfiguration<T>);
}

const baseColumns: ColumnConfiguration<Row>[] = editable<Row>([
  { key: 'id', type: 'number' },
  { key: 'name', type: 'string' },
  { key: 'qty', type: 'number' },
  { key: 'price', type: 'number' },
  { key: 'total', type: 'number', allowFormula: true },
  { key: 'zip', type: 'string' },
]);

function rows(): Row[] {
  return [
    { id: 1, name: 'a', qty: 2, price: 5, total: 0, zip: '02139' },
    { id: 2, name: 'b', qty: 3, price: 7, total: 99, zip: '0101' },
    { id: 3, name: 'c', qty: 4, price: 9, total: 0, zip: '0102' },
    { id: 4, name: 'd', qty: 5, price: 11, total: 0, zip: '9' },
  ];
}

function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '600px';
  return node;
}

async function mount<T extends object>(
  data: T[],
  columns: ColumnConfiguration<T>[],
  editing: object = { enabled: true },
  extra: { groupBy?: string[] } = {}
): Promise<ApexGridEnterprise<T>> {
  const grid = await fixture<ApexGridEnterprise<T>>(
    html`<apex-grid-enterprise
      .data=${data}
      .columns=${columns}
      .editing=${editing}
      .groupBy=${extra.groupBy ?? []}
    ></apex-grid-enterprise>`,
    { parentNode: sizedParent() }
  );
  await settle(grid);
  return grid;
}

/** Temporarily replace `navigator.clipboard` (or remove it with `null`). */
async function withClipboard(
  value: { writeText(t: string): Promise<void>; readText(): Promise<string> } | null,
  run: () => Promise<void>
): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: value ?? undefined });
  try {
    await run();
  } finally {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'clipboard');
  }
}

/** A rendered body cell, focused so the grid owns keyboard focus. */
function focusCell(grid: ApexGridEnterprise<Row>, rowIndex: number, key: string): HTMLElement {
  for (const row of grid.rows) {
    if (row.index !== rowIndex) continue;
    const cell = row.cells.find((c) => String(c.column.key) === key);
    if (cell) {
      (cell as unknown as HTMLElement).focus();
      return cell as unknown as HTMLElement;
    }
  }
  throw new Error(`no rendered cell ${rowIndex}:${key}`);
}

describe('range paste and fill', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());
  /** The stubbed clipboard's contents. */
  let buffer = '';

  // --- ent-range-b-1: the editing gate ------------------------------------

  describe('editing gate', () => {
    const mixed: ColumnConfiguration<Row>[] = [
      { key: 'id', type: 'number' },
      { key: 'name', type: 'string', editable: true },
      { key: 'qty', type: 'number', editable: true },
      { key: 'price', type: 'number' },
      { key: 'total', type: 'number', allowFormula: true },
    ];

    it('paste and fill write nothing into a read-only grid', async () => {
      const data = rows();
      const grid = await mount(data, baseColumns, {});
      grid.selectRange({ row: 0, column: 'id' });
      grid.pasteText('999\tz');
      expect(data[0].id).to.equal(1);
      expect(data[0].name).to.equal('a');

      grid.selectRange({ row: 0, column: 'qty' });
      grid.fillTo({ row: 2, column: 'qty' });
      expect(data[1].qty).to.equal(3);
      expect(data[2].qty).to.equal(4);
    });

    it('skips non-editable columns and writes editable ones', async () => {
      const data = rows();
      const grid = await mount(data, mixed);
      grid.selectRange({ row: 0, column: 'id' });
      grid.pasteText('999\tz\t8\t1');
      expect(data[0].id, 'non-editable id').to.equal(1);
      expect(data[0].name).to.equal('z');
      expect(data[0].qty).to.equal(8);
      expect(data[0].price, 'non-editable price').to.equal(5);

      grid.selectRange({ row: 0, column: 'id' }, { row: 0, column: 'qty' });
      grid.fillTo({ row: 1, column: 'qty' });
      expect(data[1].id, 'fill into non-editable id').to.equal(2);
      expect(data[1].name).to.equal('z');
    });

    it('never writes a formula into a non-editable formula column', async () => {
      const data = rows();
      const grid = await mount(data, mixed);
      grid.setFormula(data[0], 'total', '=C1*D1');
      grid.selectRange({ row: 0, column: 'total' });
      grid.fillTo({ row: 1, column: 'total' });
      expect(grid.getFormula(data[1], 'total')).to.equal(undefined);
      expect(data[1].total).to.equal(99);
    });
  });

  // --- ent-range-b-4: formula paste and fill through the edit path --------

  describe('formula paste and fill history', () => {
    it('a formula fill over a literal is one undoable step', async () => {
      const data = rows();
      const grid = await mount(data, baseColumns, { enabled: true, history: { enabled: true } });
      grid.setFormula(data[0], 'total', '=C1*D1');
      grid.clearHistory();

      grid.selectRange({ row: 0, column: 'total' });
      grid.fillTo({ row: 1, column: 'total' });
      await grid.updateComplete;
      expect(data[1].total).to.equal(21);
      expect(grid.getFormula(data[1], 'total')).to.equal('=C2*D2');
      expect(grid.canUndo, 'canUndo after formula fill').to.be.true;

      grid.undo();
      await grid.updateComplete;
      expect(data[1].total, 'literal restored').to.equal(99);
      expect(grid.getFormula(data[1], 'total')).to.equal(undefined);
      // The restored literal no longer follows the formula's inputs.
      grid.selectRange({ row: 1, column: 'qty' });
      grid.pasteText('10');
      expect(data[1].total).to.equal(99);
    });

    it('undo after a formula fill leaves an earlier unrelated edit alone', async () => {
      const data = rows();
      const grid = await mount(data, baseColumns, { enabled: true, history: { enabled: true } });
      grid.setFormula(data[0], 'total', '=C1*D1');
      grid.selectRange({ row: 1, column: 'price' });
      grid.pasteText('8');
      grid.selectRange({ row: 0, column: 'total' });
      grid.fillTo({ row: 1, column: 'total' });
      expect(data[1].total).to.equal(24);
      grid.undo();
      expect(data[1].price).to.equal(8);
      expect(data[1].total).to.equal(99);
    });

    it('a cancelled cellValueChanging blocks a formula fill', async () => {
      const data = rows();
      const grid = await mount(data, baseColumns);
      grid.setFormula(data[0], 'total', '=C1*D1');
      const seen: unknown[] = [];
      grid.addEventListener('cellValueChanging', (event) => {
        const detail = (event as CustomEvent<{ key: string; newValue: unknown }>).detail;
        seen.push(detail.newValue);
        if (detail.key === 'total') event.preventDefault();
      });
      grid.selectRange({ row: 0, column: 'total' });
      grid.fillTo({ row: 1, column: 'total' });
      expect(seen).to.deep.equal([21]);
      expect(data[1].total).to.equal(99);
      expect(grid.getFormula(data[1], 'total')).to.equal(undefined);
    });

    it('a column validator rejects a formula value', async () => {
      const data = rows();
      const columns = baseColumns.map((column) =>
        column.key === 'total' ? { ...column, validators: [max(20)] } : column
      ) as ColumnConfiguration<Row>[];
      const grid = await mount(data, columns);
      grid.setFormula(data[0], 'total', '=C1*D1'); // 10
      grid.selectRange({ row: 0, column: 'total' });
      grid.fillTo({ row: 2, column: 'total' }); // 21 rejected, 36 rejected
      expect(data[1].total).to.equal(99);
      expect(grid.getFormula(data[1], 'total')).to.equal(undefined);
    });
  });

  // --- ent-range-b-8: overlapping in-grid formula paste --------------------

  it('an overlapping formula paste reads the source snapshot', async () => {
    const data = rows();
    const grid = await mount(data, baseColumns);
    grid.setFormula(data[0], 'total', '=C1');
    grid.setFormula(data[1], 'total', '=C2*2');
    await withClipboard(
      {
        writeText: async (t) => {
          buffer = t;
        },
        readText: async () => buffer,
      },
      async () => {
        grid.selectRange({ row: 0, column: 'total' }, { row: 1, column: 'total' });
        expect(await grid.copySelection()).to.be.true;
        grid.selectRange({ row: 1, column: 'total' });
        grid.pasteText(buffer);
      }
    );
    expect(grid.getFormula(data[1], 'total')).to.equal('=C2');
    expect(grid.getFormula(data[2], 'total')).to.equal('=C3*2');
    expect(data[2].total).to.equal(8);
  });

  // --- ent-range-b-3: coercion to the column type --------------------------

  describe('type coercion', () => {
    interface Typed {
      active: boolean;
      price: number | null;
      stars: number;
      done: number;
      when: Date | null;
      day: string;
    }
    const typedColumns = editable<Typed>([
      { key: 'active', type: 'boolean' },
      { key: 'price', type: 'currency' },
      { key: 'stars', type: 'rating' },
      { key: 'done', type: 'progress' },
      { key: 'when', type: 'date' },
      { key: 'day', type: 'date' },
    ]);
    function typedRows(): Typed[] {
      return [1, 2, 3].map((n) => ({
        active: true,
        price: n,
        stars: n,
        done: n,
        when: new Date(2024, 0, n),
        day: `2024-01-0${n}`,
      }));
    }

    it('pastes spreadsheet booleans and numeric types as typed values', async () => {
      const data = typedRows();
      const grid = await mount(data, typedColumns);
      grid.selectRange({ row: 0, column: 'active' });
      grid.pasteText('FALSE\t7\t4\t50\nTrue\t\t2\t1');
      expect(data[0].active).to.equal(false);
      expect(data[0].price).to.equal(7);
      expect(data[0].stars).to.equal(4);
      expect(data[0].done).to.equal(50);
      expect(data[1].active).to.equal(true);
      expect(data[1].price, 'empty paste clears to null').to.equal(null);
    });

    it('a pasted currency column sorts numerically', async () => {
      const data = typedRows();
      const grid = await mount(data, typedColumns);
      grid.selectRange({ row: 0, column: 'price' });
      grid.pasteText('5\n10\n20');
      grid.sort({ key: 'price', direction: 'ascending' });
      await grid.updateComplete;
      expect((grid.dataView as Typed[]).map((r) => r.price)).to.eql([5, 10, 20]);
    });

    it('keeps the stored shape of a date column through copy and paste', async () => {
      const data = typedRows();
      const grid = await mount(data, typedColumns);
      grid.selectRange({ row: 0, column: 'when' }, { row: 0, column: 'day' });
      const tsv = grid.getSelectionTSV();
      grid.selectRange({ row: 2, column: 'when' });
      grid.pasteText(tsv);
      expect(data[2].when).to.be.instanceOf(Date);
      expect((data[2].when as Date).getTime()).to.equal(new Date(2024, 0, 1).getTime());
      expect(data[2].day).to.equal('2024-01-01');
    });

    it('writes a string-shaped date column in the editor shape', async () => {
      const data = typedRows();
      const grid = await mount(data, typedColumns);
      grid.selectRange({ row: 0, column: 'day' });
      grid.pasteText('3/15/2026\nnot a date');
      expect(data[0].day).to.equal('2026-03-15');
      expect(data[1].day, 'text that does not parse stays text').to.equal('not a date');

      // An in-grid copy of a Date cell serialises as an ISO timestamp.
      grid.selectRange({ row: 2, column: 'day' });
      grid.pasteText(new Date(2026, 2, 14).toISOString());
      expect(data[2].day).to.equal('2026-03-14');
      grid.sort({ key: 'day', direction: 'ascending' });
      await grid.updateComplete;
      expect((grid.dataView as Typed[]).map((r) => r.day)).to.eql([
        '2026-03-14',
        '2026-03-15',
        'not a date',
      ]);
    });

    it('clamps a pasted rating to its stars', async () => {
      const data = typedRows();
      const grid = await mount(data, typedColumns);
      grid.selectRange({ row: 0, column: 'stars' });
      grid.pasteText('9\n-2\n3.6');
      expect(data.map((r) => r.stars)).to.eql([5, 0, 4]);
    });

    it('maps pasted text to a select option value', async () => {
      interface Pick {
        level: number | string;
      }
      const data: Pick[] = [{ level: 1 }, { level: 1 }, { level: 1 }];
      const columns = editable<Pick>([
        { key: 'level', type: 'select', options: [1, { value: 2, label: 'Two' }, 3] },
      ]);
      const grid = await mount(data, columns);
      grid.selectRange({ row: 0, column: 'level' });
      grid.pasteText('3\nTwo\nnone');
      expect(data.map((r) => r.level)).to.eql([3, 2, 'none']);

      // An in-grid copy and paste keeps the option value's type.
      grid.selectRange({ row: 0, column: 'level' });
      const tsv = grid.getSelectionTSV();
      grid.selectRange({ row: 2, column: 'level' });
      grid.pasteText(tsv);
      expect(data[2].level).to.equal(3);
    });

    it('prefers an option value over a label that spells another value', async () => {
      interface Pick {
        level: number;
      }
      // Zero-based values with one-based labels: label '1' spells value 1.
      const options = [
        { value: 0, label: '1' },
        { value: 1, label: '2' },
        { value: 2, label: '3' },
      ];
      const data: Pick[] = [{ level: 1 }, { level: 2 }];
      const grid = await mount(data, editable<Pick>([{ key: 'level', type: 'select', options }]));
      grid.selectRange({ row: 0, column: 'level' });
      const tsv = grid.getSelectionTSV();
      expect(tsv).to.equal('1');
      grid.pasteText(tsv);
      expect(data[0].level).to.equal(1);

      // A label still maps when no option has that value.
      grid.selectRange({ row: 1, column: 'level' });
      grid.pasteText('3');
      expect(data[1].level).to.equal(2);
    });
  });

  // --- ent-range-a-2 / ent-range-b-2: quoted TSV --------------------------

  describe('quoted TSV', () => {
    it('round-trips a value containing a tab without shifting columns', async () => {
      const data = rows();
      data[0].name = 'A\tB';
      const grid = await mount(data, baseColumns);
      grid.selectRange({ row: 0, column: 'name' }, { row: 0, column: 'qty' });
      const tsv = grid.getSelectionTSV();
      grid.selectRange({ row: 2, column: 'name' });
      grid.pasteText(tsv);
      expect(data[2].name).to.equal('A\tB');
      expect(data[2].qty).to.equal(2);
      expect(data[2].price, 'outside the copied width').to.equal(9);
    });

    it('round-trips newlines and quotes without spilling into the next row', async () => {
      const data = rows();
      data[0].name = 'Call back\nMonday';
      data[1].name = 'say "hi"';
      const grid = await mount(data, baseColumns);
      grid.selectRange({ row: 0, column: 'name' }, { row: 1, column: 'name' });
      const tsv = grid.getSelectionTSV();
      expect(tsv).to.equal('"Call back\nMonday"\n"say ""hi"""');
      grid.selectRange({ row: 2, column: 'name' });
      grid.pasteText(tsv);
      expect(data[2].name).to.equal('Call back\nMonday');
      expect(data[3].name).to.equal('say "hi"');
    });

    it('pastes a quoted multi-line spreadsheet cell as one cell', async () => {
      const data = rows();
      const grid = await mount(data, baseColumns);
      grid.selectRange({ row: 1, column: 'name' });
      grid.pasteText('"Line one\r\nLine two"\r\n');
      expect(data[1].name).to.equal('Line one\nLine two');
      expect(data[2].name).to.equal('c');
    });

    it('copies plain text exactly as before and keeps stray quotes literal', async () => {
      const data = rows();
      data[1].name = '5" screen';
      const grid = await mount(data, baseColumns);
      grid.selectRange({ row: 0, column: 'id' }, { row: 0, column: 'price' });
      expect(grid.getSelectionTSV()).to.equal('1\ta\t2\t5');
      grid.selectRange({ row: 2, column: 'name' });
      grid.pasteText('5" screen\tx');
      expect(data[2].name).to.equal('5" screen');
      // An unclosed quote is text; an empty quoted field is an empty cell.
      grid.selectRange({ row: 3, column: 'name' });
      grid.pasteText('"open\t""');
      expect(data[3].name).to.equal('"open');
      expect(data[3].qty).to.equal(null);
    });
  });

  // --- ent-range-b-7: synthetic rows ---------------------------------------

  it('paste and fill skip group header rows', async () => {
    interface G {
      team: string;
      note: string;
      n: number;
    }
    const data: G[] = [
      { team: 'A', note: 'a1', n: 1 },
      { team: 'A', note: 'a2', n: 2 },
      { team: 'B', note: 'b1', n: 3 },
      { team: 'B', note: 'b2', n: 4 },
    ];
    const columns = editable<G>([
      { key: 'team', type: 'string' },
      { key: 'note', type: 'string' },
      { key: 'n', type: 'number' },
    ]);
    const grid = await mount(data, columns, { enabled: true }, { groupBy: ['team'] });
    const items = grid.pageItems as G[];
    const lastA = items.indexOf(data[1]);
    expect(getGroupMeta(items[lastA + 1]), 'a header follows').to.be.ok;

    const changed: unknown[] = [];
    grid.addEventListener('cellValueChanged', (e) => changed.push((e as CustomEvent).detail.data));
    grid.selectRange({ row: lastA, column: 'note' });
    grid.pasteText('x\ny\nz');
    expect(data.map((r) => r.note)).to.eql(['a1', 'x', 'y', 'z']);
    expect(changed.every((row) => data.includes(row as G))).to.be.true;

    // A vertical series across the header extrapolates over data rows only.
    await grid.updateComplete;
    const view = grid.pageItems as G[];
    grid.selectRange(
      { row: view.indexOf(data[0]), column: 'n' },
      { row: view.indexOf(data[1]), column: 'n' }
    );
    grid.fillTo({ row: view.indexOf(data[3]), column: 'n' });
    expect(data.map((r) => r.n)).to.eql([1, 2, 3, 4]);
    grid.selectRange(
      { row: view.indexOf(data[0]), column: 'n' },
      { row: view.indexOf(data[1]), column: 'n' }
    );
    grid.pasteText('10\n20');
    grid.fillTo({ row: view.indexOf(data[3]), column: 'n' });
    expect(data.map((r) => r.n)).to.eql([10, 20, 30, 40]);
  });

  // --- ent-range-b-6: series only in numeric columns -----------------------

  it('fill copies numeric-looking strings in a string column unchanged', async () => {
    const data = rows();
    const grid = await mount(data, baseColumns);
    grid.selectRange({ row: 0, column: 'zip' });
    grid.fillTo({ row: 1, column: 'zip' });
    expect(data[1].zip).to.equal('02139');

    grid.selectRange({ row: 1, column: 'zip' }, { row: 2, column: 'zip' }); // '02139', '0102'
    grid.fillTo({ row: 3, column: 'zip' });
    expect(data[3].zip).to.equal('02139');
  });

  it('fill extends a series in an untyped column that holds numbers', async () => {
    const data: { n: unknown }[] = [{ n: 1 }, { n: 2 }, { n: 0 }, { n: 0 }, { n: 0 }, { n: 0 }];
    const grid = await mount(data, editable<{ n: unknown }>([{ key: 'n' }]));
    grid.selectRange({ row: 0, column: 'n' }, { row: 1, column: 'n' });
    grid.fillTo({ row: 3, column: 'n' });
    expect(data.slice(0, 4).map((r) => r.n)).to.eql([1, 2, 3, 4]);

    data[2].n = '1';
    data[3].n = '2';
    grid.selectRange({ row: 2, column: 'n' }, { row: 3, column: 'n' });
    grid.fillTo({ row: 5, column: 'n' });
    expect(
      data.slice(4).map((r) => r.n),
      'text in an untyped column tiles'
    ).to.eql(['1', '2']);
  });

  // --- ent-range-b-10: clipboard events without the async Clipboard API ----

  describe('clipboard events', () => {
    it('keyboard copy leaves the native copy event to run and fills it', async () => {
      const data = rows();
      const grid = await mount(data, baseColumns);
      await withClipboard(null, async () => {
        grid.selectRange({ row: 0, column: 'id' }, { row: 1, column: 'name' });
        const cell = focusCell(grid, 0, 'id');
        const key = new KeyboardEvent('keydown', {
          key: 'c',
          ctrlKey: true,
          bubbles: true,
          composed: true,
          cancelable: true,
        });
        cell.dispatchEvent(key);
        expect(key.defaultPrevented, 'native copy not suppressed').to.be.false;

        const copy = new ClipboardEvent('copy', {
          clipboardData: new DataTransfer(),
          bubbles: true,
          composed: true,
          cancelable: true,
        });
        cell.dispatchEvent(copy);
        expect(copy.defaultPrevented).to.be.true;
        expect(copy.clipboardData?.getData('text/plain')).to.equal('1\ta\n2\tb');
      });
    });

    it('a native paste event writes the clipboard text', async () => {
      const data = rows();
      const grid = await mount(data, baseColumns);
      await withClipboard(null, async () => {
        grid.selectRange({ row: 2, column: 'qty' });
        const cell = focusCell(grid, 2, 'qty');
        const transfer = new DataTransfer();
        transfer.setData('text/plain', '40\t41');
        const paste = new ClipboardEvent('paste', {
          clipboardData: transfer,
          bubbles: true,
          composed: true,
          cancelable: true,
        });
        cell.dispatchEvent(paste);
        expect(paste.defaultPrevented).to.be.true;
        expect(data[2].qty).to.equal(40);
        expect(data[2].price).to.equal(41);
      });
    });

    it('leaves copy and paste alone when the grid does not hold focus', async () => {
      const data = rows();
      const grid = await mount(data, baseColumns);
      grid.selectRange({ row: 2, column: 'qty' });
      const outside = document.createElement('input');
      document.body.append(outside);
      outside.focus();
      try {
        const transfer = new DataTransfer();
        transfer.setData('text/plain', '40');
        const paste = new ClipboardEvent('paste', {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        });
        outside.dispatchEvent(paste);
        expect(paste.defaultPrevented).to.be.false;
        expect(data[2].qty).to.equal(4);
      } finally {
        outside.remove();
      }
    });
  });

  // --- ent-range-b-11: the last copy does not outlive its data -------------

  it('a copy from replaced data is not re-offset as formulas', async () => {
    const data = rows();
    const grid = await mount(data, baseColumns);
    grid.setFormula(data[0], 'total', '=C1*D1');
    await withClipboard(
      {
        writeText: async (t) => {
          buffer = t;
        },
        readText: async () => buffer,
      },
      async () => {
        grid.selectRange({ row: 0, column: 'total' });
        await grid.copySelection();
      }
    );
    const fresh = rows();
    grid.data = fresh;
    await grid.updateComplete;
    grid.selectRange({ row: 1, column: 'total' });
    grid.pasteText(buffer);
    expect(grid.getFormula(fresh[1], 'total')).to.equal(undefined);
    expect(fresh[1].total).to.equal(10);
  });
});
