import { aTimeout, elementUpdated, expect, html } from '@open-wc/testing';
import 'axe-core';
import type { ApexGrid } from '../src/components/grid.js';
import type { ColumnConfiguration } from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

class A11yFixture extends GridTestFixture<TestData> {
  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number', sort: true, filter: true },
      { key: 'name', sort: true, filter: true },
      { key: 'active', type: 'boolean', sort: true },
      { key: 'importance' },
    ] as ColumnConfiguration<TestData>[];
  }

  public override setupTemplate() {
    return html`<apex-grid
      .data=${this.data}
      .columns=${this.columnConfig}
      .selection=${{ enabled: true, mode: 'multiple', showCheckboxColumn: true }}
      .expansion=${{
        enabled: true,
        detailTemplate: ({ data }: { data: TestData }) => html`<span>${data.id}</span>`,
      }}
    ></apex-grid>`;
  }

  /** The element with the grid role (the host carries none). */
  public table(): HTMLElement {
    return this.grid.renderRoot.querySelector<HTMLElement>('[part~="table"]')!;
  }

  public liveRegion(): HTMLElement | null {
    return this.grid.renderRoot.querySelector<HTMLElement>('[part="live-region"]');
  }

  public sortButtonFor(key: keyof TestData): HTMLButtonElement | null {
    const header = this.headers.get(key as never).element;
    return header.renderRoot.querySelector<HTMLButtonElement>('button[part~="action"]');
  }

  public conditionTrigger(): HTMLButtonElement | null {
    const fr = this.filterRow.element as unknown as { renderRoot: ShadowRoot };
    return fr.renderRoot.querySelector<HTMLButtonElement>('[part="condition-trigger"]');
  }
}

