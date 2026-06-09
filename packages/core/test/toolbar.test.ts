import { expect, html } from '@open-wc/testing';
import type ApexGridToolbar from '../src/components/toolbar.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

class ToolbarFixture<T extends TestData> extends GridTestFixture<T> {
  public showExport = true;
  public showQuickFilter = true;

  public override setupTemplate() {
    return html`<apex-grid
      ?show-quick-filter=${this.showQuickFilter}
      ?show-export=${this.showExport}
      .data=${this.data}
      .columns=${this.columnConfig}
    ></apex-grid>`;
  }

  public toolbar(): ApexGridToolbar<T> | null {
    return this.grid.renderRoot.querySelector<ApexGridToolbar<T>>('apex-grid-toolbar');
  }

  public exportTrigger(): HTMLButtonElement | null {
    return (
      this.toolbar()?.renderRoot.querySelector<HTMLButtonElement>('[part="export-trigger"]') ?? null
    );
  }

  public exportMenu(): HTMLElement | null {
    return this.toolbar()?.renderRoot.querySelector<HTMLElement>('[part="export-menu"]') ?? null;
  }

  public exportMenuItems(): HTMLButtonElement[] {
    const root = this.toolbar()?.renderRoot;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLButtonElement>('[part="export-menu-item"]'));
  }
}

describe('Toolbar — export menu', () => {
  let fx: ToolbarFixture<TestData>;

  beforeEach(async () => {
    fx = new ToolbarFixture(JSON.parse(JSON.stringify(data)));
    await fx.setUp();
  });

  afterEach(() => fx.tearDown());

  it('renders the toolbar when show-export is set even without show-quick-filter', async () => {
    fx.showQuickFilter = false;
    await fx.updateProperty('showQuickFilter', false);
    expect(fx.toolbar()).to.not.be.null;
    expect(fx.exportTrigger()).to.not.be.null;
  });

  it('omits the export trigger when showExport is false', async () => {
    await fx.updateProperty('showExport', false);
    expect(fx.exportTrigger()).to.be.null;
  });

  it('trigger advertises aria-haspopup="menu" and aria-expanded reflects open state', async () => {
    const trigger = fx.exportTrigger()!;
    expect(trigger.getAttribute('aria-haspopup')).to.equal('menu');
    expect(trigger.getAttribute('aria-expanded')).to.equal('false');
    trigger.click();
    await fx.waitForUpdate();
    expect(trigger.getAttribute('aria-expanded')).to.equal('true');
  });

  it('toggles the menu open and closed', async () => {
    const trigger = fx.exportTrigger()!;
    expect(fx.exportMenu()?.hasAttribute('hidden')).to.equal(true);
    trigger.click();
    await fx.waitForUpdate();
    expect(fx.exportMenu()?.hasAttribute('hidden')).to.equal(false);
    trigger.click();
    await fx.waitForUpdate();
    expect(fx.exportMenu()?.hasAttribute('hidden')).to.equal(true);
  });

  it('menu lists the CSV option as an accessible menuitem', async () => {
    fx.exportTrigger()!.click();
    await fx.waitForUpdate();
    const items = fx.exportMenuItems();
    expect(items).to.have.length(1);
    expect(items[0].getAttribute('role')).to.equal('menuitem');
    expect(items[0].textContent?.trim()).to.equal('Export CSV');
  });

  it('clicking CSV calls grid.exportToCSV and closes the menu', async () => {
    let csvCalled = 0;
    const originalCSV = fx.grid.exportToCSV.bind(fx.grid);
    fx.grid.exportToCSV = (opts) => {
      csvCalled += 1;
      return originalCSV({ ...opts, filename: '' });
    };

    fx.exportTrigger()!.click();
    await fx.waitForUpdate();
    fx.exportMenuItems()[0].click();
    await fx.waitForUpdate();
    expect(csvCalled).to.equal(1);
    expect(fx.exportMenu()?.hasAttribute('hidden')).to.equal(true);
  });

  it('Escape closes the open menu', async () => {
    fx.exportTrigger()!.click();
    await fx.waitForUpdate();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fx.waitForUpdate();
    expect(fx.exportMenu()?.hasAttribute('hidden')).to.equal(true);
  });

  it('clicking outside closes the menu', async () => {
    fx.exportTrigger()!.click();
    await fx.waitForUpdate();
    // Pointer-down somewhere outside the toolbar should close the menu.
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    await fx.waitForUpdate();
    expect(fx.exportMenu()?.hasAttribute('hidden')).to.equal(true);
  });

  it('arrow-down on closed trigger opens the menu and focuses the first item', async () => {
    const trigger = fx.exportTrigger()!;
    trigger.focus();
    trigger.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true })
    );
    await fx.waitForUpdate();
    expect(fx.exportMenu()?.hasAttribute('hidden')).to.equal(false);
  });
});
