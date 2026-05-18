import { exec as _exec } from 'node:child_process';
import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildComponents } from './sass.js';

const exec = promisify(_exec);
const DEST_DIR = path.join.bind(
  null,
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
);
const RELEASE_FILES = ['custom-elements.json', 'LICENSE', 'README.md'];

async function build() {
  await buildComponents();
  await exec('tsc -p scripts/tsconfig.prod.json && tsc -p scripts/tsconfig.dts.prod.json');
  await Promise.all([
    copyFile('scripts/_package.json', DEST_DIR('package.json')),
    copyFile('src/styles.css', DEST_DIR('styles.css')),
    ...RELEASE_FILES.map((file) => copyFile(file, DEST_DIR(file))),
  ]);
}

build();
