// biome-ignore-all lint/suspicious/noConsole: CLI build step reports progress to the terminal
/**
 * Produce the publishable dist/ manifest for react-apex-grid.
 *
 * The package is published from dist/ (see publish.yml: `cd dir/dist && npm
 * publish`), so dist needs its own package.json with dist-relative paths plus
 * the release files. This merges scripts/_package.json with the version from
 * this package's package.json (the single source of truth) and copies LICENSE,
 * README, and CHANGELOG into dist. Runs after `tsc` in the build script.
 */
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const RELEASE_FILES = ['LICENSE', 'README.md', 'CHANGELOG.md'];

const [pkg, template] = await Promise.all([
  readFile(path.join(ROOT, 'package.json'), 'utf-8').then(JSON.parse),
  readFile(path.join(ROOT, 'scripts/_package.json'), 'utf-8').then(JSON.parse),
]);

template.version = pkg.version;
await writeFile(path.join(DIST, 'package.json'), `${JSON.stringify(template, null, 2)}\n`);
await Promise.all(
  RELEASE_FILES.map((file) => copyFile(path.join(ROOT, file), path.join(DIST, file)))
);

console.log(`✓ Packaged react-apex-grid@${pkg.version} into dist/`);
