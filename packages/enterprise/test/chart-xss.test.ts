import { expect, fixture, fixtureCleanup, html, nextFrame, waitUntil } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { renderApexChart } from '../src/features/chart.js';
import {
  ApexGridChart,
  ApexGridEnterprise,
  type ChartModel,
  chartModelToApexOptions,
  enterpriseModules,
} from '../src/index.js';

// Cell text reaches ApexCharts as categories and series names, and ApexCharts writes the legend
// text, the tooltip title and the tooltip series label with innerHTML. These specs put markup in a
// category and a series name and assert it stays literal text in every HTML sink, while plain
// labels render exactly as before.

type Probe = { __xss?: number };
const probe = window as unknown as Probe;
const CAT = '<img src=x onerror="window.__xss=1">';
const NAME = '<img src=y onerror="window.__xss=2">';

(window as unknown as { Apex?: unknown }).Apex = { chart: { animations: { enabled: false } } };

type Fn = (value: unknown, opts?: unknown) => string;
type TooltipY = { formatter?: Fn; title?: { formatter?: Fn } };
type Opts = {
  legend?: { formatter?: Fn };
  tooltip?: { x?: { formatter?: Fn }; y?: TooltipY | TooltipY[] };
  xaxis?: { categories?: unknown[] };
  labels?: unknown[];
  series?: { name?: string }[];
};

function host() {
  const node = document.createElement('div');
  node.style.width = '600px';
  document.body.appendChild(node);
  return node;
}

/** Wait long enough for a broken <img> to fire onerror if one was ever parsed. */
const settle = () => new Promise((r) => setTimeout(r, 250));

/** Hover the first data point so ApexCharts writes the tooltip. */
async function hoverFirstPoint(root: HTMLElement) {
  await waitUntil(() => root.querySelector('.apexcharts-grid'), 'no plot');
  // Column: the middle of the first bar. Line: just inside the plot's left edge (the first point).
  const bar = root.querySelector<SVGElement>('.apexcharts-bar-area');
  const plot = (root.querySelector('.apexcharts-grid') as SVGElement).getBoundingClientRect();
  const box = bar?.getBoundingClientRect();
  const init = {
    bubbles: true,
    clientX: box ? box.left + box.width / 2 : plot.left + 5,
    clientY: box ? box.top + box.height / 2 : plot.top + plot.height / 2,
  };
  for (const el of [bar, root.querySelector('.apexcharts-svg')]) {
    el?.dispatchEvent(new MouseEvent('mousemove', init));
  }
  await waitUntil(
    () => root.querySelector('.apexcharts-tooltip-text-y-label')?.textContent,
    'tooltip never rendered'
  );
}

