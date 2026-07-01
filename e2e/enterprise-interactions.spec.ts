import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type Route, test } from '@playwright/test';

// Interaction-level e2e for the enterprise demos: drives real UI (demo buttons,
// shadow-DOM controls, cell edits, drag-and-drop, downloads) and asserts real
// outcomes via the grid's public API. Distinct from demos.spec.ts, which only
// captures full-page screenshots.
//
// Covers the 9 demos that assert cleanly end-to-end. The three with a soft spot
// (infinite-row-model scroll, range-selection clipboard/paste, integrated-charts
// bar-click) are intentionally not here yet.

const LIT_ESM = readFileSync(fileURLToPath(new URL('./vendor/lit.esm.js', import.meta.url)));
const STUB_AVATAR =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">' +
  '<circle cx="20" cy="20" r="20" fill="#cbd5e1"/></svg>';

/** Same deterministic network routing demos.spec.ts uses (CDN theme aborted,
 *  lit vendored, fonts + same-origin through). */
async function routeDeterministically(route: Route): Promise<void> {
  const url = route.request().url();
  const { hostname, pathname } = new URL(url);
  if (hostname === '127.0.0.1' || hostname === 'localhost') return route.continue();
  if (hostname === 'fonts.googleapis.com' || hostname === 'fonts.gstatic.com') {
    return route.continue();
  }
  if ((hostname === 'cdn.jsdelivr.net' || hostname === 'esm.sh') && pathname.includes('lit')) {
    return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: LIT_ESM });
  }
  if (route.request().resourceType() === 'image') {
    return route.fulfill({ contentType: 'image/svg+xml', body: STUB_AVATAR });
  }
  return route.abort();
}

/** Navigate to a demo and wait until the grid has painted real cells. */
async function openDemo(page: Page, file: string): Promise<void> {
  await page.route('**/*', routeDeterministically);
  await page.goto(`/demo/${file}`, { waitUntil: 'load' });
  await expect(page.locator('apex-grid-cell').first()).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => (document as Document & { fonts: FontFaceSet }).fonts.ready);
  // Let seeded async (formulas, pre-selection, grouping) settle one frame.
  await page.waitForTimeout(200);
}

