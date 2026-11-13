import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import {
  ApexGrid,
  ApexGridPaginator,
  type ApexGridSetupOptions,
  ApexGridToolbar,
  EN_LOCALE,
  esLocale,
  type GridLocaleText,
  setup,
} from '../src/index.js';
import type { ColumnConfiguration } from '../src/internal/types.js';

/**
 * apex-grid 5.0 removals: the toolbar `placeholder` and `debounce` properties,
 * the paginator `pageSizeLabel` property, the eight unused locale keys, the
 * inert `setup({ theme })` option, and a `dataPipelineConfiguration` typed as
 * always defined. The type checks run under `tsc` (each `@ts-expect-error`
 * fails the build if the line compiles again); the rest runs in the browser.
 */

type Row = { id: number; name: string };

const rows: Row[] = [
  { id: 1, name: 'alpha' },
  { id: 2, name: 'beta' },
  { id: 3, name: 'gamma' },
];

const columns: ColumnConfiguration<Row>[] = [{ key: 'id', type: 'number' }, { key: 'name' }];

const REMOVED_KEYS = [
  'filter.filter',
  'chart.placeholder',
  'ai.answer',
  'formula.error.ref',
  'formula.error.name',
  'formula.error.div0',
  'formula.error.value',
  'formula.error.cycle',
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function mount(props: Partial<ApexGrid<Row>> = {}): Promise<ApexGrid<Row>> {
  ApexGrid.register();
  const grid = await fixture<ApexGrid<Row>>(
    html`<apex-grid style="height: 300px" .columns=${columns} .data=${rows}></apex-grid>`
  );
  Object.assign(grid, props);
  await grid.updateComplete;
  await nextFrame();
  return grid;
}

const toolbarOf = (grid: ApexGrid<Row>) =>
  grid.renderRoot.querySelector<ApexGridToolbar<Row>>('apex-grid-toolbar')!;

const paginatorOf = (grid: ApexGrid<Row>) =>
  grid.renderRoot.querySelector<ApexGridPaginator<Row>>('apex-grid-paginator')!;

describe('core 5.0: removed names no longer type check', () => {
  it('toolbar placeholder and debounce, paginator pageSizeLabel', () => {
    const typeOnly = (toolbar: ApexGridToolbar<Row>, paginator: ApexGridPaginator<Row>) => {
      // @ts-expect-error removed in 5.0: set the `toolbar.searchPlaceholder` locale key
      toolbar.placeholder = 'Find';
      // @ts-expect-error removed in 5.0: the toolbar always waits 200 ms
      toolbar.debounce = 0;
      // @ts-expect-error removed in 5.0: set the `pagination.rowsPerPage` locale key
      paginator.pageSizeLabel = 'Per page';
    };
    expect(typeOnly).to.be.a('function');
  });

  it('the eight unused locale keys', () => {
    // @ts-expect-error removed in 5.0
    const text: GridLocaleText = { 'filter.filter': 'Filter' };
    // @ts-expect-error removed in 5.0
    const answer = EN_LOCALE['ai.answer'];
    // @ts-expect-error removed in 5.0
    const cycle = esLocale['formula.error.cycle'];
    expect([Object.keys(text), answer, cycle]).to.deep.equal([
      ['filter.filter'],
      undefined,
      undefined,
    ]);
  });

  it('setup({ theme })', () => {
    // @ts-expect-error removed in 5.0: the option never styled the grid
    const options: ApexGridSetupOptions = { theme: 'material' };
    expect(options).to.be.an('object');
  });

  it('dataPipelineConfiguration is optional in its type', () => {
    const typeOnly = (grid: ApexGrid<Row>) => {
      grid.dataPipelineConfiguration = undefined;
      // @ts-expect-error undefined until assigned: read it with ?.
      return grid.dataPipelineConfiguration.sort;
    };
    expect(typeOnly).to.be.a('function');
  });
});

describe('core 5.0: runtime after the removals', () => {
  afterEach(() => fixtureCleanup());

  it('no longer observes the removed attributes', () => {
    ApexGrid.register();
    const toolbar = ApexGridToolbar.observedAttributes;
    expect(toolbar).not.to.include('placeholder');
    expect(toolbar).not.to.include('debounce');
    expect(ApexGridPaginator.observedAttributes).not.to.include('page-size-label');
    expect(ApexGridToolbar.elementProperties.has('placeholder' as never)).to.be.false;
    expect(ApexGridToolbar.elementProperties.has('debounce' as never)).to.be.false;
    expect(ApexGridPaginator.elementProperties.has('pageSizeLabel' as never)).to.be.false;
  });

  it('the toolbar still waits 200 ms before applying the quick filter', async () => {
    const grid = await mount({ showQuickFilter: true });
    const toolbar = toolbarOf(grid);
    await toolbar.updateComplete;
    const changes: string[] = [];
    grid.addEventListener('quickFilterChanging', (e) => changes.push(e.detail.nextValue));
    const input = toolbar.renderRoot.querySelector('input')!;
    input.value = 'al';
    input.dispatchEvent(new Event('input'));
    input.value = 'alpha';
    input.dispatchEvent(new Event('input'));

    await wait(150);
    expect(changes, 'nothing inside the window').to.deep.equal([]);
    await wait(120);
    await grid.updateComplete;
    expect(changes, 'the last value, once').to.deep.equal(['alpha']);
    expect(grid.quickFilter).to.equal('alpha');
  });

  it('the search placeholder comes from localeText', async () => {
    const grid = await mount({ showQuickFilter: true });
    const input = () => toolbarOf(grid).renderRoot.querySelector('input')!;
    expect(input().placeholder).to.equal(EN_LOCALE['toolbar.searchPlaceholder']);

    grid.localeText = { 'toolbar.searchPlaceholder': 'Find' };
    await grid.updateComplete;
    await toolbarOf(grid).updateComplete;
    expect(input().placeholder).to.equal('Find');
  });

  it('the rows-per-page label comes from localeText', async () => {
    const grid = await mount({ pagination: { enabled: true, pageSize: 2 } });
    const select = () => paginatorOf(grid).renderRoot.querySelector('select')!;
    expect(select().getAttribute('aria-label')).to.equal(EN_LOCALE['pagination.rowsPerPage']);

    grid.localeText = { 'pagination.rowsPerPage': 'Per page' };
    await grid.updateComplete;
    await paginatorOf(grid).updateComplete;
    expect(select().getAttribute('aria-label')).to.equal('Per page');
  });

  it('drops the eight unused keys from both bundled dictionaries', () => {
    for (const key of REMOVED_KEYS) {
      expect(key in EN_LOCALE, key).to.be.false;
      expect(key in esLocale, key).to.be.false;
    }
  });

  it('setup() ignores a leftover theme option without a warning', () => {
    // biome-ignore lint/suspicious/noConsole: spying on a removed warning
    const warn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      setup({ hostStyles: false, theme: 'material' } as ApexGridSetupOptions);
    } finally {
      console.warn = warn;
    }
    expect(warnings).to.deep.equal([]);
  });

  it('dataPipelineConfiguration is still undefined until assigned', async () => {
    const grid = await mount();
    expect(grid.dataPipelineConfiguration).to.equal(undefined);
    grid.dataPipelineConfiguration = { sort: (state) => state.data };
    expect(grid.dataPipelineConfiguration.sort).to.be.a('function');
  });

  it('pipeline hooks are still called with the same receiver', async () => {
    const grid = await mount();
    const seen: string[] = [];
    const tag = (step: string, self: unknown) =>
      seen.push(`${step}:${(self as { host?: unknown } | undefined)?.host === grid}`);
    grid.dataPipelineConfiguration = {
      quickFilter(this: unknown, { data }) {
        tag('quickFilter', this);
        return data;
      },
      filter(this: unknown, { data }) {
        tag('filter', this);
        return data;
      },
      sort(this: unknown, { data }) {
        tag('sort', this);
        return data;
      },
    };
    grid.data = [...rows];
    await grid.updateComplete;
    await wait(0);
    await grid.updateComplete;
    expect(seen.slice(0, 3)).to.deep.equal(['quickFilter:true', 'filter:true', 'sort:true']);
  });
});
