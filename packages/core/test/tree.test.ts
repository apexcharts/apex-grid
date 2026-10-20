import { expect, html, oneEvent } from '@open-wc/testing';
import { retainPresent } from '../src/controllers/expansion.js';
import type { ColumnConfiguration, GridTreeConfiguration } from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';

describe('Expansion pruning at scale', () => {
  const data = Array.from({ length: 100_000 }, (_, i) => ({ i }));

  it('returns the same set at 100k rows when every expanded row is still present', () => {
    const rows = new Set(data.filter((row) => row.i % 100 === 0));
    expect(retainPresent(rows, [...data])).to.equal(rows);
  });

  it('drops only the rows that left the data', () => {
    const rows = new Set(data.filter((row) => row.i % 100 === 0));
    const next = retainPresent(rows, data.slice(1));
    expect(next).to.not.equal(rows);
    expect(next.size).to.equal(rows.size - 1);
    expect(next.has(data[0])).to.equal(false);
  });
});

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

  describe('data refresh', () => {
    const withDefaults = async (rows: OrgRow[], rowId?: (row: OrgRow) => string) => {
      fx.tearDown();
      fx = new TreeFixture(rows);
      fx.tree = { enabled: true, getDataPath: (row) => row.path, defaultExpanded: true };
      await fx.setUp();
      if (rowId) fx.grid.rowId = rowId;
    };
    const clone = () => JSON.parse(JSON.stringify(ORG_DATA)) as OrgRow[];

    it('a parent the user collapsed stays collapsed after an immutable update', async () => {
      await withDefaults(clone());
      const adrian = fx.grid.data[0];
      await fx.grid.collapseTreeRow(adrian);
      await fx.waitForUpdate();
      expect(fx.visibleNames()).to.deep.equal(['Adrian', 'Cheryl']);

      fx.grid.data = [...fx.grid.data, { name: 'Zed', role: 'IC', path: ['Zed'] }];
      await fx.waitForUpdate();

      expect(fx.grid.isTreeRowExpanded(adrian)).to.equal(false);
      expect(fx.visibleNames()).to.deep.equal(['Adrian', 'Cheryl', 'Zed']);
    });

    it('a new parent arriving with refreshed data still gets the default', async () => {
      await withDefaults(clone());
      fx.grid.data = [
        ...fx.grid.data,
        { name: 'Zed', role: 'VP', path: ['Zed'] },
        { name: 'Yan', role: 'IC', path: ['Zed', 'Yan'] },
      ];
      await fx.waitForUpdate();
      expect(fx.visibleNames().slice(-2)).to.deep.equal(['Zed', 'Yan']);
    });

    it('refreshing with fresh objects does not grow the expansion set', async () => {
      await withDefaults(clone(), (row) => row.name);
      for (let i = 0; i < 5; i++) {
        fx.grid.data = clone();
        await fx.waitForUpdate();
      }
      const ids = fx.grid.getState().treeExpanded.map((ref) => (ref as { id?: unknown }).id);
      expect(ids).to.deep.equal(['Adrian', 'Bryan']);

      const expanded = oneEvent(fx.grid, 'treeRowExpanded');
      await fx.grid.collapseTreeRow(fx.grid.data[0]);
      expect(((await expanded) as CustomEvent).detail.expanded).to.have.length(1);
    });

    it('an unchanged expansion set is kept as is across an immutable update', async () => {
      await withDefaults(clone());
      const tree = (fx.grid as unknown as { stateController: { tree: { expanded: Set<OrgRow> } } })
        .stateController.tree;
      const before = tree.expanded;
      fx.grid.data = [...fx.grid.data];
      await fx.waitForUpdate();
      expect(tree.expanded).to.equal(before);
      expect(before.size).to.equal(2);
    });
    it('drops the expansion of a synthesized parent that left the data', async () => {
      fx.tearDown();
      fx = new TreeFixture([
        { name: 'Ann', role: 'IC', path: ['Org', 'Ann'] },
        { name: 'Ben', role: 'IC', path: ['Org', 'Ben'] },
      ]);
      await fx.setUp();
      await fx.grid.expandTreeRow(fx.grid.pageItems[0]);
      await fx.waitForUpdate();
      expect(fx.grid.getState().treeExpandedKeys).to.deep.equal(['Org']);

      fx.grid.data = JSON.parse(JSON.stringify(ORG_DATA));
      await fx.waitForUpdate();
      expect(fx.grid.getState().treeExpandedKeys).to.deep.equal([]);
    });
  });

  describe('state round trip', () => {
    it('restores backed and synthesized expansion into a fresh grid', async () => {
      const rows = (): OrgRow[] => [
        ...JSON.parse(JSON.stringify(ORG_DATA)),
        { name: 'Ann', role: 'IC', path: ['Org', 'Ann'] },
      ];
      fx.tearDown();
      fx = new TreeFixture(rows());
      await fx.setUp();
      fx.grid.rowId = (row) => row.name;
      await fx.grid.expandTreeRow(fx.grid.data[0]); // Adrian
      await fx.waitForUpdate();
      const org = (fx.grid.pageItems as readonly OrgRow[]).find((r) => r.name === undefined)!;
      await fx.grid.expandTreeRow(org);
      await fx.waitForUpdate();
      const snapshot = JSON.parse(JSON.stringify(fx.grid.getState()));
      expect(snapshot.treeExpandedKeys).to.deep.equal(['Org']);

      fx.tearDown();
      fx = new TreeFixture(rows());
      await fx.setUp();
      fx.grid.rowId = (row) => row.name;
      fx.grid.setState(snapshot);
      await fx.waitForUpdate();
      expect(fx.visibleNames()).to.deep.equal([
        'Adrian',
        'Bryan',
        'Deborah',
        'Cheryl',
        undefined as unknown as string,
        'Ann',
      ]);
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

describe('Tree synthesized parents and duplicate paths', () => {
  /** Rows whose parent levels exist only as path segments. */
  const PATH_ONLY: OrgRow[] = [
    { name: 'Ann', role: 'IC', path: ['Org', 'Ann'] },
    { name: 'Ben', role: 'IC', path: ['Org', 'Ben'] },
  ];
  let fx: TreeFixture;

  afterEach(() => fx.tearDown());

  it('expand and collapse of a synthesized parent name it in the event payloads', async () => {
    fx = new TreeFixture(JSON.parse(JSON.stringify(PATH_ONLY)));
    await fx.setUp();
    const org = fx.grid.pageItems[0];
    expect(fx.grid.pageItems).to.have.length(1);

    const expanding = oneEvent(fx.grid, 'treeRowExpanding');
    const expanded = oneEvent(fx.grid, 'treeRowExpanded');
    expect(await fx.grid.toggleTreeRow(org)).to.equal(true);
    const before = ((await expanding) as CustomEvent).detail;
    const after = ((await expanded) as CustomEvent).detail;
    expect(before.added).to.deep.equal([org]);
    expect(before.removed).to.deep.equal([]);
    expect(before.current).to.deep.equal([]);
    expect(before.next).to.deep.equal([org]);
    expect(after.expanded).to.deep.equal([org]);

    const collapsed = oneEvent(fx.grid, 'treeRowExpanded');
    await fx.grid.collapseTreeRow(org);
    const detail = ((await collapsed) as CustomEvent).detail;
    expect(detail.removed).to.deep.equal([org]);
    expect(detail.expanded).to.deep.equal([]);
  });

  it('a listener can cancel the expansion of a synthesized parent', async () => {
    fx = new TreeFixture(JSON.parse(JSON.stringify(PATH_ONLY)));
    await fx.setUp();
    const org = fx.grid.pageItems[0];
    fx.grid.addEventListener(
      'treeRowExpanding',
      (e) => {
        if ((e as CustomEvent).detail.added.includes(org)) e.preventDefault();
      },
      { once: true }
    );
    expect(await fx.grid.expandTreeRow(org)).to.equal(false);
    expect(fx.grid.isTreeRowExpanded(org)).to.equal(false);
  });

  it('keeps every row when two rows share a path', async () => {
    fx = new TreeFixture([
      { name: 'Bryan', role: 'VP', path: ['Bryan'] },
      { name: 'Chris A', role: 'IC', path: ['Bryan', 'Chris'] },
      { name: 'Chris B', role: 'IC', path: ['Bryan', 'Chris'] },
    ]);
    fx.tree = { enabled: true, getDataPath: (row) => row.path, defaultExpanded: true };
    await fx.setUp();
    expect(fx.visibleNames()).to.deep.equal(['Bryan', 'Chris A', 'Chris B']);
    const items = fx.grid.pageItems as readonly OrgRow[];
    expect(fx.grid.isTreeRowExpanded(items[0])).to.equal(true);
  });

  it('keeps the descendants of a shared path with the earliest row across a sort', async () => {
    fx = new TreeFixture([
      { name: 'Bryan', role: 'VP', path: ['Bryan'] },
      { name: 'Chris A', role: 'IC', path: ['Bryan', 'Chris'] },
      { name: 'Chris B', role: 'IC', path: ['Bryan', 'Chris'] },
      { name: 'Kid', role: 'IC', path: ['Bryan', 'Chris', 'Kid'] },
    ]);
    fx.tree = { enabled: true, getDataPath: (row) => row.path, defaultExpanded: true };
    await fx.setUp();
    expect(fx.visibleNames()).to.deep.equal(['Bryan', 'Chris A', 'Kid', 'Chris B']);

    fx.grid.sort({ key: 'name', direction: 'descending' } as never);
    await fx.waitForUpdate();
    await fx.waitForUpdate();
    expect(fx.visibleNames()).to.deep.equal(['Bryan', 'Chris B', 'Chris A', 'Kid']);
    const chrisA = fx.grid.data[1];
    expect(fx.grid.isTreeRowExpanded(chrisA)).to.equal(true);
  });

  it('does not attach a row to a duplicate whose key matches its path', async () => {
    fx = new TreeFixture([
      { name: 'Chris A', role: 'IC', path: ['Bryan', 'Chris'] },
      { name: 'Chris B', role: 'IC', path: ['Bryan', 'Chris'] },
      { name: 'Empty', role: 'IC', path: ['Bryan', 'Chris', '', '1'] },
    ]);
    fx.tree = { enabled: true, getDataPath: (row) => row.path, defaultExpanded: true };
    await fx.setUp();
    // Empty sits under a synthesized '' level below Chris A, not beside Chris B.
    expect(fx.visibleNames()).to.deep.equal([undefined, 'Chris A', undefined, 'Empty', 'Chris B']);
    const rows = fx.grid.rows as unknown as HTMLElement[];
    const levels = rows.map((row) => row.getAttribute('aria-level'));
    expect(levels).to.deep.equal(['1', '2', '3', '4', '2']);
  });

  it('gives a shared path to the earliest remaining row after an edit', async () => {
    const ed = new EditableTreeFixture([
      { name: 'Bryan', role: 'VP', path: ['Bryan'] },
      { name: 'Chris A', role: 'IC', path: ['Bryan', 'Chris'] },
      { name: 'Chris B', role: 'IC', path: ['Bryan', 'Chris'] },
      { name: 'Chris C', role: 'IC', path: ['Bryan', 'Chris'] },
      { name: 'Kid', role: 'IC', path: ['Bryan', 'Chris', 'Kid'] },
    ]);
    fx = ed;
    ed.tree = { enabled: true, getDataPath: (row) => row.path, defaultExpanded: true };
    await ed.setUp();
    expect(ed.visibleNames()).to.deep.equal(['Bryan', 'Chris A', 'Kid', 'Chris B', 'Chris C']);

    await ed.editPath(ed.grid.data[1], ['Bryan', 'Zed']);
    ed.grid.sort({ key: 'name', direction: 'descending' } as never);
    await ed.waitForUpdate();
    await ed.grid.expandAllTreeRows();
    await ed.waitForUpdate();
    expect(ed.visibleNames()).to.deep.equal(['Bryan', 'Chris C', 'Chris B', 'Kid', 'Chris A']);
  });
});

describe('Master-detail expansion across data refresh', () => {
  interface Row {
    id: number;
    name: string;
  }
  const ROWS: Row[] = [
    { id: 1, name: 'one' },
    { id: 2, name: 'two' },
    { id: 3, name: 'three' },
  ];

  class DetailFixture extends GridTestFixture<Row> {
    public override setupTemplate() {
      return html`<apex-grid
        .data=${this.data}
        .columns=${this.columnConfig}
        .expansion=${{ enabled: true, detailTemplate: ({ data }: { data: Row }) => html`<div>${data.id}</div>` }}
      ></apex-grid>`;
    }

    public headerToggle(): HTMLButtonElement {
      return this.headerRow.renderRoot.querySelector<HTMLButtonElement>(
        '[part="expansion-header"] [part="expansion-toggle"]'
      )!;
    }

    public get controller(): { expanded: Set<Row> } {
      return (this.grid as unknown as { stateController: { expansion: { expanded: Set<Row> } } })
        .stateController.expansion;
    }
  }

  let fx: DetailFixture;
  const clone = () => JSON.parse(JSON.stringify(ROWS)) as Row[];

  beforeEach(async () => {
    fx = new DetailFixture(clone());
    await fx.setUp();
  });

  afterEach(() => fx.tearDown());

  it('drops rows that left the data and resets the header toggle', async () => {
    await fx.grid.expandRow(fx.grid.data[0]);
    await fx.waitForUpdate();
    expect(fx.headerToggle().getAttribute('aria-label')).to.equal('Collapse all rows');

    fx.grid.data = clone();
    await fx.waitForUpdate();
    expect(fx.grid.expandedRows).to.deep.equal([]);
    expect(fx.headerToggle().getAttribute('aria-label')).to.equal('Expand all rows');
  });

  it('keeps rows that survive an immutable update without reallocating', async () => {
    const kept = fx.grid.data[1];
    await fx.grid.expandRow(kept);
    await fx.waitForUpdate();
    const before = fx.controller.expanded;

    fx.grid.data = [...fx.grid.data, { id: 4, name: 'four' }];
    await fx.waitForUpdate();
    expect(fx.grid.expandedRows).to.deep.equal([kept]);
    expect(fx.controller.expanded).to.equal(before);
  });

  it('does not announce a count of expanded rows when one row replaces another', async () => {
    const messages: string[] = [];
    const announce = fx.grid.announce.bind(fx.grid);
    fx.grid.announce = (message: string) => {
      messages.push(message);
      announce(message);
    };
    await fx.grid.expandRow(fx.grid.data[0]);
    fx.grid.expandedRows = [fx.grid.data[1]];
    await fx.waitForUpdate();
    expect(messages).to.deep.equal(['Row expanded']);
    expect(fx.grid.expandedRows).to.deep.equal([fx.grid.data[1]]);
  });
});
