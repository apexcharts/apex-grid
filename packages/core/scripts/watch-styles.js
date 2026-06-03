import { writeFile } from 'node:fs/promises';
import watch from 'node-watch';
import * as sass from 'sass-embedded';
import { compileSass, SCSS_EXT, TEMPLATE, TEMPLATE_REG_EXP } from './sass.js';

const watchOptions = {
  recursive: true,
  filter: (path) => {
    return /.(?:scss)$/.test(path);
  },
};

let updating = false;
const compiler = await sass.initAsyncCompiler();

const watcher = watch(['src/styles'], watchOptions, async (_, path) => {
  if (updating) {
    return;
  }

  updating = true;

  try {
    await writeFile(
      path.replace(SCSS_EXT, '.css.ts'),
      TEMPLATE.replace(TEMPLATE_REG_EXP, await compileSass(path, compiler)),
      'utf-8'
    );
  } catch (e) {
    // biome-ignore lint/suspicious/noConsole: Build info
    console.error(e);
  }

  updating = false;
});

watcher.on('close', () => compiler.dispose());
