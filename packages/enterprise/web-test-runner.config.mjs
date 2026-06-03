import { fileURLToPath } from 'node:url';
import { esbuildPlugin } from '@web/dev-server-esbuild';
import { playwrightLauncher } from '@web/test-runner-playwright';

const RESIZE_OBSERVER_NOISE = 'ResizeObserver loop';

export default /** @type {import("@web/test-runner").TestRunnerConfig} */ ({
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
