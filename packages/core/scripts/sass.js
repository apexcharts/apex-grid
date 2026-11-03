import { realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import autoprefixer from 'autoprefixer';
import { globby } from 'globby';
import postcss from 'postcss';
import * as sass from 'sass-embedded';

export const TEMPLATE = [
  "import { css } from 'lit';",
  'export const styles = css`<% content %>`;',
].join('\n');

export const SCSS_EXT = new RegExp(/\.scss$/);
export const TEMPLATE_REG_EXP = new RegExp(/<%\s*content\s*%>/);

const stripComments = () => {
  return {
    postcssPlugin: 'postcss-strip-comments',
    OnceExit(root) {
      root.walkComments((node) => node.remove());
    },
  };
};

stripComments.postcss = true;

const POST_PROCESSOR = postcss([autoprefixer, stripComments]);

export async function compileSass(src, compiler) {
  const compiled = await compiler.compileAsync(src, {
    charset: false,
    style: 'compressed',
    // node_modules is resolved both locally and at the workspace root, since npm
    // hoists shared deps to the monorepo root.
    loadPaths: ['node_modules', '../../node_modules', 'src'],
  });

  return (await POST_PROCESSOR.process(compiled.css, { from: undefined })).css;
}

/**
 * Compiles one SCSS file and writes its `*.css.ts` module beside it. Shared by
 * the full build and the watcher so both write the same output.
 */
export async function writeStyleModule(path, compiler) {
  await writeFile(
    path.replace(SCSS_EXT, '.css.ts'),
    TEMPLATE.replace(TEMPLATE_REG_EXP, await compileSass(path, compiler)),
    'utf-8'
  );
}

export async function buildComponents() {
  const [compiler, paths] = await Promise.all([sass.initAsyncCompiler(), globby('src/**/*.scss')]);

  try {
    // Await every write, so callers (tsc, esbuild) never read a half-written
    // module and a failed write reaches the catch below.
    await Promise.all(paths.map((path) => writeStyleModule(path, compiler)));
  } catch (e) {
    await compiler.dispose();
    // biome-ignore lint/suspicious/noConsole: Build info
    console.error(e);
    process.exit(1);
  }

  await compiler.dispose();
}

// `node scripts/sass.js` (run from packages/core) builds every style module.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildComponents();
}
