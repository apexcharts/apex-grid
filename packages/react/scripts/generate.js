// biome-ignore-all lint/suspicious/noConsole: CLI script reports progress to the terminal
/**
 * react-apex-grid wrapper generator (P1).
 *
 * Reads the `apex-grid` package's Custom Elements Manifest (`custom-elements.json`,
 * made authoritative in P0) and emits `@lit/react` wrappers plus a typed event
 * map. Runs at this package's build time, never at consumer install time.
 *
 * When `apex-grid-enterprise` resolves, it reads that package's manifest too and
 * emits the `react-apex-grid/enterprise` wrappers into `src/generated/enterprise/`.
 * The two groups are hashed and written separately, so the community output is
 * byte-identical whether or not the enterprise package is installed.
 *
 * Output (all machine-generated, committed so diffs are reviewable and the P4
 * drift check can compare generated-vs-committed):
 *
 *   src/events.ts                      // on<Event> -> event name maps, typed per element
 *   src/generated/apex-grid.ts         // createComponent(...) base component
 *   src/generated/index.ts             // re-exports
 *   src/generated/enterprise/events.ts // the same three, one wrapper per enterprise element
 *   src/generated/enterprise/<tag>.ts
 *   src/generated/enterprise/index.ts
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

/**
 * The elements we wrap and, where one exists, the exported event-map type used to
 * type each `on<Event>` handler to its real detail. Elements without a map fall
 * back to a plain `EventName` (a generic `(e: Event) => void` handler). The class
 * name, event list, settable properties and attribute-only props come from the
 * manifest, not this table. `deprecated` becomes an `@deprecated` tag on the
 * exported component.
 *
 * Only elements that work on their own belong here. `<apex-grid-toolbar>` and
 * `<apex-grid-paginator>` read their state from the grid that hosts them, and
 * the grid renders its own inside its shadow root, so a wrapper for either
 * rendered an empty element (removed in react-apex-grid 0.2.0).
 */
const ELEMENTS = [{ tag: 'apex-grid', eventMapType: 'ApexGridEventMap' }];

/**
 * The enterprise grid and its six companion elements, the set
 * `apex-grid-enterprise/define` registers. `modules` names the package export
 * the grid opts into before it registers, as that entry does, so every feature
 * the enterprise grid ships is on. The companions read their state from the
 * grid set as their `grid` property, so unlike the community toolbar they work
 * as standalone elements. The table must cover every element the enterprise
 * manifest tags (`exhaustive` below), so a new one cannot ship unwrapped.
 */
const ENTERPRISE_ELEMENTS = [
  {
    tag: 'apex-grid-enterprise',
    eventMapType: 'ApexGridEnterpriseEventMap',
    modules: 'enterpriseModules',
  },
  { tag: 'apex-grid-tool-panel' },
  { tag: 'apex-grid-status-bar' },
  { tag: 'apex-grid-set-filter' },
  { tag: 'apex-grid-filter-builder' },
  { tag: 'apex-grid-chart' },
  { tag: 'apex-grid-ai' },
];

// --- Locate the manifest shipped by an installed package ------------------
/**
 * The `custom-elements.json` of the installed `pkg`, or `null` when `optional`
 * and the package is not installed. The package is found by its directory, not
 * its entry, so an installed but unbuilt package reports a missing manifest
 * instead of passing for an absent one.
 */
