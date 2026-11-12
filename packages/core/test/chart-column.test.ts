import { expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
import ApexCharts, { type ApexOptions } from 'apexcharts';
import type ApexGridCellChart from '../src/components/chart-cell.js';
import { setApexCharts } from '../src/components/chart-cell.js';
import { ApexGrid } from '../src/components/grid.js';
import { esLocale } from '../src/i18n/es.js';
import type { ColumnConfiguration } from '../src/internal/types.js';
import { settle } from './utils/settle.js';

// `type: 'chart'`: one ApexCharts chart per cell element, kept across row
// recycling. See plans/core/2026-11-12-chart-column-type.md.
//
// Module state (the registered constructor, the one-shot warning) lives for
// the page, and each test file gets its own page, so the "no ApexCharts yet"
// case runs first and registration happens inside it.

interface Row {
  id: number;
  name: string;
  trend: number[] | null;
}

/** Row `id`'s trend starts at `id`, so a chart's first point names its row. */
const records = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `Row ${i}`,
    trend: [i, i + 3, i + 1, i + 6, i + 4],
  }));

let built = 0;
let destroyed = 0;
let fullUpdates = 0;

class CountingApexCharts extends ApexCharts {
  constructor(element: HTMLElement, options: ApexOptions) {
    super(element, options);
    built++;
  }

  override destroy(): void {
    destroyed++;
    super.destroy();
  }

  override updateOptions(...args: Parameters<ApexCharts['updateOptions']>) {
    fullUpdates++;
    return super.updateOptions(...args);
  }
}

async function mount(
  columns: ColumnConfiguration<Row>[],
  data: Row[] = records(400),
  recycling = true
): Promise<ApexGrid<Row>> {
  ApexGrid.register();
  const host = document.createElement('div');
  host.style.height = '500px';
  host.style.width = '700px';
  const grid = await fixture<ApexGrid<Row>>(
    html`<apex-grid .rowRecycling=${recycling} .data=${data} .columns=${columns}></apex-grid>`,
    { parentNode: host }
  );
  await settle(grid);
  return grid;
}

function deepAll(root: Node, out: Element[] = []): Element[] {
  if (root instanceof Element) out.push(root);
  const shadow = (root as Element).shadowRoot;
  if (shadow) deepAll(shadow, out);
  for (const child of Array.from((root as ParentNode).children ?? [])) deepAll(child, out);
  return out;
}

function chartCells(grid: ApexGrid<Row>): ApexGridCellChart[] {
  return deepAll(grid).filter(
    (el): el is ApexGridCellChart => el.localName === 'apex-grid-cell-chart'
  );
}

/** The row a chart drew, read from the chart's own config. */
function drawnRow(cell: ApexGridCellChart): number {
  const chart = cell.chart as unknown as { w: { config: { series: { data: number[] }[] } } };
  return chart.w.config.series[0].data[0];
}

/** The record each rendered row shows, paired with its chart cell. */
function pairs(grid: ApexGrid<Row>): { id: number; cell: ApexGridCellChart }[] {
  const rows = deepAll(grid).filter((el) => el.localName === 'apex-grid-row') as (Element & {
    data: Row;
  })[];
  const out: { id: number; cell: ApexGridCellChart }[] = [];
  for (const row of rows) {
    const cell = deepAll(row).find((el) => el.localName === 'apex-grid-cell-chart') as
      | ApexGridCellChart
      | undefined;
    if (cell && row.data) out.push({ id: row.data.id, cell });
  }
  return out;
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const CHART: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number' },
  { key: 'name' },
  { key: 'trend', headerText: 'Trend', type: 'chart' },
];

