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

  describe('trigger and Escape', () => {
    it('closes when the open column filter icon is clicked with a pointer', async () => {
      await TDD.open('name');
      const btn = TDD.filterButton('name');
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
      btn.click();
      await TDD.waitForUpdate();
      expect(TDD.panel.active).to.equal(false);
    });

    it('still closes on a pointerdown outside the panel', async () => {
      await TDD.open('name');
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await TDD.waitForUpdate();
      expect(TDD.panel.active).to.equal(false);
    });

    it('lets Escape outside the panel through', async () => {
      await TDD.open('name');
      const outside = document.createElement('input');
      document.body.appendChild(outside);
      let seen = false;
      outside.addEventListener('keydown', () => {
        seen = true;
      });
      try {
        outside.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })
        );
        await TDD.waitForUpdate();
        expect(seen).to.equal(true);
        expect(TDD.panel.active).to.equal(true);
      } finally {
        outside.remove();
      }
    });

    it('closes on Escape from inside the panel', async () => {
      await TDD.open('name');
      TDD.filterRow.input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })
      );
      await TDD.waitForUpdate();
      expect(TDD.panel.active).to.equal(false);
    });

    it('closes on Escape once focus has fallen to the page', async () => {
      await TDD.open('name');
      TDD.filterRow.input.blur();
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })
      );
      await TDD.waitForUpdate();
      expect(TDD.panel.active).to.equal(false);
    });

    it('closes on Escape from the trigger of a panel with no input', async () => {
      await TDD.open('active');
      TDD.filterButton('active').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })
      );
      await TDD.waitForUpdate();
      expect(TDD.panel.active).to.equal(false);
    });
  });

  describe('position', () => {
    it('moves under the new column when switched by keyboard', async () => {
      await TDD.open('id');
      const before = TDD.left;
      // Enter on a native button fires click without a pointerdown.
      TDD.filterButton('importance').click();
      await TDD.waitForUpdate();
      expect(TDD.panel.column.key).to.equal('importance');
      expect(TDD.left).to.not.equal(before);
      const rect = TDD.filterButton('importance').getBoundingClientRect();
      const width = TDD.panel.offsetWidth;
      expect(TDD.left).to.equal(Math.min(rect.left, Math.max(8, window.innerWidth - width - 8)));
    });

    it('follows its trigger when the grid scrolls and stops after close', async () => {
      TDD.grid.style.width = '300px';
      TDD.grid.columns = TDD.grid.columns.map((c) => ({ ...c, width: '200px' }));
      await TDD.waitForUpdate();
      await TDD.open('name');
      const btn = TDD.filterButton('name');
      const start = TDD.left;
      expect(start).to.be.closeTo(btn.getBoundingClientRect().left, 0.5);

      TDD.grid.scrollLeft = 60;
      await nextFrame();
      await nextFrame();
      expect(TDD.left).to.be.closeTo(btn.getBoundingClientRect().left, 0.5);
      expect(TDD.left).to.be.closeTo(start - 60, 0.5);

      TDD.filterRow.close();
      await TDD.waitForUpdate();
      TDD.grid.scrollLeft = 0;
      await nextFrame();
      await nextFrame();
      expect(TDD.panel.style.getPropertyValue('--fp-left')).to.equal('');
    });

    it('follows its trigger when the page scrolls', async () => {
      const spacer = document.createElement('div');
      spacer.style.height = '3000px';
      document.body.appendChild(spacer);
      try {
        await TDD.open('name');
        const btn = TDD.filterButton('name');
        window.scrollTo(0, 40);
        await nextFrame();
        await nextFrame();
        expect(TDD.top).to.be.closeTo(btn.getBoundingClientRect().bottom + 4, 0.5);
      } finally {
        window.scrollTo(0, 0);
        spacer.remove();
      }
    });

    it('clamps with its rendered width when the root font size is not 16px', async () => {
      const root = document.documentElement;
      const previous = root.style.fontSize;
      root.style.fontSize = '20px';
      try {
        Object.assign(TDD.grid.style, {
          position: 'fixed',
          insetInlineEnd: '0',
          top: '0',
          width: '400px',
        });
        await TDD.waitForUpdate();
        await TDD.open('importance');
        const rect = TDD.panel.getBoundingClientRect();
        expect(rect.width).to.equal(300);
        expect(rect.right).to.be.at.most(window.innerWidth - 8 + 0.5);
      } finally {
        root.style.fontSize = previous;
      }
    });
  });
});

describe('Filter panel chips', () => {
  beforeEach(async () => await TDD.setUp());
  afterEach(() => TDD.tearDown());

  it('lists an array term (a set filter selection) as separate values', async () => {
    TDD.grid.filter({
      key: 'name',
      condition: { name: 'set', unary: false, logic: () => true },
      searchTerm: ['A', 'B', '\u0000blank'],
    } as never);
    await TDD.waitForUpdate();
    await TDD.open('name');
    const chip = TDD.panel.shadowRoot!.querySelector('[part~="chip-body"] span');
    expect(chip?.textContent?.trim()).to.equal('A, B, (Blanks)');
  });
});
