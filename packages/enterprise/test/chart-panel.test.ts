import { expect, fixture, fixtureCleanup, html, nextFrame, waitUntil } from '@open-wc/testing';
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

// Disable ApexCharts' render animation for the whole suite (ApexCharts reads these global defaults).
// Otherwise the async mask-reveal animation can fire after fixtureCleanup() has removed the chart's
// DOM node, surfacing as an uncaught "reading 'node'" from inside ApexCharts — a test-teardown race,
// not a product issue.
(window as unknown as { Apex?: unknown }).Apex = { chart: { animations: { enabled: false } } };

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
    // No rows → the flat view model is empty, so nothing to chart.
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise .data=${[]} .columns=${columns}></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    await grid.updateComplete;
    await nextFrame();
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
    const calls: string[] = [];
    // Stub the three model getters before the panel mounts so its initial refresh
    // never renders a real ApexCharts instance (unrenderable in the headless fixture)
    // and the refresh queue stays free for the assertions below.
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
    const panel = await mountPanel(grid);
    calls.length = 0; // ignore the initial (auto) refresh from mount

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
    // The panel debounces through rAF and its refresh is fire-and-forget, and a
    // refresh arriving while one is still in flight is queued rather than run.
    // The mount's own refresh lazy-imports ApexCharts, so it can still be in
    // flight here — for several frames when the whole suite runs in parallel.
    // Wait for the call itself rather than a fixed frame count, or the assertion
    // races that import. `waitUntil` throws on timeout, so a refresh that never
    // arrives still fails the test.
    await waitUntil(() => refreshed > 0);
    await panel.updateComplete;
    expect(refreshed).to.be.greaterThan(0);
  });

  it('renders an Export control and toggles its menu', async () => {
    const grid = await mountGrid();
    const panel = await mountPanel(grid);
    const button = panel.querySelector<HTMLButtonElement>('[part="export-button"]')!;
    const menu = panel.querySelector<HTMLElement>('[part="export-menu"]')!;
    expect(button).to.exist;
    expect(menu.hidden).to.equal(true);
    button.click();
    await panel.updateComplete;
    expect(menu.hidden).to.equal(false);
    expect(button.getAttribute('aria-expanded')).to.equal('true');
    expect(panel.querySelectorAll('[part="export-item"]').length).to.equal(3);
  });

  it('exportImage("svg") serializes the rendered svg and downloads it', async () => {
    const grid = await mountGrid();
    const panel = await mountPanel(grid);
    // The headless fixture can't run ApexCharts' raster path, so stand in a real <svg> node.
    const canvas = panel.querySelector<HTMLElement>('[part="canvas"]')!;
    canvas.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"></rect></svg>';
    let downloaded = '';
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      downloaded = this.download;
    };
    try {
      expect(await panel.exportImage('svg')).to.equal(true);
      expect(downloaded).to.equal('chart.svg');
    } finally {
      HTMLAnchorElement.prototype.click = original;
    }
  });

  it('exportImage("png") / copyImage resolve false when no chart has rendered', async () => {
    const grid = await mountGrid();
    const panel = await mountPanel(grid);
    // ApexCharts cannot render into the headless fixture, so there is no instance to rasterize.
    expect(panel.getChart()).to.equal(null);
    expect(await panel.exportImage('png')).to.equal(false);
    expect(await panel.copyImage()).to.equal(false);
  });

  it('staticModel freezes the chart and ignores the live grid source', async () => {
    const grid = await mountGrid();
    let liveCalls = 0;
    // Stub before mounting (empty → no ApexCharts render) so the initial refresh settles cleanly.
    grid.getChartModel = () => {
      liveCalls += 1;
      return EMPTY;
    };
    const panel = await mountPanel(grid);
    const whileLive = liveCalls;
    expect(whileLive).to.be.greaterThan(0); // live source consulted the grid
    // Freezing: subsequent refreshes resolve from the snapshot, never the grid.
    panel.staticModel = EMPTY;
    await panel.refresh();
    await panel.refresh();
    expect(liveCalls).to.equal(whileLive);
  });

  it('renders a Format popover with the frequently-changed controls', async () => {
    const grid = await mountGrid();
    const panel = await mountPanel(grid);
    const button = panel.querySelector<HTMLButtonElement>('[part="format-button"]')!;
    const menu = panel.querySelector<HTMLElement>('[part="format-menu"]')!;
    expect(button).to.exist;
    expect(menu.hidden).to.equal(true);
    button.click();
    await panel.updateComplete;
    expect(menu.hidden).to.equal(false);
    // legend / data labels / gridlines / number-format / trend line / reference line + band /
    // forecast + band / X + Y axis titles. Scoped to the format menu (the Data menu reuses the row part).
    expect(panel.querySelectorAll('[part="format-menu"] [part="format-row"]').length).to.equal(11);
    expect(panel.querySelector('[part="format-menu"] [part="format-row"] select')).to.exist;
    // one color swatch per series (the flat view has a single numeric series here).
    expect(panel.querySelectorAll('[part="format-swatch"]').length).to.be.greaterThan(0);
  });

  it('Data popover maps category / measures and sends a measure to the secondary axis', async () => {
    const wideCols = [
      { key: 'region', type: 'string', headerText: 'Region' },
      { key: 'revenue', type: 'number', headerText: 'Revenue' },
      { key: 'deals', type: 'number', headerText: 'Deals' },
    ] as ColumnConfiguration<Record<string, unknown>>[];
    const wideData = [
      { region: 'N', revenue: 100, deals: 5 },
      { region: 'S', revenue: 200, deals: 9 },
    ];
    const grid = await fixture<ApexGridEnterprise<Record<string, unknown>>>(
      html`<apex-grid-enterprise .data=${wideData} .columns=${wideCols}></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    await grid.updateComplete;
    await nextFrame();
    const panel = await fixture<ApexGridChart>(
      html`<apex-grid-chart mode="inline" source="view" type="combo" .grid=${grid as never}></apex-grid-chart>`
    );
    await nextFrame();
    await panel.updateComplete;

    // Open the Data popover: category select + one measure row per numeric column (region excluded).
    const dataButton = panel.querySelector<HTMLButtonElement>('[part="data-button"]')!;
    expect(dataButton).to.exist;
    dataButton.click();
    await panel.updateComplete;
    const measureRows = panel.querySelectorAll('[part="data-measure"]');
    expect(measureRows.length).to.equal(2); // revenue, deals

    // Toggle "deals" (the 2nd measure row) onto the secondary axis.
    const dealsSecondary = measureRows[1].querySelector<HTMLInputElement>(
      '[part="data-axis"] input[type="checkbox"]'
    )!;
    dealsSecondary.click();
    expect(panel.definition.secondaryMeasures).to.eql(['deals']);

    // The rebuild is async (format/definition change tears down + re-renders); poll until the chart
    // reports a dual value axis — two entries, the second on the opposite side.
    let yaxis: Array<{ opposite?: boolean }> | undefined;
    for (let i = 0; i < 40; i += 1) {
      yaxis = panel.getChart()?.w?.config?.yaxis as Array<{ opposite?: boolean }> | undefined;
      if (Array.isArray(yaxis) && yaxis.length === 2 && yaxis[1]?.opposite) break;
      await nextFrame();
    }
    expect(Array.isArray(yaxis)).to.equal(true);
    expect(yaxis?.length).to.equal(2);
    expect(yaxis?.[1].opposite).to.equal(true);
  });

  it('adds and removes a calculated-field series from the Data popover', async () => {
    const wideCols = [
      { key: 'region', type: 'string', headerText: 'Region' },
      { key: 'revenue', type: 'number', headerText: 'Revenue' },
      { key: 'deals', type: 'number', headerText: 'Deals' },
    ] as ColumnConfiguration<Record<string, unknown>>[];
    const wideData = [
      { region: 'N', revenue: 100, deals: 5 },
      { region: 'S', revenue: 200, deals: 20 },
    ];
    const grid = await fixture<ApexGridEnterprise<Record<string, unknown>>>(
      html`<apex-grid-enterprise .data=${wideData} .columns=${wideCols}></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    await grid.updateComplete;
    await nextFrame();
    const panel = await fixture<ApexGridChart>(
      html`<apex-grid-chart mode="inline" source="view" type="line" .grid=${grid as never}></apex-grid-chart>`
    );
    await nextFrame();
    await panel.updateComplete;

    panel.querySelector<HTMLButtonElement>('[part="data-button"]')!.click();
    await panel.updateComplete;

    // The Add button is disabled until a name + a valid formula are present.
    const addButton = panel.querySelector<HTMLButtonElement>('[part="calc-add"]')!;
    expect(addButton.disabled).to.equal(true);
    const nameInput = panel.querySelector<HTMLInputElement>('[part="calc-name"]')!;
    const formulaInput = panel.querySelector<HTMLInputElement>('[part="calc-formula"]')!;
    nameInput.value = 'Deal rate';
    nameInput.dispatchEvent(new Event('input'));
    formulaInput.value = 'B1 / A1 * 100'; // deals / revenue * 100
    formulaInput.dispatchEvent(new Event('input'));
    await panel.updateComplete;
    expect(panel.querySelector<HTMLButtonElement>('[part="calc-add"]')!.disabled).to.equal(false);

    panel.querySelector<HTMLButtonElement>('[part="calc-add"]')!.click();
    await panel.updateComplete;
    expect(panel.definition.calculatedFields).to.eql([
      { name: 'Deal rate', formula: 'B1 / A1 * 100' },
    ]);

    // The calculated field renders as an extra series.
    let names: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      names = (panel.getChart()?.w?.config?.series ?? []).map((s: { name: string }) => s.name);
      if (names.includes('Deal rate')) break;
      await nextFrame();
    }
    expect(names).to.include('Deal rate');

    // Remove it.
    panel.querySelector<HTMLButtonElement>('[part="calc-remove"]')!.click();
    await panel.updateComplete;
    expect(panel.definition.calculatedFields).to.equal(undefined);
  });

  it('groups the type gallery with icons and pulls Auto out as a Suggested badge', async () => {
    const grid = await mountGrid();
    const panel = await mountPanel(grid);
    const typeButtons = [...panel.querySelectorAll('[part="type-button"]')];
    // The nine concrete types (Auto is the Suggested badge, not a peer button).
    expect(typeButtons.length).to.equal(9);
    expect(typeButtons.every((b) => b.querySelector('svg'))).to.equal(true);
    const suggest = panel.querySelector<HTMLElement>('[part="suggest-button"]');
    expect(suggest).to.exist;
    expect(suggest?.querySelector('svg')).to.exist;
  });

  it('swap-axes toggle (Data popover) flips column and bar', async () => {
    const grid = await mountGrid();
    const panel = await mountPanel(grid);
    panel.type = 'column';
    await panel.updateComplete;
    panel.querySelector<HTMLButtonElement>('[part="data-button"]')!.click();
    await panel.updateComplete;
    const rows = [...panel.querySelectorAll('[part="data-menu"] [part="format-row"]')];
    const swapRow = rows.find((r) => /Swap axes/i.test(r.textContent ?? ''));
    expect(swapRow, 'swap-axes row shows for column/bar').to.exist;
    const checkbox = swapRow!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).to.equal(false);
    checkbox.click();
    await panel.updateComplete;
    expect(panel.type).to.equal('bar');
  });

  it('auto-titles the dialog heading from the mapping and renames it inline', async () => {
    const grid = await mountGrid();
    const panel = await fixture<ApexGridChart>(
      html`<apex-grid-chart .grid=${grid as never}></apex-grid-chart>`
    );
    panel.show();
    // Auto-title needs the model's series names, set during the async render — poll for it.
    let heading = panel.querySelector<HTMLElement>('[part="heading"]');
    for (let i = 0; i < 40 && heading?.textContent?.trim() !== 'Q1 by Name'; i += 1) {
      await nextFrame();
      heading = panel.querySelector<HTMLElement>('[part="heading"]');
    }
    expect(heading?.textContent?.trim()).to.equal('Q1 by Name'); // series "Q1" by category "Name"

    // Double-click to rename inline; blur commits.
    heading!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await panel.updateComplete;
    const input = panel.querySelector<HTMLInputElement>('[part="heading-input"]')!;
    expect(input).to.exist;
    input.value = 'My Chart';
    input.dispatchEvent(new Event('blur'));
    await panel.updateComplete;
    expect(panel.heading).to.equal('My Chart');
    expect(panel.querySelector('[part="heading"]')?.textContent?.trim()).to.equal('My Chart');
  });

  it('round-trips its configuration through toJSON / restore (JSON-safe)', async () => {
    const grid = await mountGrid();
    const source = await mountPanel(grid);
    source.type = 'bar';
    source.source = 'view';
    source.heading = 'Revenue by region';
    source.definition = { category: 'name', measures: ['q1'], aggregation: 'avg' };
    source.format = {
      legend: false,
      numberFormat: 'currency',
      colors: ['#123456'],
      trendline: true,
      referenceBand: { from: 20, to: 80 },
      forecastBand: true,
      axisTitles: { x: 'Region', y: 'Revenue' },
    };
    await source.updateComplete;

    // Survives a real JSON boundary (no functions leaked in).
    const json = JSON.parse(JSON.stringify(source.toJSON()));
    expect(json.type).to.equal('bar');
    expect(json.definition.aggregation).to.equal('avg');
    expect(json.format.numberFormat).to.equal('currency');

    const target = await mountPanel(grid);
    target.restore(json);
    await target.updateComplete;
    expect(target.type).to.equal('bar');
    expect(target.source).to.equal('view');
    expect(target.heading).to.equal('Revenue by region');
    expect(target.definition).to.eql({ category: 'name', measures: ['q1'], aggregation: 'avg' });
    expect(target.format).to.eql({
      legend: false,
      numberFormat: 'currency',
      colors: ['#123456'],
      trendline: true,
      referenceBand: { from: 20, to: 80 },
      forecastBand: true,
      axisTitles: { x: 'Region', y: 'Revenue' },
    });
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
    await panel.updateComplete; // let the fire-and-forget chart render settle before teardown
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
    expect(container.getAttribute('aria-modal')).to.equal('true');
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

  it('Escape-close restores focus to the previously focused element', async () => {
    const grid = await mountGrid();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    try {
      const panel = await fixture<ApexGridChart>(
        html`<apex-grid-chart .grid=${grid as never}></apex-grid-chart>`
      );
      trigger.focus();
      panel.show();
      await panel.updateComplete;
      panel
        .querySelector('[part="panel"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(document.activeElement).to.equal(trigger);
    } finally {
      trigger.remove();
    }
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

describe('ApexGridChart Format and Data controls', () => {
  type Wide = { name: string; q1: number; q2: number };
  const wideColumns: ColumnConfiguration<Wide>[] = [
    { key: 'name', type: 'string', headerText: 'Name' },
    { key: 'q1', type: 'number', headerText: 'Q1' },
    { key: 'q2', type: 'number', headerText: 'Q2' },
  ];
  const wideData: Wide[] = [
    { name: 'A', q1: 10, q2: 5 },
    { name: 'B', q1: 20, q2: 9 },
    { name: 'C', q1: 30, q2: 12 },
  ];
  type Drawn = { w: { globals: { colors: string[] }; config: Record<string, any> } };
  const drawn = (panel: ApexGridChart) => panel.getChart() as unknown as Drawn;

  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridChart.register();
  });
  afterEach(() => fixtureCleanup());

  async function mountWide(rows: unknown[] = wideData, cols: unknown[] = wideColumns) {
    const grid = await fixture<ApexGridEnterprise<Wide>>(
      html`<apex-grid-enterprise .data=${rows.map((r) => ({ ...(r as object) }))} .columns=${cols}></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    await grid.updateComplete;
    await nextFrame();
    return grid;
  }

  async function mountChart(grid: unknown, type = 'column', extra: Partial<ApexGridChart> = {}) {
    const panel = await fixture<ApexGridChart>(
      html`<apex-grid-chart mode="inline" source="view" type=${type} .grid=${grid as never}></apex-grid-chart>`
    );
    Object.assign(panel, extra);
    await waitUntil(() => panel.getChart() != null, 'chart never rendered');
    await panel.refresh();
    await panel.updateComplete;
    return panel;
  }

  const swatches = (panel: ApexGridChart) => [
    ...panel.querySelectorAll<HTMLInputElement>('[part="format-swatch"] input'),
  ];

  it('picking one series color keeps the colors the other series were drawn with', async () => {
    const panel = await mountChart(await mountWide());
    const before = [...drawn(panel).w.globals.colors];
    expect(before[0]).to.match(/^#[0-9a-f]{6}$/i);
    panel.querySelector<HTMLButtonElement>('[part="format-button"]')!.click();
    await panel.updateComplete;
    // The swatches show the drawn colors, not a gray or black placeholder.
    expect(swatches(panel).map((s) => s.value.toLowerCase())).to.eql(
      before.slice(0, 2).map((c) => c.toLowerCase())
    );
    const second = swatches(panel)[1];
    second.value = '#ff0000';
    second.dispatchEvent(new Event('input'));
    await panel.updateComplete;
    await panel.refresh();
    // Only the pick is stored: the other slot stays blank and keeps following the theme.
    expect(panel.format.colors).to.eql(['', '#ff0000']);
    expect(drawn(panel).w.globals.colors.slice(0, 2)).to.eql([before[0], '#ff0000']);
    await panel.updateComplete;
    expect(swatches(panel)[0].value.toLowerCase()).to.equal(before[0].toLowerCase());
  });

  it('a restored config with blank color slots draws them with the theme palette', async () => {
    const panel = await mountChart(await mountWide());
    const before = [...drawn(panel).w.globals.colors];
    panel.restore({ format: { colors: ['', '#ff0000'] } });
    await panel.updateComplete;
    await panel.refresh();
    expect(drawn(panel).w.globals.colors[0]).to.equal(before[0]);
  });

  it('unpicked color slots follow a theme change', async () => {
    const grid = await mountWide();
    const panel = await mountChart(grid);
    panel.restore({ format: { colors: ['', '#ff0000'] } });
    await panel.refresh();
    (grid as unknown as HTMLElement).style.setProperty('--ag-brand', '#123456');
    panel.restore({ type: 'line', format: { colors: ['', '#ff0000'] } });
    await panel.refresh();
    expect(drawn(panel).w.globals.colors.slice(0, 2)).to.eql(['#123456', '#ff0000']);
  });

  it('author apexOptions.colors fill the slots a pick leaves', async () => {
    const panel = await mountChart(await mountWide(), 'column', {
      apexOptions: { colors: ['#112233', '#445566'] },
    });
    await panel.refresh();
    panel.querySelector<HTMLButtonElement>('[part="format-button"]')!.click();
    await panel.updateComplete;
    const second = swatches(panel)[1];
    second.value = '#ff0000';
    second.dispatchEvent(new Event('input'));
    await panel.refresh();
    expect(drawn(panel).w.globals.colors.slice(0, 2)).to.eql(['#112233', '#ff0000']);
    expect(swatches(panel)[0].value).to.equal('#112233');
  });

  it('toggling a measure keeps a calculated field on the secondary axis', async () => {
    const panel = await mountChart(await mountWide(), 'line');
    panel.definition = {
      calculatedFields: [{ name: 'Rate', formula: 'B1/A1' }],
      secondaryMeasures: ['Rate', 'q2'],
    };
    await panel.updateComplete;
    panel.querySelector<HTMLButtonElement>('[part="data-button"]')!.click();
    await panel.updateComplete;
    const rows = panel.querySelectorAll('[part="data-measure"]');
    // Turn Q2 off: it leaves the secondary axis, the calculated field stays there.
    rows[1].querySelector<HTMLInputElement>('[part="data-measure-name"] input')!.click();
    await panel.updateComplete;
    expect(panel.definition.measures).to.eql(['q1']);
    expect(panel.definition.secondaryMeasures).to.eql(['Rate']);
  });

  it('author chart.events merge with the cross-filter dataPointSelection', async () => {
    const grid = await mountWide();
    grid.selectRange({ row: 0, column: 'name' }, { row: 2, column: 'q1' });
    let clicks = 0;
    let selections = 0;
    const panel = await fixture<ApexGridChart>(
      html`<apex-grid-chart
        mode="inline"
        type="column"
        cross-filter
        .apexOptions=${{
          chart: {
            events: {
              click: () => {
                clicks += 1;
              },
              dataPointSelection: () => {
                selections += 1;
              },
            },
          },
        }}
        .grid=${grid as never}
      ></apex-grid-chart>`
    );
    await waitUntil(() => panel.getChart() != null, 'chart never rendered');
    const events = drawn(panel).w.config.chart.events;
    expect(events.click).to.be.a('function');
    events.click();
    events.dataPointSelection(null, null, { dataPointIndex: 0 });
    expect(clicks).to.equal(1);
    expect(selections).to.equal(1);
    expect(grid.filterExpressions.some((f) => f.key === 'name')).to.equal(true);
  });

  const shown = (el: Element | null) => (el?.getClientRects().length ?? 0) > 0;

  it('keeps only the Data control in the empty state', async () => {
    const panel = await mountPanel((await mountWide([])) as never);
    const toolbar = panel.querySelector<HTMLElement>('[part="toolbar"]')!;
    expect(shown(panel.querySelector('[part="data-button"]'))).to.equal(true);
    for (const part of ['type-button', 'suggest-button', 'export-button', 'format-button']) {
      expect(shown(panel.querySelector(`[part="${part}"]`)), part).to.equal(false);
    }
    // No Data popover to offer (a snapshot chart): the whole toolbar hides.
    panel.staticModel = EMPTY;
    await panel.refresh();
    await panel.updateComplete;
    expect(toolbar.hidden).to.equal(true);
    expect(getComputedStyle(toolbar).display).to.equal('none');
  });

  it('a mapping that empties the chart can be undone from the Data popover', async () => {
    const panel = await mountChart(await mountGrid());
    panel.querySelector<HTMLButtonElement>('[part="data-button"]')!.click();
    await panel.updateComplete;
    const category = () => panel.querySelector<HTMLSelectElement>('[part="data-menu"] select')!;
    // The only numeric column as the category leaves no measure to chart.
    category().value = 'q1';
    category().dispatchEvent(new Event('change'));
    await panel.refresh();
    await panel.updateComplete;
    expect(panel.getChart()).to.equal(null);
    expect(shown(panel.querySelector('[part="data-button"]'))).to.equal(true);
    expect(shown(category())).to.equal(true);
    category().value = 'name';
    category().dispatchEvent(new Event('change'));
    await panel.refresh();
    await panel.updateComplete;
    expect(panel.getChart()).to.not.equal(null);
    expect(shown(panel.querySelector('[part="type-button"]'))).to.equal(true);
  });

  it('selects follow programmatic changes after a user pick', async () => {
    const panel = await mountChart(await mountWide());
    panel.querySelector<HTMLButtonElement>('[part="format-button"]')!.click();
    panel.querySelector<HTMLButtonElement>('[part="data-button"]')!.click();
    await panel.updateComplete;
    const numberSelect = panel.querySelector<HTMLSelectElement>('[part="format-menu"] select')!;
    const [categorySelect, aggSelect] = panel.querySelectorAll<HTMLSelectElement>(
      '[part="data-menu"] select'
    );
    numberSelect.value = 'currency';
    numberSelect.dispatchEvent(new Event('change'));
    aggSelect.value = 'max';
    aggSelect.dispatchEvent(new Event('change'));
    categorySelect.value = 'q1';
    categorySelect.dispatchEvent(new Event('change'));
    await panel.updateComplete;
    panel.restore({ format: { numberFormat: 'percent' }, definition: { aggregation: 'avg' } });
    await panel.updateComplete;
    expect([numberSelect.value, aggSelect.value]).to.eql(['percent', 'avg']);
    // Back to the values the user picked: the selects must show them again.
    panel.restore({
      format: { numberFormat: 'currency' },
      definition: { aggregation: 'max', category: 'q1' },
    });
    await panel.updateComplete;
    expect([numberSelect.value, aggSelect.value, categorySelect.value]).to.eql([
      'currency',
      'max',
      'q1',
    ]);
    panel.restore({ format: {}, definition: {} });
    await panel.updateComplete;
    expect(numberSelect.value).to.equal('none');
    expect(aggSelect.value).to.equal('sum');
    expect(categorySelect.value).to.equal('name');
  });

  it('offers a None category when no column is non-numeric', async () => {
    const grid = await mountWide(
      [
        { year: 2020, q1: 1 },
        { year: 2021, q1: 2 },
      ],
      [
        { key: 'year', type: 'number', headerText: 'Year' },
        { key: 'q1', type: 'number', headerText: 'Q1' },
      ]
    );
    const panel = await mountChart(grid);
    panel.querySelector<HTMLButtonElement>('[part="data-button"]')!.click();
    await panel.updateComplete;
    const select = panel.querySelector<HTMLSelectElement>('[part="data-menu"] select')!;
    expect(select.value).to.equal('');
    expect(select.options[0].textContent?.trim()).to.equal('None');
    select.value = 'year';
    select.dispatchEvent(new Event('change'));
    await panel.updateComplete;
    expect(panel.definition.category).to.equal('year');
    expect(select.value).to.equal('year');
  });
});
