import { exec as _exec } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(_exec);
const DEST_DIR = path.join.bind(
  null,
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
);
const RELEASE_FILES = ['LICENSE', 'README.md', 'CHANGELOG.md'];

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
}

build();
