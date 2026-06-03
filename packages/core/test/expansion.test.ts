import { aTimeout, expect, html, oneEvent } from '@open-wc/testing';
import type { GridExpansionConfiguration } from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

class ExpansionFixture extends GridTestFixture<TestData> {
  public expansion: GridExpansionConfiguration<TestData> = {
    enabled: true,
    detailTemplate: ({ data }) => html`<div class="detail">detail-${data.id}</div>`,
  };
  public records!: TestData[];

  public override async setUp() {
    this.records = JSON.parse(JSON.stringify(data)) as TestData[];
    this.data = this.records;
    await super.setUp();
  }

  public override setupTemplate() {
    return html`<apex-grid
      .data=${this.data}
      .columns=${this.columnConfig}
      .expansion=${this.expansion}
    ></apex-grid>`;
  }

  public expansionHeaderToggle(): HTMLButtonElement | null {
    return this.headerRow.renderRoot.querySelector<HTMLButtonElement>(
      '[part="expansion-header"] [part="expansion-toggle"]'
    );
  }

  public expansionToggleFor(rowIndex: number): HTMLButtonElement | null {
    const rowEl = this.grid.rows[rowIndex] as unknown as { renderRoot: ShadowRoot };
    return rowEl.renderRoot.querySelector<HTMLButtonElement>(
      '[part="expansion-cell"] [part="expansion-toggle"]'
    );
  }

  public detailPanelFor(rowIndex: number): HTMLElement | null {
    const rowEl = this.grid.rows[rowIndex] as unknown as { renderRoot: ShadowRoot };
    return rowEl.renderRoot.querySelector<HTMLElement>('[part="detail-panel"]');
  }
}

