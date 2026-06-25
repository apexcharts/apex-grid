import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { ApexGridChart, ApexGridEnterprise, enterpriseModules } from '../src/index.js';

interface Row {
  name: string;
  value: number;
}
const data: Row[] = [
  { name: 'A', value: 10 },
  { name: 'B', value: 20 },
  { name: 'C', value: 30 },
];
const columns: ColumnConfiguration<Row>[] = [
  { key: 'name', type: 'string', headerText: 'Name', sort: true },
  { key: 'value', type: 'number', headerText: 'Value', sort: true },
];

function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '500px';
  return node;
}

async function layoutComplete(grid: ApexGridEnterprise<Row>) {
  await grid.updateComplete;
  const scroll = (grid as unknown as { scrollContainer?: { layoutComplete?: Promise<unknown> } })
    .scrollContainer;
  await scroll?.layoutComplete;
  await nextFrame();
}

async function mount() {
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise .data=${data.map((r) => ({ ...r }))} .columns=${columns}></apex-grid-enterprise>`,
    { parentNode: sizedParent() }
  );
  await layoutComplete(grid);
  return grid;
}

function cellElement(grid: ApexGridEnterprise<Row>, rowIndex: number, key: keyof Row) {
  for (const row of grid.rows) {
    if (row.index !== rowIndex) continue;
    return row.cells.find((c) => String(c.column.key) === key) as unknown as
      | HTMLElement
      | undefined;
  }
  return undefined;
}

function deepFind(
  root: ShadowRoot | Element,
  predicate: (el: Element) => boolean
): HTMLElement | undefined {
  const stack: (ShadowRoot | Element)[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    for (const el of node.querySelectorAll('*')) {
      if (predicate(el)) return el as HTMLElement;
      if (el.shadowRoot) stack.push(el.shadowRoot);
    }
  }
  return undefined;
}

function headerElement(grid: ApexGridEnterprise<Row>, key: keyof Row) {
  const root = (grid as unknown as { shadowRoot: ShadowRoot }).shadowRoot;
  return deepFind(
    root,
    (el) =>
      el.localName === 'apex-grid-header' &&
      String((el as unknown as { column?: { key?: unknown } }).column?.key) === key
  );
}

function rightClick(el: HTMLElement) {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    composed: true,
    cancelable: true,
    clientX: 60,
    clientY: 60,
  });
  el.dispatchEvent(event);
  return event;
}

function menu() {
  return document.querySelector('.apex-grid-context-menu');
}

function item(label: string) {
  // Search across all open menus (root + any flyout submenu); strip the submenu caret.
  return [
    ...document.querySelectorAll<HTMLButtonElement>('.apex-grid-context-menu .agcm-item'),
  ].find((b) => b.textContent?.replace('›', '').trim() === label);
}

describe('Context menu', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridChart.register();
  });
  afterEach(() => {
    for (const m of document.querySelectorAll('.apex-grid-context-menu')) m.remove();
    for (const c of document.querySelectorAll('apex-grid-chart')) c.remove();
    fixtureCleanup();
  });

  it('opens on cell right-click and suppresses the native menu', async () => {
    const grid = await mount();
    const event = rightClick(cellElement(grid, 0, 'value')!);
    expect(event.defaultPrevented).to.equal(true);
    expect(menu()).to.exist;
    expect(item('Sort ascending')).to.exist;
    expect(item('Copy')).to.exist;
  });

  it('opens on header right-click (no Copy item)', async () => {
    const grid = await mount();
    rightClick(headerElement(grid, 'value')!);
    expect(menu()).to.exist;
    expect(item('Sort ascending')).to.exist;
    expect(item('Copy')).to.equal(undefined);
  });

  it('sorts via the menu', async () => {
    const grid = await mount();
    rightClick(cellElement(grid, 0, 'value')!);
    item('Sort ascending')!.click();
    await grid.updateComplete;
    expect(grid.sortExpressions).to.have.length(1);
    expect(grid.sortExpressions[0].key).to.equal('value');
    expect(grid.sortExpressions[0].direction).to.equal('ascending');
  });

  it('pins a column via the menu', async () => {
    const grid = await mount();
    rightClick(headerElement(grid, 'name')!);
    item('Pin to start')!.click();
    await grid.updateComplete;
    expect(grid.columns.find((c) => c.key === 'name')?.pinned).to.equal('start');
  });

  it('hides a column via the menu', async () => {
    const grid = await mount();
    rightClick(headerElement(grid, 'value')!);
    item('Hide column')!.click();
    await grid.updateComplete;
    expect(grid.columns.find((c) => c.key === 'value')?.hidden).to.equal(true);
  });

  it('closes on Escape', async () => {
    const grid = await mount();
    rightClick(cellElement(grid, 0, 'name')!);
    expect(menu()).to.exist;
    menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu()).to.equal(null);
  });

  it('closes on outside pointerdown', async () => {
    const grid = await mount();
    rightClick(cellElement(grid, 0, 'name')!);
    expect(menu()).to.exist;
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(menu()).to.equal(null);
  });

  it('does nothing when context-menu is disabled', async () => {
    const grid = await mount();
    grid.contextMenu = false;
    await grid.updateComplete;
    const event = rightClick(cellElement(grid, 0, 'name')!);
    expect(event.defaultPrevented).to.equal(false);
    expect(menu()).to.equal(null);
  });

  it('opens the Chart range submenu and charts the selection by type', async () => {
    const grid = await mount();
    grid.selectRange({ row: 0, column: 'name' }, { row: 2, column: 'value' });
    rightClick(cellElement(grid, 0, 'value')!);
    item('Chart range')!.click(); // opens the flyout
    expect(item('Line')).to.exist;
    item('Line')!.click();
    const chart = document.body.querySelector('apex-grid-chart');
    expect(chart).to.exist;
    expect((chart as unknown as { open: boolean }).open).to.equal(true);
    expect((chart as unknown as { type: string }).type).to.equal('line');
    expect((chart as unknown as { source: string }).source).to.equal('selection');
  });

  it('apex-context-menu-opening can add items', async () => {
    const grid = await mount();
    grid.addEventListener('apex-context-menu-opening', (event) => {
      (event as CustomEvent<{ items: { id: string; label: string }[] }>).detail.items.push({
        id: 'custom',
        label: 'Custom action',
      });
    });
    rightClick(cellElement(grid, 0, 'name')!);
    expect(item('Custom action')).to.exist;
  });

  it('apex-context-menu-opening is cancellable', async () => {
    const grid = await mount();
    grid.addEventListener('apex-context-menu-opening', (event) => event.preventDefault());
    rightClick(cellElement(grid, 0, 'name')!);
    expect(menu()).to.equal(null);
  });

  it('contextMenu config replaces the default items', async () => {
    const grid = await mount();
    grid.contextMenu = { items: [{ id: 'only', label: 'Only this', run: () => {} }] };
    await grid.updateComplete;
    rightClick(cellElement(grid, 0, 'name')!);
    expect(item('Only this')).to.exist;
    expect(item('Sort ascending')).to.equal(undefined);
  });
});
