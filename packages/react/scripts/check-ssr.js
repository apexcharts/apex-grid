// biome-ignore-all lint/suspicious/noConsole: CLI script reports its result to the terminal
/**
 * Server-import check: the package entries (`react-apex-grid` and
 * `react-apex-grid/enterprise`) must evaluate in plain Node, with no DOM, and
 * register nothing.
 *
 * The README promises that importing the wrapper on the server (a React Server
 * Component, an SSR pass) is a no-op: nothing throws and the custom element
 * registry stays clean. The browser suites cannot see a regression here, so a
 * module-level DOM access anywhere the entry reaches (the wrappers or the
 * `apex-grid` modules they import) or a lost `typeof window` guard would only
 * surface as a crash in a server render. This bundles each entry for Node
 * with every package left external (so `apex-grid`, `apex-grid-enterprise`,
 * `lit` and `react` load the way an app's server would load them), imports it,
 * server-renders a grid (and, for the enterprise entry, a companion bound to
 * nothing yet), and fails (exit 1) on any throw or registration.
 *
 * Run via `npm test` (before the browser suite).
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAGS = [
  'apex-grid',
  'apex-grid-toolbar',
  'apex-grid-paginator',
  'apex-grid-enterprise',
  'apex-grid-tool-panel',
  'apex-grid-status-bar',
  'apex-grid-set-filter',
  'apex-grid-filter-builder',
  'apex-grid-chart',
  'apex-grid-ai',
];

assert.equal(typeof window, 'undefined', 'run this check in plain Node, with no DOM');

/** Bundles `src/<entry>.ts` for Node, packages external, and imports it. */
async function load(entry) {
  const outfile = path.join(ROOT, `.test-build/ssr/${entry}.mjs`);
  await build({
    entryPoints: [path.join(ROOT, `src/${entry}.ts`)],
    outfile,
    bundle: true,
    packages: 'external',
    format: 'esm',
    platform: 'node',
    target: 'node20',
    // esbuild drops the 'use client' directives with a warning; nothing to report.
    logLevel: 'error',
  });
  return import(pathToFileURL(outfile).href);
}

const { ApexGrid, createApexGrid } = await load('index');
const enterprise = await load('enterprise/index');
const { createElement } = await import('react');
const { renderToString } = await import('react-dom/server');

const registered = () => TAGS.filter((tag) => globalThis.customElements?.get(tag) !== undefined);

assert.equal(typeof window, 'undefined', 'importing the entries must not define window');
assert.deepEqual(registered(), [], 'importing the entries must not register an element');

const html = renderToString(
  createElement(createApexGrid(), { data: [{ id: 1 }], columns: [{ key: 'id' }], theme: 'dark' })
);
assert.match(html, /^<apex-grid\b[^>]*\btheme="dark"[^>]*><\/apex-grid>$/);
assert.equal(createApexGrid(), ApexGrid, 'createApexGrid<T>() returns the same component');

const enterpriseHtml = renderToString(
  createElement(
    'div',
    null,
    createElement(enterprise.createApexGridEnterprise(), {
      data: [{ id: 1 }],
      columns: [{ key: 'id' }],
      groupBy: ['id'],
      theme: 'dark',
    }),
    createElement(enterprise.ApexGridStatusBar, { grid: null })
  )
);
assert.match(
  enterpriseHtml,
  /^<div><apex-grid-enterprise\b[^>]*\btheme="dark"[^>]*><\/apex-grid-enterprise><apex-grid-status-bar\b[^>]*><\/apex-grid-status-bar><\/div>$/
);
assert.equal(
  enterprise.createApexGridEnterprise(),
  enterprise.ApexGridEnterprise,
  'createApexGridEnterprise<T>() returns the same component'
);
assert.deepEqual(registered(), [], 'a server render must not register an element');

console.log('✓ Both package entries import and server-render in Node without registering.');
