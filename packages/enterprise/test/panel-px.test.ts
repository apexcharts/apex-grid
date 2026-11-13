import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import type { CSSResult, LitElement } from 'lit';
import {
  ApexGridAI,
  ApexGridChart,
  ApexGridEnterprise,
  ApexGridFilterBuilder,
  ApexGridSetFilter,
  ApexGridStatusBar,
  ApexGridToolPanel,
  enterpriseModules,
} from '../src/index.js';
import { mountPopups } from './popups.js';
import { settle } from './settle.js';

/**
 * The enterprise panels size their chrome in pixels, as core does since 4.2.0,
 * so a page that changes its root font size does not resize them. At the
 * default 16px root every size is what the old rem values gave.
 */

interface Row {
  name: string;
  department: string;
  value: number;
}
const data: Row[] = [
  { name: 'A', department: 'Engineering', value: 10 },
  { name: 'B', department: 'Sales', value: 20 },
  { name: 'C', department: 'Sales', value: 30 },
];
const columns: ColumnConfiguration<Row>[] = [
  { key: 'name', type: 'string', headerText: 'Name', sort: true, filter: true },
  { key: 'department', type: 'string', headerText: 'Department', sort: true, filter: true },
  { key: 'value', type: 'number', headerText: 'Value', sort: true, filter: true },
];

/** The sizing properties compared for every element of every panel. */
const PROPS = [
  'font-size',
  'line-height',
  'letter-spacing',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'row-gap',
  'column-gap',
  'width',
  'height',
] as const;

type Snapshot = Map<string, string>;