/** Await the grid's render settle inside the page. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const g = document.getElementById('grid') as unknown as { updateComplete?: Promise<unknown> };
    await g?.updateComplete;
  });
  await page.waitForTimeout(80);
}

// --- 1. Column aggregations --------------------------------------------------

test.describe('aggregations-enterprise', () => {
  test('computes exact sum/avg/min/max/count for configured columns', async ({ page }) => {
    await openDemo(page, 'aggregations-enterprise.html');

    // Real button drives getAggregations() into the preview box.
    await page.locator('#compute').click();
    await expect(page.locator('#preview')).toContainText('price');

    const agg = await page.evaluate(() =>
      (document.getElementById('grid') as unknown as { getAggregations(): Record<string, Record<string, number>> }).getAggregations()
    );
    expect(agg.price.sum).toBeCloseTo(657.92, 2);
    expect(agg.price.avg).toBeCloseTo(109.6533, 2);
    expect(agg.price.min).toBeCloseTo(49.99, 2);
    expect(agg.price.max).toBeCloseTo(189, 2);
    expect(agg.sold.sum).toBe(347);
    expect(agg.sold.max).toBe(91);
    expect(agg.rating.avg).toBeCloseTo(4.1167, 3);
  });

  test('only the configured columns are aggregated, and recompute is stable', async ({ page }) => {
    await openDemo(page, 'aggregations-enterprise.html');
    const a = await page.evaluate(() => (document.getElementById('grid') as any).getAggregations());
    const b = await page.evaluate(() => (document.getElementById('grid') as any).getAggregations());
    expect(Object.keys(a).sort()).toEqual(['price', 'rating', 'sold']);
    expect(b).toEqual(a); // idempotent
  });
});

// --- 2. Row grouping ---------------------------------------------------------

test.describe('row-grouping-enterprise', () => {
  test('on load: grouped by department with correct counts + subtotals', async ({ page }) => {
    await openDemo(page, 'row-grouping-enterprise.html');
    const groups = await page.evaluate(() =>
      (document.getElementById('grid') as any).getGroups().map((g: any) => ({
        value: g.value,
        count: g.count,
        salarySum: g.aggregates?.salary?.sum,
        salaryAvg: g.aggregates?.salary?.avg,
        ageAvg: g.aggregates?.age?.avg,
      }))
    );
    const eng = groups.find((g: any) => g.value === 'Engineering');
    const sales = groups.find((g: any) => g.value === 'Sales');
    const mktg = groups.find((g: any) => g.value === 'Marketing');
    expect(groups).toHaveLength(3);
    expect(eng).toMatchObject({ count: 5, salarySum: 478000, salaryAvg: 95600 });
    expect(eng.ageAvg).toBeCloseTo(34.8, 1);
    expect(sales).toMatchObject({ count: 4, salarySum: 297000, salaryAvg: 74250 });
    expect(sales.ageAvg).toBeCloseTo(39.5, 1);
    expect(mktg).toMatchObject({ count: 3, salarySum: 203000 });
    expect(mktg.salaryAvg).toBeCloseTo(67666.67, 0);
  });

  test('nest region → department, then ungroup', async ({ page }) => {
    await openDemo(page, 'row-grouping-enterprise.html');
    await page.locator('#by-region-dept').click();
    await settle(page);
    const nested = await page.evaluate(() => {
      const g = document.getElementById('grid') as any;
      return { groupBy: g.groupBy, values: g.getGroups().map((x: any) => x.value) };
    });
    expect(nested.groupBy).toEqual(['region', 'department']);
    // getGroups() reports every level; both regions and a department must appear.
    expect(nested.values).toEqual(expect.arrayContaining(['AMER', 'EMEA', 'Engineering']));

    await page.locator('#ungroup').click();
    await settle(page);
    const flat = await page.evaluate(() => {
      const g = document.getElementById('grid') as any;
      return { groupBy: g.groupBy, rows: g.pageItems.length };
    });
    expect(flat.groupBy).toEqual([]);
    expect(flat.rows).toBe(12);
  });

  test('collapse all then expand all changes the visible row count', async ({ page }) => {
    await openDemo(page, 'row-grouping-enterprise.html');
    const expanded = await page.evaluate(() => (document.getElementById('grid') as any).pageItems.length);
    await page.locator('#collapse').click();
    await settle(page);
    const collapsed = await page.evaluate(() => (document.getElementById('grid') as any).pageItems.length);
    expect(collapsed).toBeLessThan(expanded);
    expect(collapsed).toBe(3); // just the 3 department headers
    await page.locator('#expand').click();
    await settle(page);
    const reExpanded = await page.evaluate(() => (document.getElementById('grid') as any).pageItems.length);
    expect(reExpanded).toBe(expanded);
  });
});

// --- 3. Pivoting -------------------------------------------------------------

/** Read pivot cells grouped by the value segment of the synthetic column key
 *  (`pivot::<value>::<measure>::<fn>`). */
async function pivotCells(page: Page) {
  return page.evaluate(() => {
    const g = document.getElementById('grid') as any;
    const cols = g.columns.filter((c: any) => String(c.key).startsWith('pivot::'));
    const byValue: Record<string, number[]> = {};
    for (const c of cols) {
      const value = String(c.key).split('::')[1];
      (byValue[value] ||= []).push(...g.pageItems.map((r: any) => Number(r[c.key])));
    }
    for (const k of Object.keys(byValue)) byValue[k].sort((a, b) => a - b);
    return { rowCount: g.pageItems.length, byValue };
  });
}

