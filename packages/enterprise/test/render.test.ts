import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { ApexGrid } from 'apex-grid/internal';
import {
  ApexGridEnterprise,
  ENTERPRISE_TAG,
  enterpriseModules,
  VIEW_CHANGED_EVENT,
} from '../src/index.js';
import { settle } from './settle.js';

type Row = { id: number; name: string };
const data: Row[] = Array.from({ length: 5 }, (_, id) => ({ id, name: `Row ${id}` }));
const columns: ColumnConfiguration<Row>[] = [{ key: 'id' }, { key: 'name' }];

function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '600px';
  return node;
}

/** Reaches the protected `stateController` for assertions. */
function stateOf(grid: ApexGridEnterprise<Row>) {
  return (grid as unknown as { stateController: { modules: Map<string, unknown> } })
    .stateController;
}

describe('ApexGridEnterprise', () => {
  before(() => ApexGridEnterprise.register());
  afterEach(() => fixtureCleanup());

  it('registers <apex-grid-enterprise>', () => {
    expect(ENTERPRISE_TAG).to.equal('apex-grid-enterprise');
    expect(customElements.get('apex-grid-enterprise')).to.equal(ApexGridEnterprise);
  });

  it('is an ApexGrid subclass', async () => {
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    expect(grid).to.be.instanceOf(ApexGrid);
    expect(grid.tagName.toLowerCase()).to.equal('apex-grid-enterprise');
  });

  it('renders rows like the community grid', async () => {
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    await settle(grid);
    expect(grid.columns.length).to.equal(columns.length);
    expect(grid.rows.length).to.equal(data.length);
  });

  // Guards the suite-wide keying switch against a core dist built without the
  // hook: one group would then rerun the other's mode and pass vacuously. The
  // default group recycles the body rows (the shipping default), the item
  // group keys them by record.
  it('recycles the body rows by default and keys them by record under the item run', async () => {
    const keying = (globalThis as { __apexRowKeying?: unknown }).__apexRowKeying;
    // Any other value is a runner config this switch no longer understands.
    expect([undefined, 'item'], 'page global __apexRowKeying').to.include(keying);
    const slot = keying !== 'item';
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    await settle(grid);
    const body = (
      grid as unknown as {
        scrollContainer: HTMLElement & {
          rowMode?: unknown;
          keyFunction: (item: unknown, index: number) => unknown;
        };
      }
    ).scrollContainer;
    const item = { id: 131 };
    expect((grid as unknown as { rowRecycling?: unknown }).rowRecycling).to.equal(slot);
    expect(body.rowMode).to.equal(slot ? 'slot' : 'item');
    // The item branch keeps upstream's record key in both runs.
    expect(body.keyFunction(item, 130)).to.equal(item);

    // A sort re-binds rows in place when they recycle; under item keys every
    // row element moves with its record.
    type RowElement = Element & { data: Row };
    const elements = Array.from(body.querySelectorAll<RowElement>('apex-grid-row'));
    const shown = new Map(elements.map((row) => [row, row.data]));
    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);
    const after = Array.from(body.querySelectorAll<RowElement>('apex-grid-row'));
    const rebound = after.filter((row) => shown.get(row) !== row.data).length;
    if (slot) {
      expect(after, 'the same row elements, in place').to.eql(elements);
      expect(rebound, 'rows showing another record').to.be.greaterThan(0);
    } else {
      expect(rebound, 'rows showing another record').to.equal(0);
    }
  });

  // Declared before the `use()` test below: the static module registry is
  // empty until something opts in, so this asserts the tree-shakeable default
  // (a grid that imports nothing extra wires zero feature modules).
  it('wires no feature modules until opted in', async () => {
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    expect(stateOf(grid).modules.size).to.equal(0);
  });

  it('wires the feature modules opted into via use()', async () => {
    ApexGridEnterprise.use(...enterpriseModules);
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    const { modules } = stateOf(grid);
    expect(modules.size).to.equal(8);
    expect(modules.has('aggregation')).to.be.true;
    expect(modules.has('grouping')).to.be.true;
    expect(modules.has('pivot')).to.be.true;
    expect(modules.has('range-selection')).to.be.true;
    expect(modules.has('context-menu')).to.be.true;
    expect(modules.has('total-row')).to.be.true;
  });

  it('fires apex-view-changed when the view (grouping) changes', async () => {
    ApexGridEnterprise.use(...enterpriseModules);
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    await settle(grid);
    let fired = 0;
    grid.addEventListener(VIEW_CHANGED_EVENT, () => {
      fired += 1;
    });
    grid.groupBy = ['name'];
    await grid.updateComplete;
    await nextFrame();
    expect(fired).to.be.greaterThan(0);
  });
});
