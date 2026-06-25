import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { ApexGridEnterprise, ApexGridStatusBar, enterpriseModules } from '../src/index.js';

interface Row {
  id: number;
  amount: number;
}

const data: Row[] = [
  { id: 1, amount: 10 },
  { id: 2, amount: 20 },
  { id: 3, amount: 30 },
];
const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number', headerText: 'ID' },
  { key: 'amount', type: 'number', headerText: 'Amount' },
];

async function mount() {
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`
  );
  const bar = await fixture<ApexGridStatusBar>(
    html`<apex-grid-status-bar .grid=${grid}></apex-grid-status-bar>`
  );
  await grid.updateComplete;
  await bar.updateComplete;
  await nextFrame();
  return { grid, bar };
}

function controller(grid: ApexGridEnterprise<Row>) {
  return (
    grid as unknown as {
      stateController: { module(id: string): { handleCellInteraction(i: unknown): void } };
    }
  ).stateController.module('range-selection');
}

function selectAmountColumn(grid: ApexGridEnterprise<Row>): void {
  const column = grid.columns.find((c) => c.key === 'amount')!;
  const base = {
    column,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    originalEvent: new PointerEvent('pointerdown', { button: 0 }),
  };
  controller(grid).handleCellInteraction({
    ...base,
    kind: 'down',
    row: grid.pageItems[0],
    rowIndex: 0,
  });
  controller(grid).handleCellInteraction({
    ...base,
    kind: 'over',
    row: grid.pageItems[2],
    rowIndex: 2,
  });
  controller(grid).handleCellInteraction({
    ...base,
    kind: 'up',
    row: grid.pageItems[2],
    rowIndex: 2,
  });
}

describe('ApexGridStatusBar', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridStatusBar.register();
  });
  afterEach(() => fixtureCleanup());

  it('shows a hint when nothing is selected', async () => {
    const { bar } = await mount();
    const hint = bar.shadowRoot!.querySelector('[part="hint"]');
    expect(hint).to.exist;
    expect(hint!.textContent).to.contain('Select');
  });

  it('shows count + numeric aggregates for the selected range', async () => {
    const { grid, bar } = await mount();
    selectAmountColumn(grid); // amount [10,20,30]
    await bar.updateComplete;
    await nextFrame();

    const labels = [...bar.shadowRoot!.querySelectorAll('[part="stat-label"]')].map((el) =>
      el.textContent?.trim()
    );
    expect(labels).to.include.members(['Count', 'Sum', 'Avg', 'Min', 'Max']);

    const values = [...bar.shadowRoot!.querySelectorAll('[part="stat-value"]')].map((el) =>
      el.textContent?.trim()
    );
    // Count=3, Sum=60, Avg=20, Min=10, Max=30
    expect(values).to.include.members(['3', '60', '20', '10', '30']);
  });

  it('returns to the hint after the selection is cleared', async () => {
    const { grid, bar } = await mount();
    selectAmountColumn(grid);
    await bar.updateComplete;
    await nextFrame();
    expect(bar.shadowRoot!.querySelector('[part="stat"]')).to.exist;

    grid.clearRangeSelection();
    await bar.updateComplete;
    await nextFrame();
    expect(bar.shadowRoot!.querySelector('[part="hint"]')).to.exist;
    expect(bar.shadowRoot!.querySelector('[part="stat"]')).to.not.exist;
  });
});
