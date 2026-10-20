import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { ApexGridEnterprise, enterpriseModules, type RangeBounds } from '../src/index.js';

// Range selection keys and pointer drags: which keys the grid acts on, RTL
// extension, scrolling the range into view, ending abandoned drags, restoring
// untrusted ranges, and what a selection change costs on a large view.

interface Row {
  id: number;
  name: string;
  amount: number;
  score: number;
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number', editable: true },
  { key: 'name', type: 'string', editable: true },
  { key: 'amount', type: 'number', editable: true },
  { key: 'score', type: 'number', editable: true },
];

const rows = (count = 4): Row[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: String.fromCharCode(65 + (i % 26)),
    amount: (i + 1) * 10,
    score: (i + 1) * 100,
  }));

type Grid<T extends object = Row> = ApexGridEnterprise<T>;

interface RangeInternals {
  handleCellInteraction(i: unknown): void;
  decorateCell(ctx: unknown): { attributes: Record<string, string | null> } | null;
  getRanges(): RangeBounds[];
}

function controllerOf<T extends object>(grid: Grid<T>): RangeInternals {
  return (
    grid as unknown as { stateController: { module(id: string): RangeInternals } }
  ).stateController.module('range-selection');
}

async function settle(grid: { updateComplete: Promise<unknown> }, frames = 2) {
  await grid.updateComplete;
  for (let i = 0; i < frames; i += 1) await nextFrame();
}

async function mount<T extends object = Row>(
  options: {
    data?: T[];
    columns?: ColumnConfiguration<T>[];
    height?: number;
    width?: number;
    dir?: 'rtl';
  } = {}
): Promise<Grid<T>> {
  const parent = document.createElement('div');
  parent.style.height = `${options.height ?? 600}px`;
  if (options.width) parent.style.width = `${options.width}px`;
  if (options.dir) parent.dir = options.dir;
  const grid = await fixture<Grid<T>>(
    html`<apex-grid-enterprise
      style="height: 100%"
      .data=${options.data ?? (rows() as unknown as T[])}
      .columns=${options.columns ?? columns}
      .editing=${{ enabled: true }}
    ></apex-grid-enterprise>`,
    { parentNode: parent }
  );
  await grid.updateComplete;
  await (grid as unknown as { scrollContainer?: { layoutComplete?: Promise<unknown> } })
    .scrollContainer?.layoutComplete;
  await settle(grid);
  return grid;
}

function cellAt<T extends object>(grid: Grid<T>, rowIndex: number, key: string) {
  for (const row of grid.rows) {
    if (row.index !== rowIndex) continue;
    return row.cells.find((cell) => String(cell.column.key) === key) as unknown as
      | HTMLElement
      | undefined;
  }
  return undefined;
}

function interact<T extends object>(
  grid: Grid<T>,
  kind: 'down' | 'over' | 'up',
  rowIndex: number,
  key: string,
  row: T = grid.pageItems[rowIndex] as T
): void {
  controllerOf(grid).handleCellInteraction({
    kind,
    row,
    rowIndex,
    column: grid.columns.find((c) => String(c.key) === key)!,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    originalEvent: new PointerEvent(`pointer${kind === 'over' ? 'move' : kind}`, { button: 0 }),
  });
}

function key(
  target: EventTarget,
  name: string,
  opts: { shift?: boolean; ctrl?: boolean } = {}
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: name,
    shiftKey: Boolean(opts.shift),
    ctrlKey: Boolean(opts.ctrl),
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

/** Grabs the fill handle of the active range with a real pointerdown on its corner. */
function grabHandle<T extends object>(grid: Grid<T>, rowIndex: number, columnKey: string) {
  const cell = cellAt(grid, rowIndex, columnKey)!;
  const rect = cell.getBoundingClientRect();
  cell.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      composed: true,
      button: 0,
      buttons: 1,
      clientX: rect.right - 3,
      clientY: rect.bottom - 3,
    })
  );
}

async function withReadText(text: string, run: () => Promise<void>) {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { readText: async () => text, writeText: async () => undefined },
  });
  try {
    await run();
  } finally {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'clipboard');
  }
}

