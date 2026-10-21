import { expect, fixture, fixtureCleanup, html, nextFrame, waitUntil } from '@open-wc/testing';
import { type ColumnConfiguration, esLocale } from 'apex-grid';
import {
  type AggregationConfig,
  ApexGridChart,
  ApexGridEnterprise,
  enterpriseModules,
  getPivotMeta,
  PIVOT_GROUP_KEY,
  type PivotOptions,
} from '../src/index.js';

type Rec = Record<string, unknown>;

interface PivotSetup {
  data: Rec[];
  columns?: ColumnConfiguration<Rec>[];
  on: string | string[];
  rows: string[];
  values: AggregationConfig;
  options?: PivotOptions;
}

async function settle(grid: ApexGridEnterprise<Rec>) {
  await grid.updateComplete;
  await nextFrame();
  await grid.updateComplete;
}

async function mount(setup: PivotSetup) {
  const columns =
    setup.columns ??
    Object.keys(setup.data[0] ?? {}).map((key) => ({ key }) as ColumnConfiguration<Rec>);
  const grid = await fixture<ApexGridEnterprise<Rec>>(html`<apex-grid-enterprise
    .data=${setup.data}
    .columns=${columns}
    .pivotOn=${setup.on}
    .pivotRows=${setup.rows}
    .pivotValues=${setup.values}
    .pivotOptions=${setup.options ?? {}}
  ></apex-grid-enterprise>`);
  await settle(grid);
  return grid;
}

function valueColumns(grid: ApexGridEnterprise<Rec>) {
  return grid.columns.filter((c) => String(c.key).startsWith('pivot::'));
}

function rowsOf(grid: ApexGridEnterprise<Rec>) {
  return grid.pageItems as ReadonlyArray<Rec>;
}

