import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { buildSync } from 'esbuild';

// The shipped core bundle (define.js) never calls setup(), so R4 bundles the
// package index (which exports setup) in memory.
let coreSetupBundle: string | null = null;
function coreSetup(): string {
  coreSetupBundle ??= buildSync({
    entryPoints: [fileURLToPath(new URL('../packages/core/dist/index.js', import.meta.url))],
    bundle: true,
    format: 'iife',
    globalName: 'apexGridCore',
    write: false,
  }).outputFiles[0].text;
  return coreSetupBundle;
}

// Shadow DOM audit, wave 1 (plans/34 in apexcharts-js). Mounts the same grid
// config four ways and runs the same user-visible checks in each:
//   light           grid placed directly in the page, theme vars on the grid element
//   light-ancestor  grid placed directly in the page, theme vars on a wrapper div
//   shadow          grid inside an outer host's open shadow root, vars on the host
//   nested          grid two shadow roots deep, vars on the outermost host
// A real shadow bug passes in `light` and fails in `shadow` or `nested`.

const MODES = ['light', 'light-ancestor', 'shadow', 'nested'] as const;
type Mode = (typeof MODES)[number];

const BRAND = 'rgb(220, 38, 38)';
const SURFACE = 'rgb(10, 20, 30)';
const THEME = `--ig-primary-500: ${BRAND}; --ag-brand: ${BRAND}; --ag-surface: ${SURFACE};`;

function harness(mode: Mode, bundle: 'enterprise' | 'core', opts: { rowDrag?: boolean; noHeight?: boolean }) {
  const src = bundle === 'core' ? '/__core-setup.js' : '/apex-grid-enterprise.min.js';
  const tag = bundle === 'core' ? 'apex-grid' : 'apex-grid-enterprise';
  return `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;padding:24px;font:14px system-ui}</style>
<script src="${src}"></script></head><body><div id="mount"></div>
<script>
${bundle === 'core' ? 'apexGridCore.setup();' : ''}
customElements.define('x-host', class extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: 'open' }); }
});
const MODE = ${JSON.stringify(mode)};
const THEME = ${JSON.stringify(THEME)};
const grid = document.createElement(${JSON.stringify(tag)});
grid.id = 'grid';
grid.style.cssText = ${opts.noHeight ? "'display:block;width:900px;'" : "'display:block;height:460px;width:900px;'"};
const mount = document.getElementById('mount');
let outer = grid;
if (MODE === 'light') { grid.style.cssText += THEME; mount.append(grid); }
else if (MODE === 'light-ancestor') { const d = document.createElement('div'); d.id = 'outer'; d.style.cssText = THEME; d.append(grid); mount.append(d); outer = d; }
else if (MODE === 'shadow') { const h = document.createElement('x-host'); h.id = 'outer'; h.style.cssText = 'display:block;' + THEME; h.shadowRoot.append(grid); mount.append(h); outer = h; }
else { const h = document.createElement('x-host'); h.id = 'outer'; h.style.cssText = 'display:block;' + THEME; const i = document.createElement('x-host'); i.style.display = 'block'; i.shadowRoot.append(grid); h.shadowRoot.append(i); mount.append(h); outer = h; }
window.grid = grid; window.outer = outer;
grid.showExport = true;
grid.editing = { enabled: true, mode: 'cell', trigger: 'doubleClick' };
grid.columnReordering = true;
${opts.rowDrag ? "grid.rowReordering = { enabled: true };" : ''}
grid.columns = [
  { key: 'name', headerText: 'Name', sort: true, filter: true, resizable: true },
  { key: 'department', headerText: 'Department', sort: true, filter: true, resizable: true },
  { key: 'salary', headerText: 'Salary', type: 'number', sort: true, editable: true },
  { key: 'bonus', headerText: 'Bonus', type: 'number', editable: true${bundle === 'enterprise' ? ', allowFormula: true' : ''} },
];
grid.data = [
  { id: 1, name: 'Ava', department: 'Engineering', salary: 96000, bonus: 12000 },
  { id: 2, name: 'Liam', department: 'Engineering', salary: 104000, bonus: 15000 },
  { id: 3, name: 'Noah', department: 'Engineering', salary: 88000, bonus: 9000 },
  { id: 4, name: 'Emma', department: 'Sales', salary: 72000, bonus: 7000 },
  { id: 5, name: 'Olivia', department: 'Sales', salary: 69000, bonus: 6500 },
  { id: 6, name: 'William', department: 'Sales', salary: 81000, bonus: 8000 },
  { id: 7, name: 'Sophia', department: 'Marketing', salary: 64000, bonus: 5000 },
  { id: 8, name: 'James', department: 'Marketing', salary: 71000, bonus: 7500 },
];
// Deepest focused element across shadow roots.
window.deepActive = () => { let e = document.activeElement; while (e && e.shadowRoot && e.shadowRoot.activeElement) e = e.shadowRoot.activeElement; return e; };
</script></body></html>`;
}

