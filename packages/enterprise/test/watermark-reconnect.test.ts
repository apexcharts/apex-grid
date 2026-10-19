import { elementUpdated, expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import { ApexGridEnterprise, type MasterDetailConfig } from '../src/index.js';
import { installSigningKey, resetLicense, settleSignature, signedKey } from './license-fixtures.js';

type Row = { id: number; name: string };
const data: Row[] = [
  { id: 0, name: 'a' },
  { id: 1, name: 'b' },
];
type Order = { id: number; items: Row[] };

const WATERMARK = '[part~="license-watermark"]';

/** How many watermark overlays the grid's shadow root holds. */
function watermarks(grid: ApexGridEnterprise<Row>): number {
  return grid.renderRoot.querySelectorAll(WATERMARK).length;
}

/**
 * Yield past the current task: a frame plus a timer, so every microtask and
 * update queued around the detach has run while the grid is out of the page.
 */
async function laterTask(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 50));
}

function makeParent(): HTMLDivElement {
  const parent = document.createElement('div');
  parent.style.height = '400px';
  return parent;
}

async function mountGrid() {
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise .data=${data}></apex-grid-enterprise>`,
    { parentNode: makeParent() }
  );
  await elementUpdated(grid);
  return grid;
}

/** Every element matching `selector`, searched through nested shadow roots. */
function deepQueryAll(root: ParentNode, selector: string): Element[] {
  const out: Element[] = [];
  const visit = (node: ParentNode) => {
    for (const el of node.querySelectorAll(selector)) out.push(el);
    for (const el of node.querySelectorAll('*')) if (el.shadowRoot) visit(el.shadowRoot);
  };
  visit(root);
  return out;
}

/** Poll up to `tries` animation frames until `predicate` holds. */
async function waitFor(predicate: () => boolean, tries = 30): Promise<void> {
  for (let i = 0; i < tries && !predicate(); i += 1) await nextFrame();
}

/** Detach, wait out a later task, then attach to a different parent. */
async function reconnectLater(grid: ApexGridEnterprise<Row>): Promise<HTMLElement> {
  const next = makeParent();
  document.body.appendChild(next);
  grid.remove();
  await laterTask();
  next.appendChild(grid);
  await laterTask();
  return next;
}

describe('ApexGridEnterprise watermark across a reconnect', () => {
  const parents: HTMLElement[] = [];

  before(async () => {
    ApexGridEnterprise.register();
    await installSigningKey();
  });
  beforeEach(() => resetLicense());
  afterEach(() => {
    fixtureCleanup();
    for (const parent of parents.splice(0)) parent.remove();
    resetLicense();
  });

  it('repaints the watermark when an unlicensed grid is re-attached in a later task', async () => {
    const grid = await mountGrid();
    expect(watermarks(grid)).to.equal(1);

    parents.push(await reconnectLater(grid));

    expect(grid.isConnected).to.be.true;
    expect(watermarks(grid)).to.equal(1);
  });

  it('keeps exactly one watermark over repeated reconnects', async () => {
    const grid = await mountGrid();
    for (let round = 0; round < 3; round++) {
      parents.push(await reconnectLater(grid));
      expect(watermarks(grid), `round ${round}`).to.equal(1);
    }
  });

  it('keeps the watermark across a synchronous move', async () => {
    const grid = await mountGrid();
    const next = makeParent();
    document.body.appendChild(next);
    parents.push(next);

    next.appendChild(grid);
    await laterTask();

    expect(watermarks(grid)).to.equal(1);
  });

  it('paints once when the grid is re-attached before its first update', async () => {
    const grid = document.createElement('apex-grid-enterprise') as ApexGridEnterprise<Row>;
    grid.data = data;
    const first = makeParent();
    const second = makeParent();
    document.body.append(first, second);
    parents.push(first, second);

    first.appendChild(grid);
    second.appendChild(grid);
    await elementUpdated(grid);
    await laterTask();

    expect(grid.hasUpdated).to.be.true;
    expect(watermarks(grid)).to.equal(1);
  });

  it('repaints when the first update ran while the grid was detached', async () => {
    const grid = document.createElement('apex-grid-enterprise') as ApexGridEnterprise<Row>;
    grid.data = data;
    const parent = makeParent();
    document.body.appendChild(parent);
    parents.push(parent);

    parent.appendChild(grid);
    grid.remove();
    await laterTask();
    expect(grid.hasUpdated).to.be.true;

    parent.appendChild(grid);
    await laterTask();

    expect(watermarks(grid)).to.equal(1);
  });

  it('repaints when the licence is revoked while the grid is detached', async () => {
    ApexGridEnterprise.setLicense(await signedKey());
    await settleSignature();
    const grid = await mountGrid();
    expect(watermarks(grid)).to.equal(0);

    const next = makeParent();
    document.body.appendChild(next);
    parents.push(next);
    grid.remove();
    // The grid is unsubscribed from licence changes while detached.
    resetLicense();
    await laterTask();
    next.appendChild(grid);
    await laterTask();

    expect(watermarks(grid)).to.equal(1);
  });

  it('repaints an enterprise detail grid re-expanded from the cache', async () => {
    const orders: Order[] = [{ id: 1, items: data }];
    const config: MasterDetailConfig<Order, Row> = {
      columns: [{ key: 'name' }],
      getDetailData: (order) => order.items,
      detailTag: 'apex-grid-enterprise',
    };
    const master = await fixture<ApexGridEnterprise<Order>>(
      html`<apex-grid-enterprise
        .data=${orders}
        .columns=${[{ key: 'id' }]}
        .masterDetail=${config}
      ></apex-grid-enterprise>`,
      { parentNode: makeParent() }
    );
    await master.updateComplete;
    const details = () =>
      deepQueryAll(master.renderRoot, 'apex-grid-enterprise') as ApexGridEnterprise<Row>[];
    await waitFor(() => deepQueryAll(master.renderRoot, 'apex-grid-cell').length > 0);

    await master.expandRow(orders[0]);
    await waitFor(() => details().length > 0);
    await laterTask();
    const detail = details()[0];
    expect(detail, 'detail rendered').to.exist;
    expect(watermarks(detail), 'first expand').to.equal(1);

    await master.collapseRow(orders[0]);
    await laterTask();
    expect(detail.isConnected, 'collapsed detail detached').to.be.false;

    await master.expandRow(orders[0]);
    await waitFor(() => details().length > 0);
    await laterTask();
    // The manager reuses the cached element, so this is a reconnect.
    expect(details()[0]).to.equal(detail);
    expect(watermarks(detail), 're-expand').to.equal(1);
  });

  it('stays unwatermarked when a licensed grid is re-attached in a later task', async () => {
    ApexGridEnterprise.setLicense(await signedKey());
    await settleSignature();
    const grid = await mountGrid();
    expect(watermarks(grid)).to.equal(0);

    parents.push(await reconnectLater(grid));

    expect(grid.isConnected).to.be.true;
    expect(watermarks(grid)).to.equal(0);
  });
});
