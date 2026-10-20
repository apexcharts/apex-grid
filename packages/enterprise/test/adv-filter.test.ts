import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  type AdvancedFilterCondition,
  type AdvancedFilterModel,
  ApexGridEnterprise,
  ApexGridFilterBuilder,
  enterpriseModules,
  filterRows,
  isEmptyModel,
  operatorsForType,
} from '../src/index.js';

type AnyRow = Record<string, unknown>;

function where(...children: AdvancedFilterCondition[]): AdvancedFilterModel {
  return { kind: 'group', join: 'and', children };
}

async function settle(grid: ApexGridEnterprise<never>): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await grid.updateComplete;
    await nextFrame();
  }
}

describe('adv-filter: string operators never throw (ent-filter-builder-1)', () => {
  const columns: ColumnConfiguration<AnyRow>[] = [
    { key: 'name', type: 'string' },
    { key: 'amount', type: 'number' },
  ];
  const data: AnyRow[] = [
    { name: 'Alpha', amount: 150 },
    { name: null, amount: 50 },
    { name: undefined, amount: 60 },
    { name: 42, amount: 70 },
    { name: { a: 1 }, amount: 80 },
    { name: new Date(2024, 0, 1), amount: 90 },
    { name: 'Beta', amount: 200 },
  ];

  for (const operator of [
    'contains',
    'doesNotContain',
    'startsWith',
    'endsWith',
    'equals',
    'doesNotEqual',
    'empty',
    'notEmpty',
  ]) {
    it(`${operator} on null, number, object and Date cells does not throw`, () => {
      expect(() =>
        filterRows(
          data,
          where({ kind: 'condition', column: 'name', operator, value: 'a' }),
          columns
        )
      ).to.not.throw();
    });
  }

  it('null and undefined cells count as empty text', () => {
    const empty = filterRows(
      data,
      where({ kind: 'condition', column: 'name', operator: 'empty' }),
      columns
    );
    expect(empty.map((r) => r.amount)).to.eql([50, 60]);
    const contains = filterRows(
      data,
      where({ kind: 'condition', column: 'name', operator: 'contains', value: '2024' }),
      columns
    );
    expect(contains.map((r) => r.amount)).to.eql([90]);
  });

  it('a grid with a null string cell filters and keeps sorting', async () => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    const errors: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent) => {
      errors.push(event.reason);
      event.preventDefault();
    };
    window.addEventListener('unhandledrejection', onRejection);
    try {
      const grid = await fixture<ApexGridEnterprise<AnyRow>>(
        html`<apex-grid-enterprise
          .columns=${columns.map((c) => ({ ...c, sort: true }))}
          .data=${[...data]}
        ></apex-grid-enterprise>`
      );
      grid.applyAdvancedFilter(
        where({ kind: 'condition', column: 'name', operator: 'contains', value: 'a' })
      );
      await settle(grid as never);
      grid.sort({ key: 'amount', direction: 'descending' });
      await settle(grid as never);
      expect(errors.map(String), 'unhandled rejections').to.eql([]);
      // The Date cell matches through its text ('Jan').
      expect(grid.dataView.map((r) => r.amount)).to.eql([200, 150, 90]);
    } finally {
      window.removeEventListener('unhandledrejection', onRejection);
      fixtureCleanup();
    }
  });
});

