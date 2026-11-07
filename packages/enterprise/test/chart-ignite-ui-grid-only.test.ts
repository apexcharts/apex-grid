import { expect, fixture, fixtureCleanup, html, nextFrame, waitUntil } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import 'apex-grid/ignite-ui';
import { loadIgniteSheet } from '../../../test-setup/ignite-ui.js';
import { ApexGridChart, ApexGridEnterprise, enterpriseModules } from '../src/index.js';

/**
 * A page that loaded only the grid's add-on (`apex-grid/ignite-ui`), not ApexCharts' own: the
 * chart panel hands the chart the grid's resolved colours, which follow the Ignite UI theme, and
 * never loads ApexCharts' add-on itself, so a chart outside the grid keeps its own look.
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
];

(window as unknown as { Apex?: unknown }).Apex = { chart: { animations: { enabled: false } } };

type Drawn = { w: { globals: { colors: string[] } } };

function rgbOf(color: string): string {
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

describe('chart panel with only the grid add-on', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridChart.register();
  });
  afterEach(async () => {
    await loadIgniteSheet(null);
    fixtureCleanup();
  });

  it('hands over the grid colours, and leaves charts outside the grid alone', async () => {
    await loadIgniteSheet('light-bootstrap');
    const parent = document.createElement('div');
    parent.style.height = '500px';
    const grid = await fixture<ApexGridEnterprise<Wide>>(
      html`<apex-grid-enterprise .data=${data.map((r) => ({ ...r }))} .columns=${columns}></apex-grid-enterprise>`,
      { parentNode: parent }
    );
    await grid.updateComplete;
    await nextFrame();
    const panel = await fixture<ApexGridChart>(
      html`<apex-grid-chart mode="inline" source="view" type="column" .grid=${grid as never}></apex-grid-chart>`
    );
    await waitUntil(() => panel.getChart() != null, 'chart never rendered');
    await panel.refresh();
    const colors = (panel.getChart() as unknown as Drawn).w.globals.colors;
    // The grid's brand, which follows the theme's primary.
    expect(rgbOf(colors[0])).to.equal(rgbOf('#0d6efd'));
    expect(panel.querySelector('.apexcharts-canvas')!.className).not.to.contain(
      'apexcharts-igniteui'
    );
    // ApexCharts' add-on was never registered, so a chart beside the grid keeps its own look.
    const features = (globalThis as Record<string, unknown>).__apexcharts_features_v1__ as
      | Map<string, unknown>
      | undefined;
    expect(features?.get('designSystemStyles')).to.equal(undefined);
    const { default: ApexCharts } = await import('apexcharts');
    const host = document.createElement('div');
    document.body.append(host);
    try {
      const outside = new ApexCharts(host, {
        chart: { type: 'bar' },
        series: [{ name: 'A', data: [1, 2] }],
        xaxis: { categories: ['x', 'y'] },
      });
      await outside.render();
      expect(host.querySelector('.apexcharts-canvas')!.className).not.to.contain(
        'apexcharts-igniteui'
      );
      expect(rgbOf((outside as unknown as Drawn).w.globals.colors[0])).to.equal(rgbOf('#008FFB'));
      outside.destroy();
    } finally {
      host.remove();
    }
  });
});
