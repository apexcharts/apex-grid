import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration, GridState } from 'apex-grid';
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

describe('grouping keys and Date buckets', () => {
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
});
