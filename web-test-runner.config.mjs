import { fileURLToPath } from 'node:url';
import { esbuildPlugin } from '@web/dev-server-esbuild';
import { playwrightLauncher } from '@web/test-runner-playwright';

const filteredLogs = ['in dev mode'];

// `ResizeObserver loop completed with undelivered notifications` is a non-fatal
// browser warning (per MDN). It surfaces when our ResizeObservers and the
// virtualizer's internal ones write layout-affecting styles within the same
// frame. The browser still resolves the layout — silence the warning here so
// it doesn't trip the test runner's global error handler.
const RESIZE_OBSERVER_NOISE = 'ResizeObserver loop';

export default /** @type {import("@web/test-runner").TestRunnerConfig} */ ({
  /** Test files to run */
  files: ['test/**/*.test.ts'],

  testRunnerHtml: (testFramework) => `
    <html>
      <body>
        <script>
          window.addEventListener('error', (event) => {
            if (event.message && event.message.includes(${JSON.stringify(RESIZE_OBSERVER_NOISE)})) {
              event.stopImmediatePropagation();
              event.preventDefault();
            }
          });
        </script>
        <script type="module" src="${testFramework}"></script>
      </body>
    </html>
  `,

  /** Resolve bare module imports */
  nodeResolve: {
    exportConditions: ['browser', 'production'],
  },

  coverageConfig: {
    exclude: ['node_modules/**/*', '**/styles/**', 'test/**']
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
