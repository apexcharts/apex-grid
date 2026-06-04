// Single-page demo for <apex-grid-enterprise>. Shows the licensing watermark
// toggle and the aggregation feature on top of the full community grid.
import { configureTheme } from 'igniteui-webcomponents';
import type { ColumnConfiguration } from 'apex-grid';
import { ApexGridEnterprise, LicenseManager } from '../src/index.js';

type User = { id: number; name: string; age: number; salary: number; active: boolean };

ApexGridEnterprise.register();

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
    age: 18 + Math.floor(Math.random() * 50),
    salary: 30000 + Math.floor(Math.random() * 70000),
    active: Math.random() > 0.5,
  }));
}

const columns: ColumnConfiguration<User>[] = [
  { key: 'id', type: 'number', headerText: 'ID', sort: true },
  { key: 'name', type: 'string', headerText: 'Name', sort: true, filter: true },
  { key: 'age', type: 'number', headerText: 'Age', sort: true },
  { key: 'salary', type: 'number', headerText: 'Salary', sort: true },
  { key: 'active', type: 'boolean', headerText: 'Active' },
];

const grid = document.querySelector('apex-grid-enterprise') as ApexGridEnterprise<User>;
grid.data = generateUsers(200);
grid.columns = columns;
grid.aggregations = { age: ['min', 'max', 'avg'], salary: ['sum', 'avg'] };

const statusEl = document.getElementById('status') as HTMLElement;
const aggEl = document.getElementById('aggregations') as HTMLElement;
const keyInput = document.getElementById('key') as HTMLInputElement;

function refresh(): void {
  const valid = LicenseManager.isLicenseValid();
  const { message } = LicenseManager.getLicenseStatus();
  statusEl.innerHTML = valid
    ? '✓ <strong>Licensed</strong> — no watermark.'
    : `✗ <strong>Unlicensed</strong> — grid still works, watermark shown. ${message ?? ''}`;

  const a = grid.getAggregations();
  aggEl.textContent =
    `Aggregations (all ${grid.data.length} rows) — ` +
    `age: min ${a.age?.min}, max ${a.age?.max}, avg ${a.age?.avg?.toFixed(1)}; ` +
    `salary: sum ${a.salary?.sum?.toLocaleString()}, avg ${a.salary?.avg?.toFixed(0)}`;
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

await loadTheme();
refresh();
