// Zero-dependency static file server for the e2e snapshot suite.
//
// Serves the repo root so the demos resolve their sibling bundle
// (`demo/foo.html` -> `../apex-grid.min.js`). Used only by Playwright's
// `webServer`; never shipped. Node is already present (it runs Playwright),
// so we avoid taking on python/`serve`/`http-server` as a hard dependency.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Strip any trailing separator so the containment check below compares cleanly
// (fileURLToPath of a directory URL yields a trailing slash).
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[/\\]+$/, '');
const PORT = Number(process.argv[2]) || 5599;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
};

createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    // Block path traversal: normalize, then reject anything that escapes ROOT.
    const target = normalize(join(ROOT, pathname));
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const data = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[e2e] static-server on http://127.0.0.1:${PORT}  (root: ${ROOT})`);
});