describe('pivot columns (B38)', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridChart.register();
  });
  afterEach(() => fixtureCleanup());

  describe('ent-pivot-1: observed combinations only', () => {
    it('does not generate columns for pairs absent from the data', async () => {
      const grid = await mount({
        data: [
          { region: 'EMEA', category: 'Fruit', subcategory: 'Apple', amount: 10 },
          { region: 'EMEA', category: 'Fruit', subcategory: 'Pear', amount: 20 },
          { region: 'AMER', category: 'Veg', subcategory: 'Carrot', amount: 30 },
          { region: 'AMER', category: 'Veg', subcategory: 'Leek', amount: 40 },
        ],
        on: ['category', 'subcategory'],
        rows: ['region'],
        values: { amount: ['sum'] },
      });
      expect(valueColumns(grid).map((c) => String(c.key))).to.eql([
        'pivot::Fruit|Apple::amount::sum',
        'pivot::Fruit|Pear::amount::sum',
        'pivot::Veg|Carrot::amount::sum',
        'pivot::Veg|Leek::amount::sum',
      ]);
      expect(grid.getPivotColumnGroups().map((g) => g.headerText)).to.eql(['Fruit', 'Veg']);
    });
  });

  describe('ent-pivot-4: one blank and one Date bucket in tree mode', () => {
    it('folds null, empty and missing into one blank node', async () => {
      const grid = await mount({
        data: [{ region: null, a: 1 }, { region: '', a: 2 }, { a: 3 }, { region: 'East', a: 4 }],
        columns: [{ key: 'region' }, { key: 'a' }],
        on: 'region',
        rows: ['region'],
        values: { a: ['sum'] },
        options: { expandable: true },
      });
      const labels = rowsOf(grid).map((row) => getPivotMeta(row)?.label);
      expect(labels).to.eql(['(blank)', 'East']);
      expect(rowsOf(grid)[0]['pivot::(blank)::a::sum']).to.equal(6);
    });

    it('groups equal Date instances into one node', async () => {
      const grid = await mount({
        data: [1, 2, 3].map((a) => ({ day: new Date(2026, 0, 1), p: 'x', a })),
        on: 'p',
        rows: ['day'],
        values: { a: ['sum'] },
        options: { expandable: true },
      });
      expect(rowsOf(grid).length).to.equal(1);
      expect(rowsOf(grid)[0]['pivot::x::a::sum']).to.equal(6);
    });

    it('labels a blank flat row with the localized blank text', async () => {
      const grid = await mount({
        data: [
          { region: null, p: 'x', a: 1 },
          { region: '', p: 'x', a: 2 },
          { region: 'East', p: 'x', a: 4 },
        ],
        on: 'p',
        rows: ['region'],
        values: { a: ['sum'] },
      });
      expect(rowsOf(grid).map((row) => row.region)).to.eql(['(blank)', 'East']);
      grid.localeText = esLocale;
      await settle(grid);
      expect(rowsOf(grid).map((row) => row.region)).to.eql([esLocale['pivot.blank'], 'East']);
    });
  });

  describe('ent-pivot-8: headers follow the source columns and locale', () => {
    const data = [
      { region: 'EMEA', product: 'A', unit_price: 10 },
      { region: 'AMER', product: null, unit_price: 20 },
    ];
    const columns: ColumnConfiguration<Rec>[] = [
      { key: 'region', headerText: 'Sales region' },
      { key: 'product' },
      { key: 'unit_price', headerText: 'Unit price', type: 'currency', currency: 'EUR' },
    ];

    it('takes header text and the currency format from the source column', async () => {
      const grid = await mount({
        data,
        columns,
        on: 'product',
        rows: ['region'],
        values: { unit_price: ['sum', 'avg', 'count'] },
      });
      expect(grid.columns[0].headerText).to.equal('Sales region');
      const values = valueColumns(grid).slice(0, 3);
      expect(values.map((c) => c.headerText)).to.eql([
        'Unit price (Sum)',
        'Unit price (Average)',
        'Unit price (Count)',
      ]);
      expect(values.map((c) => c.type)).to.eql(['currency', 'currency', 'number']);
      expect((values[0] as { currency?: string }).currency).to.equal('EUR');
    });

    it('re-localizes generated headers when localeText changes', async () => {
      const grid = await mount({
        data,
        columns,
        on: 'product',
        rows: ['region'],
        values: { unit_price: ['sum'] },
      });
      expect(valueColumns(grid).map((c) => c.headerText)).to.have.members(['A', '(blank)']);
      grid.localeText = esLocale;
      await settle(grid);
      expect(valueColumns(grid).map((c) => c.headerText)).to.have.members([
        'A',
        esLocale['pivot.blank'],
      ]);
    });
  });

  describe('ent-pivot-9: empty intersections', () => {
    it('leaves avg, min and max blank where no leaf matches; count and sum stay 0', async () => {
      const grid = await mount({
        data: [
          { region: 'EMEA', product: 'A', amount: 10 },
          { region: 'EMEA', product: 'B', amount: 20 },
          { region: 'AMER', product: 'A', amount: -30 },
        ],
        on: 'product',
        rows: ['region'],
        values: { amount: ['avg', 'min', 'max', 'count', 'sum'] },
      });
      const amer = rowsOf(grid).find((row) => row.region === 'AMER')!;
      expect(amer['pivot::B::amount::avg']).to.equal(null);
      expect(amer['pivot::B::amount::min']).to.equal(null);
      expect(amer['pivot::B::amount::max']).to.equal(null);
      expect(amer['pivot::B::amount::count']).to.equal(0);
      expect(amer['pivot::B::amount::sum']).to.equal(0);
      expect(amer['pivot::A::amount::max']).to.equal(-30);

      const model = grid.getViewChartModel();
      // Series follow the value columns: B's avg is the sixth, and a blank plots as 0.
      expect(String(valueColumns(grid)[5].key)).to.equal('pivot::B::amount::avg');
      expect(model.series[5].data[model.categories.indexOf('AMER')]).to.equal(0);
      expect(model.series[0].data[model.categories.indexOf('AMER')]).to.equal(-30);
    });

    for (const type of ['pie', 'donut']) {
      it(`draws a ${type} chart of a pivot with an empty avg intersection`, async () => {
        const errors: unknown[] = [];
        const onError = (event: ErrorEvent) => errors.push(event.error);
        window.addEventListener('error', onError);
        try {
          const grid = await mount({
            data: [
              { cat: 'Home', region: 'AMER', amount: 10 },
              { cat: 'Tech', region: 'EMEA', amount: 20 },
              { cat: 'Toys', region: 'AMER', amount: 30 },
            ],
            on: 'region',
            rows: ['cat'],
            values: { amount: ['avg'] },
          });
          expect(grid.getViewChartModel().series[0].data).to.eql([10, 0, 30]);
          const panel = await fixture<ApexGridChart>(
            html`<apex-grid-chart mode="inline" source="view" type=${type} .grid=${grid as never}></apex-grid-chart>`
          );
          await waitUntil(() => panel.getChart() != null, `${type} never rendered`);
          expect(errors).to.eql([]);
        } finally {
          window.removeEventListener('error', onError);
        }
      });
    }

    it('renders an empty currency intersection blank, not as 0', async () => {
      const grid = await mount({
        data: [
          { region: 'AMER', product: 'A', amount: 10 },
          { region: 'EMEA', product: 'B', amount: 20 },
        ],
        columns: [
          { key: 'region' },
          { key: 'product' },
          { key: 'amount', type: 'currency', currency: 'USD', locale: 'en-US' },
        ],
        on: 'product',
        rows: ['region'],
        values: { amount: ['avg'] },
      });
      const rendered = () => grid.rows as unknown as HTMLElement[];
      await waitUntil(() => rendered().length === 2, 'rows never rendered');
      const text = rendered().map((row) =>
        [...row.shadowRoot!.querySelectorAll('apex-grid-cell')].map((cell) =>
          (cell.shadowRoot?.textContent ?? '').trim()
        )
      );
      expect(text).to.eql([
        ['AMER', '$10.00', ''],
        ['EMEA', '', '$20.00'],
      ]);
    });
  });

  describe('ent-pivot-10: keys never collide', () => {
    it('gives combos that join to the same text their own column', async () => {
      const grid = await mount({
        data: [
          { r: 'x', a: 'A|B', b: 'C', v: 1 },
          { r: 'x', a: 'A', b: 'B|C', v: 2 },
        ],
        on: ['a', 'b'],
        rows: ['r'],
        values: { v: ['sum'] },
      });
      const keys = valueColumns(grid).map((c) => String(c.key));
      expect(new Set(keys).size).to.equal(2);
      expect(keys.map((key) => rowsOf(grid)[0][key]).sort()).to.eql([1, 2]);
    });

    it('gives tree nodes whose paths join to the same text their own key', async () => {
      const grid = await mount({
        data: [
          { dept: 'Sales/EMEA', team: 't1', p: 'x', v: 1 },
          { dept: 'Sales', team: 'EMEA', p: 'x', v: 2 },
        ],
        on: 'p',
        rows: ['dept', 'team'],
        values: { v: ['sum'] },
        options: { expandable: true },
      });
      const keys = rowsOf(grid).map((row) => getPivotMeta(row)?.key);
      expect(new Set(keys).size).to.equal(keys.length);
    });
  });

  describe('ent-pivot-5 / ent-grid-sync-5: first activation', () => {
    it('shows a row dimension that was hidden in the flat view', async () => {
      const grid = await mount({
        data: [{ region: 'EMEA', product: 'A', amount: 1 }],
        columns: [{ key: 'region', hidden: true }, { key: 'product' }, { key: 'amount' }],
        on: 'product',
        rows: ['region'],
        values: { amount: ['sum'] },
      });
      expect(grid.columns[0].key).to.equal('region');
      expect(grid.columns[0].hidden).to.not.equal(true);
    });

    it('still carries width and hidden across a re-pivot', async () => {
      const grid = await mount({
        data: [{ region: 'EMEA', product: 'A', amount: 1 }],
        on: 'product',
        rows: ['region'],
        values: { amount: ['sum'] },
      });
      grid.columns = grid.columns.map((c) =>
        c.key === 'region' ? { ...c, width: '222px', hidden: true } : c
      );
      await settle(grid);
      grid.pivotOptions = { grandTotal: true };
      await settle(grid);
      expect(grid.columns[0].width).to.equal('222px');
      expect(grid.columns[0].hidden).to.equal(true);
    });
  });

  describe('sweep-data-at-scale-6: maxValueColumns', () => {
    const many = () => Array.from({ length: 450 }, (_, id) => ({ id, name: `n${id % 3}`, q: id }));

    function spyConsole() {
      const warnings: unknown[] = [];
      // biome-ignore lint/suspicious/noConsole: spying on the truncation warning
      const original = console.warn;
      console.warn = (...args: unknown[]) => {
        warnings.push(args);
      };
      return { warnings, restore: () => (console.warn = original) };
    }

    it('caps generated value columns at 200 by default and reports it once', async () => {
      const spy = spyConsole();
      try {
        const grid = await mount({
          data: many(),
          on: 'id',
          rows: ['name'],
          values: { q: ['sum'] },
        });
        expect(valueColumns(grid).length).to.equal(200);
        expect(spy.warnings.length).to.equal(1);
        expect(String((spy.warnings[0] as unknown[])[0])).to.contain('maxValueColumns');
      } finally {
        spy.restore();
      }
    });

    it('announces the truncation in the current language', async () => {
      const spy = spyConsole();
      try {
        const grid = await fixture<ApexGridEnterprise<Rec>>(html`<apex-grid-enterprise
          .data=${many()}
          .columns=${[{ key: 'id' }, { key: 'name' }, { key: 'q' }]}
          .localeText=${esLocale}
        ></apex-grid-enterprise>`);
        await settle(grid);
        const messages: string[] = [];
        grid.announce = (message: string) => {
          messages.push(message);
        };
        grid.pivotRows = ['name'];
        grid.pivotValues = { q: ['sum'] };
        grid.pivotOn = 'id';
        await settle(grid);
        expect(messages).to.eql([
          esLocale['pivot.columnsTruncated']!.replace('{shown}', '200').replace('{total}', '450'),
        ]);
      } finally {
        spy.restore();
      }
    });

    it('keeps whole combinations under a cap and lets Infinity opt out', async () => {
      const spy = spyConsole();
      try {
        const grid = await mount({
          data: many(),
          on: 'id',
          rows: ['name'],
          values: { q: ['sum', 'avg'] },
          options: { maxValueColumns: 5 },
        });
        // Two columns per combination: two whole combinations fit under 5.
        expect(valueColumns(grid).map((c) => String(c.key))).to.eql([
          'pivot::0::q::sum',
          'pivot::0::q::avg',
          'pivot::1::q::sum',
          'pivot::1::q::avg',
        ]);
        grid.pivotOptions = { maxValueColumns: Number.POSITIVE_INFINITY };
        await settle(grid);
        expect(valueColumns(grid).length).to.equal(900);
        expect(spy.warnings.length).to.equal(1);
        grid.pivotOptions = { maxValueColumns: -3 };
        await settle(grid);
        expect(valueColumns(grid).length, 'an invalid cap falls back to 200').to.equal(200);
      } finally {
        spy.restore();
      }
    });
  });

  it('keeps the auto group column key in tree mode', async () => {
    const grid = await mount({
      data: [{ region: 'EMEA', product: 'A', amount: 1 }],
      on: 'product',
      rows: ['region'],
      values: { amount: ['sum'] },
      options: { expandable: true },
    });
    expect(grid.columns[0].key).to.equal(PIVOT_GROUP_KEY);
  });
});
