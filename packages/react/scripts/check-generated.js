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
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectOutputs } from './generate.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

const outputs = collectOutputs();
const drift = [];
for (const { file, content } of outputs) {
  let onDisk = null;
  try {
    onDisk = readFileSync(path.join(SRC, file), 'utf-8');
  } catch {
    onDisk = null;
  }
  if (onDisk !== content) drift.push({ file, state: onDisk === null ? 'missing' : null });
}

// A wrapper the generator no longer emits (an element dropped from the table)
// would still compile and ship if its old file stayed on disk, so any file in
// `src/generated/` that is not an output counts as drift too.
const expected = new Set(outputs.map(({ file }) => file));
for (const name of readdirSync(path.join(SRC, 'generated'))) {
  const file = `generated/${name}`;
  if (!expected.has(file)) drift.push({ file, state: 'stale, delete it' });
}

if (drift.length) {
  console.error('✗ Generated wrappers are out of date vs the apex-grid manifest:\n');
  for (const { file, state } of drift) {
    console.error(`  - src/${file}${state ? ` (${state})` : ''}`);
  }
  console.error('\nRun `npm run generate` and commit the result.');
  process.exit(1);
}

console.log(`✓ Generated wrappers match the manifest (${outputs.length} files in sync).`);