test.describe('pivoting-enterprise', () => {
  test('on load: Region × Department, cells = sum of salary', async ({ page }) => {
    await openDemo(page, 'pivoting-enterprise.html');
    const { rowCount, byValue } = await pivotCells(page);
    expect(rowCount).toBe(2); // AMER, EMEA
    expect(byValue.Engineering).toEqual([203000, 275000]);
    expect(byValue.Sales).toEqual([144000, 153000]);
    expect(byValue.Marketing).toEqual([64000, 139000]); // edge: single-value EMEA cell = 64000
  });

  test('swap to Department × Region (avg salary)', async ({ page }) => {
    await openDemo(page, 'pivoting-enterprise.html');
    await page.locator('#dept-region').click();
    await settle(page);
    const { rowCount, byValue } = await pivotCells(page);
    expect(rowCount).toBe(3); // Engineering, Sales, Marketing
    expect(byValue.AMER).toEqual([69500, 76500, 101500]);
    expect(byValue.EMEA[0]).toBe(64000);
    expect(byValue.EMEA[1]).toBe(72000);
    expect(byValue.EMEA[2]).toBeCloseTo(91666.67, 0);
  });

  test('clear pivot restores the flat columns', async ({ page }) => {
    await openDemo(page, 'pivoting-enterprise.html');
    await page.locator('#clear').click();
    await settle(page);
    const flat = await page.evaluate(() => {
      const g = document.getElementById('grid') as any;
      return { keys: g.columns.map((c: any) => c.key), rows: g.pageItems.length };
    });
    expect(flat.keys).toEqual(['name', 'department', 'region', 'salary']);
    expect(flat.rows).toBe(12);
  });
});

// --- 4. Columns tool panel ---------------------------------------------------

test.describe('columns-tool-panel-enterprise', () => {
  const panelItem = (page: Page, name: string) =>
    page.locator('apex-grid-tool-panel [part="item"]').filter({ hasText: name });

  const columnState = (page: Page, key: string) =>
    page.evaluate((k) => {
      const c = (document.getElementById('grid') as any).columns.find((x: any) => x.key === k);
      return { hidden: !!c.hidden, pinned: c.pinned ?? null, index: (document.getElementById('grid') as any).columns.findIndex((x: any) => x.key === k) };
    }, key);

  test('search narrows the column list', async ({ page }) => {
    await openDemo(page, 'columns-tool-panel-enterprise.html');
    await expect(page.locator('apex-grid-tool-panel [part="item"]')).toHaveCount(5);
    await page.locator('apex-grid-tool-panel [part="search"]').fill('sal');
    await expect(page.locator('apex-grid-tool-panel [part="item"]')).toHaveCount(1);
    await page.locator('apex-grid-tool-panel [part="search"]').fill('');
    await expect(page.locator('apex-grid-tool-panel [part="item"]')).toHaveCount(5);
  });

  test('visibility checkbox hides/shows a grid column', async ({ page }) => {
    await openDemo(page, 'columns-tool-panel-enterprise.html');
    await panelItem(page, 'Age').locator('input[type="checkbox"]').click();
    expect((await columnState(page, 'age')).hidden).toBe(true);
    await panelItem(page, 'Age').locator('input[type="checkbox"]').click();
    expect((await columnState(page, 'age')).hidden).toBe(false);
  });

  test('pin button cycles none → start → end → none', async ({ page }) => {
    await openDemo(page, 'columns-tool-panel-enterprise.html');
    expect((await columnState(page, 'name')).pinned).toBeNull();
    const pin = panelItem(page, 'Name').locator('[part="pin"]');
    await pin.click();
    expect((await columnState(page, 'name')).pinned).not.toBeNull();
    await pin.click();
    await pin.click();
    expect((await columnState(page, 'name')).pinned).toBeNull();
  });

  test('reorder moves a column in the grid order', async ({ page }) => {
    await openDemo(page, 'columns-tool-panel-enterprise.html');
    expect((await columnState(page, 'name')).index).toBe(0);
    await panelItem(page, 'Name').locator('[part="down"]').click();
    expect((await columnState(page, 'name')).index).toBe(1);
  });

  test('drag a column into Row Groups groups the grid', async ({ page }) => {
    await openDemo(page, 'columns-tool-panel-enterprise.html');
    const zone = page
      .locator('apex-grid-tool-panel [part="zone"]')
      .filter({ hasText: 'Row Groups' });
    await panelItem(page, 'Department').dragTo(zone);
    await settle(page);
    const groupBy = await page.evaluate(() => (document.getElementById('grid') as any).groupBy);
    expect(groupBy).toContain('department');
  });

  test('pivot mode reveals the Column Labels zone', async ({ page }) => {
    await openDemo(page, 'columns-tool-panel-enterprise.html');
    await expect(
      page.locator('apex-grid-tool-panel [part="zone-title"]', { hasText: 'Column Labels' })
    ).toHaveCount(0);
    await page.locator('apex-grid-tool-panel [part="pivot-toggle"] input[type="checkbox"]').click();
    await settle(page);
    await expect(
      page.locator('apex-grid-tool-panel [part="zone-title"]', { hasText: 'Column Labels' })
    ).toHaveCount(1);
  });
});

