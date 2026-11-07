import { elementUpdated, expect, fixtureCleanup } from '@open-wc/testing';
import { ApexGrid } from '../src/components/grid.js';
import '../src/ignite-ui.js';
import { designSystemName } from '../src/internal/design-system.js';
import { setStyleQuerySupport } from '../src/internal/ignite-ui.js';
import {
  cleanupShadowMounts,
  color,
  DARK_SHEETS,
  type Grid,
  ig,
  LIGHT_SHEETS,
  loadSheet,
  look,
  mount,
  token,
} from './utils/ignite-ui.js';

/**
 * The `apex-grid/ignite-ui` add-on: the grid follows the Ignite UI theme on
 * the page (plan 36 acceptance), in the light DOM and inside a shadow root.
 */

ApexGrid.register();

const root = document.documentElement;
const rootToken = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

const BUILT_IN = {
  light: { text: 'rgb(17, 24, 39)', surface: 'rgb(255, 255, 255)', brand: 'rgb(13, 111, 211)' },
  dark: { text: 'rgb(241, 245, 249)', surface: 'rgb(15, 23, 42)', brand: 'rgb(59, 130, 246)' },
};

/** Series 1 / the accent: the primary seed, else 500. */
const primary = () => ig('--ig-primary-seed, var(--ig-primary-500)');

/** The Ignite UI font as the browser computes it. */
function igFont(): string {
  const probe = document.createElement('span');
  probe.style.fontFamily = 'var(--ig-font-family)';
  document.body.append(probe);
  const out = getComputedStyle(probe).fontFamily;
  probe.remove();
  return out;
}

function isDarkGrid(grid: Grid): boolean {
  return token(grid, '--_ag-surface') === BUILT_IN.dark.surface;
}

