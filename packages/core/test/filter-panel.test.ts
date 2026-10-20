import { expect, nextFrame } from '@open-wc/testing';
import type ApexFilterRow from '../src/components/filter-row.js';
import type { ColumnConfiguration, Keys } from '../src/internal/types.js';
import type { OperandKeys } from '../src/operations/filter/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

class PanelFixture extends GridTestFixture<TestData> {
  public override updateConfig(): void {
    this.columnConfig = [
      { key: 'id', type: 'number', filter: true, sort: true },
      { key: 'name', filter: true, sort: true },
      { key: 'active', type: 'boolean', filter: true },
      { key: 'importance', filter: true },
    ] as ColumnConfiguration<TestData>[];
  }

  public get panel() {
    return this.filterRow.element as ApexFilterRow<TestData>;
  }

  public filterButton(key: Keys<TestData>) {
    const header = this.headerRow.headers.find((h) => h.column.key === key)!;
    return header.shadowRoot!.querySelector<HTMLElement>('[part~="filter-btn"]')!;
  }

  public async open(key: Keys<TestData>) {
    this.filterRow.open(key);
    await this.waitForUpdate();
  }

  public async condition(name: string) {
    this.filterRow.openDropdown();
    await this.waitForUpdate();
    this.filterRow.selectDropdownCondition(name as OperandKeys<unknown>);
    await this.waitForUpdate();
  }

  public async type(value: string) {
    this.filterRow.fireInputEvent(value);
    await this.waitForUpdate();
  }

  public get conditionLabel() {
    return this.filterRow.dropdownTarget.textContent?.trim();
  }

  public get left() {
    return Number.parseFloat(this.panel.style.getPropertyValue('--fp-left'));
  }

  public get top() {
    return Number.parseFloat(this.panel.style.getPropertyValue('--fp-top'));
  }
}

const TDD = new PanelFixture(data);

/** Collects `filtering` event types and the grid's unhandled rejections. */
function track() {
  const types: string[] = [];
  const errors: string[] = [];
  const onReject = (e: PromiseRejectionEvent) => {
    errors.push(String((e.reason as Error)?.message ?? e.reason));
    e.preventDefault();
  };
  window.addEventListener('unhandledrejection', onReject);
  TDD.grid.addEventListener('filtering', (e) => types.push(e.detail.type));
  return {
    types,
    errors,
    stop: () => window.removeEventListener('unhandledrejection', onReject),
  };
}

