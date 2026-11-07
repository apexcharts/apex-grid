import { expect, fixtureCleanup } from '@open-wc/testing';
import { ApexGrid } from '../src/components/grid.js';
import { designSystemName, onDesignSystemRegistered } from '../src/internal/design-system.js';
import { IGNITE_UI_STYLES } from '../src/internal/ignite-ui.js';
import { styles as documentTokens } from '../src/styles/document-tokens.css.js';
import { cleanupShadowMounts, ig, loadSheet, mount, token } from './utils/ignite-ui.js';

/**
 * Two copies of the grid's registry on one page (the grid and the add-on
 * bundled separately, a CDN's per-file builds, two apps): the add-on
 * registers on a shared `globalThis` slot, so it reaches every grid.
 */

ApexGrid.register();

type Registry = typeof import('../src/internal/design-system.js');

describe('Ignite UI add-on from a second copy of the grid', () => {
  after(async () => {
    await loadSheet(null);
    fixtureCleanup();
    cleanupShadowMounts();
  });

  it('themes the grids of the first copy, and tells its listeners', async () => {
    await loadSheet('dark-material');
    const grid = await mount();
    const shadowed = await mount({ shadow: true });
    let told = 0;
    const stop = onDesignSystemRegistered(() => told++);
    // Another URL for the same module is another instance of it, with its own module state.
    const url = new URL('../src/internal/design-system.ts', import.meta.url);
    url.search = 'copy';
    const copy = (await import(/* @vite-ignore */ url.href)) as Registry;
    copy.registerDesignSystem(IGNITE_UI_STYLES);
    stop();

    expect(told).to.equal(1);
    expect(designSystemName()).to.equal('igniteui');
    for (const each of [grid, shadowed]) {
      expect(token(each, '--_ag-brand')).to.equal(ig('--ig-primary-seed'));
      expect(token(each, '--_ag-text')).to.equal(ig('--ig-gray-800'));
    }
  });

  it("keeps its document rules after a second copy's root defaults", async () => {
    await loadSheet('light-material');
    // What a second copy of the grid does as its first grid connects: adopt its root defaults.
    const late = new CSSStyleSheet();
    late.replaceSync(documentTokens.cssText);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, late];
    const grid = await mount();
    const sheets = document.adoptedStyleSheets;
    expect(sheets.indexOf(late)).to.be.below(sheets.length - 1);
    expect(
      getComputedStyle(document.documentElement).getPropertyValue('--ag-text').trim()
    ).to.equal('');
    expect(token(grid, '--_ag-text')).to.equal(ig('--ig-gray-800'));
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((each) => each !== late);
  });
});
