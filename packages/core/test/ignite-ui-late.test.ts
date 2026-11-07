import { expect, fixtureCleanup } from '@open-wc/testing';
import { ApexGrid } from '../src/components/grid.js';
import { designSystemName } from '../src/internal/design-system.js';
import { cleanupShadowMounts, ig, loadSheet, mount, token } from './utils/ignite-ui.js';

/**
 * The `apex-grid/ignite-ui` add-on imported after grids connected: they take
 * it at once, in the light DOM and inside a shadow root, with no reconnect.
 */

ApexGrid.register();

describe('Ignite UI add-on imported late', () => {
  after(async () => {
    await loadSheet(null);
    fixtureCleanup();
    cleanupShadowMounts();
  });

  it('themes the grids already on the page', async () => {
    await loadSheet('dark-material');
    const light = await mount();
    const shadowed = await mount({ shadow: true });
    const builtIn = token(light, '--_ag-brand');
    expect(builtIn).to.equal('rgb(13, 111, 211)');
    expect(designSystemName()).to.equal(null);

    await import('../src/ignite-ui.js');

    expect(designSystemName()).to.equal('igniteui');
    for (const grid of [light, shadowed]) {
      expect(token(grid, '--_ag-brand')).to.equal(ig('--ig-primary-seed'));
      expect(token(grid, '--_ag-surface')).to.equal('rgb(15, 23, 42)');
      expect(token(grid, '--_ag-text')).to.equal(ig('--ig-gray-800'));
    }
  });

  it('adopts its sheet once per grid, across a reconnect', async () => {
    const grid = await mount();
    const before = (grid.renderRoot as ShadowRoot).adoptedStyleSheets.length;
    expect(before).to.equal(2);
    const parent = grid.parentElement!;
    grid.remove();
    parent.append(grid);
    expect((grid.renderRoot as ShadowRoot).adoptedStyleSheets.length).to.equal(before);
  });
});
