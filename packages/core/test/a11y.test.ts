import { aTimeout, elementUpdated, expect, html } from '@open-wc/testing';
import type { ColumnConfiguration } from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

class A11yFixture extends GridTestFixture<TestData> {
  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number', sort: true, filter: true },
      { key: 'name', sort: true, filter: true },
      { key: 'active', type: 'boolean', sort: true },
      { key: 'importance' },
    ] as ColumnConfiguration<TestData>[];
  }

  public override setupTemplate() {
    return html`<apex-grid
      .data=${this.data}
      .columns=${this.columnConfig}
      .selection=${{ enabled: true, mode: 'multiple', showCheckboxColumn: true }}
      .expansion=${{
        enabled: true,
        detailTemplate: ({ data }: { data: TestData }) => html`<span>${data.id}</span>`,
      }}
    ></apex-grid>`;
  }

  public liveRegion(): HTMLElement | null {
    return this.grid.renderRoot.querySelector<HTMLElement>('[part="live-region"]');
  }

  public sortButtonFor(key: keyof TestData): HTMLButtonElement | null {
    const header = this.headers.get(key as never).element;
    return header.renderRoot.querySelector<HTMLButtonElement>('button[part~="action"]');
  }

  public conditionTrigger(): HTMLButtonElement | null {
    const fr = this.filterRow.element as unknown as { renderRoot: ShadowRoot };
    return fr.renderRoot.querySelector<HTMLButtonElement>('[part="condition-trigger"]');
  }
}

describe('Accessibility (WCAG 2.2 AA semantics)', () => {
  let fx: A11yFixture;

  beforeEach(async () => {
    fx = new A11yFixture(JSON.parse(JSON.stringify(data)));
    await fx.setUp();
  });

  afterEach(() => fx.tearDown());

  describe('grid roles + counts', () => {
    it('host advertises role="grid" with aria-rowcount + aria-colcount', async () => {
      await fx.waitForUpdate();
      expect(fx.grid.getAttribute('role')).to.equal('grid');
      // 1 header + 1 filter + 8 data = 10 rows.
      expect(fx.grid.getAttribute('aria-rowcount')).to.equal('10');
      // 4 data columns + selection + expansion = 6.
      expect(fx.grid.getAttribute('aria-colcount')).to.equal('6');
    });

    it('header row exposes role="row" + aria-rowindex="1"', () => {
      expect(fx.headerRow.getAttribute('role')).to.equal('row');
      expect(fx.headerRow.getAttribute('aria-rowindex')).to.equal('1');
    });

    it('body rows expose role="row" + aria-rowindex starting after the header row', async () => {
      await fx.waitForUpdate();
      const first = fx.grid.rows[0] as unknown as HTMLElement;
      expect(first.getAttribute('role')).to.equal('row');
      // The filter panel is a floating overlay (not a table row), so body rows
      // immediately follow the header row (index 1) at index 2.
      expect(first.getAttribute('aria-rowindex')).to.equal('2');
    });

    it('header cells expose role="columnheader" + aria-colindex starting after auto chrome', () => {
      const idHeader = fx.headers.get('id').element;
      expect(idHeader.getAttribute('role')).to.equal('columnheader');
      // selection col is 1, expansion col is 2, so id is 3.
      expect(idHeader.getAttribute('aria-colindex')).to.equal('3');
    });

    it('body cells expose role="gridcell" + aria-colindex', async () => {
      await fx.waitForUpdate();
      const row = fx.grid.rows[0] as unknown as { renderRoot: ShadowRoot };
      const firstDataCell = row.renderRoot.querySelectorAll('apex-grid-cell')[0] as HTMLElement;
      expect(firstDataCell.getAttribute('role')).to.equal('gridcell');
      expect(firstDataCell.getAttribute('aria-colindex')).to.equal('3');
    });
  });

  describe('selection + expansion ARIA reflections', () => {
    it('aria-selected reflects row selection', async () => {
      const row = fx.grid.rows[0] as unknown as HTMLElement;
      expect(row.getAttribute('aria-selected')).to.equal('false');
      await fx.grid.selectRow(fx.grid.data[0]);
      await fx.waitForUpdate();
      expect(row.getAttribute('aria-selected')).to.equal('true');
    });

    it('aria-expanded reflects row expansion', async () => {
      const row = fx.grid.rows[0] as unknown as HTMLElement;
      expect(row.getAttribute('aria-expanded')).to.equal('false');
      await fx.grid.expandRow(fx.grid.data[0]);
      await fx.waitForUpdate();
      expect(row.getAttribute('aria-expanded')).to.equal('true');
    });

    it('aria-current marks the active cell only', async () => {
      const row = fx.grid.rows[0] as unknown as { renderRoot: ShadowRoot };
      const firstDataCell = row.renderRoot.querySelectorAll('apex-grid-cell')[0] as HTMLElement;
      firstDataCell.click();
      await fx.waitForUpdate();
      expect(firstDataCell.getAttribute('aria-current')).to.equal('true');
    });
  });

  describe('sort semantics', () => {
    it('headers expose aria-sort="none" by default and update on sort', async () => {
      const header = fx.headers.get('name').element;
      expect(header.getAttribute('aria-sort')).to.equal('none');
      await fx.sort({ key: 'name', direction: 'ascending' });
      await fx.waitForUpdate();
      expect(header.getAttribute('aria-sort')).to.equal('ascending');
      await fx.sort({ key: 'name', direction: 'descending' });
      await fx.waitForUpdate();
      expect(header.getAttribute('aria-sort')).to.equal('descending');
    });

    it('sort indicator is a real <button> with an aria-label', async () => {
      const button = fx.sortButtonFor('name');
      expect(button).to.not.be.null;
      expect(button!.tagName).to.equal('BUTTON');
      expect(button!.getAttribute('aria-label')).to.match(/sort/i);
    });
  });

  describe('filter dropdown semantics', () => {
    it('condition trigger exposes aria-haspopup="listbox"', async () => {
      // Activate the filter row by clicking an inactive filter chip so the
      // active state (with the dropdown trigger) renders.
      fx.filterRow.open('id' as never);
      await fx.waitForUpdate();
      const trigger = fx.conditionTrigger();
      expect(trigger).to.not.be.null;
      expect(trigger!.getAttribute('aria-haspopup')).to.equal('listbox');
      expect(trigger!.getAttribute('aria-expanded')).to.equal('false');
    });
  });

  describe('live region announcements', () => {
    it('announces UI-driven sort changes through the polite live region', async () => {
      // UI-driven sort goes through sortFromHeaderClick which announces.
      await fx.sortHeader('name');
      await aTimeout(0);
      await elementUpdated(fx.grid);
      const region = fx.liveRegion();
      expect(region).to.not.be.null;
      expect(region!.getAttribute('aria-live')).to.equal('polite');
      expect(region!.textContent ?? '').to.match(/sorted by name/i);
    });

    it('announces row selection counts', async () => {
      await fx.grid.selectRow(fx.grid.data[0]);
      await aTimeout(0);
      await elementUpdated(fx.grid);
      expect(fx.liveRegion()!.textContent ?? '').to.match(/1 row selected/i);
    });

    it('grid.announce() updates the live region directly', async () => {
      fx.grid.announce('Hello AT');
      await aTimeout(0);
      await elementUpdated(fx.grid);
      expect(fx.liveRegion()!.textContent?.trim() ?? '').to.equal('Hello AT');
    });
  });
});
