import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import { type ColumnConfiguration, esLocale } from 'apex-grid';
import {
  ApexGridEnterprise,
  ApexGridStatusBar,
  ApexGridToolPanel,
  enterpriseModules,
} from '../src/index.js';

// The status bar and the tool panel follow the grid they are bound to: values,
// columns, grouping, pivot and locale changes made anywhere else show up in
// them, and they survive being moved in the DOM.

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
    ApexGridToolPanel.register();
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

  // --- tool panel -------------------------------------------------------------

  describe('tool panel', () => {
    async function mountPanel(grid: ApexGridEnterprise<Row>) {
      const panel = await fixture<ApexGridToolPanel>(
        html`<apex-grid-tool-panel .grid=${grid}></apex-grid-tool-panel>`
      );
      await settle(grid, panel);
      return panel;
    }
    const item = (panel: ApexGridToolPanel, key: string) =>
      panel.shadowRoot!.querySelector(`li[data-key="${key}"]`)!;
    const control = <E extends HTMLElement>(panel: ApexGridToolPanel, key: string, part: string) =>
      item(panel, key)?.querySelector(`[part="${part}"]`) as E | null;
    const listKeys = (panel: ApexGridToolPanel) =>
      [...panel.shadowRoot!.querySelectorAll('li[part="item"]')].map((li) =>
        li.getAttribute('data-key')
      );
    const zone = (panel: ApexGridToolPanel, title: string) =>
      [...panel.shadowRoot!.querySelectorAll('[part="zone"]')].find(
        (each) => each.querySelector('[part="zone-title"]')?.textContent?.trim() === title
      ) as HTMLElement;
    const chips = (panel: ApexGridToolPanel) =>
      [...panel.shadowRoot!.querySelectorAll('[part="chip"]')].map((chip) =>
        (chip.textContent ?? '').replace('×', '').trim()
      );
    const pivotToggle = (panel: ApexGridToolPanel) =>
      panel.shadowRoot!.querySelector('[part="pivot-mode"]') as HTMLInputElement;
    function drop(target: HTMLElement, text: string): void {
      const transfer = new DataTransfer();
      transfer.setData('text/plain', text);
      target.dispatchEvent(
        new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })
      );
    }

    it('reflects grouping set outside the panel, and its next click ungroups', async () => {
      const grid = await mountGrid();
      const panel = await mountPanel(grid);
      grid.groupBy = ['name'];
      await settle(grid, panel);
      const group = control<HTMLButtonElement>(panel, 'name', 'group')!;
      expect(group.getAttribute('aria-pressed')).to.equal('true');
      expect(chips(panel)).to.eql(['Name']);
      group.click();
      await settle(grid, panel);
      expect(grid.groupBy).to.eql([]);
    });

    it('reflects a column hidden outside the panel', async () => {
      const grid = await mountGrid();
      const panel = await mountPanel(grid);
      grid.columns = grid.columns.map((c) => (c.key === 'name' ? { ...c, hidden: true } : c));
      await settle(grid, panel);
      expect(control<HTMLInputElement>(panel, 'name', 'visible')!.checked).to.equal(false);
    });

    it('reflects a column moved outside the panel', async () => {
      const grid = await mountGrid();
      const panel = await mountPanel(grid);
      await grid.moveColumn('amount', 'id', 'before');
      await settle(grid, panel);
      expect(listKeys(panel)).to.eql(['amount', 'id', 'name']);
    });

    it('follows the grid after it is moved in the DOM, and not while detached', async () => {
      const grid = await mountGrid();
      const panel = await mountPanel(grid);
      const parent = panel.parentElement!;
      panel.remove();
      let renders = 0;
      const host = panel as unknown as { render(): unknown };
      const render = host.render.bind(panel);
      host.render = () => {
        renders += 1;
        return render();
      };
      grid.groupBy = ['name'];
      await settle(grid);
      expect(renders, 'a detached panel does not re-render').to.equal(0);
      // A tab or dock switch: the grid changed while the panel was away.
      parent.appendChild(panel);
      await settle(grid, panel);
      expect(control(panel, 'name', 'group')!.getAttribute('aria-pressed')).to.equal('true');
      panel.remove();
      parent.appendChild(panel);
      grid.groupBy = ['id'];
      await settle(grid, panel);
      expect(control(panel, 'id', 'group')!.getAttribute('aria-pressed')).to.equal('true');
    });

    it('applies a pivotMode set before the grid to that grid', async () => {
      const grid = await mountGrid({ groupBy: ['name'] });
      const panel = await fixture<ApexGridToolPanel>(
        html`<apex-grid-tool-panel .pivotMode=${true} .grid=${grid}></apex-grid-tool-panel>`
      );
      await settle(grid, panel);
      expect(panel.pivotMode).to.be.true;
      expect(grid.groupBy).to.eql([]);
      expect(grid.pivotRows).to.eql(['name']);
    });

    it('applies a pivotMode set while unbound to the next grid', async () => {
      const grid = await mountGrid({ groupBy: ['name'] });
      const panel = await fixture<ApexGridToolPanel>(
        html`<apex-grid-tool-panel .pivotMode=${true} .grid=${null}></apex-grid-tool-panel>`
      );
      await settle(panel);
      panel.grid = grid as never;
      await settle(grid, panel);
      expect(panel.pivotMode).to.be.true;
      expect(grid.groupBy).to.eql([]);
      expect(grid.pivotRows).to.eql(['name']);
    });

    it('applies a pivotMode set right after the grid in the same task', async () => {
      const grid = await mountGrid({ groupBy: ['name'] });
      const panel = await fixture<ApexGridToolPanel>(
        html`<apex-grid-tool-panel></apex-grid-tool-panel>`
      );
      panel.grid = grid as never;
      panel.pivotMode = true;
      await settle(grid, panel);
      expect(grid.groupBy).to.eql([]);
      expect(grid.pivotRows).to.eql(['name']);
      expect(panel.pivotMode).to.be.true;
      expect(pivotToggle(panel).checked).to.be.true;
    });

    it('applies a pivotMode bound after the grid in a template', async () => {
      const grid = await mountGrid({ groupBy: ['name'] });
      const panel = await fixture<ApexGridToolPanel>(
        html`<apex-grid-tool-panel .grid=${grid} .pivotMode=${true}></apex-grid-tool-panel>`
      );
      await settle(grid, panel);
      expect(grid.pivotRows).to.eql(['name']);
      expect(panel.pivotMode).to.be.true;
      expect(pivotToggle(panel).checked).to.be.true;
    });

    it('applies a pivotMode set right after swapping grids', async () => {
      const first = await mountGrid();
      const grid = await mountGrid({ groupBy: ['name'] });
      const panel = await mountPanel(first);
      panel.grid = grid as never;
      panel.pivotMode = true;
      await settle(grid, panel);
      expect(grid.pivotRows).to.eql(['name']);
      expect(panel.pivotMode).to.be.true;
      expect(pivotToggle(panel).checked).to.be.true;
    });

    it('keeps the grouping of a grid swapped in with pivotMode false', async () => {
      const pivoting = await mountGrid({
        pivotRows: ['name'],
        pivotOn: 'id',
        pivotValues: { amount: ['sum'] },
      } as never);
      const grid = await mountGrid({ groupBy: ['name'] });
      const panel = await mountPanel(pivoting);
      expect(panel.pivotMode).to.be.true;
      panel.grid = grid as never;
      panel.pivotMode = false;
      await settle(grid, panel);
      expect(grid.groupBy).to.eql(['name']);
      expect(panel.pivotMode).to.be.false;
      expect(pivoting.pivotOn, 'the previous grid is left alone').to.equal('id');
    });

    it('does not carry the mode of the previous grid to the next one', async () => {
      const pivoting = await mountGrid({
        pivotRows: ['name'],
        pivotOn: 'id',
        pivotValues: { amount: ['sum'] },
      } as never);
      const grouped = await mountGrid({ groupBy: ['name'] });
      const plain = await mountGrid();
      const panel = await mountPanel(pivoting);
      expect(panel.pivotMode).to.be.true;
      // A framework ref often passes through null between two grids.
      panel.grid = undefined;
      await settle(panel);
      panel.grid = grouped as never;
      await settle(grouped, panel);
      expect(grouped.groupBy).to.eql(['name']);
      expect(grouped.pivotRows).to.eql([]);
      expect(panel.pivotMode).to.be.false;
      panel.grid = pivoting as never;
      await settle(pivoting, panel);
      panel.grid = plain as never;
      await settle(plain, panel);
      expect(panel.pivotMode, 'a grid with no pivot opens in grouping mode').to.be.false;
    });

    it('does not throw when bound to a grid element that is not upgraded yet', async () => {
      const early = document.createElement('apex-grid-enterprise-later') as never;
      const panel = await fixture<ApexGridToolPanel>(
        html`<apex-grid-tool-panel .grid=${early}></apex-grid-tool-panel>`
      );
      const bar = await fixture<ApexGridStatusBar>(
        html`<apex-grid-status-bar .grid=${early}></apex-grid-status-bar>`
      );
      await settle(panel, bar);
      expect(listKeys(panel)).to.eql([]);
      panel.remove();
      bar.remove();
    });

    it('switches language with the grid', async () => {
      const grid = await mountGrid();
      const panel = await mountPanel(grid);
      grid.localeText = esLocale;
      await settle(grid, panel);
      expect(panel.shadowRoot!.querySelector('[part="header"]')!.textContent!.trim()).to.equal(
        esLocale['toolPanel.columns']
      );
    });

    it('lists the source fields and labels while pivoting', async () => {
      const grid = await mountGrid();
      const panel = await mountPanel(grid);
      pivotToggle(panel).click();
      await settle(grid, panel);
      drop(zone(panel, 'Row Groups (pivot rows)'), 'id');
      drop(zone(panel, 'Column Labels'), 'name');
      drop(zone(panel, 'Values'), 'amount');
      await settle(grid, panel);
      expect(grid.isPivoting).to.be.true;
      expect(listKeys(panel)).to.eql(['id', 'name', 'amount']);
      expect(chips(panel)).to.eql(['ID', 'Amount (sum)', 'Name']);
      // Column controls would edit the throwaway generated columns.
      expect(control(panel, 'name', 'visible')).to.be.null;
      expect(control(panel, 'name', 'pin')).to.be.null;
    });

    it('opens in pivot mode on a grid that is already pivoting', async () => {
      const grid = await mountGrid({
        pivotRows: ['id'],
        pivotOn: 'name',
        pivotValues: { amount: ['sum'] },
      });
      expect(grid.isPivoting).to.be.true;
      const panel = await mountPanel(grid);
      expect(pivotToggle(panel).checked).to.be.true;
      expect(panel.pivotMode).to.be.true;
      // The panel never saw the pre-pivot columns, so it lists the data fields.
      expect(listKeys(panel)).to.include.members(['id', 'name', 'amount']);
      expect(listKeys(panel).some((key) => key?.startsWith('pivot::'))).to.be.false;
    });

    it('keeps existing pivot rows when entering pivot mode with no grouping', async () => {
      const grid = await mountGrid({ pivotRows: ['id'], pivotValues: { amount: ['sum'] } });
      const panel = await mountPanel(grid);
      pivotToggle(panel).click();
      await settle(grid, panel);
      expect(grid.pivotRows).to.eql(['id']);
    });

    it('setting pivotMode from code carries the grouping across', async () => {
      const grid = await mountGrid({ groupBy: ['name'] });
      const panel = await mountPanel(grid);
      panel.pivotMode = true;
      await settle(grid, panel);
      expect(grid.pivotRows).to.eql(['name']);
      expect(grid.groupBy).to.eql([]);
    });

    it('pins through the grid so a cancelled columnPinning is honoured', async () => {
      const grid = await mountGrid();
      const panel = await mountPanel(grid);
      const seen: string[] = [];
      grid.addEventListener('columnPinning', (event) => {
        seen.push('pinning');
        event.preventDefault();
      });
      control<HTMLButtonElement>(panel, 'id', 'pin')!.click();
      await settle(grid, panel);
      expect(seen).to.eql(['pinning']);
      expect(grid.columns.find((c) => c.key === 'id')!.pinned ?? null).to.equal(null);
    });

    it('moves through the grid so columnMoved fires', async () => {
      const grid = await mountGrid();
      const panel = await mountPanel(grid);
      const moved: string[] = [];
      grid.addEventListener('columnMoved', (event) => moved.push(String(event.detail.key)));
      control<HTMLButtonElement>(panel, 'id', 'down')!.click();
      await settle(grid, panel);
      expect(moved).to.eql(['id']);
      expect(listKeys(panel)).to.eql(['name', 'id', 'amount']);
    });

    it('lists columns in display order and moves within a pin group', async () => {
      const grid = await mountGrid();
      const panel = await mountPanel(grid);
      await grid.pinColumn('amount', 'start');
      await settle(grid, panel);
      expect(listKeys(panel)).to.eql(['amount', 'id', 'name']);
      expect(control<HTMLButtonElement>(panel, 'id', 'up')!.disabled).to.be.true;
      expect(control<HTMLButtonElement>(panel, 'amount', 'down')!.disabled).to.be.true;
      control<HTMLButtonElement>(panel, 'id', 'down')!.click();
      await settle(grid, panel);
      expect(listKeys(panel)).to.eql(['amount', 'name', 'id']);
    });

    it('pins a column whose pinned value is null on the first click', async () => {
      const grid = await mountGrid();
      grid.columns = grid.columns.map((c) => (c.key === 'id' ? { ...c, pinned: null } : c));
      const panel = await mountPanel(grid);
      control<HTMLButtonElement>(panel, 'id', 'pin')!.click();
      await settle(grid, panel);
      expect(grid.columns.find((c) => c.key === 'id')!.pinned).to.equal('start');
    });

    it('adds Values and Column Labels from the keyboard', async () => {
      const grid = await mountGrid();
      const panel = await mountPanel(grid);
      const value = control<HTMLButtonElement>(panel, 'amount', 'value')!;
      value.click();
      await settle(grid, panel);
      expect(grid.aggregations).to.eql({ amount: ['sum'] });
      expect(control(panel, 'amount', 'value')!.getAttribute('aria-pressed')).to.equal('true');
      control<HTMLButtonElement>(panel, 'amount', 'value')!.click();
      await settle(grid, panel);
      expect(grid.aggregations).to.eql({});

      expect(control(panel, 'name', 'column-label'), 'only in pivot mode').to.be.null;
      pivotToggle(panel).click();
      await settle(grid, panel);
      control<HTMLButtonElement>(panel, 'name', 'column-label')!.click();
      await settle(grid, panel);
      expect(grid.pivotOn).to.equal('name');
    });

    it('names its icon buttons with the localized label and column', async () => {
      const grid = await mountGrid();
      const panel = await mountPanel(grid);
      const pin = control<HTMLButtonElement>(panel, 'id', 'pin')!;
      expect(pin.getAttribute('aria-label')).to.equal('Pin column');
      expect(pin.closest('[role="group"]')!.getAttribute('aria-label')).to.equal('ID');
      grid.groupBy = ['name'];
      await settle(grid, panel);
      const remove = zone(panel, 'Row Groups').querySelector('[part="chip"] button')!;
      expect(remove.getAttribute('aria-label')).to.equal('Remove Name');
    });

    it('ignores dropped text that is not a column key', async () => {
      const grid = await mountGrid();
      const panel = await mountPanel(grid);
      drop(zone(panel, 'Row Groups'), 'Engineering');
      drop(zone(panel, 'Values'), 'Engineering');
      await settle(grid, panel);
      expect(grid.groupBy).to.eql([]);
      expect(grid.aggregations).to.eql({});
    });
  });
});
