import { expect, html } from '@open-wc/testing';
import type ApexGridGroupHeaderRow from '../src/components/group-header-row.js';
import type { StateController } from '../src/controllers/state.js';
import type { ColumnConfiguration, ColumnGroupConfiguration } from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

class GroupFixture<T extends TestData> extends GridTestFixture<T> {
  public columnGroups: ColumnGroupConfiguration[] = [
    { id: 'identity', headerText: 'Identity' },
    { id: 'meta', headerText: 'Meta' },
  ];

  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number', group: 'identity' },
      { key: 'name', group: 'identity' },
      { key: 'active', type: 'boolean', group: 'meta' },
      { key: 'importance', group: 'meta' },
    ] as ColumnConfiguration<T>[];
  }

  public override setupTemplate() {
    return html`<apex-grid
      .data=${this.data}
      .columns=${this.columnConfig}
      .columnGroups=${this.columnGroups}
    ></apex-grid>`;
  }

  public get stateController(): StateController<T> {
    return (this.grid as unknown as { stateController: StateController<T> }).stateController;
  }

  public groupRow(): ApexGridGroupHeaderRow<T> | null {
    return this.grid.renderRoot.querySelector(
      'apex-grid-group-header-row'
    ) as unknown as ApexGridGroupHeaderRow<T> | null;
  }

  public groupCells(): HTMLElement[] {
    return Array.from(
      this.groupRow()?.shadowRoot?.querySelectorAll('[part~="group-header"]') ?? []
    );
  }

  public spacers(): HTMLElement[] {
    return Array.from(
      this.groupRow()?.shadowRoot?.querySelectorAll('[part~="group-spacer"]') ?? []
    );
  }
}

const TDD = new GroupFixture(data);

describe('Column groups', () => {
  beforeEach(async () => await TDD.setUp());
  afterEach(() => TDD.tearDown());

  it('renders a group header row with one cell per contiguous group', async () => {
    const cells = TDD.groupCells();
    expect(cells).to.have.lengthOf(2);
    expect(cells.map((c) => c.querySelector('[part~="group-header-label"]')?.textContent)).to.eql([
      'Identity',
      'Meta',
    ]);
  });

  it('spans each group cell across its member columns (aria-colspan + grid-column)', async () => {
    const [identity, meta] = TDD.groupCells();
    expect(identity.getAttribute('aria-colspan')).to.equal('2');
    expect(meta.getAttribute('aria-colspan')).to.equal('2');
    // No leading chrome columns, so identity starts at track 1, meta at track 3.
    expect(identity.style.gridColumn).to.equal('1 / 3');
    expect(meta.style.gridColumn).to.equal('3 / 5');
    expect(identity.getAttribute('aria-colindex')).to.equal('1');
    expect(meta.getAttribute('aria-colindex')).to.equal('3');
  });

  it('numbers the header rows: group row 1, column header row 2', async () => {
    expect(TDD.groupRow()?.getAttribute('aria-rowindex')).to.equal('1');
    expect(TDD.headerRow?.getAttribute('aria-rowindex')).to.equal('2');
  });

  it('counts the group row in aria-rowcount', async () => {
    // 1 group row + 1 header row + 8 body rows.
    expect(TDD.grid.getAttribute('aria-rowcount')).to.equal('10');
  });

  it('renders no group row when columnGroups is unset', async () => {
    TDD.grid.columnGroups = undefined;
    await TDD.waitForUpdate();
    expect(TDD.groupRow()).to.not.exist;
    expect(TDD.headerRow?.getAttribute('aria-rowindex')).to.equal('1');
  });
});

class MixedFixture<T extends TestData> extends GroupFixture<T> {
  public override columnGroups: ColumnGroupConfiguration[] = [
    { id: 'g1', headerText: 'G1' },
    { id: 'g2', headerText: 'G2' },
  ];

  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number', group: 'g1' },
      { key: 'name' }, // ungrouped
      { key: 'active', type: 'boolean', group: 'g2' },
      { key: 'importance', group: 'g2' },
    ] as ColumnConfiguration<T>[];
  }
}

describe('Column groups — ungrouped columns', () => {
  const fx = new MixedFixture(data);
  beforeEach(async () => await fx.setUp());
  afterEach(() => fx.tearDown());

  it('renders a spacer over ungrouped columns and spans the rest', async () => {
    const cells = fx.groupCells();
    expect(cells.map((c) => c.getAttribute('aria-colspan'))).to.eql(['1', '2']); // g1=1, g2=2
    // The ungrouped `name` column gets a spacer.
    expect(fx.spacers().length).to.be.greaterThan(0);
  });
});

class NonContiguousFixture<T extends TestData> extends GroupFixture<T> {
  public override columnGroups: ColumnGroupConfiguration[] = [{ id: 'g', headerText: 'G' }];

  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number', group: 'g' },
      { key: 'name' }, // breaks contiguity
      { key: 'active', type: 'boolean', group: 'g' },
      { key: 'importance' },
    ] as ColumnConfiguration<T>[];
  }
}

describe('Column groups — non-contiguous', () => {
  const fx = new NonContiguousFixture(data);
  let warnings: string[];
  // biome-ignore lint/suspicious/noConsole: spying on the misconfiguration warning
  const originalWarn = console.warn;

  beforeEach(async () => {
    warnings = [];
    console.warn = (...args: unknown[]) => warnings.push(String(args[0]));
    await fx.setUp();
  });
  afterEach(() => {
    console.warn = originalWarn;
    fx.tearDown();
  });

  it('warns and renders only the first contiguous run as a group cell', async () => {
    const cells = fx.groupCells();
    // Only the first `id` run becomes a spanning cell; the out-of-place member
    // is demoted to a spacer.
    expect(cells).to.have.lengthOf(1);
    expect(cells[0].getAttribute('aria-colspan')).to.equal('1');
    expect(warnings.some((w) => w.includes('not contiguous'))).to.be.true;
  });
});

class ReorderGroupFixture<T extends TestData> extends GroupFixture<T> {
  public columnReordering = true;

  public override setupTemplate() {
    return html`<apex-grid
      .data=${this.data}
      .columns=${this.columnConfig}
      .columnGroups=${this.columnGroups}
      .columnReordering=${this.columnReordering}
    ></apex-grid>`;
  }
}

describe('Column groups — reorder confined to group', () => {
  const fx = new ReorderGroupFixture(data);
  beforeEach(async () => await fx.setUp());
  afterEach(() => fx.tearDown());

  it('canDrop allows same-group moves and blocks cross-group moves', async () => {
    const reorder = fx.stateController.reordering;
    const col = (key: string) => fx.grid.columns.find((c) => c.key === key)!;

    expect(reorder.canDrop(col('id'), col('name'))).to.be.true; // both 'identity'
    expect(reorder.canDrop(col('active'), col('importance'))).to.be.true; // both 'meta'
    expect(reorder.canDrop(col('id'), col('active'))).to.be.false; // identity vs meta
  });
});
