// Entry point for the demo. Renders the persistent shell (theme picker +
// nav) once, then routes the hash to a page-specific module that owns the
// grid render inside `#demo`. Each "page" is a focused feature showcase so
// individual functionality can be exercised without interference from
// neighbouring features.

import {
  defineComponents,
  IgcInputComponent,
  IgcSelectComponent,
  IgcSwitchComponent,
} from 'igniteui-webcomponents';
import { html, render } from 'lit';
import { ApexGrid } from '../src/index.js';
import { setTheme, themePicker } from './shared.js';

defineComponents(IgcInputComponent, IgcSelectComponent, IgcSwitchComponent);
ApexGrid.register();

interface PageDef {
  id: string;
  label: string;
  description: string;
  mount: (container: HTMLElement) => void | Promise<void>;
}

// Lazy-load each page so navigating to a feature only pulls in its module
// (and its dataset) on first visit. Subsequent visits hit the module cache.
const pages: PageDef[] = [
  {
    id: 'main',
    label: 'Main',
    description: 'Editing, selection, expansion, export, pagination, virtualization, and more.',
    mount: (container) => import('./pages/main.js').then((m) => m.mount(container)),
  },
  {
    id: 'tree',
    label: 'Tree (nested rows)',
    description: 'Hierarchical data via getDataPath — collapsible parents with indented children.',
    mount: (container) => import('./pages/tree.js').then((m) => m.mount(container)),
  },
];

function resolvePage(): PageDef {
  const hash = (location.hash || '#main').slice(1);
  return pages.find((p) => p.id === hash) ?? pages[0];
}

function renderShell() {
  const active = resolvePage();
  render(
    html`
      <header class="demo-shell-header">
        ${themePicker()}
        <nav class="demo-nav" aria-label="Demo pages">
          ${pages.map(
            (page) => html`<a
              href=${`#${page.id}`}
              class=${page.id === active.id ? 'is-active' : ''}
              aria-current=${page.id === active.id ? 'page' : 'false'}
              >${page.label}</a
            >`
          )}
        </nav>
      </header>
      <p class="demo-description">${active.description}</p>
    `,
    document.getElementById('demo-shell')!
  );
}

const root = document.getElementById('demo')!;

async function mountActivePage() {
  // Reset the container so the previous page's lit-html part state doesn't
  // leak — `render(html``, ...)` would still leave Lit's bookkeeping nodes;
  // a hard reset gives each page a clean DOM to mount into.
  root.replaceChildren();
  renderShell();
  await resolvePage().mount(root);
}

window.addEventListener('hashchange', () => {
  void mountActivePage();
});

await mountActivePage();
await setTheme('bootstrap');
