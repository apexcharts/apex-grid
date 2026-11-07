import { elementUpdated, expect, fixtureCleanup } from '@open-wc/testing';
import { ApexGrid } from '../src/components/grid.js';
import { designSystemName } from '../src/internal/design-system.js';
import {
  cleanupShadowMounts,
  color,
  DARK_SHEETS,
  LIGHT_SHEETS,
  loadSheet,
  look,
  mount,
  token,
} from './utils/ignite-ui.js';

/**
 * Without the `apex-grid/ignite-ui` add-on (this file never imports it) an
 * Ignite UI theme changes nothing: the grid reads no `--ig-*` token. The
 * family `--apx-*` tokens need no add-on.
 */

ApexGrid.register();

const root = document.documentElement;
const rootToken = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();

describe('Ignite UI without the add-on', () => {
  afterEach(async () => {
    await loadSheet(null);
    for (const name of [
      '--apx-accent',
      '--apx-fore',
      '--apx-grid',
      '--apx-surface',
      '--apx-radius-factor',
    ]) {
      root.style.removeProperty(name);
    }
    fixtureCleanup();
    cleanupShadowMounts();
  });

  it('registers no design system', () => {
    expect(designSystemName()).to.equal(null);
  });

  for (const shadow of [false, true]) {
    const where = shadow ? ' (in a shadow root)' : '';
    for (const theme of ['', 'dark', 'tinted']) {
      const label = `${theme ? ` theme="${theme}"` : ''}${where}`;
      const before = new Map<string, Record<string, string>>();

      it(`renders the built-in look with no sheet${label}`, async () => {
        const grid = await mount({ theme, shadow });
        before.set(label, look(grid));
        expect(look(grid).font).to.equal('Inter, -apple-system, blinkmacsystemfont, sans-serif');
      });

      for (const sheet of [...LIGHT_SHEETS, ...DARK_SHEETS, 'next-dark-material']) {
        it(`renders exactly as with no sheet under ${sheet}${label}`, async () => {
          await loadSheet(sheet);
          const grid = await mount({ theme, shadow });
          expect(look(grid)).to.eql(before.get(label));
        });
      }
    }
  }

  it('adopts nothing beyond its own styles into the shadow root', async () => {
    await loadSheet('dark-material');
    const grid = await mount();
    expect(grid.renderRoot instanceof ShadowRoot).to.be.true;
    const sheets = (grid.renderRoot as ShadowRoot).adoptedStyleSheets;
    expect(sheets.length).to.equal(1);
  });

  it('keeps every root default, so page CSS reads them', async () => {
    await loadSheet('light-material');
    await mount();
    expect(rootToken('--ag-text')).to.equal('#111827');
    expect(rootToken('--ag-surface')).to.equal('#fff');
    expect(rootToken('--ag-dark-text')).to.equal('#f1f5f9');
    expect(rootToken('--ag-good')).to.equal('#10b981');
  });

  describe('family tokens', () => {
    it('follows --apx-* set on :root through the root defaults', async () => {
      root.style.setProperty('--apx-accent', 'rgb(200, 0, 0)');
      root.style.setProperty('--apx-fore', 'rgb(1, 2, 3)');
      root.style.setProperty('--apx-grid', 'rgb(4, 5, 6)');
      root.style.setProperty('--apx-surface', 'rgb(250, 250, 240)');
      const grid = await mount();
      expect(token(grid, '--_ag-brand')).to.equal('rgb(200, 0, 0)');
      expect(token(grid, '--_ag-text')).to.equal('rgb(1, 2, 3)');
      expect(token(grid, '--_ag-text-body')).to.equal('rgb(1, 2, 3)');
      expect(token(grid, '--_ag-hairline')).to.equal('rgb(4, 5, 6)');
      expect(token(grid, '--_ag-border')).to.equal('rgb(4, 5, 6)');
      expect(token(grid, '--_ag-surface')).to.equal('rgb(250, 250, 240)');
      // Page CSS reading the public token sees the same value.
      expect(color('var(--ag-text)')).to.equal('rgb(1, 2, 3)');
    });

    it('follows --apx-* on :root in dark mode too', async () => {
      root.style.setProperty('--apx-fore', 'rgb(1, 2, 3)');
      const grid = await mount({ theme: 'dark' });
      expect(token(grid, '--_ag-text')).to.equal('rgb(1, 2, 3)');
    });

    it('takes --apx-accent from any ancestor (the brand has no root default)', async () => {
      const grid = await mount({ ancestor: '--apx-accent: rgb(0, 120, 0);' });
      expect(token(grid, '--_ag-brand')).to.equal('rgb(0, 120, 0)');
    });

    it('lets an --ag-* token beat the family token', async () => {
      root.style.setProperty('--apx-accent', 'rgb(200, 0, 0)');
      root.style.setProperty('--apx-fore', 'rgb(1, 2, 3)');
      const grid = await mount({ ancestor: '--ag-brand: rgb(9, 9, 9); --ag-text: rgb(7, 7, 7);' });
      expect(token(grid, '--_ag-brand')).to.equal('rgb(9, 9, 9)');
      expect(token(grid, '--_ag-text')).to.equal('rgb(7, 7, 7)');
    });

    it('scales the radii with --apx-radius-factor, 1 changing nothing, the pill fixed', async () => {
      const plain = getComputedStyle(await mount()).borderTopLeftRadius;
      expect(plain).to.equal('8px');
      fixtureCleanup();
      root.style.setProperty('--apx-radius-factor', '1');
      expect(getComputedStyle(await mount()).borderTopLeftRadius).to.equal('8px');
      fixtureCleanup();
      root.style.setProperty('--apx-radius-factor', '0.5');
      const grid = await mount();
      expect(getComputedStyle(grid).borderTopLeftRadius).to.equal('4px');
      const probe = document.createElement('span');
      grid.renderRoot.append(probe);
      probe.style.borderRadius = 'var(--_ag-radius-sm)';
      expect(getComputedStyle(probe).borderTopLeftRadius).to.equal('3px');
      probe.style.borderRadius = 'var(--_ag-radius-pill)';
      expect(getComputedStyle(probe).borderTopLeftRadius).to.equal('20px');
    });
  });

  describe('tokens="off" (core)', () => {
    const raw = (grid: Element, name: string) =>
      getComputedStyle(grid).getPropertyValue(name).trim();

    it('turns the family brand, font and radius factor off with no add-on', async () => {
      root.style.setProperty('--apx-accent', 'rgb(200, 0, 0)');
      root.style.setProperty('--apx-radius-factor', '0');
      const grid = await mount({
        attrs: { tokens: 'off' },
        ancestor: '--apx-font-family: Georgia;',
      });
      expect(token(grid, '--_ag-brand')).to.equal('rgb(13, 111, 211)');
      expect(raw(grid, '--_ag-font')).to.equal(
        'Inter, -apple-system, blinkmacsystemfont, sans-serif'
      );
      expect(getComputedStyle(grid).borderTopLeftRadius).to.equal('8px');
      // Content the grid renders inherits the blanks.
      expect(raw(grid, '--apx-accent')).to.equal('');
      // An --ag-* token you set still applies.
      grid.style.setProperty('--ag-brand', 'rgb(9, 9, 9)');
      expect(token(grid, '--_ag-brand')).to.equal('rgb(9, 9, 9)');
    });

    it('cannot take back a family colour that a root default resolved on :root', async () => {
      // Documented: --ag-text resolves `var(--apx-fore, #111827)` on :root for page CSS, and the
      // grid reads that resolved value. With the add-on, which lifts the default, it does not.
      root.style.setProperty('--apx-fore', 'rgb(1, 2, 3)');
      const grid = await mount({ attrs: { tokens: 'off' } });
      expect(token(grid, '--_ag-text')).to.equal('rgb(1, 2, 3)');
      // A family colour scoped below :root never reaches the root default, so the switch holds.
      root.style.removeProperty('--apx-fore');
      const scoped = await mount({
        attrs: { tokens: 'off' },
        ancestor: '--apx-fore: rgb(1, 2, 3);',
      });
      expect(token(scoped, '--_ag-text')).to.equal('rgb(17, 24, 39)');
    });

    it('reflects the designSystem and tokens properties as "off"', async () => {
      const grid = await mount();
      expect(grid.designSystem).to.be.true;
      expect(grid.tokens).to.be.true;
      expect(grid.hasAttribute('design-system')).to.be.false;
      expect(grid.hasAttribute('tokens')).to.be.false;
      grid.designSystem = false;
      grid.tokens = false;
      await elementUpdated(grid);
      expect(grid.getAttribute('design-system')).to.equal('off');
      expect(grid.getAttribute('tokens')).to.equal('off');
      expect(token(grid, '--_ag-brand')).to.equal('rgb(13, 111, 211)');
      grid.tokens = true;
      await elementUpdated(grid);
      expect(grid.hasAttribute('tokens')).to.be.false;
      grid.setAttribute('design-system', 'on');
      expect(grid.designSystem).to.be.true;
      grid.setAttribute('design-system', 'off');
      expect(grid.designSystem).to.be.false;
    });
  });

  it('keeps a multi-value --ag-radius while no radius factor is set', async () => {
    const grid = await mount({ style: '--ag-radius: 12px 12px 0 0;' });
    const cs = getComputedStyle(grid);
    expect(cs.borderTopLeftRadius).to.equal('12px');
    expect(cs.borderBottomLeftRadius).to.equal('0px');
    expect(cs.getPropertyValue('--_ag-radius').trim()).to.equal('12px 12px 0 0');
  });

  it('keeps the enterprise popups on their own colours (no overlay token)', async () => {
    await loadSheet('next-dark-material');
    const grid = await mount({ theme: 'dark' });
    const cs = getComputedStyle(grid);
    for (const name of ['--_ag-overlay', '--_ag-overlay-text', '--_ag-overlay-line']) {
      expect(cs.getPropertyValue(name).trim(), name).to.equal('');
    }
  });

  it('derives the popup colours once both overlay tokens are set', async () => {
    const grid = await mount({
      ancestor: '--ag-overlay: rgb(20, 20, 20); --ag-overlay-text: rgb(240, 240, 240);',
    });
    expect(token(grid, '--_ag-overlay')).to.equal('rgb(20, 20, 20)');
    expect(token(grid, '--_ag-overlay-text')).to.equal('rgb(240, 240, 240)');
    expect(token(grid, '--_ag-overlay-line')).to.equal(
      color('color-mix(in srgb, rgb(240, 240, 240) 16%, rgb(20, 20, 20))')
    );
  });
});
