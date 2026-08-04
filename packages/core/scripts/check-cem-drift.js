// biome-ignore-all lint/suspicious/noConsole: CLI drift check reports results to the terminal
/**
 * CEM drift check.
 *
 * Guards the single guarantee the React wrapper (and every other CEM consumer:
 * VS Code custom-data, Vue/Angular type hints, docs tables) depends on: that
 * `custom-elements.json` faithfully describes the `apex-grid` element.
 *
 * The manifest's event list is populated from hand-written `@fires` JSDoc on the
 * `ApexGrid` class, which can silently fall out of sync with the real event
 * contract in `ApexGridEventMap`. Likewise a public `@property` can be renamed
 * or dropped. This script derives the source of truth straight from the
 * TypeScript AST and fails the build (exit 1) on any mismatch, so a new event or
 * prop cannot ship without a corresponding manifest entry.
 *
 * Run via `npm run cem:check` (also chained into `npm run build`).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRID_TS = path.join(ROOT, 'src/components/grid.ts');
const MANIFEST = path.join(ROOT, 'custom-elements.json');
const TAG = 'apex-grid';

function parse(file) {
  return ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.ES2022, true);
}

function modifierKinds(node) {
  return (ts.getModifiers?.(node) ?? node.modifiers ?? []).map((m) => m.kind);
}

/** Public = not private, protected, or static. */
function isPublicInstance(node) {
  const kinds = modifierKinds(node);
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

// --- Source of truth from the TypeScript AST -------------------------------
const sf = parse(GRID_TS);
const sourceEvents = new Set();
const sourceProps = new Set();

(function walk(node) {
  if (ts.isInterfaceDeclaration(node) && node.name.text === 'ApexGridEventMap') {
    for (const member of node.members) {
      if (ts.isPropertySignature(member) && member.name) {
        sourceEvents.add(member.name.getText(sf));
      }
    }
  }
  if (ts.isClassDeclaration(node) && node.name?.text === 'ApexGrid') {
    for (const member of node.members) {
      const isFieldLike =
        ts.isPropertyDeclaration(member) ||
        ts.isGetAccessorDeclaration(member) ||
        ts.isSetAccessorDeclaration(member);
      if (isFieldLike && hasDecorator(member, 'property') && isPublicInstance(member)) {
        sourceProps.add(member.name.getText(sf));
      }
    }
  }
  ts.forEachChild(node, walk);
})(sf);

// --- Manifest under test ----------------------------------------------------
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'));
let grid;
for (const mod of manifest.modules ?? []) {
  for (const decl of mod.declarations ?? []) {
    if (decl.tagName === TAG) grid = decl;
  }
}

const problems = [];

if (!grid) {
  problems.push(
    `No declaration with tagName "${TAG}" found in custom-elements.json (is it a custom element?).`
  );
} else {
  const manifestEvents = new Set((grid.events ?? []).map((e) => e.name).filter(Boolean));
  const manifestProps = new Set(
    (grid.members ?? [])
      .filter((m) => m.kind === 'field' && !m.static && m.privacy === 'public')
      .map((m) => m.name)
  );

  const diff = (a, b) => [...a].filter((x) => !b.has(x)).sort();

  const eventsMissing = diff(sourceEvents, manifestEvents); // in code, absent from manifest
  const eventsExtra = diff(manifestEvents, sourceEvents); // in manifest, not a real event
  const propsMissing = diff(sourceProps, manifestProps); // @property absent from manifest

  if (eventsMissing.length)
    problems.push(
      `Events in ApexGridEventMap but missing from the manifest (add a @fires tag on the ApexGrid class): ${eventsMissing.join(', ')}`
    );
  if (eventsExtra.length)
    problems.push(
      `Events in the manifest with no matching ApexGridEventMap entry (stale @fires tag?): ${eventsExtra.join(', ')}`
    );
  if (propsMissing.length)
    problems.push(
      `@property fields on ApexGrid missing as public members in the manifest: ${propsMissing.join(', ')}`
    );
}

if (problems.length) {
  console.error('✗ CEM drift detected:\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nRegenerate with `npm run analyze` and reconcile the source of truth.');
  process.exit(1);
}

console.log(
  `✓ CEM in sync: ${sourceEvents.size} events and ${sourceProps.size} @property props verified against ${TAG}.`
);
