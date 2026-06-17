import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { ApexGridEnterprise, ApexGridToolPanel } from '../src/index.js';

interface Row {
  id: number;
  name: string;
  amount: number;
}

const data: Row[] = [
  { id: 1, name: 'A', amount: 10 },
  { id: 2, name: 'B', amount: 20 },
];
const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', headerText: 'ID' },
  { key: 'name', headerText: 'Name' },
  { key: 'amount', headerText: 'Amount' },
];

async function mount() {
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`
  );
  const panel = await fixture<ApexGridToolPanel>(
    html`<apex-grid-tool-panel .grid=${grid}></apex-grid-tool-panel>`
  );
  await grid.updateComplete;
  await panel.updateComplete;
  return { grid, panel };
}

async function settle(grid: ApexGridEnterprise<Row>, panel: ApexGridToolPanel) {
  await grid.updateComplete;
  await panel.updateComplete;
  await nextFrame();
}

function item(panel: ApexGridToolPanel, key: string): Element {
  return panel.shadowRoot!.querySelector(`li[data-key="${key}"]`)!;
}
function control<E extends HTMLElement>(panel: ApexGridToolPanel, key: string, part: string): E {
  return item(panel, key).querySelector(`[part="${part}"]`) as E;
}
function keysOf(grid: ApexGridEnterprise<Row>): string[] {
  return grid.columns.map((c) => String(c.key));
}

function zoneByTitle(panel: ApexGridToolPanel, title: string): HTMLElement {
  return [...panel.shadowRoot!.querySelectorAll('[part="zone"]')].find((zone) =>
    zone.querySelector('[part="zone-title"]')?.textContent?.includes(title)
  ) as HTMLElement;
}
function dropOnZone(zone: HTMLElement, key: string): void {
  const dt = new DataTransfer();
  dt.setData('text/plain', key);
  zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
}

describe('ApexGridToolPanel', () => {
  before(() => {
    ApexGridEnterprise.register();
    ApexGridToolPanel.register();
  });
  afterEach(() => fixtureCleanup());

  it('lists every column', async () => {
    const { panel } = await mount();
    const rows = panel.shadowRoot!.querySelectorAll('li[part="item"]');
    expect(rows.length).to.equal(3);
  });

  it('toggles column visibility', async () => {
    const { grid, panel } = await mount();
    const checkbox = control<HTMLInputElement>(panel, 'name', 'visible');
    expect(checkbox.checked).to.be.true;

    checkbox.click();
    await settle(grid, panel);

    expect(grid.columns.find((c) => c.key === 'name')!.hidden).to.be.true;
  });

  it('reorders a column', async () => {
    const { grid, panel } = await mount();
    expect(keysOf(grid)).to.eql(['id', 'name', 'amount']);

    control<HTMLButtonElement>(panel, 'id', 'down').click();
    await settle(grid, panel);

    expect(keysOf(grid)).to.eql(['name', 'id', 'amount']);
  });

  it('cycles a column pin (none → start → end)', async () => {
    const { grid, panel } = await mount();
    const pinned = () => grid.columns.find((c) => c.key === 'amount')!.pinned;

    control<HTMLButtonElement>(panel, 'amount', 'pin').click();
    await settle(grid, panel);
    expect(pinned()).to.equal('start');

    control<HTMLButtonElement>(panel, 'amount', 'pin').click();
    await settle(grid, panel);
    expect(pinned()).to.equal('end');
  });

  it('toggles grouping by a column', async () => {
    const { grid, panel } = await mount();
    control<HTMLButtonElement>(panel, 'name', 'group').click();
    await settle(grid, panel);
    expect(grid.groupBy).to.eql(['name']);

    control<HTMLButtonElement>(panel, 'name', 'group').click();
    await settle(grid, panel);
    expect(grid.groupBy).to.eql([]);
  });

  it('filters the list by search', async () => {
    const { panel } = await mount();
    const search = panel.shadowRoot!.querySelector('[part="search"]') as HTMLInputElement;
    search.value = 'amo';
    search.dispatchEvent(new Event('input'));
    await panel.updateComplete;

    const rows = panel.shadowRoot!.querySelectorAll('li[part="item"]');
    expect(rows.length).to.equal(1);
    expect(rows[0].getAttribute('data-key')).to.equal('amount');
  });

  it('dragging a column into Row Groups sets groupBy', async () => {
    const { grid, panel } = await mount();
    dropOnZone(zoneByTitle(panel, 'Row Groups'), 'name');
    await settle(grid, panel);
    expect(grid.groupBy).to.eql(['name']);
  });

  it('dragging a column into Values sets aggregations', async () => {
    const { grid, panel } = await mount();
    dropOnZone(zoneByTitle(panel, 'Values'), 'amount');
    await settle(grid, panel);
    expect(grid.aggregations).to.eql({ amount: ['sum'] });
  });

  it('removing a Values chip clears that aggregation', async () => {
    const { grid, panel } = await mount();
    dropOnZone(zoneByTitle(panel, 'Values'), 'amount');
    await settle(grid, panel);

    const remove = zoneByTitle(panel, 'Values').querySelector(
      '[part="chip"] button'
    ) as HTMLButtonElement;
    remove.click();
    await settle(grid, panel);
    expect(grid.aggregations).to.eql({});
  });

  it('pivot mode repoints the zones and activates pivot once all three are set', async () => {
    const { grid, panel } = await mount();
    (panel.shadowRoot!.querySelector('[part="pivot-mode"]') as HTMLInputElement).click();
    await settle(grid, panel);
    expect(panel.pivotMode).to.be.true;

    dropOnZone(zoneByTitle(panel, 'Row Groups'), 'id');
    await settle(grid, panel);
    dropOnZone(zoneByTitle(panel, 'Column Labels'), 'name');
    await settle(grid, panel);
    dropOnZone(zoneByTitle(panel, 'Values'), 'amount');
    await settle(grid, panel);

    expect(grid.pivotRows).to.eql(['id']);
    expect(grid.pivotOn).to.equal('name');
    expect(grid.pivotValues).to.eql({ amount: ['sum'] });
    expect(grid.isPivoting).to.be.true;
  });

  it('leaving pivot mode carries the row dimension back to groupBy', async () => {
    const { grid, panel } = await mount();
    const toggle = panel.shadowRoot!.querySelector('[part="pivot-mode"]') as HTMLInputElement;

    toggle.click(); // enter pivot mode
    await settle(grid, panel);
    dropOnZone(zoneByTitle(panel, 'Row Groups'), 'name');
    await settle(grid, panel);
    expect(grid.pivotRows).to.eql(['name']);

    toggle.click(); // leave pivot mode
    await settle(grid, panel);
    expect(panel.pivotMode).to.be.false;
    expect(grid.groupBy).to.eql(['name']);
    expect(grid.isPivoting).to.be.false;
  });
});
