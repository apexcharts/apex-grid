import {
  expect,
  fixture,
  fixtureCleanup,
  html,
  nextFrame,
  oneEvent,
  waitUntil,
} from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { render } from 'lit';
import {
  ConversationMemory,
  createAIEngine,
  createContextBuilder,
  createFakeGridApi,
} from '../src/features/ai/index.js';
import { ApexGridChart, ApexGridEnterprise, enterpriseModules } from '../src/index.js';
import { rows as aiRows, enterpriseSchema } from './ai-fixtures.js';

// Enterprise chrome follows the grid: chart panel and dialog surfaces, the
// body-portaled context menu (colours and direction), the group chevrons'
// motion tokens, and the AI pin side under RTL.

interface Row {
  name: string;
  q1: number;
}
const data: Row[] = [
  { name: 'A', q1: 10 },
  { name: 'B', q1: 20 },
  { name: 'C', q1: 30 },
];
const columns: ColumnConfiguration<Row>[] = [
  { key: 'name', type: 'string', headerText: 'Name' },
  { key: 'q1', type: 'number', headerText: 'Q1' },
];

(window as unknown as { Apex?: unknown }).Apex = { chart: { animations: { enabled: false } } };

function rgbOf(color: string): [number, number, number] {
  const probe = document.createElement('div');
  probe.style.color = color;
  document.body.appendChild(probe);
  const out = getComputedStyle(probe).color;
  probe.remove();
  const m = out.match(/\d+(\.\d+)?/g)!.map(Number);
  return [m[0], m[1], m[2]];
}
function luminance([r, g, b]: [number, number, number]) {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: string, b: string) {
  const la = luminance(rgbOf(a));
  const lb = luminance(rgbOf(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '500px';
  return node;
}

async function mountGrid(attrs: { theme?: string; dir?: string; style?: string } = {}) {
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise
      theme=${attrs.theme ?? ''}
      dir=${attrs.dir ?? 'ltr'}
      style=${attrs.style ?? ''}
      .data=${data.map((r) => ({ ...r }))}
      .columns=${columns}
    ></apex-grid-enterprise>`,
    { parentNode: sizedParent() }
  );
  await grid.updateComplete;
  const scroll = (grid as unknown as { scrollContainer?: { layoutComplete?: Promise<unknown> } })
    .scrollContainer;
  await scroll?.layoutComplete;
  await nextFrame();
  return grid;
}

/** An inline chart panel bound to `grid`, mounted on the body (outside the grid's cascade). */
async function inlinePanel(grid: ApexGridEnterprise<Row>) {
  const panel = document.createElement('apex-grid-chart') as ApexGridChart;
  panel.setAttribute('mode', 'inline');
  const created = oneEvent(panel, 'apex-chart-created');
  (panel as unknown as { grid: unknown }).grid = grid;
  document.body.appendChild(panel);
  await created;
  await waitUntil(() => !!panel.querySelector('.apexcharts-legend-text'), 'chart text', {
    timeout: 3000,
  });
  return panel;
}

const part = (root: Element, name: string) => root.querySelector<HTMLElement>(`[part="${name}"]`)!;

describe('ent-theme: enterprise chrome follows the grid', () => {
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

  describe('chart panel (sweep-drift-duplication-2, ent-chart-panel-a-1)', () => {
    it('draws an inline panel on a dark grid with readable chart text', async () => {
      const grid = await mountGrid({ theme: 'dark' });
      const panel = await inlinePanel(grid);
      const label = panel.querySelector<HTMLElement>('.apexcharts-legend-text')!;
      const surface = getComputedStyle(part(panel, 'panel')).backgroundColor;
      const text = getComputedStyle(label).color;
      expect(contrast(text, surface), `${text} on ${surface}`).to.be.at.least(4.5);
      // The chrome is the grid's own surface, not a fixed white.
      expect(surface).to.equal(
        rgbOfString(getComputedStyle(grid).getPropertyValue('--_ag-surface'))
      );
      // The toolbar buttons and popovers read the same tokens.
      const button = part(panel, 'export-button');
      expect(
        contrast(getComputedStyle(button).color, getComputedStyle(button).backgroundColor)
      ).to.be.at.least(4.5);
      const menu = part(panel, 'export-menu');
      expect(getComputedStyle(menu).backgroundColor).to.equal(surface);
    });

    it('gives a dark grid a dark chart (hex surface token)', async () => {
      const grid = await mountGrid({ theme: 'dark' });
      const panel = await inlinePanel(grid);
      const canvas = panel.querySelector('.apexcharts-canvas')!;
      expect(canvas.classList.contains('apexcharts-theme-dark'), canvas.className).to.equal(true);
    });

    for (const surface of ['#111', '#111f', '#111111', '#111111ff', 'rgb(17, 17, 17)']) {
      it(`reads ${surface} as a dark surface`, async () => {
        const grid = await mountGrid({ style: `--ag-surface: ${surface}` });
        const panel = await inlinePanel(grid);
        const canvas = panel.querySelector('.apexcharts-canvas')!;
        expect(canvas.className).to.contain('apexcharts-theme-dark');
      });
    }

    it('keeps a light grid light', async () => {
      const grid = await mountGrid();
      const panel = await inlinePanel(grid);
      expect(panel.querySelector('.apexcharts-canvas')!.className).to.contain(
        'apexcharts-theme-light'
      );
      expect(getComputedStyle(part(panel, 'panel')).backgroundColor).to.equal('rgb(255, 255, 255)');
    });

    it('follows a grid that turns dark after the panel bound', async () => {
      const grid = await mountGrid();
      const panel = await inlinePanel(grid);
      grid.setAttribute('theme', 'dark');
      await grid.updateComplete;
      panel.type = 'bar';
      await waitUntil(
        () => panel.querySelector('.apexcharts-canvas')?.className.includes('theme-dark'),
        'redrawn dark',
        { timeout: 3000 }
      );
      const surface = getComputedStyle(part(panel, 'panel')).backgroundColor;
      expect(surface).to.not.equal('rgb(255, 255, 255)');
    });

    /** The x-axis label fill and the panel surface, once the chart has drawn axis text. */
    async function labelOnSurface(panel: ApexGridChart) {
      await waitUntil(() => !!panel.querySelector('.apexcharts-xaxis-label'), 'axis text', {
        timeout: 3000,
      });
      const label = panel.querySelector<SVGElement>('.apexcharts-xaxis-label')!;
      return {
        fill: getComputedStyle(label).fill,
        surface: getComputedStyle(part(panel, 'panel')).backgroundColor,
      };
    }

    it('keeps a forced light chart on a light panel beside a dark grid', async () => {
      const grid = await mountGrid({ theme: 'dark' });
      const panel = await inlinePanel(grid);
      panel.theme = 'light';
      panel.type = 'bar';
      await waitUntil(
        () => panel.querySelector('.apexcharts-canvas')?.className.includes('theme-light'),
        'redrawn light',
        { timeout: 3000 }
      );
      const { fill, surface } = await labelOnSurface(panel);
      expect(surface).to.equal('rgb(255, 255, 255)');
      expect(contrast(fill, surface), `${fill} on ${surface}`).to.be.at.least(4.5);
      // Nothing the panel carried from the dark grid is left behind.
      expect(panel.style.getPropertyValue('--_ag-surface')).to.equal('');
    });

    it('gives a forced dark chart a dark panel beside a light grid', async () => {
      const grid = await mountGrid();
      const panel = await inlinePanel(grid);
      panel.theme = 'dark';
      panel.type = 'bar';
      await waitUntil(
        () => panel.querySelector('.apexcharts-canvas')?.className.includes('theme-dark'),
        'redrawn dark',
        { timeout: 3000 }
      );
      const { fill, surface } = await labelOnSurface(panel);
      expect(surface).to.not.equal('rgb(255, 255, 255)');
      expect(contrast(fill, surface), `${fill} on ${surface}`).to.be.at.least(4.5);
      const button = part(panel, 'export-button');
      expect(
        contrast(getComputedStyle(button).color, getComputedStyle(button).backgroundColor)
      ).to.be.at.least(4.5);
    });

    it('themes an empty selection panel before anything is charted', async () => {
      const grid = await mountGrid({ theme: 'dark' });
      const panel = document.createElement('apex-grid-chart') as ApexGridChart;
      panel.setAttribute('mode', 'inline');
      panel.source = 'selection';
      (panel as unknown as { grid: unknown }).grid = grid;
      document.body.appendChild(panel);
      await panel.updateComplete;
      expect(panel.querySelector('.apexcharts-canvas'), 'nothing drawn yet').to.equal(null);
      expect(getComputedStyle(part(panel, 'panel')).backgroundColor).to.equal(
        rgbOfString(getComputedStyle(grid).getPropertyValue('--_ag-surface'))
      );
    });

    it('draws the Create chart dialog of a dark grid with readable chart text', async () => {
      const grid = await mountGrid({ theme: 'dark' });
      grid.selectRange({ row: 0, column: 'name' }, { row: 2, column: 'q1' });
      grid.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'F1', altKey: true, bubbles: true, composed: true })
      );
      const panel = document.querySelector('apex-grid-chart') as ApexGridChart;
      expect(panel, 'dialog opened').to.exist;
      await waitUntil(() => !!panel.querySelector('.apexcharts-canvas'), 'chart', {
        timeout: 3000,
      });
      const canvas = panel.querySelector('.apexcharts-canvas')!;
      expect(canvas.className).to.contain('apexcharts-theme-dark');
      const selector = '.apexcharts-xaxis-label, .apexcharts-legend-text';
      await waitUntil(() => !!panel.querySelector(selector), 'chart text', { timeout: 3000 });
      const label = panel.querySelector<Element>(selector)!;
      const surface = getComputedStyle(part(panel, 'panel')).backgroundColor;
      const style = getComputedStyle(label);
      const fill = label instanceof SVGElement ? style.fill : style.color;
      expect(contrast(fill, surface), `${fill} on ${surface}`).to.be.at.least(4.5);
    });
  });

  describe('context menu (ent-context-menu-8, ent-context-menu-7)', () => {
    function cellOf(grid: ApexGridEnterprise<Row>, rowIndex: number, key: keyof Row) {
      for (const row of grid.rows) {
        if (row.index !== rowIndex) continue;
        return row.cells.find((c) => String(c.column.key) === key) as unknown as HTMLElement;
      }
      return undefined as unknown as HTMLElement;
    }
    function rightClick(el: HTMLElement, x = 200, y = 60) {
      el.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          composed: true,
          cancelable: true,
          clientX: x,
          clientY: y,
        })
      );
    }
    const menus = () => [...document.querySelectorAll<HTMLElement>('.apex-grid-context-menu')];
    const button = (label: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('.apex-grid-context-menu .agcm-item')].find(
        (b) => b.textContent?.replace(/[›‹]/g, '').trim() === label
      )!;
    const key = (target: HTMLElement, name: string) =>
      target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));

    async function withSubmenu(dir: string) {
      const grid = await mountGrid({ dir });
      grid.contextMenu = {
        items: [
          { id: 'one', label: 'One', run: () => undefined },
          {
            id: 'more',
            label: 'More',
            submenu: [
              { id: 'a', label: 'Sub A', run: () => undefined },
              { id: 'b', label: 'Sub B', run: () => undefined },
            ],
          },
        ],
      };
      await grid.updateComplete;
      rightClick(cellOf(grid, 0, 'q1'));
      return grid;
    }

    it('paints the menu from a dark grid theme', async () => {
      const grid = await mountGrid({ theme: 'dark' });
      rightClick(cellOf(grid, 0, 'q1'));
      const [menu] = menus();
      const bg = getComputedStyle(menu).backgroundColor;
      expect(bg).to.not.equal('rgb(255, 255, 255)');
      const item = menu.querySelector<HTMLElement>('.agcm-item')!;
      expect(contrast(getComputedStyle(item).color, bg)).to.be.at.least(4.5);
    });

    it('takes the grid direction when only the grid is rtl', async () => {
      await withSubmenu('rtl');
      const [menu] = menus();
      expect(document.documentElement.dir || 'ltr').to.equal('ltr');
      expect(getComputedStyle(menu).direction).to.equal('rtl');
    });

    it('flies a submenu out to the inline end side under rtl', async () => {
      await withSubmenu('rtl');
      const parent = button('More');
      parent.focus();
      key(menus()[0], 'ArrowLeft');
      expect(menus().length, 'ArrowLeft opens under rtl').to.equal(2);
      const sub = menus()[1];
      const parentRect = parent.getBoundingClientRect();
      const subRect = sub.getBoundingClientRect();
      expect(subRect.right).to.be.at.most(parentRect.left + 1);
      key(sub, 'ArrowRight');
      expect(menus().length, 'ArrowRight closes under rtl').to.equal(1);
      expect(document.activeElement).to.equal(parent);
    });

    it('ArrowRight on the root menu closes it under rtl, as ArrowLeft does under ltr', async () => {
      await withSubmenu('rtl');
      button('More').focus();
      key(menus()[0], 'ArrowRight');
      expect(menus().length).to.equal(0);
    });

    it('opens the submenu to the right when an rtl menu has no room on its left', async () => {
      await withSubmenu('rtl');
      const root = menus()[0];
      root.style.left = '4px';
      const parent = button('More');
      parent.focus();
      key(root, 'ArrowLeft');
      expect(menus().length).to.equal(2);
      expect(menus()[1].getBoundingClientRect().left).to.be.at.least(
        parent.getBoundingClientRect().right - 1
      );
    });

    it('keeps ltr keys and the right-hand flyout', async () => {
      await withSubmenu('ltr');
      const parent = button('More');
      parent.focus();
      key(menus()[0], 'ArrowRight');
      expect(menus().length).to.equal(2);
      expect(menus()[1].getBoundingClientRect().left).to.be.at.least(
        parent.getBoundingClientRect().right - 1
      );
      expect(getComputedStyle(menus()[0]).direction).to.equal('ltr');
      key(menus()[1], 'ArrowLeft');
      expect(menus().length).to.equal(1);
    });
  });

  describe('motion tokens (core-styles-body-9)', () => {
    it('group chevrons take the grid duration tokens', async () => {
      const grid = await fixture<ApexGridEnterprise<Row>>(
        html`<apex-grid-enterprise
          style="--ag-dur-med: 0ms"
          .data=${data.map((r) => ({ ...r }))}
          .columns=${columns}
          .groupBy=${['name']}
        ></apex-grid-enterprise>`,
        { parentNode: sizedParent() }
      );
      await grid.updateComplete;
      await nextFrame();
      const grouping = (
        grid as unknown as { stateController: { modules: Map<string, unknown> } }
      ).stateController.modules.get('grouping') as {
        presentRow(row: unknown, ctx: unknown): { content: unknown } | null;
      };
      const header = (grid.pageItems as readonly Row[])[0];
      const presented = grouping.presentRow(header, { columns, rowIndex: 0 });
      const host = document.createElement('div');
      // Inherit the grid's resolved tokens, as the rendered row does.
      host.style.setProperty(
        '--_ag-dur-med',
        getComputedStyle(grid).getPropertyValue('--_ag-dur-med')
      );
      document.body.appendChild(host);
      try {
        render(presented!.content, host);
        const svg = host.querySelector<SVGElement>('[part="group-toggle"] svg')!;
        expect(svg.style.transition).to.contain('var(--_ag-dur-med)');
        expect(getComputedStyle(svg).transitionDuration).to.equal('0s');
      } finally {
        host.remove();
      }
    });
  });

  describe('AI pin side (ent-ai-entities-12)', () => {
    it('pins "to the left" at the physical left of an rtl grid', async () => {
      const grid = await mountGrid({ dir: 'rtl' });
      await grid.runPrompt('pin name to the left');
      await grid.updateComplete;
      expect(grid.columns.find((c) => c.key === 'name')?.pinned).to.equal('end');
      await grid.runPrompt('pin q1 to the right');
      await grid.updateComplete;
      expect(grid.columns.find((c) => c.key === 'q1')?.pinned).to.equal('start');
    });

    it('keeps logical start and end in an rtl grid', async () => {
      const grid = await mountGrid({ dir: 'rtl' });
      await grid.runPrompt('pin name to the start');
      await grid.updateComplete;
      expect(grid.columns.find((c) => c.key === 'name')?.pinned).to.equal('start');
    });

    it('lets a fake grid api report rtl to the context and the pin rule', async () => {
      const api = createFakeGridApi({ schema: enterpriseSchema, data: aiRows, direction: 'rtl' });
      expect(api.getDirection?.()).to.equal('rtl');
      const ctx = createContextBuilder().build(api, new ConversationMemory());
      expect(ctx.direction).to.equal('rtl');
      await createAIEngine(api).runPrompt('pin region to the left');
      expect(JSON.stringify(api.calls)).to.contain('"end"');
      const plain = createFakeGridApi({ schema: enterpriseSchema, data: aiRows });
      expect(plain.getDirection).to.equal(undefined);
    });

    it('keeps left as start in an ltr grid', async () => {
      const grid = await mountGrid();
      await grid.runPrompt('pin name to the left');
      await grid.updateComplete;
      expect(grid.columns.find((c) => c.key === 'name')?.pinned).to.equal('start');
    });
  });
});

function rgbOfString(color: string) {
  const [r, g, b] = rgbOf(color.trim());
  return `rgb(${r}, ${g}, ${b})`;
}
