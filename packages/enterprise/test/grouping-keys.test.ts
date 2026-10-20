import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration, GridState } from 'apex-grid';
import { computeAggregations } from '../src/features/aggregation.js';
import { getGroupMeta } from '../src/features/grouping.js';
import { type AggregationConfig, ApexGridEnterprise, enterpriseModules } from '../src/index.js';

type Row = Record<string, unknown>;

async function mount(
  data: Row[],
  groupBy: string[],
  aggregations: AggregationConfig = {}
): Promise<ApexGridEnterprise<Row>> {
  const keys = new Set(data.flatMap((row) => Object.keys(row)));
  const columns = [...keys].map((key) => ({ key })) as ColumnConfiguration<Row>[];
  const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
    .data=${data}
    .columns=${columns}
    .groupBy=${groupBy}
    .aggregations=${aggregations}
  ></apex-grid-enterprise>`);
  await settle(grid);
  return grid;
}

async function settle(grid: ApexGridEnterprise<Row>): Promise<void> {
  await grid.updateComplete;
  await nextFrame();
  await grid.updateComplete;
}

function headers(grid: ApexGridEnterprise<Row>) {
  return (grid.pageItems as readonly Row[]).filter((row) => getGroupMeta(row));
}

function regions(): Row[] {
  return [
    { region: 'EMEA', product: 'A', amount: 10 },
    { region: 'EMEA', product: 'B', amount: 20 },
    { region: 'AMER', product: 'A', amount: 30 },
    { region: 'AMER', product: 'A', amount: 40 },
  ];
}

const enterpriseOf = (state: Partial<GridState>) =>
  (state.modules as Record<string, Record<string, unknown>>).enterprise;

describe('grouping keys, Date buckets, NaN aggregates and collapse-all state', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  describe('ent-grouping-aggregation-statusbar-3: Date values', () => {
    it('puts equal dates held in distinct Date instances in one group', async () => {
      const grid = await mount(
        [
          { hired: new Date(2024, 0, 1), amount: 10 },
          { hired: new Date(2024, 0, 1), amount: 20 },
          { hired: new Date(2024, 5, 1), amount: 30 },
          { hired: new Date(2024, 5, 1), amount: 40 },
        ],
        ['hired'],
        { amount: ['sum'] }
      );
      const heads = headers(grid);
      expect(heads.length, 'one header per distinct date').to.equal(2);
      expect(getGroupMeta(heads[0])!.count).to.equal(2);
      expect(getGroupMeta(heads[0])!.aggregates).to.deep.equal({ amount: { sum: 30 } });
      expect(getGroupMeta(heads[0])!.value).to.be.instanceOf(Date);
      expect(grid.getGroups().length).to.equal(2);
    });

    it('keeps dates that differ only by milliseconds apart, with distinct keys', async () => {
      const grid = await mount(
        [{ at: new Date(2024, 0, 1, 9, 0, 0, 100) }, { at: new Date(2024, 0, 1, 9, 0, 0, 200) }],
        ['at']
      );
      const keys = grid.getGroups().map((group) => group.key);
      expect(keys.length).to.equal(2);
      expect(new Set(keys).size).to.equal(2);
    });

    it('does not merge a Date with a number of the same epoch', async () => {
      const when = new Date(2024, 0, 1);
      const grid = await mount([{ v: when }, { v: when.getTime() }], ['v']);
      expect(headers(grid).length).to.equal(2);
    });
  });

  describe('ent-grouping-aggregation-statusbar-7: unique group keys', () => {
    it('folds null, undefined and empty string into one blank group', async () => {
      const grid = await mount(
        [{ r: null, n: 1 }, { r: '', n: 2 }, { n: 3 }, { r: 'A', n: 4 }],
        ['r']
      );
      const heads = headers(grid);
      expect(heads.length, 'one blank header plus A').to.equal(2);
      expect(grid.getGroups().length).to.equal(2);
      const blank = getGroupMeta(heads[0])!;
      expect(blank.count).to.equal(3);
      expect(blank.key, 'blank key is unchanged from earlier releases').to.equal('/(blank)');
    });

    it('gives the literal string "(blank)" its own key', async () => {
      const grid = await mount([{ r: null }, { r: '(blank)' }], ['r']);
      const keys = grid.getGroups().map((group) => group.key);
      expect(keys.length).to.equal(2);
      expect(new Set(keys).size).to.equal(2);
    });

    it('does not let a value containing "/" collide with a nested path', async () => {
      const grid = await mount(
        [
          { a: 'A/B', b: 'x' },
          { a: 'A', b: 'B' },
        ],
        ['a', 'b']
      );
      const keys = grid.getGroups().map((group) => group.key);
      expect(keys.length, 'A/B > x, A > B').to.equal(4);
      expect(new Set(keys).size).to.equal(4);

      // Collapsing the top-level "A/B" group must not collapse A > B.
      const slashKey = grid.getGroups().find((group) => group.value === 'A/B')!.key;
      grid.collapseGroup(slashKey);
      await settle(grid);
      const nested = grid.getGroups().find((group) => group.depth === 1 && group.value === 'B');
      expect(nested, 'A > B is still rendered').to.exist;
      expect(grid.pageItems.length, 'A/B header, A header, B header, its leaf').to.equal(4);
    });

    it('restores expand overrides saved by earlier releases (ordinary values)', async () => {
      // The groupExpand shape getState wrote at 16ea62b for groupBy region > product.
      const baseShaped = {
        modules: {
          enterprise: {
            groupBy: ['region', 'product'],
            groupExpand: { '/EMEA': false, '/AMER/A': false },
          },
        },
      } as unknown as Partial<GridState>;
      const grid = await mount(regions(), []);
      grid.setState(baseShaped);
      await settle(grid);
      const groups = grid.getGroups();
      expect(groups.map((group) => group.key)).to.deep.equal(['/EMEA', '/AMER', '/AMER/A']);
      // EMEA header (collapsed), AMER header, AMER > A header (collapsed).
      expect(grid.pageItems.length).to.equal(3);
    });

    for (const [label, value, savedKey] of [
      ['a whole-second Date', new Date(2024, 0, 1), `/${String(new Date(2024, 0, 1))}`],
      ['a value with a backslash', 'C:\\temp', '/C:\\temp'],
    ] as const) {
      it(`restores an earlier-release override for ${label}`, async () => {
        const twin = value instanceof Date ? new Date(value.getTime()) : value;
        const grid = await mount(
          [
            { g: value, n: 1 },
            { g: twin, n: 2 },
            { g: 'other', n: 3 },
          ],
          []
        );
        grid.setState({
          modules: { enterprise: { groupBy: ['g'], groupExpand: { [savedKey]: false } } },
        } as unknown as Partial<GridState>);
        await settle(grid);
        expect(grid.getGroups()[0].key).to.equal(savedKey);
        // The collapsed header, then the other header and its leaf.
        expect(grid.pageItems.length).to.equal(3);
      });
    }

    it('writes slash, empty and literal "(blank)" texts as an escaped segment', async () => {
      const grid = await mount([{ a: 'A/B%' }, { a: '(blank)' }, { a: [] }, { a: 'A%' }], ['a']);
      expect(grid.getGroups().map((group) => group.key)).to.deep.equal([
        '//A%2FB%25',
        '//(blank)',
        '//',
        '/A%',
      ]);
    });
  });

  describe('ent-grouping-aggregation-statusbar-4: collapse all in state', () => {
    it('restoring a collapse-all snapshot into a fresh grid keeps groups collapsed', async () => {
      const source = await mount(regions(), ['region']);
      source.collapseAllGroups();
      await settle(source);
      expect(source.pageItems.length).to.equal(2);
      const snapshot = JSON.parse(JSON.stringify(source.getState()));
      expect(enterpriseOf(snapshot).groupDefaultExpanded).to.equal(false);

      const target = await mount(regions(), ['region']);
      expect(target.pageItems.length).to.equal(6);
      target.setState(snapshot);
      await settle(target);
      expect(target.pageItems.length, 'restored grid row count').to.equal(2);

      // And expand all in a snapshot restores into a collapsed grid.
      source.expandAllGroups();
      await settle(source);
      target.setState(JSON.parse(JSON.stringify(source.getState())));
      await settle(target);
      expect(target.pageItems.length).to.equal(6);
    });

    it('a snapshot without groupDefaultExpanded leaves the default untouched', async () => {
      const grid = await mount(regions(), ['region']);
      grid.collapseAllGroups();
      await settle(grid);
      grid.setState({
        modules: { enterprise: { groupBy: ['region'], groupExpand: { '/EMEA': true } } },
      } as unknown as Partial<GridState>);
      await settle(grid);
      // EMEA header + 2 leaves, AMER header (still collapsed by default).
      expect(grid.pageItems.length).to.equal(4);
    });

    it('collapse all is not undone by a later aggregations change', async () => {
      const grid = await mount(regions(), ['region']);
      grid.groupingOptions = { defaultExpanded: true };
      await settle(grid);
      grid.collapseAllGroups();
      await settle(grid);
      expect(grid.pageItems.length).to.equal(2);
      grid.aggregations = { amount: ['sum'] };
      await settle(grid);
      expect(grid.pageItems.length, 'rows after aggregations change').to.equal(2);
    });

    it('setState in the same tick as groupingOptions wins over it', async () => {
      const grid = document.createElement('apex-grid-enterprise') as ApexGridEnterprise<Row>;
      grid.data = regions();
      grid.columns = [{ key: 'region' }, { key: 'product' }, { key: 'amount' }];
      grid.groupingOptions = { defaultExpanded: true };
      document.body.append(grid);
      try {
        grid.setState({
          modules: {
            enterprise: { groupBy: ['region'], groupExpand: {}, groupDefaultExpanded: false },
          },
        } as unknown as Partial<GridState>);
        await settle(grid);
        expect(grid.pageItems.length).to.equal(2);

        // And a later groupingOptions assignment wins over the restore.
        grid.groupingOptions = { defaultExpanded: 1 };
        await settle(grid);
        expect(grid.pageItems.length).to.equal(6);
      } finally {
        grid.remove();
      }
    });

    it('an equal groupingOptions in a new object keeps collapse all', async () => {
      const grid = await mount(regions(), ['region']);
      grid.groupingOptions = { defaultExpanded: true };
      await settle(grid);
      grid.collapseAllGroups();
      await settle(grid);
      grid.groupingOptions = { defaultExpanded: true };
      await settle(grid);
      expect(grid.pageItems.length).to.equal(2);
    });

    it('a value changed in place, then a copy assigned, is applied', async () => {
      const grid = await mount(regions(), ['region']);
      grid.groupingOptions = { defaultExpanded: true };
      await settle(grid);
      expect(grid.pageItems.length).to.equal(6);
      grid.groupingOptions.defaultExpanded = false;
      grid.groupingOptions = { ...grid.groupingOptions };
      await settle(grid);
      expect(grid.pageItems.length, 'rows after mutate and copy').to.equal(2);
    });

    it('a value changed in place, then requestUpdate, is applied', async () => {
      const grid = await mount(regions(), ['region']);
      grid.groupingOptions = { defaultExpanded: true };
      await settle(grid);
      grid.groupingOptions.defaultExpanded = false;
      grid.requestUpdate('groupingOptions');
      await settle(grid);
      expect(grid.pageItems.length, 'rows after mutate and requestUpdate').to.equal(2);
    });

    it('a value changed in place, then the same object assigned, renders', async () => {
      const grid = await mount(regions(), ['region']);
      grid.groupingOptions = { defaultExpanded: true };
      await settle(grid);
      expect(grid.pageItems.length).to.equal(6);
      grid.groupingOptions.defaultExpanded = false;
      // biome-ignore lint/correctness/noSelfAssign: the same object is re-assigned on purpose
      grid.groupingOptions = grid.groupingOptions;
      await settle(grid);
      expect(grid.pageItems.length, 'rows after same-object assign').to.equal(2);
      expect(enterpriseOf(grid.getState()).groupDefaultExpanded).to.equal(false);

      // An unrelated refresh afterwards changes nothing.
      grid.data = regions();
      await settle(grid);
      expect(grid.pageItems.length, 'rows after data refresh').to.equal(2);
    });
  });

  describe('ent-grouping-aggregation-statusbar-8: malformed groupExpand', () => {
    for (const [label, bad] of [
      ['null', null],
      ['a number', 5],
      ['an array', [['/EMEA', false]]],
      ['a string', '/EMEA'],
    ] as const) {
      it(`skips ${label} with a warning and applies nothing half way`, async () => {
        const grid = await mount(regions(), []);
        const state = {
          modules: {
            enterprise: {
              groupBy: ['region'],
              aggregations: { amount: ['sum'] },
              groupExpand: bad,
            },
          },
        } as unknown as Partial<GridState>;
        const result = grid.setState(state);
        await settle(grid);
        expect(result.warnings.some((w) => w.includes('groupExpand'))).to.equal(true);
        expect(grid.groupBy).to.deep.equal(['region']);
        expect(grid.aggregations).to.deep.equal({ amount: ['sum'] });
        expect(grid.pageItems.length, 'all groups expanded').to.equal(6);
      });
    }

    it('throws in strict mode before applying anything', async () => {
      const grid = await mount(regions(), []);
      const state = {
        modules: { enterprise: { groupBy: ['region'], groupExpand: null } },
      } as unknown as Partial<GridState>;
      expect(() => grid.setState(state, { strict: true })).to.throw(/groupExpand/);
      expect(grid.groupBy).to.deep.equal([]);
    });

    it('skips a groupExpand holding a non-boolean value', async () => {
      const grid = await mount(regions(), ['region']);
      grid.collapseGroup('/AMER');
      await settle(grid);
      const result = grid.setState({
        modules: { enterprise: { groupExpand: { '/EMEA': 'no', '/AMER': true } } },
      } as unknown as Partial<GridState>);
      await settle(grid);
      expect(result.warnings.some((w) => w.includes('groupExpand'))).to.equal(true);
      expect(enterpriseOf(grid.getState()).groupExpand).to.deep.equal({ '/AMER': false });
    });
  });

  describe('ent-grouping-aggregation-statusbar-9: non-finite cells', () => {
    it('ignores NaN and Infinity in sum, avg, min, max and count', () => {
      const rows = [{ v: 10 }, { v: Number.NaN }, { v: 20 }, { v: Number.POSITIVE_INFINITY }];
      expect(computeAggregations(rows, { v: ['sum', 'avg', 'min', 'max', 'count'] })).to.deep.equal(
        { v: { sum: 30, avg: 15, min: 10, max: 20, count: 2 } }
      );
    });

    it('counts numeric strings like the status bar does', () => {
      const rows = [{ v: '10' }, { v: ' 5 ' }, { v: '' }, { v: 'abc' }, { v: 1 }, { v: null }];
      expect(computeAggregations(rows, { v: ['sum', 'count', 'min', 'max'] })).to.deep.equal({
        v: { sum: 16, count: 3, min: 1, max: 10 },
      });
    });

    it('keeps the empty results and -0 handling unchanged', () => {
      expect(
        computeAggregations([{ v: 'x' }], { v: ['sum', 'avg', 'min', 'max', 'count'] })
      ).to.deep.equal({ v: { sum: 0, avg: 0, min: 0, max: 0, count: 0 } });
      const signed = computeAggregations([{ v: 0 }, { v: -0 }], { v: ['min', 'max'] });
      expect(Object.is(signed.v.min, -0)).to.equal(true);
      expect(Object.is(signed.v.max, 0)).to.equal(true);
    });

    it('a NaN cell no longer shows NaN in the group header', async () => {
      const grid = await mount(
        [
          { g: 'x', amount: 10 },
          { g: 'x', amount: Number.NaN },
          { g: 'x', amount: 20 },
        ],
        ['g'],
        { amount: ['sum', 'min'] }
      );
      expect(grid.getGroups()[0].aggregates).to.deep.equal({ amount: { sum: 30, min: 10 } });
    });
  });
});
