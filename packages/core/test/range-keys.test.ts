import { expect, fixture, fixtureCleanup, html, nextFrame, waitUntil } from '@open-wc/testing';
import { ApexGrid } from '../src/components/grid.js';
import type { NavigationController } from '../src/controllers/navigation.js';
import type { ActiveNode, ColumnConfiguration } from '../src/internal/types.js';

// The navigation seam a feature moving something other than the active cell
// with the keyboard (enterprise range extension) scrolls and steps through:
// revealCell, towardsInlineEnd and scrollInsets.

interface Row {
  [key: string]: number;
}

const columns: ColumnConfiguration<Row>[] = Array.from({ length: 30 }, (_, i) => ({
  key: `c${i}`,
  type: 'number',
  width: '120px',
}));
const data: Row[] = Array.from({ length: 400 }, (_, r) =>
  Object.fromEntries(columns.map((c, i) => [String(c.key), r * 100 + i]))
);

async function mount(dir?: 'rtl') {
  ApexGrid.register();
  const parent = document.createElement('div');
  parent.style.height = '300px';
  parent.style.width = '500px';
  if (dir) parent.dir = dir;
  const grid = await fixture<ApexGrid<Row>>(
    html`<apex-grid style="height: 100%" .data=${data} .columns=${columns}></apex-grid>`,
    { parentNode: parent }
  );
  await grid.updateComplete;
  await (grid as unknown as { scrollContainer?: { layoutComplete?: Promise<unknown> } })
    .scrollContainer?.layoutComplete;
  await nextFrame();
  await waitUntil(() => grid.rows.length > 0, 'body rows never rendered');
  return grid;
}

function navigationOf(grid: ApexGrid<Row>): NavigationController<Row> {
  return (grid as unknown as { stateController: { navigation: NavigationController<Row> } })
    .stateController.navigation;
}

function renderedCell(grid: ApexGrid<Row>, rowIndex: number, key: string) {
  const row = grid.rows.find((r) => r.index === rowIndex);
  return row?.cells.find((cell) => String(cell.column.key) === key) as HTMLElement | undefined;
}

describe('navigation seam for features', () => {
  afterEach(() => fixtureCleanup());

  it('revealCell scrolls a row the virtualizer has not rendered, then its cell', async () => {
    const grid = await mount();
    const el = grid as unknown as HTMLElement;
    const navigation = navigationOf(grid);
    const before = navigation.active;

    navigation.revealCell({ row: 300, column: 'c25' } as ActiveNode<Row>);
    await waitUntil(() => renderedCell(grid, 300, 'c25'), 'row 300 never rendered');
    for (let i = 0; i < 4; i += 1) await nextFrame();

    const cell = renderedCell(grid, 300, 'c25')!;
    const host = el.getBoundingClientRect();
    const rect = cell.getBoundingClientRect();
    expect(el.scrollTop, 'scrolled down').to.be.greaterThan(1000);
    expect(el.scrollLeft, 'scrolled inline').to.be.greaterThan(1000);
    expect(rect.bottom).to.be.at.most(host.bottom + 1);
    expect(rect.right).to.be.at.most(host.right + 1);
    expect(navigation.active, 'the active cell does not move').to.equal(before);
  });

  it('revealCell scrolls a rendered cell into view directly', async () => {
    const grid = await mount();
    const el = grid as unknown as HTMLElement;
    navigationOf(grid).revealCell({ row: 1, column: 'c10' } as ActiveNode<Row>);
    expect(el.scrollLeft, 'scrolled inline at once').to.be.greaterThan(500);
  });

  it('towardsInlineEnd maps the physical arrows onto column order', async () => {
    const ltr = navigationOf(await mount());
    expect(ltr.towardsInlineEnd('ArrowRight')).to.equal(true);
    expect(ltr.towardsInlineEnd('ArrowLeft')).to.equal(false);
    fixtureCleanup();
    const rtl = navigationOf(await mount('rtl'));
    expect(rtl.towardsInlineEnd('ArrowLeft')).to.equal(true);
    expect(rtl.towardsInlineEnd('ArrowRight')).to.equal(false);
  });

  it('scrollInsets measures the header above and pinned columns beside the body', async () => {
    const grid = await mount();
    grid.columns = columns.map((c, i) => (i === 0 ? { ...c, pinned: 'start' } : c));
    await grid.updateComplete;
    for (let i = 0; i < 3; i += 1) await nextFrame();
    const insets = navigationOf(grid).scrollInsets();
    expect(insets.top, 'header height').to.be.greaterThan(0);
    expect(insets.left, 'start pinned column width').to.be.within(100, 140);
    expect(insets.right).to.equal(0);
  });
});
