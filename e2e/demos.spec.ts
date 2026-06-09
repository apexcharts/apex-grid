import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type Route, test } from '@playwright/test';

// Discover every standalone demo at collection time so adding a `demo/*.html`
// automatically gets a snapshot test (and a missing baseline fails loudly).
const DEMO_DIR = fileURLToPath(new URL('../demo', import.meta.url));
const DEMOS = readdirSync(DEMO_DIR)
  .filter((name) => name.endsWith('.html'))
  .sort();

// Locally-bundled lit, served in place of the demos' CDN `html` imports
// (jsdelivr / esm.sh). Built by `e2e:vendor`; see e2e/vendor-lit-entry.js.
const LIT_ESM = readFileSync(fileURLToPath(new URL('./vendor/lit.esm.js', import.meta.url)));

// A fixed, neutral avatar so demos that render remote profile images
// (dicebear) stay byte-identical across runs.
const STUB_AVATAR =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">' +
  '<circle cx="20" cy="20" r="20" fill="#cbd5e1"/></svg>';

/**
 * Route handler that makes the network deterministic:
 *  - same-origin (the page, the bundle, local fonts) -> through;
 *  - Google Fonts -> through (Inter drives layout; required for stable metrics);
 *  - lit `html` module imports (jsdelivr / esm.sh) -> the vendored local bundle,
 *    so a CDN hiccup can't break the demos that build templates with it;
 *  - remote avatar images -> a fixed stub SVG;
 *  - every other CDN (jsdelivr igniteui themes) -> aborted. The demos tolerate a
 *    missing optional theme stylesheet, falling back to the default `--ag-*`
 *    look, which is exactly what we want to pin.
 */
async function routeDeterministically(route: Route): Promise<void> {
  const url = route.request().url();
  const { hostname, pathname } = new URL(url);

  if (hostname === '127.0.0.1' || hostname === 'localhost') {
    return route.continue();
  }
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

/** Wait until the grid has painted real content and fonts have settled. */
async function waitForGridReady(page: Page): Promise<void> {
  // Playwright CSS selectors pierce open shadow roots, so this finds body cells
  // rendered inside <apex-grid>'s (and its rows'/cells') shadow DOM.
  await expect(page.locator('apex-grid-cell').first()).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  // Let the virtualizer settle its first measured frame before capturing.
  await page.waitForTimeout(300);
}

test.describe('demo snapshots', () => {
  for (const demo of DEMOS) {
    test(demo, async ({ page }) => {
      await page.route('**/*', routeDeterministically);
      await page.goto(`/demo/${demo}`, { waitUntil: 'load' });
      await waitForGridReady(page);
      await expect(page).toHaveScreenshot(`${demo.replace(/\.html$/, '')}.png`, {
        fullPage: true,
      });
    });
  }
});
