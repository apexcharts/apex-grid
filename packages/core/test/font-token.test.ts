import { elementUpdated, expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
import { ApexGrid } from '../src/components/grid.js';
import data, { type TestData } from './utils/test-data.js';

/**
 * The grid font: an explicit `--ag-font` wins, then the family
 * `--apx-font-family`, then the built-in Inter stack. The same order as the
 * brand (`--ag-brand`, then `--apx-accent`, then the default blue). An Ignite
 * UI `--ig-font-family` counts only with the `apex-grid/ignite-ui` add-on
 * (`ignite-ui.test.ts`); this file never loads it.
 */

type Grid = ApexGrid<TestData>;

ApexGrid.register();

const INTER = 'Inter, -apple-system, blinkmacsystemfont, sans-serif';
const AG = '"Courier New", monospace';
const IG = '"Comic Sans MS", cursive';
const APX = 'Georgia, serif';

async function mount({ ancestor = '', grid = '', theme = '' } = {}): Promise<Grid> {
  const parentNode = document.createElement('div');
  parentNode.setAttribute('style', `width: 600px; height: 300px; ${ancestor}`);
  const el = await fixture<Grid>(html`<apex-grid style=${grid} theme=${theme}></apex-grid>`, {
    parentNode,
  });
  Object.assign(el, { data });
  await elementUpdated(el);
  return el;
}

const fontOf = (el: Element) => getComputedStyle(el).fontFamily;
const rootToken = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

describe('Font token', () => {
  afterEach(() => {
    for (const name of ['--ig-font-family', '--ag-font', '--apx-font-family']) {
      document.documentElement.style.removeProperty(name);
    }
    fixtureCleanup();
  });

  for (const theme of ['', 'dark', 'tinted']) {
    const label = theme ? ` (theme="${theme}")` : '';

    // Today's output, pinned: no token set.
    it(`uses the Inter stack when no font token is set${label}`, async () => {
      expect(fontOf(await mount({ theme }))).to.equal(INTER);
    });

    // Without the add-on an Ignite UI theme changes nothing.
    it(`ignores an Ignite UI font set on an ancestor${label}`, async () => {
      const grid = await mount({ theme, ancestor: `--ig-font-family: ${IG};` });
      expect(fontOf(grid)).to.equal(INTER);
    });

    it(`ignores an Ignite UI font set on :root${label}`, async () => {
      document.documentElement.style.setProperty('--ig-font-family', IG);
      expect(fontOf(await mount({ theme }))).to.equal(INTER);
    });

    it(`uses the family --apx-font-family set on an ancestor${label}`, async () => {
      const grid = await mount({ theme, ancestor: `--apx-font-family: ${APX};` });
      expect(fontOf(grid)).to.equal(APX);
    });

    it(`uses the family --apx-font-family set on :root${label}`, async () => {
      document.documentElement.style.setProperty('--apx-font-family', APX);
      expect(fontOf(await mount({ theme }))).to.equal(APX);
    });

    it(`uses --ag-font when only it is set${label}`, async () => {
      const grid = await mount({ theme, ancestor: `--ag-font: ${AG};` });
      expect(fontOf(grid)).to.equal(AG);
    });

    it(`prefers --ag-font over --apx-font-family on the same ancestor${label}`, async () => {
      const grid = await mount({
        theme,
        ancestor: `--apx-font-family: ${APX}; --ag-font: ${AG};`,
      });
      expect(fontOf(grid)).to.equal(AG);
    });

    it(`prefers --ag-font on the grid over --apx-font-family on an ancestor${label}`, async () => {
      const grid = await mount({
        theme,
        ancestor: `--apx-font-family: ${APX};`,
        grid: `--ag-font: ${AG};`,
      });
      expect(fontOf(grid)).to.equal(AG);
    });

    it(`prefers --ag-font on an ancestor over --apx-font-family on :root${label}`, async () => {
      document.documentElement.style.setProperty('--apx-font-family', APX);
      const grid = await mount({ theme, ancestor: `--ag-font: ${AG};` });
      expect(fontOf(grid)).to.equal(AG);
    });
  }

  it('prefers --ag-font over --apx-font-family when both are on :root', async () => {
    document.documentElement.style.setProperty('--apx-font-family', APX);
    document.documentElement.style.setProperty('--ag-font', AG);
    expect(fontOf(await mount())).to.equal(AG);
  });

  it('the cells and headers inherit the resolved font', async () => {
    const grid = await mount({ ancestor: `--apx-font-family: ${APX}; --ag-font: ${AG};` });
    const header = grid.renderRoot.querySelector('apex-grid-header-row');
    expect(header, 'header row').to.exist;
    expect(fontOf(header!)).to.equal(AG);
  });

  it('leaves --ag-font off the root defaults, which keep the other typography tokens', async () => {
    await mount();
    // A root default would always be set, so the family token could never win.
    expect(rootToken('--ag-font')).to.equal('');
    // The rest of the root sheet is unchanged.
    expect(rootToken('--ag-fs-cell')).to.equal('13px');
    expect(rootToken('--ag-fw-regular')).to.equal('500');
    expect(rootToken('--ag-surface')).to.equal('#fff');
  });
});
