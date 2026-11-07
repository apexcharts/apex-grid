import type { LitElement } from 'lit';

/**
 * The five companion popups bound to one grid, for the popup theming specs.
 * Each is mounted on the body beside the grid (tagged `data-popup` for the
 * cleanup), the way a page mounts them.
 */
export interface Popups {
  filterBuilder: LitElement;
  setFilter: LitElement;
  ai: LitElement;
  toolPanel: LitElement;
  statusBar: LitElement;
}

const TAGS: Record<keyof Popups, string> = {
  filterBuilder: 'apex-grid-filter-builder',
  setFilter: 'apex-grid-set-filter',
  ai: 'apex-grid-ai',
  toolPanel: 'apex-grid-tool-panel',
  statusBar: 'apex-grid-status-bar',
};

export async function mountPopups(grid: unknown): Promise<Popups> {
  const out = {} as Popups;
  for (const [name, tag] of Object.entries(TAGS) as [keyof Popups, string][]) {
    const el = document.createElement(tag) as LitElement & Record<string, unknown>;
    el.dataset.popup = '';
    if (name === 'setFilter') el.column = 'department';
    if (name === 'ai') el.setAttribute('mode', 'inline');
    el.grid = grid;
    document.body.append(el);
    await el.updateComplete;
    out[name] = el;
  }
  return out;
}

/** The surface a popup paints: the host, or the AI panel's inner panel. */
export function popupLook(el: HTMLElement): { background: string; color: string; font: string } {
  const surface =
    el.localName === 'apex-grid-ai'
      ? el.shadowRoot!.querySelector<HTMLElement>('[part="panel"]')!
      : el;
  const cs = getComputedStyle(surface);
  return { background: cs.backgroundColor, color: getComputedStyle(el).color, font: cs.fontFamily };
}
