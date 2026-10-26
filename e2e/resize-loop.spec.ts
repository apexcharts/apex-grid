import { expect, type Page, test } from '@playwright/test';

// GitHub #32: a grid whose cells wrap raised "ResizeObserver loop completed
// with undelivered notifications" window error events while its container
// narrowed and widened. Chrome dispatches them without printing anything, so
// the page counts them itself. The test runner fixture does not reproduce the
// loop, which is why this lives in a real page, on the shipped bundle that
// `pree2e` builds.

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;padding:16px;font:14px system-ui}</style>
<script src="/apex-grid.min.js"></script></head><body>
<div id="host" style="width: 700px"><apex-grid id="grid" style="height: 360px"></apex-grid></div>
<script>
window.loopErrors = 0;
window.otherErrors = [];
window.addEventListener('error', (e) => {
  if (String(e.message).includes('ResizeObserver loop')) window.loopErrors++;
  else window.otherErrors.push(e.message);
});
const grid = document.querySelector('#grid');
const host = document.querySelector('#host');
grid.columns = [
  { key: 'id', headerText: 'Id', type: 'number', width: '60px' },
  { key: 'text', headerText: 'Text' },
];
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
window.load = async (text) => {
  grid.data = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, text: text + ' ' + (i + 1) }));
  host.style.width = '700px';
  await grid.updateComplete;
  await tick(300);
};
// Two passes from 700 px to 200 px and back, one 20 px step per frame.
window.narrowAndWiden = async () => {
  window.loopErrors = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let w = 700; w >= 200; w -= 20) { host.style.width = w + 'px'; await frame(); }
    for (let w = 200; w <= 700; w += 20) { host.style.width = w + 'px'; await frame(); }
  }
  await tick(300);
  return window.loopErrors;
};
window.resizeTo = async (w) => { host.style.width = w + 'px'; await frame(); await frame(); await frame(); };
// Rendered rows, top to bottom: their box and the height their content needs.
window.rowGeometry = () => {
  const body = grid.shadowRoot.querySelector('apex-virtualizer');
  return [...body.querySelectorAll('apex-grid-row')].map((row) => {
    const r = row.getBoundingClientRect();
    const cells = [...row.shadowRoot.querySelectorAll('apex-grid-cell')];
    const content = Math.max(...cells.map((c) => c.getBoundingClientRect().height));
    return { top: r.top, bottom: r.bottom, height: r.height, content };
  }).sort((a, b) => a.top - b.top);
};
// The focused body cell, read through the shadow roots.
window.focusedCell = () => {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  const row = el && el.getRootNode().host;
  return el && el.tagName === 'APEX-GRID-CELL'
    ? { row: row.index, column: el.column.key }
    : null;
};
</script></body></html>`;

const LONG = 'A description long enough to wrap onto two or three lines when the column gets narrow';

async function open(page: Page) {
  await page.route('**/__resize-loop.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: PAGE })
  );
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
  await page.goto('/__resize-loop.html');
  await page.waitForFunction(() => customElements.get('apex-grid') !== undefined);
}

type Window_ = Record<string, (...args: unknown[]) => unknown>;

test.describe('ResizeObserver loop (GitHub #32)', () => {
  test('a grid whose cells wrap narrows and widens without loop error events', async ({
    page,
  }) => {
    await open(page);
    await page.evaluate((text) => (window as unknown as Window_).load(text), LONG);
    // Focus a body cell first: the resizing must leave it where it was.
    await page.evaluate(() => {
      const grid = document.querySelector('#grid') as HTMLElement;
      const row = grid.shadowRoot?.querySelector('apex-virtualizer apex-grid-row:nth-of-type(2)');
      (row?.shadowRoot?.querySelectorAll('apex-grid-cell')[1] as HTMLElement).click();
    });
    const before = await page.evaluate(() => (window as unknown as Window_).focusedCell());
    expect(before).toEqual({ row: 1, column: 'text' });

    expect(await page.evaluate(() => (window as unknown as Window_).narrowAndWiden())).toBe(0);

    expect(await page.evaluate(() => (window as unknown as Window_).focusedCell())).toEqual(before);
    expect(await page.evaluate(() => document.querySelector('#grid')?.scrollTop)).toBe(0);
  });

  test('a grid whose cells do not wrap stays quiet too', async ({ page }) => {
    await open(page);
    await page.evaluate(() => (window as unknown as Window_).load('Short'));
    expect(await page.evaluate(() => (window as unknown as Window_).narrowAndWiden())).toBe(0);
  });

  test('only the loop notice is cancelled; other window errors reach page listeners', async ({
    page,
  }) => {
    await open(page);
    const result = await page.evaluate(() => {
      const W = window as unknown as { loopErrors: number; otherErrors: string[] };
      const send = (message: string) => {
        const event = new ErrorEvent('error', { message, cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      };
      W.loopErrors = 0;
      const loop = send('ResizeObserver loop completed with undelivered notifications.');
      const other = send('Something else broke');
      return { loop, other, loopErrors: W.loopErrors, otherErrors: W.otherErrors };
    });
    expect(result).toEqual({
      loop: true,
      other: false,
      loopErrors: 0,
      otherErrors: ['Something else broke'],
    });
  });

  test('wrapping rows settle to their content height and stack without gaps', async ({
    page,
  }) => {
    await open(page);
    await page.evaluate((text) => (window as unknown as Window_).load(text), LONG);
    for (const width of [200, 450, 700]) {
      await page.evaluate((w) => (window as unknown as Window_).resizeTo(w), width);
      const rows = (await page.evaluate(() => (window as unknown as Window_).rowGeometry())) as {
        top: number;
        bottom: number;
        height: number;
        content: number;
      }[];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(Math.abs(row.height - row.content)).toBeLessThan(1.5);
      for (let i = 1; i < rows.length; i++) {
        expect(Math.abs(rows[i].top - rows[i - 1].bottom)).toBeLessThan(1.5);
      }
    }
  });
});
