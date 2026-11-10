import { expect, fixture, fixtureCleanup, html, nextFrame, waitUntil } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import 'apex-grid/ignite-ui';
import 'apexcharts/features/ignite-ui';
import { loadIgniteSheet, resolveColor } from '../../../test-setup/ignite-ui.js';
import { ApexGridChart, ApexGridEnterprise, enterpriseModules } from '../src/index.js';

/**
 * The chart panel on a page that loaded both add-ons, the grid's (`apex-grid/ignite-ui`) and
 * ApexCharts' own (`apexcharts/features/ignite-ui`). With `theme="grid"` and an Ignite UI theme on
 * the page, the panel hands the chart only what the page set on the grid, so the chart reads the
 * theme itself, as a chart beside the grid does. Without a theme on the page, or with the grid's
 * `design-system` or `tokens` switch off, it hands over the grid's resolved colours as it does
 * without the add-on. `chart-ignite-ui-grid-only.test.ts` and `chart-ignite-ui-chart-only.test.ts`
 * cover a page with one add-on.
 */

type Wide = { name: string; q1: number; q2: number };
const columns: ColumnConfiguration<Wide>[] = [
  { key: 'name', type: 'string', headerText: 'Name' },
  { key: 'q1', type: 'number', headerText: 'Q1' },
  { key: 'q2', type: 'number', headerText: 'Q2' },
];
const data: Wide[] = [
  { name: 'A', q1: 10, q2: 5 },
  { name: 'B', q1: 20, q2: 9 },
  { name: 'C', q1: 30, q2: 12 },
];

(window as unknown as { Apex?: unknown }).Apex = { chart: { animations: { enabled: false } } };

type Drawn = {
  w: { globals: { colors: string[]; dom: { baseEl: HTMLElement } }; config: Record<string, any> };
};
type Handed = {
  colors?: string[];
  chart?: { foreColor?: string };
  theme?: { mode?: string; designSystem?: boolean; tokens?: boolean };
};

function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '500px';
  return node;
}

async function mountGrid(attrs: Record<string, string> = {}, style = '') {
  const grid = await fixture<ApexGridEnterprise<Wide>>(
    html`<apex-grid-enterprise .data=${data.map((r) => ({ ...r }))} .columns=${columns}></apex-grid-enterprise>`,
    { parentNode: sizedParent() }
  );
  for (const [name, value] of Object.entries(attrs)) grid.setAttribute(name, value);
  if (style) (grid as unknown as HTMLElement).style.cssText = style;
  await grid.updateComplete;
  await nextFrame();
  return grid;
}

async function mountChart(grid: unknown) {
  const panel = await fixture<ApexGridChart>(
    html`<apex-grid-chart mode="inline" source="view" type="column" .grid=${grid as never}></apex-grid-chart>`
  );
  await waitUntil(() => panel.getChart() != null, 'chart never rendered');
  await panel.refresh();
  await panel.updateComplete;
  return panel;
}

const drawn = (panel: ApexGridChart) => panel.getChart() as unknown as Drawn;

/** The fill ApexCharts painted the first x-axis label with (the attribute, else the computed one). */
function labelFill(panel: ApexGridChart): { attribute: string | null; computed: string } {
  const label = panel.querySelector<SVGElement>('.apexcharts-xaxis-label')!;
  return { attribute: label.getAttribute('fill'), computed: getComputedStyle(label).fill };
}
const canvasClass = (root: ParentNode) => root.querySelector('.apexcharts-canvas')!.className;

/** The options the next redraw hands ApexCharts, copied before ApexCharts edits them. */
async function handed(panel: ApexGridChart): Promise<Handed> {
  const chart = panel.getChart() as unknown as {
    updateOptions(o: Handed, ...r: unknown[]): unknown;
  };
  const update = chart.updateOptions;
  let seen: Handed = {};
  chart.updateOptions = function (o: Handed, ...rest: unknown[]) {
    seen = { colors: o.colors && [...o.colors], chart: { ...o.chart }, theme: { ...o.theme } };
    return update.call(this, o, ...rest);
  };
  await panel.refresh();
  chart.updateOptions = update;
  return seen;
}