describe('Accessibility (WCAG 2.2 AA semantics)', () => {
  let fx: A11yFixture;

  beforeEach(async () => {
    fx = new A11yFixture(JSON.parse(JSON.stringify(data)));
    await fx.setUp();
  });

  afterEach(() => fx.tearDown());

  describe('grid roles + counts', () => {
    it('the table part carries the grid role, aria-rowcount and aria-colcount', async () => {
      await fx.waitForUpdate();
      // Master-detail rows expand, so the role is treegrid (see ARIA structure).
      expect(fx.table().getAttribute('role')).to.equal('treegrid');
      // 1 header + 8 data = 9 rows: the filter panel is an overlay, not a row.
      expect(fx.table().getAttribute('aria-rowcount')).to.equal('9');
      // 4 data columns + selection + expansion = 6.
      expect(fx.table().getAttribute('aria-colcount')).to.equal('6');
      for (const attr of ['role', 'aria-rowcount', 'aria-colcount', 'aria-label']) {
        expect(fx.grid.hasAttribute(attr), `host ${attr}`).to.be.false;
      }
    });

    it('header row exposes role="row" + aria-rowindex="1"', () => {
      expect(fx.headerRow.getAttribute('role')).to.equal('row');
      expect(fx.headerRow.getAttribute('aria-rowindex')).to.equal('1');
    });

    it('the header row is not a tab stop', () => {
      expect(fx.headerRow.hasAttribute('tabindex')).to.be.false;
      expect(fx.headerRow.tabIndex).to.equal(-1);
    });

    it('body rows expose role="row" + aria-rowindex starting after the header row', async () => {
      await fx.waitForUpdate();
      const first = fx.grid.rows[0] as unknown as HTMLElement;
      expect(first.getAttribute('role')).to.equal('row');
      // The filter panel is a floating overlay (not a table row), so body rows
      // immediately follow the header row (index 1) at index 2.
      expect(first.getAttribute('aria-rowindex')).to.equal('2');
    });

    it('header cells expose role="columnheader" + aria-colindex starting after auto chrome', () => {
      const idHeader = fx.headers.get('id').element;
      expect(idHeader.getAttribute('role')).to.equal('columnheader');
      // selection col is 1, expansion col is 2, so id is 3.
      expect(idHeader.getAttribute('aria-colindex')).to.equal('3');
    });

    it('body cells expose role="gridcell" + aria-colindex', async () => {
      await fx.waitForUpdate();
      const row = fx.grid.rows[0] as unknown as { renderRoot: ShadowRoot };
      const firstDataCell = row.renderRoot.querySelectorAll('apex-grid-cell')[0] as HTMLElement;
      expect(firstDataCell.getAttribute('role')).to.equal('gridcell');
      expect(firstDataCell.getAttribute('aria-colindex')).to.equal('3');
    });
  });

  describe('selection + expansion ARIA reflections', () => {
    it('aria-selected reflects row selection', async () => {
      const row = fx.grid.rows[0] as unknown as HTMLElement;
      expect(row.getAttribute('aria-selected')).to.equal('false');
      await fx.grid.selectRow(fx.grid.data[0]);
      await fx.waitForUpdate();
      expect(row.getAttribute('aria-selected')).to.equal('true');
    });

    it('aria-expanded reflects row expansion', async () => {
      const row = fx.grid.rows[0] as unknown as HTMLElement;
      expect(row.getAttribute('aria-expanded')).to.equal('false');
      await fx.grid.expandRow(fx.grid.data[0]);
      await fx.waitForUpdate();
      expect(row.getAttribute('aria-expanded')).to.equal('true');
    });

    it('aria-current marks the active cell only', async () => {
      const row = fx.grid.rows[0] as unknown as { renderRoot: ShadowRoot };
      const firstDataCell = row.renderRoot.querySelectorAll('apex-grid-cell')[0] as HTMLElement;
      firstDataCell.click();
      await fx.waitForUpdate();
      expect(firstDataCell.getAttribute('aria-current')).to.equal('true');
    });
  });

  describe('sort semantics', () => {
    it('headers expose aria-sort="none" by default and update on sort', async () => {
      const header = fx.headers.get('name').element;
      expect(header.getAttribute('aria-sort')).to.equal('none');
      await fx.sort({ key: 'name', direction: 'ascending' });
      await fx.waitForUpdate();
      expect(header.getAttribute('aria-sort')).to.equal('ascending');
      await fx.sort({ key: 'name', direction: 'descending' });
      await fx.waitForUpdate();
      expect(header.getAttribute('aria-sort')).to.equal('descending');
    });

    it('sort indicator is a real <button> with an aria-label', async () => {
      const button = fx.sortButtonFor('name');
      expect(button).to.not.be.null;
      expect(button!.tagName).to.equal('BUTTON');
      expect(button!.getAttribute('aria-label')).to.match(/sort/i);
    });
  });

  describe('filter dropdown semantics', () => {
    it('condition trigger exposes aria-haspopup="listbox"', async () => {
      // Activate the filter row by clicking an inactive filter chip so the
      // active state (with the dropdown trigger) renders.
      fx.filterRow.open('id' as never);
      await fx.waitForUpdate();
      const trigger = fx.conditionTrigger();
      expect(trigger).to.not.be.null;
      expect(trigger!.getAttribute('aria-haspopup')).to.equal('listbox');
      expect(trigger!.getAttribute('aria-expanded')).to.equal('false');
    });
  });

  describe('live region announcements', () => {
    it('announces UI-driven sort changes through the polite live region', async () => {
      // UI-driven sort goes through sortFromHeaderClick which announces.
      await fx.sortHeader('name');
      await aTimeout(0);
      await elementUpdated(fx.grid);
      const region = fx.liveRegion();
      expect(region).to.not.be.null;
      expect(region!.getAttribute('aria-live')).to.equal('polite');
      expect(region!.textContent ?? '').to.match(/sorted by name/i);
    });

    it('announces row selection counts', async () => {
      await fx.grid.selectRow(fx.grid.data[0]);
      await aTimeout(0);
      await elementUpdated(fx.grid);
      expect(fx.liveRegion()!.textContent ?? '').to.match(/1 row selected/i);
    });

    it('grid.announce() updates the live region directly', async () => {
      fx.grid.announce('Hello AT');
      await aTimeout(0);
      await elementUpdated(fx.grid);
      expect(fx.liveRegion()!.textContent?.trim() ?? '').to.equal('Hello AT');
    });

    it('announces the same message twice with a different accessible text', async () => {
      fx.grid.announce('Saved');
      await fx.waitForUpdate();
      const first = fx.liveRegion()!.innerText;
      fx.grid.announce('Saved');
      await fx.waitForUpdate();
      // innerText collapses whitespace the way the accessible text does.
      expect(fx.liveRegion()!.innerText).to.not.equal(first);
      expect(fx.liveRegion()!.innerText.replace('\u200B', '')).to.equal(first);
    });

    it('announces filter apply and clear with the column label', async () => {
      fx.filterRow.open('id' as never);
      await fx.waitForUpdate();
      fx.filterRow.fireInputEvent('1');
      await aTimeout(20);
      await elementUpdated(fx.grid);
      expect(fx.liveRegion()!.textContent ?? '').to.match(/filter applied to id/i);

      fx.filterRow.reset();
      await aTimeout(20);
      await elementUpdated(fx.grid);
      expect(fx.liveRegion()!.textContent ?? '').to.match(/filter cleared on id/i);
    });

    it('localizes announcements through localeText overrides', async () => {
      fx.grid.localeText = { 'announce.rowSelected': 'Fila seleccionada' };
      await elementUpdated(fx.grid);
      await fx.grid.selectRow(fx.grid.data[0]);
      await aTimeout(0);
      await elementUpdated(fx.grid);
      expect(fx.liveRegion()!.textContent ?? '').to.match(/fila seleccionada/i);
    });
  });

  describe('table semantics', () => {
    it('exposes aria-multiselectable in multiple selection mode', async () => {
      await fx.waitForUpdate();
      expect(fx.table().getAttribute('aria-multiselectable')).to.equal('true');
    });

    it('applies a default accessible name and yields to an author-provided one', async () => {
      await fx.waitForUpdate();
      expect(fx.table().getAttribute('aria-label')).to.equal('Data grid');
      // An attribute change on the host is picked up without a render request.
      fx.grid.setAttribute('aria-label', 'People');
      await fx.waitForUpdate();
      expect(fx.table().getAttribute('aria-label')).to.equal('People');
      fx.grid.removeAttribute('aria-label');
      await fx.waitForUpdate();
      expect(fx.table().getAttribute('aria-label')).to.equal('Data grid');
    });
  });

  describe('keyboard navigation focus model', () => {
    function deepActive(): Element | null {
      let el: Element | null = document.activeElement;
      while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
      return el;
    }

    function keydown(target: Element, key: string, init: KeyboardEventInit = {}) {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, composed: true, ...init })
      );
    }

    /** Waits out the render + double rAF used by the focus-follow plumbing. */
    async function settleFocus() {
      await elementUpdated(fx.grid);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))
      );
    }

    function bodyCells(rowIndex: number): HTMLElement[] {
      const row = fx.grid.rows.find(
        (r) => (r as unknown as { index: number }).index === rowIndex
      ) as unknown as { renderRoot: ShadowRoot };
      return Array.from(row.renderRoot.querySelectorAll('apex-grid-cell'));
    }

    it('clicking a cell makes it the roving tab stop with real focus', async () => {
      await fx.waitForUpdate();
      const cell = bodyCells(0)[0];
      cell.click();
      await settleFocus();
      expect(cell.tabIndex).to.equal(0);
      expect(deepActive()).to.equal(cell);
    });

    it('the scroll container yields its tab stop to the active cell (no keyboard trap)', async () => {
      await fx.waitForUpdate();
      const body = fx.grid.renderRoot.querySelector<HTMLElement>('apex-virtualizer');
      expect(body!.tabIndex).to.equal(0);
      bodyCells(0)[0].click();
      await settleFocus();
      expect(body!.tabIndex).to.equal(-1);
    });

    it('arrow keys move real focus with the active cell', async () => {
      await fx.waitForUpdate();
      const [first, second] = bodyCells(0);
      first.click();
      await settleFocus();
      keydown(first, 'ArrowRight');
      await settleFocus();
      expect(deepActive()).to.equal(second);
      expect(second.tabIndex).to.equal(0);
      expect(first.tabIndex).to.equal(-1);
    });

    it('Home / End move to the first / last cell in the row', async () => {
      await fx.waitForUpdate();
      const cells = bodyCells(0);
      cells[1].click();
      await settleFocus();
      keydown(deepActive()!, 'End');
      await settleFocus();
      expect(deepActive()).to.equal(cells[cells.length - 1]);
      keydown(deepActive()!, 'Home');
      await settleFocus();
      expect(deepActive()).to.equal(cells[0]);
    });

    it('Ctrl+End / Ctrl+Home jump to the grid corners', async () => {
      await fx.waitForUpdate();
      bodyCells(0)[0].click();
      await settleFocus();
      keydown(deepActive()!, 'End', { ctrlKey: true });
      await settleFocus();
      const lastRowCells = bodyCells(fx.grid.data.length - 1);
      expect(deepActive()).to.equal(lastRowCells[lastRowCells.length - 1]);
      keydown(deepActive()!, 'Home', { ctrlKey: true });
      await settleFocus();
      expect(deepActive()).to.equal(bodyCells(0)[0]);
    });

    it('PageDown / PageUp move the active row by a viewport page (clamped)', async () => {
      await fx.waitForUpdate();
      bodyCells(0)[0].click();
      await settleFocus();
      keydown(deepActive()!, 'PageDown');
      await settleFocus();
      const lastRow = fx.grid.data.length - 1;
      expect(deepActive()).to.equal(bodyCells(lastRow)[0]);
      keydown(deepActive()!, 'PageUp');
      await settleFocus();
      expect(deepActive()).to.equal(bodyCells(0)[0]);
    });

    it('Enter / F2 open the editor on the active cell; Escape returns focus to it', async () => {
      fx.grid.editing = { enabled: true } as never;
      fx.grid.columns = fx.grid.columns.map((c) => ({ ...c, editable: true })) as never;
      await elementUpdated(fx.grid);
      await fx.waitForUpdate();

      const cell = bodyCells(0)[1];
      cell.click();
      await settleFocus();

      keydown(cell, 'Enter');
      await settleFocus();
      expect(cell.hasAttribute('editing')).to.equal(true);
      const editor = (cell as unknown as { renderRoot: ShadowRoot }).renderRoot.querySelector(
        'input'
      );
      expect(editor).to.not.be.null;
      expect(deepActive()).to.equal(editor);

      keydown(editor!, 'Escape');
      await settleFocus();
      expect(cell.hasAttribute('editing')).to.equal(false);
      expect(deepActive()).to.equal(cell);

      keydown(cell, 'F2');
      await settleFocus();
      expect(cell.hasAttribute('editing')).to.equal(true);
    });
  });

  describe('filter condition listbox keyboard', () => {
    function deepActive(): Element | null {
      let el: Element | null = document.activeElement;
      while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
      return el;
    }

    async function frames() {
      await elementUpdated(fx.grid);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))
      );
    }

    it('ArrowDown on the trigger opens the listbox and focuses an option', async () => {
      fx.filterRow.open('id' as never);
      await fx.waitForUpdate();
      const trigger = fx.filterRow.dropdownTarget;
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await frames();
      expect(fx.filterRow.dropdown.hidden).to.equal(false);
      const active = deepActive() as HTMLElement;
      expect(active?.getAttribute('role')).to.equal('option');
    });

    it('arrows move between options and Enter picks the focused one', async () => {
      fx.filterRow.open('id' as never);
      await fx.waitForUpdate();
      fx.filterRow.dropdownTarget.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
      );
      await frames();
      const first = deepActive() as HTMLElement;
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await frames();
      const second = deepActive() as HTMLElement;
      expect(second).to.not.equal(first);
      const picked = second.dataset.value;
      second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await frames();
      expect(fx.filterRow.dropdown.hidden).to.equal(true);
      expect(fx.filterRow.dropdownTarget.getAttribute('aria-expanded')).to.equal('false');
      expect(
        (fx.filterRow.element as unknown as { condition: { name: string } }).condition.name
      ).to.equal(picked);
    });
  });

  describe('column menu keyboard', () => {
    function deepActive(): Element | null {
      let el: Element | null = document.activeElement;
      while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
      return el;
    }

    async function frames() {
      await elementUpdated(fx.grid);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))
      );
    }

    it('ArrowDown on the kebab opens the menu and focuses the first item; Escape closes and restores focus', async () => {
      const header = fx.headers.get('name' as never).element;
      const menuBtn = header.renderRoot.querySelector<HTMLElement>('[part~="menu-btn"]');
      expect(menuBtn).to.not.be.null;

      menuBtn!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await frames();
      const menu = header.renderRoot.querySelector<HTMLElement>('[part="col-menu"]');
      expect(menu).to.not.be.null;
      const active = deepActive() as HTMLElement;
      expect(active?.getAttribute('role')).to.equal('menuitem');

      active.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })
      );
      await frames();
      expect(header.renderRoot.querySelector('[part="col-menu"]')).to.be.null;
      expect(deepActive()).to.equal(menuBtn);
    });
  });
});