describe("type: 'chart'", () => {
  afterEach(() => fixtureCleanup());

  it('stays empty and warns once without ApexCharts, then builds when it is given', async () => {
    const warnings: string[] = [];
    // biome-ignore lint/suspicious/noConsole: capturing the grid's one-shot diagnostic
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(String(args[0]));
    let grid: ApexGrid<Row>;
    try {
      grid = await mount(CHART, records(20));
      const cells = chartCells(grid);
      expect(cells.length).to.be.greaterThan(0);
      expect(cells.every((cell) => !cell.chart)).to.be.true;
      expect(warnings.filter((w) => w.includes("type: 'chart'"))).to.have.length(1);
    } finally {
      console.warn = original;
    }

    // No cast: the real constructor's type must be accepted as it is.
    setApexCharts(CountingApexCharts);
    await wait(50);
    for (const { id, cell } of pairs(grid)) {
      expect(cell.chart, `row ${id} built after setApexCharts`).to.exist;
      expect(drawnRow(cell)).to.equal(id);
    }
  });

  it('draws each row its own data on first paint', async () => {
    const grid = await mount(CHART);
    const list = pairs(grid);
    expect(list.length).to.be.greaterThan(5);
    for (const { id, cell } of list) expect(drawnRow(cell), `row ${id}`).to.equal(id);
  });

  it('re-points every chart after a sort without building a new one', async () => {
    const grid = await mount(CHART);
    const before = built;
    const updatesBefore = fullUpdates;
    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);
    const list = pairs(grid);
    expect(list[0].id).to.equal(399);
    for (const { id, cell } of list) expect(drawnRow(cell), `row ${id}`).to.equal(id);
    expect(built - before, 'charts built by the sort').to.equal(0);
    // A column with no `chart` settings re-points with updateSeries alone; a
    // full updateOptions per re-bind cost long tasks on a scroll.
    expect(fullUpdates - updatesBefore, 'full updates on a sort').to.equal(0);
  });

  it('keeps every chart on its own row through a scroll, building few', async () => {
    const grid = await mount(CHART);
    const before = built;
    for (let y = 0; y < grid.scrollHeight; y += 240) {
      grid.scrollTop = y;
      await settle(grid);
    }
    const list = pairs(grid);
    expect(list[list.length - 1].id).to.equal(399);
    for (const { id, cell } of list) expect(drawnRow(cell), `row ${id}`).to.equal(id);
    // Moves keep their chart; only spares re-entering the page build again.
    expect(built - before).to.be.lessThan(list.length * 2);
    expect(built - destroyed, 'charts alive').to.equal(
      chartCells(grid).filter((c) => c.chart).length
    );
  });

  it('keeps every chart on its own row with recycling off too', async () => {
    const grid = await mount(CHART, records(400), false);
    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);
    grid.scrollTop = grid.scrollHeight / 2;
    await settle(grid);
    for (const { id, cell } of pairs(grid)) expect(drawnRow(cell), `row ${id}`).to.equal(id);
  });

  it('names each chart for what it shows and keeps it out of the tab order', async () => {
    const grid = await mount(CHART, records(10));
    const [{ cell }] = pairs(grid);
    expect(cell.getAttribute('role')).to.equal('img');
    expect(cell.getAttribute('aria-label')).to.equal('5 values, 0 to 4');
    const focusable = deepAll(grid)
      .filter((el) => el.closest('apex-grid-cell-chart') || el.localName === 'apex-grid-cell-chart')
      .filter((el) => el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1');
    expect(focusable).to.have.length(0);
    const svg = cell.querySelector('svg');
    expect(svg?.getAttribute('role')).to.be.null;
  });

  it('re-labels a recycled chart, and follows localeText and a label callback', async () => {
    const grid = await mount(CHART);
    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);
    const [{ cell }] = pairs(grid);
    expect(cell.getAttribute('aria-label')).to.equal('5 values, 399 to 403');

    grid.localeText = esLocale;
    grid.columns = [...CHART];
    await settle(grid);
    expect(pairs(grid)[0].cell.getAttribute('aria-label')).to.equal('5 valores, de 399 a 403');

    grid.columns = [
      CHART[0],
      CHART[1],
      { ...CHART[2], chart: { label: (_value: unknown, data: Row) => `${data.name} trend` } },
    ];
    await settle(grid);
    expect(pairs(grid)[0].cell.getAttribute('aria-label')).to.equal('Row 399 trend');
  });

  it('merges chart.options over the defaults', async () => {
    const grid = await mount(
      [
        CHART[0],
        {
          key: 'trend',
          type: 'chart',
          chart: {
            type: 'bar',
            height: 24,
            options: { colors: ['#ff0000'], chart: { foreColor: '#123456' } },
          },
        },
      ],
      records(5)
    );
    const [{ cell }] = pairs(grid);
    const config = (cell.chart as unknown as { w: { config: Record<string, any> } }).w.config;
    expect(config.chart.type).to.equal('bar');
    expect(config.chart.height).to.equal(24);
    expect(config.chart.foreColor).to.equal('#123456');
    expect(config.chart.sparkline.enabled, 'default kept').to.be.true;
    expect(config.chart.accessibility.enabled, 'default kept').to.be.false;
    expect(config.colors).to.deep.equal(['#ff0000']);
  });

  it('applies per-row options and moves them with the record on a sort', async () => {
    const colour = (data: Row) => (data.id % 2 ? '#00aa00' : '#aa0000');
    const grid = await mount(
      [
        CHART[0],
        {
          key: 'trend',
          type: 'chart',
          chart: { options: (_value: unknown, data: Row) => ({ colors: [colour(data)] }) },
        },
      ],
      records(40)
    );
    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);
    for (const { id, cell } of pairs(grid)) {
      const config = (cell.chart as unknown as { w: { config: { colors: string[] } } }).w.config;
      expect(config.colors[0], `row ${id}`).to.equal(id % 2 ? '#00aa00' : '#aa0000');
      expect(drawnRow(cell)).to.equal(id);
    }
  });

  it('draws nothing for an empty or non-array value, and builds once data arrives', async () => {
    const data = records(3);
    data[0].trend = null;
    data[1].trend = [];
    const grid = await mount(CHART, data);
    const byId = new Map(pairs(grid).map((p) => [p.id, p.cell]));
    expect(byId.has(0)).to.be.false;
    expect(byId.has(1)).to.be.false;
    expect(byId.get(2)?.chart).to.exist;

    grid.data = records(3);
    await settle(grid);
    for (const { id, cell } of pairs(grid)) expect(drawnRow(cell), `row ${id}`).to.equal(id);
  });

  it('accepts options typed as ApexOptions', async () => {
    const options: ApexOptions = { colors: ['#123123'] };
    const perRow = (_value: unknown, data: Row): ApexOptions => ({
      colors: [`#00000${data.id % 10}`],
    });
    const columns: ColumnConfiguration<Row>[] = [
      { key: 'trend', type: 'chart', chart: { options } },
      { key: 'trend', headerText: 'Per row', type: 'chart', chart: { options: perRow } },
    ];
    const grid = await mount(columns, records(3));
    expect(chartCells(grid).length).to.equal(6);
  });

  it("builds a fresh chart when a row's options leave out a key the last row set", async () => {
    // A target line on even rows only. ApexCharts keeps a key an update leaves
    // out, so re-pointing an even row's chart at an odd row would keep the line.
    const grid = await mount(
      [
        CHART[0],
        {
          key: 'trend',
          type: 'chart',
          chart: {
            options: (_value: unknown, data: Row) =>
              data.id % 2 ? {} : { annotations: { yaxis: [{ y: data.id }] } },
          },
        },
      ],
      records(60)
    );
    const lines = (cell: ApexGridCellChart) =>
      (cell.chart as unknown as { w: { config: { annotations: { yaxis: unknown[] } } } }).w.config
        .annotations.yaxis.length;
    for (const order of ['descending', 'ascending'] as const) {
      grid.sort({ key: 'id', direction: order });
      await settle(grid);
      for (const { id, cell } of pairs(grid)) {
        expect(lines(cell), `row ${id} target lines`).to.equal(id % 2 ? 0 : 1);
        expect(drawnRow(cell)).to.equal(id);
      }
    }
  });

  it('builds a fresh chart when a row gives null for a key the last row set', async () => {
    // ApexCharts drops a null option before merging, so null clears nothing.
    const grid = await mount(
      [
        CHART[0],
        {
          key: 'trend',
          type: 'chart',
          chart: {
            options: (_value: unknown, data: Row) => ({
              annotations: data.id % 2 ? null : { yaxis: [{ y: data.id }] },
            }),
          },
        },
      ],
      records(60)
    );
    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);
    for (const { id, cell } of pairs(grid)) {
      const config = (
        cell.chart as unknown as { w: { config: { annotations: { yaxis: unknown[] } } } }
      ).w.config;
      expect(config.annotations.yaxis.length, `row ${id} target lines`).to.equal(id % 2 ? 0 : 1);
    }
  });

  it('updates in place when every row sets the same keys', async () => {
    const grid = await mount(
      [
        CHART[0],
        {
          key: 'trend',
          type: 'chart',
          chart: {
            options: (_value: unknown, data: Row) => ({
              annotations: { yaxis: [{ y: data.id }] },
              colors: [data.id % 2 ? '#00aa00' : '#aa0000'],
            }),
          },
        },
      ],
      records(60)
    );
    const before = built;
    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);
    expect(built - before, 'charts built by the sort').to.equal(0);
    for (const { id, cell } of pairs(grid)) {
      const config = configOf(cell);
      expect(config.annotations.yaxis[0].y, `row ${id}`).to.equal(id);
      expect(config.colors[0], `row ${id}`).to.equal(id % 2 ? '#00aa00' : '#aa0000');
    }
  });

  /** A chart built fresh from the cell's current state, for comparison. */
  async function freshConfig(cell: ApexGridCellChart): Promise<Record<string, any>> {
    const host = document.createElement('div');
    document.body.append(host);
    const state = cell.state as { series: unknown[]; options: object };
    const chart = new ApexCharts(host, { ...state.options, series: state.series } as ApexOptions);
    await chart.render();
    const config = JSON.parse(
      JSON.stringify((chart as unknown as { w: { config: object } }).w.config)
    );
    chart.destroy();
    host.remove();
    return config;
  }

  const configOf = (cell: ApexGridCellChart) =>
    (cell.chart as unknown as { w: { config: Record<string, any> } }).w.config;

  it("keeps a sparkline's y axis hidden when per-row options set yaxis", async () => {
    const grid = await mount(
      [
        CHART[0],
        {
          key: 'trend',
          type: 'chart',
          chart: {
            options: (_value: unknown, data: Row) => ({ yaxis: { min: 0, max: data.id + 10 } }),
          },
        },
      ],
      records(60)
    );
    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);
    for (const { id, cell } of pairs(grid)) {
      expect(
        cell.querySelectorAll('.apexcharts-yaxis-label').length,
        `row ${id} axis labels`
      ).to.equal(0);
      expect(configOf(cell).yaxis[0].max, `row ${id}`).to.equal(id + 10);
    }
  });

  it('draws a per-row chart type as a fresh chart of that type would', async () => {
    const grid = await mount(
      [
        CHART[0],
        {
          key: 'trend',
          type: 'chart',
          chart: {
            options: (_value: unknown, data: Row) => ({
              chart: { type: data.id % 2 ? 'bar' : 'line' },
            }),
          },
        },
      ],
      records(60)
    );
    grid.sort({ key: 'id', direction: 'descending' });
    await settle(grid);
    for (const { id, cell } of pairs(grid).slice(0, 8)) {
      const drawn = configOf(cell);
      const fresh = await freshConfig(cell);
      expect(drawn.chart.type, `row ${id}`).to.equal(id % 2 ? 'bar' : 'line');
      expect(JSON.stringify(drawn.stroke), `row ${id} stroke`).to.equal(
        JSON.stringify(fresh.stroke)
      );
      expect(JSON.stringify(drawn.markers), `row ${id} markers`).to.equal(
        JSON.stringify(fresh.markers)
      );
    }
  });

  it('draws pie, donut, radial bar and polar area charts from a number[]', async () => {
    interface Ring {
      id: number;
      share: number[];
    }
    const data: Ring[] = [
      { id: 0, share: [3, 5, 2] },
      { id: 1, share: [72] },
    ];
    for (const type of ['pie', 'donut', 'radialBar', 'polarArea']) {
      const grid = await mount(
        [
          { key: 'id', type: 'number' },
          { key: 'share', type: 'chart', chart: { type } },
        ] as never,
        data as never
      );
      const byId = new Map(pairs(grid).map((p) => [p.id, p.cell]));
      for (const [id, cell] of byId) {
        expect(cell.querySelectorAll('path').length, `${type} row ${id} paths`).to.be.greaterThan(
          0
        );
      }
      expect(byId.get(0)?.getAttribute('aria-label')).to.equal('3 values, 3 to 2');
      expect(byId.get(1)?.getAttribute('aria-label')).to.equal('1 value, 72');
      const cell = byId.get(0) as ApexGridCellChart;
      // No chart text (names, percentages) at row height.
      expect(cell.querySelectorAll('text').length, `${type} text`).to.equal(0);
      // Slices and rings are told apart by colour.
      const colours = (cell.chart as unknown as { w: { globals: { colors: string[] } } }).w.globals
        .colors;
      expect(new Set(colours.slice(0, 3)).size, `${type} colours`).to.equal(3);
      if (type === 'radialBar') {
        for (const ring of cell.querySelectorAll('.apexcharts-radialbar-area')) {
          const width = Number(ring.getAttribute('stroke-width'));
          expect(width, 'radialBar ring stroke width').to.be.greaterThan(0);
        }
      }
      fixtureCleanup();
    }
  });

  it('shapes the series for a chart type set inside chart.options', async () => {
    interface Ring {
      id: number;
      share: number[];
    }
    const grid = await mount(
      [
        { key: 'id', type: 'number' },
        { key: 'share', type: 'chart', chart: { options: { chart: { type: 'donut' } } } },
      ] as never,
      [{ id: 0, share: [3, 5, 2] }] as Ring[] as never
    );
    const [{ cell }] = pairs(grid);
    expect(cell.querySelectorAll('path').length).to.be.greaterThan(0);
    expect(configOf(cell).chart.type).to.equal('donut');
    expect(configOf(cell).series).to.deep.equal([3, 5, 2]);
  });

  it('gives a per-row chart type that overrides the column type its own defaults', async () => {
    interface Mixed {
      id: number;
      share: number[];
    }
    const grid = await mount(
      [
        { key: 'id', type: 'number' },
        {
          key: 'share',
          type: 'chart',
          chart: {
            type: 'bar',
            options: (_value: unknown, data: Mixed) => (data.id ? { chart: { type: 'pie' } } : {}),
          },
        },
      ] as never,
      [
        { id: 0, share: [3, 5, 2] },
        { id: 1, share: [3, 5, 2] },
      ] as Mixed[] as never
    );
    const byId = new Map(pairs(grid).map((p) => [p.id, p.cell]));
    expect(configOf(byId.get(0) as ApexGridCellChart).colors).to.deep.equal(['var(--_ag-brand)']);
    const pie = byId.get(1) as ApexGridCellChart;
    expect(configOf(pie).chart.type).to.equal('pie');
    const colours = (pie.chart as unknown as { w: { globals: { colors: string[] } } }).w.globals
      .colors;
    expect(new Set(colours.slice(0, 3)).size, 'pie slice colours').to.equal(3);
  });

  it('formats every number in the default label for the column locale', async () => {
    const grid = await mount([CHART[0], { ...CHART[2], locale: 'ar-EG' }], records(1));
    expect(pairs(grid)[0].cell.getAttribute('aria-label')).to.equal('٥ values, ٠ to ٤');
  });

  it('draws a null in a number[] as a gap, not as an empty cell', async () => {
    const data = records(2);
    data[0].trend = [0, null, 2, Number.NaN, 4] as unknown as number[];
    data[1].trend = [null, null] as unknown as number[];
    const grid = await mount(CHART, data);
    const byId = new Map(pairs(grid).map((p) => [p.id, p.cell]));
    const cell = byId.get(0);
    expect(cell?.chart, 'row with gaps is drawn').to.exist;
    const series = (cell?.chart as unknown as { w: { config: { series: { data: unknown[] }[] } } })
      .w.config.series[0].data;
    expect(series).to.deep.equal([0, null, 2, null, 4]);
    expect(cell?.getAttribute('aria-label')).to.equal('3 values, 0 to 4');
    expect(byId.has(1), 'a row of gaps only draws nothing').to.be.false;
  });

  it('draws nothing for series of gaps only, and counts only real points', async () => {
    interface Multi {
      id: number;
      trend: unknown;
    }
    const data: Multi[] = [
      { id: 0, trend: [{ data: [null, null, null] }] },
      {
        id: 1,
        trend: [
          {
            data: [
              { x: 'a', y: [1, 3] },
              { x: 'b', y: null },
              { x: 'c', y: [2, 5] },
            ],
          },
        ],
      },
    ];
    const grid = await mount(
      [
        { key: 'id', type: 'number' },
        { key: 'trend', type: 'chart', chart: { type: 'rangeBar' } },
      ] as never,
      data as never
    );
    const byId = new Map(pairs(grid).map((p) => [p.id, p.cell]));
    expect(byId.has(0), 'series of gaps only').to.be.false;
    expect(byId.get(1)?.getAttribute('aria-label')).to.equal('2 values');
  });

  it('names every series, and range points, in the default label', async () => {
    interface Multi {
      id: number;
      trend: unknown;
    }
    const data: Multi[] = [
      {
        id: 0,
        trend: [{ name: 'Revenue', data: [10, 14, 20] }, { data: [8, 9, 30] }],
      },
      {
        id: 1,
        trend: [
          {
            data: [
              { x: 'a', y: [1, 3] },
              { x: 'b', y: [2, 5] },
            ],
          },
        ],
      },
    ];
    const grid = await mount(
      [
        { key: 'id', type: 'number' },
        { key: 'trend', type: 'chart', chart: { type: 'rangeBar' } },
      ] as never,
      data as never
    );
    const byId = new Map(pairs(grid).map((p) => [p.id, p.cell]));
    expect(byId.get(0)?.getAttribute('aria-label')).to.equal(
      'Revenue: 3 values, 10 to 20; Series 2: 3 values, 8 to 30'
    );
    expect(byId.get(1)?.getAttribute('aria-label')).to.equal('2 values');
  });

  it('falls back to the default name when the label callback returns nothing', async () => {
    const grid = await mount([CHART[0], { ...CHART[2], chart: { label: () => '' } }], records(3));
    expect(pairs(grid)[0].cell.getAttribute('aria-label')).to.equal('5 values, 0 to 4');
  });

  it('destroys the charts of rows that leave the page', async () => {
    const grid = await mount(CHART, records(30));
    const alive = () => built - destroyed;
    expect(alive()).to.equal(chartCells(grid).filter((c) => c.chart).length);
    grid.data = records(2);
    await settle(grid);
    await wait(20);
    expect(alive()).to.equal(2);
    grid.remove();
    await wait(20);
    expect(alive()).to.equal(0);
  });
});
