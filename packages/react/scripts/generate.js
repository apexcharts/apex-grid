// biome-ignore-all lint/suspicious/noConsole: CLI script reports progress to the terminal
/**
 * react-apex-grid wrapper generator (P1).
 *
 * Reads the `apex-grid` package's Custom Elements Manifest (`custom-elements.json`,
 * made authoritative in P0) and emits `@lit/react` wrappers plus a typed event
 * map. Runs at this package's build time, never at consumer install time.
 *
 * Output (all machine-generated, committed so diffs are reviewable and the P4
 * drift check can compare generated-vs-committed):
 *
 *   src/events.ts                      // on<Event> -> event name maps, typed per element
 *   src/generated/apex-grid.ts         // createComponent(...) base component
 *   src/generated/apex-grid-toolbar.ts
 *   src/generated/apex-grid-paginator.ts
 *   src/generated/index.ts             // re-exports
 *
 * Determinism: event keys are sorted and the banner carries the source manifest's
 * content hash (not a timestamp), so identical input yields byte-identical output.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(PKG_ROOT, 'src');
const GENERATED = path.join(SRC, 'generated');

/**
 * The elements we wrap and, where one exists, the exported event-map type used to
 * type each `on<Event>` handler to its real detail. Elements without a map fall
 * back to a plain `EventName` (a generic `(e: Event) => void` handler). The class
 * name and event list themselves come from the manifest, not this table.
 */
const ELEMENTS = [
  { tag: 'apex-grid', eventMapType: 'ApexGridEventMap' },
  { tag: 'apex-grid-toolbar' },
  { tag: 'apex-grid-paginator' },
];

// --- Locate the manifest shipped by the resolved `apex-grid` package --------
function findManifest() {
  let dir = path.dirname(require.resolve('apex-grid'));
  for (let i = 0; i < 8; i++) {
    const pkgJson = path.join(dir, 'package.json');
    if (existsSync(pkgJson)) {
      try {
        if (JSON.parse(readFileSync(pkgJson, 'utf-8')).name === 'apex-grid') {
          for (const candidate of ['custom-elements.json', 'dist/custom-elements.json']) {
            const p = path.join(dir, candidate);
            if (existsSync(p)) return p;
          }
        }
      } catch {
        // fall through to parent
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Could not find apex-grid custom-elements.json. Build the core package first (npm run build -w packages/core).'
  );
}

// --- Helpers ----------------------------------------------------------------
/** `rowSelected` / `apex-quick-filter` -> `onRowSelected` / `onApexQuickFilter`. */
function onProp(eventName) {
  const pascal = eventName
    .replace(/[^a-zA-Z0-9]+(.)?/g, (_, next) => (next ? next.toUpperCase() : ''))
    .replace(/^[a-z]/, (c) => c.toUpperCase());
  return `on${pascal}`;
}

function banner(hash) {
  return `// GENERATED FROM custom-elements.json - do not edit by hand.\n// Manifest hash: ${hash}\n// Regenerate with \`npm run generate\`.\n`;
}

// --- Read + index the manifest ----------------------------------------------
const manifestPath = findManifest();
const raw = readFileSync(manifestPath, 'utf-8');
const hash = createHash('sha256').update(raw).digest('hex').slice(0, 12);
const manifest = JSON.parse(raw);

const byTag = new Map();
for (const mod of manifest.modules ?? []) {
  for (const decl of mod.declarations ?? []) {
    if (decl.tagName) byTag.set(decl.tagName, decl);
  }
}

const resolved = ELEMENTS.map((entry) => {
  const decl = byTag.get(entry.tag);
  if (!decl) throw new Error(`Element <${entry.tag}> not found in ${manifestPath}.`);
  const events = (decl.events ?? [])
    .map((e) => e.name)
    .filter(Boolean)
    .sort();
  return { ...entry, className: decl.name, events };
});

// --- Emit src/events.ts -----------------------------------------------------
function emitEvents() {
  const eventMapTypes = [...new Set(resolved.map((e) => e.eventMapType).filter(Boolean))].sort();
  const lines = [banner(hash), `import type { EventName } from '@lit/react';`];
  if (eventMapTypes.length) {
    lines.push(`import type { ${eventMapTypes.join(', ')} } from 'apex-grid';`);
  }
  lines.push('');

  for (const el of resolved) {
    const constName = `${camel(el.className)}Events`;
    lines.push(`/** \`on<Event>\` handler props for \`<${el.tag}>\`. */`);
    if (el.events.length === 0) {
      lines.push(`export const ${constName} = {} as const;`, '');
      continue;
    }
    lines.push(`export const ${constName} = {`);
    for (const name of el.events) {
      const type = el.eventMapType
        ? `EventName<${el.eventMapType}<object>['${name}']>`
        : 'EventName';
      lines.push(`  ${onProp(name)}: '${name}' as ${type},`);
    }
    lines.push('} as const;', '');
  }
  return lines.join('\n');
}

/** `ApexGridToolbar` -> `apexGridToolbar`. */
function camel(className) {
  return className.charAt(0).toLowerCase() + className.slice(1);
}

// --- Emit a per-element wrapper ---------------------------------------------
function emitElement(el) {
  const eventsConst = `${camel(el.className)}Events`;
  // Alias the imported element constructor so it doesn't collide with the
  // wrapper component we export under the same class name.
  const elementRef = `${el.className}Element`;
  const elementImport = `${el.className} as ${elementRef}`;
  const doc =
    el.className === 'ApexGrid'
      ? '/**\n * React wrapper for `<apex-grid>`. This base component types `data` /\n * `columns` as `object`; use `createApexGrid<T>()` for row-typed props and events.\n */'
      : `/** React wrapper for \`<${el.tag}>\`. */`;
  return [
    banner(hash),
    `import * as React from 'react';`,
    `import { createComponent } from '@lit/react';`,
    `import { ${elementImport} } from 'apex-grid';`,
    // Side-effect registration so the element is defined before first render.
    // NOTE: not SSR-guarded yet; that lands in P3 (Next.js / server rendering).
    `import 'apex-grid/define';`,
    `import { ${eventsConst} } from '../events.js';`,
    '',
    doc,
    `export const ${el.className} = createComponent({`,
    '  react: React,',
    `  tagName: '${el.tag}',`,
    `  elementClass: ${elementRef},`,
    `  events: ${eventsConst},`,
    '});',
    '',
  ].join('\n');
}

// --- Emit src/generated/index.ts --------------------------------------------
function emitIndex() {
  const lines = [banner(hash)];
  for (const el of resolved) {
    lines.push(`export { ${el.className} } from './${el.tag}.js';`);
  }
  lines.push('');
  return lines.join('\n');
}

// --- Write ------------------------------------------------------------------
mkdirSync(GENERATED, { recursive: true });
writeFileSync(path.join(SRC, 'events.ts'), emitEvents());
for (const el of resolved) {
  writeFileSync(path.join(GENERATED, `${el.tag}.ts`), emitElement(el));
}
writeFileSync(path.join(GENERATED, 'index.ts'), emitIndex());

const total = resolved.reduce((n, e) => n + e.events.length, 0);
console.log(
  `✓ Generated wrappers for ${resolved.length} elements (${total} events) from manifest ${hash}.`
);