// --- 5. Set filter -----------------------------------------------------------

test.describe('set-filter-enterprise', () => {
  const visible = (page: Page) =>
    page.evaluate(() => {
      const g = document.getElementById('grid') as any;
      return {
        count: g.pageItems.length,
        depts: [...new Set(g.pageItems.map((r: any) => r.department))].sort(),
      };
    });

  // Drive the filter element's public API (robust); assert the grid's rows.
  const setTokens = (page: Page, tokens: string[]) =>
    page.evaluate(async (t) => {
      const f = document.getElementById('filter') as any;
      f.setSelectedTokens(t);
      await (document.getElementById('grid') as any).updateComplete;
    }, tokens);

  test('on load: Sales is unticked, so its rows are hidden', async ({ page }) => {
    await openDemo(page, 'set-filter-enterprise.html');
    const v = await visible(page);
    expect(v.count).toBeLessThan(10);
    expect(v.depts).not.toContain('Sales');
  });

  test('ticking a single value filters to just that department', async ({ page }) => {
    await openDemo(page, 'set-filter-enterprise.html');
    await setTokens(page, ['Engineering']);
    const v = await visible(page);
    expect(v.depts).toEqual(['Engineering']);
  });

  test('clearAll hides every row; selectAll restores them', async ({ page }) => {
    await openDemo(page, 'set-filter-enterprise.html');
    await page.evaluate(async () => {
      (document.getElementById('filter') as any).clearAll();
      await (document.getElementById('grid') as any).updateComplete;
    });
    expect((await visible(page)).count).toBe(0);
    await page.evaluate(async () => {
      (document.getElementById('filter') as any).selectAll();
      await (document.getElementById('grid') as any).updateComplete;
    });
    expect((await visible(page)).count).toBe(10);
  });

  test('the popover opens from the toolbar trigger', async ({ page }) => {
    await openDemo(page, 'set-filter-enterprise.html');
    await page.locator('#toggle').click();
    await expect(page.locator('apex-grid-set-filter')).toBeVisible();
  });
});

// --- 6. Master / detail ------------------------------------------------------

test.describe('master-detail-enterprise', () => {
  // Detail grids are community `apex-grid` nested inside the enterprise master.
  const detailGrids = (page: Page) => page.locator('apex-grid');

  test('on load: first order is expanded with its 3 line items', async ({ page }) => {
    await openDemo(page, 'master-detail-enterprise.html');
    await expect(detailGrids(page)).toHaveCount(1);
    await expect(detailGrids(page).first().locator('apex-grid-row')).toHaveCount(3);
  });

  test('expand all reveals every detail with the right item counts', async ({ page }) => {
    await openDemo(page, 'master-detail-enterprise.html');
    await page.locator('#expand').click();
    await settle(page);
    await expect(detailGrids(page)).toHaveCount(4);
    const counts = await detailGrids(page).evaluateAll((grids) =>
      grids.map((g) => (g as any).pageItems?.length ?? (g.shadowRoot?.querySelectorAll('apex-grid-row').length ?? 0))
    );
    expect(counts).toEqual([3, 2, 2, 1]);
  });

  test('collapse all closes details; re-expand restores them (cache)', async ({ page }) => {
    await openDemo(page, 'master-detail-enterprise.html');
    await page.locator('#collapse').click();
    await settle(page);
    await expect(detailGrids(page)).toHaveCount(0);
    await page.locator('#expand').click();
    await settle(page);
    await expect(detailGrids(page)).toHaveCount(4);
    await expect(detailGrids(page).first().locator('apex-grid-row')).toHaveCount(3);
  });
});

// --- 7. AI toolkit (offline mock) -------------------------------------------

