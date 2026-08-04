// biome-ignore-all lint/suspicious/noConsole: CLI script reports progress to the terminal
/**
 * Pre-bundle the browser tests with esbuild before running web-test-runner.
 *
 * React and react-dom are CommonJS with `process.env.NODE_ENV` conditional
 * re-exports that the dev server's static CJS→ESM analysis can't follow, so a
 * plain transform leaves `react` / `react-dom/client` / `react/jsx-runtime`
 * without resolvable exports. Bundling sidesteps that entirely: esbuild inlines
 * those deps with correct interop and folds `NODE_ENV` via `define`, producing
 * self-contained ESM the runner serves as-is.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = path.join(ROOT, 'test');
const OUT_DIR = path.join(ROOT, '.test-build');

const entryPoints = readdirSync(TEST_DIR)
  .filter((f) => f.endsWith('.test.tsx') || f.endsWith('.test.ts'))
  .map((f) => path.join(TEST_DIR, f));

await build({
  entryPoints,
  outdir: OUT_DIR,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: 'inline',
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning',
});

console.log(`✓ Bundled ${entryPoints.length} test file(s) to .test-build/`);
