import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import { ApexGrid, type ColumnConfiguration } from 'apex-grid';
import { resolveExportRows, type StateController } from 'apex-grid/internal';
import { getGroupMeta } from '../src/features/grouping.js';
import {
  ApexGridEnterprise,
  enterpriseModules,
  groupingModule,
  totalRowModule,
} from '../src/index.js';

/**
 * The core feature-module seam's "is this a real data row" predicate and its
 * fixed row-transform order, exercised through the enterprise modules that
 * synthesize rows (grouping headers, the grand-total row).
 */

interface Row {
  region: string;
  product: string;
  amount: number;
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'region' },
  { key: 'product' },
  { key: 'amount', sort: true },
];

function rows(): Row[] {
  return [
    { region: 'EMEA', product: 'A', amount: 10 },
    { region: 'EMEA', product: 'B', amount: 20 },
    { region: 'AMER', product: 'A', amount: 30 },
    { region: 'AMER', product: 'A', amount: 40 },
  ];
}

function stateOf<T extends object>(grid: ApexGrid<T>): StateController<T> {
  return (grid as unknown as { stateController: StateController<T> }).stateController;
}

async function settle(grid: { updateComplete: Promise<boolean> }) {
  await grid.updateComplete;
  await nextFrame();
}

async function mountGrouped(selection = true) {
  const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
    .data=${rows()}
    .columns=${columns}
    .groupBy=${['region']}
    .selection=${selection ? { enabled: true, mode: 'multiple', showCheckboxColumn: true } : undefined}
  ></apex-grid-enterprise>`);
  await settle(grid);
  return grid;
}

function headerCheckbox(grid: HTMLElement): HTMLInputElement {
  const headerRow = grid.shadowRoot!.querySelector('apex-grid-header-row')!;
  return headerRow.shadowRoot!.querySelector<HTMLInputElement>('input[part="selection-checkbox"]')!;
}

describe('seam: data-row predicate and transform order', () => {
  before(() => {
    // Deliberately register the grand-total row BEFORE grouping: the transform
    // order must not depend on registration order.
    ApexGridEnterprise.use(totalRowModule, groupingModule);
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGrid.register();
  });
  afterEach(() => fixtureCleanup());

  describe('selection', () => {
    it('select all selects only data rows, not group headers', async () => {
      const grid = await mountGrouped();
      expect((grid.pageItems as Row[]).filter((r) => getGroupMeta(r)).length).to.equal(2);
      await grid.selectAllRows();
      expect(grid.selectedRows.filter((r) => getGroupMeta(r)).length, 'synthetic').to.equal(0);
      expect(grid.selectedRows.length).to.equal(4);
    });

    it('stays all-selected after a sort rebuilds the group headers', async () => {
      const grid = await mountGrouped();
      await grid.selectAllRows();
      grid.sort({ key: 'amount', direction: 'descending' } as never);
      await settle(grid);
      const selection = stateOf(grid).selection;
      expect(selection.allSelected(), 'allSelected after sort').to.equal(true);
      expect(selection.someSelected(), 'not indeterminate').to.equal(false);
    });

    it('ignores a toggle on a group header (Space on a focused group row)', async () => {
      const grid = await mountGrouped();
      const header = (grid.pageItems as Row[]).find((r) => getGroupMeta(r))!;
      expect(await grid.toggleRowSelection(header)).to.equal(false);
      expect(await grid.selectRow(header)).to.equal(false);
      expect(grid.selectedRows).to.eql([]);
    });

    it('skips group headers inside a Shift+click range', async () => {
      const grid = await mountGrouped();
      const items = grid.pageItems as Row[];
      const first = items.find((r) => !getGroupMeta(r))!;
      const last = items[items.length - 1];
      await grid.selectRow(first);
      await stateOf(grid).selection.rangeToggle(last);
      expect(grid.selectedRows.filter((r) => getGroupMeta(r)).length).to.equal(0);
      expect(grid.selectedRows.length).to.equal(4);
    });

    it('drops group headers passed to the selectedRows setter', async () => {
      const grid = await mountGrouped();
      grid.selectedRows = [...(grid.pageItems as Row[])];
      await settle(grid);
      expect(grid.selectedRows.length).to.equal(4);
    });

    it('select all on collapsed groups selects their leaves', async () => {
      const grid = await mountGrouped();
      grid.collapseAllGroups();
      await settle(grid);
      headerCheckbox(grid).click();
      await settle(grid);
      expect(grid.selectedRows.length, 'every leaf').to.equal(4);
      expect(headerCheckbox(grid).checked, 'checked').to.equal(true);
      expect(headerCheckbox(grid).indeterminate, 'not indeterminate').to.equal(false);
      grid.expandAllGroups();
      await settle(grid);
      expect(headerCheckbox(grid).checked, 'still checked when expanded').to.equal(true);
    });

    it('select all right after a collapse, before the view rebuilds, selects each leaf once', async () => {
      const grid = await mountGrouped();
      grid.collapseAllGroups();
      await grid.selectAllRows();
      expect(grid.selectedRows.length, 'every leaf').to.equal(4);
      expect(new Set(grid.selectedRows).size, 'no duplicates').to.equal(4);
    });

    it('select all right after an expand, before the view rebuilds, selects every leaf', async () => {
      const grid = await mountGrouped();
      grid.collapseAllGroups();
      await settle(grid);
      grid.expandAllGroups();
      await grid.selectAllRows();
      expect(grid.selectedRows.length, 'every leaf').to.equal(4);
    });

    it('leaves the header checkbox unchecked when select all selects nothing', async () => {
      // Only the grand-total row is in view: there is nothing to select.
      const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
        .data=${[] as Row[]}
        .columns=${columns}
        .totalRow=${{ aggregations: { amount: ['sum'] } }}
        .selection=${{ enabled: true, mode: 'multiple', showCheckboxColumn: true }}
      ></apex-grid-enterprise>`);
      await settle(grid);
      expect(grid.dataView.length, 'total row only').to.equal(1);
      headerCheckbox(grid).click();
      await settle(grid);
      expect(grid.selectedRows).to.eql([]);
      expect(headerCheckbox(grid).checked, 'unchecked').to.equal(false);
    });

    it('keeps the grand-total row out of the selection', async () => {
      const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
        .data=${rows()}
        .columns=${columns}
        .totalRow=${{ aggregations: { amount: ['sum'] } }}
        .selection=${{ enabled: true, mode: 'multiple' }}
      ></apex-grid-enterprise>`);
      await settle(grid);
      await grid.selectAllRows();
      expect(
        grid.selectedRows.every((r) => 'region' in r),
        'records only'
      ).to.equal(true);
      expect(grid.selectedRows.length).to.equal(4);
    });
  });

  describe('export', () => {
    it('CSV of a grouped view has no blank group-header lines', async () => {
      const grid = await mountGrouped(false);
      const csv = grid.exportToCSV({ filename: '', bom: false });
      expect(csv).to.equal(
        'region,product,amount\r\nEMEA,A,10\r\nEMEA,B,20\r\nAMER,A,30\r\nAMER,A,40'
      );
    });

    it('resolveExportRows drops synthesized rows for the view and page sources', async () => {
      const grid = await mountGrouped(false);
      expect(resolveExportRows(grid, 'view').length, 'view').to.equal(4);
      expect(resolveExportRows(grid, 'page').length, 'page').to.equal(4);
      expect(resolveExportRows(grid, 'all').length, 'all').to.equal(4);
    });

    it('a view export writes the leaves of collapsed groups', async () => {
      const grid = await mountGrouped(false);
      grid.collapseAllGroups();
      await settle(grid);
      expect(resolveExportRows(grid, 'view').length, 'view').to.equal(4);
      expect(resolveExportRows(grid, 'page').length, 'page shows headers only').to.equal(0);
    });

    it('a view export right after a collapse, before the view rebuilds, writes each leaf once', async () => {
      const grid = await mountGrouped(false);
      grid.collapseAllGroups();
      const csv = grid.exportToCSV({ filename: '', bom: false });
      expect(csv).to.equal(
        'region,product,amount\r\nEMEA,A,10\r\nEMEA,B,20\r\nAMER,A,30\r\nAMER,A,40'
      );
      expect(resolveExportRows(grid, 'view').length, 'view').to.equal(4);
    });

    it('CSV has no blank line for the grand-total row', async () => {
      const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
        .data=${rows()}
        .columns=${columns}
        .totalRow=${{ aggregations: { amount: ['sum'] } }}
      ></apex-grid-enterprise>`);
      await settle(grid);
      const csv = grid.exportToCSV({ filename: '', bom: false });
      expect(csv).to.equal(
        'region,product,amount\r\nEMEA,A,10\r\nEMEA,B,20\r\nAMER,A,30\r\nAMER,A,40'
      );
    });
  });

  describe('community grid', () => {
    it('treats every row as a data row and returns the view unchanged', async () => {
      const data = rows();
      const grid = await fixture<ApexGrid<Row>>(
        html`<apex-grid .data=${data} .columns=${columns}></apex-grid>`
      );
      await settle(grid);
      const state = stateOf(grid);
      expect(state.isDataRow(data[0])).to.equal(true);
      const view = grid.dataView;
      expect(state.dataRows(view), 'same array, no copy').to.equal(view);
      expect(state.viewRecords(view), 'viewRecords, no copy').to.equal(view);
      expect(resolveExportRows(grid, 'view')).to.equal(view);
    });
  });
});
