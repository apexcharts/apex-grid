import { playwrightLauncher } from '@web/test-runner-playwright';

// The grid's virtualizer + our ResizeObservers can co-schedule layout writes in
// one frame, which surfaces the non-fatal `ResizeObserver loop` browser warning.
// Silence it so it doesn't trip the runner's global error handler (same as core).
const RESIZE_OBSERVER_NOISE = 'ResizeObserver loop';

export default /** @type {import("@web/test-runner").TestRunnerConfig} */ ({
  // Self-contained esbuild bundles produced by `scripts/build-tests.js`
  // (run via the `test` script's pre-step). React's CJS is inlined there.
  files: ['.test-build/**/*.test.js'],

  browsers: [playwrightLauncher({ product: 'chromium', headless: true })],

  testFramework: {
    config: { timeout: 5000 },
  },

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
});
