// biome-ignore-all lint/suspicious/noConsole: CLI script reports progress to the terminal
/**
 * Generated-drift check (P4).
 *
 * The wrappers in `src/generated/` and `src/events.ts` are committed so their
 * diffs are reviewable, but they are machine output: if the `apex-grid` manifest
 * changes (a new event, a renamed prop) and nobody re-runs the generator, the
 * committed wrappers silently fall behind. This re-runs the generator in memory
 * and fails (exit 1) when the committed files differ, so CI cannot merge stale
 * wrappers.
 *
 * Run via `npm run check:generated`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectOutputs } from './generate.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

const drift = [];
for (const { file, content } of collectOutputs()) {
  let onDisk = null;
  try {
    onDisk = readFileSync(path.join(SRC, file), 'utf-8');
  } catch {
    onDisk = null;
  }
  if (onDisk !== content) drift.push({ file, missing: onDisk === null });
}

if (drift.length) {
  console.error('✗ Generated wrappers are out of date vs the apex-grid manifest:\n');
  for (const { file, missing } of drift) {
    console.error(`  - src/${file}${missing ? ' (missing)' : ''}`);
  }
  console.error('\nRun `npm run generate` and commit the result.');
  process.exit(1);
}

console.log(`✓ Generated wrappers match the manifest (${collectOutputs().length} files in sync).`);