const raf = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function deepQueryAll(root: ShadowRoot | Element, selector: string): Element[] {
  const out: Element[] = [];
  const visit = (node: ShadowRoot | Element) => {
    for (const el of node.querySelectorAll(selector)) out.push(el);
    for (const el of node.querySelectorAll('*')) if (el.shadowRoot) visit(el.shadowRoot);
  };
  visit(root);
  return out;
}

describe('range selection keys and pointer', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  // --- ent-range-a-1: keys from an editor or an embedded control ----------

  describe('key origin', () => {
    it('Ctrl+V inside the formula editor is left to the editor', async () => {
      const formulaColumns: ColumnConfiguration<Row>[] = [
        ...columns.slice(0, 3),
        { key: 'score', type: 'number', editable: true, allowFormula: true },
      ];
      const grid = await mount({ columns: formulaColumns });
      interact(grid, 'down', 0, 'score');
      interact(grid, 'up', 0, 'score');
      await grid.editCell(0, 'score');
      await settle(grid);
      const editor = cellAt(grid, 0, 'score')
        ?.shadowRoot?.querySelector('apex-grid-formula-editor')
        ?.shadowRoot?.querySelector('input');
      expect(editor, 'formula editor open').to.exist;

      await withReadText('70\n80', async () => {
        const event = key(editor!, 'v', { ctrl: true });
        await new Promise((r) => setTimeout(r, 30));
        expect(event.defaultPrevented, 'native paste not cancelled').to.equal(false);
        expect((grid.pageItems[1] as Row).score, 'neighbour untouched').to.equal(200);
      });
    });

    it('Escape typed in a control inside a cell keeps the range', async () => {
      const withInput: ColumnConfiguration<Row>[] = [
        { ...columns[0], cellTemplate: () => html`<input class="probe" />` },
        ...columns.slice(1),
      ];
      const grid = await mount({ columns: withInput });
      grid.selectRange({ row: 0, column: 'name' }, { row: 1, column: 'amount' });
      const input = cellAt(grid, 0, 'id')!.shadowRoot!.querySelector('input.probe')!;
      key(input, 'Escape');
      expect(grid.getSelectionBounds(), 'range kept').to.eql({
        top: 0,
        bottom: 1,
        left: 1,
        right: 2,
      });
    });

    it('a key another handler already claimed is left alone', async () => {
      const grid = await mount();
      grid.selectRange({ row: 0, column: 'name' });
      const cell = cellAt(grid, 0, 'name')!;
      const claim = (event: Event) => event.preventDefault();
      cell.addEventListener('keydown', claim);
      key(cell, 'Escape');
      cell.removeEventListener('keydown', claim);
      expect(grid.getSelectionBounds()).to.eql({ top: 0, bottom: 0, left: 1, right: 1 });

      key(cell, 'Escape');
      expect(grid.getSelectionBounds(), 'an unclaimed Escape still clears').to.equal(null);
    });

    it('keys and clipboard from a custom editor stay with the editor', async () => {
      const data = rows();
      const withPicker: ColumnConfiguration<Row>[] = [
        ...columns.slice(0, 2),
        {
          ...columns[2],
          editorTemplate: () => html`<div class="picker" tabindex="0" role="listbox"></div>`,
        },
        columns[3],
      ];
      const grid = await mount({ data, columns: withPicker });
      grid.selectRange({ row: 1, column: 'name' }, { row: 2, column: 'amount' });
      const before = grid.getSelectionBounds();
      await grid.editCell(1, 'amount');
      await settle(grid);
      const cell = cellAt(grid, 1, 'amount')!;
      expect(cell.hasAttribute('editing'), 'cell in edit mode').to.equal(true);
      const picker = cell.shadowRoot!.querySelector<HTMLElement>('.picker')!;
      picker.focus();

      const arrow = key(picker, 'ArrowDown', { shift: true });
      expect(arrow.defaultPrevented, 'Shift+Arrow left to the editor').to.equal(false);
      expect(grid.getSelectionBounds(), 'range not extended').to.eql(before);

      const clip = (type: 'copy' | 'paste', target: EventTarget) => {
        const transfer = new DataTransfer();
        transfer.setData('text/plain', 'PASTED');
        const event = new ClipboardEvent(type, {
          clipboardData: transfer,
          bubbles: true,
          composed: true,
          cancelable: true,
        });
        target.dispatchEvent(event);
        return event;
      };
      expect(clip('paste', picker).defaultPrevented, 'paste from the editor').to.equal(false);
      expect(clip('paste', document.body).defaultPrevented, 'paste at the document').to.equal(
        false
      );
      expect(data[1].name, 'range not pasted into').to.equal('B');
      expect(clip('copy', picker).defaultPrevented, 'copy from the editor').to.equal(false);
      expect(clip('copy', document.body).defaultPrevented, 'copy at the document').to.equal(false);
    });

    it('a copy aimed at the document while a button in the grid holds focus copies the range', async () => {
      const withButton: ColumnConfiguration<Row>[] = [
        { ...columns[0], cellTemplate: () => html`<button class="probe">go</button>` },
        ...columns.slice(1),
      ];
      const grid = await mount({ columns: withButton });
      grid.selectRange({ row: 0, column: 'name' });
      cellAt(grid, 0, 'id')!.shadowRoot!.querySelector<HTMLElement>('button.probe')!.focus();
      const copy = new ClipboardEvent('copy', {
        clipboardData: new DataTransfer(),
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(copy);
      expect(copy.defaultPrevented).to.equal(true);
      expect(copy.clipboardData?.getData('text/plain')).to.equal('A');
    });
  });

  // --- ent-range-a-7: keys from a master/detail child grid ----------------

  describe('nested detail grid', () => {
    interface Item {
      sku: string;
      qty: number;
    }
    interface Order {
      id: number;
      customer: string;
      items: Item[];
    }

    async function mountMaster(detailTag?: 'apex-grid-enterprise') {
      const orders: Order[] = [
        { id: 1, customer: 'Acme', items: [{ sku: 'A-1', qty: 2 }] },
        { id: 2, customer: 'Globex', items: [{ sku: 'B-1', qty: 1 }] },
      ];
      const parent = document.createElement('div');
      parent.style.height = '600px';
      const grid = await fixture<Grid<Order>>(
        html`<apex-grid-enterprise
          .data=${orders}
          .columns=${[
            { key: 'id', type: 'number', editable: true },
            { key: 'customer', editable: true },
          ]}
          .editing=${{ enabled: true }}
          .masterDetail=${{
            detailTag,
            columns: [
              { key: 'sku', editable: true },
              { key: 'qty', type: 'number', editable: true },
            ],
            getDetailData: (order: Order) => order.items,
          }}
        ></apex-grid-enterprise>`,
        { parentNode: parent }
      );
      await settle(grid);
      await grid.expandRow(orders[0]);
      let child: HTMLElement | undefined;
      for (let i = 0; i < 40 && !child; i += 1) {
        await nextFrame();
        const tag = detailTag ?? 'apex-grid';
        child = deepQueryAll(grid.shadowRoot!, tag).find((el) => el !== grid) as
          | HTMLElement
          | undefined;
        if (child && !deepQueryAll(child.shadowRoot!, 'apex-grid-cell').length) child = undefined;
      }
      expect(child, 'detail grid rendered').to.exist;
      const childCell = deepQueryAll(child!.shadowRoot!, 'apex-grid-cell')[0] as HTMLElement;
      return { grid, orders, childCell };
    }

    it('Shift+Arrow, Escape and Ctrl+V in a child grid leave the master range alone', async () => {
      const { grid, orders, childCell } = await mountMaster();
      grid.selectRange({ row: 1, column: 'customer' });
      const before = grid.getSelectionBounds();

      key(childCell, 'ArrowLeft', { shift: true });
      expect(grid.getSelectionBounds(), 'Shift+Arrow not claimed by the master').to.eql(before);

      await withReadText('PASTED', async () => {
        key(childCell, 'v', { ctrl: true });
        await new Promise((r) => setTimeout(r, 30));
      });
      expect(orders[1].id, 'master row not pasted into').to.equal(2);
      expect(orders[1].customer).to.equal('Globex');

      key(childCell, 'Escape');
      expect(grid.getSelectionBounds(), 'Escape in the child keeps the master range').to.eql(
        before
      );
    });

    it('an enterprise child grid extends its own range, not the master one', async () => {
      const { grid, childCell } = await mountMaster('apex-grid-enterprise');
      grid.selectRange({ row: 1, column: 'customer' });
      const before = grid.getSelectionBounds();
      key(childCell, 'ArrowUp', { shift: true });
      expect(grid.getSelectionBounds()).to.eql(before);
    });
  });

  // --- ent-range-a-4: pinned rows are outside the body range --------------

  it('a pinned row cell is neither decorated nor selectable as a body row', async () => {
    const data = rows();
    const grid = await mount({ data });
    (grid as unknown as { rowPinning: unknown }).rowPinning = { enabled: true };
    await grid.updateComplete;
    (grid as unknown as { pinRow(row: Row, at: 'top'): boolean }).pinRow(data[3], 'top');
    await settle(grid);

    grid.selectRange({ row: 0, column: 'amount' });
    await settle(grid);
    const pinnedCell = deepQueryAll(grid.shadowRoot!, 'apex-grid-cell').find(
      (cell) =>
        (cell as unknown as { row?: { data?: Row } }).row?.data === data[3] &&
        String((cell as unknown as { column: { key: string } }).column.key) === 'amount'
    );
    expect(pinnedCell, 'pinned cell rendered').to.exist;
    expect(pinnedCell!.getAttribute('aria-selected')).to.equal(null);
    expect(pinnedCell!.hasAttribute('data-range')).to.equal(false);

    // A press on the pinned row (its band index is 0) does not select body row 0.
    grid.clearRangeSelection();
    interact(grid, 'down', 0, 'amount', data[3]);
    interact(grid, 'up', 0, 'amount', data[3]);
    expect(grid.getSelectionBounds()).to.equal(null);
  });

  // --- ent-range-a-5 / ent-range-b-9: pointercancel and disconnect --------

  describe('abandoned drags', () => {
    it('pointercancel ends a select drag: no auto-scroll or growth afterwards', async () => {
      const grid = await mount({ data: rows(100), height: 220 });
      const el = grid as unknown as HTMLElement;
      interact(grid, 'down', 0, 'amount');
      globalThis.dispatchEvent(new PointerEvent('pointercancel'));

      const rect = el.getBoundingClientRect();
      globalThis.dispatchEvent(
        new PointerEvent('pointermove', { clientX: rect.left + 60, clientY: rect.bottom - 2 })
      );
      for (let i = 0; i < 20; i += 1) await raf();
      expect(el.scrollTop, 'no auto-scroll').to.equal(0);
      expect(grid.getSelectionBounds()).to.eql({ top: 0, bottom: 0, left: 2, right: 2 });
    });

    it('a pointercancel from another pointer leaves the drag running', async () => {
      const grid = await mount();
      interact(grid, 'down', 0, 'amount');
      globalThis.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 7 }));
      interact(grid, 'over', 2, 'amount');
      expect(grid.getSelectionBounds()).to.eql({ top: 0, bottom: 2, left: 2, right: 2 });
      interact(grid, 'up', 2, 'amount');
    });

    it('pointercancel drops a fill drag without writing it', async () => {
      const data = rows();
      const grid = await mount({ data });
      grid.selectRange({ row: 0, column: 'amount' });
      await settle(grid);
      grabHandle(grid, 0, 'amount');
      interact(grid, 'over', 2, 'amount');
      expect(grid.getSelectionRanges(), 'fill preview').to.eql([
        { top: 0, bottom: 2, left: 2, right: 2 },
      ]);

      globalThis.dispatchEvent(new PointerEvent('pointercancel'));
      globalThis.dispatchEvent(new PointerEvent('pointerup'));
      expect(
        data.map((r) => r.amount),
        'nothing filled'
      ).to.eql([10, 20, 30, 40]);
      expect(grid.getSelectionRanges()).to.eql([{ top: 0, bottom: 0, left: 2, right: 2 }]);
    });

    it('a grid disconnected mid fill drag does not fill on the next pointerup', async () => {
      const data = rows();
      const grid = await mount({ data });
      grid.selectRange({ row: 0, column: 'amount' });
      await settle(grid);
      grabHandle(grid, 0, 'amount');
      interact(grid, 'over', 2, 'amount');

      const el = grid as unknown as HTMLElement;
      const parent = el.parentElement!;
      el.remove();
      parent.append(el);
      await settle(grid);
      globalThis.dispatchEvent(new PointerEvent('pointerup'));
      expect(data.map((r) => r.amount)).to.eql([10, 20, 30, 40]);
    });

    // --- ent-range-a-6: a stale fill preview -------------------------------

    it('selectRange during a fill drag drops the preview for good', async () => {
      const data = rows();
      const grid = await mount({ data });
      grid.selectRange({ row: 0, column: 'amount' });
      await settle(grid);
      grabHandle(grid, 0, 'amount');
      interact(grid, 'over', 2, 'amount');

      grid.selectRange({ row: 3, column: 'id' });
      globalThis.dispatchEvent(new PointerEvent('pointerup'));
      expect(
        data.map((r) => r.amount),
        'nothing filled'
      ).to.eql([10, 20, 30, 40]);
      expect(grid.getSelectionRanges()).to.eql([{ top: 3, bottom: 3, left: 0, right: 0 }]);
      expect(grid.getSelectionTSV()).to.equal('4');
    });

    it('Shift+Arrow during a fill drag drops the preview for good', async () => {
      const data = rows();
      const grid = await mount({ data });
      grid.selectRange({ row: 0, column: 'amount' });
      await settle(grid);
      grabHandle(grid, 0, 'amount');
      interact(grid, 'over', 2, 'amount');

      key(cellAt(grid, 0, 'amount')!, 'ArrowRight', { shift: true });
      globalThis.dispatchEvent(new PointerEvent('pointerup'));
      expect(data.map((r) => r.amount)).to.eql([10, 20, 30, 40]);
      expect(grid.getSelectionRanges()).to.eql([{ top: 0, bottom: 0, left: 2, right: 3 }]);
    });
  });

  // --- ent-range-a-9: untrusted restored ranges ---------------------------

  describe('restoring ranges', () => {
    const restore = (grid: Grid, ranges: unknown) =>
      grid.setState({ modules: { enterprise: { ranges } } } as never);

    it('skips malformed entries instead of throwing', async () => {
      const grid = await mount();
      expect(() => restore(grid, [null])).not.to.throw();
      expect(() => restore(grid, null)).not.to.throw();
      expect(() =>
        restore(grid, [{ top: 0, bottom: 1.5, left: 0, right: 0 }, 'x', { top: -1 }])
      ).not.to.throw();
      expect(grid.getSelectionRanges()).to.eql([]);
    });

    it('normalises reversed bounds and keeps the valid entries in order', async () => {
      const grid = await mount();
      restore(grid, [
        { top: 2, bottom: 0, left: 1, right: 0 },
        { top: Number.NaN, bottom: 0, left: 0, right: 0 },
        { top: 3, bottom: 3, left: 3, right: 2 },
      ]);
      expect(grid.getSelectionRanges()).to.eql([
        { top: 0, bottom: 2, left: 0, right: 1 },
        { top: 3, bottom: 3, left: 2, right: 3 },
      ]);
    });

    it('bounds far past the view cost nothing extra', async () => {
      const grid = await mount();
      const start = performance.now();
      restore(grid, [{ top: 0, bottom: 3e8, left: 0, right: 2e7 }]);
      const elapsed = performance.now() - start;
      expect(elapsed, 'restore time (ms)').to.be.below(100);
      // Stats read the rows and columns that exist: 4 rows x 4 columns.
      expect(grid.getSelectionStats().count).to.equal(16);
    });
  });

  // --- sweep-regression-3.5-4: Shift+ArrowLeft/Right under RTL ------------

  it('Shift+ArrowLeft/Right follow the screen direction under RTL', async () => {
    const grid = await mount({ dir: 'rtl' });
    grid.selectRange({ row: 1, column: 'name' });
    const cell = cellAt(grid, 1, 'name')!;
    const nameX = cell.getBoundingClientRect().left;
    const amountX = cellAt(grid, 1, 'amount')!.getBoundingClientRect().left;
    expect(amountX, 'amount sits left of name').to.be.lessThan(nameX);

    key(cell, 'ArrowLeft', { shift: true });
    expect(grid.getSelectionBounds(), 'grew towards amount, on the left').to.eql({
      top: 1,
      bottom: 1,
      left: 1,
      right: 2,
    });
    key(cell, 'ArrowRight', { shift: true });
    key(cell, 'ArrowRight', { shift: true });
    expect(grid.getSelectionBounds(), 'grew towards id, on the right').to.eql({
      top: 1,
      bottom: 1,
      left: 0,
      right: 1,
    });
  });

  // --- sweep-virtualization-scroll-4: keyboard extension scrolls ----------

  it('keyboard range extension scrolls the focus corner into view', async () => {
    const grid = await mount({ data: rows(500), height: 400 });
    const el = grid as unknown as HTMLElement;
    const body = grid.shadowRoot!.querySelector('apex-virtualizer') as HTMLElement;
    grid.selectRange({ row: 0, column: 'name' });
    for (let i = 0; i < 25; i += 1) key(body, 'ArrowDown', { shift: true });
    await settle(grid, 3);

    expect(grid.getSelectionBounds()!.bottom).to.equal(25);
    expect(el.scrollTop, 'body scrolled').to.be.greaterThan(0);
    const focus = cellAt(grid, 25, 'name');
    expect(focus, 'focus row rendered').to.exist;
    const hostRect = el.getBoundingClientRect();
    expect(focus!.getBoundingClientRect().bottom).to.be.at.most(hostRect.bottom + 1);

    key(body, 'End', { shift: true, ctrl: true });
    await settle(grid, 4);
    expect(grid.getSelectionBounds()!.bottom).to.equal(499);
    const last = cellAt(grid, 499, 'score');
    expect(last, 'last row rendered after Ctrl+Shift+End').to.exist;
    expect(last!.getBoundingClientRect().bottom).to.be.at.most(hostRect.bottom + 1);
  });

  // --- sweep-virtualization-scroll-8: horizontal drag auto-scroll ---------

  it('a drag held at the right edge scrolls columns and extends the range', async () => {
    interface Wide {
      [key: string]: number;
    }
    const wideColumns: ColumnConfiguration<Wide>[] = Array.from({ length: 40 }, (_, i) => ({
      key: `c${i}`,
      type: 'number',
      width: '100px',
    }));
    const wide: Wide[] = Array.from({ length: 20 }, (_, r) =>
      Object.fromEntries(wideColumns.map((c, i) => [String(c.key), r * 100 + i]))
    );
    const grid = await mount<Wide>({ data: wide, columns: wideColumns, height: 300, width: 500 });
    const el = grid as unknown as HTMLElement;
    expect(el.scrollWidth - el.clientWidth, 'overflows inline').to.be.greaterThan(1000);

    interact(grid, 'down', 2, 'c0');
    const rect = el.getBoundingClientRect();
    globalThis.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: rect.right + 20,
        clientY: rect.top + rect.height / 2,
        buttons: 1,
      })
    );
    for (let i = 0; i < 60; i += 1) await raf();
    await grid.updateComplete;
    expect(el.scrollLeft, 'scrolled inline').to.be.greaterThan(300);
    const bounds = grid.getSelectionBounds()!;
    expect(bounds.right, 'range followed past the visible columns').to.be.greaterThan(6);
    expect(bounds.top, 'row axis untouched').to.equal(2);
    expect(bounds.bottom).to.equal(2);
    interact(grid, 'up', 2, 'c0');
  });

  // --- ent-range-a-3 / ent-range-b-5: stats cost on a large view ----------

  it('selection stats on a 100k row view take no per-cell keys', async () => {
    interface Big {
      [key: string]: number;
    }
    const bigColumns: ColumnConfiguration<Big>[] = Array.from({ length: 20 }, (_, i) => ({
      key: `c${i}`,
      type: 'number',
    }));
    const big: Big[] = Array.from({ length: 100_000 }, (_, r) => {
      const row: Big = {};
      for (let i = 0; i < 20; i += 1) row[`c${i}`] = r + i;
      return row;
    });
    const grid = await mount<Big>({ data: big, columns: bigColumns, height: 300 });
    grid.selectRange({ row: 0, column: 'c0' }, { row: 99_999, column: 'c19' });

    const add = Set.prototype.add;
    let adds = 0;
    Set.prototype.add = function (this: Set<unknown>, value: unknown) {
      adds += 1;
      return add.call(this, value);
    };
    let elapsed: number;
    try {
      const start = performance.now();
      grid.selectRange({ row: 0, column: 'c0' }, { row: 99_998, column: 'c19' });
      elapsed = performance.now() - start;
    } finally {
      Set.prototype.add = add;
    }
    expect(adds, 'Set.add calls in one commit').to.be.below(1000);
    // Generous: the scan itself takes a few tens of ms; the keyed one took 500+.
    expect(elapsed, 'one commit over 2M cells (ms)').to.be.below(300);
    const stats = grid.getSelectionStats();
    expect(stats.count).to.equal(99_999 * 20);
  });

  it('multiple ranges count an overlapping cell once', async () => {
    const grid = await mount();
    grid.setState({
      modules: {
        enterprise: {
          ranges: [
            { top: 0, bottom: 1, left: 2, right: 3 },
            { top: 1, bottom: 2, left: 3, right: 3 },
          ],
        },
      },
    } as never);
    // amount 10, 20, score 100, 200, then score 300 (score 200 counted once).
    const stats = grid.getSelectionStats();
    expect(stats.count).to.equal(5);
    expect(stats.sum).to.equal(10 + 20 + 100 + 200 + 300);
  });

  // --- ent-range-a-8: decoration does no per-cell column rebuild ----------

  it('decorating cells skips the column lookup off the range rows and never searches for it', async () => {
    const grid = await mount();
    grid.selectRange({ row: 1, column: 'name' }, { row: 2, column: 'amount' });
    await settle(grid);
    const controller = controllerOf(grid);
    const proto = Object.getPrototypeOf(grid);
    let reads = 0;
    let owner = proto;
    while (owner && !Object.getOwnPropertyDescriptor(owner, 'columns')) {
      owner = Object.getPrototypeOf(owner);
    }
    const descriptor = Object.getOwnPropertyDescriptor(owner, 'columns')!;
    Object.defineProperty(grid, 'columns', {
      configurable: true,
      get() {
        reads += 1;
        return descriptor.get!.call(this);
      },
      set(value) {
        descriptor.set!.call(this, value);
      },
    });
    try {
      const decorate = (rowIndex: number, key: keyof Row) =>
        controller.decorateCell({
          row: grid.pageItems[rowIndex],
          rowIndex,
          column: columns.find((c) => c.key === key),
          value: undefined,
        });
      // Seed whatever cache there is.
      decorate(1, 'name');
      reads = 0;
      for (let i = 0; i < 50; i += 1) {
        for (const column of columns) {
          decorate(0, column.key);
          decorate(3, column.key);
        }
      }
      expect(reads, 'rows outside every range').to.equal(0);
      // A cell on a range row looks its column up instead of searching a
      // freshly built display-column list.
      const findIndex = Array.prototype.findIndex;
      let searches = 0;
      Array.prototype.findIndex = function (
        this: unknown[],
        ...args: Parameters<typeof findIndex>
      ) {
        searches += 1;
        return findIndex.apply(this, args);
      };
      try {
        for (let i = 0; i < 50; i += 1) for (const column of columns) decorate(1, column.key);
      } finally {
        Array.prototype.findIndex = findIndex;
      }
      expect(searches, 'column searches on range rows').to.equal(0);
      expect(decorate(1, 'name')?.attributes['data-range']).to.match(/selected/);
      expect(decorate(1, 'score')).to.equal(null);
    } finally {
      delete (grid as unknown as Record<string, unknown>).columns;
    }
  });
});
