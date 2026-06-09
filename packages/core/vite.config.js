import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url)); // packages/core
const repoRoot = path.resolve(here, '../..');

export default defineConfig({
  server: {
    open: '/demo/index.html',
    port: 8000,
    fs: {
      // Allow serving workspace deps hoisted to the repo-root node_modules.
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
