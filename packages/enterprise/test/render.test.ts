import { elementUpdated, expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { ApexGrid } from 'apex-grid/internal';
import { ApexGridEnterprise, ENTERPRISE_TAG } from '../src/index.js';

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

  it('registers zero feature modules (no enterprise features yet)', async () => {
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    expect(stateOf(grid).modules.size).to.equal(0);
  });
});
