import { expect } from '@open-wc/testing';
import ApexGridCell from '../src/components/cell.js';
import ApexGridFilterRow from '../src/components/filter-row.js';
import { ApexGrid } from '../src/components/grid.js';
import ApexGridRow from '../src/components/row.js';
import ApexGridToolbar from '../src/components/toolbar.js';

/**
 * Media-query coverage for the two environment preferences the a11y audit
 * flagged as absent repo-wide: `prefers-reduced-motion` and `forced-colors`.
 *
 * These assert the compiled stylesheets rather than rendered geometry, because
 * neither media feature can be forced from inside the page: there is no API to
 * emulate them (Playwright can, `@web/test-runner` cannot), and a headless
 * Chromium reports both as off. What that leaves worth testing is that the
 * rules exist, cover the right selectors, and use mechanisms forced colors
 * actually paints — which is exactly what regressed silently before, since a
 * deleted `@media` block breaks nothing any other test can see.
 */
function sheetText(styles: unknown): string {
  return String(Array.isArray(styles) ? styles.map(String).join('\n') : styles);
}

describe('reduced motion', () => {
  it('zeroes every duration token under prefers-reduced-motion', () => {
    const css = sheetText(ApexGrid.styles);
    expect(css).to.contain('prefers-reduced-motion: reduce');
    // All three, or a transition declared with the missing one keeps animating.
    const block = css.slice(css.indexOf('prefers-reduced-motion'));
    expect(block).to.contain('--_ag-dur-fast: 0ms');
    expect(block).to.contain('--_ag-dur-med: 0ms');
    expect(block).to.contain('--_ag-dur-slow: 0ms');
  });

  it('declares every transition through a duration token, so the opt-out is total', () => {
    // A hardcoded duration would survive the reduced-motion block above and is
    // invisible in any rendered assertion, so pin it here.
    const sheets = [ApexGrid, ApexGridCell, ApexGridRow, ApexGridFilterRow, ApexGridToolbar];
    for (const component of sheets) {
      const css = sheetText(component.styles);
      for (const match of css.matchAll(/transition:([^;}]+)/g)) {
        // The private copies (--_ag-dur-*) are what the components read.
        expect(match[1], `${component.name} has a transition without --_ag-dur-*`).to.contain(
          '--_ag-dur-'
        );
      }
    }
  });
});

describe('forced colors', () => {
  it('restates the active-cell and invalid-cell rings as outlines', () => {
    // Both are inset box-shadows normally, and forced colors paints no shadow.
    const css = sheetText(ApexGridCell.styles);
    const block = css.slice(css.indexOf('forced-colors: active'));
    expect(css).to.contain('forced-colors: active');
    expect(block).to.contain('outline');
    expect(block).to.contain('Highlight');
    expect(block).to.contain('CanvasText');
  });

  it('conveys row selection with the system Highlight pair', () => {
    const css = sheetText(ApexGridRow.styles);
    const block = css.slice(css.indexOf('forced-colors: active'));
    expect(css).to.contain('forced-colors: active');
    expect(block).to.contain('Highlight');
    expect(block).to.contain('HighlightText');
    // Selection is the one place overriding the forced palette is correct.
    expect(block).to.contain('forced-color-adjust:none');
  });

  it('gives the toolbar and filter input a painted focus ring', () => {
    for (const component of [ApexGridToolbar, ApexGridFilterRow]) {
      const css = sheetText(component.styles);
      expect(css, `${component.name} has no forced-colors block`).to.contain(
        'forced-colors: active'
      );
      const block = css.slice(css.indexOf('forced-colors: active'));
      expect(block, `${component.name} forced-colors ring is not an outline`).to.contain(
        'outline:'
      );
      expect(block).to.contain('Highlight');
    }
  });
});
