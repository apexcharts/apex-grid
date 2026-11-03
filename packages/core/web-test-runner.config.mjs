import { fileURLToPath } from 'node:url';
import { esbuildPlugin } from '@web/dev-server-esbuild';
import { playwrightLauncher } from '@web/test-runner-playwright';

const filteredLogs = ['in dev mode'];

// `ResizeObserver loop completed with undelivered notifications` is a non-fatal
// browser warning (per MDN). It surfaces when our ResizeObservers and the
// virtualizer's internal ones write layout-affecting styles within the same
// frame. The browser still resolves the layout, so silence the warning here so
// it doesn't trip the test runner's global error handler.
const RESIZE_OBSERVER_NOISE = 'ResizeObserver loop';

/**
 * Test page for the suite. `keying` sets the page global `ApexGrid` reads its
 * `rowRecycling` default from, before `test/setup.js` (and so the grid) loads.
 *
 * @param {'item'} [keying]
 */
const runnerHtml = (keying) => (testFramework) => `
  <html>
    <body>
      <script>
        ${keying ? `window.__apexRowKeying = ${JSON.stringify(keying)};` : ''}
        window.addEventListener('error', (event) => {
          if (event.message && event.message.includes(${JSON.stringify(RESIZE_OBSERVER_NOISE)})) {
            event.stopImmediatePropagation();
            event.preventDefault();
          }
        });
      </script>
      <script type="module" src="./test/setup.js"></script>
      <script type="module" src="${testFramework}"></script>
    </body>
  </html>
`;

export default /** @type {import("@web/test-runner").TestRunnerConfig} */ ({
  /** Test files to run */
  files: ['test/**/*.test.ts'],

  testRunnerHtml: runnerHtml(),

  // The default group runs the shipping default, every grid recycling its rows
  // (`rowRecycling` true). This group runs the same suite again with every grid
  // keeping record-keyed rows (`rowRecycling` defaults to false), the opt-out
  // path. `npm test` runs only the default group; `npm run test:item` runs
  // this one. The group leaves out `files` so it takes the root pattern, which
  // `--files` also narrows.
  groups: [{ name: 'item', testRunnerHtml: runnerHtml('item') }],

  /** Resolve bare module imports */
  nodeResolve: {
    exportConditions: ['browser', 'production'],
  },

  coverageConfig: {
    // `**/node_modules/**` (not `node_modules/**/*`) so hoisted deps served by
    // the dev server under the `__wds-outside-root__/<n>/node_modules/...` virtual
    // prefix are excluded too; otherwise the v8→istanbul step tries to read
    // those URLs as real paths and logs ENOENT warnings (monorepo hoisting).
    exclude: ['**/node_modules/**', '**/__wds-outside-root__/**', '**/styles/**', 'test/**'],
    // Fails `npm test` (the default group, the one run with --coverage) when
    // coverage drops below these, so deleting or disabling a test file turns
    // CI red. Set just under the numbers measured on 2026-11-03 (statements
    // 98.53, branches 92.22, functions 97.72, lines 98.53). Branches get more
    // room: the animation and scroll paths in flip.ts, reorder.ts and the
    // virtualizer take timing-dependent branches, so the same source measured
    // anywhere from 92.17 to 92.23 across runs. Raise these as coverage grows;
    // lower them only with a reason in the commit.
    threshold: { statements: 98.5, branches: 92.0, functions: 97.7, lines: 98.5 },
  },

  /** Browsers to run tests on */
  browsers: [playwrightLauncher({ product: 'chromium', headless: true })],

  testFramework: {
    config: {
      timeout: 4000,
    },
  },

  plugins: [
    esbuildPlugin({
      ts: true,
      tsconfig: fileURLToPath(new URL('./tsconfig.json', import.meta.url)),
    }),
  ],

  // See documentation for all available options
});
