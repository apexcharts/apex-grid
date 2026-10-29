import { expect, fixture, fixtureCleanup, html, nextFrame, waitUntil } from '@open-wc/testing';
import { emulateMedia } from '@web/test-runner-commands';
import type ApexGridCell from '../src/components/cell.js';
import { ApexGrid } from '../src/components/grid.js';
import type ApexGridRow from '../src/components/row.js';
import type { ColumnConfiguration } from '../src/internal/types.js';

/**
 * Rendered checks for the body row and cell stylesheets: pinned fills, zebra
 * parity, the dark renderer palette, the RTL accent bar and the forced-colors
 * rules. The forced-colors cases run under emulated `forced-colors: active`
 * and read computed styles, so they test what the system actually paints, not
 * only that a rule exists in the compiled CSS.
 */

interface Row {
  id: number;
  name: string;
  amount: number;
  active: boolean;
  plan: string;
  tier: string;
  vip: string;
  health: number;
  state: string;
}

const data: Row[] = Array.from({ length: 300 }, (_, id) => ({
  id,
  name: `Row ${id}`,
  amount: id * 10,
  active: id % 2 === 0,
  plan: 'Pro',
  tier: 'Free',
  vip: 'Gold',
  health: 50,
  state: 'active',
}));

// No transitions, so computed colours are the end state, not a frame of it.
const STILL = '--ag-dur-fast: 0ms; --ag-dur-med: 0ms; --ag-dur-slow: 0ms;';

async function mount(
  columns: ColumnConfiguration<Row>[],
  opts: { dir?: string; style?: string; theme?: string; selection?: boolean } = {}
) {
  ApexGrid.register();
  const parent = document.createElement('div');
  parent.style.height = '500px';
  parent.style.width = '800px';
  if (opts.dir) parent.dir = opts.dir;
  const grid = await fixture<ApexGrid<Row>>(
    html`<apex-grid
      style=${STILL + (opts.style ?? '')}
      theme=${opts.theme ?? ''}
      .data=${data}
      .columns=${columns}
      .selection=${opts.selection ? { enabled: true, mode: 'multiple', showCheckboxColumn: true } : undefined}
    ></apex-grid>`,
    { parentNode: parent }
  );
  await grid.updateComplete;
  await nextFrame();
  await waitUntil(() => grid.rows.length > 0, 'rows never rendered');
  await Promise.all(grid.rows.map((row) => row.updateComplete));
  return grid;
}

function bodyRows(grid: ApexGrid<Row>): ApexGridRow<Row>[] {
  const v = grid.renderRoot.querySelector('apex-virtualizer')!;
  return Array.from(v.querySelectorAll<ApexGridRow<Row>>(':scope > apex-grid-row'));
}

function rowAt(grid: ApexGrid<Row>, index: number) {
  const row = bodyRows(grid).find((r) => r.index === index);
  if (!row) throw new Error(`row ${index} is not rendered`);
  return row;
}

function cellOf(row: ApexGridRow<Row>, key: keyof Row): ApexGridCell<Row> {
  const cell = row.cells.find((c) => c.column.key === key);
  if (!cell) throw new Error(`no ${key} cell`);
  return cell;
}

function part(cell: Element, name: string) {
  const node = cell.shadowRoot!.querySelector<HTMLElement>(`[part~='${name}']`);
  if (!node) throw new Error(`no ${name} part`);
  return node;
}

const cs = (el: Element) => getComputedStyle(el);

type RGBA = [number, number, number, number];

/** Parses a computed colour: `rgb()`, `rgba()` or `color(srgb ...)`. */
function parse(value: string): RGBA {
  const srgb = value.match(/color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)/);
  if (srgb) {
    return [+srgb[1] * 255, +srgb[2] * 255, +srgb[3] * 255, srgb[4] === undefined ? 1 : +srgb[4]];
  }
  const rgb = value.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/);
  if (!rgb) throw new Error(`cannot parse colour ${value}`);
  return [+rgb[1], +rgb[2], +rgb[3], rgb[4] === undefined ? 1 : +rgb[4]];
}

function over(top: RGBA, bottom: RGBA): RGBA {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1) as RGBA;
}

function luminance([r, g, b]: RGBA) {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: RGBA, b: RGBA) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The first colour stop of a computed `linear-gradient(...)`. */
function firstStop(image: string) {
  const m = image.match(/(rgba?\([^)]*\)|color\(srgb [^)]*\))/);
  if (!m) throw new Error(`no colour stop in ${image}`);
  return m[1];
}

async function forcedColors(on: boolean) {
  await emulateMedia({ forcedColors: on ? 'active' : 'none' } as never);
  await nextFrame();
}

