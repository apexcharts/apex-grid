import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url)); // packages/enterprise
const repoRoot = path.resolve(here, '../..');

/**
 * Serve `/node_modules/*` from the hoisted repo-root node_modules when not found
 * locally (workspaces hoist shared deps). Mirrors packages/core/vite.config.js;
 * lets the demo load Ignite UI theme stylesheets via raw URLs.
 */
function serveHoistedNodeModules() {
  return {
    name: 'serve-hoisted-node-modules',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url || '';
        if (!url.startsWith('/node_modules/') || url.startsWith('/node_modules/.vite/')) {
          return next();
        }
        const [pathname, query = ''] = url.slice('/node_modules/'.length).split('?');
        if (existsSync(path.join(here, 'node_modules', pathname))) {
          return next();
        }
        const hoisted = path.join(repoRoot, 'node_modules', pathname);
        if (existsSync(hoisted)) {
          req.url = `/@fs/${hoisted}${query ? `?${query}` : ''}`;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [serveHoistedNodeModules()],
  server: {
    open: '/demo/index.html',
    port: 8001,
    fs: {
      allow: [repoRoot],
    },
  },
});
