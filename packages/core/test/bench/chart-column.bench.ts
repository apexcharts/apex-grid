import { fixture, fixtureCleanup, html } from '@open-wc/testing';
import { setViewport } from '@web/test-runner-commands';
import ApexCharts, { type ApexOptions } from 'apexcharts';
import { keyed } from 'lit/directives/keyed.js';
import { setApexCharts } from '../../src/components/chart-cell.js';
import { ApexGrid } from '../../src/components/grid.js';
import type { ColumnConfiguration } from '../../src/internal/types.js';
import { settle } from '../utils/settle.js';

/**
 * Chart column benchmark: what a chart per row costs over one scroll to the
 * bottom of 1,000 rows and back, with row recycling on. Manual only, never a
 * CI gate on wall time:
 *
 *   npm run bench:chart
 *
 * Variants:
 *   chart    `type: 'chart'`
 *   keyed    a cell template that builds a chart on connect and destroys it on
 *            disconnect, wrapped in `keyed(ctx.data, ...)` so a recycled row
 *            gets a new element
 *   connect  the same template without `keyed`
 *
 * Each prints one `BENCH <json>` line: charts built and destroyed, charts
 * alive against chart elements in the DOM, rows whose chart draws another
 * row's data, and long tasks (over 50 ms) during the scroll.
 */

const ROWS = 1_000;
const VIEWPORT = { width: 1000, height: 700 };
/** Pixels per scroll step down, then per step back up, one frame apart. */
const STEP_DOWN = 240;
const STEP_UP = 2400;

interface Row {
  id: number;
  name: string;
  trend: number[];
}

/** Row `id`'s trend starts at `id`, so a chart's first point names its row. */
const rows: Row[] = Array.from({ length: ROWS }, (_, i) => ({
  id: i,
  name: `Account ${i}`,
  trend: Array.from({ length: 12 }, (_, m) => i + ((m * 7) % 5)),
}));

const stats = { built: 0, destroyed: 0 };

class CountingApexCharts extends ApexCharts {
  constructor(element: HTMLElement, options: ApexOptions) {
    super(element, options);
    stats.built++;
  }

  override destroy(): void {
    stats.destroyed++;
    super.destroy();
  }
}

/** The usual hand-written cell element: build on connect, destroy on disconnect. */
class BenchConnectChart extends HTMLElement {
  series: number[] = [];
  chart?: ApexCharts;

  connectedCallback() {
    this.chart = new CountingApexCharts(this, {
      chart: {
        type: 'line',
        height: 28,
        sparkline: { enabled: true },
        animations: { enabled: false },
      },
      series: [{ data: this.series }],
    });
    void this.chart.render();
  }

  disconnectedCallback() {
    this.chart?.destroy();
    this.chart = undefined;
  }
}
customElements.define('bench-connect-chart', BenchConnectChart);

const TREND: Record<string, ColumnConfiguration<Row>> = {
  chart: { key: 'trend', headerText: 'Trend', type: 'chart' },
  keyed: {
    key: 'trend',
    headerText: 'Trend',
    cellTemplate: (ctx) =>
      keyed(ctx.data, html`<bench-connect-chart .series=${ctx.value}></bench-connect-chart>`),
  },
  connect: {
    key: 'trend',
    headerText: 'Trend',
    cellTemplate: (ctx) => html`<bench-connect-chart .series=${ctx.value}></bench-connect-chart>`,
  },
};

function deepAll(root: Node, out: Element[] = []): Element[] {
  if (root instanceof Element) out.push(root);
  const shadow = (root as Element).shadowRoot;
  if (shadow) deepAll(shadow, out);
  for (const child of Array.from((root as ParentNode).children ?? [])) deepAll(child, out);
  return out;
}

const CHART_TAGS = new Set(['apex-grid-cell-chart', 'bench-connect-chart']);

/** Chart elements in the DOM, and rendered rows whose chart draws another row. */
function audit(grid: ApexGrid<Row>) {
  let checked = 0;
  let wrong = 0;
  for (const row of deepAll(grid).filter((el) => el.localName === 'apex-grid-row')) {
    const data = (row as Element & { data?: Row }).data;
    const host = deepAll(row).find((el) => CHART_TAGS.has(el.localName)) as
      | (Element & { chart?: { w: { config: { series: { data: number[] }[] } } } })
      | undefined;
    if (!data || !host?.chart) continue;
    checked++;
    if (host.chart.w.config.series[0].data[0] !== data.id) wrong++;
  }
  const elements = deepAll(grid).filter((el) => CHART_TAGS.has(el.localName)).length;
  return { rowsChecked: checked, wrongRows: wrong, chartElements: elements };
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 16)));
}

function scroller(grid: ApexGrid<Row>): Element {
  const found = deepAll(grid).find(
    (el) => el.scrollHeight > el.clientHeight + 50 && getComputedStyle(el).overflowY !== 'visible'
  );
  if (!found) throw new Error('no scroll container');
  return found;
}

describe('chart column benchmark', () => {
  before(async () => {
    await setViewport(VIEWPORT);
    ApexGrid.register();
    setApexCharts(CountingApexCharts);
  });

  afterEach(async () => {
    fixtureCleanup();
    // Let the last variant's charts finish tearing down before the next counts.
    await new Promise((resolve) => setTimeout(resolve, 50));
    stats.built = 0;
    stats.destroyed = 0;
  });

  for (const variant of Object.keys(TREND)) {
    it(variant, async () => {
      const host = document.createElement('div');
      host.style.height = `${VIEWPORT.height}px`;
      host.style.width = '900px';
      const grid = await fixture<ApexGrid<Row>>(
        html`<apex-grid
          .data=${rows}
          .columns=${[
            { key: 'id', headerText: 'Id', type: 'number', width: '80px' },
            { key: 'name', headerText: 'Account', width: '200px' },
            TREND[variant],
          ]}
        ></apex-grid>`,
        { parentNode: host }
      );
      await settle(grid);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const firstPaint = stats.built;

      const longTasks: number[] = [];
      const observer = new PerformanceObserver((list) =>
        longTasks.push(...list.getEntries().map((entry) => entry.duration))
      );
      observer.observe({ type: 'longtask', buffered: false });

      const scroll = scroller(grid);
      const started = performance.now();
      for (let y = 0; y < scroll.scrollHeight; y += STEP_DOWN) {
        scroll.scrollTop = y;
        await frame();
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      for (let y = scroll.scrollHeight; y > 0; y -= STEP_UP) {
        scroll.scrollTop = y;
        await frame();
      }
      scroll.scrollTop = 0;
      await new Promise((resolve) => setTimeout(resolve, 400));
      observer.disconnect();

      const end = audit(grid);
      // biome-ignore lint/suspicious/noConsole: the benchmark's output
      console.log(
        `BENCH ${JSON.stringify({
          variant,
          rows: ROWS,
          builtFirstPaint: firstPaint,
          built: stats.built,
          destroyed: stats.destroyed,
          alive: stats.built - stats.destroyed,
          ...end,
          longTasks: longTasks.length,
          longTaskMs: Math.round(longTasks.reduce((a, b) => a + b, 0)),
          ms: Math.round(performance.now() - started),
        })}`
      );
    });
  }
});
