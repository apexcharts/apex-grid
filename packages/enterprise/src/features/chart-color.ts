/**
 * CSS colors read off the grid's tokens, made usable by the chart panel.
 *
 * The panel reads the grid's resolved `--_ag-*` tokens, which hold whatever the
 * page wrote: hex by default, but a token takes any CSS color, including
 * oklch(), lab(), color(), color-mix() and relative colors. A canvas
 * `fillStyle` only turns legacy sRGB syntax into hex: Chromium and WebKit hand
 * the rest back as oklch(), lab(), oklab() or color(srgb ...), and ApexCharts,
 * the light/dark check and a color input read none of those. So those colors
 * are painted on a 1x1 canvas and read back as sRGB bytes.
 */

/** sRGB channels 0 to 255, then the alpha 0 to 1. */
export type Rgba = [r: number, g: number, b: number, a: number];

let colorCtx: CanvasRenderingContext2D | null | undefined;

/** The shared 1x1 canvas, or null where there is none (no DOM, or no 2D context). */
function context(): CanvasRenderingContext2D | null {
  if (colorCtx === undefined) {
    const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
    if (canvas) canvas.width = canvas.height = 1;
    colorCtx = canvas?.getContext('2d', { willReadFrequently: true }) ?? null;
  }
  return colorCtx;
}

/**
 * How the canvas serialises a CSS color, or null when it is not a color. The canvas ignores a
 * value it cannot parse, so two different sentinels survive it unchanged.
 */
function paint(ctx: CanvasRenderingContext2D, color: string): string | null {
  ctx.fillStyle = '#000000';
  ctx.fillStyle = color;
  const style = ctx.fillStyle;
  ctx.fillStyle = '#ffffff';
  ctx.fillStyle = color;
  return ctx.fillStyle === style ? style : null;
}

/** The pixel the current fillStyle paints: premultiplied 8-bit channels and alpha. */
function pixel(ctx: CanvasRenderingContext2D): Uint8ClampedArray {
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillRect(0, 0, 1, 1);
  return ctx.getImageData(0, 0, 1, 1).data;
}

/**
 * The sRGB channels of a CSS color, or null when there is no canvas or the value is not a color.
 * Legacy sRGB syntax (hex, names, rgb(), hsl(), hwb()) is read from the canvas serialisation,
 * exactly as before; every other syntax from one painted pixel, so a wide-gamut color is clipped
 * to sRGB.
 */
export function parseColor(color: string): Rgba | null {
  const ctx = context();
  if (!ctx) return null;
  const style = paint(ctx, color);
  if (style === null) return null;
  if (style.startsWith('#')) {
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(style.slice(i, i + 2), 16));
    return [r, g, b, 1];
  }
  const legacy = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(style);
  if (legacy) return [+legacy[1], +legacy[2], +legacy[3], +legacy[4]];
  const [r, g, b, a] = pixel(ctx);
  if (a === 255) return [r, g, b, 1];
  // A translucent pixel is stored premultiplied in 8 bits, which rounds its channels. Read them
  // from an opaque copy instead (where relative colors parse) and the alpha from the
  // serialisation, which keeps it exact ("oklch(0.45 0.2 260 / 0.5)").
  const alpha = /\/\s*([\d.]+)\)$/.exec(style);
  const opaque = paint(ctx, `rgb(from ${color} r g b / 1)`) === null ? null : pixel(ctx);
  const [or, og, ob] = opaque ?? [r, g, b];
  return [or, og, ob, alpha ? +alpha[1] : a / 255];
}

const byte = (v: number) => v.toString(16).padStart(2, '0');

/**
 * Coarse light/dark decision from any CSS color. A fully transparent, empty or unparseable color
 * reads as light.
 */
export function isDark(color: string): boolean {
  const rgba = color.trim() ? parseColor(color) : null;
  if (!rgba || rgba[3] === 0) return false;
  const [r, g, b] = rgba;
  // Rec. 601 luma; < 0.5 of 255 reads as a dark surface.
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

/**
 * A CSS color as the `#rrggbb` a color input accepts (it shows black for any other syntax). The
 * input has no alpha, so a translucent color shows its opaque hue; one that does not parse reads
 * as gray.
 */
export function toHex(color: unknown): string {
  const rgba = parseColor(String(color));
  return rgba ? `#${rgba.slice(0, 3).map(byte).join('')}` : '#888888';
}

// Syntaxes ApexCharts reads as written: hex, a color name, and rgb(), rgba(), hsl(), hsla() and
// hwb() that are neither relative (`from`) nor space-separated rgb. hsl() and hwb() may hold one
// level of calc(), as an Ignite UI palette triplet does (`hsl(216deg, calc(98% * 1), ...)`).
const AS_WRITTEN =
  /^(#[\da-f]+|[a-z]+|rgba?\([^()]*,[^()]*\)|(hsla?|hwb)\((?!\s*from\b)(?:[^()]|\([^()]*\))*\))$/i;

/**
 * A token color ApexCharts can draw. A syntax it already reads passes through unchanged (the
 * defaults are hex), anything else becomes `#rrggbb`, or `rgba()` when translucent. ApexCharts
 * reads a modern color such as color(srgb ...) as gray, or drops its fill opacity.
 */
export function chartColor(color: string): string {
  if (AS_WRITTEN.test(color)) return color;
  const rgba = parseColor(color);
  if (!rgba) return color;
  const [r, g, b, a] = rgba;
  return a >= 1
    ? `#${[r, g, b].map(byte).join('')}`
    : `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}
