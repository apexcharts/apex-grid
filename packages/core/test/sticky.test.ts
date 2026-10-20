import {
  elementUpdated,
  expect,
  fixture,
  fixtureCleanup,
  html,
  nextFrame,
  waitUntil,
} from '@open-wc/testing';
import { ApexGrid } from '../src/components/grid.js';
import type { ColumnConfiguration, ColumnGroupConfiguration } from '../src/internal/types.js';
import data, { type TestData } from './utils/test-data.js';

ApexGrid.register();

// Leading chrome cells (row-number gutter, reorder grip, selection checkbox,
// expansion toggle) and start-pinned data columns are sticky. Each must stick
// at its own cumulative inline-start offset so nothing stacks after a
// horizontal scroll, and column group headers must sit over their members
// whatever chrome is shown.

const settle = async (grid: HTMLElement) => {
  await elementUpdated(grid);
  await nextFrame();
  await nextFrame();
  await elementUpdated(grid);
  await nextFrame();
};

type Grid = ApexGrid<TestData>;

interface MountOptions {
  columns?: ColumnConfiguration<TestData>[];
  groups?: ColumnGroupConfiguration[];
  dir?: 'ltr' | 'rtl';
  parentStyle?: string;
  chrome?: boolean;
}

const wideColumns = [
  { key: 'id', pinned: 'start', width: '150px' },
  { key: 'name', width: '400px' },
  { key: 'active', width: '400px' },
  { key: 'importance', width: '400px' },
] as ColumnConfiguration<TestData>[];

async function mount(options: MountOptions = {}): Promise<Grid> {
  const { columns = wideColumns, groups, dir = 'ltr', chrome = true } = options;
  const parentNode = Object.assign(document.createElement('div'), {
    style: options.parentStyle ?? 'height:600px;width:500px',
  });
  const grid = await fixture<Grid>(
    html`<apex-grid
      dir=${dir}
      .data=${data}
      .columns=${columns}
      .columnGroups=${groups}
      .selection=${chrome ? { enabled: true, mode: 'multiple', showCheckboxColumn: true } : undefined}
      .expansion=${chrome ? { enabled: true, showToggleColumn: true } : undefined}
      .rowReordering=${chrome ? { enabled: true } : undefined}
      .coordinateHints=${chrome}
    ></apex-grid>`,
    { parentNode }
  );
  await settle(grid);
  // The virtualizer lays body rows out a frame or more after the first paint.
  await waitUntil(() => grid.renderRoot.querySelector('apex-grid-row'), 'body rows rendered');
  await settle(grid);
  return grid;
}

function shadow(grid: Grid, tag: string): ShadowRoot {
  return (grid.renderRoot.querySelector(tag) as HTMLElement).shadowRoot!;
}

function headerParts(grid: Grid): HTMLElement[] {
  const root = shadow(grid, 'apex-grid-header-row');
  const parts = [
    'row-number-header',
    'reorder-handle-header',
    'selection-header',
    'expansion-header',
  ];
  const chrome = parts.map((part) => root.querySelector(`[part~='${part}']`) as HTMLElement);
  return [...chrome, headerFor(grid, 'id')];
}

function bodyParts(grid: Grid): HTMLElement[] {
  const root = shadow(grid, 'apex-grid-row');
  const parts = ['row-number-cell', 'reorder-handle-cell', 'selection-cell', 'expansion-cell'];
  const chrome = parts.map((part) => root.querySelector(`[part~='${part}']`) as HTMLElement);
  const pinned = Array.from(root.querySelectorAll('apex-grid-cell')).find(
    (cell) => (cell as unknown as { column: { key: string } }).column.key === 'id'
  ) as HTMLElement;
  return [...chrome, pinned];
}

function headerFor(grid: Grid, key: string): HTMLElement {
  return Array.from(shadow(grid, 'apex-grid-header-row').querySelectorAll('apex-grid-header')).find(
    (header) => (header as unknown as { column: { key: string } }).column.key === key
  ) as HTMLElement;
}

const rects = (elements: HTMLElement[]) =>
  elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return [Math.round(rect.left), Math.round(rect.right)];
  });

async function scrollBy(grid: Grid, amount: number) {
  grid.scrollLeft = amount;
  await nextFrame();
  await nextFrame();
  expect(Math.abs(grid.scrollLeft), 'the grid scrolled horizontally').to.be.greaterThan(0);
}

function expectSideBySide(boxes: number[][], dir: 'ltr' | 'rtl', label: string) {
  for (let i = 1; i < boxes.length; i++) {
    const [left, right] = boxes[i];
    const [prevLeft, prevRight] = boxes[i - 1];
    if (dir === 'ltr') expect(left, `${label} ${i} starts where ${i - 1} ends`).to.equal(prevRight);
    else expect(right, `${label} ${i} starts where ${i - 1} ends`).to.equal(prevLeft);
  }
}

function hitsItself(root: ShadowRoot, element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const top = root.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return element.contains(top);
}