describe('Ignite UI add-on', () => {
  afterEach(async () => {
    await loadSheet(null);
    for (const name of ['--apx-accent', '--apx-fore', '--apx-grid', '--apx-radius-factor']) {
      root.style.removeProperty(name);
    }
    fixtureCleanup();
    cleanupShadowMounts();
  });

  it('registers on import', () => {
    expect(designSystemName()).to.equal('igniteui');
  });

  it('withdraws the root defaults of the tokens that follow Ignite UI', async () => {
    await mount();
    for (const name of [
      '--ag-text',
      '--ag-surface',
      '--ag-hairline',
      '--ag-good',
      '--ag-dark-text',
    ]) {
      expect(rootToken(name), name).to.equal('');
    }
    // The rest stay readable.
    expect(rootToken('--ag-fs-cell')).to.equal('13px');
    expect(rootToken('--ag-good-text')).to.equal('#047857');
  });

  it('renders the built-in look with no Ignite UI sheet', async () => {
    const grid = await mount();
    const out = look(grid);
    expect(out['--_ag-brand']).to.equal(BUILT_IN.light.brand);
    expect(out['--_ag-text']).to.equal(BUILT_IN.light.text);
    expect(out['--_ag-hairline']).to.equal(color('rgb(15 23 42 / 8%)'));
    expect(out.font).to.equal('Inter, -apple-system, blinkmacsystemfont, sans-serif');
    expect(out.radius).to.equal('8px');
    expect(out['--_ag-overlay']).to.equal('');
    expect(out['--_ag-overlay-accent']).to.equal('');
    expect(out['--_ag-overlay-font']).to.equal('');
  });

  for (const shadow of [false, true]) {
    const where = shadow ? ' (in a shadow root)' : '';

    for (const sheet of LIGHT_SHEETS) {
      it(`follows ${sheet}${where}`, async () => {
        await loadSheet(sheet);
        const grid = await mount({ shadow });
        expect(isDarkGrid(grid)).to.be.false;
        expect(token(grid, '--_ag-brand')).to.equal(primary());
        expect(token(grid, '--_ag-text')).to.equal(ig('--ig-gray-800'));
        expect(token(grid, '--_ag-text-body')).to.equal(ig('--ig-gray-800'));
        expect(token(grid, '--_ag-text-muted')).to.equal(ig('--ig-gray-600'));
        expect(token(grid, '--_ag-hairline')).to.equal(ig('--ig-gray-300'));
        expect(token(grid, '--_ag-border')).to.equal(ig('--ig-gray-300'));
        expect(token(grid, '--_ag-pin-line')).to.equal(ig('--ig-gray-400'));
        expect(token(grid, '--_ag-good')).to.equal(ig('--ig-success-seed'));
        expect(token(grid, '--_ag-watch')).to.equal(ig('--ig-warn-seed'));
        expect(token(grid, '--_ag-risk')).to.equal(ig('--ig-error-seed'));
        // Opaque paper stays the grid's own (no surface role painted in 7.4).
        expect(token(grid, '--_ag-surface')).to.equal(BUILT_IN.light.surface);
        expect(getComputedStyle(grid).fontFamily).to.equal(igFont());
        // The cells inherit it.
        expect(getComputedStyle(grid).color).to.equal(ig('--ig-gray-800'));
      });
    }

    for (const sheet of DARK_SHEETS) {
      it(`goes dark under ${sheet} with no theme set${where}`, async () => {
        await loadSheet(sheet);
        const grid = await mount({ shadow });
        expect(isDarkGrid(grid)).to.be.true;
        expect(token(grid, '--_ag-brand')).to.equal(primary());
        expect(token(grid, '--_ag-text')).to.equal(ig('--ig-gray-800'));
        expect(token(grid, '--_ag-hairline')).to.equal(ig('--ig-gray-300'));
        // 7.4 has no overlay role: the popups take the built-in dark header colour.
        expect(token(grid, '--_ag-overlay')).to.equal(color('#1e2532'));
        expect(token(grid, '--_ag-overlay-text')).to.equal(color('#e2e8f0'));
        expect(getComputedStyle(grid).backgroundColor).to.equal(BUILT_IN.dark.surface);
      });
    }

    it(`takes the 7.5 overlay surface for the popups${where}`, async () => {
      await loadSheet('next-dark-material');
      const grid = await mount({ shadow });
      expect(isDarkGrid(grid)).to.be.true;
      expect(token(grid, '--_ag-overlay')).to.equal(ig('--ig-surface-overlay'));
      expect(token(grid, '--_ag-overlay-text')).to.equal(ig('--ig-surface-overlay-contrast'));
      expect(token(grid, '--_ag-overlay-line')).to.equal(ig('--ig-gray-300'));
      expect(token(grid, '--_ag-surface-elevated')).to.equal(ig('--ig-surface-raised'));
    });
  }

  describe('ranking', () => {
    it('an --ag-* token beats the family token, which beats Ignite UI', async () => {
      await loadSheet('light-material');
      root.style.setProperty('--apx-fore', 'rgb(1, 2, 3)');
      root.style.setProperty('--apx-accent', 'rgb(4, 5, 6)');
      const grid = await mount({ ancestor: '--ag-text: rgb(7, 8, 9);' });
      expect(token(grid, '--_ag-text')).to.equal('rgb(7, 8, 9)');
      expect(token(grid, '--_ag-text-body')).to.equal('rgb(1, 2, 3)');
      expect(token(grid, '--_ag-brand')).to.equal('rgb(4, 5, 6)');
      expect(token(grid, '--_ag-text-muted')).to.equal(ig('--ig-gray-600'));
    });

    it('reaches a family token scoped to an ancestor', async () => {
      await loadSheet('light-material');
      const grid = await mount({ ancestor: '--apx-grid: rgb(1, 2, 3);' });
      expect(token(grid, '--_ag-hairline')).to.equal('rgb(1, 2, 3)');
    });

    it('an --ag-dark-* token beats Ignite UI on a dark grid', async () => {
      await loadSheet('dark-material');
      const grid = await mount({
        ancestor: '--ag-dark-text: rgb(7, 8, 9); --ag-brand: rgb(1, 1, 1);',
      });
      expect(token(grid, '--_ag-text')).to.equal('rgb(7, 8, 9)');
      expect(token(grid, '--_ag-brand')).to.equal('rgb(1, 1, 1)');
    });

    it('an --ag-font beats the family font, which beats the Ignite UI font', async () => {
      await loadSheet('light-material');
      const grid = await mount({ ancestor: '--apx-font-family: Georgia, serif;' });
      expect(getComputedStyle(grid).fontFamily).to.equal('Georgia, serif');
      grid.style.setProperty('--ag-font', '"Courier New", monospace');
      expect(getComputedStyle(grid).fontFamily).to.equal('"Courier New", monospace');
    });
  });

  describe('mode', () => {
    it('theme="light" stays light under a dark sheet, with the built-in text', async () => {
      await loadSheet('dark-material');
      const grid = await mount({ theme: 'light' });
      expect(isDarkGrid(grid)).to.be.false;
      expect(token(grid, '--_ag-text')).to.equal(BUILT_IN.light.text);
      expect(token(grid, '--_ag-hairline')).to.equal(color('rgb(15 23 42 / 8%)'));
      // The variant-independent roles still follow Ignite UI.
      expect(token(grid, '--_ag-brand')).to.equal(primary());
    });

    it('theme="dark" under a light sheet keeps the built-in dark text', async () => {
      await loadSheet('light-material');
      const grid = await mount({ theme: 'dark' });
      expect(isDarkGrid(grid)).to.be.true;
      expect(token(grid, '--_ag-text')).to.equal(BUILT_IN.dark.text);
      expect(token(grid, '--_ag-brand')).to.equal(primary());
      // No dark overlay default: the popups look as they do without the add-on.
      expect(getComputedStyle(grid).getPropertyValue('--_ag-overlay').trim()).to.equal('');
    });

    it('theme="dark" under a dark sheet takes the Ignite UI grays', async () => {
      await loadSheet('dark-fluent');
      const grid = await mount({ theme: 'dark' });
      expect(token(grid, '--_ag-text')).to.equal(ig('--ig-gray-800'));
    });

    it('theme="tinted" mixes the brand into the Ignite UI lines, and follows the variant', async () => {
      await loadSheet('light-indigo');
      const light = await mount({ theme: 'tinted' });
      expect(token(light, '--_ag-hairline')).to.equal(
        color(`color-mix(in srgb, ${primary()} 24%, ${ig('--ig-gray-300')})`)
      );
      fixtureCleanup();
      await loadSheet('dark-indigo');
      const dark = await mount({ theme: 'tinted' });
      expect(isDarkGrid(dark)).to.be.true;
      expect(token(dark, '--_ag-hairline')).to.equal(
        color(`color-mix(in srgb, ${primary()} 30%, ${ig('--ig-gray-300')})`)
      );
    });

    it('follows a theme swap live, without a reconnect', async () => {
      await loadSheet('light-bootstrap');
      const grid = await mount();
      expect(isDarkGrid(grid)).to.be.false;
      await loadSheet('dark-bootstrap');
      expect(isDarkGrid(grid)).to.be.true;
      await loadSheet('light-bootstrap');
      expect(isDarkGrid(grid)).to.be.false;
    });

    it('follows a variant scoped to an ancestor', async () => {
      await loadSheet('light-material');
      const grid = await mount({ ancestor: '--ig-theme-variant: dark;' });
      expect(isDarkGrid(grid)).to.be.true;
    });
  });

  describe('switches', () => {
    it('design-system="off" renders as without the add-on, the variant still picking the mode', async () => {
      await loadSheet('light-material');
      const plain = look(await mount({ attrs: { 'design-system': 'off' } }));
      expect(plain['--_ag-brand']).to.equal(BUILT_IN.light.brand);
      expect(plain['--_ag-text']).to.equal(BUILT_IN.light.text);
      expect(plain.font).to.equal('Inter, -apple-system, blinkmacsystemfont, sans-serif');
      fixtureCleanup();
      await loadSheet('dark-material');
      const dark = await mount({ attrs: { 'design-system': 'off' } });
      expect(isDarkGrid(dark)).to.be.true;
      expect(token(dark, '--_ag-text')).to.equal(BUILT_IN.dark.text);
      expect(token(dark, '--_ag-brand')).to.equal(BUILT_IN.dark.brand);
      // The popups still go dark with the grid.
      expect(token(dark, '--_ag-overlay')).to.equal(color('#1e2532'));
    });

    it('design-system="off" leaves the Ignite UI tokens to the grid content', async () => {
      await loadSheet('light-material');
      const grid = await mount({ attrs: { 'design-system': 'off' } });
      // Unlike tokens="off", nothing is blanked on the host: an Ignite UI
      // component rendered in a cell keeps its theme.
      expect(color('var(--ig-gray-800)', grid)).to.equal(ig('--ig-gray-800'));
    });

    it('tokens="off" turns off the family tokens and Ignite UI, the variant included', async () => {
      await loadSheet('dark-material');
      root.style.setProperty('--apx-accent', 'rgb(4, 5, 6)');
      root.style.setProperty('--apx-fore', 'rgb(1, 2, 3)');
      const grid = await mount({ attrs: { tokens: 'off' } });
      expect(isDarkGrid(grid)).to.be.false;
      expect(token(grid, '--_ag-brand')).to.equal(BUILT_IN.light.brand);
      expect(token(grid, '--_ag-text')).to.equal(BUILT_IN.light.text);
      // An explicit --ag-* token still applies.
      grid.style.setProperty('--ag-text', 'rgb(7, 8, 9)');
      expect(token(grid, '--_ag-text')).to.equal('rgb(7, 8, 9)');
    });

    it('a switch flipped at runtime applies at once', async () => {
      await loadSheet('light-material');
      const grid = await mount();
      expect(token(grid, '--_ag-brand')).to.equal(primary());
      grid.setAttribute('design-system', 'off');
      expect(token(grid, '--_ag-brand')).to.equal(BUILT_IN.light.brand);
      grid.removeAttribute('design-system');
      expect(token(grid, '--_ag-brand')).to.equal(primary());
    });
  });

  describe('radius', () => {
    it('--apx-radius-factor 1 matches the built-in radii exactly', async () => {
      await loadSheet('light-material');
      root.style.setProperty('--apx-radius-factor', '1');
      expect(getComputedStyle(await mount()).borderTopLeftRadius).to.equal('8px');
    });

    it('scales with the factor', async () => {
      root.style.setProperty('--apx-radius-factor', '0');
      expect(getComputedStyle(await mount()).borderTopLeftRadius).to.equal('0px');
    });
  });

  describe('without style queries', () => {
    afterEach(() => setStyleQuerySupport(null));

    it('applies the dark rules while the document variant is dark, and follows a swap', async () => {
      setStyleQuerySupport(false);
      await loadSheet('dark-material');
      const grid = await mount();
      expect(isDarkGrid(grid)).to.be.true;
      expect(token(grid, '--_ag-text')).to.equal(ig('--ig-gray-800'));
      await loadSheet('light-material');
      await frame();
      await elementUpdated(grid);
      expect(isDarkGrid(grid)).to.be.false;
      expect(token(grid, '--_ag-text')).to.equal(ig('--ig-gray-800'));
    });

    it('keeps theme="light" light and theme="dark" dark', async () => {
      setStyleQuerySupport(false);
      await loadSheet('dark-material');
      const light = await mount({ theme: 'light' });
      expect(isDarkGrid(light)).to.be.false;
      expect(token(light, '--_ag-text')).to.equal(BUILT_IN.light.text);
    });
  });
});
