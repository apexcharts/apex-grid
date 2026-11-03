import watch from 'node-watch';
import * as sass from 'sass-embedded';
import { writeStyleModule } from './sass.js';

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
    await writeStyleModule(path, compiler);
  } catch (e) {
    // biome-ignore lint/suspicious/noConsole: Build info
    console.error(e);
  }

  updating = false;
});

watcher.on('close', () => compiler.dispose());
