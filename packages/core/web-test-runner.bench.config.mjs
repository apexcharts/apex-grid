import { fileURLToPath } from 'node:url';
import { esbuildPlugin } from '@web/dev-server-esbuild';
import { playwrightLauncher } from '@web/test-runner-playwright';

// Same non-fatal browser warning the default config silences; see the note in
// `web-test-runner.config.mjs`.
const RESIZE_OBSERVER_NOISE = 'ResizeObserver loop';

/**
 * Manual benchmark run (`test/bench/**`), kept out of the default suite so its
 * wall-time numbers can never fail CI. Results are printed to the console as
 * `BENCH` lines; see `test/bench/row-recycling.bench.ts`.
 */
export default /** @type {import("@web/test-runner").TestRunnerConfig} */ ({
  files: ['test/bench/**/*.bench.ts'],

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
        <script type="module" src="./test/setup.js"></script>
        <script type="module" src="${testFramework}"></script>
      </body>
    </html>
  `,

  nodeResolve: {
    exportConditions: ['browser', 'production'],
  },

  // One browser, one file at a time: parallel pages would share the CPU and
  // skew each other's timings.
  concurrency: 1,

  // `--expose-gc` lets the bench collect garbage between runs, so one run's
  // garbage is not charged to the next.
  browsers: [
    playwrightLauncher({
      product: 'chromium',
      headless: true,
      launchOptions: { args: ['--js-flags=--expose-gc'] },
    }),
  ],

  // The full matrix takes minutes; the runner's own limits must not cut it short.
  testsFinishTimeout: 3_600_000,
  browserStartTimeout: 120_000,

  testFramework: {
    config: {
      timeout: 600_000,
    },
  },

  plugins: [
    esbuildPlugin({
      ts: true,
      tsconfig: fileURLToPath(new URL('./tsconfig.json', import.meta.url)),
    }),
  ],
});
