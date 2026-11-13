/**
 * Custom Elements Manifest analyzer configuration for apex-grid-enterprise.
 *
 * The `analyze` npm script passes the CLI flags (`--litelement`, `--globs`);
 * command-line options override this file, so it only adds post-processing
 * plugins. It does not restate the globs.
 *
 * 1. Core's cleanup plugin runs first, unchanged: it drops the nameless event
 *    the analyzer records for a dynamic `new CustomEvent(type)` and strips
 *    static members (`tagName`, `register`, `use`, `setLicense`) from element
 *    declarations, so only the authorable instance surface remains.
 *
 * 2. Events named after an identifier. `new CustomEvent(VIEW_CHANGED_EVENT)`
 *    is recorded as an event called `VIEW_CHANGED_EVENT`, the constant's name
 *    rather than its value. The real name comes from the class's `@fires` tag,
 *    so a SCREAMING_SNAKE_CASE event name is dropped.
 *
 * 3. Inherited members. `ApexGridEnterprise` extends core's `ApexGrid`, which
 *    lives in another package, so the analyzer cannot see the props, attributes
 *    and events the enterprise grid inherits. They are merged in here from the
 *    `apex-grid` manifest (core's build checks that one against its source),
 *    marked `inheritedFrom: { package: 'apex-grid' }` as the schema describes
 *    inherited members, so the shipped manifest is complete for every reader
 *    (the React generator, editor tooling, docs tables) without a second
 *    lookup. The superclass is recorded from the public `apex-grid` entry
 *    rather than `apex-grid/internal`, which has no semver guarantee.
 *
 * Tooling: `cem` (@custom-elements-manifest/analyzer) and `typescript`, which
 * `scripts/check-cem-drift.js` imports, are not enterprise devDependencies.
 * They come hoisted from core's devDependencies in this workspace, as `tsc`
 * already does for the enterprise build; declare them here if enterprise is
 * ever built outside the monorepo.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import coreConfig from '../core/custom-elements-manifest.config.js';

const require = createRequire(import.meta.url);
const CORE_PACKAGE = 'apex-grid';
const CONSTANT_NAME = /^[A-Z][A-Z0-9_]*$/;

/** The custom-elements.json the resolved `apex-grid` package ships. */
function coreManifestPath() {
  let dir = path.dirname(require.resolve(CORE_PACKAGE));
  for (;;) {
    const pkgJson = path.join(dir, 'package.json');
    if (existsSync(pkgJson) && JSON.parse(readFileSync(pkgJson, 'utf-8')).name === CORE_PACKAGE) {
      for (const candidate of ['custom-elements.json', 'dist/custom-elements.json']) {
        if (existsSync(path.join(dir, candidate))) return path.join(dir, candidate);
      }
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Could not find the apex-grid custom-elements.json. Build the core package first (npm run build:core).'
  );
}

function coreDeclarations() {
  const manifest = JSON.parse(readFileSync(coreManifestPath(), 'utf-8'));
  const byName = new Map();
  for (const mod of manifest.modules ?? []) {
    for (const decl of mod.declarations ?? []) {
      if (decl.kind === 'class' && decl.customElement) byName.set(decl.name, decl);
    }
  }
  return byName;
}

/** Appends `inherited` entries the subclass does not declare itself, keyed by `keyOf`. */
function mergeInherited(own = [], inherited = [], keyOf, from) {
  const seen = new Set(own.map(keyOf));
  const added = inherited
    .filter((item) => !seen.has(keyOf(item)))
    .map((item) => ({ ...item, inheritedFrom: item.inheritedFrom ?? from }));
  return [...own, ...added];
}

const enterpriseCleanup = {
  name: 'apex-grid-enterprise-cem-cleanup',
  packageLinkPhase({ customElementsManifest }) {
    let core;
    for (const mod of customElementsManifest?.modules ?? []) {
      for (const decl of mod.declarations ?? []) {
        if (decl?.kind !== 'class') continue;

        // 2. An event named after the constant that holds its name.
        if (Array.isArray(decl.events)) {
          decl.events = decl.events.filter((event) => !CONSTANT_NAME.test(event.name));
          if (decl.events.length === 0) delete decl.events;
        }

        // 3. Members inherited from an element of the apex-grid package.
        const superName = decl.superclass?.name;
        const superPackage = decl.superclass?.package ?? '';
        if (!decl.customElement || !superPackage.startsWith(CORE_PACKAGE)) continue;
        core ??= coreDeclarations();
        const base = core.get(superName);
        if (!base) {
          throw new Error(`${decl.name} extends ${superName}, which the apex-grid manifest lacks.`);
        }
        const from = { name: superName, package: CORE_PACKAGE };
        decl.superclass = from;
        decl.members = mergeInherited(
          decl.members,
          (base.members ?? []).filter((member) => !member.static),
          (member) => member.name,
          from
        );
        decl.attributes = mergeInherited(decl.attributes, base.attributes, (a) => a.name, from);
        decl.events = mergeInherited(decl.events, base.events, (e) => e.name, from);
        for (const key of ['cssParts', 'cssProperties', 'slots']) {
          const merged = mergeInherited(decl[key], base[key], (item) => item.name, from);
          if (merged.length) decl[key] = merged;
        }
      }
    }
  },
};

export default {
  plugins: [...coreConfig.plugins, enterpriseCleanup],
};
