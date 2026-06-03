import { expect, html, oneEvent } from '@open-wc/testing';
import type { ColumnConfiguration, GridTreeConfiguration } from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';

interface OrgRow {
  name: string;
  role: string;
  path: string[];
}

/** Small org-chart-style hierarchy with three levels. */
const ORG_DATA: OrgRow[] = [
  { name: 'Adrian', role: 'COO', path: ['Adrian'] },
  { name: 'Bryan', role: 'VP', path: ['Adrian', 'Bryan'] },
  { name: 'Chris', role: 'IC', path: ['Adrian', 'Bryan', 'Chris'] },
  { name: 'Gregory', role: 'IC', path: ['Adrian', 'Bryan', 'Gregory'] },
  { name: 'Deborah', role: 'IC', path: ['Adrian', 'Deborah'] },
  { name: 'Cheryl', role: 'CTO', path: ['Cheryl'] },
];

class TreeFixture extends GridTestFixture<OrgRow> {
  public tree: GridTreeConfiguration<OrgRow> = {
    enabled: true,
    getDataPath: (row) => row.path,
  };

  public override updateConfig() {
    this.columnConfig = [{ key: 'name' }, { key: 'role' }] as ColumnConfiguration<OrgRow>[];
  }

  public override setupTemplate() {
    return html`<apex-grid
      .data=${this.data}
      .columns=${this.columnConfig}
      .tree=${this.tree}
    ></apex-grid>`;
  }

  public visibleNames(): string[] {
    return (this.grid.pageItems as readonly OrgRow[]).map((row) => row.name);
  }

  public chevronFor(name: string): HTMLButtonElement | null {
    const row = (this.grid.pageItems as readonly OrgRow[]).findIndex((r) => r.name === name);
    if (row < 0) return null;
    const rowEl = this.grid.rows[row] as unknown as { renderRoot: ShadowRoot };
    const groupCell = rowEl.renderRoot.querySelectorAll('apex-grid-cell')[0] as unknown as {
      renderRoot: ShadowRoot;
    };
    return groupCell.renderRoot.querySelector<HTMLButtonElement>('[part="tree-toggle"]');
  }
}

