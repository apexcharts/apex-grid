import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  type AdvancedFilterModel,
  ApexGridEnterprise,
  ApexGridFilterBuilder,
  defaultOperator,
  enterpriseModules,
  filterRows,
  isEmptyModel,
  operatorsForType,
} from '../src/index.js';

interface Row {
  country: string;
  amount: number;
  active: boolean;
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'country', type: 'string' },
  { key: 'amount', type: 'number' },
  { key: 'active', type: 'boolean' },
];

const data: Row[] = [
  { country: 'US', amount: 150, active: true },
  { country: 'US', amount: 50, active: false },
  { country: 'CA', amount: 200, active: true },
  { country: 'DE', amount: 300, active: false },
];

describe('advanced-filter evaluator (pure)', () => {
  it('operatorsForType returns the type-appropriate operands', () => {
    expect(operatorsForType('number').map((o) => o.name)).to.include('greaterThan');
    expect(operatorsForType('string').map((o) => o.name)).to.include('contains');
    expect(defaultOperator('number')).to.equal('equals');
  });

  it('evaluates a nested (A OR B) AND C tree', () => {
    // (country = US OR country = CA) AND amount > 100
    const model: AdvancedFilterModel = {
      kind: 'group',
      join: 'and',
      children: [
        {
          kind: 'group',
          join: 'or',
          children: [
            { kind: 'condition', column: 'country', operator: 'equals', value: 'US' },
            { kind: 'condition', column: 'country', operator: 'equals', value: 'CA' },
          ],
        },
        { kind: 'condition', column: 'amount', operator: 'greaterThan', value: 100 },
      ],
    };
    const result = filterRows(data, model, columns);
    // US/150 ✓, US/50 ✗ (amount), CA/200 ✓, DE/300 ✗ (country)
    expect(result.map((r) => `${r.country}:${r.amount}`)).to.eql(['US:150', 'CA:200']);
  });

  it('coerces string input to the column type (number greaterThan)', () => {
    const model: AdvancedFilterModel = {
      kind: 'group',
      join: 'and',
      children: [{ kind: 'condition', column: 'amount', operator: 'greaterThan', value: '150' }],
    };
    expect(filterRows(data, model, columns).map((r) => r.amount)).to.eql([200, 300]);
  });

  it('supports unary operators (string empty)', () => {
    const withBlank: Row[] = [...data, { country: '', amount: 1, active: true }];
    const model: AdvancedFilterModel = {
      kind: 'group',
      join: 'and',
      children: [{ kind: 'condition', column: 'country', operator: 'empty' }],
    };
    expect(filterRows(withBlank, model, columns).map((r) => r.amount)).to.eql([1]);
  });

  it('ignores incomplete conditions (a half-built row does not hide everything)', () => {
    const model: AdvancedFilterModel = {
      kind: 'group',
      join: 'and',
      children: [{ kind: 'condition', column: 'amount', operator: 'greaterThan', value: '' }],
    };
    expect(isEmptyModel(model, columns)).to.be.true;
    expect(filterRows(data, model, columns)).to.have.length(4);
  });
});

interface AGrid extends ApexGridEnterprise<Row> {}

describe('advanced filter builder (element + wiring)', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridFilterBuilder.register();
  });
  afterEach(() => fixtureCleanup());

  async function mount() {
    const grid = await fixture<AGrid>(html`<apex-grid-enterprise
      .data=${[...data]}
      .columns=${columns}
    ></apex-grid-enterprise>`);
    const builder = await fixture<ApexGridFilterBuilder>(
      html`<apex-grid-filter-builder .grid=${grid}></apex-grid-filter-builder>`
    );
    await grid.updateComplete;
    await builder.updateComplete;
    await nextFrame();
    return { grid, builder };
  }

  it('applyAdvancedFilter filters the dataView and clearAdvancedFilter restores it', async () => {
    const { grid } = await mount();
    expect(grid.pageItems.length).to.equal(4);

    grid.applyAdvancedFilter({
      kind: 'group',
      join: 'and',
      children: [{ kind: 'condition', column: 'amount', operator: 'greaterThan', value: 100 }],
    });
    await grid.updateComplete;
    await nextFrame();
    expect((grid.pageItems as Row[]).map((r) => r.amount)).to.eql([150, 200, 300]);
    expect(grid.advancedFilterModel).to.not.be.null;

    grid.clearAdvancedFilter();
    await grid.updateComplete;
    await nextFrame();
    expect(grid.pageItems.length).to.equal(4);
    expect(grid.advancedFilterModel).to.be.null;
  });

  it('the element renders the tree and Apply drives the grid', async () => {
    const { grid, builder } = await mount();
    // Seed a model, then click Apply via the rendered button.
    builder.model = {
      kind: 'group',
      join: 'or',
      children: [
        { kind: 'condition', column: 'country', operator: 'equals', value: 'CA' },
        { kind: 'condition', column: 'country', operator: 'equals', value: 'DE' },
      ],
    };
    await builder.updateComplete;
    const apply = builder.renderRoot.querySelector<HTMLButtonElement>('[part="apply"]')!;
    apply.click();
    await grid.updateComplete;
    await nextFrame();
    expect((grid.pageItems as Row[]).map((r) => r.country).sort()).to.eql(['CA', 'DE']);
  });

  it('Add condition / Add group grow the tree', async () => {
    const { builder } = await mount();
    const conditionsBefore = builder.renderRoot.querySelectorAll('[part="condition"]').length;
    builder.renderRoot.querySelectorAll<HTMLButtonElement>('[part="adders"] button')[0].click();
    await builder.updateComplete;
    expect(builder.renderRoot.querySelectorAll('[part="condition"]').length).to.equal(
      conditionsBefore + 1
    );
    // Add a nested group.
    const groupsBefore = builder.renderRoot.querySelectorAll('[part="group"]').length;
    builder.renderRoot.querySelectorAll<HTMLButtonElement>('[part="adders"] button')[1].click();
    await builder.updateComplete;
    expect(builder.renderRoot.querySelectorAll('[part="group"]').length).to.equal(groupsBefore + 1);
  });
});
