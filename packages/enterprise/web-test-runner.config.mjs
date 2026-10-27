import { fileURLToPath } from 'node:url';
import { esbuildPlugin } from '@web/dev-server-esbuild';
import { playwrightLauncher } from '@web/test-runner-playwright';

const RESIZE_OBSERVER_NOISE = 'ResizeObserver loop';

/**
 * Test page for every group. `keying`, when set, is published as
 * `window.__apexRowKeying` before `test/setup.js` loads, which is ahead of
 * any grid module, so core's virtualizer reads it when it builds.
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

  // A second pass over the whole suite with the body rows keyed by a fixed
  // pool of slots instead of by record, so tests catch row state that leaks
  // across a rebind (row recycling plan, section 9). `npm test` runs only the
  // default group, `npm run test:spike` only this one. The group leaves out
  // `files` so it takes the root pattern, which `--files` also narrows.
  groups: [
    {
      name: 'spike',
      testRunnerHtml: (testFramework) => runnerHtml(testFramework, 'spike'),
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
