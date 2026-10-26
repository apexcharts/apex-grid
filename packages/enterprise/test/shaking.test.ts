import { expect } from '@open-wc/testing';
import type { GridFeatureModule } from 'apex-grid/internal';
import '../src/define.js';
import * as entry from '../src/index.js';

// The README is the list package-root users opt in from, so it must name
// every module enterpriseModules carries (what /define registers) and every
// element /define defines.
async function readme(): Promise<string> {
  const response = await fetch(new URL('../README.md', import.meta.url));
  expect(response.ok, 'README.md is served').to.be.true;
  return response.text();
}

/** The `### Composing only the features you use` section. */
function composingSection(text: string): string {
  const start = text.indexOf('### Composing only the features you use');
  expect(start, 'composing section').to.be.greaterThan(-1);
  const end = text.indexOf('\n---', start);
  return text.slice(start, end === -1 ? undefined : end);
}

describe('enterprise README and entry drift', () => {
  it('documents every module enterpriseModules registers, by its exported name', async () => {
    const section = composingSection(await readme());
    const documented = [...section.matchAll(/^\| `(\w+Module)` \|/gm)].map((m) => m[1]);
    const exported = entry as unknown as Record<string, GridFeatureModule | undefined>;

    for (const name of documented) {
      expect(exported[name]?.id, `${name} is exported from the package root`).to.be.a('string');
    }
    expect(documented.map((name) => exported[name]?.id).sort()).to.deep.equal(
      entry.enterpriseModules.map((module) => module.id).sort()
    );
  });

  it('lists exactly the elements /define registers', async () => {
    const text = await readme();
    const start = text.indexOf('`/define` is the batteries-included entry');
    const paragraph = text.slice(start, text.indexOf('\n\n', start));
    const documented = [...paragraph.matchAll(/`<(apex-grid[\w-]*)>`/g)].map((m) => m[1]).sort();

    // Every `X.register()` in define.ts, so a new element cannot drift either.
    const define = await (await fetch(new URL('../src/define.ts', import.meta.url))).text();
    const classes = [...define.matchAll(/^(\w+)\.register\(\);$/gm)].map((m) => m[1]);
    expect(classes.length, 'register() calls in define.ts').to.be.greaterThan(1);
    const exported = entry as unknown as Record<string, { tagName?: string } | undefined>;
    const registered = classes.map((name) => exported[name]?.tagName ?? `(${name} not exported)`);
    for (const tag of registered) {
      expect(customElements.get(tag), `${tag} is defined by /define`).to.exist;
    }
    expect(documented).to.deep.equal([...registered].sort());
  });
});