describe('Filter panel', () => {
  beforeEach(async () => await TDD.setUp());
  afterEach(() => TDD.tearDown());

  describe('unary to binary switch', () => {
    it('drops the term-less filter instead of keeping it in state', async () => {
      const t = track();
      try {
        await TDD.open('name');
        await TDD.condition('empty');
        expect(TDD.grid.totalItems).to.equal(0);

        await TDD.condition('contains');
        expect(TDD.grid.filterExpressions).to.deep.equal([]);
        expect(TDD.grid.totalItems).to.equal(8);
        expect(TDD.conditionLabel).to.equal('Contains');
        expect(TDD.filterRow.activeStateChips).to.have.length(0);

        TDD.grid.sort({ key: 'id', direction: 'descending' });
        await TDD.waitForUpdate();
        await nextFrame();
        expect(t.errors).to.deep.equal([]);
        expect(TDD.grid.dataView.map((r) => r.id)).to.deep.equal([8, 7, 6, 5, 4, 3, 2, 1]);
        expect(t.types).to.deep.equal(['add', 'remove']);
      } finally {
        t.stop();
      }
    });

    it('does not filter every row out on a number column', async () => {
      await TDD.open('id');
      await TDD.condition('empty');
      await TDD.condition('greaterThan');
      expect(TDD.grid.filterExpressions).to.deep.equal([]);
      expect(TDD.grid.totalItems).to.equal(8);
    });

    it('keeps the unary filter when its removal is cancelled', async () => {
      await TDD.open('name');
      await TDD.condition('empty');
      TDD.grid.addEventListener('filtering', (e) => e.preventDefault());
      await TDD.condition('contains');
      expect(
        TDD.grid.filterExpressions.map((e) => (e.condition as { name: string }).name)
      ).to.deep.equal(['empty']);
      expect(TDD.conditionLabel).to.equal('Empty');
    });

    it('typing after the switch adds the binary filter', async () => {
      await TDD.open('name');
      await TDD.condition('empty');
      await TDD.condition('contains');
      const t = track();
      try {
        await TDD.type('a');
        expect(t.types).to.deep.equal(['add']);
        expect(TDD.grid.totalItems).to.equal(2);
      } finally {
        t.stop();
      }
    });
  });

  describe('cancelled modify', () => {
    it('leaves the term, the input and the result unchanged', async () => {
      await TDD.open('name');
      await TDD.type('a');
      expect(TDD.grid.totalItems).to.equal(2);

      TDD.grid.addEventListener('filtering', (e) => e.preventDefault());
      await TDD.type('ab');
      expect(TDD.grid.filterExpressions[0].searchTerm).to.equal('a');
      // The typed text stays, the chip shows the term in effect.
      expect(TDD.filterRow.input.value).to.equal('ab');
      expect(TDD.filterRow.activeStateChips[0].textContent?.trim()).to.equal('a');

      TDD.grid.sort({ key: 'id', direction: 'descending' });
      await TDD.waitForUpdate();
      expect(TDD.grid.totalItems).to.equal(2);
    });

    it('leaves the condition unchanged', async () => {
      await TDD.open('name');
      await TDD.type('a');
      TDD.grid.addEventListener('filtering', (e) => e.preventDefault());
      await TDD.condition('startsWith');
      expect((TDD.grid.filterExpressions[0].condition as { name: string }).name).to.equal(
        'contains'
      );
      expect(TDD.conditionLabel).to.equal('Contains');
    });

    it('leaves the criteria unchanged', async () => {
      await TDD.open('name');
      await TDD.type('a');
      TDD.filterRow.commitInput();
      await TDD.waitForUpdate();
      await TDD.type('b');
      TDD.grid.addEventListener('filtering', (e) => e.preventDefault());
      TDD.filterRow.activeCriteriaButtons[0].click();
      await TDD.waitForUpdate();
      expect(TDD.grid.filterExpressions[1].criteria).to.equal('and');
      expect(TDD.filterRow.activeCriteriaButtons[0].textContent?.trim()).to.equal('and');
    });

    it('commits a listener edit of the proposed expression', async () => {
      await TDD.open('name');
      await TDD.type('a');
      TDD.grid.addEventListener(
        'filtering',
        (e) => Object.assign(e.detail.expressions[0], { searchTerm: 'b' }),
        { once: true }
      );
      await TDD.type('ab');
      expect(TDD.grid.filterExpressions).to.have.length(1);
      expect(TDD.grid.filterExpressions[0].searchTerm).to.equal('b');
    });
  });

  describe('typing', () => {
    /** Appends `text` to the input one key at a time, as a user types. */
    async function keys(text: string) {
      for (const key of text) await TDD.type(TDD.filterRow.input.value + key);
    }

    /** Removes the last `count` characters one key at a time. */
    async function backspace(count: number) {
      for (let i = 0; i < count; i++) await TDD.type(TDD.filterRow.input.value.slice(0, -1));
    }

    function minLength(e: CustomEvent) {
      const term = e.detail.expressions[0]?.searchTerm;
      if (e.detail.type !== 'remove' && String(term ?? '').length < 3) e.preventDefault();
    }

    it('keeps typing possible under a listener that cancels short terms', async () => {
      await TDD.open('name');
      TDD.grid.addEventListener('filtering', minLength);
      await keys('lar');
      expect(TDD.filterRow.input.value).to.equal('lar');
      expect(TDD.grid.filterExpressions.map((e) => e.searchTerm)).to.deep.equal(['lar']);
    });

    it('keeps the edited text when a listener cancels it', async () => {
      await TDD.open('name');
      await TDD.type('lar');
      TDD.grid.addEventListener('filtering', minLength);
      await backspace(2);
      await keys('eo');
      expect(TDD.filterRow.input.value).to.equal('leo');
      expect(TDD.grid.filterExpressions.map((e) => e.searchTerm)).to.deep.equal(['leo']);
    });

    it('replaces an applied number with a negative one', async () => {
      await TDD.open('id');
      await TDD.type('5');
      await TDD.type('-');
      expect(TDD.filterRow.input.value).to.equal('-');
      await keys('2');
      expect(TDD.grid.filterExpressions.map((e) => e.searchTerm)).to.deep.equal([-2]);
    });

    it('replaces an applied number with a decimal one', async () => {
      await TDD.open('id');
      await TDD.type('5');
      await TDD.type('.');
      expect(TDD.filterRow.input.value).to.equal('.');
      await keys('5');
      expect(TDD.grid.filterExpressions.map((e) => e.searchTerm)).to.deep.equal([0.5]);
    });

    it('keeps the term of an input that lands while a removal settles', async () => {
      await TDD.open('name');
      await TDD.type('a');
      TDD.filterRow.fireInputEvent('');
      TDD.filterRow.fireInputEvent('x');
      await TDD.waitForUpdate();
      await nextFrame();
      expect(
        TDD.grid.filterExpressions.map((e) => [
          e.searchTerm,
          (e.condition as { name: string }).name,
        ])
      ).to.deep.equal([['x', 'contains']]);
    });
  });

  describe('change type', () => {
    it('reports a unary pick on a fresh panel as add and announces it', async () => {
      const t = track();
      try {
        await TDD.open('active');
        await TDD.condition('true');
        expect(t.types).to.deep.equal(['add']);
        expect(TDD.grid.totalItems).to.equal(4);
        // @ts-expect-error - protected access
        expect(TDD.grid.stateController.announcement).to.contain('active');

        await TDD.condition('false');
        expect(t.types).to.deep.equal(['add', 'modify']);
      } finally {
        t.stop();
      }
    });
  });
});