function findManifest(pkg, { optional = false } = {}) {
  const dir = (require.resolve.paths(pkg) ?? [])
    .map((modules) => path.join(modules, pkg))
    .find((candidate) => existsSync(path.join(candidate, 'package.json')));
  if (!dir) {
    if (optional) return null;
    throw new Error(`Could not find the ${pkg} package. Install the workspace first (npm ci).`);
  }
  for (const candidate of ['custom-elements.json', 'dist/custom-elements.json']) {
    const p = path.join(dir, candidate);
    if (existsSync(p)) return p;
  }
  throw new Error(
    `Could not find ${pkg} custom-elements.json. Build that package first (npm run build -w ${pkg}).`
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

// --- Read + index a manifest ------------------------------------------------
/**
 * Resolves each `elements` entry against the manifest at `manifestPath`. With
 * `exhaustive`, an element the manifest tags that the table lacks fails the
 * run, so a new element cannot ship without a wrapper.
 */
function resolveElements(manifestPath, elements, exhaustive) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const byTag = new Map();
  for (const mod of manifest.modules ?? []) {
    for (const decl of mod.declarations ?? []) {
      if (decl.tagName) byTag.set(decl.tagName, decl);
    }
  }
  const unwrapped = [...byTag.keys()].filter((tag) => !elements.some((e) => e.tag === tag));
  if (exhaustive && unwrapped.length) {
    throw new Error(`No wrapper entry for <${unwrapped.join('>, <')}> in ${manifestPath}.`);
  }
  return elements.map((entry) => {
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
    // Properties a prop may set: public instance fields with a setter. React
    // assigns every prop to the element, so a getter-only member throws during
    // commit and a method prop replaces the method on the instance; neither
    // belongs in the prop type. Inherited fields count: the enterprise manifest
    // carries the ones its grid inherits from apex-grid.
    const settableProps = [
      ...new Set(
        (decl.members ?? [])
          .filter(
            (m) =>
              m.kind === 'field' &&
              (m.privacy ?? 'public') === 'public' &&
              !m.static &&
              m.readonly !== true &&
              !m.name.startsWith('#')
          )
          .map((m) => m.name)
      ),
    ].sort();
    return { ...entry, className: decl.name, events, settableProps, attributeProps };
  });
}

/**
 * One package's wrappers: where its manifest comes from, the module the
 * wrappers import the elements from, and where the output goes (relative to
 * `src/`). `eventsImport` is the events file as the wrappers import it.
 */
function group({ pkg, elements, optional, exhaustive, dir, eventsFile, eventsImport }) {
  const manifestPath = findManifest(pkg, { optional });
  if (!manifestPath) return null;
  const resolved = resolveElements(manifestPath, elements, exhaustive);
  return { pkg, dir, eventsFile, eventsImport, resolved, hash: inputHashOf(resolved) };
}

const community = group({
  pkg: 'apex-grid',
  elements: ELEMENTS,
  dir: 'generated',
  eventsFile: 'events.ts',
  eventsImport: '../events.js',
});
const enterprise = group({
  pkg: 'apex-grid-enterprise',
  elements: ENTERPRISE_ELEMENTS,
  optional: true,
  exhaustive: true,
  dir: 'generated/enterprise',
  eventsFile: 'generated/enterprise/events.ts',
  eventsImport: './events.js',
});
const groups = [community, enterprise].filter(Boolean);

/** The row-typed factory each grid's summary points to. */
const FACTORIES = { ApexGrid: 'createApexGrid', ApexGridEnterprise: 'createApexGridEnterprise' };

// --- Emit the events file ---------------------------------------------------
function emitEvents({ pkg, resolved, hash }) {
  const eventMapTypes = [...new Set(resolved.map((e) => e.eventMapType).filter(Boolean))].sort();
  const lines = [banner(hash), `import type { EventName } from '@lit/react';`];
  if (eventMapTypes.length) {
    lines.push(`import type { ${eventMapTypes.join(', ')} } from '${pkg}';`);
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
      // that both the runtime map above and the row-typed handlers of the
      // grid's factory derive from.
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

/** `ApexGrid` -> `apexGrid`. */
function camel(className) {
  return className.charAt(0).toLowerCase() + className.slice(1);
}

// --- Emit a per-element wrapper ---------------------------------------------
function emitElement(el, { pkg, eventsImport, hash }) {
  const eventsConst = `${camel(el.className)}Events`;
  // Alias the imported element constructor so it doesn't collide with the
  // wrapper component we export under the same class name.
  const elementRef = `${el.className}Element`;
  const elementImport = `${el.className} as ${elementRef}`;
  const factory = FACTORIES[el.className];
  const summary = factory
    ? [
        `React wrapper for \`<${el.tag}>\`. This base component types \`data\` /`,
        `\`columns\` as \`object\`; use \`${factory}<T>()\` for row-typed props and events.`,
      ]
    : [`React wrapper for \`<${el.tag}>\`.`];
  const deprecated = el.deprecated ? ['', ...wrap(`@deprecated ${el.deprecated}`, 77)] : [];
  const doc = jsdoc([...summary, ...deprecated]);

  // The prop type keeps only settable properties: every other member the
  // element adds over HTMLElement (getters, methods, framework internals) is
  // omitted. Types only, so the runtime component is unchanged.
  const settableType = `${el.className}SettableProp`;
  const settableDecl = [
    `/** Properties of \`<${el.tag}>\` a prop can set: public fields that are not read-only. */`,
    el.settableProps.length
      ? `export type ${settableType} =\n${el.settableProps.map((p) => `  | '${p}'`).join('\n')};`
      : `export type ${settableType} = never;`,
    '',
  ];
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
  const component = [
    `const ${el.className}Component = createComponent({`,
    '  react: React,',
    `  tagName: '${el.tag}',`,
    `  elementClass: ${elementRef},`,
    `  events: ${eventsConst},`,
    '});',
    '',
    doc,
    `export const ${el.className} = ${el.className}Component as React.ForwardRefExoticComponent<`,
    '  Omit<',
    `    React.ComponentProps<typeof ${el.className}Component>,`,
    `    Exclude<keyof InstanceType<typeof ${elementRef}>, keyof HTMLElement | ${settableType}>`,
    `  >${hasAttrs ? ` & ${attrsType}` : ''}`,
    '>;',
  ];
  // A grid with feature modules opts into them before it registers, as the
  // package's own `define` entry does; `use()` must run before the first
  // element is created, and module evaluation is earlier than any render.
  const imports = el.modules ? `${elementImport}, ${el.modules}` : elementImport;
  const register = el.modules
    ? [`  ${elementRef}.use(...${el.modules});`, `  ${elementRef}.register();`]
    : [`  ${elementRef}.register();`];
  return [
    `'use client';`,
    banner(hash),
    `import * as React from 'react';`,
    `import { createComponent } from '@lit/react';`,
    `import { ${imports} } from '${pkg}';`,
    `import { ${eventsConst} } from '${eventsImport}';`,
    '',
    '// Register the element on the client only. On the server (SSR / RSC) this is',
    '// a no-op, so importing the wrapper in a server component neither throws nor',
    '// pollutes the registry; the element registers before its first client render.',
    `if (typeof window !== 'undefined') {`,
    ...register,
    '}',
    '',
    ...settableDecl,
    ...attrsDecl,
    ...component,
    '',
  ].join('\n');
}

// --- Emit the generated index -----------------------------------------------
function emitIndex({ resolved, hash }) {
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
 * so both agree on exactly what the manifests should produce.
 */
export function collectOutputs() {
  return groups.flatMap((g) => [
    { file: g.eventsFile, content: emitEvents(g) },
    ...g.resolved.map((el) => ({ file: `${g.dir}/${el.tag}.ts`, content: emitElement(el, g) })),
    { file: `${g.dir}/index.ts`, content: emitIndex(g) },
  ]);
}

/** Directories (relative to `src/`) whose every file must be a generator output. */
export const GENERATED_DIRS = ['generated', 'generated/enterprise'];

/** Whether the optional enterprise manifest was found, so its wrappers were generated. */
export const hasEnterprise = enterprise !== null;

// --- Write when run directly ------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  for (const g of groups) mkdirSync(path.join(SRC, g.dir), { recursive: true });
  for (const { file, content } of collectOutputs()) {
    writeFileSync(path.join(SRC, file), content);
  }
  for (const g of groups) {
    const total = g.resolved.reduce((n, e) => n + e.events.length, 0);
    console.log(
      `✓ Generated wrappers for ${g.resolved.length} ${g.pkg} elements (${total} events), input hash ${g.hash}.`
    );
  }
  if (!enterprise) {
    console.log('- apex-grid-enterprise is not installed: skipped the enterprise wrappers.');
  }
}
