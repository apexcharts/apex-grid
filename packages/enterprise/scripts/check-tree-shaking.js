// Guards the opt-in module seam: a package-root consumer that never registers
// rangeSelectionModule or formulaModule must not bundle their code.
//
// It bundles small consumers of src/index.ts with esbuild, compiling each file
// with tsc's own per-file transform and the package compiler options, so a
// tsc emit detail (such as the class alias written for a static field read
// through the class name) shows up here the same way it does in dist. Other
// packages (apex-grid, lit, apex-commons, ...) stay external: only this
// package's own modules are checked. Runs in about a second, before wtr.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(PKG_DIR, 'src/index.ts');

// Class names only the opt-in code carries (type-only references are erased,
// so any occurrence means the class itself was bundled).
const MARKERS = {
  rangeSelection: /\bRangeSelectionController\b/,
  formulaEditor: /\bFormulaCellEditor\b/,
};

const CONSUMERS = {
  // No modules: the README's package-root path.
  none: `import { ApexGridEnterprise } from 'apex-grid-enterprise';
ApexGridEnterprise.register();`,
  // One unrelated module.
  pivot: `import { ApexGridEnterprise, pivotModule } from 'apex-grid-enterprise';
ApexGridEnterprise.use(pivotModule);
ApexGridEnterprise.register();`,
  // Control: opting in must still bring both in, so a renamed class cannot
  // make the absence checks pass by accident.
  optIn: `import { ApexGridEnterprise, formulaModule, rangeSelectionModule } from 'apex-grid-enterprise';
ApexGridEnterprise.use(rangeSelectionModule, formulaModule);
ApexGridEnterprise.register();`,
};

function compilerOptions() {
  const file = path.join(PKG_DIR, 'scripts/tsconfig.prod.json');
  const parsed = ts.getParsedCommandLineOfConfigFile(
    file,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} }
  );
  if (!parsed) throw new Error(`cannot read ${file}`);
  return { ...parsed.options, sourceMap: false, inlineSourceMap: false, inlineSources: false };
}

async function bundle(source, options) {
  const result = await build({
    stdin: { contents: source, resolveDir: PKG_DIR, loader: 'js' },
    bundle: true,
    write: false,
    format: 'esm',
    logLevel: 'silent',
    plugins: [
      {
        name: 'tsc-emit',
        setup(b) {
          b.onResolve({ filter: /^apex-grid-enterprise$/ }, () => ({ path: INDEX }));
          b.onResolve({ filter: /^[^./]/ }, (args) => ({ path: args.path, external: true }));
          b.onLoad({ filter: /\.ts$/ }, (args) => ({
            contents: ts.transpileModule(readFileSync(args.path, 'utf-8'), {
              compilerOptions: options,
              fileName: args.path,
            }).outputText,
            loader: 'js',
          }));
        },
      },
    ],
  });
  return result.outputFiles[0].text;
}

async function main() {
  const options = compilerOptions();
  const problems = [];
  for (const [name, source] of Object.entries(CONSUMERS)) {
    const text = await bundle(source, options);
    for (const [feature, marker] of Object.entries(MARKERS)) {
      const present = marker.test(text);
      if (name === 'optIn' && !present) {
        problems.push(
          `${name}: opting in did not bundle ${feature} (${marker}); update the marker`
        );
      } else if (name !== 'optIn' && present) {
        problems.push(`${name}: ${feature} is bundled although its module is not registered`);
      }
    }
  }
  if (problems.length) {
    // biome-ignore lint/suspicious/noConsole: build guard output
    console.error(
      `apex-grid-enterprise tree-shaking check failed:\n  - ${problems.join('\n  - ')}`
    );
    process.exit(1);
  }
}

main();
