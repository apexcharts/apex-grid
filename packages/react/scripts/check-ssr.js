// biome-ignore-all lint/suspicious/noConsole: CLI script reports its result to the terminal
/**
 * Server-import check: the package entry must evaluate in plain Node, with no
 * DOM, and register nothing.
 *
 * The README promises that importing the wrapper on the server (a React Server
 * Component, an SSR pass) is a no-op: nothing throws and the custom element
 * registry stays clean. The browser suites cannot see a regression here, so a
 * module-level DOM access anywhere the entry reaches (the wrappers or the
 * `apex-grid` modules they import) or a lost `typeof window` guard would only
 * surface as a crash in a server render. This bundles `src/index.ts` for Node
 * with every package left external (so `apex-grid`, `lit` and `react` load the
 * way an app's server would load them), imports it, server-renders one grid,
 * and fails (exit 1) on any throw or registration.
 *
 * Run via `npm test` (before the browser suite).
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.test-build/ssr/index.mjs');
const TAGS = ['apex-grid', 'apex-grid-toolbar', 'apex-grid-paginator'];

assert.equal(typeof window, 'undefined', 'run this check in plain Node, with no DOM');

await build({
  entryPoints: [path.join(ROOT, 'src/index.ts')],
  outfile: OUT,
  bundle: true,
  packages: 'external',
  format: 'esm',
  platform: 'node',
  target: 'node20',
  // esbuild drops the 'use client' directives with a warning; nothing to report.
  logLevel: 'error',
});

const { ApexGrid, createApexGrid } = await import(pathToFileURL(OUT).href);
const { createElement } = await import('react');
const { renderToString } = await import('react-dom/server');

const registered = () => TAGS.filter((tag) => globalThis.customElements?.get(tag) !== undefined);

assert.equal(typeof window, 'undefined', 'importing the entry must not define window');
assert.deepEqual(registered(), [], 'importing the entry must not register an element');

const html = renderToString(
  createElement(createApexGrid(), { data: [{ id: 1 }], columns: [{ key: 'id' }], theme: 'dark' })
);
assert.match(html, /^<apex-grid\b[^>]*\btheme="dark"[^>]*><\/apex-grid>$/);
assert.equal(createApexGrid(), ApexGrid, 'createApexGrid<T>() returns the same component');
assert.deepEqual(registered(), [], 'a server render must not register an element');

console.log('✓ The package entry imports and server-renders in Node without registering.');
