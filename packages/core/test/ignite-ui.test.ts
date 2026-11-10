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

/** The card: the 7.5 base surface, else surface 500. */
const igSurface = () => ig('--ig-surface-base, var(--ig-surface-500)');

/**
 * The dark header the add-on derives where the theme has no raised surface
 * (every 7.4 dark theme): the card lifted 6% toward the theme's text.
 */
const derivedHeader = () =>
  color(
    'color-mix(in srgb, var(--ig-gray-800, #fff) 6%, var(--ig-surface-base, var(--ig-surface-500)))'
  );

/** A computed colour's sRGB channels, 0 to 255 (`rgb()` or `color(srgb ...)`). */
function channels(value: string): number[] {
  const nums = (value.match(/-?[\d.]+/g) ?? []).map(Number);
  return value.startsWith('color(srgb') ? nums.slice(0, 3).map((n) => n * 255) : nums.slice(0, 3);
}

/** WCAG relative luminance of a computed colour. */
function luminance(value: string): number {
  const [r, g, b] = channels(value).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * A header that reads as raised over the card, about the built-in pair's
 * step (`#0f172a` card, `#1e2532` header: 1.16:1), and as neutral as the
 * card: no more blue than it.
 */
function expectRaisedOver(header: string, card: string): void {
  expect(header).not.to.equal(card);
  expect(header).not.to.equal(color('#1e2532'));
  const step = (luminance(header) + 0.05) / (luminance(card) + 0.05);
  expect(step, 'contrast step').to.be.within(1.1, 1.25);
  const [hr, , hb] = channels(header);
  const [cr, , cb] = channels(card);
  expect(hb - hr, 'blue tint').to.be.at.most(cb - cr + 2);
}

/**
 * Whether the grid took its dark block. The surface no longer tells (a dark
 * theme paints its own), so this reads a private colour only the dark block
 * sets: the default badge text.
 */
function isDarkGrid(grid: Grid): boolean {
  return token(grid, '--_ag-pill-neutral-text') === color('#a5b4fc');
}

describe('Ignite UI add-on', () => {
  afterEach(async () => {
    await loadSheet(null);
    for (const name of [
      '--apx-accent',
      '--apx-fore',
      '--apx-grid',
      '--apx-surface',
      '--apx-radius-factor',
      '--ig-surface-base',
      '--ig-surface-raised',
      '--ig-surface-500',
      '--ig-gray-800',
    ]) {
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
        // The card is the theme's surface, opaque.
        expect(token(grid, '--_ag-surface')).to.equal(ig('--ig-surface-500'));
        expect(token(grid, '--_ag-grid-bg')).to.equal(ig('--ig-surface-500'));
        expect(getComputedStyle(grid).backgroundColor).to.equal(ig('--ig-surface-500'));
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
        // 7.4 has no overlay role: the popups take the grid's dark header
        // colour, the derived step below, so they match the header.
        expect(token(grid, '--_ag-overlay')).to.equal(derivedHeader());
        expect(token(grid, '--_ag-overlay-text')).to.equal(color('#e2e8f0'));
        // 7.4 has no base role: the card is surface 500, never the built-in slate.
        const surface = ig('--ig-surface-500');
        expect(surface).not.to.equal(BUILT_IN.dark.surface);
        expect(token(grid, '--_ag-surface')).to.equal(surface);
        expect(token(grid, '--_ag-grid-bg')).to.equal(surface);
        expect(getComputedStyle(grid).backgroundColor).to.equal(surface);
        // The row hover mixes from it.
        expect(token(grid, '--_ag-row-hover')).to.equal(
          color(`color-mix(in srgb, #fff 7%, ${surface})`)
        );
        // 7.4 has no raised role either: the header lifts the card toward the
        // theme's text, a neutral step above it, never the built-in slate.
        const header = token(grid, '--_ag-surface-elevated');
        expect(header).to.equal(derivedHeader());
        expectRaisedOver(header, surface);
      });
    }

    for (const sheet of LIGHT_SHEETS) {
      it(`keeps the built-in light header under ${sheet}${where}`, async () => {
        await loadSheet(sheet);
        const grid = await mount({ shadow });
        // The header separator parts the header from the body there.
        expect(token(grid, '--_ag-surface-elevated')).to.equal(color('#f8f9fb'));
      });
    }

    it(`keeps the 7.5 raised surface for the header${where}`, async () => {
      await loadSheet('next-dark-material');
      const grid = await mount({ shadow });
      const raised = ig('--ig-surface-raised');
      expect(raised).not.to.equal(derivedHeader());
      expect(token(grid, '--_ag-surface-elevated')).to.equal(raised);
      // Without the raised role, the header derives from the card.
      root.style.setProperty('--ig-surface-raised', 'initial');
      expect(token(grid, '--_ag-surface-elevated')).to.equal(derivedHeader());
    });

    it(`takes the 7.5 base surface for the card${where}`, async () => {
      await loadSheet('next-dark-material');
      root.style.setProperty('--ig-surface-base', 'rgb(40, 41, 42)');
      const grid = await mount({ shadow });
      expect(isDarkGrid(grid)).to.be.true;
      // The base role wins over surface 500.
      expect(token(grid, '--_ag-surface')).to.equal('rgb(40, 41, 42)');
      expect(getComputedStyle(grid).backgroundColor).to.equal('rgb(40, 41, 42)');
      // As published, the base role is surface 500.
      root.style.removeProperty('--ig-surface-base');
      expect(token(grid, '--_ag-surface')).to.equal(ig('--ig-surface-500'));
    });

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

    it('an --ag-dark-surface beats the family surface, which beats the Ignite UI card', async () => {
      await loadSheet('dark-material');
      root.style.setProperty('--apx-surface', 'rgb(20, 21, 22)');
      const grid = await mount({ ancestor: '--ag-dark-surface: rgb(30, 31, 32);' });
      expect(token(grid, '--_ag-surface')).to.equal('rgb(30, 31, 32)');
      // --ag-dark-grid-bg is not set: the family surface is next, and the host paints it.
      expect(token(grid, '--_ag-grid-bg')).to.equal('rgb(20, 21, 22)');
      expect(getComputedStyle(grid).backgroundColor).to.equal('rgb(20, 21, 22)');
      // A light --ag-surface never lands on the dark grid.
      grid.style.setProperty('--ag-surface', 'rgb(250, 250, 250)');
      expect(token(grid, '--_ag-surface')).to.equal('rgb(30, 31, 32)');
      // Each dropped in turn, the next step applies.
      (grid.parentElement as HTMLElement).style.removeProperty('--ag-dark-surface');
      expect(token(grid, '--_ag-surface')).to.equal('rgb(20, 21, 22)');
      root.style.removeProperty('--apx-surface');
      expect(token(grid, '--_ag-surface')).to.equal(igSurface());
    });

    it('an --ag-dark-surface-elevated beats the 7.5 raised surface, which beats the derived header', async () => {
      await loadSheet('next-dark-material');
      const grid = await mount({ ancestor: '--ag-dark-surface-elevated: rgb(50, 51, 52);' });
      expect(token(grid, '--_ag-surface-elevated')).to.equal('rgb(50, 51, 52)');
      // A light --ag-surface-elevated never lands on the dark grid.
      grid.style.setProperty('--ag-surface-elevated', 'rgb(250, 250, 250)');
      expect(token(grid, '--_ag-surface-elevated')).to.equal('rgb(50, 51, 52)');
      // Each dropped in turn, the next step applies.
      (grid.parentElement as HTMLElement).style.removeProperty('--ag-dark-surface-elevated');
      expect(token(grid, '--_ag-surface-elevated')).to.equal(ig('--ig-surface-raised'));
      root.style.setProperty('--ig-surface-raised', 'initial');
      expect(token(grid, '--_ag-surface-elevated')).to.equal(derivedHeader());
    });

    it('an --ag-dark-surface-elevated beats the derived header on a 7.4 theme', async () => {
      await loadSheet('dark-indigo');
      const grid = await mount({ ancestor: '--ag-dark-surface-elevated: rgb(50, 51, 52);' });
      expect(token(grid, '--_ag-surface-elevated')).to.equal('rgb(50, 51, 52)');
      // The popups keep the derived colour, as they kept the built-in one
      // before; their own --ag-dark-overlay sets them.
      expect(token(grid, '--_ag-overlay')).to.equal(derivedHeader());
      grid.style.setProperty('--ag-dark-overlay', 'rgb(60, 61, 62)');
      expect(token(grid, '--_ag-overlay')).to.equal('rgb(60, 61, 62)');
    });

    it('derives the header from the card surface only, toward white without the gray', async () => {
      await loadSheet('dark-material');
      const grid = await mount();
      // No gray 800: the lift goes toward white.
      root.style.setProperty('--ig-gray-800', 'initial');
      expect(token(grid, '--_ag-surface-elevated')).to.equal(
        color(`color-mix(in srgb, #fff 6%, ${igSurface()})`)
      );
      root.style.removeProperty('--ig-gray-800');
      // No surface token at all: no derivation, the built-in header and card.
      root.style.setProperty('--ig-surface-500', 'initial');
      expect(token(grid, '--_ag-surface-elevated')).to.equal(color('#1e2532'));
      expect(token(grid, '--_ag-surface')).to.equal(BUILT_IN.dark.surface);
      // The popups fall back with the header.
      expect(token(grid, '--_ag-overlay')).to.equal(color('#1e2532'));
      // A 7.5 base surface alone is enough.
      root.style.setProperty('--ig-surface-base', 'rgb(40, 41, 42)');
      expect(token(grid, '--_ag-surface-elevated')).to.equal(
        color(`color-mix(in srgb, ${ig('--ig-gray-800')} 6%, rgb(40, 41, 42))`)
      );
    });

    it('keeps the built-in dark header on a dark variant with no surface tokens', async () => {
      const grid = await mount({ ancestor: '--ig-theme-variant: dark;' });
      expect(isDarkGrid(grid)).to.be.true;
      expect(token(grid, '--_ag-surface-elevated')).to.equal(color('#1e2532'));
      expect(token(grid, '--_ag-surface')).to.equal(BUILT_IN.dark.surface);
      expect(token(grid, '--_ag-overlay')).to.equal(color('#1e2532'));
    });

    it('an --ag-surface beats the Ignite UI card on a light grid', async () => {
      await loadSheet('light-bootstrap');
      const grid = await mount({ ancestor: '--ag-surface: rgb(250, 251, 252);' });
      expect(token(grid, '--_ag-surface')).to.equal('rgb(250, 251, 252)');
      expect(token(grid, '--_ag-grid-bg')).to.equal(igSurface());
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
      // The dark theme's surface never lands on the light grid.
      expect(token(grid, '--_ag-surface')).to.equal(BUILT_IN.light.surface);
      expect(getComputedStyle(grid).backgroundColor).to.equal(BUILT_IN.light.surface);
      // Nor is a header derived from it.
      expect(token(grid, '--_ag-surface-elevated')).to.equal(color('#f8f9fb'));
      // The variant-independent roles still follow Ignite UI.
      expect(token(grid, '--_ag-brand')).to.equal(primary());
    });

    it('theme="dark" under a light sheet keeps the built-in dark text', async () => {
      await loadSheet('light-bootstrap');
      const grid = await mount({ theme: 'dark' });
      expect(isDarkGrid(grid)).to.be.true;
      expect(token(grid, '--_ag-text')).to.equal(BUILT_IN.dark.text);
      // The light theme's surface never lands on the dark grid.
      expect(token(grid, '--_ag-surface')).to.equal(BUILT_IN.dark.surface);
      expect(getComputedStyle(grid).backgroundColor).to.equal(BUILT_IN.dark.surface);
      expect(token(grid, '--_ag-surface-elevated')).to.equal(color('#1e2532'));
      expect(token(grid, '--_ag-brand')).to.equal(primary());
      // No dark overlay default: the popups look as they do without the add-on.
      expect(getComputedStyle(grid).getPropertyValue('--_ag-overlay').trim()).to.equal('');
    });

    it('theme="dark" under a dark sheet takes the Ignite UI grays', async () => {
      await loadSheet('dark-fluent');
      const grid = await mount({ theme: 'dark' });
      expect(token(grid, '--_ag-text')).to.equal(ig('--ig-gray-800'));
      expect(token(grid, '--_ag-surface')).to.equal(igSurface());
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
      // The tinted header mixes the brand into the derived header.
      expect(token(dark, '--_ag-surface-elevated')).to.equal(
        color(`color-mix(in srgb, ${primary()} 20%, ${derivedHeader()})`)
      );
    });

    it('mixes the alternate rows from the Ignite UI card', async () => {
      await loadSheet('dark-fluent');
      const plain = await mount();
      expect(token(plain, '--_ag-surface-alt')).to.equal(igSurface());
      const tinted = await mount({ theme: 'tinted' });
      expect(isDarkGrid(tinted)).to.be.true;
      expect(token(tinted, '--_ag-surface')).to.equal(igSurface());
      expect(token(tinted, '--_ag-surface-alt')).to.equal(
        color(`color-mix(in srgb, ${primary()} 10%, ${igSurface()})`)
      );
      fixtureCleanup();
      await loadSheet('light-bootstrap');
      const light = await mount({ theme: 'tinted' });
      expect(isDarkGrid(light)).to.be.false;
      expect(token(light, '--_ag-surface-alt')).to.equal(
        color(`color-mix(in srgb, ${primary()} 4%, ${igSurface()})`)
      );
    });

    it('follows a theme swap live, without a reconnect', async () => {
      await loadSheet('light-bootstrap');
      const grid = await mount();
      expect(isDarkGrid(grid)).to.be.false;
      await loadSheet('dark-bootstrap');
      expect(isDarkGrid(grid)).to.be.true;
      expect(token(grid, '--_ag-surface')).to.equal(color('#212529'));
      await loadSheet('light-bootstrap');
      expect(isDarkGrid(grid)).to.be.false;
      expect(token(grid, '--_ag-surface')).to.equal(color('#f8f9fa'));
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

    it('design-system="off" restores the built-in card and header in both modes', async () => {
      await loadSheet('light-bootstrap');
      const light = await mount({ attrs: { 'design-system': 'off' } });
      expect(token(light, '--_ag-surface')).to.equal(BUILT_IN.light.surface);
      expect(getComputedStyle(light).backgroundColor).to.equal(BUILT_IN.light.surface);
      fixtureCleanup();
      await loadSheet('dark-material');
      const dark = await mount({ attrs: { 'design-system': 'off' } });
      expect(isDarkGrid(dark)).to.be.true;
      expect(token(dark, '--_ag-surface')).to.equal(BUILT_IN.dark.surface);
      expect(token(dark, '--_ag-grid-bg')).to.equal(BUILT_IN.dark.surface);
      expect(token(dark, '--_ag-surface-alt')).to.equal(BUILT_IN.dark.surface);
      expect(getComputedStyle(dark).backgroundColor).to.equal(BUILT_IN.dark.surface);
      // The header too.
      expect(token(dark, '--_ag-surface-elevated')).to.equal(color('#1e2532'));
      // Flipped back on at runtime, the theme's card and header apply at once.
      dark.removeAttribute('design-system');
      expect(token(dark, '--_ag-surface')).to.equal(igSurface());
      expect(token(dark, '--_ag-surface-elevated')).to.equal(derivedHeader());
    });

    it('the designSystem and tokens properties restore the built-in card and header too', async () => {
      await loadSheet('dark-material');
      const grid = await mount();
      expect(token(grid, '--_ag-surface')).to.equal(igSurface());
      expect(token(grid, '--_ag-surface-elevated')).to.equal(derivedHeader());
      grid.designSystem = false;
      await elementUpdated(grid);
      expect(token(grid, '--_ag-surface')).to.equal(BUILT_IN.dark.surface);
      expect(token(grid, '--_ag-surface-elevated')).to.equal(color('#1e2532'));
      grid.designSystem = true;
      grid.tokens = false;
      await elementUpdated(grid);
      // tokens="off" turns the variant off too: the built-in light card.
      expect(token(grid, '--_ag-surface')).to.equal(BUILT_IN.light.surface);
      expect(token(grid, '--_ag-surface-elevated')).to.equal(color('#f8f9fb'));
      expect(getComputedStyle(grid).backgroundColor).to.equal(BUILT_IN.light.surface);
      grid.setAttribute('theme', 'dark');
      expect(token(grid, '--_ag-surface')).to.equal(BUILT_IN.dark.surface);
      expect(token(grid, '--_ag-surface-elevated')).to.equal(color('#1e2532'));
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