describe('chart-xss: cell text is never parsed as markup by the chart', () => {
  let charts: { destroy(): void }[] = [];
  let hosts: HTMLElement[] = [];
  beforeEach(() => {
    delete probe.__xss;
  });
  afterEach(() => {
    for (const c of charts) c.destroy();
    for (const h of hosts) h.remove();
    charts = [];
    hosts = [];
    fixtureCleanup();
  });

  async function render(
    model: ChartModel,
    type: 'pie' | 'column' | 'line' | 'bar',
    apexOptions?: Record<string, unknown>
  ) {
    const node = host();
    hosts.push(node);
    charts.push(await renderApexChart(node, model, { type, apexOptions }));
    return node;
  }

  it('escapes only the HTML sinks and keeps categories and series names raw', () => {
    const model: ChartModel = { categories: [CAT, 'R&D'], series: [{ name: NAME, data: [1, 2] }] };
    const opts = chartModelToApexOptions(model, { type: 'column' }) as Opts;
    // The SVG axis text and the series data stay raw (SVG text is set as text, not parsed).
    expect(opts.xaxis?.categories).to.deep.equal([CAT, 'R&D']);
    expect(opts.series?.[0].name).to.equal(NAME);
    for (const fmt of [opts.legend?.formatter, opts.tooltip?.x?.formatter]) {
      expect(fmt, 'missing escaping formatter').to.be.a('function');
      expect(String(fmt?.(CAT))).to.not.include('<');
      expect(fmt?.('R&D')).to.equal('R&D');
      expect(fmt?.('a > b')).to.equal('a > b');
    }
    const yTitle = (opts.tooltip?.y as TooltipY).title?.formatter;
    expect(String(yTitle?.(NAME))).to.not.include('<');
    expect(yTitle?.('Sales')).to.equal('Sales: ');
    expect(yTitle?.('')).to.equal('');

    const pie = chartModelToApexOptions(model, { type: 'pie' }) as Opts;
    expect(pie.labels).to.deep.equal([CAT, 'R&D']);
    expect(String(pie.legend?.formatter?.(CAT))).to.not.include('<');
    expect(String((pie.tooltip?.y as TooltipY).title?.formatter?.(CAT))).to.not.include('<');
  });

  it('escapes only a < that can open markup, so "<18" and "a < b" pass through unchanged', () => {
    const fmt = chartModelToApexOptions(
      { categories: ['A'], series: [{ name: 'S', data: [1] }] },
      { type: 'column' }
    ).legend?.formatter as Fn;
    for (const plain of ['<18', '< $50k', 'a < b', '<', 'x<', '<<', '1<2']) {
      expect(fmt(plain), plain).to.equal(plain);
    }
    const markup = [
      '<img src=x>',
      '</p>',
      '<!--x-->',
      '<?x>',
      '<<img>',
      '<IMG SRC=x>',
      '<svg/onload=1>',
    ];
    for (const value of markup) {
      // Parsed back as HTML, each is exactly one text node equal to the input.
      const probeEl = document.createElement('span');
      probeEl.innerHTML = fmt(value);
      expect(probeEl.childNodes.length, value).to.equal(1);
      expect(probeEl.textContent, value).to.equal(value);
    }
  });

  it('escapes the series name in a per-series tooltip.y array, keeping caller entries', () => {
    const unit: Fn = (v) => `${v} kg`;
    const mine: Fn = () => 'mine';
    const opts = chartModelToApexOptions(
      {
        categories: ['A'],
        series: [
          { name: NAME, data: [1] },
          { name: 'B', data: [2] },
        ],
      },
      {
        type: 'column',
        apexOptions: {
          tooltip: { y: [{ formatter: unit }, { title: { formatter: mine } }] },
        } as never,
      }
    ) as Opts;
    const [first, second] = opts.tooltip?.y as TooltipY[];
    expect(first.formatter).to.equal(unit);
    expect(first.title?.formatter?.(NAME)).to.equal(`&lt;${NAME.slice(1)}: `);
    expect(first.title?.formatter?.('Sales')).to.equal('Sales: ');
    expect(second.title?.formatter).to.equal(mine);
  });

  it('pads a short or sparse per-series tooltip.y array so every series name is escaped', () => {
    const unit: Fn = (v) => `${v} kg`;
    const model: ChartModel = {
      categories: ['A'],
      series: [
        { name: 'P', data: [1] },
        { name: NAME, data: [2] },
        { name: CAT, data: [3] },
      ],
    };
    const shortY = chartModelToApexOptions(model, {
      type: 'column',
      apexOptions: { tooltip: { y: [{ formatter: unit }] } } as never,
    }) as Opts;
    const short = shortY.tooltip?.y as TooltipY[];
    expect(short.length).to.equal(3);
    expect(short[0].formatter).to.equal(unit);
    for (const entry of short.slice(1)) expect(entry.formatter).to.equal(undefined);
    expect(short[1].title?.formatter?.(NAME)).to.equal(`&lt;${NAME.slice(1)}: `);
    expect(short[2].title?.formatter?.(CAT)).to.equal(`&lt;${CAT.slice(1)}: `);

    // A hole is skipped by Array.prototype.map, so it must be filled too.
    const sparse: TooltipY[] = [];
    sparse[1] = { formatter: unit };
    const sparseY = chartModelToApexOptions(model, {
      type: 'column',
      apexOptions: { tooltip: { y: sparse } } as never,
    }) as Opts;
    const filled = sparseY.tooltip?.y as TooltipY[];
    expect(0 in filled, 'hole left in the array').to.equal(true);
    expect(filled[0].title?.formatter?.(NAME)).to.equal(`&lt;${NAME.slice(1)}: `);
    expect(filled[1].formatter).to.equal(unit);
    expect(filled[2].title?.formatter?.(CAT)).to.equal(`&lt;${CAT.slice(1)}: `);

    // A pie indexes the array by slice, so it covers every category.
    const pieY = chartModelToApexOptions(
      { categories: ['A', 'B', CAT], series: [{ name: 'S', data: [1, 2, 3] }] },
      { type: 'pie', apexOptions: { tooltip: { y: [{ formatter: unit }] } } as never }
    ) as Opts;
    const pie = pieY.tooltip?.y as TooltipY[];
    expect(pie.length).to.equal(3);
    expect(pie[2].title?.formatter?.(CAT)).to.equal(`&lt;${CAT.slice(1)}: `);
  });

  it('keeps caller tooltip and legend options, and caller formatters win', () => {
    const value: Fn = (v) => `$${v}`;
    const mine: Fn = () => 'mine';
    const merged = chartModelToApexOptions(
      { categories: ['A'], series: [{ name: 'S', data: [1] }] },
      {
        type: 'column',
        apexOptions: {
          legend: { show: false },
          tooltip: { theme: 'dark', y: { formatter: value } },
        } as never,
      }
    ) as Opts & { legend: { show?: boolean }; tooltip: { theme?: string } };
    expect(merged.legend.show).to.equal(false);
    expect(merged.legend.formatter?.('A')).to.equal('A');
    expect(merged.tooltip.theme).to.equal('dark');
    expect((merged.tooltip.y as TooltipY).formatter).to.equal(value);
    expect((merged.tooltip.y as TooltipY).title?.formatter?.('S')).to.equal('S: ');

    const own = chartModelToApexOptions(
      { categories: ['A'], series: [{ name: 'S', data: [1] }] },
      {
        apexOptions: {
          legend: { formatter: mine },
          tooltip: { x: { formatter: mine }, y: { title: { formatter: mine } } },
        } as never,
      }
    ) as Opts;
    expect(own.legend?.formatter).to.equal(mine);
    expect(own.tooltip?.x?.formatter).to.equal(mine);
    expect((own.tooltip?.y as TooltipY).title?.formatter).to.equal(mine);

    // A datetime axis formats its tooltip title from a parsed date: left to ApexCharts.
    const dated = chartModelToApexOptions(
      { categories: ['2026-01-01'], series: [{ name: 'S', data: [1] }] },
      { type: 'line', apexOptions: { xaxis: { type: 'datetime' } } }
    ) as Opts;
    expect(dated.tooltip?.x?.formatter).to.equal(undefined);
  });

  it('a markup category in a pie legend renders as literal text and never runs', async () => {
    const node = await render(
      { categories: [CAT, 'R&D', 'C'], series: [{ name: 'Q1', data: [1, 2, 3] }] },
      'pie'
    );
    const texts = [...node.querySelectorAll('.apexcharts-legend-text')].map((e) => e.textContent);
    await settle();
    expect(node.querySelectorAll('img').length, 'legend parsed an <img>').to.equal(0);
    expect(probe.__xss, 'onerror ran').to.equal(undefined);
    expect(texts).to.deep.equal([CAT, 'R&D', 'C']);
  });

  it('a markup category and series name in a column tooltip render as text and never run', async () => {
    const node = await render(
      {
        categories: [CAT, 'B'],
        series: [
          { name: NAME, data: [10, 20] },
          { name: 'Plain', data: [5, 6] },
        ],
      },
      'column'
    );
    await hoverFirstPoint(node);
    await settle();
    expect(node.querySelectorAll('.apexcharts-tooltip img').length, 'tooltip <img>').to.equal(0);
    expect(node.querySelector('.apexcharts-tooltip-title')?.textContent).to.equal(CAT);
    const labels = [...node.querySelectorAll('.apexcharts-tooltip-text-y-label')].map(
      (e) => e.textContent
    );
    expect(labels).to.include(`${NAME}: `);
    const legend = [...node.querySelectorAll('.apexcharts-legend-text')].map((e) => e.textContent);
    expect(legend).to.deep.equal([NAME, 'Plain']);
    expect(node.querySelectorAll('img').length, 'chart parsed an <img>').to.equal(0);
    expect(probe.__xss, 'onerror ran').to.equal(undefined);
  });

  it('a markup series name past the end of a short tooltip.y array never runs on hover', async () => {
    const node = await render(
      {
        categories: ['A', 'B'],
        series: [
          { name: 'P', data: [1, 2] },
          { name: NAME, data: [2, 3] },
        ],
      },
      'column',
      { tooltip: { shared: true, intersect: false, y: [{ formatter: (v: number) => `${v} kg` }] } }
    );
    await hoverFirstPoint(node);
    await settle();
    const labels = [...node.querySelectorAll('.apexcharts-tooltip-text-y-label')].map(
      (e) => e.textContent
    );
    expect(node.querySelectorAll('.apexcharts-tooltip img').length, 'tooltip <img>').to.equal(0);
    expect(probe.__xss, 'onerror ran').to.equal(undefined);
    expect(labels).to.deep.equal(['P: ', `${NAME}: `]);
    const values = [...node.querySelectorAll('.apexcharts-tooltip-text-y-value')].map(
      (e) => e.textContent
    );
    expect(values[0]).to.equal('1 kg');
  });

  it('plain labels with & and > render exactly as before in legend and tooltip', async () => {
    const node = await render(
      {
        categories: ['R&D', 'a > b'],
        series: [
          { name: 'Q&A', data: [10, 20] },
          { name: 'Cost', data: [1, 2] },
        ],
      },
      'column'
    );
    const legend = [...node.querySelectorAll('.apexcharts-legend-text')].map((e) => e.textContent);
    expect(legend).to.deep.equal(['Q&A', 'Cost']);
    await hoverFirstPoint(node);
    expect(node.querySelector('.apexcharts-tooltip-title')?.textContent).to.equal('R&D');
    const labels = [...node.querySelectorAll('.apexcharts-tooltip-text-y-label')].map(
      (e) => e.textContent
    );
    expect(labels).to.include('Q&A: ');
    // The x axis is SVG text: still the raw category, never an escaped entity.
    const axis = [...node.querySelectorAll('.apexcharts-xaxis-label')].map((e) => e.textContent);
    expect(axis.join('|')).to.contain('R&D');
    expect(axis.join('|')).to.not.contain('&amp;');
  });

  it('a legend label with a plain < keeps its text and aria-label exactly as before', async () => {
    const node = await render(
      { categories: ['<18', '18 to 30', 'a < b'], series: [{ name: 'Ages', data: [3, 5, 2] }] },
      'pie'
    );
    const items = [...node.querySelectorAll('.apexcharts-legend-series')];
    expect(items.map((e) => e.querySelector('.apexcharts-legend-text')?.textContent)).to.deep.equal(
      ['<18', '18 to 30', 'a < b']
    );
    expect(items[0].getAttribute('aria-label')).to.equal(
      '<18, visible. Press Enter or Space to toggle.'
    );
    expect(items[2].getAttribute('aria-label')).to.equal(
      'a < b, visible. Press Enter or Space to toggle.'
    );
  });

  it('a line chart tooltip title still shows the category name, not its point index', async () => {
    const node = await render(
      { categories: ['Jan & Feb', 'Mar'], series: [{ name: 'Sales', data: [10, 20] }] },
      'line'
    );
    await hoverFirstPoint(node);
    expect(node.querySelector('.apexcharts-tooltip-title')?.textContent).to.equal('Jan & Feb');
    expect(node.querySelector('.apexcharts-tooltip-text-y-label')?.textContent).to.equal('Sales: ');
  });

  it('a markup category on a numeric x axis renders as text in the tooltip title', async () => {
    // A numeric x axis over string categories hands the raw cell text to the tooltip title.
    const node = await render(
      { categories: [CAT, 'B', 'C'], series: [{ name: 'Sales', data: [10, 20, 30] }] },
      'line',
      { xaxis: { type: 'numeric' } }
    );
    await hoverFirstPoint(node);
    await settle();
    expect(node.querySelector('.apexcharts-tooltip-title')?.textContent).to.equal(CAT);
    expect(node.querySelectorAll('img').length, 'chart parsed an <img>').to.equal(0);
    expect(probe.__xss, 'onerror ran').to.equal(undefined);
  });

  it('a horizontal bar tooltip title is the category, untouched by the value axis format', async () => {
    // The panel's number format lands on xaxis.labels for a horizontal bar (its value axis).
    const money = { xaxis: { labels: { formatter: (v: number) => `$${v}` } } };
    const node = await render(
      { categories: ['<b>A</b>', 'B'], series: [{ name: 'Sales', data: [10, 20] }] },
      'bar',
      money
    );
    await hoverFirstPoint(node);
    expect(node.querySelector('.apexcharts-tooltip-title')?.textContent).to.equal('<b>A</b>');
    expect(node.querySelectorAll('.apexcharts-tooltip b').length).to.equal(0);
  });

  describe('through the grid and the chart panel', () => {
    interface Row {
      name: string;
      q1: number;
    }
    const columns: ColumnConfiguration<Row>[] = [
      { key: 'name', type: 'string', headerText: 'Name' },
      { key: 'q1', type: 'number', headerText: 'Q1' },
    ];
    before(() => {
      ApexGridEnterprise.use(...enterpriseModules);
      ApexGridEnterprise.register();
      ApexGridChart.register();
    });

    it('a cell value used as an auto (pie) legend label renders as text, not markup', async () => {
      const parent = document.createElement('div');
      parent.style.height = '500px';
      const rows: Row[] = [
        { name: CAT, q1: 10 },
        { name: 'B', q1: 20 },
        { name: 'C', q1: 30 },
      ];
      const grid = await fixture<ApexGridEnterprise<Row>>(
        html`<apex-grid-enterprise .data=${rows} .columns=${columns}></apex-grid-enterprise>`,
        { parentNode: parent }
      );
      await grid.updateComplete;
      await nextFrame();
      const panel = await fixture<ApexGridChart>(
        html`<apex-grid-chart mode="inline" type="auto" .grid=${grid as never}></apex-grid-chart>`
      );
      await nextFrame();
      await panel.updateComplete;
      await waitUntil(() => panel.querySelector('.apexcharts-legend-text'), 'no legend', {
        timeout: 3000,
      });
      await settle();
      expect(panel.querySelectorAll('.apexcharts-legend img').length).to.equal(0);
      expect(probe.__xss).to.equal(undefined);
      expect(panel.querySelector('.apexcharts-legend-text')?.textContent).to.equal(CAT);
    });
  });
});
