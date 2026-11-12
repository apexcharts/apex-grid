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
 * Determinism: event keys are sorted and the banner carries a content hash of
 * the manifest entries this generator reads (not a timestamp), so identical input
 * yields byte-identical output.
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
 * name, event list and attribute-only props come from the manifest, not this
 * table. `deprecated` becomes an `@deprecated` tag on the exported component.
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

/** `rowSelected` -> `rowSelected`; `design-system` -> `'design-system'`. */
function propKey(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : `'${name}'`;
}

/** Free text as comment lines of at most `width` characters (a long word stays whole). */
function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const word of String(text).replaceAll('*/', '*\\/').split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** A JSDoc block at `indent`; an empty string in `lines` becomes a bare ` *`. */
function jsdoc(lines, indent = '') {
  if (lines.length === 1) return `${indent}/** ${lines[0]} */`;
  const body = lines.map((l) => (l ? `${indent} * ${l}` : `${indent} *`));
  return [`${indent}/**`, ...body, `${indent} */`].join('\n');
}

function banner(hash) {
  return `// GENERATED FROM custom-elements.json - do not edit by hand.\n// Manifest input hash: ${hash}\n// Regenerate with \`npm run generate\`.\n`;
}

/**
 * Content hash of what this generator reads from the manifest: the resolved
 * element entries (tag, class name, event map type, sorted event names), never
 * the manifest as a whole.
 *
 * Hashing the whole manifest made the banner move on any core change: a JSDoc
 * edit to an unrelated module changed the hash, the drift check then reported
 * every wrapper out of date with byte-identical bodies, and the fix was a
 * banner-only regeneration commit. Hashing the resolved entries ties the banner
 * to the inputs that shape the output. They are built in ELEMENTS order with
 * sorted events, and stringified with sorted keys, so the analyzer's module
 * order cannot move the hash either.
 */
function inputHashOf(entries) {
  return createHash('sha256').update(stableStringify(entries)).digest('hex').slice(0, 12);
}

/** JSON.stringify with object keys sorted at every depth. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const body = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',');
    return `{${body}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

// --- Read + index the manifest ----------------------------------------------
const manifestPath = findManifest();
const raw = readFileSync(manifestPath, 'utf-8');
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
  // Attributes the element documents with no backing property (e.g. `theme`):
  // not instance members, so @lit/react's prop types never include them, yet at
  // runtime React sets an unknown prop on a custom element as an attribute.
  const attributeProps = (decl.attributes ?? [])
    .filter((a) => a.name && !a.fieldName)
    .map((a) => ({ name: a.name, description: a.description ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ...entry, className: decl.name, events, attributeProps };
});
const hash = inputHashOf(resolved);

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
    if (el.eventMapType) {
      // The prop -> event name map as a type: the single naming rule (onProp)
      // that both the runtime map above and the row-typed handlers of
      // createApexGrid<T>() derive from.
      lines.push(
        `/** Handler prop to event name for \`<${el.tag}>\`, the naming rule the runtime map above uses. */`,
        `export type ${el.className}EventProps = {`
      );
      for (const name of el.events) lines.push(`  ${onProp(name)}: '${name}';`);
      lines.push('};', '');
    }
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
  const summary =
    el.className === 'ApexGrid'
      ? [
          'React wrapper for `<apex-grid>`. This base component types `data` /',
          '`columns` as `object`; use `createApexGrid<T>()` for row-typed props and events.',
        ]
      : [`React wrapper for \`<${el.tag}>\`.`];
  const deprecated = el.deprecated ? ['', ...wrap(`@deprecated ${el.deprecated}`, 77)] : [];
  const doc = jsdoc([...summary, ...deprecated]);

  // Attribute-only props widen the component's prop type; React passes them
  // through as attributes, so the runtime component is unchanged.
  const attrsType = `${el.className}AttributeProps`;
  const hasAttrs = el.attributeProps.length > 0;
  const attrsDecl = hasAttrs
    ? [
        `/** Attributes \`<${el.tag}>\` documents without a property; React sets them as attributes. */`,
        `export interface ${attrsType} {`,
        ...el.attributeProps.flatMap((a) => [
          ...(a.description ? [jsdoc(wrap(a.description, 75), '  ')] : []),
          `  ${propKey(a.name)}?: string;`,
        ]),
        '}',
        '',
      ]
    : [];
  const component = hasAttrs
    ? [
        `const ${el.className}Component = createComponent({`,
        '  react: React,',
        `  tagName: '${el.tag}',`,
        `  elementClass: ${elementRef},`,
        `  events: ${eventsConst},`,
        '});',
        '',
        doc,
        `export const ${el.className} = ${el.className}Component as React.ForwardRefExoticComponent<`,
        `  React.ComponentProps<typeof ${el.className}Component> & ${attrsType}`,
        '>;',
      ]
    : [
        doc,
        `export const ${el.className} = createComponent({`,
        '  react: React,',
        `  tagName: '${el.tag}',`,
        `  elementClass: ${elementRef},`,
        `  events: ${eventsConst},`,
        '});',
      ];
  return [
    `'use client';`,
    banner(hash),
    `import * as React from 'react';`,
    `import { createComponent } from '@lit/react';`,
    `import { ${elementImport} } from 'apex-grid';`,
    `import { ${eventsConst} } from '../events.js';`,
    '',
    '// Register the element on the client only. On the server (SSR / RSC) this is',
    '// a no-op, so importing the wrapper in a server component neither throws nor',
    '// pollutes the registry; the element registers before its first client render.',
    `if (typeof window !== 'undefined') {`,
    `  ${elementRef}.register();`,
    '}',
    '',
    ...attrsDecl,
    ...component,
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

// --- Assemble outputs -------------------------------------------------------
/**
 * Every generated file as `{ file, content }` with `file` relative to `src/`.
 * Shared by the CLI writer below and the drift check (scripts/check-generated.js)
 * so both agree on exactly what the manifest should produce.
 */
export function collectOutputs() {
  return [
    { file: 'events.ts', content: emitEvents() },
    ...resolved.map((el) => ({ file: `generated/${el.tag}.ts`, content: emitElement(el) })),
    { file: 'generated/index.ts', content: emitIndex() },
  ];
}

// --- Write when run directly ------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  mkdirSync(GENERATED, { recursive: true });
  for (const { file, content } of collectOutputs()) {
    writeFileSync(path.join(SRC, file), content);
  }
  const total = resolved.reduce((n, e) => n + e.events.length, 0);
  console.log(
    `✓ Generated wrappers for ${resolved.length} elements (${total} events), input hash ${hash}.`
  );
}