async function open(page: Page, mode: Mode, bundle: 'enterprise' | 'core' = 'enterprise', opts = {}) {
  const html = harness(mode, bundle, opts);
  await page.route('**/__shadow.html*', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  await page.route('**/__core-setup.js', (route) => route.fulfill({ contentType: 'text/javascript', body: coreSetup() }));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
  await page.goto(`/__shadow.html?mode=${mode}`);
  await expect(page.locator('apex-grid-cell').first()).toBeVisible({ timeout: 15_000 });
  await settle(page);
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await (window as any).grid.updateComplete;
    await new Promise(requestAnimationFrame);
  });
  await page.waitForTimeout(80);
}

const cell = (page: Page, row: number, col: number) =>
  page.locator('apex-grid-row').nth(row).locator('apex-grid-cell').nth(col);

/** Set (or with `null`, remove) custom properties on the outermost themed element. */
async function setVars(page: Page, vars: Record<string, string | null>) {
  await page.evaluate((v) => {
    const outer = (window as any).outer as HTMLElement;
    for (const [k, val] of Object.entries(v)) {
      if (val === null) outer.style.removeProperty(k);
      else outer.style.setProperty(k, val);
    }
  }, vars);
  await settle(page);
}

const gridVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle((window as any).grid).getPropertyValue(n).trim(), name);

/** Names of the public tokens the grid adopted on the document root. */
const rootTokenNames = (page: Page) =>
  page.evaluate(() => {
    const names: string[] = [];
    for (const sheet of document.adoptedStyleSheets) {
      for (const rule of Array.from(sheet.cssRules) as CSSStyleRule[]) {
        if (!rule.selectorText?.includes(':root')) continue;
        for (const prop of Array.from(rule.style)) if (prop.startsWith('--ag-')) names.push(prop);
      }
    }
    return names;
  });

/** Select rows 0..3 of Department+Salary and open a chart dialog with Alt+F1 from a focused cell. */
async function chartSelection(page: Page) {
  await page.evaluate(() => {
    const g = (window as any).grid;
    g.stateController.module('range-selection').selectRange(
      { row: 0, column: 'department' },
      { row: 3, column: 'salary' }
    );
  });
  await settle(page);
  await page.evaluate(() => {
    (window as any).grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', altKey: true, bubbles: true }));
  });
  await settle(page);
}

