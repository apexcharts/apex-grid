import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  CONTEXT_MENU_MODULE_ID,
  type ContextMenuController,
} from '../src/features/context-menu.js';
import {
  type AdvancedFilterModel,
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

  describe('context menu Copy (ent-context-menu-10)', () => {
    type Clipboard = { writeText(text: string): Promise<void> };

    /** Runs `body` with `navigator.clipboard` replaced by `clipboard`. */
    async function withClipboard(clipboard: Clipboard, body: () => unknown): Promise<void> {
      const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
      try {
        await body();
      } finally {
        if (original) Object.defineProperty(navigator, 'clipboard', original);
        else Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'clipboard');
      }
    }

    function copyItem(grid: ApexGridEnterprise<Row>, key: keyof Row) {
      const menu = (
        grid as unknown as {
          stateController: { module(id: string): ContextMenuController<Row> };
        }
      ).stateController.module(CONTEXT_MENU_MODULE_ID);
      const column = grid.columns.find((c) => c.key === key)!;
      const target = { kind: 'cell', column, row: grid.data[0], rowIndex: 0 } as const;
      const item = menu.defaultItems(target).find((candidate) => candidate.id === 'copy')!;
      return () => item.run?.(target);
    }

    function recordAnnouncements(grid: ApexGridEnterprise<Row>): string[] {
      const said: string[] = [];
      grid.announce = (message: string) => {
        said.push(message);
      };
      return said;
    }

    it('copies a date as ISO text, as range copy does', async () => {
      const grid = await mount();
      const writes: string[] = [];
      await withClipboard(
        { writeText: async (text) => void writes.push(text) },
        copyItem(grid, 'when')
      );
      expect(writes).to.eql([WHEN.toISOString()]);
    });

    it('announces the copy with the range copy message', async () => {
      const grid = await mount();
      const said = recordAnnouncements(grid);
      await withClipboard({ writeText: async () => undefined }, copyItem(grid, 'region'));
      expect(said).to.eql([grid.localize('rangeSelection.copied')]);
    });

    it('catches a denied clipboard write: no unhandled rejection, no announcement', async () => {
      const grid = await mount();
      const said = recordAnnouncements(grid);
      const unhandled: unknown[] = [];
      const onUnhandled = (event: PromiseRejectionEvent) => {
        unhandled.push(event.reason);
        event.preventDefault();
      };
      window.addEventListener('unhandledrejection', onUnhandled);
      try {
        await withClipboard(
          { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
          copyItem(grid, 'region')
        );
        // Unhandled rejections are reported after the microtask queue drains.
        await new Promise((resolve) => setTimeout(resolve, 20));
      } finally {
        window.removeEventListener('unhandledrejection', onUnhandled);
      }
      expect(unhandled).to.eql([]);
      expect(said).to.eql([]);
    });
  });

  describe('filter builder boolean value (ent-filter-builder-9)', () => {
    async function builderFor(model: AdvancedFilterModel) {
      const grid = await mount();
      const builder = await fixture<ApexGridFilterBuilder>(
        html`<apex-grid-filter-builder .grid=${grid}></apex-grid-filter-builder>`
      );
      builder.model = model;
      await builder.updateComplete;
      return builder;
    }

    it('a boolean column with an unknown operator shows no value input', async () => {
      const builder = await builderFor({
        kind: 'group',
        join: 'and',
        children: [{ kind: 'condition', column: 'done', operator: 'equals', value: 'true' }],
      });
      expect(builder.renderRoot.querySelector('[part="val"]')).to.equal(null);
    });

    it('a text column still shows its value input', async () => {
      const builder = await builderFor({
        kind: 'group',
        join: 'and',
        children: [{ kind: 'condition', column: 'region', operator: 'contains', value: 'E' }],
      });
      expect(builder.renderRoot.querySelector('input[part="val"]')).to.exist;
    });
  });
});
