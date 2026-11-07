import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import 'apex-grid/ignite-ui';
import { loadIgniteSheet, resolveColor } from '../../../test-setup/ignite-ui.js';
import {
  ApexGridAI,
  ApexGridEnterprise,
  ApexGridFilterBuilder,
  ApexGridSetFilter,
  ApexGridStatusBar,
  ApexGridToolPanel,
  enterpriseModules,
} from '../src/index.js';
import { mountPopups, type Popups, popupLook } from './popups.js';

/**
 * The five companion popups with the grid's Ignite UI add-on (`apex-grid/ignite-ui`) loaded:
 * they take the grid's popup tokens, which follow the Ignite UI theme. Under a dark theme they go
 * dark with the grid (the 7.5 overlay surface when the theme has one, else the grid's own dark
 * popup colours); under a light one they keep their surfaces and take the theme's lines, accent
 * and font. `overlay-theme.test.ts` covers the page without the add-on.
 */

interface Row {
  id: number;
  department: string;
}
const data: Row[] = [
  { id: 1, department: 'Engineering' },
  { id: 2, department: 'Sales' },
];
const columns: ColumnConfiguration<Row>[] = [
  { key: 'id', type: 'number', headerText: 'ID' },
  { key: 'department', type: 'string', headerText: 'Department' },
];

async function mountGrid(attrs: Record<string, string> = {}) {
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`
  );
  for (const [name, value] of Object.entries(attrs)) grid.setAttribute(name, value);
  await grid.updateComplete;
  return grid;
}

const entries = (popups: Popups) => Object.entries(popups) as [keyof Popups, HTMLElement][];

describe('companion popups with the Ignite UI add-on', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    for (const el of [
      ApexGridFilterBuilder,
      ApexGridSetFilter,
      ApexGridAI,
      ApexGridToolPanel,
      ApexGridStatusBar,
    ]) {
      el.register();
    }
  });
  afterEach(async () => {
    for (const el of document.querySelectorAll('[data-popup]')) el.remove();
    await loadIgniteSheet(null);
    fixtureCleanup();
  });

  it('go dark with the grid under a dark 7.4 theme, on the grid dark popup colours', async () => {
    await loadIgniteSheet('dark-material');
    const popups = await mountPopups(await mountGrid());
    for (const [name, el] of entries(popups)) {
      const look = popupLook(el);
      expect(look.background, name).to.equal(resolveColor('#1e2532'));
      expect(look.color, name).to.equal(resolveColor('#e2e8f0'));
      expect(look.font, name).to.contain('Titillium Web');
    }
    // Lines are the theme's gray 300, as everywhere in the family.
    expect(getComputedStyle(popups.filterBuilder).borderTopColor).to.equal(
      resolveColor('var(--ig-gray-300)')
    );
  });

  it('take the 7.5 overlay surface when the theme has one', async () => {
    await loadIgniteSheet('next-dark-material');
    const popups = await mountPopups(await mountGrid());
    for (const [name, el] of entries(popups)) {
      expect(popupLook(el).background, name).to.equal(resolveColor('var(--ig-surface-overlay)'));
      expect(popupLook(el).color, name).to.equal(
        resolveColor('var(--ig-surface-overlay-contrast)')
      );
    }
  });

  it('keep their light surfaces under a light theme, with its lines and font', async () => {
    await loadIgniteSheet('light-bootstrap');
    const popups = await mountPopups(await mountGrid());
    expect(popupLook(popups.filterBuilder).background).to.equal('rgb(255, 255, 255)');
    expect(popupLook(popups.statusBar).background).to.equal('rgb(246, 247, 248)');
    expect(popupLook(popups.statusBar).font).to.contain('Segoe UI');
    expect(getComputedStyle(popups.filterBuilder).borderTopColor).to.equal(
      resolveColor('var(--ig-gray-300)')
    );
  });

  it('keep their built-in look with design-system="off" or tokens="off"', async () => {
    await loadIgniteSheet('light-bootstrap');
    const switches: Record<string, string>[] = [{ 'design-system': 'off' }, { tokens: 'off' }];
    for (const attrs of switches) {
      const popups = await mountPopups(await mountGrid(attrs));
      const look = popupLook(popups.statusBar);
      expect(look.background, JSON.stringify(attrs)).to.equal('rgb(246, 247, 248)');
      expect(look.font, JSON.stringify(attrs)).to.contain('system-ui');
      expect(getComputedStyle(popups.filterBuilder).borderTopColor).to.equal('rgb(216, 218, 222)');
      for (const el of document.querySelectorAll('[data-popup]')) el.remove();
    }
  });

  it('follow a live theme swap, with no re-render of their own', async () => {
    await loadIgniteSheet('light-material');
    const popups = await mountPopups(await mountGrid());
    expect(popupLook(popups.statusBar).background).to.equal('rgb(246, 247, 248)');
    expect(popupLook(popups.toolPanel).background).to.equal('rgb(246, 247, 248)');
    await loadIgniteSheet('dark-material');
    await nextFrame();
    await nextFrame();
    for (const [name, el] of entries(popups)) {
      expect(popupLook(el).background, name).to.equal(resolveColor('#1e2532'));
    }
    await loadIgniteSheet('light-material');
    await nextFrame();
    await nextFrame();
    expect(popupLook(popups.statusBar).background).to.equal('rgb(246, 247, 248)');
  });

  it('follow the grid theme attribute and switches flipped at runtime', async () => {
    await loadIgniteSheet('dark-material');
    const grid = await mountGrid();
    const popups = await mountPopups(grid);
    expect(popupLook(popups.statusBar).background).to.equal(resolveColor('#1e2532'));
    (grid as unknown as HTMLElement).setAttribute('theme', 'light');
    await nextFrame();
    await nextFrame();
    expect(popupLook(popups.statusBar).background).to.equal('rgb(246, 247, 248)');
    (grid as unknown as HTMLElement).removeAttribute('theme');
    (grid as unknown as HTMLElement).setAttribute('tokens', 'off');
    await nextFrame();
    await nextFrame();
    expect(popupLook(popups.statusBar).font).to.contain('system-ui');
  });

  it('keep the light popups of a theme="light" grid under a dark theme', async () => {
    await loadIgniteSheet('dark-material');
    const popups = await mountPopups(await mountGrid({ theme: 'light' }));
    expect(popupLook(popups.toolPanel).background).to.equal('rgb(246, 247, 248)');
    expect(popupLook(popups.toolPanel).color).to.equal('rgb(31, 35, 40)');
  });
});
