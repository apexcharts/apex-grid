import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url)); // packages/core
const repoRoot = path.resolve(here, '../..');

/**
 * In the workspaces monorepo, npm hoists shared deps (lit, igniteui-*) to the
 * repo-root `node_modules`. The demo loads Ignite UI theme stylesheets via raw
 * `/node_modules/...` URLs (see demo/shared.ts) for runtime theme hot-swapping,
 * which Vite resolves against its root (`packages/core`) and 404s on the hoisted
 * files. This dev-only middleware transparently re-points such `/node_modules/*`
 * requests to the hoisted location (via Vite's `/@fs/` handler so they still go
 * through the CSS→JS transform), falling back to local resolution first.
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
          return next(); // present locally — let Vite handle it normally
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
    port: 8000,
    fs: {
      // allow serving the hoisted repo-root node_modules
      allow: [repoRoot],
    },
  },
  build: {
    emptyOutDir: false,
    target: 'esnext',
    lib: {
      entry: 'src/index.ts',
      fileName: 'bundle',
      formats: ['es'],
    },
    reportCompressedSize: true,
    rollupOptions: {
      external: /^lit|^@lit|^@lit-labs|^igniteui/,
    },
  },
});
