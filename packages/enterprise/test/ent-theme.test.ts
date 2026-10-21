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
import { ApexGridChart, ApexGridEnterprise, enterpriseModules } from '../src/index.js';

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
});

function rgbOfString(color: string) {
  const [r, g, b] = rgbOf(color.trim());
  return `rgb(${r}, ${g}, ${b})`;
}
