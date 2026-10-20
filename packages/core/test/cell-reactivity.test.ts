import { expect, html } from '@open-wc/testing';
import ApexGridCell from '../src/components/cell.js';
import type { ColumnConfiguration, GridTreeConfiguration } from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

// A cell re-renders when what it shows can change: a template that reads
// other fields of its row after any pipeline run (edit, applyEdits, data
// change) and the tree group cell on expand and collapse.

/** Counts ApexGridCell renders while installed. */
function countRenders() {
  const proto = ApexGridCell.prototype as unknown as { render(): unknown };
  const original = proto.render;
  const counter = { count: 0, restore: () => {} };
  proto.render = function (this: unknown) {
    counter.count++;
    return original.call(this);
  };
  counter.restore = () => {
    proto.render = original;
  };
  return counter;
}

function cellsOf(row: Element): ApexGridCell<object>[] {
  return Array.from(row.shadowRoot!.querySelectorAll('apex-grid-cell')) as never;
}

class TemplateFixture extends GridTestFixture<TestData> {
  public override updateConfig(): void {
    this.columnConfig = [
      { key: 'id' },
      {
        key: 'name',
        cellTemplate: (ctx) =>
          html`<span class="probe">${ctx.value}/${ctx.row.data.importance}</span>`,
      },
      { key: 'importance', editable: true },
    ] as ColumnConfiguration<TestData>[];
  }

  public probeText(rowIndex = 0): string {
    const row = this.grid.renderRoot.querySelectorAll('apex-grid-row')[rowIndex];
    return cellsOf(row)[1].shadowRoot!.querySelector('.probe')!.textContent!.trim();
  }
}

describe('Cell reactivity: templates reading other row fields (core-cell-2)', () => {
  let f: TemplateFixture;

  beforeEach(async () => {
    f = new TemplateFixture(structuredClone(data));
    await f.setUp();
    f.grid.editing = { enabled: true } as never;
    await f.waitForUpdate();
  });

  afterEach(() => f.tearDown());

  it('re-renders after applyEdits changes a field the template reads', async () => {
    expect(f.probeText()).to.equal('A/medium');
    const tally = f.grid.applyEdits([{ rowIndex: 0, column: 'importance', value: 'high' }]);
    expect(tally.applied).to.equal(1);
    await f.waitForUpdate();
    expect(f.probeText()).to.equal('A/high');
  });

  it('re-renders after an inline edit commits', async () => {
    await f.grid.editCell(0, 'importance');
    await f.waitForUpdate();
    const row = f.grid.renderRoot.querySelector('apex-grid-row')!;
    const input = cellsOf(row)[2].shadowRoot!.querySelector('input')!;
    input.value = 'low';
    input.dispatchEvent(new Event('input'));
    expect(await f.grid.commitEdit()).to.equal(true);
    await f.waitForUpdate();
    expect(f.probeText()).to.equal('A/low');
  });

  it('re-renders after the data is reassigned with mutated records', async () => {
    const rows = f.grid.data as TestData[];
    rows[0].importance = 'low';
    f.grid.data = [...rows];
    await f.waitForUpdate();
    expect(f.probeText()).to.equal('A/low');
  });

  it('one edit renders each affected cell once, never every cell twice', async () => {
    const counter = countRenders();
    try {
      f.grid.applyEdits([{ rowIndex: 0, column: 'importance', value: 'high' }]);
      await f.waitForUpdate();
      await f.waitForUpdate();
    } finally {
      counter.restore();
    }
    const rows = f.grid.renderRoot.querySelectorAll('apex-grid-row').length;
    // The template column on every rendered row, plus the edited cell.
    expect(counter.count).to.equal(rows + 1);
  });
});

interface OrgRow {
  name: string;
  role: string;
  path: string[];
}

const ORG_DATA: OrgRow[] = [
  { name: 'Adrian', role: 'COO', path: ['Adrian'] },
  { name: 'Bryan', role: 'VP', path: ['Adrian', 'Bryan'] },
  { name: 'Deborah', role: 'IC', path: ['Adrian', 'Deborah'] },
  { name: 'Cheryl', role: 'CTO', path: ['Cheryl'] },
];

class TreeFixture extends GridTestFixture<OrgRow> {
  public tree: GridTreeConfiguration<OrgRow> = { enabled: true, getDataPath: (row) => row.path };

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

  public rowFor(name: string): HTMLElement {
    const index = (this.grid.pageItems as readonly OrgRow[]).findIndex((r) => r.name === name);
    return this.grid.rows[index] as unknown as HTMLElement;
  }

  public groupCellFor(name: string): ApexGridCell<OrgRow> {
    return cellsOf(this.rowFor(name))[0] as never;
  }

  public chevronFor(name: string): HTMLButtonElement {
    return this.groupCellFor(name).shadowRoot!.querySelector<HTMLButtonElement>(
      '[part="tree-toggle"]'
    )!;
  }

  public expectState(name: string, expanded: boolean, label: string) {
    const flag = expanded ? 'true' : 'false';
    expect(this.chevronFor(name).getAttribute('aria-expanded'), `${label}: chevron`).to.equal(flag);
    expect(this.groupCellFor(name).hasAttribute('data-tree-expanded'), `${label}: cell`).to.equal(
      expanded
    );
    expect(this.rowFor(name).getAttribute('aria-expanded'), `${label}: row`).to.equal(flag);
  }
}

describe('Cell reactivity: tree group cell (core-cell-3)', () => {
  let fx: TreeFixture;

  beforeEach(async () => {
    fx = new TreeFixture(structuredClone(ORG_DATA));
    await fx.setUp();
  });

  afterEach(() => fx.tearDown());

  it('collapsing by the chevron updates the chevron, cell and row', async () => {
    fx.chevronFor('Adrian').click();
    await fx.waitForUpdate();
    expect(fx.visibleNames()).to.include('Bryan');
    fx.expectState('Adrian', true, 'expanded');
    fx.chevronFor('Adrian').click();
    await fx.waitForUpdate();
    expect(fx.visibleNames()).to.not.include('Bryan');
    fx.expectState('Adrian', false, 'collapsed');
  });

  it('expandTreeRow and collapseTreeRow update the chevron, cell and row', async () => {
    await fx.grid.expandTreeRow(fx.grid.data[0]);
    await fx.waitForUpdate();
    expect(fx.visibleNames()).to.include('Bryan');
    fx.expectState('Adrian', true, 'expandTreeRow');
    await fx.grid.collapseTreeRow(fx.grid.data[0]);
    await fx.waitForUpdate();
    fx.expectState('Adrian', false, 'collapseTreeRow');
  });
});
