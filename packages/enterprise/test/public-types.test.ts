import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  AI_TAG,
  ApexGridAI,
  ApexGridChart,
  ApexGridEnterprise,
  type ApexGridEnterpriseHost,
  ApexGridFilterBuilder,
  ApexGridSetFilter,
  ApexGridStatusBar,
  ApexGridToolPanel,
  CHART_TAG,
  type ChartModel,
  type ChartSeries,
  enterpriseModules,
  FILTER_BUILDER_TAG,
  linearForecast,
  linearForecastBand,
  linearTrend,
  recommendChartType,
  SET_FILTER_TAG,
  STATUS_BAR_TAG,
  TOOL_PANEL_TAG,
} from '../src/index.js';

// Rows typed both ways a TypeScript app writes them: the companion `grid`
// properties must accept either without a cast. tsc checks this file (the
// enterprise tsconfig includes test/**), so a type regression fails there.
interface EmployeeRow {
  name: string;
  salary: number;
}
type EmployeeAlias = { name: string; salary: number };

/** Every companion element with a `grid` property, keyed by tag. */
type Companions = {
  ai: ApexGridAI;
  chart: ApexGridChart;
  filterBuilder: ApexGridFilterBuilder;
  setFilter: ApexGridSetFilter;
  statusBar: ApexGridStatusBar;
  toolPanel: ApexGridToolPanel;
};

function companions(): Companions {
  return {
    ai: document.createElement(AI_TAG) as ApexGridAI,
    chart: document.createElement(CHART_TAG) as ApexGridChart,
    filterBuilder: document.createElement(FILTER_BUILDER_TAG) as ApexGridFilterBuilder,
    setFilter: document.createElement(SET_FILTER_TAG) as ApexGridSetFilter,
    statusBar: document.createElement(STATUS_BAR_TAG) as ApexGridStatusBar,
    toolPanel: document.createElement(TOOL_PANEL_TAG) as ApexGridToolPanel,
  };
}

/** Plain assignments, no casts: this is the line a typed app writes. */
function bindAll(
  c: Companions,
  grid: ApexGridEnterprise<EmployeeRow> | ApexGridEnterprise<EmployeeAlias> | null
): void {
  c.ai.grid = grid;
  c.chart.grid = grid;
  c.filterBuilder.grid = grid;
  c.setFilter.grid = grid;
  c.statusBar.grid = grid;
  c.toolPanel.grid = grid;
}

describe('enterprise public types', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridAI.register();
    ApexGridChart.register();
    ApexGridFilterBuilder.register();
    ApexGridSetFilter.register();
    ApexGridStatusBar.register();
    ApexGridToolPanel.register();
  });
  afterEach(() => fixtureCleanup());

  describe('companion grid property', () => {
    it('binds a grid typed with interface rows and with type-alias rows, then unbinds', async () => {
      const columns: ColumnConfiguration<EmployeeRow>[] = [{ key: 'name' }, { key: 'salary' }];
      const data: EmployeeRow[] = [{ name: 'Ada', salary: 10 }];
      const byInterface = await fixture<ApexGridEnterprise<EmployeeRow>>(
        html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`
      );
      const byAlias = byInterface as unknown as ApexGridEnterprise<EmployeeAlias>;
      const c = companions();

      for (const grid of [byInterface, byAlias]) {
        bindAll(c, grid);
        for (const element of Object.values(c)) expect(element.grid).to.equal(grid);
      }
      // Every companion starts unbound and takes null back, the tool panel included.
      bindAll(c, null);
      for (const element of Object.values(c)) expect(element.grid).to.equal(null);
      expect(companions().toolPanel.grid).to.equal(null);

      // The shared host type names what the companions accept.
      const host: ApexGridEnterpriseHost = byInterface;
      expect(host).to.equal(byInterface);
    });
  });

  describe('chart series with gaps', () => {
    it('types ChartSeries.data with null gaps', () => {
      const series: ChartSeries = { name: 'Margin', data: [1, null, 3] };
      const model: ChartModel = { categories: ['a', 'b', 'c'], series: [series] };
      expect(model.series[0].data).to.eql([1, null, 3]);
      // A gap does not count as a negative or add to the total.
      expect(recommendChartType(model)).to.equal('pie');
    });

    it('fits the trend and forecast over the points present, skipping gaps', () => {
      const gappy = [10, null, 30, null, 50];
      // Before, a gap read as 0 and pulled the line down.
      expect(linearTrend(gappy)).to.eql([10, 20, 30, 40, 50]);
      expect(linearForecast(gappy, 2)).to.eql([60, 70]);
      // Three collinear points: no spread, so the band collapses onto the forecast.
      const band = linearForecastBand(gappy, 2);
      expect(band.upper).to.eql([60, 70]);
      expect(band.lower).to.eql([60, 70]);
      // Gaps also leave the band math (x mean and spread) on the points present.
      const noisy = linearForecastBand([1, null, 4, 2, null, 6], 1);
      const fit = linearForecastBand([1, 4, 2, 6], 1);
      expect(noisy.upper[0]).to.be.greaterThan(noisy.lower[0]);
      expect(noisy.upper[0] - noisy.lower[0]).to.not.equal(fit.upper[0] - fit.lower[0]);
    });

    it('collapses the band onto the forecast below three fitted points', () => {
      // One or two points leave no spread to estimate: zero width, never NaN.
      for (const values of [[1, 2], [5, null, null, 7], [null, null, null, null], [4]]) {
        const forecast = linearForecast(values, 2);
        const band = linearForecastBand(values, 2);
        expect(band.upper).to.eql(forecast);
        expect(band.lower).to.eql(forecast);
        for (const v of [...band.upper, ...band.lower]) expect(Number.isFinite(v)).to.equal(true);
      }
    });

    it('keeps an all-gap or empty series flat at zero', () => {
      expect(linearTrend([])).to.eql([]);
      expect(linearTrend([null, null])).to.eql([0, 0]);
      expect(linearForecast([null], 2)).to.eql([0, 0]);
    });

    it('types a calculated-field model that carries gaps', async () => {
      const data = [
        { region: 'N', revenue: 10, units: 2 },
        { region: 'S', revenue: 5, units: 0 },
      ];
      const grid = await fixture<ApexGridEnterprise<(typeof data)[number]>>(
        html`<apex-grid-enterprise
          .data=${data}
          .columns=${[{ key: 'region' }, { key: 'revenue', type: 'number' }, { key: 'units', type: 'number' }]}
        ></apex-grid-enterprise>`
      );
      await grid.updateComplete;
      await nextFrame();
      const model: ChartModel = grid.getChartModel({
        calculatedFields: [{ name: 'Per unit', formula: '=A1/B1' }],
      });
      const perUnit = model.series.find((s) => s.name === 'Per unit');
      expect(perUnit?.data).to.eql([5, null]);
    });
  });
});