describe('Tree (nested rows)', () => {
  let fx: TreeFixture;

  beforeEach(async () => {
    fx = new TreeFixture(JSON.parse(JSON.stringify(ORG_DATA)));
    await fx.setUp();
  });

  afterEach(() => fx.tearDown());

  describe('flattening', () => {
    it('renders only root nodes when defaultExpanded is unset', () => {
      expect(fx.visibleNames()).to.deep.equal(['Adrian', 'Cheryl']);
    });

    it('expanding a parent reveals its direct children', async () => {
      await fx.grid.expandTreeRow(fx.grid.data[0]);
      await fx.waitForUpdate();
      expect(fx.visibleNames()).to.deep.equal(['Adrian', 'Bryan', 'Deborah', 'Cheryl']);
    });

    it('expanding grandparent + parent reveals grandchildren', async () => {
      await fx.grid.expandTreeRow(fx.grid.data[0]); // Adrian
      await fx.grid.expandTreeRow(fx.grid.data[1]); // Bryan
      await fx.waitForUpdate();
      expect(fx.visibleNames()).to.deep.equal([
        'Adrian',
        'Bryan',
        'Chris',
        'Gregory',
        'Deborah',
        'Cheryl',
      ]);
    });

    it('collapsing a parent hides its subtree without losing descendants from state', async () => {
      await fx.grid.expandTreeRow(fx.grid.data[0]);
      await fx.grid.expandTreeRow(fx.grid.data[1]);
      await fx.waitForUpdate();
      expect(fx.visibleNames().length).to.equal(6);
      await fx.grid.collapseTreeRow(fx.grid.data[1]); // collapse Bryan
      await fx.waitForUpdate();
      expect(fx.visibleNames()).to.deep.equal(['Adrian', 'Bryan', 'Deborah', 'Cheryl']);
      // Re-expanding Bryan brings the descendants back without re-toggling them.
      await fx.grid.expandTreeRow(fx.grid.data[1]);
      await fx.waitForUpdate();
      expect(fx.visibleNames()).to.deep.equal([
        'Adrian',
        'Bryan',
        'Chris',
        'Gregory',
        'Deborah',
        'Cheryl',
      ]);
    });

    it('expandAllTreeRows reveals the entire tree', async () => {
      await fx.grid.expandAllTreeRows();
      await fx.waitForUpdate();
      expect(fx.visibleNames()).to.deep.equal([
        'Adrian',
        'Bryan',
        'Chris',
        'Gregory',
        'Deborah',
        'Cheryl',
      ]);
    });

    it('collapseAllTreeRows clears everything back to roots', async () => {
      await fx.grid.expandAllTreeRows();
      await fx.waitForUpdate();
      await fx.grid.collapseAllTreeRows();
      await fx.waitForUpdate();
      expect(fx.visibleNames()).to.deep.equal(['Adrian', 'Cheryl']);
    });

    it('defaultExpanded: true expands every parent on first mount', async () => {
      fx.tearDown();
      fx = new TreeFixture(JSON.parse(JSON.stringify(ORG_DATA)));
      fx.tree = {
        enabled: true,
        getDataPath: (row) => row.path,
        defaultExpanded: true,
      };
      await fx.setUp();
      expect(fx.visibleNames()).to.deep.equal([
        'Adrian',
        'Bryan',
        'Chris',
        'Gregory',
        'Deborah',
        'Cheryl',
      ]);
    });

    it('defaultExpanded: number expands rows only up to that depth', async () => {
      fx.tearDown();
      fx = new TreeFixture(JSON.parse(JSON.stringify(ORG_DATA)));
      fx.tree = {
        enabled: true,
        getDataPath: (row) => row.path,
        defaultExpanded: 0,
      };
      await fx.setUp();
      // depth 0 expanded = roots open, their children visible, grandchildren still hidden
      expect(fx.visibleNames()).to.deep.equal(['Adrian', 'Bryan', 'Deborah', 'Cheryl']);
    });
  });

  describe('chevron UI', () => {
    it('renders a chevron toggle on parent rows', () => {
      expect(fx.chevronFor('Adrian')).to.not.be.null;
      expect(fx.chevronFor('Cheryl')).to.be.null; // leaf in this dataset
    });

    it('clicking the chevron toggles the row', async () => {
      const chevron = fx.chevronFor('Adrian')!;
      chevron.click();
      await fx.waitForUpdate();
      expect(fx.visibleNames()).to.include('Bryan');
      chevron.click();
      await fx.waitForUpdate();
      expect(fx.visibleNames()).to.not.include('Bryan');
    });

    it('aria-expanded reflects current state', async () => {
      const chevron = fx.chevronFor('Adrian')!;
      expect(chevron.getAttribute('aria-expanded')).to.equal('false');
      chevron.click();
      await fx.waitForUpdate();
      // Re-resolve since Lit may have re-rendered the button.
      expect(fx.chevronFor('Adrian')!.getAttribute('aria-expanded')).to.equal('true');
    });
  });

  describe('ARIA semantics', () => {
    it('host advertises role="treegrid" when tree is enabled', () => {
      expect(fx.grid.getAttribute('role')).to.equal('treegrid');
    });

    it('rows expose aria-level reflecting their depth (1-based)', async () => {
      await fx.grid.expandAllTreeRows();
      await fx.waitForUpdate();
      const rows = fx.grid.rows as unknown as HTMLElement[];
      const byName = Object.fromEntries(
        rows.map((el, idx) => [fx.visibleNames()[idx], el.getAttribute('aria-level')])
      );
      expect(byName.Adrian).to.equal('1');
      expect(byName.Bryan).to.equal('2');
      expect(byName.Chris).to.equal('3');
      expect(byName.Cheryl).to.equal('1');
    });

    it('leaf rows do not advertise aria-expanded', async () => {
      await fx.grid.expandAllTreeRows();
      await fx.waitForUpdate();
      const rows = fx.grid.rows as unknown as HTMLElement[];
      const cherylIdx = fx.visibleNames().indexOf('Cheryl');
      expect(rows[cherylIdx].hasAttribute('aria-expanded')).to.equal(false);
    });
  });

  describe('events', () => {
    it('toggleTreeRow emits cancellable treeRowExpanding + treeRowExpanded', async () => {
      const expanding = oneEvent(fx.grid, 'treeRowExpanding');
      const expanded = oneEvent(fx.grid, 'treeRowExpanded');
      await fx.grid.toggleTreeRow(fx.grid.data[0]);
      const ev1 = (await expanding) as CustomEvent;
      const ev2 = (await expanded) as CustomEvent;
      expect(ev1.detail.added).to.have.length(1);
      expect(ev2.detail.expanded).to.have.length(1);
    });

    it('preventDefault on treeRowExpanding aborts the change', async () => {
      fx.grid.addEventListener('treeRowExpanding', (e) => e.preventDefault(), { once: true });
      const ok = await fx.grid.expandTreeRow(fx.grid.data[0]);
      expect(ok).to.equal(false);
      expect(fx.visibleNames()).to.deep.equal(['Adrian', 'Cheryl']);
    });
  });

  describe('sort interplay', () => {
    it('sort applies per-branch — children sorted within their parent', async () => {
      await fx.grid.expandAllTreeRows();
      await fx.waitForUpdate();
      await fx.sort({ key: 'name', direction: 'ascending' });
      await fx.waitForUpdate();
      // Roots ascending: Adrian, Cheryl. Adrian's children: Bryan, Deborah.
      // Bryan's children: Chris, Gregory. Order within each branch should be
      // ascending; the tree structure must be preserved.
      const names = fx.visibleNames();
      expect(names.indexOf('Adrian')).to.be.lessThan(names.indexOf('Cheryl'));
      expect(names.indexOf('Bryan')).to.be.lessThan(names.indexOf('Deborah'));
      expect(names.indexOf('Chris')).to.be.lessThan(names.indexOf('Gregory'));
      // Children must remain grouped under their parent.
      expect(names.indexOf('Bryan')).to.be.greaterThan(names.indexOf('Adrian'));
      expect(names.indexOf('Chris')).to.be.greaterThan(names.indexOf('Bryan'));
    });
  });
});
