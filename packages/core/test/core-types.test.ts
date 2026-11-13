import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
// Type-only imports from the package entry: each one fails `tsc` with TS2305
// when the entry stops exporting it.
import type {
  BadgeVariant,
  ColumnDateFormat,
  ColumnSelectOption,
  ExportOptions,
  StatusVariant,
  ToolbarAction,
} from '../src/index.js';
import { ApexGrid, type ApexGridToolbar } from '../src/index.js';
import type { ColumnConfiguration } from '../src/internal/types.js';
import data, { type TestData } from './utils/test-data.js';

const columns = [
  { key: 'id', type: 'number' },
  { key: 'name' },
  { key: 'active', type: 'boolean' },
  { key: 'importance' },
] as ColumnConfiguration<TestData>[];

async function mount(template = html`<apex-grid></apex-grid>`): Promise<ApexGrid<TestData>> {
  ApexGrid.register();
  const grid = await fixture<ApexGrid<TestData>>(template);
  grid.data = data.map((row) => ({ ...row }));
  grid.columns = columns;
  await grid.updateComplete;
  return grid;
}

describe('Core public types', () => {
  it('names the column and toolbar types from the package entry', () => {
    const badge: BadgeVariant = 'gold';
    const status: StatusVariant = 'trial';
    const format: ColumnDateFormat = 'long';
    const options: ColumnSelectOption<string>[] = ['a', { value: 'b', label: 'B' }];
    const action: ToolbarAction = { id: 'x', label: 'X', run: () => {} };
    expect([badge, status, format, options.length, action.id]).to.deep.equal([
      'gold',
      'trial',
      'long',
      2,
      'x',
    ]);
  });
});

describe('ApexGrid.exportFilename', () => {
  afterEach(() => fixtureCleanup());

  function exportItems(grid: ApexGrid<TestData>) {
    const toolbar = grid.renderRoot.querySelector<ApexGridToolbar<TestData>>('apex-grid-toolbar')!;
    return {
      toolbar,
      trigger: toolbar.renderRoot.querySelector<HTMLButtonElement>('[part="export-trigger"]')!,
      items: () =>
        Array.from(
          toolbar.renderRoot.querySelectorAll<HTMLButtonElement>('[part="export-menu-item"]')
        ),
    };
  }

  /** Clicks the toolbar menu's CSV entry and returns the options exportAs got. */
  async function exportFromMenu(grid: ApexGrid<TestData>): Promise<ExportOptions<TestData>[]> {
    const calls: ExportOptions<TestData>[] = [];
    grid.exportAs = (_format, options = {}) => {
      calls.push(options);
    };
    const { toolbar, trigger, items } = exportItems(grid);
    trigger.click();
    await toolbar.updateComplete;
    items()[0].click();
    await nextFrame();
    return calls;
  }

  it('defaults to data and reads the export-filename attribute', async () => {
    const grid = await mount(html`<apex-grid show-export></apex-grid>`);
    expect(grid.exportFilename).to.equal('data');
    expect(await exportFromMenu(grid)).to.deep.equal([{ filename: 'data' }]);

    grid.setAttribute('export-filename', 'report');
    await grid.updateComplete;
    expect(grid.exportFilename).to.equal('report');
  });

  it('names the file the toolbar menu exports', async () => {
    const grid = await mount(html`<apex-grid show-export export-filename="users"></apex-grid>`);
    expect(await exportFromMenu(grid)).to.deep.equal([{ filename: 'users' }]);

    grid.exportFilename = 'people';
    await grid.updateComplete;
    expect(await exportFromMenu(grid)).to.deep.equal([{ filename: 'people' }]);
  });

  it('falls back to data when set to an empty string, so the menu still downloads', async () => {
    const grid = await mount(html`<apex-grid show-export></apex-grid>`);
    grid.exportFilename = '';
    await grid.updateComplete;
    expect(await exportFromMenu(grid)).to.deep.equal([{ filename: 'data' }]);
  });

  /** Runs `run` with anchor clicks stubbed and returns the names downloaded. */
  function downloads(run: () => void): string[] {
    const names: string[] = [];
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      names.push(this.download);
    };
    try {
      run();
    } finally {
      HTMLAnchorElement.prototype.click = original;
    }
    return names;
  }

  it('leaves a filename passed to exportAs in charge', async () => {
    const grid = await mount(html`<apex-grid export-filename="users"></apex-grid>`);
    expect(downloads(() => grid.exportAs('csv', { filename: 'explicit' }))).to.deep.equal([
      'explicit.csv',
    ]);
  });

  it('does not change the default name of a programmatic export', async () => {
    const grid = await mount(html`<apex-grid export-filename="users"></apex-grid>`);
    expect(downloads(() => grid.exportToCSV())).to.deep.equal(['data.csv']);
  });
});

describe('Cancellable events', () => {
  afterEach(() => fixtureCleanup());

  it('pageChanging is cancelled by preventDefault, not by a listener return value', async () => {
    const grid = await mount();
    grid.pagination = { enabled: true, pageSize: 2 };
    await grid.updateComplete;

    const returnsFalse = () => false;
    grid.addEventListener('pageChanging', returnsFalse);
    expect(await grid.gotoPage(1)).to.be.true;
    grid.removeEventListener('pageChanging', returnsFalse);

    grid.addEventListener('pageChanging', (event) => event.preventDefault());
    expect(await grid.gotoPage(0)).to.be.false;
  });
});

describe('ApexGrid.filter with an operand the column type lacks', () => {
  afterEach(() => fixtureCleanup());

  it('skips the entry instead of storing an undefined condition', async () => {
    const grid = await mount();
    const expression = { key: 'name', condition: 'greaterThan', searchTerm: 1 } as never;
    const before = JSON.stringify(expression);
    const warnings: string[] = [];
    // biome-ignore lint/suspicious/noConsole: spying on the dropped-entry warning
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(String(args[0]));
    try {
      expect(() => grid.filter(expression)).to.not.throw();
      await grid.updateComplete;
    } finally {
      console.warn = original;
    }
    expect(warnings).to.have.lengthOf(1);
    expect(grid.filterExpressions).to.have.lengthOf(0);
    expect(JSON.stringify(expression)).to.equal(before);
    expect(grid.dataView).to.have.lengthOf(data.length);
  });
});