/** Every element under `root`, through open shadow roots, keyed by its path. */
function serialize(root: Element, out: Snapshot = new Map(), prefix = ''): Snapshot {
  const cs = getComputedStyle(root);
  const part = root.getAttribute('part');
  const key = `${prefix}/${root.localName}${part ? `[${part}]` : ''}`;
  // The plotted chart is ApexCharts' own drawing, not panel chrome, and it
  // sizes the canvas box when it draws (0px on a cold mount, then the chart
  // height a few frames later). Keep the canvas's own padding and type, skip
  // its box size and everything ApexCharts renders inside it.
  const canvas = part === 'canvas';
  const props = canvas ? PROPS.filter((p) => p !== 'width' && p !== 'height') : PROPS;
  out.set(key, props.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
  if (canvas) return out;
  const children = [...root.children, ...(root.shadowRoot ? root.shadowRoot.children : [])];
  children.forEach((child, i) => {
    if (['style', 'script', 'svg', 'template'].includes(child.localName)) return;
    serialize(child, out, `${key}:${i}`);
  });
  return out;
}

function diff(a: Snapshot, b: Snapshot): string[] {
  const out: string[] = [];
  for (const [key, value] of a) {
    if (b.get(key) !== value) out.push(`${key}\n  16px root: ${value}\n  now:       ${b.get(key)}`);
  }
  for (const key of b.keys()) if (!a.has(key)) out.push(`${key} appeared`);
  return out;
}

function cellElement(grid: ApexGridEnterprise<Row>, rowIndex: number, key: keyof Row) {
  for (const row of grid.rows) {
    if (row.index !== rowIndex) continue;
    return row.cells.find((c) => String(c.column.key) === key) as unknown as HTMLElement;
  }
  throw new Error(`no cell ${rowIndex}/${key}`);
}

/** Every panel the batch covers, open and bound to one grid. */
async function mountPanels(): Promise<Record<string, Element>> {
  const parent = document.createElement('div');
  parent.style.height = '400px';
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`,
    { parentNode: parent }
  );
  await settle(grid);
  const popups = await mountPopups(grid);

  // Run one prompt so the AI panel shows its result, source, undo and history.
  const input = popups.ai.renderRoot.querySelector<HTMLTextAreaElement>('[part="input"]')!;
  input.value = 'sort by value descending';
  input.dispatchEvent(new Event('input'));
  await popups.ai.updateComplete;
  popups.ai.renderRoot.querySelector<HTMLButtonElement>('[part="send"]')!.click();
  for (let i = 0; i < 40; i++) {
    await nextFrame();
    if (popups.ai.renderRoot.querySelector('[part="result"]')) break;
  }
  await popups.ai.updateComplete;

  const aiDialog = document.createElement('apex-grid-ai') as ApexGridAI;
  aiDialog.dataset.popup = '';
  (aiDialog as unknown as { grid: unknown }).grid = grid;
  document.body.append(aiDialog);
  aiDialog.show();
  await aiDialog.updateComplete;

  const chartDialog = await fixture<ApexGridChart>(
    html`<apex-grid-chart heading="Value" .grid=${grid as never}></apex-grid-chart>`
  );
  chartDialog.show();
  await chartDialog.updateComplete;
  const chartInline = await fixture<ApexGridChart>(
    html`<apex-grid-chart mode="inline" .grid=${grid as never}></apex-grid-chart>`
  );
  await chartInline.updateComplete;

  cellElement(grid, 0, 'value').dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      composed: true,
      cancelable: true,
      clientX: 60,
      clientY: 60,
    })
  );
  const contextMenu = document.querySelector('.apex-grid-context-menu');
  if (!contextMenu) throw new Error('context menu did not open');

  // ApexCharts draws a few frames after mount and grows the chart's host and
  // panel with it, so a snapshot taken earlier races the draw on a cold mount.
  // Wait until both charts have drawn their SVG and their height has held for
  // three frames before anything is measured.
  for (const chart of [chartDialog, chartInline]) {
    let last = -1;
    let steady = 0;
    for (let i = 0; steady < 3; i++) {
      if (i >= 180) throw new Error('chart did not settle within 180 frames');
      await nextFrame();
      const drawn = chart.renderRoot.querySelector('[part="canvas"] svg');
      const height = chart.getBoundingClientRect().height;
      steady = drawn && height === last ? steady + 1 : 0;
      last = height;
    }
  }

  await nextFrame();
  await nextFrame();
  return {
    statusBar: popups.statusBar,
    toolPanel: popups.toolPanel,
    filterBuilder: popups.filterBuilder,
    setFilter: popups.setFilter,
    aiInline: popups.ai,
    aiDialog,
    chartDialog,
    chartInline,
    contextMenu,
  };
}

function snapshotAll(panels: Record<string, Element>): Snapshot {
  const out: Snapshot = new Map();
  for (const [name, el] of Object.entries(panels)) serialize(el, out, name);
  return out;
}

async function setRootFontSize(size: string) {
  document.documentElement.style.fontSize = size;
  await nextFrame();
  await nextFrame();
}

const REM = /\d*\.?\d+rem\b/g;

describe('enterprise panels keep fixed pixel sizes', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    for (const el of [
      ApexGridFilterBuilder,
      ApexGridSetFilter,
      ApexGridAI,
      ApexGridToolPanel,
      ApexGridStatusBar,
      ApexGridChart,
    ]) {
      el.register();
    }
  });
  afterEach(() => {
    document.documentElement.style.fontSize = '';
    for (const el of document.querySelectorAll('[data-popup], .apex-grid-context-menu')) {
      el.remove();
    }
    fixtureCleanup();
  });

  it('sizes nothing in rem in any panel stylesheet', async () => {
    const panels = await mountPanels();
    const sheets: Record<string, string> = {};
    for (const el of [
      panels.statusBar,
      panels.toolPanel,
      panels.filterBuilder,
      panels.setFilter,
      panels.aiInline,
    ]) {
      sheets[el.localName] = (el.constructor as typeof LitElement).elementStyles
        .map((s) => (s as CSSResult).cssText ?? '')
        .join('\n');
    }
    // The chart panel renders light DOM and carries its rules in a <style> of its own.
    sheets[panels.chartInline.localName] =
      panels.chartInline.querySelector('style')!.textContent ?? '';
    sheets.contextMenu = document.getElementById('apex-grid-context-menu-style')?.textContent ?? '';
    for (const [name, text] of Object.entries(sheets)) {
      expect(text, name).to.not.equal('');
      expect(text.match(REM) ?? [], name).to.eql([]);
    }
  });

  it('keeps the 16px-root host font sizes', async () => {
    const panels = await mountPanels();
    const fontSize = (el: Element) => getComputedStyle(el).fontSize;
    expect(fontSize(panels.statusBar)).to.equal('12.8px');
    expect(fontSize(panels.toolPanel)).to.equal('13.6px');
    expect(fontSize(panels.filterBuilder)).to.equal('13.6px');
    expect(fontSize(panels.setFilter)).to.equal('13.6px');
    expect(fontSize(panels.aiInline)).to.equal('12.8px');
    expect(fontSize(panels.chartInline)).to.equal('12.8px');
    expect(fontSize(panels.contextMenu)).to.equal('12.8px');
  });

  for (const root of ['10px', '20px']) {
    it(`renders every panel at its 16px-root size under a ${root} root`, async () => {
      const panels = await mountPanels();
      const base = snapshotAll(panels);
      expect(base.size).to.be.greaterThan(100);
      await setRootFontSize(root);
      const changed = diff(base, snapshotAll(panels));
      expect(changed.slice(0, 12), `${changed.length} elements changed size`).to.eql([]);
    });
  }
});
