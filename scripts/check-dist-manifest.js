// Release guard shared by packages/core and packages/enterprise build.js.
//
// Each package publishes dist/package.json, written from a hand-kept template
// (scripts/_package.json) with only `version` merged in. Consumers install the
// template's ranges while CI installs and tests the workspace package.json, so
// the two drifting has already shipped the wrong apex-commons range twice and
// marked define.js as free of side effects. This check fails the build when:
//
//   1. a dependency, peer or peer meta entry in the template differs from the
//      workspace manifest, unless the caller lists it as a deliberate
//      difference with both values spelled out (a listed entry that neither
//      manifest has fails too, so the list cannot go stale);
//   2. the template's `sideEffects` keeps a different set of dist files than
//      the workspace manifest's `sideEffects` (patterns are compared by the
//      files they match, since one is relative to dist and one to the package);
//   3. bundling `import '<name>/define'` from dist, the way an app does, drops
//      any of define.js's `register()` calls.
//
// It checks and never rewrites, so published ranges stay exactly as written.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const RANGE_FIELDS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
];

const readJson = (file) => JSON.parse(readFileSync(file, 'utf-8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (value) => (value === undefined ? '(absent)' : JSON.stringify(value));

// Bundler `sideEffects` semantics: a pattern without a slash matches at any
// depth, `*` stays inside one path segment and `**/` spans any number of them.
function sideEffectsMatcher(value, base) {
  if (value === undefined || value === true) return () => true;
  if (!Array.isArray(value)) return () => false;
  const patterns = value.map((pattern) => {
    const glob = pattern.includes('/') ? pattern.replace(/^\.\//, '') : `**/${pattern}`;
    const source = glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\/|\*|\?/g, (m) => ({ '**/': '(?:.*/)?', '*': '[^/]*', '?': '[^/]' })[m]);
    return new RegExp(`^${source}$`);
  });
  return (file) => patterns.some((re) => re.test(base + file));
}

function checkRanges(pkg, template, deliberate) {
  const problems = [];
  const checked = new Set();
  for (const field of RANGE_FIELDS) {
    const names = new Set([
      ...Object.keys(pkg[field] ?? {}),
      ...Object.keys(template[field] ?? {}),
    ]);
    for (const name of names) {
      const key = `${field}.${name}`;
      checked.add(key);
      const workspace = pkg[field]?.[name];
      const published = template[field]?.[name];
      const allowed = deliberate[key];
      if (allowed) {
        if (!same(allowed.workspace, workspace) || !same(allowed.published, published)) {
          problems.push(
            `${key}: the deliberate difference (workspace ${show(allowed.workspace)}, ` +
              `published ${show(allowed.published)}) no longer holds: workspace ` +
              `${show(workspace)}, template ${show(published)}. Review it and update the list.`
          );
        }
      } else if (!same(workspace, published)) {
        problems.push(
          `${key}: template publishes ${show(published)} but the workspace manifest, ` +
            `which CI tests, has ${show(workspace)}.`
        );
      }
    }
  }
  // An entry naming something neither manifest has is never compared above,
  // so the list could go stale (or carry a typo) without anyone seeing it.
  for (const key of Object.keys(deliberate)) {
    if (key !== 'sideEffects' && !checked.has(key)) {
      problems.push(
        `${key}: listed as a deliberate difference, but neither the workspace ` +
          'manifest nor the template has it. Remove it from the list or fix the key.'
      );
    }
  }
  return problems;
}

function checkSideEffects(pkg, template, distDir, deliberate) {
  const allowed = deliberate.sideEffects;
  if (allowed) {
    return same(allowed.workspace, pkg.sideEffects) && same(allowed.published, template.sideEffects)
      ? []
      : [
          `sideEffects: the deliberate difference (workspace ${show(allowed.workspace)}, ` +
            `published ${show(allowed.published)}) no longer holds: workspace ` +
            `${show(pkg.sideEffects)}, template ${show(template.sideEffects)}.`,
        ];
  }
  const relDist = `${path.basename(distDir)}/`;
  const inWorkspace = sideEffectsMatcher(pkg.sideEffects, relDist);
  const inTemplate = sideEffectsMatcher(template.sideEffects, '');
  const files = readdirSync(distDir, { recursive: true })
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => /\.(js|css)$/.test(file));
  const drift = files.filter((file) => inWorkspace(file) !== inTemplate(file));
  return drift.length
    ? [
        `sideEffects: template ${show(template.sideEffects)} and workspace ` +
          `${show(pkg.sideEffects)} disagree on: ${drift.slice(0, 5).join(', ')}` +
          `${drift.length > 5 ? ` and ${drift.length - 5} more` : ''}.`,
      ]
    : [];
}

// Bundle `import '<name>/define'` against dist through node_modules, exactly as
// an app resolves the published package, and count the register() calls left.
async function checkDefineSurvives(name, distDir) {
  const work = mkdtempSync(path.join(tmpdir(), 'apex-define-check-'));
  try {
    mkdirSync(path.join(work, 'node_modules'));
    symlinkSync(distDir, path.join(work, 'node_modules', name), 'junction');
    const entry = path.join(work, 'entry.js');
    await writeFile(entry, `import '${name}/define';\n`);
    const own = (spec) => spec === name || spec.startsWith(`${name}/`);
    const result = await build({
      entryPoints: [entry],
      absWorkingDir: work,
      bundle: true,
      write: false,
      format: 'esm',
      logLevel: 'silent',
      preserveSymlinks: true,
      plugins: [
        {
          name: 'external-deps',
          setup(b) {
            b.onResolve({ filter: /^[^./]/ }, (args) =>
              own(args.path) ? undefined : { path: args.path, external: true }
            );
          },
        },
      ],
    });
    const count = (text) => (text.match(/\.register\(\)/g) ?? []).length;
    const expected = count(readFileSync(path.join(distDir, 'define.js'), 'utf-8'));
    const kept = count(result.outputFiles[0].text);
    const dropped = result.warnings.filter((w) => /side effects/.test(w.text));
    return kept >= expected && expected > 0 && dropped.length === 0
      ? []
      : [
          `define: bundling \`import '${name}/define'\` from dist kept ${kept} of ` +
            `${expected} register() calls${dropped.map((w) => `; esbuild: ${w.text}`).join('')}`,
        ];
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Run after dist/ (including dist/package.json) is fully written.
 *
 * @param {object} options
 * @param {string} options.pkgDir Absolute path of the workspace package.
 * @param {Record<string, {workspace: unknown, published: unknown}>} [options.deliberate]
 *   Known, intended differences keyed `<field>.<name>` (or `sideEffects`), with
 *   both values pinned so a later edit to either side is reviewed again.
 */
export async function checkDistManifest({ pkgDir, deliberate = {} }) {
  const distDir = path.join(pkgDir, 'dist');
  const pkg = readJson(path.join(pkgDir, 'package.json'));
  const template = readJson(path.join(pkgDir, 'scripts/_package.json'));
  const problems = [
    ...checkRanges(pkg, template, deliberate),
    ...checkSideEffects(pkg, template, distDir, deliberate),
    ...(await checkDefineSurvives(template.name, distDir)),
  ];
  if (problems.length) {
    throw new Error(
      `${template.name}: scripts/_package.json, the published manifest, drifted:\n  - ` +
        problems.join('\n  - ')
    );
  }
}
