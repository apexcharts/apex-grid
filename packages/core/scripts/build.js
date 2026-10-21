import { exec as _exec } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as sass from 'sass-embedded';
import { checkDistManifest } from '../../../scripts/check-dist-manifest.js';
import { buildComponents } from './sass.js';

const exec = promisify(_exec);
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST_DIR = path.join.bind(null, PKG_DIR, 'dist');
const RELEASE_FILES = ['custom-elements.json', 'LICENSE.md', 'README.md', 'CHANGELOG.md'];

// Where scripts/_package.json (what consumers install) intentionally differs
// from package.json (what CI installs). Both sides are pinned so changing
// either one fails the build until this list is reviewed. Anything else that
// differs fails the build too; see scripts/check-dist-manifest.js.
const DELIBERATE_MANIFEST_DIFFERENCES = {
  // Published as tilde ranges on purpose, kept narrower than the workspace.
  'dependencies.@lit-labs/virtualizer': { workspace: '^2.1.0', published: '~2.1.0' },
  'dependencies.@lit/context': { workspace: '^1.1.5', published: '~1.1.5' },
  // The workspace manifest omits the field, so in-repo consumers keep every
  // module. Published, only define.js (registers <apex-grid>) and the two
  // stylesheets have side effects, so apps that import 'apex-grid/define' keep it.
  sideEffects: { workspace: undefined, published: ['./define.js', './styles.css', './tokens.css'] },
};

async function writeDistPackageJson() {
  // Single source of truth for the published version is the root package.json.
  // We merge it into the static template at scripts/_package.json so the
  // template doesn't need to be kept in lockstep manually.
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

// The `--ag-*` root defaults as a plain stylesheet, for apps that opt out of
// the adopted sheet (`setup({ tokenStyles: false })`) or render on the server.
// Compiled from the same source as the sheet the grid adopts at runtime.
async function writeTokensCss() {
  const { css } = await sass.compileAsync('src/styles/document-tokens.scss', {
    style: 'expanded',
    loadPaths: ['src'],
  });
  const header = [
    '/*',
    ' * apex-grid design token defaults (`--ag-*`), on `:where(:root)`.',
    ' *',
    ' * The grid adopts these into the document by itself. Import this file only',
    ' * if you opted out with `setup({ tokenStyles: false })` or render on the',
    ' * server. Zero specificity: a value set on any element wins.',
    ' */',
    '',
  ].join('\n');
  await writeFile(DEST_DIR('tokens.css'), `${header}${css}\n`);
}

async function build() {
  await cleanDist();
  await buildComponents();
  await exec('tsc -p scripts/tsconfig.prod.json && tsc -p scripts/tsconfig.dts.prod.json');
  await Promise.all([
    writeDistPackageJson(),
    copyFile('src/styles.css', DEST_DIR('styles.css')),
    writeTokensCss(),
    ...RELEASE_FILES.map((file) => copyFile(file, DEST_DIR(file))),
  ]);
  await checkDistManifest({ pkgDir: PKG_DIR, deliberate: DELIBERATE_MANIFEST_DIFFERENCES });
}

build();