test.describe('ai-toolkit', () => {
  const pageItems = (page: Page) =>
    page.evaluate(() => (document.getElementById('grid') as any).pageItems.map((r: any) => r.name));

  const runControl = (page: Page, prompt: string) =>
    page.evaluate(async (p) => {
      const g = document.getElementById('grid') as any;
      (window as any).__r = await g.runPrompt(p, { mode: 'control' });
      await g.updateComplete;
    }, prompt);

  const undo = (page: Page) =>
    page.evaluate(async () => {
      (window as any).__r.undo();
      await (document.getElementById('grid') as any).updateComplete;
    });

  test('"group by department" groups, and Undo reverts', async ({ page }) => {
    await openDemo(page, 'ai-toolkit.html');
    await runControl(page, 'group by department');
    expect(await page.evaluate(() => (document.getElementById('grid') as any).getGroups().length)).toBe(3);
    await undo(page);
    expect(await page.evaluate(() => (document.getElementById('grid') as any).getGroups().length)).toBe(0);
  });

  test('"sort by salary, highest first" reorders rows', async ({ page }) => {
    await openDemo(page, 'ai-toolkit.html');
    await runControl(page, 'sort by salary, highest first');
    expect((await pageItems(page))[0]).toBe('Liam Chen'); // 104,000
  });

  test('"filter department = Engineering" keeps only Engineering', async ({ page }) => {
    await openDemo(page, 'ai-toolkit.html');
    await runControl(page, 'filter department = Engineering');
    const depts = await page.evaluate(() => [
      ...new Set((document.getElementById('grid') as any).pageItems.map((r: any) => r.department)),
    ]);
    expect(depts).toEqual(['Engineering']);
  });

  test('"search Ava" quick-filters to one row; reset clears it', async ({ page }) => {
    await openDemo(page, 'ai-toolkit.html');
    await runControl(page, 'search Ava');
    expect(await pageItems(page)).toEqual(['Ava Morgan']);
    await runControl(page, 'reset');
    expect((await pageItems(page)).length).toBe(12);
  });

  test('Ask mode answers questions from the mock', async ({ page }) => {
    await openDemo(page, 'ai-toolkit.html');
    const ask = (prompt: string) =>
      page.evaluate(async (p) => {
        const r = await (document.getElementById('grid') as any).runPrompt(p, { mode: 'ask' });
        return r.answer as string;
      }, prompt);
    expect(await ask('how many rows')).toBe('There are 12 rows.');
    expect(await ask('highest salary')).toBe('Highest Salary: 104,000');
    expect(await ask('lowest salary')).toBe('Lowest Salary: 64,000');
    expect(await ask('average salary')).toBe('Average Salary: 81,500');
    expect(await ask('do a backflip')).toContain('Try'); // edge: unknown prompt -> hint
  });

  test('a preset chip fills the prompt input', async ({ page }) => {
    await openDemo(page, 'ai-toolkit.html');
    await page.locator('.chips button', { hasText: 'Group by department' }).click();
    const value = await page.evaluate(
      () => ((document.getElementById('ai') as any).renderRoot.querySelector('[part="input"]') as HTMLInputElement).value
    );
    expect(value).toBe('group by department');
  });
});

// --- 8. Spreadsheet formulas -------------------------------------------------

