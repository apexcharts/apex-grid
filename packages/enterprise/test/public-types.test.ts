import { expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
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
  enterpriseModules,
  FILTER_BUILDER_TAG,
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
});
