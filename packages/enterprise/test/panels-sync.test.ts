import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import { type ColumnConfiguration, esLocale } from 'apex-grid';
import { ApexGridEnterprise, ApexGridStatusBar, enterpriseModules } from '../src/index.js';

// The status bar follows the grid it is bound to: value and locale changes
// made anywhere else show up in it, and it survives being moved in the DOM.

interface Row {
  id: number;
  name: string;
  amount: number;
  qty: number;
  total: number;
}

const rows = (): Row[] => [
  { id: 1, name: 'A', amount: 10, qty: 1, total: 0 },
  { id: 2, name: 'B', amount: 20, qty: 2, total: 0 },
  { id: 3, name: 'A', amount: 30, qty: 3, total: 0 },
];

// Fresh objects per mount: pinColumn writes into the column object it finds.
const columns = (): ColumnConfiguration<Row>[] => [
  { key: 'id', type: 'number', headerText: 'ID' },
  { key: 'name', headerText: 'Name' },
  { key: 'amount', type: 'number', headerText: 'Amount', editable: true },
];

async function settle(...elements: { updateComplete: Promise<unknown> }[]) {
  for (let pass = 0; pass < 2; pass++) {
    for (const element of elements) await element.updateComplete;
    await nextFrame();
  }
}

async function mountGrid(props: Partial<ApexGridEnterprise<Row>> = {}) {
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise
      .data=${rows()}
      .columns=${columns()}
      .editing=${{ enabled: true, mode: 'cell', history: { enabled: true } }}
    ></apex-grid-enterprise>`
  );
  Object.assign(grid, props);
  await settle(grid);
  return grid;
}

// --- status bar ---------------------------------------------------------------

async function mountBar(grid: ApexGridEnterprise<Row>) {
  const bar = await fixture<ApexGridStatusBar>(
    html`<apex-grid-status-bar .grid=${grid}></apex-grid-status-bar>`
  );
  await settle(grid, bar);
  return bar;
}

function shown(bar: ApexGridStatusBar, label: string): string | null {
  for (const stat of bar.shadowRoot!.querySelectorAll('[part="stat"]')) {
    if (stat.querySelector('[part="stat-label"]')?.textContent?.trim() === label) {
      return stat.querySelector('[part="stat-value"]')?.textContent?.trim() ?? null;
    }
  }
  return null;
}

/** Count the bar's reads of the grid's selection stats. */
function countStatReads(grid: ApexGridEnterprise<Row>): () => number {
  let reads = 0;
  const original = grid.getSelectionStats.bind(grid);
  grid.getSelectionStats = () => {
    reads += 1;
    return original();
  };
  return () => reads;
}

describe('panels follow the grid', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridStatusBar.register();
  });
  afterEach(() => fixtureCleanup());

  describe('status bar', () => {
    async function selected() {
      const grid = await mountGrid();
      const bar = await mountBar(grid);
      grid.selectRange({ row: 0, column: 'amount' }, { row: 2, column: 'amount' });
      await settle(grid, bar);
      expect(shown(bar, 'Sum')).to.equal('60');
      return { grid, bar };
    }

    it('refreshes after applyEdits changes a selected cell', async () => {
      const { grid, bar } = await selected();
      grid.applyEdits([{ rowIndex: 1, column: 'amount', value: 50 }]);
      await settle(grid, bar);
      expect(shown(bar, 'Sum')).to.equal('90');
    });

    it('refreshes after undo restores the old value', async () => {
      const { grid, bar } = await selected();
      grid.applyEdits([{ rowIndex: 1, column: 'amount', value: 50 }]);
      await settle(grid, bar);
      expect(shown(bar, 'Sum')).to.equal('90');
      grid.undo();
      await settle(grid, bar);
      expect(shown(bar, 'Sum')).to.equal('60');
    });

    it('refreshes after the data array is replaced', async () => {
      const { grid, bar } = await selected();
      grid.data = rows().map((row) => ({ ...row, amount: row.amount * 10 }));
      await settle(grid, bar);
      expect(shown(bar, 'Sum')).to.equal('600');
    });

    it('refreshes after a paste into the selection', async () => {
      const { grid, bar } = await selected();
      grid.pasteText('1\n2\n3');
      await settle(grid, bar);
      expect(shown(bar, 'Sum')).to.equal('6');
    });

    it('refreshes after a formula in the selection recalculates', async () => {
      const grid = await fixture<ApexGridEnterprise<Row>>(
        html`<apex-grid-enterprise
          .data=${rows()}
          .columns=${[
            { key: 'id', type: 'number' },
            { key: 'name' },
            { key: 'amount', type: 'number' },
            { key: 'qty', type: 'number', editable: true },
            { key: 'total', type: 'number', editable: true, allowFormula: true },
          ]}
          .editing=${{ enabled: true, mode: 'cell' }}
        ></apex-grid-enterprise>`
      );
      await settle(grid);
      grid.setFormula(grid.data[0], 'total', '=D1*10'); // 10
      const bar = await mountBar(grid);
      grid.selectRange({ row: 0, column: 'total' });
      await settle(grid, bar);
      expect(shown(bar, 'Sum')).to.equal('10');

      // Edit a cell outside the selection; the formula inside it recalculates.
      grid.applyEdits([{ rowIndex: 0, column: 'qty', value: 7 }]);
      await settle(grid, bar);
      expect(shown(bar, 'Sum')).to.equal('70');
    });

    it('recomputes once for a burst of edits', async () => {
      const { grid, bar } = await selected();
      const reads = countStatReads(grid);
      grid.applyEdits([
        { rowIndex: 0, column: 'amount', value: 1 },
        { rowIndex: 1, column: 'amount', value: 2 },
        { rowIndex: 2, column: 'amount', value: 3 },
      ]);
      await settle(grid, bar);
      expect(shown(bar, 'Sum')).to.equal('6');
      expect(reads()).to.equal(1);
    });

    it('keeps updating after it is moved in the DOM', async () => {
      const grid = await mountGrid();
      const bar = await mountBar(grid);
      const parent = bar.parentElement!;
      bar.remove();
      parent.appendChild(bar);
      bar.remove();
      parent.appendChild(bar);
      const reads = countStatReads(grid);
      grid.selectRange({ row: 0, column: 'amount' }, { row: 2, column: 'amount' });
      await settle(grid, bar);
      expect(shown(bar, 'Count')).to.equal('3');
      grid.applyEdits([{ rowIndex: 1, column: 'amount', value: 50 }]);
      await settle(grid, bar);
      expect(shown(bar, 'Sum')).to.equal('90');
      expect(reads(), 'one read, not one per reconnect').to.equal(1);
    });

    it('switches language with the grid', async () => {
      const grid = await mountGrid();
      const bar = await mountBar(grid);
      grid.localeText = esLocale;
      await settle(grid, bar);
      expect(bar.shadowRoot!.querySelector('[part="hint"]')!.textContent!.trim()).to.equal(
        esLocale['statusBar.selectRange']
      );
    });
  });
});