describe('Row expansion (master-detail)', () => {
  let fx: ExpansionFixture;

  beforeEach(async () => {
    fx = new ExpansionFixture(JSON.parse(JSON.stringify(data)));
    await fx.setUp();
  });

  afterEach(() => fx.tearDown());

  describe('public API', () => {
    it('expandRow + collapseRow update isRowExpanded and expandedRows', async () => {
      const row = fx.records[2];
      expect(fx.grid.isRowExpanded(row)).to.equal(false);

      const expanded = await fx.grid.expandRow(row);
      expect(expanded).to.equal(true);
      expect(fx.grid.isRowExpanded(row)).to.equal(true);
      expect(fx.grid.expandedRows).to.deep.equal([row]);

      const collapsed = await fx.grid.collapseRow(row);
      expect(collapsed).to.equal(true);
      expect(fx.grid.isRowExpanded(row)).to.equal(false);
      expect(fx.grid.expandedRows).to.deep.equal([]);
    });

    it('toggleRowExpansion flips state both ways', async () => {
      const row = fx.records[0];
      await fx.grid.toggleRowExpansion(row);
      expect(fx.grid.isRowExpanded(row)).to.equal(true);
      await fx.grid.toggleRowExpansion(row);
      expect(fx.grid.isRowExpanded(row)).to.equal(false);
    });

    it('expandAllRows expands every row in the dataView', async () => {
      await fx.grid.expandAllRows();
      expect(fx.grid.expandedRows.length).to.equal(fx.records.length);
    });

    it('collapseAllRows clears the expansion set', async () => {
      await fx.grid.expandAllRows();
      await fx.grid.collapseAllRows();
      expect(fx.grid.expandedRows).to.deep.equal([]);
    });

    it('refuses expansion when disabled', async () => {
      fx.grid.expansion = { ...fx.expansion, enabled: false };
      await fx.waitForUpdate();
      const ok = await fx.grid.expandRow(fx.records[0]);
      expect(ok).to.equal(false);
      expect(fx.grid.expandedRows).to.deep.equal([]);
    });

    it('refuses rows the isExpandable predicate rejects', async () => {
      fx.grid.expansion = {
        ...fx.expansion,
        isExpandable: (row) => row.active,
      };
      await fx.waitForUpdate();
      const inactive = fx.records.find((r) => !r.active)!;
      const active = fx.records.find((r) => r.active)!;
      expect(await fx.grid.expandRow(inactive)).to.equal(false);
      expect(await fx.grid.expandRow(active)).to.equal(true);
    });
  });

  describe('events', () => {
    it('emits cancellable rowExpanding before rowExpanded', async () => {
      const row = fx.records[1];
      const expandingPromise = oneEvent(fx.grid, 'rowExpanding');
      const expandedPromise = oneEvent(fx.grid, 'rowExpanded');
      const ok = await fx.grid.expandRow(row);
      expect(ok).to.equal(true);
      const expanding = (await expandingPromise) as CustomEvent;
      const expanded = (await expandedPromise) as CustomEvent;
      expect(expanding.detail.added).to.deep.equal([row]);
      expect(expanded.detail.expanded).to.deep.equal([row]);
    });

    it('preventDefault on rowExpanding aborts the change', async () => {
      fx.grid.addEventListener('rowExpanding', (e) => e.preventDefault(), { once: true });
      const ok = await fx.grid.expandRow(fx.records[0]);
      expect(ok).to.equal(false);
      expect(fx.grid.expandedRows).to.deep.equal([]);
    });
  });

  describe('UI rendering', () => {
    it('renders the chevron toggle in the header by default', () => {
      expect(fx.expansionHeaderToggle()).to.not.be.null;
    });

    it('renders a chevron toggle in each rendered row', () => {
      expect(fx.expansionToggleFor(0)).to.not.be.null;
      expect(fx.expansionToggleFor(1)).to.not.be.null;
    });

    it('detail panel mounts only for expanded rows', async () => {
      expect(fx.detailPanelFor(0)).to.be.null;
      fx.expansionToggleFor(0)!.click();
      await fx.waitForUpdate();
      const detail = fx.detailPanelFor(0)!;
      expect(detail).to.not.be.null;
      expect(detail.textContent).to.contain(`detail-${fx.records[0].id}`);
    });

    it('supports multi-expand', async () => {
      fx.expansionToggleFor(0)!.click();
      fx.expansionToggleFor(2)!.click();
      await fx.waitForUpdate();
      expect(fx.detailPanelFor(0)).to.not.be.null;
      expect(fx.detailPanelFor(2)).to.not.be.null;
      expect(fx.grid.expandedRows.length).to.equal(2);
    });

    it('header expand-all expands every row, then collapses on second click', async () => {
      const headerToggle = fx.expansionHeaderToggle()!;
      headerToggle.click();
      await fx.waitForUpdate();
      expect(fx.grid.expandedRows.length).to.equal(fx.records.length);
      headerToggle.click();
      await fx.waitForUpdate();
      expect(fx.grid.expandedRows).to.deep.equal([]);
    });

    it('reflects expanded attribute on the row element', async () => {
      const row = fx.records[0];
      await fx.grid.expandRow(row);
      await fx.waitForUpdate();
      const rowEl = fx.grid.rows[0] as unknown as HTMLElement;
      expect(rowEl.hasAttribute('expanded')).to.equal(true);
      await fx.grid.collapseRow(row);
      await fx.waitForUpdate();
      expect(rowEl.hasAttribute('expanded')).to.equal(false);
    });

    it('omits chevron column when showToggleColumn is false', async () => {
      fx.grid.expansion = { ...fx.expansion, showToggleColumn: false };
      await fx.waitForUpdate();
      expect(fx.expansionHeaderToggle()).to.be.null;
      expect(fx.expansionToggleFor(0)).to.be.null;
    });
  });

  describe('identity', () => {
    it('expansion survives a sort because state is reference-based', async () => {
      const target = fx.records[3];
      await fx.grid.expandRow(target);
      expect(fx.grid.isRowExpanded(target)).to.equal(true);
      await fx.sort({ key: 'id', direction: 'descending' });
      await aTimeout(0);
      expect(fx.grid.isRowExpanded(target)).to.equal(true);
    });
  });
});
