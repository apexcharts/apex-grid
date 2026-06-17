// Single-page demo for <apex-grid-enterprise>. Shows the licensing watermark
// toggle and the aggregation feature on top of the full community grid.
import { configureTheme } from 'igniteui-webcomponents';
import type { ColumnConfiguration } from 'apex-grid';
import {
  ApexGridEnterprise,
  ApexGridStatusBar,
  ApexGridToolPanel,
  LicenseManager,
} from '../src/index.js';

type User = {
  id: number;
  name: string;
  department: string;
  age: number;
  salary: number;
  active: boolean;
};

const DEPARTMENTS = ['Engineering', 'Sales', 'Marketing', 'Support'];

ApexGridEnterprise.register();
ApexGridToolPanel.register();
ApexGridStatusBar.register();

async function loadTheme(theme = 'bootstrap', variant = 'light'): Promise<void> {
  await import(
    /* @vite-ignore */
    `/node_modules/igniteui-webcomponents/themes/${variant}/${theme}.css?${Date.now()}`
  );
  configureTheme(theme as never);
}

function generateUsers(length: number): User[] {
  return Array.from({ length }, (_, id) => ({
    id,
    name: `User ${id}`,
    department: DEPARTMENTS[id % DEPARTMENTS.length],
    age: 18 + Math.floor(Math.random() * 50),
    salary: 30000 + Math.floor(Math.random() * 70000),
    active: Math.random() > 0.5,
  }));
}

const columns: ColumnConfiguration<User>[] = [
  { key: 'id', type: 'number', headerText: 'ID', sort: true },
  { key: 'name', type: 'string', headerText: 'Name', sort: true, filter: true },
  { key: 'department', type: 'string', headerText: 'Department', sort: true, filter: true },
  { key: 'age', type: 'number', headerText: 'Age', sort: true },
  { key: 'salary', type: 'number', headerText: 'Salary', sort: true },
  { key: 'active', type: 'boolean', headerText: 'Active' },
];

const grid = document.querySelector('apex-grid-enterprise') as ApexGridEnterprise<User>;
grid.data = generateUsers(200);
grid.columns = columns;
grid.aggregations = { salary: ['avg'] };
// Start grouped by department to show the feature; aggregates render per group.
grid.groupBy = ['department'];
grid.groupingOptions = { defaultExpanded: false };

const toolPanel = document.getElementById('tool-panel') as ApexGridToolPanel;
toolPanel.grid = grid;

const statusBar = document.getElementById('status-bar') as ApexGridStatusBar;
statusBar.grid = grid as ApexGridStatusBar['grid'];

const statusEl = document.getElementById('status') as HTMLElement;
const aggEl = document.getElementById('aggregations') as HTMLElement;
const keyInput = document.getElementById('key') as HTMLInputElement;
const chartEl = document.getElementById('chart') as HTMLElement;

let chartInstance: Awaited<ReturnType<typeof grid.renderChart>> | null = null;
let chartType: 'bar' | 'line' = 'bar';

/** Redraw the chart of the current group/pivot view after the pipeline settles. */
async function redrawChart(): Promise<void> {
  // Let the grouping/pivot property change flow through the async data pipeline.
  await grid.updateComplete;
  await grid.updateComplete;
  await new Promise((resolve) => requestAnimationFrame(resolve));

  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
  const model = grid.getChartModel();
  if (!model.series.length) {
    chartEl.innerHTML =
      '<p style="opacity:.6;font-size:.85rem;margin:0">Group or pivot the grid to chart its aggregates.</p>';
    return;
  }
  chartEl.innerHTML = '';
  chartInstance = await grid.renderChart(chartEl, {
    type: chartType,
    title: grid.isPivoting ? 'Pivot aggregates' : 'Group aggregates',
  });
}

function refresh(): void {
  const valid = LicenseManager.isLicenseValid();
  const { message } = LicenseManager.getLicenseStatus();
  statusEl.innerHTML = valid
    ? '✓ <strong>Licensed</strong> — no watermark.'
    : `✗ <strong>Unlicensed</strong> — grid still works, watermark shown. ${message ?? ''}`;

  const a = grid.getAggregations();
  aggEl.textContent = `Aggregations (all ${grid.data.length} rows) — salary avg ${a.salary?.avg?.toFixed(0)}`;
}

document.getElementById('apply')?.addEventListener('click', () => {
  ApexGridEnterprise.setLicense(keyInput.value.trim());
  refresh();
});

document.getElementById('clear')?.addEventListener('click', () => {
  keyInput.value = '';
  ApexGridEnterprise.setLicense('');
  refresh();
});

document.getElementById('trial')?.addEventListener('click', () => {
  const today = new Date().toISOString().slice(0, 10);
  const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const key = LicenseManager.generateLicenseKey(today, nextYear, 'enterprise');
  keyInput.value = key;
  ApexGridEnterprise.setLicense(key);
  refresh();
});

document.getElementById('group-dept')?.addEventListener('click', () => {
  grid.groupBy = ['department'];
  void redrawChart();
});
document.getElementById('group-dept-active')?.addEventListener('click', () => {
  grid.groupBy = ['department', 'active'];
  void redrawChart();
});
document.getElementById('ungroup')?.addEventListener('click', () => {
  grid.groupBy = [];
  grid.pivotOn = '';
  void redrawChart();
});
document.getElementById('expand-all')?.addEventListener('click', () => grid.expandAllGroups());
document.getElementById('collapse-all')?.addEventListener('click', () => grid.collapseAllGroups());

document.getElementById('pivot-active-dept')?.addEventListener('click', () => {
  grid.pivotRows = ['active'];
  grid.pivotOn = 'department';
  grid.pivotValues = { salary: ['sum'] };
  void redrawChart();
});
document.getElementById('unpivot')?.addEventListener('click', () => {
  grid.pivotOn = '';
  void redrawChart();
});

document.getElementById('chart-bar')?.addEventListener('click', () => {
  chartType = 'bar';
  void redrawChart();
});
document.getElementById('chart-line')?.addEventListener('click', () => {
  chartType = 'line';
  void redrawChart();
});

document.getElementById('copy-range')?.addEventListener('click', async () => {
  const copied = await grid.copySelection();
  const bounds = grid.getSelectionBounds();
  statusEl.innerHTML = copied
    ? `✓ Copied range (rows ${bounds?.top}–${bounds?.bottom}, cols ${bounds?.left}–${bounds?.right}) as TSV.`
    : '✗ Nothing selected — drag across some cells first.';
});
document.getElementById('clear-range')?.addEventListener('click', () => {
  grid.clearRangeSelection();
});

await loadTheme();
refresh();
await redrawChart();
