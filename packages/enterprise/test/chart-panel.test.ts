import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  ApexGridChart,
  ApexGridEnterprise,
  type ChartModel,
  enterpriseModules,
} from '../src/index.js';

interface Row {
  name: string;
  q1: number;
}
const data: Row[] = [
  { name: 'A', q1: 10 },
  { name: 'B', q1: 20 },
  { name: 'C', q1: 30 },
];
const columns: ColumnConfiguration<Row>[] = [
  { key: 'name', type: 'string', headerText: 'Name' },
  { key: 'q1', type: 'number', headerText: 'Q1' },
];

const EMPTY: ChartModel = { categories: [], series: [] };

function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '500px';
  return node;
}

async function mountGrid() {
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise .data=${data.map((r) => ({ ...r }))} .columns=${columns}></apex-grid-enterprise>`,
    { parentNode: sizedParent() }
  );
  await grid.updateComplete;
  await nextFrame();
  return grid;
}

/** Mount an inline panel and let its initial (debounced) refresh settle. */
async function mountPanel(grid: ApexGridEnterprise<Row>) {
  const panel = await fixture<ApexGridChart>(
    html`<apex-grid-chart mode="inline" .grid=${grid as never}></apex-grid-chart>`
  );
  await nextFrame();
  await panel.updateComplete;
  return panel;
}

describe('ApexGridChart panel', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridChart.register();
  });
  afterEach(() => fixtureCleanup());

  it('renders in light DOM (no shadow root) so ApexCharts can render into it', async () => {
    const grid = await mountGrid();
    const panel = await mountPanel(grid);
    expect(panel.shadowRoot).to.equal(null);
    expect(panel.querySelector('[part="canvas"]')).to.exist;
  });

  it('shows the placeholder and no chart when the model is empty', async () => {
    const grid = await mountGrid();
    const panel = await mountPanel(grid);
    const placeholder = panel.querySelector<HTMLElement>('[part="placeholder"]')!;
    const canvas = panel.querySelector<HTMLElement>('[part="canvas"]')!;
    expect(placeholder.hidden).to.equal(false);
    expect(canvas.hidden).to.equal(true);
    expect(panel.getChart()).to.equal(null);
  });

  it('type gallery click updates the type and fires apex-chart-type-changed', async () => {
    const grid = await mountGrid();
    const panel = await mountPanel(grid);
    let detailType: string | null = null;
    panel.addEventListener('apex-chart-type-changed', (event) => {
      detailType = (event as CustomEvent<{ type: string }>).detail.type;
    });
    const lineButton = [...panel.querySelectorAll<HTMLButtonElement>('[part="type-button"]')].find(
      (b) => b.textContent?.trim() === 'Line'
    )!;
    lineButton.click();
    expect(panel.type).to.equal('line');
    expect(detailType).to.equal('line');
  });

  it('resolves the model by source', async () => {
    const grid = await mountGrid();
    const panel = await mountPanel(grid);
    const calls: string[] = [];
    grid.getRangeChartModel = () => {
      calls.push('selection');
      return EMPTY;
    };
    grid.getViewChartModel = () => {
      calls.push('view');
      return EMPTY;
    };
    grid.getChartModel = () => {
      calls.push('auto');
      return EMPTY;
    };

    panel.source = 'selection';
    await panel.refresh();
    panel.source = 'view';
    await panel.refresh();
    panel.source = 'auto';
    await panel.refresh();

    expect(calls).to.eql(['selection', 'view', 'auto']);
  });

  it('live-refreshes when the grid fires apex-range-changed', async () => {
    const grid = await mountGrid();
    const panel = await mountPanel(grid);
    let refreshed = 0;
    grid.getChartModel = () => {
      refreshed += 1;
      return EMPTY;
    };
    grid.dispatchEvent(new CustomEvent('apex-range-changed', { bubbles: true, composed: true }));
    await nextFrame();
    await panel.updateComplete;
    expect(refreshed).to.be.greaterThan(0);
  });

  it('dialog show()/close() toggles open and fires apex-chart-closed', async () => {
    const grid = await mountGrid();
    const panel = await fixture<ApexGridChart>(
      html`<apex-grid-chart .grid=${grid as never}></apex-grid-chart>`
    );
    expect(panel.mode).to.equal('dialog');
    let closed = 0;
    panel.addEventListener('apex-chart-closed', () => {
      closed += 1;
    });
    panel.show();
    expect(panel.open).to.equal(true);
    panel.close();
    expect(panel.open).to.equal(false);
    expect(closed).to.equal(1);
  });

  it('exposes role="dialog" and labels the panel in dialog mode', async () => {
    const grid = await mountGrid();
    const panel = await fixture<ApexGridChart>(
      html`<apex-grid-chart heading="Revenue" .grid=${grid as never}></apex-grid-chart>`
    );
    await panel.updateComplete;
    const container = panel.querySelector('[part="panel"]')!;
    expect(container.getAttribute('role')).to.equal('dialog');
    expect(container.getAttribute('aria-label')).to.equal('Revenue');
  });

  it('Escape closes an open dialog panel', async () => {
    const grid = await mountGrid();
    const panel = await fixture<ApexGridChart>(
      html`<apex-grid-chart .grid=${grid as never}></apex-grid-chart>`
    );
    let closed = 0;
    panel.addEventListener('apex-chart-closed', () => {
      closed += 1;
    });
    panel.show();
    await panel.updateComplete;
    panel
      .querySelector('[part="panel"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.open).to.equal(false);
    expect(closed).to.equal(1);
  });
});

describe('ApexGridEnterprise "Create chart" toolbar action', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridChart.register();
  });
  afterEach(() => {
    fixtureCleanup();
    for (const el of document.body.querySelectorAll('apex-grid-chart')) el.remove();
  });

  it('contributes a create-chart action (community grid contributes none)', async () => {
    const grid = await mountGrid();
    expect(grid.toolbarActions.map((a) => a.id)).to.include('create-chart');
  });

  it('renders the create-chart action as a toolbar button', async () => {
    const grid = await mountGrid();
    await grid.updateComplete;
    const toolbar = grid.shadowRoot?.querySelector('apex-grid-toolbar');
    await (toolbar as unknown as { updateComplete?: Promise<unknown> })?.updateComplete;
    const button = toolbar?.shadowRoot?.querySelector<HTMLElement>('[part="toolbar-action"]');
    expect(button, 'toolbar-action button rendered').to.exist;
    expect(button?.textContent?.trim()).to.equal('Create chart');
  });

  it('opens a dialog panel bound to the grid, and removes it on close', async () => {
    const grid = await mountGrid();
    grid.toolbarActions.find((a) => a.id === 'create-chart')!.run();
    const panel = document.body.querySelector<ApexGridChart>('apex-grid-chart')!;
    expect(panel).to.exist;
    expect(panel.open).to.equal(true);
    expect(panel.grid).to.equal(grid as never);

    panel.close();
    await nextFrame();
    expect(document.body.querySelector('apex-grid-chart')).to.equal(null);
  });
});

describe('ApexGridChart cross-filter', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridChart.register();
  });
  afterEach(() => {
    for (const c of document.querySelectorAll('apex-grid-chart')) c.remove();
    fixtureCleanup();
  });

  it('getCrossFilterModel aggregates over the full data with a categoryKey', async () => {
    const grid = await mountGrid();
    grid.selectRange({ row: 0, column: 'name' }, { row: 2, column: 'q1' });
    const { categoryKey, model } = grid.getCrossFilterModel();
    expect(categoryKey).to.equal('name');
    expect(model.categories).to.eql(['A', 'B', 'C']);
    expect(model.series[0].data).to.eql([10, 20, 30]);
  });

  // A disconnected panel never runs its update cycle, so selectCategory is exercised
  // without triggering a real ApexCharts render.
  function detachedPanel(grid: ApexGridEnterprise<Row>) {
    const panel = document.createElement('apex-grid-chart') as ApexGridChart;
    panel.grid = grid as never;
    return panel;
  }

  it('selectCategory toggles a grid filter on the category column', async () => {
    const grid = await mountGrid();
    grid.selectRange({ row: 0, column: 'name' }, { row: 2, column: 'q1' });
    const panel = detachedPanel(grid);

    panel.selectCategory(0);
    expect(grid.filterExpressions.map((f) => f.key)).to.include('name');
    expect(grid.filterExpressions.some((f) => f.key === 'q1')).to.equal(false);

    panel.selectCategory(0); // re-click clears
    expect(grid.filterExpressions.some((f) => f.key === 'name')).to.equal(false);
  });

  it('preserves a filter on another column', async () => {
    const grid = await mountGrid();
    grid.selectRange({ row: 0, column: 'name' }, { row: 2, column: 'q1' });
    grid.filter({ key: 'q1', condition: 'equals', searchTerm: 10 });
    const panel = detachedPanel(grid);

    panel.selectCategory(0);
    const keys = grid.filterExpressions.map((f) => f.key);
    expect(keys).to.include('q1');
    expect(keys).to.include('name');
  });

  it('clears its cross-filter on disconnect', async () => {
    const grid = await mountGrid();
    grid.selectRange({ row: 0, column: 'name' }, { row: 2, column: 'q1' });
    const panel = detachedPanel(grid);
    panel.selectCategory(0);
    expect(grid.filterExpressions.some((f) => f.key === 'name')).to.equal(true);

    document.body.appendChild(panel);
    panel.remove(); // disconnectedCallback clears the cross-filter
    await nextFrame();
    expect(grid.filterExpressions.some((f) => f.key === 'name')).to.equal(false);
  });
});
