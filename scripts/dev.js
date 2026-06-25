// Demo dev server: keeps the root `apex-grid*.min.js` demo bundles fresh and
// serves the `demo/` pages with caching disabled, so editing `packages/*/src`
// is reflected on a plain page refresh — no manual rebuild, no stale bundle.
//
// Pipeline:
//   1. esbuild --watch bundles BOTH packages straight from source (not dist),
//      so a source edit rebuilds the matching bundle in ~tens of ms. The
//      enterprise bundle resolves `apex-grid` / `apex-grid/internal` to core's
//      `src` via a resolve plugin (the published build resolves them to core's
//      `dist`, which is what goes stale).
//   2. The SCSS watcher regenerates the committed `*.css.ts` files that the
//      components import; esbuild then picks those rebuilds up automatically.
//   3. A tiny static server sends `Cache-Control: no-store`, so the browser
//      never serves a cached copy of a just-rebuilt bundle.
//
// This is a DEV tool only. The published/committed bundles are still produced
// by `npm run demo:bundle[:enterprise]` (from `dist`); run those before commit.

import { spawn } from 'node:child_process';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5050;
const coreSrc = (rel) => path.join(ROOT, 'packages/core/src', rel);

// Map `apex-grid` / `apex-grid/internal` to core's source instead of its dist
// (exact matches only, so the bare-package alias never mangles the subpath).
const apexGridFromSource = {
  name: 'apex-grid-from-source',
  setup(build) {
    build.onResolve({ filter: /^apex-grid\/internal$/ }, () => ({
      path: coreSrc('internal/index.ts'),
    }));
    build.onResolve({ filter: /^apex-grid$/ }, () => ({ path: coreSrc('index.ts') }));
  },
};

const shared = { bundle: true, format: 'iife', minify: true, logLevel: 'info' };

const contexts = await Promise.all([
  esbuild.context({
    ...shared,
    entryPoints: [path.join(ROOT, 'packages/core/src/define.ts')],
    globalName: 'apexGrid',
    outfile: path.join(ROOT, 'apex-grid.min.js'),
  }),
  esbuild.context({
    ...shared,
    entryPoints: [path.join(ROOT, 'packages/enterprise/src/define.ts')],
    globalName: 'apexGridEnterprise',
    outfile: path.join(ROOT, 'apex-grid-enterprise.min.js'),
    plugins: [apexGridFromSource],
  }),
]);

await Promise.all(contexts.map((ctx) => ctx.watch()));

// Regenerate `*.css.ts` from SCSS on change; esbuild watches those outputs.
const sass = spawn(process.execPath, ['scripts/watch-styles.js'], {
  cwd: path.join(ROOT, 'packages/core'),
  stdio: 'inherit',
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// Friendly index of every demo page when `/demo/` is requested with no file.
function demoIndex() {
  const files = readdirSync(path.join(ROOT, 'demo'))
    .filter((f) => f.endsWith('.html'))
    .sort();
  const links = files.map((f) => `<li><a href="/demo/${f}">${f}</a></li>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>apex-grid demos</title>
<style>body{font:14px system-ui;margin:2rem;max-width:48rem}a{color:#4338ca}</style>
<h1>apex-grid demos</h1><ul>${links}</ul>`;
}

const server = createServer((req, res) => {
  const send = (code, body, type = 'text/plain; charset=utf-8') =>
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(body);

  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (urlPath === '/' || urlPath === '/demo' || urlPath === '/demo/') {
    return send(200, demoIndex(), MIME['.html']);
  }

  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    return send(404, `Not found: ${urlPath}`);
  }

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  createReadStream(filePath).pipe(res);
});

// If the chosen port is taken (Docker et al. love 8080), step to the next one
// rather than crashing — up to a small range, then give up with a clear message.
let port = PORT;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && port < PORT + 20) {
    server.listen(++port);
    return;
  }
  // biome-ignore lint/suspicious/noConsole: dev server fatal error
  console.error(`Dev server could not bind a port near ${PORT}: ${err.message}`);
  process.exit(1);
});
server.listen(port, () => {
  // biome-ignore lint/suspicious/noConsole: dev server banner
  console.log(`\n  apex-grid demos → http://localhost:${port}/demo/\n  (bundles rebuild on save; refresh the page to pick them up)\n`);
});

const shutdown = () => {
  sass.kill();
  Promise.all(contexts.map((ctx) => ctx.dispose())).finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
