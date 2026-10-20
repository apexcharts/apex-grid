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

/** Paths are an editable column, so a cell edit can move a row in the tree. */
class EditableTreeFixture extends TreeFixture {
  public override updateConfig() {
    this.columnConfig = [
      { key: 'name' },
      { key: 'role' },
      { key: 'path', editable: true },
    ] as ColumnConfiguration<OrgRow>[];
  }

  public override setupTemplate() {
    return html`<apex-grid
      .data=${this.data}
      .columns=${this.columnConfig}
      .editing=${{ enabled: true }}
      .tree=${this.tree}
    ></apex-grid>`;
  }

  public async editPath(row: OrgRow, path: string[]) {
    const rowIndex = this.grid.pageItems.indexOf(row);
    const result = this.grid.applyEdits([{ rowIndex, column: 'path', value: path }]);
    expect(result.applied).to.equal(1);
    await this.waitForUpdate();
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

  describe('filter interplay', () => {
    describe('after a path changed in place', () => {
      let ed: EditableTreeFixture;
      const mount = async (rows: OrgRow[]) => {
        fx.tearDown();
        fx = ed = new EditableTreeFixture(rows);
        ed.tree = { enabled: true, getDataPath: (row) => row.path, defaultExpanded: true };
        await ed.setUp();
      };
      const filterBy = async (text: string) => {
        ed.grid.quickFilter = text;
        await ed.waitForUpdate();
        await ed.waitForUpdate();
      };
      const letters = (): OrgRow[] => [
        { name: 'Alpha', role: 'IC', path: ['A'] },
        { name: 'Alphabet', role: 'IC', path: ['A', 'x'] },
        { name: 'Beta', role: 'IC', path: ['B'] },
        { name: 'Bee', role: 'IC', path: ['B', 'y'] },
      ];

      it('does not show a row twice when an edit moved it off an ancestor path', async () => {
        await mount(letters());
        const alpha = ed.grid.data[0];
        // A filtered pass that needs an ancestor record builds the lookup.
        await filterBy('Bee');
        expect(ed.visibleNames()).to.deep.equal(['Beta', 'Bee']);
        await filterBy('');

        await ed.editPath(alpha, ['Z']);
        await ed.grid.expandAllTreeRows();
        await ed.waitForUpdate();
        expect(ed.visibleNames()).to.deep.equal(['Alpha', undefined, 'Alphabet', 'Beta', 'Bee']);

        await filterBy('Alpha');
        expect(ed.grid.pageItems.filter((row) => row === alpha)).to.have.length(1);
        expect(ed.visibleNames()).to.deep.equal(['Alpha', undefined, 'Alphabet']);
      });

      it('adopts a row an edit moved onto an ancestor path', async () => {
        await mount([
          { name: 'Alpha', role: 'IC', path: ['Q'] },
          { name: 'Alphabet', role: 'IC', path: ['A', 'x'] },
        ]);
        const alpha = ed.grid.data[0];
        await filterBy('Alphabet');
        expect(ed.visibleNames()).to.deep.equal([undefined, 'Alphabet']);
        await filterBy('');

        await ed.editPath(alpha, ['A']);
        await filterBy('Alphabet');
        expect(ed.grid.pageItems[0]).to.equal(alpha);
        await ed.grid.expandTreeRow(alpha);
        await ed.waitForUpdate();
        expect(ed.visibleNames()).to.deep.equal(['Alpha', 'Alphabet']);
      });

      it('does not show a row twice after a path changed without an edit event', async () => {
        await mount(letters());
        const alpha = ed.grid.data[0];
        await filterBy('Bee');
        await filterBy('');

        alpha.path = ['Z'];
        await filterBy('Alpha');
        expect(ed.grid.pageItems.filter((row) => row === alpha)).to.have.length(1);
        // The A level now has no record, so it is a collapsed placeholder.
        expect(ed.visibleNames()).to.deep.equal(['Alpha', undefined]);
      });
    });

    it('a quick filter keeps a matched grandchild reachable under its expanded ancestors', async () => {
      await fx.grid.expandTreeRow(fx.grid.data[0]); // Adrian
      await fx.grid.expandTreeRow(fx.grid.data[1]); // Bryan
      await fx.waitForUpdate();

      fx.grid.quickFilter = 'Gregory';
      await fx.waitForUpdate();
      await fx.waitForUpdate();

      expect(fx.visibleNames()).to.deep.equal(['Adrian', 'Bryan', 'Gregory']);
      // The ancestors are their own records, not blank placeholders.
      const items = fx.grid.pageItems as readonly OrgRow[];
      expect(items[0]).to.equal(fx.grid.data[0]);
      expect(items.map((row) => row.role)).to.deep.equal(['COO', 'VP', 'IC']);
    });

    it('a column filter keeps a matched grandchild reachable under its expanded ancestors', async () => {
      await fx.grid.expandTreeRow(fx.grid.data[0]);
      await fx.grid.expandTreeRow(fx.grid.data[1]);
      await fx.waitForUpdate();

      fx.grid.filter({ key: 'name', condition: 'equals', searchTerm: 'Gregory' } as never);
      await fx.waitForUpdate();
      await fx.waitForUpdate();

      expect(fx.visibleNames()).to.deep.equal(['Adrian', 'Bryan', 'Gregory']);
      expect(fx.grid.isTreeRowExpanded(fx.grid.data[0])).to.equal(true);
    });

    it('a filtered pass does not rescan the data for parents that have no record', async () => {
      // Folders exist only as path segments, so no ancestor ever has a record.
      const rows = Array.from({ length: 2000 }, (_, i) => ({
        name: `f${i}`,
        role: 'IC',
        path: [`d${i % 10}`, `f${i}`],
      }));
      let calls = 0;
      fx.tearDown();
      fx = new TreeFixture(rows);
      fx.tree = {
        enabled: true,
        defaultExpanded: true,
        getDataPath: (row) => {
          calls++;
          return row.path;
        },
      };
      await fx.setUp();

      fx.grid.quickFilter = 'f777';
      await fx.waitForUpdate();
      await fx.waitForUpdate();
      expect(fx.visibleNames()).to.deep.equal([undefined, 'f777']);

      const folder = fx.grid.pageItems[0];
      calls = 0;
      await fx.grid.collapseTreeRow(folder);
      await fx.waitForUpdate();
      expect(fx.visibleNames()).to.deep.equal([undefined]);
      expect(calls).to.be.lessThan(rows.length / 10);

      calls = 0;
      fx.grid.quickFilter = 'f1777';
      await fx.waitForUpdate();
      await fx.waitForUpdate();
      expect(calls).to.be.lessThan(rows.length / 10);
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