describe('Body styles', () => {
  afterEach(async () => {
    await forcedColors(false);
    fixtureCleanup();
  });

  describe('decoration fills on pinned cells', () => {
    const columns: ColumnConfiguration<Row>[] = [
      { key: 'id', type: 'number', pinned: 'start', width: '120px' },
      { key: 'name', width: '400px' },
      { key: 'amount', type: 'number', width: '400px' },
    ];

    for (const [attr, value] of [
      ['data-range', 'selected'],
      ['data-range', 'active'],
      ['data-formula-ref', '0'],
      ['data-formula-pointer', ''],
    ] as const) {
      it(`${attr}="${value}" keeps the pinned cell opaque under the tint`, async () => {
        const grid = await mount(columns);
        const row = rowAt(grid, 0);
        const pinned = cellOf(row, 'id');
        const plain = cellOf(row, 'name');
        const rowBg = cs(row).backgroundColor;
        expect(cs(pinned).position).to.equal('sticky');

        pinned.setAttribute(attr, value);
        plain.setAttribute(attr, value);

        // The opaque row colour stays under the fill, so scrolled cells never
        // show through the frozen column.
        expect(cs(pinned).backgroundColor).to.equal(rowBg);
        expect(parse(cs(pinned).backgroundColor)[3]).to.equal(1);
        expect(cs(pinned).backgroundImage).to.contain('gradient');
        // An unpinned cell paints the same tint over a transparent background.
        expect(parse(cs(plain).backgroundColor)[3]).to.equal(0);
        expect(cs(plain).backgroundImage).to.equal(cs(pinned).backgroundImage);
      });
    }
  });

  describe('zebra striping', () => {
    it('follows the row index, not the DOM position in the window', async () => {
      const grid = await mount([{ key: 'id', type: 'number' }, { key: 'name' }], {
        style: '--ag-surface-alt: rgb(255, 0, 0);',
      });
      const striped = (r: ApexGridRow<Row>) => cs(r).backgroundColor === 'rgb(255, 0, 0)';
      const check = () => {
        const rows = bodyRows(grid);
        expect(rows.length).to.be.greaterThan(4);
        for (const r of rows) {
          expect(striped(r), `row ${r.index}`).to.equal(r.index % 2 === 1);
        }
        return rows[0].index;
      };

      expect(check()).to.equal(0);
      // Scroll until the window starts at an odd index: DOM position and row
      // index then disagree on parity.
      let first = 0;
      for (let k = 41; k < 120 && first % 2 === 0; k++) {
        grid.scrollTop = 36 * k;
        await nextFrame();
        await nextFrame();
        await Promise.all(grid.rows.map((row) => row.updateComplete));
        first = bodyRows(grid)[0].index;
      }
      expect(first % 2, 'window never started at an odd index').to.equal(1);
      check();
    });
  });

  describe('renderer colours', () => {
    const columns: ColumnConfiguration<Row>[] = [
      { key: 'plan', type: 'badge' },
      { key: 'tier', type: 'badge', badgeVariant: 'muted' },
      { key: 'vip', type: 'badge', badgeVariant: 'gold' },
      { key: 'health', type: 'progress' },
    ];

    it('dark theme: badges keep 4.5:1 text contrast and the progress track shows', async () => {
      const grid = await mount(columns, { theme: 'dark' });
      const row = rowAt(grid, 0);
      const rowBg = parse(cs(row).backgroundColor);
      for (const key of ['plan', 'tier', 'vip'] as const) {
        const pill = part(cellOf(row, key), 'pill');
        const style = cs(pill);
        const wash =
          style.backgroundImage === 'none'
            ? parse(style.backgroundColor)
            : parse(firstStop(style.backgroundImage));
        const ratio = contrast(parse(style.color), over(wash, rowBg));
        expect(ratio, `${key} badge contrast`).to.be.at.least(4.5);
      }
      const track = part(cellOf(row, 'health'), 'progress-track');
      const ratio = contrast(over(parse(cs(track).backgroundColor), rowBg), rowBg);
      expect(ratio, 'progress track against the row').to.be.at.least(1.2);
    });

    it('light theme: renderer colours are unchanged', async () => {
      const grid = await mount(columns);
      const row = rowAt(grid, 0);
      expect(cs(part(cellOf(row, 'plan'), 'pill')).color).to.equal('rgb(67, 56, 202)');
      expect(cs(part(cellOf(row, 'tier'), 'pill')).color).to.equal('rgb(75, 85, 99)');
      expect(firstStop(cs(part(cellOf(row, 'vip'), 'pill')).backgroundImage)).to.equal(
        'rgb(255, 247, 230)'
      );
      expect(cs(part(cellOf(row, 'health'), 'progress-track')).backgroundColor).to.equal(
        'rgba(15, 23, 42, 0.08)'
      );
    });
  });

  describe('selected-row accent bar', () => {
    it('an ltr grid never inherits an outer rtl row bar offset', async () => {
      // A nested grid in an RTL grid's detail panel inherits from an RTL row.
      const grid = await mount([{ key: 'id', type: 'number' }, { key: 'name' }], {
        dir: 'ltr',
        style: '--_ag-bar: -2px;',
        selection: true,
      });
      await grid.selectRow(data[0]);
      await grid.updateComplete;
      const row = rowAt(grid, 0);
      await row.updateComplete;
      expect(cs(row).boxShadow).to.contain(' 2px 0px 0px 0px inset');
      expect(cs(row).boxShadow).to.not.contain('-2px');
    });

    for (const dir of ['ltr', 'rtl'] as const) {
      it(`${dir}: sits on the leading edge`, async () => {
        const grid = await mount([{ key: 'id', type: 'number' }, { key: 'name' }], {
          dir,
          selection: true,
        });
        await grid.selectRow(data[0]);
        await grid.updateComplete;
        const row = rowAt(grid, 0);
        await row.updateComplete;
        expect(row.hasAttribute('selected')).to.be.true;
        const shadow = cs(row).boxShadow;
        expect(shadow).to.contain(
          dir === 'rtl' ? ' -2px 0px 0px 0px inset' : ' 2px 0px 0px 0px inset'
        );
      });
    }
  });

  describe('forced colors (emulated)', () => {
    it('the emulation is live in this runner', async () => {
      await forcedColors(true);
      expect(matchMedia('(forced-colors: active)').matches).to.be.true;
    });

    it('hands the checkbox to the UA, which paints its checked state in system colours', async () => {
      const grid = await mount(
        [
          { key: 'id', type: 'number' },
          { key: 'active', type: 'boolean' },
        ],
        { selection: true }
      );
      await forcedColors(true);
      const marks = [1, 2].map((i) =>
        part(cellOf(rowAt(grid, i), 'active'), 'boolean-mark')
      ) as HTMLInputElement[];
      expect(marks.map((m) => m.checked)).to.deep.equal([false, true]);
      const box = rowAt(grid, 3).renderRoot.querySelector<HTMLInputElement>(
        '[part="selection-checkbox"]'
      )!;
      box.indeterminate = true;
      for (const mark of [...marks, box]) {
        // The author look draws the tick as a white image on a background the
        // system forces to Canvas, so checked would read as unchecked. A UA
        // checkbox paints its state in system colours and ignores author
        // backgrounds, the tick image included (checked against screenshots
        // under emulated forced colors in Playwright).
        expect(cs(mark).appearance, 'appearance').to.equal('auto');
      }
    });

    it('number, currency and renderer text in a selected row take the row colour', async () => {
      const grid = await mount(
        [
          { key: 'id', type: 'number' },
          { key: 'amount', type: 'currency' },
          { key: 'name' },
          { key: 'plan', type: 'badge' },
          { key: 'vip', type: 'badge', badgeVariant: 'gold' },
          { key: 'state', type: 'status' },
          { key: 'health', type: 'progress' },
        ],
        { selection: true }
      );
      await grid.selectRow(data[0]);
      await grid.updateComplete;
      await forcedColors(true);
      const row = rowAt(grid, 0);
      await row.updateComplete;
      const rowColor = cs(row).color;
      // The row itself wears the system selection pair.
      const probe = document.createElement('div');
      probe.style.cssText =
        'forced-color-adjust: none; background: Highlight; color: HighlightText';
      document.body.append(probe);
      expect(cs(row).backgroundColor, 'row background').to.equal(cs(probe).backgroundColor);
      expect(rowColor, 'row text').to.equal(cs(probe).color);
      probe.remove();
      expect(cs(cellOf(row, 'name')).color, 'text cell').to.equal(rowColor);
      expect(cs(cellOf(row, 'id')).color, 'number cell').to.equal(rowColor);
      expect(cs(cellOf(row, 'amount')).color, 'currency cell').to.equal(rowColor);
      expect(cs(part(cellOf(row, 'plan'), 'pill')).color, 'badge').to.equal(rowColor);
      expect(cs(part(cellOf(row, 'state'), 'status')).color, 'status').to.equal(rowColor);
      expect(cs(part(cellOf(row, 'health'), 'progress-label')).color, 'progress').to.equal(
        rowColor
      );
      // The gold badge's light gradient would sit under the row's light text.
      expect(cs(part(cellOf(row, 'vip'), 'pill')).backgroundImage, 'gold wash').to.equal('none');
    });

    it('row chrome and the tree toggle in a selected row take the row colour', async () => {
      ApexGrid.register();
      const grid = await fixture<ApexGrid<Row>>(
        html`<apex-grid
          style=${STILL}
          .data=${data.slice(0, 20)}
          .columns=${[{ key: 'name' }, { key: 'id', type: 'number' }]}
          .selection=${{ enabled: true, mode: 'multiple', showCheckboxColumn: true }}
          .coordinateHints=${true}
          .rowReordering=${{ enabled: true, mode: 'handle' }}
          .expansion=${{ enabled: true, showToggleColumn: true }}
          .tree=${{
            enabled: true,
            // Row 1 nests under row 0, so row 0 renders a tree toggle.
            getDataPath: (r: Row) => (r.id === 1 ? ['0', '1'] : [String(r.id)]),
          }}
        ></apex-grid>`,
        { parentNode: Object.assign(document.createElement('div'), { style: 'height:500px' }) }
      );
      await grid.updateComplete;
      await waitUntil(() => grid.rows.length > 0, 'rows never rendered');
      await grid.selectRow(data[0]);
      await grid.updateComplete;
      await forcedColors(true);
      const row = rowAt(grid, 0);
      await row.updateComplete;
      const rowColor = cs(row).color;
      const chrome = (name: string) => {
        const el = row.renderRoot.querySelector(`[part='${name}']`);
        if (!el) throw new Error(`no ${name} part`);
        return el;
      };
      for (const name of ['row-number-cell', 'reorder-handle', 'expansion-toggle']) {
        expect(cs(chrome(name)).color, name).to.equal(rowColor);
      }
      const toggle = part(cellOf(row, 'name'), 'tree-toggle');
      expect(cs(toggle).color, 'tree-toggle').to.equal(rowColor);
    });

    it('an editor in a selected row rejoins the forced palette', async function () {
      // The fix hands the editor back to the forced palette, which WebKit
      // never applies (no `forced-color-adjust`, no forced colors mode).
      if (!CSS.supports('forced-color-adjust', 'auto')) this.skip();
      ApexGrid.register();
      const grid = await fixture<ApexGrid<Row>>(
        html`<apex-grid
          style=${STILL}
          .data=${data.slice(0, 20)}
          .columns=${[{ key: 'health', type: 'rating', editable: true, max: 5 }, { key: 'name' }]}
          .editing=${{ enabled: true, mode: 'cell' }}
          .selection=${{ enabled: true, mode: 'multiple' }}
        ></apex-grid>`,
        { parentNode: Object.assign(document.createElement('div'), { style: 'height:500px' }) }
      );
      await grid.updateComplete;
      await waitUntil(() => grid.rows.length > 0, 'rows never rendered');
      await grid.selectRow(data[0]);
      await forcedColors(true);
      expect(await grid.editCell(0, 'health')).to.be.true;
      const cell = cellOf(rowAt(grid, 0), 'health');
      await cell.updateComplete;
      expect(cs(cell).forcedColorAdjust).to.equal('auto');
      // The rating stars no longer keep their authored amber on Field.
      const editor = part(cell, 'rating-editor');
      expect(cs(editor).color).to.equal(cs(cell).color);
    });

    for (const type of ['number', 'currency'] as const) {
      it(`a ${type} editor in a selected row keeps field text on the field`, async () => {
        ApexGrid.register();
        const grid = await fixture<ApexGrid<Row>>(
          html`<apex-grid
            style=${STILL}
            .data=${data.slice(0, 20)}
            .columns=${[{ key: 'amount', type, editable: true }, { key: 'name' }]}
            .editing=${{ enabled: true, mode: 'cell' }}
            .selection=${{ enabled: true, mode: 'multiple' }}
          ></apex-grid>`,
          { parentNode: Object.assign(document.createElement('div'), { style: 'height:500px' }) }
        );
        await grid.updateComplete;
        await waitUntil(() => grid.rows.length > 0, 'rows never rendered');
        await grid.selectRow(data[0]);
        await forcedColors(true);
        expect(await grid.editCell(0, 'amount')).to.be.true;
        const cell = cellOf(rowAt(grid, 0), 'amount');
        await cell.updateComplete;
        const input = cell.renderRoot.querySelector('input');
        if (!input) throw new Error('no editor input');
        // The editing rule (FieldText on Field) must win over the selected
        // row's inherited HighlightText.
        expect(cs(input).color).to.not.equal(cs(cell).backgroundColor);
      });
    }

    it('a keyboard-grabbed row shows an outline', async () => {
      const grid = await mount([{ key: 'id', type: 'number' }, { key: 'name' }]);
      await forcedColors(true);
      const row = rowAt(grid, 0);
      row.setAttribute('grabbed', '');
      expect(cs(row).outlineStyle).to.equal('solid');
      expect(cs(row).outlineWidth).to.equal('2px');
    });
  });
});