describe('Sticky chrome cells', () => {
  afterEach(() => fixtureCleanup());

  for (const dir of ['ltr', 'rtl'] as const) {
    it(`header and body chrome cells keep their own offsets after a scroll (${dir})`, async () => {
      const grid = await mount({ dir });
      const headerBefore = rects(headerParts(grid));
      const bodyBefore = rects(bodyParts(grid));
      expectSideBySide(headerBefore, dir, 'header cell');
      expectSideBySide(bodyBefore, dir, 'body cell');

      await scrollBy(grid, dir === 'ltr' ? 600 : -600);

      expect(rects(headerParts(grid)), 'header chrome after scroll').to.deep.equal(headerBefore);
      expect(rects(bodyParts(grid)), 'body chrome after scroll').to.deep.equal(bodyBefore);

      const header = headerParts(grid);
      const body = bodyParts(grid);
      const headerRoot = shadow(grid, 'apex-grid-header-row');
      const bodyRoot = shadow(grid, 'apex-grid-row');
      for (let i = 0; i < header.length; i++) {
        expect(hitsItself(headerRoot, header[i]), `header part ${i} is not covered`).to.be.true;
        expect(hitsItself(bodyRoot, body[i]), `body part ${i} is not covered`).to.be.true;
      }
    });
  }

  it('seeds start-pinned offsets with the leading chrome width', async () => {
    const grid = await mount();
    const offsets = (grid as unknown as { DOM: { pinOffsets: Map<string, number> } }).DOM
      .pinOffsets;
    // Row-number gutter 48 + grip 36 + checkbox 44 + chevron 40.
    expect(offsets.get('id')).to.equal(168);
  });

  it('measures pinned offsets in layout px inside a scaled ancestor', async () => {
    const columns = [
      { key: 'id', pinned: 'start', width: '100px' },
      { key: 'name', pinned: 'start', width: '100px' },
      { key: 'active', width: '900px' },
      { key: 'importance', width: '900px' },
    ] as ColumnConfiguration<TestData>[];
    const grid = await mount({
      columns,
      chrome: false,
      parentStyle: 'height:400px;width:600px;transform:scale(0.5);transform-origin:0 0',
    });
    const offsets = (grid as unknown as { DOM: { pinOffsets: Map<string, number> } }).DOM
      .pinOffsets;
    expect(offsets.get('id')).to.equal(0);
    expect(offsets.get('name')).to.equal(100);
  });

  it('restores the chrome offsets after the host style attribute is replaced', async () => {
    const grid = await mount();
    const before = rects(bodyParts(grid));
    grid.setAttribute('style', 'height:500px');
    grid.requestUpdate();
    await settle(grid);
    expect(grid.style.getPropertyValue('--apex-chrome-offset-expansion')).to.equal('128px');
    await scrollBy(grid, 600);
    expect(rects(bodyParts(grid)), 'body chrome after scroll').to.deep.equal(before);
  });

  it('does not write an unused scrollbar offset onto the host', async () => {
    const grid = await mount({ chrome: false });
    expect(grid.style.getPropertyValue('--scrollbar-offset')).to.equal('');
  });
});

describe('Column group header alignment', () => {
  afterEach(() => fixtureCleanup());

  const groups: ColumnGroupConfiguration[] = [
    { id: 'pin', headerText: 'Pinned' },
    { id: 'g', headerText: 'G' },
  ];

  function groupCell(grid: Grid, text: string): HTMLElement {
    return Array.from(
      shadow(grid, 'apex-grid-group-header-row').querySelectorAll("[part~='group-header']")
    ).find((cell) => cell.textContent?.trim() === text) as HTMLElement;
  }

  function expectOver(grid: Grid, text: string, first: string, last: string) {
    const cell = groupCell(grid, text).getBoundingClientRect();
    const a = headerFor(grid, first).getBoundingClientRect();
    const b = headerFor(grid, last).getBoundingClientRect();
    expect(Math.round(cell.left), `${text} left`).to.equal(Math.round(Math.min(a.left, b.left)));
    expect(Math.round(cell.right), `${text} right`).to.equal(
      Math.round(Math.max(a.right, b.right))
    );
  }

  it('sits over its members with every chrome column shown', async () => {
    const columns = [
      { key: 'id', pinned: 'start', width: '150px', group: 'pin' },
      { key: 'name', width: '200px', group: 'g' },
      { key: 'active', width: '200px', group: 'g' },
      { key: 'importance', width: '200px' },
    ] as ColumnConfiguration<TestData>[];
    const grid = await mount({ columns, groups, parentStyle: 'height:600px;width:1200px' });
    expectOver(grid, 'Pinned', 'id', 'id');
    expectOver(grid, 'G', 'name', 'active');
  });

  it('keeps aria-colindex on the selection + expansion numbering', async () => {
    const columns = [
      { key: 'id', width: '150px' },
      { key: 'name', width: '200px', group: 'g' },
      { key: 'active', width: '200px', group: 'g' },
    ] as ColumnConfiguration<TestData>[];
    const grid = await mount({ columns, groups, parentStyle: 'height:600px;width:1200px' });
    const cell = groupCell(grid, 'G');
    // Selection 1, expansion 2, id 3, name 4: the gutter and grip are aria-hidden.
    expect(cell.getAttribute('aria-colindex')).to.equal('4');
  });

  for (const dir of ['ltr', 'rtl'] as const) {
    it(`spacers over chrome and pinned columns stay frozen on scroll (${dir})`, async () => {
      const columns = [
        { key: 'id', pinned: 'start', width: '150px' },
        { key: 'name', width: '600px', group: 'g' },
        { key: 'active', width: '600px', group: 'g' },
      ] as ColumnConfiguration<TestData>[];
      const grid = await mount({ columns, groups, dir });
      await scrollBy(grid, dir === 'ltr' ? 300 : -300);
      const root = shadow(grid, 'apex-grid-group-header-row');
      const groupRow = grid.renderRoot.querySelector('apex-grid-group-header-row') as HTMLElement;
      const y = groupRow.getBoundingClientRect().top + groupRow.offsetHeight / 2;
      for (const element of headerParts(grid)) {
        const rect = element.getBoundingClientRect();
        const top = root.elementFromPoint(rect.left + rect.width / 2, y) as HTMLElement | null;
        expect(top?.getAttribute('part'), 'above a frozen column').to.equal('group-spacer');
      }
    });
  }
});
