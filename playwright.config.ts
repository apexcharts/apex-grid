import { defineConfig } from '@playwright/test';

// Visual-snapshot e2e suite. Renders every standalone demo in `demo/` against
// the locally-built `apex-grid.min.js` bundle and compares a full-page
// screenshot to a committed baseline. This is the high-confidence regression
// net for the shipped artifact (bundle + demos), kept separate from the
// component-level unit tests in `packages/core` (which run under wtr).
//
// IMPORTANT — baselines are environment-sensitive. Font hinting/antialiasing
// differs across OSes, so a baseline captured on macOS will not match one
// rendered on Linux CI. Generate/refresh baselines in the SAME environment that
// verifies them: see the `e2e:docker` script for the canonical Linux baselines.
const PORT = 5599;

export default defineConfig({
  testDir: './e2e',
  // Baselines are keyed by browser project AND OS because font hinting/antialiasing
  // differ across platforms. Only the Linux set (`chromium-linux`) is committed and
  // gated by CI — it is the single source of truth; refresh it with
  // `npm run e2e:docker:update`. Running natively on a non-Linux host writes to a
  // separate, gitignored `chromium-<platform>` dir (e.g. `chromium-darwin`); that is
  // a local-only convenience and is never committed. A native run with no local
  // baseline fails with a clear "snapshot doesn't exist" — use `npm run e2e:docker`.
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}-{platform}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  expect: {
    toHaveScreenshot: {
      // `maxDiffPixelRatio` absorbs sub-pixel antialiasing noise; the tighter
      // per-pixel `threshold` (default 0.2) still flags subtle color/tint shifts
      // — which, for a restyle-focused project, are exactly the regressions we
      // care about catching.
      maxDiffPixelRatio: 0.01,
      threshold: 0.15,
      animations: 'disabled',
      caret: 'hide',
      // Capture at CSS resolution so DPR differences never enter the baseline.
      scale: 'css',
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: 'chromium',
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: `node e2e/static-server.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/demo/simple-grid.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
