import { fileURLToPath } from 'node:url';
import { esbuildPlugin } from '@web/dev-server-esbuild';
import { playwrightLauncher } from '@web/test-runner-playwright';

const RESIZE_OBSERVER_NOISE = 'ResizeObserver loop';

/**
 * Test page for every group. `keying`, when set, is published as
 * `window.__apexRowKeying` before `test/setup.js` loads, which is ahead of
 * any grid module, so core's `ApexGrid` reads it for its `rowRecycling`
 * default when it loads.
 *
 * @param {string} testFramework
 * @param {string} [keying]
 */
const runnerHtml = (testFramework, keying) => `
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
  files: ['test/**/*.test.ts'],

  testRunnerHtml: (testFramework) => runnerHtml(testFramework),

  // The default group runs the shipping default, every grid recycling its rows
  // (`rowRecycling` true). This group is a second pass over the whole suite
  // with every grid keeping record-keyed rows (`rowRecycling` defaults to
  // false), the opt-out path. `npm test` runs only the default group, `npm run
  // test:item` only this one. The group leaves out `files` so it takes the
  // root pattern, which `--files` also narrows.
  groups: [
    {
      name: 'item',
      testRunnerHtml: (testFramework) => runnerHtml(testFramework, 'item'),
    },
  ],

  nodeResolve: {
    exportConditions: ['browser', 'production'],
  },

  coverageConfig: {
    // Match the core package: exclude hoisted/out-of-root deps so the v8→istanbul
    // step does not try to read those served URLs as real paths.
    exclude: ['**/node_modules/**', '**/__wds-outside-root__/**', 'test/**'],
  },

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
});
