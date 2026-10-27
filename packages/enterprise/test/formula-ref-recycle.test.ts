import { expect, fixture, fixtureCleanup, html } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { FORMULA_MODULE_ID, type FormulaController } from '../src/features/formula/index.js';
import { ApexGridEnterprise, enterpriseModules } from '../src/index.js';
import { settle } from './settle.js';

// Formula reference decoration (row recycling plan, F2): the highlight is
// keyed by record, so it has to follow the record when a sort re-binds a row
// element to another one. A cell whose value is the same for both records
// sees only the positional tokens change, which used to skip the
// re-decoration and leave the highlight on the slot.

interface Row {
  amount: number;
  name: string;
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'amount', type: 'number', sort: true },
  { key: 'name', type: 'string', sort: true },
];

function controllerOf(grid: ApexGridEnterprise<Row>): FormulaController<Row> {
  return (
    grid as unknown as { stateController: { module(id: string): FormulaController<Row> } }
  ).stateController.module(FORMULA_MODULE_ID);
}

/** Rendered rows in view order. */
function rowsOf(grid: ApexGridEnterprise<Row>) {
  return grid.rows.sort((a, b) => a.index - b.index);
}

/** The `amount` cell of every rendered row, with the record it shows. */
function amountCells(grid: ApexGridEnterprise<Row>) {
  return rowsOf(grid).map((row) => ({
    data: row.data,
    cell: row.cells.find((c) => c.column.key === 'amount') as unknown as HTMLElement,
  }));
}

describe('Formula reference decoration across a re-bind', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  it('a sort that re-binds rows moves the highlight with its record', async () => {
    // Equal amounts: after the sort each amount cell keeps its value.
    const data: Row[] = [
      { amount: 5, name: 'a' },
      { amount: 5, name: 'b' },
      { amount: 5, name: 'c' },
    ];
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise .data=${data} .columns=${columns}></apex-grid-enterprise>`
    );
    await settle(grid);

    // A1 is the amount of data row 0, record 'a'.
    controllerOf(grid).highlightReferences('=A1');
    await settle(grid);
    const highlighted = () =>
      amountCells(grid)
        .filter(({ cell }) => cell.hasAttribute('data-formula-ref'))
        .map(({ data }) => data.name);
    expect(highlighted()).to.deep.equal(['a']);

    grid.sort({ key: 'name', direction: 'descending' });
    await settle(grid);
    expect(
      rowsOf(grid).map((row) => row.data.name),
      'the rows re-bound'
    ).to.deep.equal(['c', 'b', 'a']);
    expect(highlighted(), 'only the record A1 names').to.deep.equal(['a']);
    const [first] = amountCells(grid);
    expect(first.cell.getAttribute('data-formula-ref'), 'row 0 shows c').to.equal(null);
  });

  it('unpinning a pinned row above moves the highlight with its record (pinned band)', async () => {
    // The pinned band re-binds its elements by position under any keying.
    const data: Row[] = [
      { amount: 5, name: 'a' },
      { amount: 5, name: 'b' },
      { amount: 5, name: 'c' },
    ];
    const grid = await fixture<ApexGridEnterprise<Row>>(
      html`<apex-grid-enterprise
        .data=${data}
        .columns=${columns}
        .rowPinning=${{ enabled: true }}
      ></apex-grid-enterprise>`
    );
    await settle(grid);
    for (const record of data) grid.pinRow(record, 'top');
    await settle(grid);

    // A2 is the amount of data row 1, record 'b', pinned second.
    controllerOf(grid).highlightReferences('=A2');
    await settle(grid);
    const pinned = () =>
      Array.from(
        grid.shadowRoot!.querySelectorAll<HTMLElement & { data: Row; cells: HTMLElement[] }>(
          '[part~="pinned-top"] apex-grid-row'
        )
      );
    const highlighted = () =>
      pinned()
        .filter((row) =>
          row.cells
            .find((c) => (c as unknown as { column: { key: string } }).column.key === 'amount')
            ?.hasAttribute('data-formula-ref')
        )
        .map((row) => row.data.name);
    expect(highlighted()).to.deep.equal(['b']);

    grid.unpinRow(data[0]);
    await settle(grid);
    expect(
      pinned().map((row) => row.data.name),
      'b moved up a pinned slot'
    ).to.deep.equal(['b', 'c']);
    expect(highlighted(), 'only the record A2 names').to.deep.equal(['b']);
  });
});
