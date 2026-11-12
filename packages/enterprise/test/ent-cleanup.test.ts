import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  ApexGridChart,
  ApexGridEnterprise,
  ApexGridFilterBuilder,
  enterpriseModules,
} from '../src/index.js';

// Batch B68: enterprise bug fixes and dead code (ent-pivot-7,
// ent-context-menu-10, ent-chart-panel-a-9, ent-formula-refs-6,
// ent-filter-builder-9, ent-ai-context-api-7, ent-ai-llm-reasoners-10).

interface Row {
  region: string;
  product: string;
  amount: number;
  when: Date;
  done: boolean;
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'region', type: 'string' },
  { key: 'product', type: 'string' },
  { key: 'amount', type: 'number' },
  { key: 'when', type: 'date' },
  { key: 'done', type: 'boolean' },
];

const WHEN = new Date(Date.UTC(2026, 9, 19, 12, 30));

function makeData(): Row[] {
  return [
    { region: 'EMEA', product: 'A', amount: 10, when: WHEN, done: true },
    { region: 'EMEA', product: 'B', amount: 20, when: WHEN, done: false },
    { region: 'AMER', product: 'A', amount: 30, when: WHEN, done: true },
  ];
}

async function settle(el: { updateComplete: Promise<unknown> }): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await el.updateComplete;
    await nextFrame();
  }
}

function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '500px';
  return node;
}

async function mount(props: Partial<ApexGridEnterprise<Row>> = {}) {
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise
      .data=${makeData()}
      .columns=${columns}
      .groupBy=${props.groupBy ?? []}
      .pivotOn=${props.pivotOn ?? ''}
      .pivotRows=${props.pivotRows ?? []}
      .pivotValues=${props.pivotValues ?? {}}
    ></apex-grid-enterprise>`,
    { parentNode: sizedParent() }
  );
  await settle(grid);
  return grid;
}

const keys = (grid: ApexGridEnterprise<Row>) => grid.columns.map((c) => String(c.key));

describe('B68 enterprise cleanup', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridChart.register();
    ApexGridFilterBuilder.register();
  });
  afterEach(() => fixtureCleanup());

  describe('pivot activation (ent-pivot-7)', () => {
    it('a measure with no functions does not pivot, so the grid keeps its columns and grouping', async () => {
      const grid = await mount({
        groupBy: ['region'],
        pivotOn: 'product',
        pivotRows: ['region'],
        pivotValues: { amount: [] },
      });
      expect(grid.isPivoting).to.equal(false);
      expect(keys(grid)).to.eql(columns.map((c) => String(c.key)));
      expect(grid.groupBy).to.eql(['region']);
    });

    it('removing the last function turns an active pivot off and restores the columns', async () => {
      const grid = await mount({
        pivotOn: 'product',
        pivotRows: ['region'],
        pivotValues: { amount: ['sum'] },
      });
      expect(grid.isPivoting).to.equal(true);
      grid.pivotValues = { amount: [] };
      await settle(grid);
      expect(grid.isPivoting).to.equal(false);
      expect(keys(grid)).to.eql(columns.map((c) => String(c.key)));
      expect(grid.pageItems).to.have.length(3);
    });
  });
});
