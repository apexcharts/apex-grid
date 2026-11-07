import { elementUpdated, fixture, html } from '@open-wc/testing';
import { loadIgniteSheet, resolveColor } from '../../../../test-setup/ignite-ui.js';
import { ApexGrid } from '../../src/components/grid.js';
import data, { type TestData } from './test-data.js';

/**
 * Helpers for the Ignite UI theming specs: the fixture sheets (Ignite UI
 * 7.4.1, `:root` only, and the 7.5.0-beta.0 `next-dark-material` with the
 * surface roles), a grid mount in the light DOM or inside an open shadow root,
 * and colour comparison by the browser's own resolution.
 */

export type Grid = ApexGrid<TestData>;

export const LIGHT_SHEETS = ['light-bootstrap', 'light-fluent', 'light-indigo', 'light-material'];
export const DARK_SHEETS = ['dark-bootstrap', 'dark-fluent', 'dark-indigo', 'dark-material'];

/** Loads a fixture sheet into the document head, replacing the one loaded before. */
export const loadSheet: (name: string | null) => Promise<void> = loadIgniteSheet;

/** The computed colour of a CSS colour value, resolved at `at`. */
export const color: (value: string, at?: Element) => string = resolveColor;

/** A private token of a grid as a computed colour. */
export function token(grid: Element, name: string): string {
  return color(getComputedStyle(grid).getPropertyValue(name).trim() || 'transparent');
}

/** An Ignite UI token as the colour the browser paints, resolved on the root. */
export function ig(name: string): string {
  return color(`var(${name})`, document.body);
}

export interface MountOptions {
  /** `style` on a wrapping ancestor. */
  ancestor?: string;
  /** `style` on the grid. */
  style?: string;
  /** The grid's `theme` attribute. */
  theme?: string;
  /** Extra attributes on the grid. */
  attrs?: Record<string, string>;
  /** Mount inside an open shadow root. */
  shadow?: boolean;
}

/** Mounts a grid with data, in the light DOM or inside an open shadow root. */
export async function mount(options: MountOptions = {}): Promise<Grid> {
  const parentNode = document.createElement('div');
  parentNode.setAttribute('style', `width: 600px; height: 300px; ${options.ancestor ?? ''}`);
  let grid: Grid;
  if (options.shadow) {
    document.body.append(parentNode);
    const host = document.createElement('div');
    parentNode.append(host);
    const root = host.attachShadow({ mode: 'open' });
    grid = document.createElement(ApexGrid.tagName) as Grid;
    grid.style.cssText = `display: grid; height: 280px; ${options.style ?? ''}`;
    root.append(grid);
  } else {
    grid = await fixture<Grid>(html`<apex-grid></apex-grid>`, { parentNode });
    if (options.style) grid.style.cssText = options.style;
  }
  if (options.theme) grid.setAttribute('theme', options.theme);
  for (const [name, value] of Object.entries(options.attrs ?? {})) grid.setAttribute(name, value);
  Object.assign(grid, { data });
  await elementUpdated(grid);
  return grid;
}

/** Removes the mounts `mount({ shadow: true })` left in the body. */
export function cleanupShadowMounts(): void {
  for (const el of document.querySelectorAll('body > div[style]')) el.remove();
}

/** The grid's theme-relevant colours, for "the same as without" comparisons. */
export function look(grid: Grid): Record<string, string> {
  const names = [
    '--_ag-brand',
    '--_ag-brand-strong',
    '--_ag-surface',
    '--_ag-grid-bg',
    '--_ag-surface-elevated',
    '--_ag-text',
    '--_ag-text-body',
    '--_ag-text-muted',
    '--_ag-text-subtle',
    '--_ag-hairline',
    '--_ag-border',
    '--_ag-header-separator',
    '--_ag-pin-line',
    '--_ag-good',
    '--_ag-watch',
    '--_ag-risk',
    '--_ag-row-hover',
  ];
  const out: Record<string, string> = {};
  for (const name of names) out[name] = token(grid, name);
  const cs = getComputedStyle(grid);
  out.font = cs.fontFamily;
  out.color = cs.color;
  out.background = cs.backgroundColor;
  out.radius = cs.borderTopLeftRadius;
  for (const name of [
    '--_ag-overlay',
    '--_ag-overlay-text',
    '--_ag-overlay-accent',
    '--_ag-overlay-font',
  ]) {
    out[name] = cs.getPropertyValue(name).trim();
  }
  return out;
}
