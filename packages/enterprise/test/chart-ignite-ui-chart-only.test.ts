import { expect, fixture, fixtureCleanup, html, nextFrame, waitUntil } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import 'apexcharts/features/ignite-ui';
import { loadIgniteSheet } from '../../../test-setup/ignite-ui.js';
import { ApexGridChart, ApexGridEnterprise, enterpriseModules } from '../src/index.js';

/**
 * A page that loaded only ApexCharts' add-on (`apexcharts/features/ignite-ui`), for charts of its
 * own, not the grid's: the grid keeps its built-in look, and so does its chart panel. The panel
 * turns the chart's layer off (`theme.designSystem: false`) so it is not half themed.
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

type Drawn = { w: { config: { theme: Record<string, unknown> } } };

describe('chart panel with only the ApexCharts add-on', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridChart.register();
  });
  afterEach(async () => {
    await loadIgniteSheet(null);
    fixtureCleanup();
  });

  for (const theme of ['grid', 'light'] as const) {
    it(`keeps a theme="${theme}" panel off Ignite UI, as its grid is`, async () => {
      await loadIgniteSheet('dark-material');
      const parent = document.createElement('div');
      parent.style.height = '500px';
      const grid = await fixture<ApexGridEnterprise<Wide>>(
        html`<apex-grid-enterprise .data=${data.map((r) => ({ ...r }))} .columns=${columns}></apex-grid-enterprise>`,
        { parentNode: parent }
      );
      await grid.updateComplete;
      await nextFrame();
      const panel = await fixture<ApexGridChart>(
        html`<apex-grid-chart mode="inline" source="view" type="column" theme=${theme} .grid=${grid as never}></apex-grid-chart>`
      );
      await waitUntil(() => panel.getChart() != null, 'chart never rendered');
      await panel.refresh();
      const className = panel.querySelector('.apexcharts-canvas')!.className;
      expect(className).not.to.contain('apexcharts-igniteui');
      expect(className).to.contain('apexcharts-theme-light');
      expect((panel.getChart() as unknown as Drawn).w.config.theme.designSystem).to.equal(false);
    });
  }
});
