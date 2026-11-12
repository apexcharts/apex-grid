/**
 * Remove dist/ before a build, as the core and enterprise builds do.
 *
 * The package is published from dist/, and tsc plus pack-dist.js only ever add
 * or overwrite files there, so a file removed or renamed in source would stay
 * in the publish directory and ship. Starting from an empty dist/ keeps every
 * build's output exactly what the sources produce.
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await rm(path.join(ROOT, 'dist'), { recursive: true, force: true });
