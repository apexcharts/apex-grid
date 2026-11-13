import { expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
import 'axe-core';
import { ApexGrid } from '../src/components/grid.js';
import { esLocale } from '../src/i18n/es.js';
import type { ColumnConfiguration } from '../src/internal/types.js';
import { settle } from './utils/settle.js';

// GitHub #40: a `type: 'sparkline'` cell names its trend. The graphic is
// role="img" with a label built from the values, and the visible delta is
// folded into that name and hidden, so it is not read twice.

interface Row {
  account: string;
  trend: unknown;
}

interface AxeResult {
  violations: { id: string; nodes: { target: string[]; failureSummary: string }[] }[];
}
const axe = (window as any).axe as { run(context: Element): Promise<AxeResult> };

async function axeViolations(el: Element): Promise<string[]> {
  const { violations } = await axe.run(el);
  return violations.flatMap(({ id, nodes }) =>
    nodes.map((node) => `${id}: ${node.target.join(' ')}: ${node.failureSummary}`)
  );
}

async function mount(
  columns: ColumnConfiguration<Row>[],
  data: Row[],
  props: Partial<ApexGrid<Row>> = {}
): Promise<ApexGrid<Row>> {
  ApexGrid.register();
  const host = document.createElement('div');
  host.style.height = '400px';
  host.style.width = '700px';
  const grid = await fixture<ApexGrid<Row>>(
    html`<apex-grid .data=${data} .columns=${columns}></apex-grid>`,
    { parentNode: host }
  );
  Object.assign(grid, props);
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

/** Text of `node`, through shadow roots. */
function deepText(node: Node): string {
  let out = node.nodeType === Node.TEXT_NODE ? (node as Text).data : '';
  const shadow = (node as Element).shadowRoot;
  if (shadow) out += deepText(shadow);
  for (const child of Array.from(node.childNodes)) out += deepText(child);
  return out;
}

/** The sparkline cell of the row whose account is `account`. */
function sparkCell(grid: ApexGrid<Row>, account: string): Element {
  for (const row of deepAll(grid).filter((el) => el.getAttribute('role') === 'row')) {
    const cells = deepAll(row).filter((el) => el.getAttribute('role') === 'gridcell');
    if (cells.length === 2 && deepText(cells[0]).trim() === account) return cells[1];
  }
  throw new Error(`no row for ${account}`);
}

function graphic(cell: Element): Element | undefined {
  return deepAll(cell).find((el) => el.getAttribute('role') === 'img');
}

function nameOf(cell: Element): string | null | undefined {
  return graphic(cell)?.getAttribute('aria-label');
}

function delta(cell: Element): Element | undefined {
  return deepAll(cell).find((el) => (el.getAttribute('part') ?? '').includes('spark-delta'));
}

const ACCOUNT: ColumnConfiguration<Row> = { key: 'account', headerText: 'Account' };
const SPARK: ColumnConfiguration<Row> = { key: 'trend', headerText: 'Trend', type: 'sparkline' };

describe('sparkline accessible name (#40)', () => {
  afterEach(() => fixtureCleanup());

  it('names the trend by default and hides the visible delta it folds in', async () => {
    const grid = await mount(
      [ACCOUNT, SPARK],
      [{ account: 'Northwind', trend: [12, 15, 14, 19, 23] }]
    );
    const cell = sparkCell(grid, 'Northwind');
    const img = graphic(cell)!;
    expect(img, 'a role="img" graphic').to.exist;
    expect(img.localName).to.equal('svg');
    expect(img.hasAttribute('aria-hidden'), 'graphic not hidden').to.be.false;
    expect(nameOf(cell)).to.equal('5 values, 12 to 23, up 92%');
    expect(delta(cell)?.textContent?.trim(), 'delta still visible').to.equal('+92%');
    expect(delta(cell)?.getAttribute('aria-hidden'), 'delta not read twice').to.equal('true');
    expect(await axeViolations(grid)).to.eql([]);
  });

  it('names the trend when showDelta is false', async () => {
    const grid = await mount(
      [ACCOUNT, { ...SPARK, showDelta: false }],
      [{ account: 'Northwind', trend: [12, 15, 14, 19, 23] }]
    );
    const cell = sparkCell(grid, 'Northwind');
    expect(delta(cell)).to.be.undefined;
    expect(nameOf(cell)).to.equal('5 values, 12 to 23, up 92%');
    expect(await axeViolations(grid)).to.eql([]);
  });

  it('reads a fall, a flat line, a rise from zero and skips gaps', async () => {
    const grid = await mount(
      [ACCOUNT, SPARK],
      [
        { account: 'down', trend: [20, 18, 15] },
        { account: 'flat', trend: [5, 7, 5] },
        { account: 'zero', trend: [0, 4] },
        { account: 'gaps', trend: [3, null, Number.NaN, 6] },
        { account: 'tiny', trend: [100, 100.2] },
      ]
    );
    expect(nameOf(sparkCell(grid, 'down'))).to.equal('3 values, 20 to 15, down 25%');
    expect(nameOf(sparkCell(grid, 'flat'))).to.equal('3 values, 5 to 5, unchanged');
    // A percent change from zero is undefined: no delta, and no percent read.
    expect(nameOf(sparkCell(grid, 'zero'))).to.equal('2 values, 0 to 4');
    expect(nameOf(sparkCell(grid, 'gaps'))).to.equal('2 values, 3 to 6, up 100%');
    // The name rounds like the visible label.
    expect(nameOf(sparkCell(grid, 'tiny'))).to.equal('2 values, 100 to 100.2, up 0%');
    expect(delta(sparkCell(grid, 'tiny'))?.textContent?.trim()).to.equal('0%');
    expect(await axeViolations(grid)).to.eql([]);
  });

  it('formats the numbers for the column locale', async () => {
    const grid = await mount(
      [ACCOUNT, { ...SPARK, locale: 'de-DE' }],
      [{ account: 'a', trend: [1234.5, 2469] }]
    );
    expect(nameOf(sparkCell(grid, 'a'))).to.equal('2 values, 1.234,5 to 2.469, up 100%');
  });

  it('takes a custom label string', async () => {
    const grid = await mount(
      [ACCOUNT, { ...SPARK, sparkline: { label: 'Weekly revenue trend' } }],
      [{ account: 'Northwind', trend: [12, 15, 14, 19, 23] }]
    );
    expect(nameOf(sparkCell(grid, 'Northwind'))).to.equal('Weekly revenue trend');
    expect(await axeViolations(grid)).to.eql([]);
  });

  it('takes a label function of the value and record, and falls back on an empty one', async () => {
    const seen: unknown[] = [];
    const grid = await mount(
      [
        ACCOUNT,
        {
          ...SPARK,
          sparkline: {
            label: (value: unknown, data: Row) => {
              seen.push(value);
              return data.account === 'blank'
                ? ''
                : `${data.account}: ${(value as number[]).length} weeks`;
            },
          },
        },
      ],
      [
        { account: 'Northwind', trend: [12, 15, 14, 19, 23] },
        { account: 'blank', trend: [4, 2] },
      ]
    );
    expect(nameOf(sparkCell(grid, 'Northwind'))).to.equal('Northwind: 5 weeks');
    expect(seen[0]).to.eql([12, 15, 14, 19, 23]);
    expect(nameOf(sparkCell(grid, 'blank')), 'empty falls back').to.equal(
      '2 values, 4 to 2, down 50%'
    );
  });

  it('follows localeText (Spanish)', async () => {
    const grid = await mount(
      [ACCOUNT, SPARK],
      [
        { account: 'up', trend: [12, 15, 14, 19, 23] },
        { account: 'down', trend: [20, 15] },
        { account: 'flat', trend: [5, 5] },
        { account: 'zero', trend: [0, 4] },
      ],
      { localeText: esLocale }
    );
    expect(nameOf(sparkCell(grid, 'up'))).to.equal('5 valores, de 12 a 23, sube un 92 %');
    expect(nameOf(sparkCell(grid, 'down'))).to.equal('2 valores, de 20 a 15, baja un 25 %');
    expect(nameOf(sparkCell(grid, 'flat'))).to.equal('2 valores, de 5 a 5, sin cambios');
    expect(nameOf(sparkCell(grid, 'zero'))).to.equal('2 valores, de 0 a 4');
    expect(await axeViolations(grid)).to.eql([]);
  });

  it('passes {min} and {max} to a localeText override', async () => {
    const grid = await mount(
      [ACCOUNT, SPARK],
      [
        { account: 'up', trend: [12, 30, 4, 23] },
        { account: 'zero', trend: [0, 9, 4] },
      ],
      {
        localeText: {
          'cell.sparkline': '{first} to {last}, low {min}, high {max}, {trend}',
          'cell.chart': '{first} to {last}, low {min}, high {max}',
        },
      }
    );
    expect(nameOf(sparkCell(grid, 'up'))).to.equal('12 to 23, low 4, high 30, up 92%');
    // A rise from zero reads cell.chart, which gets the same params.
    expect(nameOf(sparkCell(grid, 'zero'))).to.equal('0 to 4, low 0, high 9');
  });

  it('draws and names nothing for empty, single-point and all-gap values', async () => {
    const grid = await mount(
      [ACCOUNT, { ...SPARK, sparkline: { label: 'never used' } }],
      [
        { account: 'empty', trend: [] },
        { account: 'one', trend: [7] },
        { account: 'gaps', trend: [null, null] },
        { account: 'none', trend: null },
      ]
    );
    for (const row of ['empty', 'one', 'gaps', 'none']) {
      const cell = sparkCell(grid, row);
      expect(graphic(cell), `row ${row}: no unnamed or empty image`).to.be.undefined;
      expect(
        deepAll(cell).some((el) => el.localName === 'svg'),
        `row ${row}: no graphic`
      ).to.be.false;
      expect(deepText(cell).trim(), `row ${row}: blank`).to.equal('');
    }
    expect(await axeViolations(grid)).to.eql([]);
  });
});