test.describe('formula-engine', () => {
  const totals = (page: Page) =>
    page.evaluate(() => (document.getElementById('grid') as any).data.map((r: any) => r.total));

  test('on load: seeded formulas are computed', async ({ page }) => {
    await openDemo(page, 'formula-engine.html');
    expect(await totals(page)).toEqual([25, 48, 63, 35, 60, 231]);
  });

  test('double-clicking a formula cell opens the editor with its source, no echo popover', async ({
    page,
  }) => {
    await openDemo(page, 'formula-engine.html');
    const totalCell = page.locator('apex-grid-row').first().locator('apex-grid-cell').nth(3);
    await totalCell.dblclick();
    const editor = page.locator('[part="editor"]').first();
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue('=B1*C1');
    // Regression: the redundant formula-echo preview is gone. No popover shows on
    // open; one only appears for autocomplete (typing a name) or a parse error.
    await expect(page.locator('[part="popover"]')).toHaveCount(0);
  });

  test('formula coordinates show by default and stay put across an edit (no layout shift)', async ({
    page,
  }) => {
    await openDemo(page, 'formula-engine.html');
    const grid = page.locator('apex-grid-enterprise');
    // On by default because the grid has an allowFormula column: the row-number
    // gutter + column-letter chips are reserved up front, so entering a formula
    // never pops them in (which used to shift every column).
    await expect(grid).toHaveAttribute('coordinate-hints', '');
    await expect(page.locator('[part="row-number"]').first()).toHaveText('1');
    await expect(page.locator('[part="coord-letter"]').first()).toHaveText('A');

    // Present before, during, and after the edit — the layout does not change.
    await page.locator('apex-grid-row').first().locator('apex-grid-cell').nth(3).dblclick();
    await expect(grid).toHaveAttribute('coordinate-hints', '');
    await page.keyboard.press('Escape');
    await expect(grid).toHaveAttribute('coordinate-hints', '');
    await expect(page.locator('[part="row-number"]').first()).toHaveText('1');
  });

  test('editing a formula highlights its referenced cells, cleared on exit', async ({ page }) => {
    await openDemo(page, 'formula-engine.html');
    const row0 = page.locator('apex-grid-row').first();
    // Row 1 Total = "=B1*C1": editing it lights up B1 (Qty) and C1 (Unit Price).
    await row0.locator('apex-grid-cell').nth(3).dblclick();
    const qty = row0.locator('apex-grid-cell').nth(1);
    const price = row0.locator('apex-grid-cell').nth(2);
    await expect(qty).toHaveAttribute('data-formula-ref', /\d+/);
    await expect(price).toHaveAttribute('data-formula-ref', /\d+/);
    // Distinct references get distinct palette slots (D5 one color, E5 another).
    const a = await qty.getAttribute('data-formula-ref');
    const b = await price.getAttribute('data-formula-ref');
    expect(a).not.toBe(b);
    // Highlight clears when the edit ends.
    await page.keyboard.press('Escape');
    await expect(qty).not.toHaveAttribute('data-formula-ref');
  });

  test('click-to-insert adds a reference at the caret, never prepended (bug fix)', async ({
    page,
  }) => {
    await openDemo(page, 'formula-engine.html');
    const row0 = page.locator('apex-grid-row').first();
    await row0.locator('apex-grid-cell').nth(3).dblclick();
    const editor = page.locator('[part="editor"]').first();
    await expect(editor).toHaveValue('=B1*C1');
    // Click the Qty (B1) cell while editing -> reference inserts at the caret (end).
    await row0.locator('apex-grid-cell').nth(1).click();
    const value = await editor.inputValue();
    expect(value.startsWith('=')).toBe(true); // still a formula
    expect(value).not.toMatch(/^[A-Za-z]+\d+=/); // NOT prepended before the '='
    expect(value).toContain('B1'); // the reference was inserted
  });

  test('editing Qty recalculates the row total and the grand total', async ({ page }) => {
    await openDemo(page, 'formula-engine.html');
    const qty = page.locator('apex-grid-row').first().locator('apex-grid-cell').nth(1);
    await qty.dblclick();
    const editor = page.locator('[data-apex-editor]').first();
    await editor.fill('20');
    await editor.press('Enter');
    await settle(page);
    const t = await totals(page);
    expect(t[0]).toBe(50); // 20 * 2.5
    expect(t[5]).toBe(256); // 50 + 48 + 63 + 35 + 60
  });

  test('Show formulas reveals the source, then restores values', async ({ page }) => {
    await openDemo(page, 'formula-engine.html');
    const totalCell = page.locator('apex-grid-row').first().locator('apex-grid-cell').nth(3);
    await page.locator('#toggle-formulas').click();
    await expect(totalCell).toContainText('=B1*C1');
    await page.locator('#toggle-formulas').click();
    await expect(totalCell).toContainText('25');
  });

  test('CSV export emits formula source with { formulas: true }, values without', async ({ page }) => {
    await openDemo(page, 'formula-engine.html');
    const withFormulas = await page.evaluate(() =>
      (document.getElementById('grid') as any).exportToCSV({ filename: '', formulas: true })
    );
    expect(withFormulas).toContain('=B1*C1');
    expect(withFormulas).toContain('=ROUND(SUM(D1:D5),2)');
    const plain = await page.evaluate(() =>
      (document.getElementById('grid') as any).exportToCSV({ filename: '' })
    );
    expect(plain).toContain('25');
    expect(plain).not.toContain('=B1*C1');
  });

  test('Export formulas button downloads budget-formulas.csv', async ({ page }) => {
    await openDemo(page, 'formula-engine.html');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#export-formulas').click(),
    ]);
    expect(download.suggestedFilename()).toBe('budget-formulas.csv');
    const path = await download.path();
    expect(readFileSync(path, 'utf8')).toContain('=B1*C1');
  });

  test('function library + error sentinels', async ({ page }) => {
    await openDemo(page, 'formula-engine.html');
    // Set a formula on row 0's total and read its canonical value. Errors are
    // FormulaError objects whose `.code` is the sentinel (read in-page, since the
    // object's methods don't survive serialization across page.evaluate).
    const result = (formula: string) =>
      page.evaluate(async (f) => {
        const g = document.getElementById('grid') as any;
        g.setFormula(g.data[0], 'total', f);
        await g.updateComplete;
        const v = g.data[0].total;
        return v != null && typeof v === 'object' && 'code' in v ? v.code : v;
      }, formula);

    expect(await result('=POWER(B1,2)')).toBe(100); // qty 10 ^ 2
    expect(await result('=MOD(B1,3)')).toBe(1); // 10 mod 3
    expect(await result('=MOD(B1,0)')).toBe('#DIV/0!'); // guarded divide-by-zero
    expect(String(await result('=D1'))).toContain('#'); // self-reference -> cycle/ref error
  });

  test('autocomplete suggests a function when typing "=SU"', async ({ page }) => {
    await openDemo(page, 'formula-engine.html');
    const totalCell = page.locator('apex-grid-row').first().locator('apex-grid-cell').nth(3);
    await totalCell.dblclick();
    await page.keyboard.type('=SU');
    await expect(page.locator('[part="suggestion"]').first()).toContainText('SUM');
    // Regression: suggestions float as a dropdown; they must NOT grow the row.
    const rowBox = await page.locator('apex-grid-row').first().boundingBox();
    expect(rowBox?.height ?? 999).toBeLessThan(60);
    await page.keyboard.press('Escape');
  });
});

