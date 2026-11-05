import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import { type ColumnConfiguration, esLocale, type GridLocaleText } from 'apex-grid';
import {
  type AdvancedFilterModel,
  ApexGridEnterprise,
  ApexGridFilterBuilder,
  enterpriseModules,
} from '../src/index.js';
import { settle } from './settle.js';

interface Row {
  name: string;
  value: number;
  active: boolean;
}

const data: Row[] = [
  { name: 'A', value: 10, active: true },
  { name: 'B', value: 20, active: false },
];

const columns: ColumnConfiguration<Row>[] = [
  { key: 'name', type: 'string', headerText: 'Name' },
  { key: 'value', type: 'number', headerText: 'Value' },
  { key: 'active', type: 'boolean', headerText: 'Active' },
];

function sizedParent() {
  const node = document.createElement('div');
  node.style.height = '400px';
  return node;
}

async function mountGrid(localeText?: GridLocaleText) {
  const grid = await fixture<ApexGridEnterprise<Row>>(
    html`<apex-grid-enterprise
      .data=${data.map((row) => ({ ...row }))}
      .columns=${columns}
      .localeText=${localeText}
    ></apex-grid-enterprise>`,
    { parentNode: sizedParent() }
  );
  await settle(grid);
  return grid;
}

function headerElement(grid: ApexGridEnterprise<Row>, key: keyof Row): HTMLElement {
  const stack: ParentNode[] = [grid.shadowRoot!];
  while (stack.length) {
    const node = stack.pop()!;
    for (const el of node.querySelectorAll('*')) {
      if (
        el.localName === 'apex-grid-header' &&
        String((el as unknown as { column?: { key?: unknown } }).column?.key) === key
      ) {
        return el as HTMLElement;
      }
      if (el.shadowRoot) stack.push(el.shadowRoot);
    }
  }
  throw new Error(`no header for ${key}`);
}

/** Opens the header menu of `key` and returns the grouping item labels by id. */
async function groupingLabels(grid: ApexGridEnterprise<Row>, key: keyof Row) {
  for (const open of document.querySelectorAll('.apex-grid-context-menu')) open.remove();
  headerElement(grid, key).dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      composed: true,
      cancelable: true,
      clientX: 60,
      clientY: 60,
    })
  );
  await nextFrame();
  const labels = Array.from(
    document.querySelectorAll<HTMLElement>('.apex-grid-context-menu .agcm-item'),
    (item) => item.textContent!.trim()
  );
  return labels;
}

describe('enterprise i18n: header menu grouping items', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => {
    for (const open of document.querySelectorAll('.apex-grid-context-menu')) open.remove();
    fixtureCleanup();
  });

  it('keeps the English labels by default', async () => {
    const grid = await mountGrid();
    expect(await groupingLabels(grid, 'name')).to.include('Group by this column');
    grid.groupBy = ['name'];
    await settle(grid);
    expect(await groupingLabels(grid, 'value')).to.include.members([
      'Group by this column',
      'Un-group all',
      'Expand all groups',
      'Collapse all groups',
    ]);
  });

  it('translates them with esLocale', async () => {
    const grid = await mountGrid(esLocale);
    grid.groupBy = ['name'];
    await settle(grid);
    expect(await groupingLabels(grid, 'value')).to.include.members([
      'Agrupar por esta columna',
      'Desagrupar todo',
      'Expandir todos los grupos',
      'Contraer todos los grupos',
    ]);
  });

  it('applies a custom localeText', async () => {
    const grid = await mountGrid({
      'contextMenu.groupBy': 'Group',
      'contextMenu.ungroupAll': 'Ungroup',
    });
    grid.groupBy = ['name'];
    await settle(grid);
    const labels = await groupingLabels(grid, 'value');
    expect(labels).to.include.members(['Group', 'Ungroup', 'Expand all groups']);
    expect(labels).to.not.include('Group by this column');
  });
});

describe('enterprise i18n: filter builder labels', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridFilterBuilder.register();
  });
  afterEach(() => fixtureCleanup());

  const model = (): AdvancedFilterModel => ({
    kind: 'group',
    join: 'and',
    children: [
      { kind: 'condition', column: 'name', operator: 'notEmpty' },
      { kind: 'condition', column: 'value', operator: 'greaterThanOrEqual', value: 5 },
      // Operators the column type does not offer (a saved model). Every
      // boolean operand is unary, so only such a condition shows the value list.
      { kind: 'condition', column: 'active', operator: 'equals', value: 'true' },
      { kind: 'condition', column: 'value', operator: 'contains', value: 1 },
    ],
  });

  async function mountBuilder(localeText?: GridLocaleText) {
    const grid = await mountGrid(localeText);
    const builder = await fixture<ApexGridFilterBuilder>(
      html`<apex-grid-filter-builder .grid=${grid} .model=${model()}></apex-grid-filter-builder>`
    );
    await builder.updateComplete;
    const conditions = Array.from(builder.renderRoot.querySelectorAll('[part="condition"]'));
    const texts = (select: Element | null) =>
      Array.from(select?.querySelectorAll('option') ?? [], (o) => o.textContent!.trim());
    return {
      operators: conditions.map((c) => texts(c.querySelector('[part="op"]'))),
      selected: conditions.map(
        (c) => (c.querySelector('[part="op"]') as HTMLSelectElement).selectedOptions[0]?.textContent
      ),
      booleans: texts(conditions[2].querySelector('select[part="val"]')),
    };
  }

  it('shows the filter.operator.* English text and true / false by default', async () => {
    const { operators, selected, booleans } = await mountBuilder();
    expect(operators[0]).to.deep.equal([
      'Contains',
      'Does not contain',
      'Starts with',
      'Ends with',
      'Equals',
      'Does not equal',
      'Empty',
      'Not empty',
    ]);
    expect(operators[1]).to.include('Greater than or equal');
    // The saved operator first, then the boolean operands.
    expect(operators[2]).to.deep.equal(['Equals', 'All', 'True', 'False', 'Empty', 'Not empty']);
    expect(selected.map((s) => s?.trim())).to.deep.equal([
      'Not empty',
      'Greater than or equal',
      // Not raw operator ids: a saved operator reads as its label.
      'Equals',
      'Contains',
    ]);
    expect(booleans).to.deep.equal(['true', 'false']);
  });

  it('translates operators and boolean values with esLocale', async () => {
    const { operators, selected, booleans } = await mountBuilder(esLocale);
    expect(operators[0][0]).to.equal('Contiene');
    expect(operators[2]).to.deep.equal([
      'Igual a',
      'Todos',
      'Verdadero',
      'Falso',
      'Vacío',
      'No vacío',
    ]);
    expect(selected.map((s) => s?.trim())).to.deep.equal([
      'No vacío',
      'Mayor o igual que',
      'Igual a',
      'Contiene',
    ]);
    expect(booleans).to.deep.equal(['verdadero', 'falso']);
  });

  it('applies a custom localeText', async () => {
    const { selected, booleans } = await mountBuilder({
      'filter.operator.notEmpty': 'Has a value',
      'filterBuilder.true': 'Yes',
      'filterBuilder.false': 'No',
    });
    expect(selected[0]?.trim()).to.equal('Has a value');
    expect(selected[1]?.trim()).to.equal('Greater than or equal');
    expect(booleans).to.deep.equal(['Yes', 'No']);
  });
});
