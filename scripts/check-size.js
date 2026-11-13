// Bundle size budget for the shipped packages. Run after `npm run build`.
//
// Bundles each consumer-facing entry from dist the way an app's bundler would
// (minified ESM, with the peer dependencies left external), gzips the result
// at level 9 and fails when any bundle is over its budget:
//
//   core define (lit external)   `import 'apex-grid/define'` with lit as a peer
//   core define (lit bundled)    the same with lit inlined (CDN style)
//   enterprise define entry      `import 'apex-grid-enterprise/define'`, the
//                                entry chunk plus any chunk it imports
//                                statically
//   enterprise lazy chunks       the chunks reached only through import(),
//                                summed
//   enterprise index entry       `import ... from 'apex-grid-enterprise'`
//   core ignite-ui add-on        `import 'apex-grid/ignite-ui'` on its own, lit
//                                external (it counts the small modules it
//                                shares with core, so it is an upper bound)
//
// Budgets are the gzip size at the last re-baseline plus 3 percent, rounded up
// to the next 500 bytes. A change that crosses one either earns its bytes (raise
// the budget in the same commit and say why) or gets smaller.
//
// Usage: node scripts/check-size.js [repo-root]

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

/**
 * Gzip bytes. Re-baselined on 24a0f33 (2026-11-03), where the bundles were
 * 67320, 83629, 135807, 19064 and 159274 bytes in this order. The index entry
 * includes the AI engine chunk it shares with the lazy import() path, about
 * 20 KB gzip, because the barrel imports it statically. The Ignite UI add-on
 * joined at 3010 bytes (plan 36, 2026-11-08), with its registry on a shared
 * globalThis slot; on top of core define it adds about 2500.
 *
 * Core define (lit external) and both enterprise entries were re-baselined at
 * 69594, 141649 and 165118 bytes (2026-11-09) for the IME composition guards
 * and the full-width and grouped number input: about 1.75 KB in core and
 * 2.2 KB in enterprise, which the Ignite UI work had left no headroom for.
 *
 * Core define (lit bundled) was re-baselined at 87859 bytes (2026-11-12) for
 * the `type: 'chart'` column: 1970 bytes bundled (85889 to 87859) and 1938
 * external (69594 to 71532). The bundled row had 611 bytes left.
 *
 * Core define (lit external) was re-baselined at 72213 bytes (2026-11-13)
 * for GitHub #39 and #40: rendering a recycled row before it moves, with
 * its focus handling (about 460 bytes), and the sparkline's accessible name
 * (about 240 bytes). 5.0.0 had left it 468 bytes of headroom.
 *
 * Enterprise define entry was re-baselined at 146470 bytes (2026-11-14) for
 * keyboard move and resize of the floating chart and Ask AI panels: the
 * shared panel geometry controller, its two controls and their styles, about
 * 1570 bytes. It had 1094 bytes of headroom.
 */
const BUDGETS = {
  'core define (lit external)': 74_500,
  'core define (lit bundled)': 90_500,
  'enterprise define entry': 151_000,
  'enterprise lazy chunks': 20_000,
  'enterprise index entry': 170_500,
  'core ignite-ui add-on': 3_500,
};

/** Peer dependencies stay external, as they do in an app's bundle. */
const PEERS = ['lit', 'lit/*', '@lit/*', '@lit-labs/*', 'apexcharts', '@anthropic-ai/sdk'];

const root = path.resolve(
  process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
);

/**
 * Bundles one entry in memory. Returns its output files keyed by basename,
 * and the basenames the entry loads up front: itself plus every chunk reached
 * through static imports. The rest are only reached through `import()`.
 */
async function bundle(entry, external, splitting = false) {
  const result = await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    minify: true,
    format: 'esm',
    splitting,
    external,
    outdir: path.join(root, '.size-out'),
    write: false,
    metafile: true,
    logLevel: 'error',
  });
  const files = new Map(
    result.outputFiles
      .filter((file) => file.path.endsWith('.js'))
      .map((file) => [path.basename(file.path), file.contents])
  );
  const outputs = Object.entries(result.metafile.outputs);
  const byName = new Map(outputs.map(([out, meta]) => [path.basename(out), meta]));
  const entryName = path.basename(outputs.find(([, meta]) => meta.entryPoint)[0]);
  const eager = new Set([entryName]);
  for (const name of eager) {
    for (const imported of byName.get(name)?.imports ?? []) {
      if (imported.kind === 'import-statement' && !imported.external) {
        eager.add(path.basename(imported.path));
      }
    }
  }
  return { files, entryName, eager };
}

const sizes = (contents) => ({
  min: contents.byteLength,
  gz: gzipSync(contents, { level: 9 }).byteLength,
});

const sum = (list) =>
  list.reduce((total, next) => ({ min: total.min + next.min, gz: total.gz + next.gz }), {
    min: 0,
    gz: 0,
  });

async function measure() {
  const coreExternal = await bundle('packages/core/dist/define.js', PEERS);
  const coreBundled = await bundle('packages/core/dist/define.js', ['apexcharts']);
  const entDefine = await bundle('packages/enterprise/dist/define.js', PEERS, true);
  const entIndex = await bundle('packages/enterprise/dist/index.js', PEERS, true);
  const coreIgnite = await bundle('packages/core/dist/ignite-ui.js', PEERS);

  // A chunk the entry imports statically ships with the entry, so it counts
  // toward the entry budget, not the lazy one.
  const pick = ({ files, eager }, loadedUpFront) =>
    [...files].filter(([name]) => eager.has(name) === loadedUpFront).map(([, c]) => sizes(c));

  return {
    'core define (lit external)': sum(pick(coreExternal, true)),
    'core define (lit bundled)': sum(pick(coreBundled, true)),
    'enterprise define entry': sum(pick(entDefine, true)),
    'enterprise lazy chunks': sum(pick(entDefine, false)),
    'enterprise index entry': sum(pick(entIndex, true)),
    'core ignite-ui add-on': sum(pick(coreIgnite, true)),
  };
}

let measured;
try {
  measured = await measure();
} catch (error) {
  console.error(`check-size: could not bundle from dist (run \`npm run build\` first).\n${error}`);
  process.exit(1);
}

const pad = (value, width) => String(value).padStart(width);
const over = [];
console.log(`${'bundle'.padEnd(28)}${pad('min', 10)}${pad('gzip', 10)}${pad('budget', 10)}`);
for (const [name, { min, gz }] of Object.entries(measured)) {
  const budget = BUDGETS[name];
  const flag = gz > budget ? '  OVER' : '';
  if (flag) over.push(`${name}: ${gz} bytes gzip, budget ${budget} (+${gz - budget})`);
  console.log(`${name.padEnd(28)}${pad(min, 10)}${pad(gz, 10)}${pad(budget, 10)}${flag}`);
}

if (over.length) {
  console.error(`\ncheck-size: over budget\n  ${over.join('\n  ')}`);
  process.exit(1);
}
console.log('\ncheck-size: every bundle is within its budget');