// --- 9. Excel (XLSX) export --------------------------------------------------

test.describe('xlsx-export-enterprise', () => {
  // Export scopes are asserted via CSV (readable text, same row-resolution path);
  // the XLSX path is asserted as a valid, non-empty zip + the real download.
  const csvRows = (page: Page, source: string) =>
    page.evaluate((s) => {
      const text = (document.getElementById('grid') as any).exportToCSV({ filename: '', source: s });
      return text.trim().split('\n').length; // header + data lines
    }, source);

  test('view/all export every row; selected respects the selection', async ({ page }) => {
    await openDemo(page, 'xlsx-export-enterprise.html');
    expect(await csvRows(page, 'view')).toBe(7); // 1 header + 6 products
    expect(await csvRows(page, 'all')).toBe(7);

    // Select two rows, then export 'selected'.
    await page.evaluate(async () => {
      const g = document.getElementById('grid') as any;
      await g.selectRow(g.data[0]);
      await g.selectRow(g.data[2]);
      await g.updateComplete;
    });
    expect(await csvRows(page, 'selected')).toBe(3); // header + 2 rows
  });

  test('edge: "selected" with nothing selected exports only the header', async ({ page }) => {
    await openDemo(page, 'xlsx-export-enterprise.html');
    const text = await page.evaluate(() =>
      (document.getElementById('grid') as any).exportToCSV({ filename: '', source: 'selected' })
    );
    expect(text).not.toContain('Wireless Headphones');
  });

  test('exportToXLSX returns a valid (PK-zip) non-empty workbook', async ({ page }) => {
    await openDemo(page, 'xlsx-export-enterprise.html');
    const info = await page.evaluate(() => {
      const bytes = (document.getElementById('grid') as any).exportToXLSX({ filename: '', sheetName: 'Products' });
      return { len: bytes.length, pk: bytes[0] === 0x50 && bytes[1] === 0x4b };
    });
    expect(info.len).toBeGreaterThan(0);
    expect(info.pk).toBe(true); // OOXML is a zip; starts with "PK"
  });

  test('the toolbar buttons download data.xlsx / all.xlsx', async ({ page }) => {
    await openDemo(page, 'xlsx-export-enterprise.html');
    const [view] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#dl-view').click(),
    ]);
    expect(view.suggestedFilename()).toBe('data.xlsx');
    const [all] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#dl-all').click(),
    ]);
    expect(all.suggestedFilename()).toBe('all.xlsx');
  });
});
