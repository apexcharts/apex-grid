import { elementUpdated, expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { ApexGrid } from 'apex-grid/internal';
import {
  ApexGridEnterprise,
  ENTERPRISE_TAG,
  enterpriseModules,
  VIEW_CHANGED_EVENT,
} from '../src/index.js';

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

/** Waits for the virtualizer's first layout so `grid.rows` is populated. */
async function layoutComplete(grid: ApexGridEnterprise<Row>) {
  await elementUpdated(grid);
  const scrollContainer = (
    grid as unknown as { scrollContainer?: { layoutComplete?: Promise<unknown> } }
  ).scrollContainer;
  await scrollContainer?.layoutComplete;
  await nextFrame();
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
    await layoutComplete(grid);
    expect(grid.columns.length).to.equal(columns.length);
    expect(grid.rows.length).to.equal(data.length);
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
    expect(modules.size).to.equal(4);
    expect(modules.has('aggregation')).to.be.true;
    expect(modules.has('grouping')).to.be.true;
    expect(modules.has('pivot')).to.be.true;
    expect(modules.has('range-selection')).to.be.true;
  });

  it('fires apex-view-changed when the view (grouping) changes', async () => {
    ApexGridEnterprise.use(...enterpriseModules);
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    await layoutComplete(grid);
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
