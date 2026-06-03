import { expect } from '@open-wc/testing';
import type { Keys } from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

const TDD = new GridTestFixture(data);
const keys = Object.keys(data[0]) as Array<Keys<TestData>>;

describe('Grid activation', () => {
  beforeEach(async () => await TDD.setUp());
  afterEach(() => TDD.tearDown());

  describe('Click activation', () => {
    it('Default', async () => {
      const initial = TDD.rows.first.cells.first;
      const next = TDD.rows.first.cells.last;

      await TDD.clickCell(initial);
      expect(initial.active).to.be.true;

      await TDD.clickCell(next);
      expect(initial.active).to.be.false;
      expect(next.active).to.be.true;
    });
  });

  describe('Keyboard navigation & activation', () => {
    it('ArrowRight', async () => {
      await TDD.clickCell(TDD.rows.first.cells.first);

      for (const each of keys) {
        expect(TDD.rows.first.cells.get(each).active).to.be.true;
        await TDD.fireNavigationEvent({ key: 'ArrowRight' });
      }
    });

    it('ArrowRight @ boundary', async () => {
      await TDD.clickCell(TDD.rows.first.cells.last);
      await TDD.fireNavigationEvent({ key: 'ArrowRight' });

      expect(TDD.rows.first.cells.last.active).to.be.true;
    });

    it('ArrowLeft', async () => {
      const reversed = keys.toReversed();
      await TDD.clickCell(TDD.rows.first.cells.last);

      for (const each of reversed) {
        expect(TDD.rows.first.cells.get(each).active).to.be.true;
        await TDD.fireNavigationEvent({ key: 'ArrowLeft' });
      }
    });

    it('ArrowLeft @ boundary', async () => {
      await TDD.clickCell(TDD.rows.first.cells.first);
      await TDD.fireNavigationEvent({ key: 'ArrowLeft' });

      expect(TDD.rows.first.cells.first.active).to.be.true;
    });

    it('ArrowDown', async () => {
      await TDD.clickCell(TDD.rows.first.cells.first);

      for (let i = 0; i < data.length; i++) {
        expect(TDD.rows.get(i).cells.first.active).to.be.true;
        await TDD.fireNavigationEvent({ key: 'ArrowDown' });
      }
    });

    it('ArrowDown @ boundary', async () => {
      await TDD.clickCell(TDD.rows.last.cells.first);
      await TDD.fireNavigationEvent({ key: 'ArrowDown' });

      expect(TDD.rows.last.cells.first.active).to.be.true;
    });

    it('ArrowUp', async () => {
      await TDD.clickCell(TDD.rows.last.cells.first);

      for (let i = data.length - 1; i > -1; i--) {
        expect(TDD.rows.get(i).cells.first.active).to.be.true;
        await TDD.fireNavigationEvent({ key: 'ArrowUp' });
      }
    });

    it('ArrowUp @ boundary', async () => {
      await TDD.clickCell(TDD.rows.first.cells.first);
      await TDD.fireNavigationEvent({ key: 'ArrowUp' });

      expect(TDD.rows.first.cells.first.active).to.be.true;
    });

    it('Home', async () => {
      await TDD.clickCell(TDD.rows.last.cells.first);
      await TDD.fireNavigationEvent({ key: 'Home' });

      expect(TDD.rows.first.cells.first.active).to.be.true;
    });

    it('Home @ boundary', async () => {
      await TDD.clickCell(TDD.rows.first.cells.first);
      await TDD.fireNavigationEvent({ key: 'Home' });

      expect(TDD.rows.first.cells.first.active).to.be.true;
    });

    it('End', async () => {
      await TDD.clickCell(TDD.rows.first.cells.first);
      await TDD.fireNavigationEvent({ key: 'End' });

      expect(TDD.rows.last.cells.first.active).to.be.true;
    });

    it('End (at edge)', async () => {
      await TDD.clickCell(TDD.rows.last.cells.first);
      await TDD.fireNavigationEvent({ key: 'End' });

      expect(TDD.rows.last.cells.first.active).to.be.true;
    });
  });
});
