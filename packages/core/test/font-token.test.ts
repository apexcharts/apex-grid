import { elementUpdated, expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
import { ApexGrid } from '../src/components/grid.js';
import data, { type TestData } from './utils/test-data.js';

/**
 * The grid font: an explicit `--ag-font` wins, then an Ignite UI theme's
 * `--ig-font-family`, then the built-in Inter stack. The same order as the
 * brand (`--ag-brand`, then `--ig-primary-500`, then the default blue).
 */

type Grid = ApexGrid<TestData>;

ApexGrid.register();

const INTER = 'Inter, -apple-system, blinkmacsystemfont, sans-serif';
const AG = '"Courier New", monospace';
const IG = '"Comic Sans MS", cursive';

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
    document.documentElement.style.removeProperty('--ig-font-family');
    document.documentElement.style.removeProperty('--ag-font');
    fixtureCleanup();
  });

  for (const theme of ['', 'dark', 'tinted']) {
    const label = theme ? ` (theme="${theme}")` : '';

    // Today's output, pinned: no token set, or only the Ignite UI font.
    it(`uses the Inter stack when no font token is set${label}`, async () => {
      expect(fontOf(await mount({ theme }))).to.equal(INTER);
    });

    it(`uses an Ignite UI font set on an ancestor${label}`, async () => {
      const grid = await mount({ theme, ancestor: `--ig-font-family: ${IG};` });
      expect(fontOf(grid)).to.equal(IG);
    });

    it(`uses an Ignite UI font set on :root${label}`, async () => {
      document.documentElement.style.setProperty('--ig-font-family', IG);
      expect(fontOf(await mount({ theme }))).to.equal(IG);
    });

    it(`uses --ag-font when only it is set${label}`, async () => {
      const grid = await mount({ theme, ancestor: `--ag-font: ${AG};` });
      expect(fontOf(grid)).to.equal(AG);
    });

    // The fix: an explicit --ag-font beats the Ignite UI font.
    it(`prefers --ag-font over --ig-font-family on the same ancestor${label}`, async () => {
      const grid = await mount({
        theme,
        ancestor: `--ig-font-family: ${IG}; --ag-font: ${AG};`,
      });
      expect(fontOf(grid)).to.equal(AG);
    });

    it(`prefers --ag-font on the grid over an Ignite UI font on an ancestor${label}`, async () => {
      const grid = await mount({
        theme,
        ancestor: `--ig-font-family: ${IG};`,
        grid: `--ag-font: ${AG};`,
      });
      expect(fontOf(grid)).to.equal(AG);
    });

    it(`prefers --ag-font on an ancestor over an Ignite UI font on :root${label}`, async () => {
      document.documentElement.style.setProperty('--ig-font-family', IG);
      const grid = await mount({ theme, ancestor: `--ag-font: ${AG};` });
      expect(fontOf(grid)).to.equal(AG);
    });
  }

  it('prefers --ag-font over --ig-font-family when both are on :root', async () => {
    document.documentElement.style.setProperty('--ig-font-family', IG);
    document.documentElement.style.setProperty('--ag-font', AG);
    expect(fontOf(await mount())).to.equal(AG);
  });

  it('the cells and headers inherit the resolved font', async () => {
    const grid = await mount({ ancestor: `--ig-font-family: ${IG}; --ag-font: ${AG};` });
    const header = grid.renderRoot.querySelector('apex-grid-header-row');
    expect(header, 'header row').to.exist;
    expect(fontOf(header!)).to.equal(AG);
  });

  it('leaves --ag-font off the root defaults, which keep the other typography tokens', async () => {
    await mount();
    // A root default would always be set, so the Ignite UI fallback could never win.
    expect(rootToken('--ag-font')).to.equal('');
    // The rest of the root sheet is unchanged.
    expect(rootToken('--ag-fs-cell')).to.equal('13px');
    expect(rootToken('--ag-fw-regular')).to.equal('500');
    expect(rootToken('--ag-surface')).to.equal('#fff');
  });
});
