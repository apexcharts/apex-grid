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

  it('restores focus to the previously focused element on Escape', async () => {
    const grid = await mount();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    try {
      trigger.focus();
      rightClick(cellElement(grid, 0, 'name')!);
      expect(menu()).to.exist;
      menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(menu()).to.equal(null);
      expect(document.activeElement).to.equal(trigger);
    } finally {
      trigger.remove();
    }
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

  it('offers "Chart this view" (not "Chart range") while grouping is active', async () => {
    const grid = await mount();
    grid.groupBy = ['name'];
    await grid.updateComplete;
    rightClick(headerElement(grid, 'value')!);
    expect(item('Chart this view')).to.exist;
    expect(item('Chart range')).to.equal(undefined);
    // Charting the view opens a chart without a selection source (reads the group/pivot model).
    item('Chart this view')!.click();
    item('Column')!.click();
    const chart = document.body.querySelector('apex-grid-chart');
    expect(chart).to.exist;
    expect((chart as unknown as { source: string }).source).to.equal('auto');
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

describe('Context menu: targets, events and entry points (ctx-menu batch)', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => {
    for (const m of document.querySelectorAll('.apex-grid-context-menu')) m.remove();
    fixtureCleanup();
  });

  interface Child {
    name: string;
    qty: number;
  }
  interface Order {
    name: string;
    value: number;
    items: Child[];
  }
  const orders: Order[] = [
    { name: 'A', value: 1, items: [{ name: 'a1', qty: 5 }] },
    { name: 'B', value: 2, items: [{ name: 'b1', qty: 6 }] },
  ];
  const detailColumns: ColumnConfiguration<Child>[] = [
    { key: 'name', headerText: 'Child name', sort: true },
    { key: 'qty', type: 'number', headerText: 'Qty', sort: true },
  ];

  async function waitFor(predicate: () => boolean, tries = 60): Promise<void> {
    for (let i = 0; i < tries && !predicate(); i += 1) await nextFrame();
  }

  async function mountMasterDetail(detailTag?: 'apex-grid' | 'apex-grid-enterprise') {
    const grid = await fixture<ApexGridEnterprise<Order>>(
      html`<apex-grid-enterprise
        .data=${orders}
        .columns=${columns as unknown as ColumnConfiguration<Order>[]}
        .masterDetail=${{
          columns: detailColumns,
          getDetailData: (row: Order) => row.items,
          detailTag,
        }}
      ></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    await layoutComplete(grid as unknown as ApexGridEnterprise<Row>);
    await grid.expandRow(orders[0]);
    await grid.updateComplete;
    const root = (grid as unknown as { shadowRoot: ShadowRoot }).shadowRoot;
    const childCell = () =>
      deepFind(
        root,
        (el) =>
          el.localName === 'apex-grid-cell' &&
          (el as unknown as { column?: { headerText?: string } }).column?.headerText ===
            'Child name'
      );
    await waitFor(() => !!childCell());
    // An untyped view for the module's own event names.
    return { grid, host: grid as HTMLElement, childCell: childCell()! };
  }

  it('ignores a right-click inside a nested community detail grid', async () => {
    const { grid, host, childCell } = await mountMasterDetail();
    let opened = 0;
    host.addEventListener('apex-context-menu-opening', () => opened++);
    const event = rightClick(childCell);
    expect(opened, 'outer menu opened for an inner cell').to.equal(0);
    expect(menu()).to.equal(null);
    expect(event.defaultPrevented).to.equal(false);
    expect(grid.columns.every((c) => !c.hidden)).to.equal(true);
  });

  it('opens only the nested enterprise grid menu, for its own column', async () => {
    const { host, childCell } = await mountMasterDetail('apex-grid-enterprise');
    let outer = 0;
    let innerTarget: { column: { headerText?: string } } | null = null;
    host.addEventListener('apex-context-menu-opening', (e) => {
      const target = (e as CustomEvent).detail.target;
      if (target.column.headerText === 'Child name') innerTarget = target;
      else outer++;
    });
    rightClick(childCell);
    expect(outer, 'outer grid opened its own menu too').to.equal(0);
    expect(innerTarget, 'inner grid opened its menu').to.not.equal(null);
    expect(document.querySelectorAll('.apex-grid-context-menu').length).to.equal(1);
  });

  it('Shift+F10 inside a nested detail grid does not open the outer menu', async () => {
    const { host, childCell } = await mountMasterDetail();
    let opened = 0;
    host.addEventListener('apex-context-menu-opening', () => opened++);
    childCell.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F10',
        shiftKey: true,
        bubbles: true,
        composed: true,
        cancelable: true,
      })
    );
    expect(opened).to.equal(0);
    expect(menu()).to.equal(null);
  });

  it('targets the record of a pinned row', async () => {
    const rows = data.map((r) => ({ ...r }));
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise
        .data=${rows}
        .columns=${columns}
        .rowPinning=${{ enabled: true }}
      ></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    await layoutComplete(grid);
    let seen: { row?: Row; rowIndex?: number } | null = null;
    grid.contextMenu = {
      items: (target) => {
        seen = target as { row?: Row; rowIndex?: number };
        return [{ id: 'x', label: 'X', run: () => {} }];
      },
    };
    expect(grid.pinRow(rows[2], 'top')).to.equal(true);
    await layoutComplete(grid);
    const root = (grid as unknown as { shadowRoot: ShadowRoot }).shadowRoot;
    const nameCell = (record: Row, pinned: boolean) =>
      deepFind(root, (el) => {
        const cell = el as unknown as {
          column?: { key?: unknown };
          row?: HTMLElement & { data?: Row };
        };
        return (
          el.localName === 'apex-grid-cell' &&
          String(cell.column?.key) === 'name' &&
          cell.row?.data === record &&
          (cell.row?.getAttribute('part') ?? '').includes('pinned-row') === pinned
        );
      });
    const pinnedCell = nameCell(rows[2], true);
    expect(pinnedCell, 'pinned name cell').to.exist;
    rightClick(pinnedCell!);
    expect(seen!.row?.name).to.equal('C');
    expect(seen!.rowIndex, 'a pinned row has no pageItems index').to.equal(undefined);

    rightClick(nameCell(rows[0], false)!);
    expect(seen!.row?.name).to.equal('A');
    expect(seen!.rowIndex).to.equal(0);
  });

  it('reports the rendered row index when one record appears twice', async () => {
    const twice = { name: 'X', value: 1 };
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise
        .data=${[twice, { name: 'Y', value: 2 }, twice]}
        .columns=${columns}
      ></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    await layoutComplete(grid);
    let seen: { row?: Row; rowIndex?: number } | null = null;
    grid.contextMenu = {
      items: (target) => {
        seen = target as { row?: Row; rowIndex?: number };
        return [{ id: 'x', label: 'X', run: () => {} }];
      },
    };
    await grid.updateComplete;
    rightClick(cellElement(grid, 2, 'name')!);
    expect(seen!.row).to.equal(twice);
    expect(seen!.rowIndex).to.equal(2);
  });

  it('menu sort replaces the existing sort and fires sorting and sorted', async () => {
    const grid = await mount();
    const events: string[] = [];
    grid.addEventListener('sorting', () => events.push('sorting'));
    grid.addEventListener('sorted', () => events.push('sorted'));
    rightClick(headerElement(grid, 'name')!);
    item('Sort ascending')!.click();
    await waitFor(() => events.length >= 2);
    rightClick(headerElement(grid, 'value')!);
    item('Sort descending')!.click();
    await waitFor(() => events.length >= 4);
    await grid.updateComplete;
    expect(grid.sortExpressions.map((e) => String(e.key))).to.deep.equal(['value']);
    expect(grid.dataView.map((r) => r.name).join(',')).to.equal('C,B,A');
    expect(events).to.deep.equal(['sorting', 'sorted', 'sorting', 'sorted']);
  });

  it('a cancelled sorting event vetoes the menu sort', async () => {
    const grid = await mount();
    grid.addEventListener('sorting', (e) => e.preventDefault());
    rightClick(headerElement(grid, 'value')!);
    item('Sort ascending')!.click();
    await grid.updateComplete;
    expect(grid.sortExpressions).to.have.length(0);
  });

  it('omits the sort items on a column that is not sortable', async () => {
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise
        .data=${data.map((r) => ({ ...r }))}
        .columns=${[{ key: 'name', headerText: 'Name' }, columns[1]]}
      ></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    await layoutComplete(grid);
    rightClick(headerElement(grid, 'name')!);
    expect(item('Pin to start')).to.exist;
    expect(item('Sort ascending')).to.equal(undefined);
    expect(item('Sort descending')).to.equal(undefined);
    expect(item('Clear sort')).to.equal(undefined);
    expect(menu()!.firstElementChild?.getAttribute('role')).to.not.equal('separator');
  });

  it('omits the sort items while a manual row order is active, like the header', async () => {
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise
        .data=${data.map((r) => ({ ...r }))}
        .columns=${columns}
        .rowReordering=${{ enabled: true }}
      ></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    await layoutComplete(grid);
    rightClick(headerElement(grid, 'value')!);
    expect(item('Sort ascending'), 'sortable before the move').to.exist;
    for (const m of document.querySelectorAll('.apex-grid-context-menu')) m.remove();
    expect(grid.moveRow(0, 2, 'after')).to.equal(true);
    await layoutComplete(grid);
    rightClick(headerElement(grid, 'value')!);
    expect(item('Pin to start')).to.exist;
    expect(item('Sort ascending')).to.equal(undefined);
  });

  it('pin and unpin go through pinColumn, so columnPinning can veto', async () => {
    const grid = await mount();
    const pinned: unknown[] = [];
    grid.addEventListener('columnPinned', (e) => pinned.push((e as CustomEvent).detail.pinned));
    rightClick(headerElement(grid, 'name')!);
    item('Pin to end')!.click();
    await waitFor(() => pinned.length > 0);
    expect(pinned).to.deep.equal(['end']);

    const veto = (e: Event) => e.preventDefault();
    grid.addEventListener('columnPinning', veto);
    rightClick(headerElement(grid, 'value')!);
    item('Pin to start')!.click();
    await grid.updateComplete;
    expect(grid.columns.find((c) => c.key === 'value')?.pinned ?? null).to.equal(null);
    grid.removeEventListener('columnPinning', veto);

    rightClick(headerElement(grid, 'name')!);
    item('Unpin')!.click();
    await waitFor(() => pinned.length > 1);
    expect(pinned).to.deep.equal(['end', null]);
  });

  function kebab(grid: ApexGridEnterprise<Row>, key: keyof Row) {
    return headerElement(grid, key)!.shadowRoot!.querySelector<HTMLButtonElement>(
      '[part~="menu-btn"]'
    )!;
  }

  function pressKebab(button: HTMLElement) {
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    button.click();
  }

  it('the header kebab opens the shared menu, toggles it closed and tracks aria-expanded', async () => {
    const grid = await mount();
    const button = kebab(grid, 'value');
    expect(button, 'kebab rendered').to.exist;
    pressKebab(button);
    await grid.updateComplete;
    expect(menu(), 'shared menu open').to.exist;
    expect(item('Pin to start')).to.exist;
    expect(headerElement(grid, 'value')!.shadowRoot!.querySelector('[part="col-menu"]')).to.equal(
      null
    );
    expect(button.getAttribute('aria-expanded')).to.equal('true');

    pressKebab(button);
    await grid.updateComplete;
    expect(menu(), 'second press closes').to.equal(null);
    expect(button.getAttribute('aria-expanded')).to.equal('false');

    pressKebab(button);
    expect(menu(), 'third press reopens').to.exist;
    menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(button.getAttribute('aria-expanded')).to.equal('false');
  });

  it('Shift+F10 on a focused cell opens the menu; running an item restores focus', async () => {
    const grid = await mount();
    const cell = cellElement(grid, 0, 'name')!;
    cell.focus();
    cell.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F10',
        shiftKey: true,
        bubbles: true,
        composed: true,
        cancelable: true,
      })
    );
    expect(menu()).to.exist;
    let ran = false;
    grid.contextMenu = { items: [{ id: 'r', label: 'Run me', run: () => (ran = true) }] };
    await grid.updateComplete;
    for (const m of document.querySelectorAll('.apex-grid-context-menu')) m.remove();
    cell.focus();
    cell.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, composed: true })
    );
    item('Run me')!.click();
    expect(ran).to.equal(true);
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    expect(active).to.equal(cell);
  });

  it('ArrowRight opens and ArrowLeft closes the Chart range submenu', async () => {
    const grid = await mount();
    grid.selectRange({ row: 0, column: 'name' }, { row: 2, column: 'value' });
    rightClick(cellElement(grid, 0, 'value')!);
    const parent = item('Chart range')!;
    parent.focus();
    menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.querySelectorAll('.apex-grid-context-menu').length).to.equal(2);
    const submenu = document.querySelectorAll('.apex-grid-context-menu')[1];
    submenu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.querySelectorAll('.apex-grid-context-menu').length).to.equal(1);
    expect(document.activeElement).to.equal(parent);
  });

  it('leaves the browser menu alone inside a cell editor', async () => {
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise
        .data=${data.map((r) => ({ ...r }))}
        .columns=${columns.map((c) => ({ ...c, editable: true }))}
        .editing=${{ enabled: true }}
      ></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    await layoutComplete(grid);
    expect(await grid.editCell(0, 'name')).to.equal(true);
    const cell = cellElement(grid, 0, 'name')!;
    const editorInput = () => deepFind(cell.shadowRoot!, (el) => el.localName === 'input');
    await waitFor(() => !!editorInput());
    const input = editorInput();
    expect(input, 'editor input').to.exist;
    const event = rightClick(input!);
    expect(event.defaultPrevented).to.equal(false);
    expect(menu()).to.equal(null);
  });

  it('keeps the grid menu on a checkbox a cell template renders', async () => {
    const templated: ColumnConfiguration<Row>[] = [
      { ...columns[0], cellTemplate: () => html`<input type="checkbox" />` },
      columns[1],
    ];
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise
        .data=${data.map((r) => ({ ...r }))}
        .columns=${templated}
      ></apex-grid-enterprise>`,
      { parentNode: sizedParent() }
    );
    await layoutComplete(grid);
    const root = (grid as unknown as { shadowRoot: ShadowRoot }).shadowRoot;
    const checkbox = deepFind(
      root,
      (el) => el.localName === 'input' && el.getAttribute('type') === 'checkbox'
    );
    expect(checkbox, 'template checkbox').to.exist;
    expect(rightClick(checkbox!).defaultPrevented).to.equal(true);
    expect(menu()).to.exist;
  });
});