describe('adv-filter: numeric column types (ent-filter-builder-2)', () => {
  const columns: ColumnConfiguration<AnyRow>[] = [
    { key: 'name', type: 'string' },
    { key: 'price', type: 'currency' },
    { key: 'done', type: 'progress' },
    { key: 'stars', type: 'rating' },
  ];
  const data: AnyRow[] = [
    { name: 'a', price: 1500, done: 10, stars: 1 },
    { name: 'b', price: 200, done: 50, stars: null },
    { name: 'c', price: 3000, done: 90, stars: 4 },
    { name: 'd', price: 1500, done: 100, stars: 5 },
  ];

  for (const type of ['number', 'currency', 'progress', 'rating'] as const) {
    it(`offers the number operators for a ${type} column`, () => {
      expect(operatorsForType(type).map((o) => o.name)).to.include('greaterThan');
      expect(operatorsForType(type).map((o) => o.name)).to.not.include('contains');
    });
  }

  it('compares a builder text value as a number on currency, progress and rating', () => {
    const price = filterRows(
      data,
      where({ kind: 'condition', column: 'price', operator: 'equals', value: '1500' }),
      columns
    );
    expect(price.map((r) => r.name)).to.eql(['a', 'd']);
    const done = filterRows(
      data,
      where({ kind: 'condition', column: 'done', operator: 'greaterThan', value: '40' }),
      columns
    );
    expect(done.map((r) => r.name)).to.eql(['b', 'c', 'd']);
    const stars = filterRows(
      data,
      where({ kind: 'condition', column: 'stars', operator: 'lessThan', value: '4' }),
      columns
    );
    expect(
      stars.map((r) => r.name),
      'null never matches a range'
    ).to.eql(['a']);
  });

  it('the builder renders a number input and number operators for a currency column', async () => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridFilterBuilder.register();
    try {
      const grid = await fixture<ApexGridEnterprise<AnyRow>>(
        html`<apex-grid-enterprise .columns=${columns} .data=${[...data]}></apex-grid-enterprise>`
      );
      const builder = await fixture<ApexGridFilterBuilder>(
        html`<apex-grid-filter-builder .grid=${grid}></apex-grid-filter-builder>`
      );
      builder.model = where({
        kind: 'condition',
        column: 'price',
        operator: 'greaterThan',
        value: '',
      });
      await builder.updateComplete;
      const input = builder.renderRoot.querySelector<HTMLInputElement>('input[part="val"]')!;
      expect(input.type).to.equal('number');
      const ops = [
        ...builder.renderRoot.querySelectorAll<HTMLOptionElement>('[part="op"] option'),
      ].map((o) => o.value);
      expect(ops).to.include('greaterThan');
    } finally {
      fixtureCleanup();
    }
  });

  it('shows a saved text operator on a currency column as itself, not as Equals', async () => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridFilterBuilder.register();
    try {
      const grid = await fixture<ApexGridEnterprise<AnyRow>>(
        html`<apex-grid-enterprise .columns=${columns} .data=${[...data]}></apex-grid-enterprise>`
      );
      const builder = await fixture<ApexGridFilterBuilder>(
        html`<apex-grid-filter-builder .grid=${grid}></apex-grid-filter-builder>`
      );
      builder.model = where({
        kind: 'condition',
        column: 'price',
        operator: 'contains',
        value: '20',
      });
      await builder.updateComplete;
      const op = builder.renderRoot.querySelector<HTMLSelectElement>('[part="op"]')!;
      expect(op.value).to.equal('contains');
      expect(op.selectedOptions[0].disabled, 'not offered for this type').to.be.true;

      // Picking a number operator replaces it and drops the placeholder.
      op.value = 'greaterThan';
      op.dispatchEvent(new Event('change'));
      await builder.updateComplete;
      const options = [
        ...builder.renderRoot.querySelectorAll<HTMLOptionElement>('[part="op"] option'),
      ];
      expect(options.map((o) => o.value)).to.not.include('contains');
      expect(options.some((o) => o.disabled)).to.be.false;
    } finally {
      fixtureCleanup();
    }
  });

  // The operator select must show the operator the model holds after a
  // column switch rewrites its option list in place.
  const switchColumns: ColumnConfiguration<AnyRow>[] = [
    { key: 'id', type: 'number' },
    { key: 'name', type: 'string' },
    { key: 'amount', type: 'currency' },
    { key: 'done', type: 'progress' },
  ];
  const switchData: AnyRow[] = [
    { id: 1, name: 'a', amount: 1, done: 10 },
    { id: 2, name: 'b', amount: 200, done: 50 },
    { id: 3, name: 'c', amount: 300, done: 90 },
  ];
  for (const [from, to, shown] of [
    ['name', 'amount', 'equals'],
    ['name', 'done', 'equals'],
    ['name', 'id', 'equals'],
    ['id', 'name', 'contains'],
    ['amount', 'name', 'contains'],
  ] as const) {
    it(`switching the column from ${from} to ${to} shows the operator the model holds`, async () => {
      ApexGridEnterprise.use(...enterpriseModules);
      ApexGridEnterprise.register();
      ApexGridFilterBuilder.register();
      try {
        const grid = await fixture<ApexGridEnterprise<AnyRow>>(
          html`<apex-grid-enterprise .columns=${switchColumns} .data=${[...switchData]}></apex-grid-enterprise>`
        );
        const builder = await fixture<ApexGridFilterBuilder>(
          html`<apex-grid-filter-builder .grid=${grid}></apex-grid-filter-builder>`
        );
        builder.model = where({
          kind: 'condition',
          column: from,
          operator: from === 'name' ? 'contains' : 'equals',
          value: '',
        });
        await builder.updateComplete;
        const col = builder.renderRoot.querySelector<HTMLSelectElement>('[part="col"]')!;
        col.value = to;
        col.dispatchEvent(new Event('change'));
        await builder.updateComplete;

        const held = (builder.model.children[0] as AdvancedFilterCondition).operator;
        expect(held).to.equal(shown);
        const op = builder.renderRoot.querySelector<HTMLSelectElement>('[part="op"]')!;
        expect(op.value, 'shown operator').to.equal(held);
        const label = operatorsForType(switchColumns.find((c) => c.key === to)!.type).find(
          (o) => o.name === held
        )!.label;
        expect(op.selectedOptions[0]?.textContent?.trim()).to.equal(label);
      } finally {
        fixtureCleanup();
      }
    });
  }

  it('switching a new condition to a currency column applies what it shows', async () => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridFilterBuilder.register();
    try {
      const grid = await fixture<ApexGridEnterprise<AnyRow>>(
        html`<apex-grid-enterprise .columns=${switchColumns} .data=${[...switchData]}></apex-grid-enterprise>`
      );
      const builder = await fixture<ApexGridFilterBuilder>(
        html`<apex-grid-filter-builder .grid=${grid}></apex-grid-filter-builder>`
      );
      await builder.updateComplete;
      builder.renderRoot.querySelector<HTMLButtonElement>('[part="adders"] button')!.click();
      await builder.updateComplete;
      const col = builder.renderRoot.querySelector<HTMLSelectElement>('[part="col"]')!;
      for (const key of ['name', 'amount']) {
        col.value = key;
        col.dispatchEvent(new Event('change'));
        await builder.updateComplete;
      }
      const op = builder.renderRoot.querySelector<HTMLSelectElement>('[part="op"]')!;
      const val = builder.renderRoot.querySelector<HTMLInputElement>('input[part="val"]')!;
      val.value = '200';
      val.dispatchEvent(new Event('input'));
      builder.renderRoot.querySelector<HTMLButtonElement>('[part="apply"]')!.click();
      await settle(grid as never);

      expect(op.value, 'shown operator').to.equal('equals');
      const applied = grid.advancedFilterModel!.children[0] as AdvancedFilterCondition;
      expect(applied.operator, 'applied operator matches the shown one').to.equal(op.value);
      expect((grid.dataView as AnyRow[]).map((r) => r.id)).to.eql([2]);
    } finally {
      fixtureCleanup();
    }
  });
});

