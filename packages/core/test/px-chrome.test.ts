import { expect, fixture, fixtureCleanup, html, nextFrame, waitUntil } from '@open-wc/testing';
import { ApexGrid } from '../src/components/grid.js';
import ApexGridHeaderRow from '../src/components/header-row.js';
import ApexGridPaginator from '../src/components/paginator.js';
import type { ColumnConfiguration } from '../src/internal/types.js';
import { settle } from './utils/settle.js';

interface Row {
  id: number;
  name: string;
}

const data: Row[] = Array.from({ length: 30 }, (_, id) => ({ id, name: `Row ${id}` }));
const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number', sort: true, filter: true },
  { key: 'name', sort: true, filter: true },
];

/**
 * Chrome geometry is in px, like the `--ag-*` tokens, the text sizes and the
 * row heights. Sites that set `html { font-size: 62.5% }` (a 10px root) or a
 * larger root must not shrink or grow the toolbar, paginator and header
 * actions while the text beside them stays put; the 24px WCAG 2.2 (2.5.8)
 * target sizes the stylesheets promise have to hold on any root font size.
 */
const MIN = 24;

async function mount() {
  ApexGrid.register();
  ApexGridPaginator.register();
  const parent = document.createElement('div');
  parent.style.height = '500px';
  const grid = await fixture<ApexGrid<Row>>(
    html`<apex-grid
      show-quick-filter
      .data=${data}
      .columns=${columns}
      .filtering=${{ enabled: true }}
      .pagination=${{ enabled: true, perPage: 10 }}
    ></apex-grid>`,
    { parentNode: parent }
  );
  await settle(grid);
  await waitUntil(() => {
    const headerRow = grid.renderRoot.querySelector<Element & { headers?: Element[] }>(
      ApexGridHeaderRow.tagName
    );
    return Boolean(headerRow?.headers?.length) && grid.rows.length > 0;
  }, 'the header row and body rows never rendered');
  return grid;
}

function headerActions(grid: ApexGrid<Row>): Element[] {
  const headerRow = grid.renderRoot.querySelector<Element & { headers: Element[] }>(
    ApexGridHeaderRow.tagName
  )!;
  return headerRow.headers.flatMap((header) =>
    Array.from(
      (header as Element & { renderRoot?: ShadowRoot }).renderRoot?.querySelectorAll(
        '[part~="action"]'
      ) ?? []
    )
  );
}

function paginatorButtons(grid: ApexGrid<Row>): Element[] {
  const paginator = grid.renderRoot.querySelector('apex-grid-paginator');
  return Array.from(paginator?.renderRoot?.querySelectorAll('[part~="paginator-button"]') ?? []);
}

function searchField(grid: ApexGrid<Row>): Element {
  const toolbar = grid.renderRoot.querySelector('apex-grid-toolbar');
  return toolbar!.renderRoot.querySelector('[part="search-field"]')!;
}

/** The union rect of an element and its ::before chip, which is a real target. */
function targetRect(el: Element): { width: number; height: number } {
  const rect = el.getBoundingClientRect();
  const inset = Number.parseFloat(
    getComputedStyle(el, '::before').getPropertyValue('inset-block-start') || '0'
  );
  const grow = Number.isFinite(inset) && inset < 0 ? -inset * 2 : 0;
  return { width: rect.width + grow, height: rect.height + grow };
}

/** Sizes of the chrome that used to follow the root font size. */
function chromeGeometry(grid: ApexGrid<Row>) {
  const box = (el: Element) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return [rect.width, rect.height, cs.paddingInlineStart, cs.paddingBlockStart, cs.fontSize];
  };
  return {
    paginatorButtons: paginatorButtons(grid).map(box),
    headerActions: headerActions(grid).map((el) => Object.values(targetRect(el))),
    searchField: box(searchField(grid)),
    headerRow: box(grid.renderRoot.querySelector(ApexGridHeaderRow.tagName)!),
  };
}

async function setRootFontSize(size: string) {
  document.documentElement.style.fontSize = size;
  await nextFrame();
}

describe('chrome geometry in px', () => {
  afterEach(() => {
    document.documentElement.style.fontSize = '';
    fixtureCleanup();
  });

  it('keeps paginator buttons and header actions at 24px under a 10px root', async () => {
    const grid = await mount();
    await setRootFontSize('10px');

    const buttons = paginatorButtons(grid);
    expect(buttons.length, 'found paginator buttons').to.be.greaterThan(0);
    for (const button of buttons) {
      const rect = button.getBoundingClientRect();
      expect(rect.width, 'paginator button width').to.be.at.least(MIN);
      expect(rect.height, 'paginator button height').to.be.at.least(MIN);
    }

    const actions = headerActions(grid);
    expect(actions.length, 'found header actions').to.be.greaterThan(0);
    for (const action of actions) {
      const { width, height } = targetRect(action);
      const part = action.getAttribute('part');
      expect(width, `${part} width`).to.be.at.least(MIN);
      expect(height, `${part} height`).to.be.at.least(MIN);
    }
  });

  it('keeps target sizes at their design px under a 20px root', async () => {
    const grid = await mount();
    await setRootFontSize('20px');

    for (const button of paginatorButtons(grid)) {
      const rect = button.getBoundingClientRect();
      expect(rect.width, 'paginator button width').to.equal(MIN);
      expect(rect.height, 'paginator button height').to.equal(MIN);
    }
    for (const action of headerActions(grid)) {
      const { width, height } = targetRect(action);
      expect(width, 'header action target width').to.equal(MIN);
      expect(height, 'header action target height').to.equal(MIN);
    }
    expect(searchField(grid).getBoundingClientRect().height, 'search field').to.equal(30);
  });

  it('lays the chrome out the same at a 10px, 16px and 20px root', async () => {
    const grid = await mount();
    await setRootFontSize('16px');
    const at16 = chromeGeometry(grid);
    await setRootFontSize('10px');
    const at10 = chromeGeometry(grid);
    await setRootFontSize('20px');
    const at20 = chromeGeometry(grid);

    expect(at10, '10px root').to.deep.equal(at16);
    expect(at20, '20px root').to.deep.equal(at16);
  });
});