interface AxeResult {
  violations: { id: string; nodes: { target: string[]; failureSummary: string }[] }[];
}
const axe = (window as any).axe as { run(context: Element): Promise<AxeResult> };

/** Every axe violation inside `el`, one line each, so a failure names the rule and node. */
async function axeViolations(el: Element): Promise<string[]> {
  const { violations } = await axe.run(el);
  return violations.flatMap(({ id, nodes }) =>
    nodes.map((node) => `${id}: ${node.target.join(' ')}: ${node.failureSummary}`)
  );
}

/** A grid with the given properties on top of the test data and columns. */
class StructureFixture extends GridTestFixture<TestData> {
  constructor(
    private props: Partial<ApexGrid<TestData>>,
    columns?: ColumnConfiguration<TestData>[]
  ) {
    super(JSON.parse(JSON.stringify(data)));
    if (columns) this.columnConfig = columns;
  }

  public override async setUp() {
    await super.setUp();
    Object.assign(this.grid, this.props);
    await this.waitForUpdate();
  }

  public table(): HTMLElement {
    return this.grid.renderRoot.querySelector<HTMLElement>('[part~="table"]')!;
  }

  public row(index: number): HTMLElement {
    return this.grid.rows[index] as unknown as HTMLElement;
  }

  public rowPart(index: number, part: string): HTMLElement | null {
    const row = this.grid.rows[index] as unknown as { renderRoot: ShadowRoot };
    return row.renderRoot.querySelector<HTMLElement>(`[part~="${part}"]`);
  }
}

