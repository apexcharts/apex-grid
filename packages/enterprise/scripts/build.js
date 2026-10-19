import { exec as _exec } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { checkDistManifest } from '../../../scripts/check-dist-manifest.js';

const exec = promisify(_exec);
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST_DIR = path.join.bind(null, PKG_DIR, 'dist');
const RELEASE_FILES = ['LICENSE.md', 'README.md', 'CHANGELOG.md'];

// Where scripts/_package.json (what consumers install) intentionally differs
// from package.json (what CI installs). Both sides are pinned so changing
// either one fails the build until this list is reviewed. Anything else that
// differs fails the build too; see scripts/check-dist-manifest.js.
const DELIBERATE_MANIFEST_DIFFERENCES = {
  // Published as a tilde range on purpose, kept narrower than the workspace.
  'peerDependencies.@lit/context': { workspace: '^1.1.5', published: '~1.1.5' },
  // The optional AI SDK peer is deliberately not published yet; adding it
  // is a separate decision.
  'peerDependencies.@anthropic-ai/sdk': { workspace: '>=0.40.0', published: undefined },
  'peerDependenciesMeta.@anthropic-ai/sdk': { workspace: { optional: true }, published: undefined },
};

async function writeDistPackageJson() {
  // Single source of truth for the published version is the package's
  // package.json; merge it into the static template at scripts/_package.json.
  const [root, template] = await Promise.all([
    readFile('package.json', 'utf-8').then(JSON.parse),
    readFile('scripts/_package.json', 'utf-8').then(JSON.parse),
  ]);
  template.version = root.version;
  await writeFile(DEST_DIR('package.json'), `${JSON.stringify(template, null, 2)}\n`);
}

async function cleanDist() {
  // Wipe dist so files removed from src never linger in the published bundle.
  await rm(DEST_DIR(), { recursive: true, force: true });
  await mkdir(DEST_DIR(), { recursive: true });
}

async function build() {
  await cleanDist();
  await exec('tsc -p scripts/tsconfig.prod.json && tsc -p scripts/tsconfig.dts.prod.json');
  await Promise.all([
    writeDistPackageJson(),
    ...RELEASE_FILES.map((file) =>
      // README/LICENSE are optional during early scaffolding.
      copyFile(file, DEST_DIR(file)).catch(() => {})
    ),
  ]);
  await checkDistManifest({ pkgDir: PKG_DIR, deliberate: DELIBERATE_MANIFEST_DIFFERENCES });
}

build();
