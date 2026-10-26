import { expect } from '@open-wc/testing';
import { ApexGrid } from '../src/components/grid.js';
import { setup } from '../src/setup.js';

/**
 * `setup()`, the README quick start. Its flags are module state that lasts for
 * the page, and wtr gives each test file its own page, so the cases run in
 * order: the `hostStyles: false` opt-out first, then the default calls.
 */

const SIZING = 'min-height: 240px';

const sizingSheets = (root: Document | ShadowRoot): CSSStyleSheet[] =>
  root.adoptedStyleSheets.filter((sheet) =>
    [...sheet.cssRules].some((rule) => rule.cssText.includes(SIZING))
  );

/** An unsized shadow host holding one grid, the way a component library nests it. */
function gridInShadowRoot(): { host: HTMLElement; root: ShadowRoot; grid: ApexGrid<object> } {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const grid = document.createElement(ApexGrid.tagName) as ApexGrid<object>;
  root.append(grid);
  document.body.append(host);
  return { host, root, grid };
}

describe('setup()', () => {
  const hosts: HTMLElement[] = [];
  let warnings: unknown[][];
  // biome-ignore lint/suspicious/noConsole: spying on the theme deprecation warning
  const warn = console.warn;

  beforeEach(() => {
    warnings = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
  });

  afterEach(() => {
    console.warn = warn;
    for (const host of hosts.splice(0)) host.remove();
  });

  it('with hostStyles: false registers the grid and adopts no host sizing', async () => {
    expect(customElements.get(ApexGrid.tagName)).to.be.undefined;
    setup({ hostStyles: false });

    expect(customElements.get(ApexGrid.tagName)).to.equal(ApexGrid);
    expect(sizingSheets(document)).to.have.length(0);
    const { host, root, grid } = gridInShadowRoot();
    hosts.push(host);
    await grid.updateComplete;
    expect(sizingSheets(root)).to.have.length(0);
  });

  it('adopts the host sizing into the document once across repeated calls', () => {
    setup();
    setup();

    expect(sizingSheets(document)).to.have.length(1);
    expect(warnings).to.have.length(0);
  });

  it('sizes a grid inside a shadow root, adopting the sheet once per root', async () => {
    setup();
    const { host, root, grid } = gridInShadowRoot();
    hosts.push(host);
    const second = document.createElement(ApexGrid.tagName) as ApexGrid<object>;
    root.append(second);
    await Promise.all([grid.updateComplete, second.updateComplete]);

    expect(sizingSheets(root)).to.have.length(1);
    expect(getComputedStyle(grid).minHeight).to.equal('240px');
  });

  it('warns once that the theme option is inert', () => {
    setup({ theme: 'material' });
    setup({ theme: 'fluent' });

    expect(warnings).to.have.length(1);
    expect(String(warnings[0][0])).to.contain('setup({ theme })');
  });
});