const detailTemplate = ({ data: row }: { data: TestData }) => html`<p>Details of ${row.name}</p>`;

describe('ARIA structure', () => {
  let fx: StructureFixture;
  afterEach(() => fx.tearDown());

  async function mount(
    props: Partial<ApexGrid<TestData>>,
    columns?: ColumnConfiguration<TestData>[]
  ) {
    fx = new StructureFixture(props, columns);
    await fx.setUp();
    return fx;
  }

  describe('axe', () => {
    it('a default grid has no violations', async () => {
      await mount({});
      expect(fx.table().getAttribute('role')).to.equal('grid');
      expect(await axeViolations(fx.grid)).to.eql([]);
    });

    it('a grid with a toolbar, a filter column and pagination has no violations', async () => {
      await mount(
        { showQuickFilter: true, showExport: true, pagination: { enabled: true, pageSize: 3 } },
        [{ key: 'id', filter: true }, { key: 'name' }]
      );
      expect(await axeViolations(fx.grid)).to.eql([]);
    });

    it('a tree grid has no violations', async () => {
      await mount({
        tree: {
          enabled: true,
          getDataPath: (row: TestData) => (row.id === 1 ? ['1'] : ['1', String(row.id)]),
        },
      });
      expect(fx.table().getAttribute('role')).to.equal('treegrid');
      expect(await axeViolations(fx.grid)).to.eql([]);
    });

    it('a master-detail grid with an expanded row has no violations', async () => {
      await mount({
        selection: { enabled: true, mode: 'multiple', showCheckboxColumn: true },
        expansion: { enabled: true, detailTemplate, isExpandable: (row: TestData) => row.id !== 2 },
      });
      await fx.grid.expandRow(fx.grid.data[0]);
      await fx.waitForUpdate();
      expect(await axeViolations(fx.grid)).to.eql([]);
    });
  });

  describe('grid role', () => {
    it('owns only rows: toolbar, filter panel, paginator and live region sit outside', async () => {
      await mount({ showQuickFilter: true, pagination: { enabled: true, pageSize: 3 } }, [
        { key: 'id', filter: true },
        { key: 'name' },
      ]);
      const table = fx.table();
      const root = fx.grid.renderRoot;
      for (const selector of [
        'apex-grid-toolbar',
        'apex-filter-row',
        'apex-grid-paginator',
        '[part="live-region"]',
      ]) {
        const el = root.querySelector(selector);
        expect(el, selector).to.exist;
        expect(table.contains(el), selector).to.be.false;
      }
      expect(table.contains(fx.headerRow)).to.be.true;
      expect(fx.gridBody.getAttribute('role')).to.equal('rowgroup');
      expect(fx.grid.hasAttribute('role')).to.be.false;
    });

    it('is a treegrid only while rows can expand into a detail', async () => {
      await mount({ expansion: { enabled: true } });
      expect(fx.table().getAttribute('role')).to.equal('grid');
      fx.grid.expansion = { enabled: true, detailTemplate };
      await fx.waitForUpdate();
      expect(fx.table().getAttribute('role')).to.equal('treegrid');
    });
  });

  describe('accessible name', () => {
    let label: HTMLElement;
    let hint: HTMLElement;

    beforeEach(() => {
      label = Object.assign(document.createElement('h2'), { id: 'people', textContent: 'People' });
      hint = Object.assign(document.createElement('p'), { id: 'hint', textContent: 'Staff list' });
      document.body.append(label, hint);
    });

    afterEach(() => {
      label.remove();
      hint.remove();
    });

    it('resolves the host aria-labelledby and aria-describedby by element reflection', async () => {
      await mount({});
      fx.grid.setAttribute('aria-labelledby', 'people');
      fx.grid.setAttribute('aria-describedby', 'hint');
      await fx.waitForUpdate();
      const table = fx.table() as HTMLElement & {
        ariaLabelledByElements: Element[] | null;
        ariaDescribedByElements: Element[] | null;
      };
      expect('ariaLabelledByElements' in Element.prototype, 'reflection in the test browser').to.be
        .true;
      expect(table.ariaLabelledByElements).to.eql([label]);
      expect(table.ariaDescribedByElements).to.eql([hint]);

      fx.grid.removeAttribute('aria-labelledby');
      await fx.waitForUpdate();
      expect(table.ariaLabelledByElements).to.equal(null);
      expect(table.getAttribute('aria-label')).to.equal('Data grid');
    });

    it('resolves a labelling element added later once the attribute is set again', async () => {
      await mount({});
      fx.grid.setAttribute('aria-labelledby', 'late');
      await fx.waitForUpdate();
      const table = fx.table() as HTMLElement & { ariaLabelledByElements: Element[] | null };
      expect(table.ariaLabelledByElements).to.equal(null);

      const late = Object.assign(document.createElement('h2'), { id: 'late', textContent: 'Late' });
      document.body.append(late);
      try {
        // As documented in the README: references resolve at render time.
        fx.grid.setAttribute('aria-labelledby', 'late');
        await aTimeout(0);
        await fx.waitForUpdate();
        expect(table.ariaLabelledByElements).to.eql([late]);
      } finally {
        late.remove();
      }
    });

    it('copies the referenced text where the browser has no element reflection', async () => {
      const proto = Element.prototype as unknown as Record<string, unknown>;
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'ariaLabelledByElements');
      delete proto.ariaLabelledByElements;
      try {
        await mount({});
        fx.grid.setAttribute('aria-labelledby', 'people');
        fx.grid.setAttribute('aria-describedby', 'hint');
        await fx.waitForUpdate();
        expect(fx.table().getAttribute('aria-label')).to.equal('People');
        expect(fx.table().getAttribute('aria-description')).to.equal('Staff list');
      } finally {
        if (descriptor) Object.defineProperty(proto, 'ariaLabelledByElements', descriptor);
      }
    });
  });

  describe('row indexes', () => {
    it('numbers header, pinned and body rows once each, ending at aria-rowcount', async () => {
      await mount({ rowPinning: { enabled: true } }, [
        { key: 'id', filter: true },
        { key: 'name' },
      ]);
      fx.grid.pinRow(fx.grid.data[0], 'top');
      fx.grid.pinRow(fx.grid.data[1], 'bottom');
      await fx.waitForUpdate();
      const indexes = [
        ...fx.grid.renderRoot.querySelectorAll('apex-grid-header-row, apex-grid-row'),
      ].map((row) => Number(row.getAttribute('aria-rowindex')));
      indexes.sort((a, b) => a - b);
      // 1 header row + 1 pinned top + 6 body + 1 pinned bottom.
      expect(indexes).to.eql([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(fx.table().getAttribute('aria-rowcount')).to.equal('9');
    });
  });

  describe('master-detail', () => {
    beforeEach(async () => {
      await mount({
        expansion: { enabled: true, detailTemplate, isExpandable: (row: TestData) => row.id !== 2 },
      });
    });

    it('sets aria-expanded only on rows that can expand, and on their toggles', async () => {
      expect(fx.row(0).getAttribute('aria-expanded')).to.equal('false');
      expect(fx.rowPart(0, 'expansion-toggle')!.getAttribute('aria-expanded')).to.equal('false');
      expect(fx.row(1).hasAttribute('aria-expanded')).to.be.false;
      expect(fx.rowPart(1, 'expansion-toggle')!.hasAttribute('aria-expanded')).to.be.false;
    });

    it('drops row aria-expanded with the treegrid role when expansion is turned off', async () => {
      await fx.grid.expandRow(fx.grid.data[0]);
      await fx.waitForUpdate();
      expect(fx.row(0).getAttribute('aria-expanded')).to.equal('true');

      fx.grid.expansion = { enabled: false, detailTemplate };
      await fx.waitForUpdate();
      expect(fx.table().getAttribute('role')).to.equal('grid');
      expect(fx.row(0).hasAttribute('aria-expanded')).to.be.false;
      expect(await axeViolations(fx.grid)).to.eql([]);
    });

    it('drops row aria-expanded with the treegrid role when the template goes', async () => {
      await fx.grid.expandRow(fx.grid.data[0]);
      await fx.waitForUpdate();

      fx.grid.expansion = { enabled: true };
      await fx.waitForUpdate();
      expect(fx.table().getAttribute('role')).to.equal('grid');
      const expanded = Array.from(fx.grid.rows, (row) => row as unknown as HTMLElement).filter(
        (row) => row.hasAttribute('aria-expanded')
      );
      expect(expanded).to.have.length(0);
      expect(await axeViolations(fx.grid)).to.eql([]);
    });

    it('renders the detail panel as one cell across the row, holding the region', async () => {
      await fx.grid.expandRow(fx.grid.data[0]);
      await fx.waitForUpdate();
      const panel = fx.rowPart(0, 'detail-panel')!;
      expect(panel.getAttribute('role')).to.equal('gridcell');
      expect(panel.getAttribute('aria-colindex')).to.equal('1');
      expect(panel.getAttribute('aria-colspan')).to.equal(fx.table().getAttribute('aria-colcount'));
      const region = panel.querySelector('[role="region"]')!;
      expect(region.getAttribute('aria-label')).to.equal('Row detail');
      expect(region.textContent).to.contain('Details of A');
    });
  });
});
