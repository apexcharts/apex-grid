import { expect } from '@open-wc/testing';
import type { ApexGrid } from '../src/components/grid.js';
import GridTestFixture from './utils/grid-fixture.js';

// GitHub #32. The loop notice itself only reproduces in a real page (see
// e2e/resize-loop.spec.ts); this covers the window listener the fix adds,
// which the test runner can observe.

interface Row {
  id: number;
  name: string;
}

const rows: Row[] = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `Row ${i + 1}` }));

describe('ResizeObserver loop (GitHub #32)', () => {
  const fixture = new GridTestFixture(rows);

  afterEach(() => fixture.tearDown());

  // The handler is installed once per page, by the first grid.
  it('the first grid quiets the loop notice once per window, and only that message', async () => {
    const added: EventListener[] = [];
    const original = window.addEventListener;
    window.addEventListener = function (
      this: Window,
      ...args: Parameters<Window['addEventListener']>
    ) {
      if (args[0] === 'error') added.push(args[1] as EventListener);
      return original.apply(this, args);
    } as Window['addEventListener'];
    try {
      await fixture.setUp();
      expect(added).to.have.length(1);

      const handle = (message: string) => {
        const event = new ErrorEvent('error', { message, cancelable: true });
        added[0](event);
        return event.defaultPrevented;
      };
      expect(handle('ResizeObserver loop completed with undelivered notifications.')).to.be.true;
      // The older wording some embedded browsers still raise.
      expect(handle('ResizeObserver loop limit exceeded')).to.be.true;
      expect(handle('Something else broke')).to.be.false;

      // A second grid on the same page adds nothing.
      const second = document.createElement('apex-grid') as ApexGrid<Row>;
      document.body.append(second);
      await second.updateComplete;
      second.remove();
      expect(added).to.have.length(1);
    } finally {
      window.addEventListener = original;
    }
  });
});