/** A colour as the browser paints it, `rgb(r, g, b)`. */
function rgbOf(color: string): string {
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

describe('chart panel with the Ignite UI add-on', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridChart.register();
  });
  afterEach(async () => {
    await loadIgniteSheet(null);
    fixtureCleanup();
  });

  it('lets the chart read a light theme itself, handing it no colours', async () => {
    await loadIgniteSheet('light-bootstrap');
    const panel = await mountChart(await mountGrid());
    const options = await handed(panel);
    expect(options.colors, 'colors').to.equal(undefined);
    // Nothing the page did not set: no mode, no foreColor key, and no switch written as true
    // (a page-wide `window.Apex` setting keeps its say).
    expect(options.theme, 'theme').to.eql({});
    expect(options.chart, 'chart').not.to.have.property('foreColor');
    // Series 1 and 2: the theme's primary and secondary, as on a chart beside the grid.
    const colors = drawn(panel).w.globals.colors.slice(0, 2).map(rgbOf);
    expect(colors).to.eql([rgbOf('#0d6efd'), rgbOf('#6c757d')]);
    // ApexCharts' add-on is loaded: the chart wears its gate class.
    expect(canvasClass(panel)).to.contain('apexcharts-igniteui');
    expect(canvasClass(panel)).to.contain('apexcharts-theme-light');
  });

  it('goes dark with the grid under a dark theme, with no mode set', async () => {
    await loadIgniteSheet('dark-material');
    const grid = await mountGrid();
    const panel = await mountChart(grid);
    expect(canvasClass(panel)).to.contain('apexcharts-theme-dark');
    // The labels take the theme's text colour, as on a chart beside the grid (gray 800 in a dark
    // theme is light), never a missing fill that paints black.
    const fill = labelFill(panel);
    expect(fill.attribute, 'label fill').to.be.a('string');
    expect(rgbOf(fill.computed)).to.equal(rgbOf(resolveColor('var(--ig-gray-800)')));
    expect(drawn(panel).w.config.chart.foreColor).to.be.a('string');
    // The panel chrome takes the theme's font, as the grid does.
    const part = panel.querySelector<HTMLElement>('[part="panel"]') ?? panel;
    expect(getComputedStyle(part).fontFamily).to.contain('Titillium Web');
    expect(rgbOf(drawn(panel).w.globals.colors[0])).to.equal(rgbOf('#09f'));
    // The panel chrome carries the grid's dark surface: the theme's card, not the built-in slate.
    const surface = getComputedStyle(grid as unknown as Element).getPropertyValue('--_ag-surface');
    expect(rgbOf(surface)).to.equal(rgbOf(resolveColor('var(--ig-surface-500)')));
    expect(rgbOf(surface)).not.to.equal(rgbOf('#0f172a'));
    // And its header: 7.4 has no raised surface, so the card lifted toward the theme's text,
    // neither the card itself nor the built-in slate.
    const header = resolveColor(
      getComputedStyle(grid as unknown as Element).getPropertyValue('--_ag-surface-elevated')
    );
    expect(header).to.equal(
      resolveColor('color-mix(in srgb, var(--ig-gray-800) 6%, var(--ig-surface-500))')
    );
    expect(header).not.to.equal(resolveColor(surface));
    expect(header).not.to.equal(resolveColor('#1e2532'));
    expect(resolveColor(panel.style.getPropertyValue('--_ag-surface-elevated'))).to.equal(header);
  });

  it('keeps theme="light" light under a dark theme', async () => {
    await loadIgniteSheet('dark-material');
    const panel = await mountChart(await mountGrid({ theme: 'light' }));
    expect((await handed(panel)).theme?.mode).to.equal('light');
    expect(canvasClass(panel)).to.contain('apexcharts-theme-light');
  });

  it('hands over a brand the page set on the grid as the chart accent, the theme after it', async () => {
    await loadIgniteSheet('light-bootstrap');
    const grid = await mountGrid({}, '--ag-brand: rgb(200, 0, 0);');
    const panel = await mountChart(grid);
    expect(panel.style.getPropertyValue('--apx-accent')).to.equal('rgb(200, 0, 0)');
    const colors = drawn(panel).w.globals.colors.slice(0, 2).map(rgbOf);
    expect(colors).to.eql(['rgb(200, 0, 0)', rgbOf('#6c757d')]);
    // Dropped again, the chart goes back to the theme's primary.
    (grid as unknown as HTMLElement).style.cssText = '';
    await handed(panel);
    expect(panel.style.getPropertyValue('--apx-accent')).to.equal('');
    expect(rgbOf(drawn(panel).w.globals.colors[0])).to.equal(rgbOf('#0d6efd'));
  });

  it('never removes an --apx-accent the page set on the panel', async () => {
    await loadIgniteSheet('light-bootstrap');
    const panel = await mountChart(await mountGrid());
    panel.style.setProperty('--apx-accent', 'rgb(0, 120, 0)');
    await handed(panel);
    expect(panel.style.getPropertyValue('--apx-accent')).to.equal('rgb(0, 120, 0)');
  });

  it('hands over a text colour the page set, for the grid mode', async () => {
    await loadIgniteSheet('dark-material');
    const style = '--ag-text-body: rgb(10, 20, 30); --ag-dark-text-body: rgb(230, 220, 210);';
    const dark = await mountChart(await mountGrid({}, style));
    expect(rgbOf((await handed(dark)).chart!.foreColor!)).to.equal('rgb(230, 220, 210)');
    const light = await mountChart(await mountGrid({ theme: 'light' }, style));
    expect(rgbOf((await handed(light)).chart!.foreColor!)).to.equal('rgb(10, 20, 30)');
  });

  it('redraws from scratch when the page drops its text colour, the theme filling it again', async () => {
    await loadIgniteSheet('dark-material');
    const grid = await mountGrid({}, '--ag-dark-text-body: rgb(230, 220, 210);');
    const panel = await mountChart(grid);
    const first = panel.getChart();
    expect(labelFill(panel).computed).to.equal('rgb(230, 220, 210)');
    (grid as unknown as HTMLElement).style.cssText = '';
    await panel.refresh();
    // An update cannot take a foreColor back: the chart is rebuilt, and the theme fills it.
    expect(panel.getChart()).not.to.equal(first);
    expect(rgbOf(labelFill(panel).computed)).to.equal(rgbOf(resolveColor('var(--ig-gray-800)')));
  });

  it('follows a live theme swap, with no redraw asked for', async () => {
    await loadIgniteSheet('light-material');
    const panel = await mountChart(await mountGrid());
    expect(canvasClass(panel)).to.contain('apexcharts-theme-light');
    await loadIgniteSheet('dark-material');
    await waitUntil(
      () => canvasClass(panel).includes('apexcharts-theme-dark'),
      'the chart never followed the swap'
    );
    // The chrome follows too.
    expect(rgbOf(panel.style.getPropertyValue('--_ag-surface'))).to.equal(
      rgbOf(resolveColor('var(--ig-surface-500)'))
    );
  });

  it('honours a page-wide window.Apex opt-out, handing over the grid colours', async () => {
    await loadIgniteSheet('light-bootstrap');
    const page = window as unknown as { Apex: Record<string, unknown> };
    const before = page.Apex;
    page.Apex = { ...before, theme: { designSystem: false } };
    try {
      const panel = await mountChart(await mountGrid());
      const options = await handed(panel);
      // Never written as true over the page's own setting.
      expect(options.theme).not.to.have.property('designSystem');
      expect(rgbOf(options.colors![0])).to.equal(rgbOf('#0d6efd'));
      expect(canvasClass(panel)).not.to.contain('apexcharts-igniteui');
    } finally {
      page.Apex = before;
    }
  });

  it('hands over the grid colours with design-system="off", the chart off Ignite UI', async () => {
    await loadIgniteSheet('light-bootstrap');
    const panel = await mountChart(await mountGrid({ 'design-system': 'off' }));
    const options = await handed(panel);
    expect(options.colors?.[0]).to.equal('#0d6fd3');
    expect(options.theme?.designSystem).to.equal(false);
    expect(options.theme?.mode).to.equal('light');
    expect(canvasClass(panel)).not.to.contain('apexcharts-igniteui');
  });

  it('hands over the built-in colours with tokens="off", the chart tokens off', async () => {
    await loadIgniteSheet('dark-material');
    const panel = await mountChart(await mountGrid({ tokens: 'off' }));
    const options = await handed(panel);
    expect(options.colors?.[0]).to.equal('#0d6fd3');
    expect(options.theme).to.include({ mode: 'light', tokens: false, designSystem: false });
    expect(canvasClass(panel)).to.contain('apexcharts-theme-light');
  });

  it('hands over the grid colours, as without the add-on, when no Ignite UI theme is loaded', async () => {
    const panel = await mountChart(await mountGrid());
    const options = await handed(panel);
    expect(options.colors?.slice(0, 2)).to.eql(['#0d6fd3', '#0a56b8']);
    expect(options.theme?.mode).to.equal('light');
    expect(canvasClass(panel)).not.to.contain('apexcharts-igniteui');
  });

  it('follows the theme inside an open shadow root', async () => {
    await loadIgniteSheet('light-fluent');
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const parent = sizedParent();
    root.append(parent);
    document.body.append(host);
    try {
      const grid = document.createElement(
        'apex-grid-enterprise'
      ) as unknown as ApexGridEnterprise<Wide>;
      grid.columns = columns;
      grid.data = data.map((r) => ({ ...r }));
      parent.append(grid as unknown as HTMLElement);
      await grid.updateComplete;
      await nextFrame();
      const panel = document.createElement('apex-grid-chart') as ApexGridChart;
      panel.setAttribute('mode', 'inline');
      panel.setAttribute('source', 'view');
      panel.setAttribute('type', 'column');
      (panel as unknown as { grid: unknown }).grid = grid;
      root.append(panel);
      await waitUntil(() => panel.getChart() != null, 'chart never rendered');
      await panel.refresh();
      expect(rgbOf(drawn(panel).w.globals.colors[0])).to.equal(rgbOf('#0078d4'));
      expect(canvasClass(panel)).to.contain('apexcharts-igniteui');
      // ApexCharts puts its add-on's rules in the shadow root it draws in.
      expect(root.getElementById('apexcharts-igniteui-css'), 'twin sheet').to.exist;
    } finally {
      host.remove();
    }
  });
});
