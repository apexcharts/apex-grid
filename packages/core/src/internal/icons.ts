import { html, type SVGTemplateResult, svg, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

interface IconDef {
  viewBox: string;
  paths: SVGTemplateResult;
  /** When true, renders stroke="currentColor" fill="none" (Lucide style). */
  stroke?: boolean;
}

// ---------------------------------------------------------------------------
// Filter-operand icons — fill-based, no Lucide equivalents.
// ---------------------------------------------------------------------------
const OPERAND_ICONS: Record<string, IconDef> = {
  all: {
    viewBox: '0 0 24 24',
    paths: svg`<path d="M2 14h8v2H2zm0-8h12v2H2zm14 11l-3-3-1.5 1.5L16 20l7-7-1.5-1.5L16 17zM2 10h12v2H2z"/>`,
  },
  contains: {
    viewBox: '0 0 24 24',
    paths: svg`<path d="M3 3v18h18V3zm16 16H5V5h14z"/><path d="M12 11.3a4.39 4.39 0 00-2.54.63 2.07 2.07 0 00-.9 1.78 2.29 2.29 0 00.66 1.74 2.63 2.63 0 001.89.63 2.39 2.39 0 001.32-.37 3.05 3.05 0 001-.93 3.72 3.72 0 00.08.57c0 .19.1.38.16.58h1.79a4.51 4.51 0 01-.21-.88 5.57 5.57 0 01-.07-.93v-3.5a2.44 2.44 0 00-.84-2 3.34 3.34 0 00-2.22-.7 3.54 3.54 0 00-2.3.72A1.93 1.93 0 009 10.29h1.71a.93.93 0 01.29-.71 1.5 1.5 0 011-.29 1.45 1.45 0 011 .35 1.3 1.3 0 01.37 1v.69zm1.4 1.08v1.17a1.61 1.61 0 01-.71.77 2.27 2.27 0 01-1.21.34 1.18 1.18 0 01-.84-.27.92.92 0 01-.3-.72 1.16 1.16 0 01.44-.9 1.76 1.76 0 011.22-.39z"/>`,
  },
  doesNotContain: {
    viewBox: '0 0 24 24',
    paths: svg`<path d="M21 19.74V3H4.26L2.89 1.63 1.63 2.92 3 4.29V21h16.73l1.37 1.37 1.27-1.26zM5 19V6.28l5.28 5.27a3.19 3.19 0 00-.81.38 2.07 2.07 0 00-.9 1.78 2.29 2.29 0 00.66 1.74 2.63 2.63 0 001.89.63 2.39 2.39 0 001.32-.37 3.05 3.05 0 001-.93 3.72 3.72 0 00.08.57c0 .19.1.38.16.58h1L17.73 19zm5.79-6.23a1.31 1.31 0 01.45-.25l1.37 1.36.28.29a1.57 1.57 0 01-.19.15 2.27 2.27 0 01-1.21.34 1.18 1.18 0 01-.84-.27.92.92 0 01-.3-.72 1.16 1.16 0 01.44-.9zm2.6-1.47h-.83l-1.62-1.62.08-.1a1.5 1.5 0 011-.29 1.45 1.45 0 011 .35 1.3 1.3 0 01.37 1zM19 17.74l-3.85-3.85v-3.27a2.44 2.44 0 00-.84-2 3.34 3.34 0 00-2.22-.7 3.64 3.64 0 00-2.24.67L6.26 5H19z"/>`,
  },
  greaterThan: {
    viewBox: '0 0 24 24',
    paths: svg`<path d="M6 7.11L15.09 12 6 16.89V19l12-6.46v-1.08L6 5v2.11z"/>`,
  },
  greaterThanOrEqual: {
    viewBox: '0 0 24 24',
    paths: svg`<path d="M5.99 19h12.02v2H5.99zM18 9.47L6 3v2.11L15.09 10 6 14.9v2.11l12-6.47V9.47z"/>`,
  },
  empty: {
    viewBox: '0 0 24 24',
    paths: svg`<path d="M5 17h2v2H5zm8 0h2v2h-2zm-8-4h2v2H5zm12 4h2v2h-2zM13 5h2v2h-2zM9 17h2v2H9zm8-8h2v2h-2zm0 4h2v2h-2zm0-8h2v2h-2zM5 9h2v2H5zm0-4h2v2H5zm4 0h2v2H9z"/>`,
  },
  endsWith: {
    viewBox: '0 0 24 24',
    paths: svg`<path d="M3 14.5h2v2H3zm8 0h2v2h-2zm-4 0h2v2H7zm13.8.3v-3A2.1 2.1 0 0020 10a3 3 0 00-2-.6 3 3 0 00-2 .6 1.7 1.7 0 00-.7 1.5h1.5a.8.8 0 01.3-.7 1.3 1.3 0 01.9-.3 1.3 1.3 0 01.9.4 1.1 1.1 0 01.3.8v.6H18a3.8 3.8 0 00-2.2.6 1.8 1.8 0 00-.8 1.5 2 2 0 00.6 1.6 2.3 2.3 0 001.6.6 2.1 2.1 0 001.2-.4 2.8 2.8 0 00.8-.8 4.3 4.3 0 00.1.5l.1.5H21a4.1 4.1 0 01-.2-.7 5.4 5.4 0 010-1zm-1.6-.5a1.5 1.5 0 01-.6.7 2 2 0 01-1 .2 1.1 1.1 0 01-.8-.2.8.8 0 01-.2-.6 1 1 0 01.3-.8 1.5 1.5 0 011.1-.3h1.2z"/>`,
  },
  equals: {
    viewBox: '0 0 24 24',
    paths: svg`<path d="M5 13.5h14v2H5zm0-5h14v2H5z"/>`,
  },
  false: {
    viewBox: '0 0 24 24',
    paths: svg`<path d="M8 5a7 7 0 107 7 7 7 0 00-8-7zm4.31 9.79l-1.52 1.52L8 13.52l-2.79 2.79-1.52-1.52L6.48 12 3.69 9.21l1.52-1.52L8 10.48l2.79-2.79 1.52 1.52L9.52 12zM18 7a5 5 0 00-3 1.06 7.48 7.48 0 01.49 1 3.89 3.89 0 110 5.82 8.08 8.08 0 01-.49 1A5 5 0 1018 7z"/><path d="M17.52 13.85l2.91-2.92-.78-.78-2.13 2.12-1.17-1.15-.38.37-.41.41.42.42L17 13.34l.52.51z"/>`,
  },
  lessThan: {
    viewBox: '0 0 24 24',
    paths: svg`<path d="M6 12.54L18 19v-2.11L8.91 12 18 7.11V5L6 11.46v1.08z"/>`,
  },
  lessThanOrEqual: {
    viewBox: '0 0 24 24',
    paths: svg`<path d="M5.99 19h12.02v2H5.99zM18 14.9L8.91 10 18 5.11V3L6 9.47v1.07l12 6.47V14.9z"/>`,
  },
  notEmpty: {
    viewBox: '0 0 24 24',
    paths: svg`<path d="M5 9h2v2H5zm4 8h2v2H9zm4 0h2v2h-2zm4-8h2v2h-2zm0-4h2v2h-2zM5 17h2v2H5zm8-12h2v2h-2zm-8 8h2v2H5zm14 2v-2h-2v.47L18.53 15H19zm-8-8V5H9v.46L10.54 7H11zM2.76 1.76L1.5 3.06 20.97 22.5l1.26-1.26-8.89-8.89L2.76 1.76z"/>`,
  },
  doesNotEqual: {
    viewBox: '0 0 24 24',
    paths: svg`<path d="M17.37 4.71l-1.74-1-2.76 4.79H5v2h6.71l-1.73 3H5v2h3.82l-2.19 3.79 1.74 1 2.76-4.79H19v-2h-6.71l1.73-3H19v-2h-3.82l2.19-3.79z"/>`,
  },
  startsWith: {
    viewBox: '0 0 24 24',
    paths: svg`<path d="M5.9 7.5l-3.9 9h1.7l.7-1.8h4.1l.7 1.8H11l-3.9-9H5.9zM5 13.2l1.5-4.1L8 13.2H5zm7 1.3h2v2h-2v-2zm8 0h2v2h-2v-2zm-4 0h2v2h-2v-2z"/>`,
  },
  true: {
    viewBox: '0 0 24 24',
    paths: svg`<path d="M19.44 14.22zm-2.88 0zm0 0L18 12.79l1.44 1.43.78-.78L18.79 12l1.43-1.44-.78-.78L18 11.21l-1.44-1.43-.78.78L17.21 12l-1.43 1.44.78.78z"/><path d="M18 7a5 5 0 00-3 1.06 7.48 7.48 0 01.49 1 3.89 3.89 0 110 5.82 8.08 8.08 0 01-.49 1A5 5 0 1018 7zM8 5a7 7 0 107 7 7 7 0 00-7-7zm-.93 10.18l-3.38-3.37 1.13-1.12 2.25 2.25 4.11-4.12 1.13 1.12z"/>`,
  },
};

// ---------------------------------------------------------------------------
// Lucide UI-chrome icons — stroke-based, consistent family.
// ---------------------------------------------------------------------------
const CHROME_ICONS: Record<string, IconDef> = {
  // ListFilter: three lines of decreasing width (funnel metaphor)
  filter: {
    viewBox: '0 0 24 24',
    stroke: true,
    paths: svg`<path d="M3 6h18M7 12h10M11 18h2"/>`,
  },
  // Three-dots vertical menu (filled circles — intentionally fill, not stroke)
  'more-vert': {
    viewBox: '0 0 24 24',
    paths: svg`<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>`,
  },
  // X close
  close: {
    viewBox: '0 0 24 24',
    stroke: true,
    paths: svg`<path d="M18 6 6 18M6 6l12 12"/>`,
  },
  // RotateCcw reset
  refresh: {
    viewBox: '0 0 24 24',
    stroke: true,
    paths: svg`<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>`,
  },
  // Search
  search: {
    viewBox: '0 0 24 24',
    stroke: true,
    paths: svg`<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>`,
  },
  // ChevronDown
  'chevron-down': {
    viewBox: '0 0 24 24',
    stroke: true,
    paths: svg`<path d="m6 9 6 6 6-6"/>`,
  },
  // ArrowUp (used by expansion and group row icons)
  'arrow-upward': {
    viewBox: '0 0 24 24',
    stroke: true,
    paths: svg`<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>`,
  },
  // ArrowDown
  'arrow-downward': {
    viewBox: '0 0 24 24',
    stroke: true,
    paths: svg`<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>`,
  },
  // Download
  download: {
    viewBox: '0 0 24 24',
    stroke: true,
    paths: svg`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`,
  },
  // Star
  star: {
    viewBox: '0 0 24 24',
    stroke: true,
    paths: svg`<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`,
  },
  // Column menu: sort ascending (ArrowUpWideNarrow)
  'sort-asc': {
    viewBox: '0 0 24 24',
    stroke: true,
    paths: svg`<path d="m3 8 4-4 4 4"/><path d="M7 4v16"/><path d="M11 12h4"/><path d="M11 16h7"/><path d="M11 20h10"/>`,
  },
  // Column menu: sort descending (ArrowDownWideNarrow)
  'sort-desc': {
    viewBox: '0 0 24 24',
    stroke: true,
    paths: svg`<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h10"/><path d="M11 8h7"/><path d="M11 12h4"/>`,
  },
  // Paginator
  'page-first': {
    viewBox: '0 0 24 24',
    stroke: true,
    paths: svg`<path d="m17 18-6-6 6-6"/><path d="M7 6v12"/>`,
  },
  'page-previous': {
    viewBox: '0 0 24 24',
    stroke: true,
    paths: svg`<path d="m15 18-6-6 6-6"/>`,
  },
  'page-next': {
    viewBox: '0 0 24 24',
    stroke: true,
    paths: svg`<path d="m9 18 6-6-6-6"/>`,
  },
  'page-last': {
    viewBox: '0 0 24 24',
    stroke: true,
    paths: svg`<path d="m7 18 6-6-6-6"/><path d="M17 6v12"/>`,
  },
};

const ICONS: Record<string, IconDef> = { ...OPERAND_ICONS, ...CHROME_ICONS };

export type GridIconName = keyof typeof ICONS;

export interface IconRenderOptions {
  /** Lit `slot` attribute. Useful when icons sit inside slotted positions of other components. */
  slot?: string;
  /** Lit `part` attribute. */
  part?: string;
  /** Inline `class` attribute. */
  class?: string;
  /** When provided, sets `data-sort-index` (used by the header sort indicator). */
  sortIndex?: number | string;
}

/**
 * Renders one of the grid's built-in icons as an inline `<svg>`. Lucide-based
 * icons (`stroke: true`) render as `stroke="currentColor" fill="none"`;
 * legacy fill icons render as `fill="currentColor"`.
 */
export function renderIcon(name: string, opts: IconRenderOptions = {}): TemplateResult {
  const icon = ICONS[name];
  if (!icon) return html``;
  const isStroke = Boolean(icon.stroke);
  return html`<svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox=${icon.viewBox}
    fill=${isStroke ? 'none' : 'currentColor'}
    stroke=${ifDefined(isStroke ? 'currentColor' : undefined)}
    stroke-width=${ifDefined(isStroke ? '2' : undefined)}
    stroke-linecap=${ifDefined(isStroke ? 'round' : undefined)}
    stroke-linejoin=${ifDefined(isStroke ? 'round' : undefined)}
    aria-hidden="true"
    focusable="false"
    data-icon=${name}
    slot=${ifDefined(opts.slot)}
    part=${ifDefined(opts.part)}
    class=${ifDefined(opts.class)}
    data-sort-index=${ifDefined(opts.sortIndex)}
  >${icon.paths}</svg>`;
}

/**
 * Renders the stacked up/down sort affordance (Lucide ChevronsUpDown split
 * into two independently-styleable parts). The header CSS dims both chevrons
 * at rest, lifts the inactive one on hover, and paints the active direction
 * in the brand color via `data-sort-active` on the parent button.
 */
export function renderSortArrows(): TemplateResult {
  return html`<svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="5 3 14 18"
    width="7"
    height="9"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    part="sort-arrows"
  >${svg`<path part="sort-up" d="M7 9l5-5 5 5"/><path part="sort-down" d="M7 15l5 5 5-5"/>`}</svg>`;
}
