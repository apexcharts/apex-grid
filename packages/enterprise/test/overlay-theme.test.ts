import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { resolveColor } from '../../../test-setup/ignite-ui.js';
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
 * The five companion popups (filter builder, set filter, AI panel, tool panel,
 * status bar) read the grid's popup tokens, `--ag-overlay` and
 * `--ag-overlay-text`, carried from the grid they are bound to. Unset, each
 * keeps the colours it always had. This file never loads the Ignite UI add-on.
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

async function mountGrid(style = '', theme = '') {
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`
  );
  if (style) (grid as unknown as HTMLElement).style.cssText = style;
  if (theme) (grid as unknown as HTMLElement).setAttribute('theme', theme);
  await grid.updateComplete;
  return grid;
}

/** Today's colours, pinned: host background and text, a separator and the muted text. */
const BUILT_IN: Record<keyof Popups, { background: string; color: string }> = {
  filterBuilder: { background: 'rgb(255, 255, 255)', color: 'rgb(31, 35, 40)' },
  setFilter: { background: 'rgb(255, 255, 255)', color: 'rgb(31, 35, 40)' },
  ai: { background: 'rgb(255, 255, 255)', color: 'rgb(31, 35, 40)' },
  toolPanel: { background: 'rgb(246, 247, 248)', color: 'rgb(31, 35, 40)' },
  statusBar: { background: 'rgb(246, 247, 248)', color: 'rgb(58, 63, 69)' },
};

describe('companion popups follow the grid popup tokens', () => {
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
  afterEach(() => {
    for (const el of document.querySelectorAll('[data-popup]')) el.remove();
    fixtureCleanup();
  });

  for (const theme of ['', 'dark']) {
    it(`keeps today's colours with no token set${theme ? ' on a dark grid' : ''}`, async () => {
      const popups = await mountPopups(await mountGrid('', theme));
      for (const [name, el] of Object.entries(popups) as [keyof Popups, HTMLElement][]) {
        const look = popupLook(el);
        expect({ background: look.background, color: look.color }, name).to.eql(BUILT_IN[name]);
        expect(look.font, name).to.contain('system-ui');
      }
      // Separators and muted text keep their own literals.
      expect(getComputedStyle(popups.filterBuilder).borderTopColor).to.equal('rgb(216, 218, 222)');
      // A form control keeps the browser's own colours.
      const reference = document.createElement('input');
      document.body.append(reference);
      const search =
        popups.setFilter.shadowRoot!.querySelector<HTMLInputElement>('[part="search"]')!;
      expect(getComputedStyle(search).color).to.equal(getComputedStyle(reference).color);
      expect(getComputedStyle(search).backgroundColor).to.equal(
        getComputedStyle(reference).backgroundColor
      );
      reference.remove();
    });
  }

  it('takes --ag-overlay and --ag-overlay-text from the bound grid', async () => {
    const popups = await mountPopups(
      await mountGrid('--ag-overlay: rgb(20, 20, 20); --ag-overlay-text: rgb(240, 240, 240);')
    );
    const line = resolveColor('color-mix(in srgb, rgb(240, 240, 240) 16%, rgb(20, 20, 20))');
    for (const [name, el] of Object.entries(popups)) {
      const look = popupLook(el as HTMLElement);
      expect(look.background, name).to.equal('rgb(20, 20, 20)');
      expect(look.color, name).to.equal('rgb(240, 240, 240)');
    }
    expect(getComputedStyle(popups.filterBuilder).borderTopColor).to.equal(line);
    const search = popups.setFilter.shadowRoot!.querySelector<HTMLInputElement>('[part="search"]')!;
    expect(getComputedStyle(search).backgroundColor).to.equal('rgb(20, 20, 20)');
    expect(getComputedStyle(search).color).to.equal('rgb(240, 240, 240)');
  });

  it('reads the dark twins on a dark grid, and ignores the light ones there', async () => {
    const popups = await mountPopups(
      await mountGrid(
        '--ag-overlay: white; --ag-overlay-text: black; --ag-dark-overlay: rgb(20, 20, 20); --ag-dark-overlay-text: rgb(240, 240, 240);',
        'dark'
      )
    );
    expect(popupLook(popups.toolPanel).background).to.equal('rgb(20, 20, 20)');
  });

  it('follows the grid theme attribute flipped at runtime, with no re-render', async () => {
    const root = document.documentElement;
    root.style.setProperty('--ag-dark-overlay', 'rgb(20, 20, 20)');
    root.style.setProperty('--ag-dark-overlay-text', 'rgb(240, 240, 240)');
    try {
      const grid = await mountGrid();
      const popups = await mountPopups(grid);
      expect(popupLook(popups.statusBar).background).to.equal(BUILT_IN.statusBar.background);
      (grid as unknown as HTMLElement).setAttribute('theme', 'dark');
      await nextFrame();
      await nextFrame();
      expect(popupLook(popups.statusBar).background).to.equal('rgb(20, 20, 20)');
      expect(popupLook(popups.toolPanel).background).to.equal('rgb(20, 20, 20)');
      // Unbound, a companion stops following: no watcher outlives its grid.
      (popups.toolPanel as unknown as { grid: unknown }).grid = null;
      await popups.toolPanel.updateComplete;
      (grid as unknown as HTMLElement).removeAttribute('theme');
      await nextFrame();
      await nextFrame();
      expect(popupLook(popups.statusBar).background).to.equal(BUILT_IN.statusBar.background);
      expect(popupLook(popups.toolPanel).background).to.equal(BUILT_IN.toolPanel.background);
    } finally {
      root.style.removeProperty('--ag-dark-overlay');
      root.style.removeProperty('--ag-dark-overlay-text');
    }
  });

  it('follows a token change on an ancestor, with no re-render', async () => {
    const grid = await mountGrid();
    const popups = await mountPopups(grid);
    const parent = (grid as unknown as HTMLElement).parentElement!;
    parent.style.setProperty('--ag-overlay', 'rgb(20, 20, 20)');
    parent.style.setProperty('--ag-overlay-text', 'rgb(240, 240, 240)');
    await nextFrame();
    await nextFrame();
    expect(popupLook(popups.statusBar).background).to.equal('rgb(20, 20, 20)');
  });

  it('gives a popup its own colours back when the grid drops the tokens', async () => {
    const grid = await mountGrid(
      '--ag-overlay: rgb(20, 20, 20); --ag-overlay-text: rgb(240, 240, 240);'
    );
    const popups = await mountPopups(grid);
    expect(popupLook(popups.statusBar).background).to.equal('rgb(20, 20, 20)');
    (grid as unknown as HTMLElement).style.cssText = '';
    popups.statusBar.requestUpdate();
    await popups.statusBar.updateComplete;
    await nextFrame();
    expect(popupLook(popups.statusBar).background).to.equal(BUILT_IN.statusBar.background);
  });
});