for (const mode of MODES) {
  test.describe(`[${mode}]`, () => {
    // --- theme reaches the grid itself ------------------------------------
    test('T0 an Ignite palette on the outermost host tints the brand (no --ag-brand set)', async ({ page }) => {
      await open(page, mode);
      await setVars(page, { '--ag-brand': null, '--ig-primary-500': 'rgb(1, 2, 3)' });
      expect(await gridVar(page, '--_ag-brand')).toBe('rgb(1, 2, 3)');
    });

    test('X1 --ag-surface set on the outermost host paints the grid body', async ({ page }) => {
      await open(page, mode);
      expect(await gridVar(page, '--_ag-surface')).toBe(SURFACE);
      const bg = await page.evaluate(() =>
        getComputedStyle((window as any).grid.shadowRoot.querySelector('apex-virtualizer')).backgroundColor
      );
      expect(bg).toBe(SURFACE);
    });

    // --- tokens: public inputs on :root, resolved on the host ------------------
    test('TK1 every root token set on the outermost host reaches the grid (light and dark)', async ({ page }) => {
      await open(page, mode);
      const names = await rootTokenNames(page);
      expect(names.length).toBeGreaterThan(60);
      // A distinct sentinel per token, set on the outer element only.
      await setVars(page, Object.fromEntries(names.map((n) => [n, `tok${n.slice(1)}`])));
      const read = (prefix: string) =>
        page.evaluate(
          ([list, pre]) => {
            const cs = getComputedStyle((window as any).grid);
            return (list as string[])
              .filter((n) => n.startsWith(pre as string) && !(pre === '--ag-' && n.startsWith('--ag-dark-')))
              .map((n) => [n, cs.getPropertyValue(`--_ag-${n.slice((pre as string).length)}`).trim()]);
          },
          [names, prefix]
        );
      for (const [n, v] of await read('--ag-')) expect(v, n).toBe(`tok${n.slice(1)}`);
      await page.evaluate(() => (window as any).grid.setAttribute('theme', 'dark'));
      await settle(page);
      const dark = await read('--ag-dark-');
      expect(dark.length).toBeGreaterThan(15);
      for (const [n, v] of dark) expect(v, n).toBe(`tok${n.slice(1)}`);
    });

    test('TK2 dark grids read --ag-dark-*, never the light inputs', async ({ page }) => {
      await open(page, mode);
      await page.evaluate(() => (window as any).grid.setAttribute('theme', 'dark'));
      await settle(page);
      // The light --ag-surface on the outer host does not land on a dark grid.
      expect(await gridVar(page, '--_ag-surface')).toBe('#0f172a');
      await setVars(page, { '--ag-dark-surface': 'rgb(1, 1, 1)' });
      expect(await gridVar(page, '--_ag-surface')).toBe('rgb(1, 1, 1)');
      // The brand is shared by both modes.
      expect(await gridVar(page, '--_ag-brand')).toBe(BRAND);
    });

    test('TK3 tinted grids take ancestor values and tint them with the brand', async ({ page }) => {
      await open(page, mode);
      await setVars(page, { '--ag-surface-elevated': 'rgb(200, 200, 200)', '--ag-border': 'rgb(0, 255, 0)' });
      await page.evaluate(() => (window as any).grid.setAttribute('theme', 'tinted'));
      await settle(page);
      expect(await gridVar(page, '--_ag-surface')).toBe(SURFACE);
      const elevated = await gridVar(page, '--_ag-surface-elevated');
      expect(elevated).toContain('rgb(200, 200, 200)');
      expect(elevated).toContain(BRAND);
      // Row separators are the brand alone; a border value set anywhere is ignored.
      const border = await gridVar(page, '--_ag-border');
      expect(border).toContain(BRAND);
      expect(border).not.toContain('rgb(0, 255, 0)');
    });

    test('TK4 derived tokens follow a brand set on the outermost host (selected-row wash)', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await open(page, mode);
      const v = await page.evaluate(() => {
        const g = (window as any).grid;
        const row = g.shadowRoot.querySelector('apex-grid-row') as HTMLElement;
        row.setAttribute('selected', '');
        const probe = document.createElement('div');
        probe.style.background = 'color-mix(in srgb, rgb(220, 38, 38) 10%, rgb(10, 20, 30))';
        document.body.append(probe);
        const expected = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return {
          soft: getComputedStyle(row).getPropertyValue('--_ag-brand-soft').trim(),
          row: getComputedStyle(row).backgroundColor,
          expected,
        };
      });
      expect(v.soft).toContain(BRAND);
      expect(v.row).toBe(v.expected);
    });

    test('TK5 page CSS reads the public defaults (and the brand needs its own fallback)', async ({ page }) => {
      await open(page, mode);
      const v = await page.evaluate(() => {
        const g = (window as any).grid as HTMLElement;
        const probe = document.createElement('div');
        probe.style.cssText = 'color: var(--ag-text-muted); background: var(--ag-brand, rgb(9, 9, 9));';
        g.after(probe); // next to the grid, so inside the shadow roots in those mounts
        const cs = getComputedStyle(probe);
        return { color: cs.color, bg: cs.backgroundColor };
      });
      expect(v.color).toBe('rgb(107, 114, 128)');
      // Where the theme sits on an ancestor of the probe the read resolves to it;
      // in `light` it sits on the grid itself, so the probe uses its fallback.
      expect(v.bg).toBe(mode === 'light' ? 'rgb(9, 9, 9)' : BRAND);
      const top = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.cssText = 'background: var(--ag-surface); color: var(--ag-brand, rgb(9, 9, 9));';
        document.body.append(probe);
        return { bg: getComputedStyle(probe).backgroundColor, color: getComputedStyle(probe).color };
      });
      // Nothing set on the page itself: the root defaults (no root brand by design).
      expect(top).toEqual({ bg: 'rgb(255, 255, 255)', color: 'rgb(9, 9, 9)' });
    });

    test('TK6 the --ag-grid-shadow: var(--ag-shadow-card) recipe gives the card shadow', async ({ page }) => {
      await open(page, mode);
      await page.evaluate(() => (window as any).grid.style.setProperty('--ag-grid-shadow', 'var(--ag-shadow-card)'));
      await settle(page);
      const light = await page.evaluate(() => getComputedStyle((window as any).grid).boxShadow);
      expect(light).toContain('0px 16px 38px');
      expect(light).toContain('rgba(15, 23, 42, 0.12)');
      await page.evaluate(() => {
        const g = (window as any).grid;
        g.setAttribute('theme', 'dark');
        g.style.setProperty('--ag-grid-shadow', 'var(--ag-dark-shadow-card)');
      });
      await settle(page);
      const dark = await page.evaluate(() => getComputedStyle((window as any).grid).boxShadow);
      expect(dark).toContain('rgba(0, 0, 0, 0.55)');
    });

    test('TK7 reduced motion zeroes every duration, even one set on the outermost host', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await open(page, mode);
      await setVars(page, { '--ag-dur-fast': '500ms', '--ag-dur-med': '500ms', '--ag-dur-slow': '500ms' });
      const v = await cell(page, 0, 0).evaluate((c) => {
        const cs = getComputedStyle(c);
        return ['fast', 'med', 'slow'].map((d) => cs.getPropertyValue(`--_ag-dur-${d}`).trim());
      });
      expect(v).toEqual(['0ms', '0ms', '0ms']);
    });

    test('TK8 the token sheet is adopted once per document', async ({ page }) => {
      await open(page, mode);
      await page.evaluate(() => {
        const second = document.createElement('apex-grid-enterprise');
        document.body.append(second);
      });
      await settle(page);
      const count = await page.evaluate(
        () =>
          document.adoptedStyleSheets.filter((s) =>
            Array.from(s.cssRules).some((r) => (r as CSSStyleRule).selectorText?.includes(':root'))
          ).length
      );
      expect(count).toBe(1);
    });

    // --- R1 context menu ----------------------------------------------------
    test('R1a context menu opens on right-click and is styled', async ({ page }) => {
      await open(page, mode);
      await cell(page, 0, 0).click({ button: 'right' });
      const menu = page.locator('.apex-grid-context-menu');
      await expect(menu).toBeVisible();
      const cs = await menu.evaluate((m) => ({ pos: getComputedStyle(m).position, bg: getComputedStyle(m).backgroundColor }));
      // On the body, but painted with the grid's (outer-host) surface.
      expect(cs).toEqual({ pos: 'fixed', bg: SURFACE });
    });

    test('R1b context menu item runs (sort ascending) and ArrowDown moves focus', async ({ page }) => {
      await open(page, mode);
      await cell(page, 0, 2).click({ button: 'right' });
      const items = page.locator('.apex-grid-context-menu .agcm-item');
      await expect(items.first()).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(items.nth(1)).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await items.first().click();
      await settle(page);
      const sort = await page.evaluate(() => (window as any).grid.sortExpressions.map((s: any) => [s.key, s.direction]));
      expect(sort).toEqual([['salary', 'ascending']]);
      await expect(page.locator('.apex-grid-context-menu')).toHaveCount(0);
    });

    test('R1c context menu closes on outside click and restores focus on Escape', async ({ page }) => {
      await open(page, mode);
      await cell(page, 1, 0).click();
      await page.keyboard.press('Shift+F10');
      await expect(page.locator('.apex-grid-context-menu')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('.apex-grid-context-menu')).toHaveCount(0);
      const tag = await page.evaluate(() => (window as any).deepActive()?.tagName.toLowerCase());
      expect(tag).toBe('apex-grid-cell');
      await cell(page, 1, 0).click({ button: 'right' });
      await expect(page.locator('.apex-grid-context-menu')).toBeVisible();
      await page.mouse.click(1100, 700);
      await expect(page.locator('.apex-grid-context-menu')).toHaveCount(0);
    });

    test('R1d context menu carries the theme of the outermost host', async ({ page }) => {
      await open(page, mode);
      await cell(page, 0, 0).click({ button: 'right' });
      const menu = page.locator('.apex-grid-context-menu');
      await expect(menu).toBeVisible();
      const v = await menu.evaluate((m) => ({
        brand: getComputedStyle(m).getPropertyValue('--_ag-brand').trim(),
        bg: getComputedStyle(m).backgroundColor,
      }));
      expect(v).toEqual({ brand: BRAND, bg: SURFACE });
    });

    // --- R2 chart range overlay ---------------------------------------------
    test('R2a chart-range outline sits over the selected cells', async ({ page }) => {
      await open(page, mode);
      await chartSelection(page);
      const outline = page.locator('[part="chart-range-outline"]');
      await expect(outline).toBeVisible();
      await expect(page.locator('[part="chart-range-handle"]')).toBeVisible();
      const o = (await outline.boundingBox())!;
      const tl = (await cell(page, 0, 1).boundingBox())!;
      const br = (await cell(page, 3, 2).boundingBox())!;
      expect(Math.abs(o.x - tl.x)).toBeLessThan(6);
      expect(Math.abs(o.y - tl.y)).toBeLessThan(6);
      expect(Math.abs(o.x + o.width - (br.x + br.width))).toBeLessThan(6);
      expect(Math.abs(o.y + o.height - (br.y + br.height))).toBeLessThan(6);
    });

    test('R2b chart-range handle drag grows the linked chart', async ({ page }) => {
      await open(page, mode);
      await chartSelection(page);
      const before = await page.evaluate(() => (document.querySelector('apex-grid-chart[mode="dialog"]') as any)?.staticModel?.series?.length ?? 0);
      const pt = (await cell(page, 3, 3).boundingBox())!;
      await page.evaluate(([x, y]) => {
        const h = document.querySelector('[part="chart-range-handle"]') as HTMLElement;
        const b = h.getBoundingClientRect();
        h.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: b.left + 6, clientY: b.top + 6, bubbles: true }));
        h.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: x, clientY: y, bubbles: true }));
        h.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
      }, [pt.x + pt.width / 2, pt.y + pt.height / 2]);
      await settle(page);
      const after = await page.evaluate(() => (document.querySelector('apex-grid-chart[mode="dialog"]') as any)?.staticModel?.series?.length ?? 0);
      expect(before).toBe(1);
      expect(after).toBeGreaterThan(before);
    });

    test('R2c chart-range outline uses the theme brand', async ({ page }) => {
      await open(page, mode);
      await chartSelection(page);
      const outline = page.locator('[part="chart-range-outline"]');
      await expect(outline).toBeVisible();
      const c = await outline.evaluate((e) => getComputedStyle(e).borderTopColor);
      expect(c).toBe('rgb(220, 38, 38)');
    });

    // --- R3 integrated chart dialog + affordance ---------------------------
    test('R3a chart dialog renders a chart with the theme brand as series colour', async ({ page }) => {
      await open(page, mode);
      await chartSelection(page);
      const dialog = page.locator('apex-grid-chart[mode="dialog"]');
      await expect(dialog.locator('[part="panel"]')).toBeVisible();
      const series = dialog.locator('.apexcharts-series path').first();
      await expect(series).toBeVisible({ timeout: 10_000 });
      const fill = (await series.getAttribute('fill')) ?? '';
      expect(fill.toLowerCase()).toMatch(/rgba?\(220, ?38, ?38|#dc2626/);
    });

    test('R3b chart dialog chrome follows the grid surface', async ({ page }) => {
      await open(page, mode);
      await chartSelection(page);
      const dialog = page.locator('apex-grid-chart[mode="dialog"]');
      await expect(dialog.locator('[part="panel"]')).toBeVisible();
      const bg = await dialog.locator('[part="panel"]').evaluate((p) => getComputedStyle(p).backgroundColor);
      expect(bg).toBe(SURFACE);
    });

    test('R3c Create-chart affordance appears over the grid after a selection', async ({ page }) => {
      await open(page, mode);
      await page.evaluate(() => {
        (window as any).grid.stateController.module('range-selection').selectRange(
          { row: 0, column: 'department' }, { row: 3, column: 'salary' });
      });
      await settle(page);
      const btn = page.locator('body > button[aria-label]');
      await expect(btn).toBeVisible();
      const b = (await btn.boundingBox())!;
      const g = (await page.locator('#grid').boundingBox())!;
      expect(b.x).toBeGreaterThan(g.x);
      expect(b.x + b.width).toBeLessThanOrEqual(g.x + g.width + 1);
      expect(b.y + b.height).toBeLessThanOrEqual(g.y + g.height + 1);
    });

    test('R5a chart dialog restores focus to the cell on close', async ({ page }) => {
      await open(page, mode);
      await page.evaluate(() => {
        (window as any).grid.stateController.module('range-selection').selectRange(
          { row: 0, column: 'department' }, { row: 3, column: 'salary' });
      });
      await settle(page);
      await cell(page, 0, 1).focus();
      await page.keyboard.press('Alt+F1');
      const dialog = page.locator('apex-grid-chart[mode="dialog"]');
      await expect(dialog.locator('[part="panel"]')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      const tag = await page.evaluate(() => (window as any).deepActive()?.tagName.toLowerCase());
      expect(tag).toBe('apex-grid-cell');
    });

    // --- R5 keyboard focus ---------------------------------------------------
    test('R5b ArrowDown moves the active cell', async ({ page }) => {
      await open(page, mode);
      await cell(page, 0, 0).click();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await settle(page);
      expect(await cell(page, 2, 0).evaluate((el) => el === (window as any).deepActive())).toBe(true);
    });

    test('R5c Enter commits an edit, Escape cancels, focus stays on the cell', async ({ page }) => {
      await open(page, mode);
      await cell(page, 0, 2).dblclick();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('12345');
      await page.keyboard.press('Enter');
      await settle(page);
      expect(await page.evaluate(() => (window as any).grid.data[0].salary)).toBe(12345);
      expect(await page.evaluate(() => (window as any).deepActive()?.tagName.toLowerCase())).toBe('apex-grid-cell');
      await cell(page, 1, 2).dblclick();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('1');
      await page.keyboard.press('Escape');
      await settle(page);
      expect(await page.evaluate(() => (window as any).grid.data[1].salary)).toBe(104000);
      expect(await page.evaluate(() => (window as any).deepActive()?.tagName.toLowerCase())).toBe('apex-grid-cell');
    });

    test('R5d export menu ArrowDown walks the items (toolbar.ts:205)', async ({ page }) => {
      await open(page, mode);
      await page.locator('[part="export-trigger"]').click();
      const items = page.locator('[part~="export-menu-item"]');
      await expect(items.first()).toBeVisible();
      await items.first().focus();
      await expect(items.first()).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(items.nth(1)).toBeFocused();
    });

    // --- R6 formula editor hit test --------------------------------------------
    test('R6 formula autocomplete popover is shown (elementFromPoint on-top test)', async ({ page }) => {
      await open(page, mode);
      await cell(page, 0, 3).dblclick();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('=SU');
      const sugg = page.locator('[part~="suggestions"]');
      await expect(sugg).toBeVisible();
      expect(await sugg.evaluate((e) => getComputedStyle(e).visibility)).toBe('visible');
      await page.keyboard.press('Escape');
    });

    test('R6b formula drag across cells inserts a range reference', async ({ page }) => {
      await open(page, mode);
      await cell(page, 0, 3).dblclick();
      const editor = page.locator('[part="editor"]').first();
      await editor.fill('=SUM(');
      const a = (await cell(page, 0, 2).boundingBox())!;
      const b = (await cell(page, 2, 2).boundingBox())!;
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
      await page.mouse.up();
      await expect(editor).toHaveValue(/=SUM\(C1:C3/);
    });

    // --- sweep -----------------------------------------------------------------
    test('S1 header click sorts', async ({ page }) => {
      await open(page, mode);
      await page.locator('apex-grid-header').nth(0).locator('button[data-sort-active]').click();
      await settle(page);
      expect(await page.evaluate(() => (window as any).grid.sortExpressions.length)).toBe(1);
    });

    test('S2 header kebab opens the shared menu, sorts, closes on outside click', async ({ page }) => {
      await open(page, mode);
      const header = page.locator('apex-grid-header').nth(2);
      const menu = page.locator('.apex-grid-context-menu');
      await header.locator('[part~="menu-btn"]').click();
      await expect(menu).toBeVisible();
      await page.mouse.click(1100, 700);
      await expect(menu).toHaveCount(0);
      await header.locator('[part~="menu-btn"]').click();
      await menu.locator('.agcm-item').first().click();
      await settle(page);
      expect(await page.evaluate(() => (window as any).grid.sortExpressions.map((s: any) => s.key))).toEqual(['salary']);
    });

    test('S3 filter button + input filters rows', async ({ page }) => {
      await open(page, mode);
      await page.locator('apex-grid-header').nth(1).locator('[part~="filter-btn"]').click();
      const input = page.locator('[part="filter-input"]');
      await expect(input).toBeVisible();
      await input.fill('Sales');
      await input.press('Enter');
      await settle(page);
      expect(await page.evaluate(() => (window as any).grid.dataView.length)).toBe(3);
    });

    test('S4 column resize by dragging the header edge', async ({ page }) => {
      await open(page, mode);
      const handle = page.locator('apex-grid-header').nth(0).locator('[part="resizable"]');
      const h = (await handle.boundingBox())!;
      const w0 = (await page.locator('apex-grid-header').nth(0).boundingBox())!.width;
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await page.mouse.down();
      await page.mouse.move(h.x + 80, h.y + h.height / 2, { steps: 5 });
      await page.mouse.up();
      await settle(page);
      const w1 = (await page.locator('apex-grid-header').nth(0).boundingBox())!.width;
      expect(w1).toBeGreaterThan(w0 + 40);
    });

    test('S5 header drag reorders columns', async ({ page }) => {
      await open(page, mode);
      const from = (await page.locator('apex-grid-header').nth(1).boundingBox())!;
      const to = (await page.locator('apex-grid-header').nth(0).boundingBox())!;
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + 10, to.y + to.height / 2, { steps: 10 });
      await page.mouse.up();
      await settle(page);
      const keys = await page.evaluate(() => ((window as any).grid.displayColumns ?? (window as any).grid.columns).map((c: any) => c.key));
      expect(keys[0]).toBe('department');
    });

    test('S6 row drag reorders rows', async ({ page }) => {
      await open(page, mode, 'enterprise', { rowDrag: true });
      const grip = page.locator('apex-grid-row').nth(0).locator('[part~="reorder-handle"]');
      const from = (await (await grip.count() ? grip : cell(page, 0, 1)).boundingBox())!;
      const to = (await cell(page, 3, 1).boundingBox())!;
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2, to.y + to.height * 0.8, { steps: 12 });
      await page.mouse.up();
      await settle(page);
      const names = await page.evaluate(() => (window as any).grid.dataView.map((r: any) => r.name));
      expect(names[0]).not.toBe('Ava');
    });

    test('S7 CSV export from the toolbar downloads a file', async ({ page }) => {
      await open(page, mode);
      await page.locator('[part="export-trigger"]').click();
      const dl = page.waitForEvent('download');
      await page.locator('[part~="export-menu-item"]').first().click();
      expect((await dl).suggestedFilename()).toMatch(/\.(csv|xlsx)$/);
    });

    test('S8 removing the outer host cleans up body portals', async ({ page }) => {
      await open(page, mode);
      await chartSelection(page);
      await cell(page, 0, 0).click({ button: 'right' });
      await expect(page.locator('.apex-grid-context-menu')).toBeVisible();
      await page.evaluate(() => (window as any).outer.remove());
      await page.waitForTimeout(150);
      const left = await page.evaluate(() => ({
        menu: document.querySelectorAll('.apex-grid-context-menu').length,
        outline: document.querySelectorAll('[part="chart-range-outline"]').length,
        handle: document.querySelectorAll('[part="chart-range-handle"]').length,
        affordance: [...document.querySelectorAll('body > button')].filter((b) => (b as HTMLElement).style.display !== 'none').length,
      }));
      expect(left).toEqual({ menu: 0, outline: 0, handle: 0, affordance: 0 });
    });

    // --- R4 core host stylesheet ------------------------------------------------
    test('R4 core apex-grid host default min-height (setup.ts:46)', async ({ page }) => {
      await open(page, mode, 'core', { noHeight: true });
      const mh = await page.evaluate(() => getComputedStyle((window as any).grid).minHeight);
      expect(mh).toBe('240px');
    });
  });
}
