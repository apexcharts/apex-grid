// biome-ignore-all lint/suspicious/noConsole: CLI drift check reports results to the terminal
/**
 * CEM drift check for apex-grid-enterprise.
 *
 * The React wrappers (react-apex-grid/enterprise) and every other manifest
 * reader rely on `custom-elements.json` describing each element `define.ts`
 * registers. Event lists come from hand-written `@fires` JSDoc, which can fall
 * out of step with what the code dispatches, and the grid's inherited surface
 * is merged in from the apex-grid manifest by the analyzer config. This script
 * derives the truth from the TypeScript AST and fails the build (exit 1) when
 * the manifest disagrees:
 *
 *   - every class `define.ts` registers has a declaration with its tag name;
 *   - `<apex-grid-enterprise>` fires exactly the `ApexGridEnterpriseEventMap`
 *     events plus the apex-grid events it inherits (core's own drift check ties
 *     those to core's `ApexGridEventMap`), and lists every `@property` it
 *     declares or inherits;
 *   - every event the grid class or a feature module (`src/features/**`)
 *     dispatches is in that map, and every enterprise key of the map is
 *     dispatched somewhere, so an event a feature fires on the host cannot
 *     go undocumented again;
 *   - each companion fires exactly the events its class dispatches with
 *     `new CustomEvent(...)`, and lists every `@property` it declares.
 *
 * Event names are read from `new CustomEvent(<name>)`, where `<name>` is a
 * string literal, a string constant from a scanned file, or a parameter of a
 * small emit helper whose callers pass a literal or a constant. Anything else
 * fails the check rather than being skipped.
 *
 * Run via `npm run cem:check` (also chained into `npm run build`). It imports
 * `typescript` hoisted from core's devDependencies (see the header of
 * `custom-elements-manifest.config.js`).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const MANIFEST = path.join(ROOT, 'custom-elements.json');
const GRID_CLASS = 'ApexGridEnterprise';
const GRID_EVENT_MAP = 'ApexGridEnterpriseEventMap';

function parse(file) {
  return ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.ES2022, true);
}

function isPublicInstance(node) {
  const kinds = (ts.getModifiers?.(node) ?? []).map((m) => m.kind);
  return !(
    kinds.includes(ts.SyntaxKind.PrivateKeyword) ||
    kinds.includes(ts.SyntaxKind.ProtectedKeyword) ||
    kinds.includes(ts.SyntaxKind.StaticKeyword)
  );
}

function hasDecorator(node, name) {
  return (ts.getDecorators?.(node) ?? []).some((d) => {
    const expr = ts.isCallExpression(d.expression) ? d.expression.expression : d.expression;
    return ts.isIdentifier(expr) && expr.text === name;
  });
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

// --- Registered elements: `X.register()` in define.ts, X imported from './file.js'.
const defineSf = parse(path.join(SRC, 'define.ts'));
const fileOf = new Map();
const registered = [];
walk(defineSf, (node) => {
  if (ts.isImportDeclaration(node) && node.importClause?.namedBindings) {
    const from = node.moduleSpecifier.text;
    if (!from.startsWith('./')) return;
    for (const el of node.importClause.namedBindings.elements ?? []) {
      fileOf.set(el.name.text, path.join(SRC, from.replace(/\.js$/, '.ts')));
    }
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'register' &&
    ts.isIdentifier(node.expression.expression)
  ) {
    registered.push(node.expression.expression.text);
  }
});

// --- Source of truth for one class: @property names, dispatched event names.
function sourceOf(className) {
  const sf = parse(fileOf.get(className));
  const constants = new Map();
  const props = new Set();
  const events = new Set();
  const mapEvents = new Set();
  walk(sf, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    ) {
      constants.set(node.name.text, node.initializer.text);
    }
    if (ts.isInterfaceDeclaration(node) && node.name.text === GRID_EVENT_MAP) {
      for (const member of node.members) {
        if (ts.isPropertySignature(member))
          mapEvents.add(member.name.getText(sf).replace(/'/g, ''));
      }
    }
  });
  walk(sf, (node) => {
    if (!ts.isClassDeclaration(node) || node.name?.text !== className) return;
    for (const member of node.members) {
      const fieldLike =
        ts.isPropertyDeclaration(member) ||
        ts.isGetAccessorDeclaration(member) ||
        ts.isSetAccessorDeclaration(member);
      if (fieldLike && hasDecorator(member, 'property') && isPublicInstance(member)) {
        props.add(member.name.getText(sf));
      }
    }
    walk(node, (inner) => {
      if (
        ts.isNewExpression(inner) &&
        ts.isIdentifier(inner.expression) &&
        inner.expression.text === 'CustomEvent'
      ) {
        const [arg] = inner.arguments ?? [];
        if (arg && ts.isStringLiteral(arg)) events.add(arg.text);
        else if (arg && ts.isIdentifier(arg) && constants.has(arg.text)) {
          events.add(constants.get(arg.text));
        }
      }
    });
  });
  return { props, events, mapEvents };
}

// --- Events the grid class and its feature modules dispatch on the host.
function tsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [full] : [];
  });
}

function calleeName(expr) {
  if (ts.isIdentifier(expr) || ts.isPrivateIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return undefined;
}

function hostDispatches() {
  const files = [path.join(SRC, 'grid-enterprise.ts'), ...tsFiles(path.join(SRC, 'features'))];
  const parsed = files.map(parse);
  const constants = new Map();
  for (const sf of parsed) {
    walk(sf, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer)
      ) {
        constants.set(node.name.text, node.initializer.text);
      }
    });
  }
  const events = new Set();
  const unresolved = [];
  const where = (sf, node) =>
    `${path.relative(ROOT, sf.fileName)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const nameOf = (arg) => {
    if (arg && ts.isStringLiteralLike(arg)) return arg.text;
    if (arg && ts.isIdentifier(arg) && constants.has(arg.text)) return constants.get(arg.text);
    return undefined;
  };
  for (const sf of parsed) {
    walk(sf, (node) => {
      if (
        !ts.isNewExpression(node) ||
        !ts.isIdentifier(node.expression) ||
        node.expression.text !== 'CustomEvent'
      ) {
        return;
      }
      const [arg] = node.arguments ?? [];
      const direct = nameOf(arg);
      if (direct !== undefined) {
        events.add(direct);
        return;
      }
      // An emit helper: `#emit(type, ...) { new CustomEvent(type, ...) }`.
      let fn = node.parent;
      while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
      const index =
        arg && ts.isIdentifier(arg) && fn
          ? fn.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === arg.text)
          : -1;
      const helper = index >= 0 && fn.name ? calleeName(fn.name) : undefined;
      if (!helper) {
        unresolved.push(where(sf, node));
        return;
      }
      let calls = 0;
      walk(sf, (call) => {
        if (!ts.isCallExpression(call) || calleeName(call.expression) !== helper) return;
        calls++;
        const name = nameOf(call.arguments[index]);
        if (name === undefined) unresolved.push(where(sf, call));
        else events.add(name);
      });
      if (!calls) unresolved.push(where(sf, node));
    });
  }
  return { events, unresolved };
}

// --- apex-grid's own manifest entry for the grid the enterprise one extends.
function coreGrid() {
  let dir = path.dirname(require.resolve('apex-grid'));
  for (;;) {
    const pkgJson = path.join(dir, 'package.json');
    if (existsSync(pkgJson) && JSON.parse(readFileSync(pkgJson, 'utf-8')).name === 'apex-grid') {
      for (const candidate of ['custom-elements.json', 'dist/custom-elements.json']) {
        const file = path.join(dir, candidate);
        if (!existsSync(file)) continue;
        for (const mod of JSON.parse(readFileSync(file, 'utf-8')).modules ?? []) {
          for (const decl of mod.declarations ?? []) {
            if (decl.tagName === 'apex-grid') return decl;
          }
        }
      }
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('No <apex-grid> declaration found in the apex-grid custom-elements.json.');
}

// --- Compare -----------------------------------------------------------------
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'));
const declOf = new Map();
for (const mod of manifest.modules ?? []) {
  for (const decl of mod.declarations ?? []) {
    if (decl.kind === 'class' && decl.customElement) declOf.set(decl.name, decl);
  }
}

const publicFields = (decl) =>
  new Set(
    (decl.members ?? [])
      .filter((m) => m.kind === 'field' && !m.static && (m.privacy ?? 'public') === 'public')
      .map((m) => m.name)
  );
const eventNames = (decl) => new Set((decl.events ?? []).map((e) => e.name).filter(Boolean));
const diff = (a, b) => [...a].filter((x) => !b.has(x)).sort();

const problems = [];
let eventCount = 0;
let propCount = 0;
for (const className of registered) {
  const decl = declOf.get(className);
  if (!decl?.tagName) {
    problems.push(`${className} is registered in define.ts but has no tagged manifest entry.`);
    continue;
  }
  const source = sourceOf(className);
  let expectedEvents = source.events;
  let expectedProps = source.props;
  if (className === GRID_CLASS) {
    const core = coreGrid();
    const coreEvents = eventNames(core);
    expectedEvents = new Set([...source.mapEvents, ...coreEvents]);
    expectedProps = new Set([...source.props, ...publicFields(core)]);
    const dispatched = hostDispatches();
    for (const at of dispatched.unresolved) {
      problems.push(
        `cannot tell which event ${at} dispatches; use a string literal or a string constant`
      );
    }
    const unmapped = diff(dispatched.events, expectedEvents);
    if (unmapped.length) {
      problems.push(
        `the grid or a feature module dispatches events ${GRID_EVENT_MAP} lacks: ${unmapped.join(', ')}`
      );
    }
    const ownMapEvents = new Set([...source.mapEvents].filter((e) => !coreEvents.has(e)));
    const neverFired = diff(ownMapEvents, dispatched.events);
    if (neverFired.length) {
      problems.push(
        `${GRID_EVENT_MAP} lists events nothing in grid-enterprise.ts or src/features dispatches: ${neverFired.join(', ')}`
      );
    }
  }
  const events = eventNames(decl);
  const props = publicFields(decl);
  const tag = `<${decl.tagName}>`;
  const missing = diff(expectedEvents, events);
  const extra = diff(events, expectedEvents);
  const propsMissing = diff(expectedProps, props);
  if (missing.length) {
    problems.push(`${tag} fires events the manifest lacks (add @fires): ${missing.join(', ')}`);
  }
  if (extra.length) {
    problems.push(
      `${tag} manifest lists events it never fires (stale @fires?): ${extra.join(', ')}`
    );
  }
  if (propsMissing.length) {
    problems.push(`${tag} @property fields missing from the manifest: ${propsMissing.join(', ')}`);
  }
  eventCount += expectedEvents.size;
  propCount += expectedProps.size;
}

if (problems.length) {
  console.error('✗ CEM drift detected:\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nRegenerate with `npm run analyze` and reconcile the source of truth.');
  process.exit(1);
}

console.log(
  `✓ CEM in sync: ${registered.length} elements, ${eventCount} events and ${propCount} props verified.`
);
