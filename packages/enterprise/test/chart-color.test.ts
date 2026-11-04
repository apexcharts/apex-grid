import { expect } from '@open-wc/testing';
import { chartColor, isDark, parseColor, toHex } from '../src/features/chart-color.js';

// The chart panel's reading of grid token colors. Chromium (the browser these tests run in) keeps
// oklch(), lab() and color(srgb ...) as written in a canvas fillStyle, and so does WebKit; Firefox
// converts them to hex. The pixel readback gives the same answer in all three.

/** The grid's default palette, surfaces and text, light and dark: all hex. */
const DEFAULTS = [
  '#0d6fd3',
  '#0a56b8',
  '#047857',
  '#b45309',
  '#b91c1c',
  '#92400e',
  '#3b82f6',
  '#60a5fa',
  '#34d399',
  '#fbbf24',
  '#f87171',
  '#fcd34d',
  '#1f2937',
  '#e2e8f0',
  '#fff',
  '#0f172a',
];

describe('chart-color', () => {
  describe('isDark', () => {
    const cases: Array<[string, boolean]> = [
      // Today's answers, pinned.
      ['#fff', false],
      ['#ffffff', false],
      ['#0f172a', true],
      ['#111', true],
      ['#111f', true],
      ['#111111ff', true],
      ['rgb(17, 17, 17)', true],
      ['rgba(17, 17, 17, 0.5)', true],
      ['hsl(0 0% 95%)', false],
      ['white', false],
      ['transparent', false],
      ['', false],
      ['not-a-color', false],
      // CSS Color 4: light surfaces used to read as dark.
      ['oklch(0.98 0.01 250)', false],
      ['lab(97 0 0)', false],
      ['lch(97 2 250)', false],
      ['oklab(0.97 0 0)', false],
      ['color(srgb 0.95 0.95 0.95)', false],
      ['color-mix(in srgb, white 90%, #0f172a)', false],
      ['color-mix(in oklab, white 90%, #0f172a)', false],
      ['hsl(from #0d6fd3 h s 97%)', false],
      ['rgb(240 240 240)', false],
      // And dark ones still read as dark.
      ['oklch(0.2 0 0)', true],
      ['lab(10 0 0)', true],
      ['color(srgb 0.1 0.1 0.1)', true],
      ['color-mix(in oklab, #0f172a 90%, white)', true],
      ['color(srgb 0 0 0 / 0)', false],
    ];
    for (const [color, dark] of cases) {
      it(`${color || '(empty)'} is ${dark ? 'dark' : 'light'}`, () => {
        expect(isDark(color)).to.equal(dark);
      });
    }
  });

  describe('toHex', () => {
    it('keeps every default color as it is', () => {
      for (const color of DEFAULTS) {
        const long =
          color.length === 4 ? `#${[...color.slice(1)].map((c) => c + c).join('')}` : color;
        expect(toHex(color), color).to.equal(long);
      }
    });

    const cases: Array<[unknown, string]> = [
      ['rgb(13, 111, 211)', '#0d6fd3'],
      ['rgb(13 111 211)', '#0d6fd3'],
      ['red', '#ff0000'],
      ['color-mix(in srgb, #06f 80%, white)', '#3385ff'],
      ['color(srgb 0.2 0.52 1)', '#3385ff'],
      ['oklch(0.98 0.01 250)', '#f4f9ff'],
      ['lab(97 0 0)', '#f6f6f6'],
      // A color input has no alpha: the hue, not black.
      ['rgba(13, 111, 211, 0.5)', '#0d6fd3'],
      ['oklch(0.45 0.2 260 / 0.5)', toHex('oklch(0.45 0.2 260)')],
      ['rgb(from #0d6fd3 r g b / 50%)', '#0d6fd3'],
      ['not-a-color', '#888888'],
      [undefined, '#888888'],
    ];
    for (const [color, hex] of cases) {
      it(`${String(color)} shows as ${hex}`, () => {
        expect(toHex(color)).to.equal(hex);
      });
    }
  });

  describe('chartColor', () => {
    it('passes every default color through unchanged', () => {
      for (const color of DEFAULTS) expect(chartColor(color)).to.equal(color);
    });

    for (const color of [
      'rgb(13, 111, 211)',
      'rgba(13, 111, 211, 0.5)',
      'red',
      'hsl(210, 88%, 44%)',
      'hsl(210 88% 44%)',
      'hsla(209deg, 89%, 44%, 1)',
      'hwb(210 5% 17%)',
      // An Ignite UI palette triplet in hsl(): ApexCharts drew these as written, opaque.
      'hsl(216deg, calc(98% * 1), calc(52% * 1))',
      'hsla(210, calc(80% * 1), 45%, 1)',
      'hwb(calc(10deg) 0% 0%)',
      '',
    ]) {
      it(`passes ${color || '(empty)'} through unchanged, as ApexCharts reads it`, () => {
        expect(chartColor(color)).to.equal(color);
      });
    }

    const cases: Array<[string, string | RegExp]> = [
      ['color-mix(in srgb, #06f 80%, white)', '#3385ff'],
      ['color(srgb 0.2 0.52 1)', '#3385ff'],
      ['rgb(13 111 211)', '#0d6fd3'],
      ['rgb(13 111 211 / 50%)', 'rgba(13, 111, 211, 0.5)'],
      ['rgb(from #0d6fd3 r g b)', '#0d6fd3'],
      ['hsl(from #0d6fd3 h s l)', '#0d6fd3'],
      ['oklch(0.45 0.2 260)', /^#[0-9a-f]{6}$/],
      ['color(srgb 0 0 1 / 0.5)', 'rgba(0, 0, 255, 0.5)'],
      // Translucent: exact channels and alpha, not the premultiplied 8-bit pixel.
      ['rgb(from #0d6fd3 r g b / 50%)', 'rgba(13, 111, 211, 0.5)'],
      ['color-mix(in srgb, #0d6fd3 50%, transparent)', 'rgba(13, 111, 211, 0.5)'],
      ['color(srgb 0.051 0.435 0.827 / 0.3)', 'rgba(13, 111, 211, 0.3)'],
      // rgb() holding calc() drew gray, so it is converted.
      ['rgb(calc(13 * 1), 111, 211)', '#0d6fd3'],
    ];
    for (const [color, out] of cases) {
      it(`turns ${color} into ${out}`, () => {
        if (typeof out === 'string') expect(chartColor(color)).to.equal(out);
        else expect(chartColor(color)).to.match(out);
      });
    }

    it('leaves a value that is not a color as it is', () => {
      expect(chartColor('oklch(nope)')).to.equal('oklch(nope)');
    });
  });

  it('parseColor reads channels and alpha, or null for a non-color', () => {
    expect(parseColor('#0d6fd3')).to.eql([13, 111, 211, 1]);
    expect(parseColor('rgba(13, 111, 211, 0.25)')).to.eql([13, 111, 211, 0.25]);
    expect(parseColor('color-mix(in srgb, #06f 80%, white)')).to.eql([51, 133, 255, 1]);
    expect(parseColor('rgb(from #0d6fd3 r g b / 50%)')).to.eql([13, 111, 211, 0.5]);
    expect(parseColor('nope')).to.equal(null);
  });
});