describe('adv-filter: column case sensitivity (sweep-drift-duplication-5)', () => {
  const data: AnyRow[] = [{ sku: 'AB-1' }, { sku: 'ab-1' }, { sku: 'Ab-1' }];

  it('honours filter.caseSensitive like the core filter', () => {
    const columns: ColumnConfiguration<AnyRow>[] = [
      { key: 'sku', type: 'string', filter: { caseSensitive: true } },
    ];
    const rows = filterRows(
      data,
      where({ kind: 'condition', column: 'sku', operator: 'equals', value: 'AB-1' }),
      columns
    );
    expect(rows.map((r) => r.sku)).to.eql(['AB-1']);
  });

  it('stays case insensitive by default', () => {
    const columns: ColumnConfiguration<AnyRow>[] = [{ key: 'sku', type: 'string', filter: true }];
    const rows = filterRows(
      data,
      where({ kind: 'condition', column: 'sku', operator: 'equals', value: 'AB-1' }),
      columns
    );
    expect(rows).to.have.length(3);
  });

  it('tolerates a null filter config like the core filter', () => {
    const columns = [
      { key: 'sku', type: 'string', filter: null },
    ] as unknown as ColumnConfiguration<AnyRow>[];
    const rows = filterRows(
      data,
      where({ kind: 'condition', column: 'sku', operator: 'equals', value: 'AB-1' }),
      columns
    );
    expect(rows).to.have.length(3);
  });
});

describe('adv-filter: compiled once per call (ent-filter-builder-6)', () => {
  it('resolves columns per call, not per row', () => {
    let keyReads = 0;
    const column = (key: string, type: 'string' | 'number') =>
      ({
        get key() {
          keyReads++;
          return key;
        },
        type,
      }) as unknown as ColumnConfiguration<AnyRow>;
    const columns = [column('name', 'string'), column('amount', 'number'), column('x', 'string')];
    const data: AnyRow[] = Array.from({ length: 1000 }, (_, i) => ({ name: `n${i}`, amount: i }));
    const model: AdvancedFilterModel = {
      kind: 'group',
      join: 'or',
      children: [
        { kind: 'condition', column: 'amount', operator: 'lessThan', value: '10' },
        {
          kind: 'group',
          join: 'and',
          children: [
            { kind: 'condition', column: 'name', operator: 'endsWith', value: '7' },
            { kind: 'condition', column: 'amount', operator: 'greaterThan', value: 990 },
            { kind: 'condition', column: 'x', operator: 'greaterThan', value: 1 },
          ],
        },
      ],
    };
    const rows = filterRows(data, model, columns);
    expect(rows.map((r) => r.amount)).to.eql([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 997]);
    expect(keyReads, 'column key reads').to.be.below(30);
    expect(isEmptyModel(model, columns)).to.be.false;
  });
});
