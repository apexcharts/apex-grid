# Visual e2e snapshots

Full-page screenshot regression tests for every standalone demo in
[`demo/`](../demo). Each demo is rendered against the locally-built
`apex-grid.min.js` bundle and compared pixel-for-pixel against a committed
baseline. This is the high-confidence net for the **shipped artifact** (bundle +
demos); the component-level unit tests live separately in
[`packages/core/test`](../packages/core/test) and run under `@web/test-runner`.

## Run it

```bash
npm run e2e            # build bundle + vendor lit, then compare to baselines
npm run e2e:ui         # Playwright UI mode (watch / pick tests / inspect diffs)
npm run e2e:report     # open the HTML report from the last run
```

`pree2e` rebuilds `apex-grid.min.js` first. If you changed library **source**,
run `npm run build:core` beforehand so `dist/` (and thus the bundle) is current.

## Updating baselines

Baselines are environment-sensitive (font hinting/antialiasing differ across
platforms), so the **only committed set is the Linux one** —
`e2e/__screenshots__/chromium-linux/`. It is the single source of truth and is
exactly what CI verifies. Refresh it through the pinned Playwright container
(which matches CI rendering); this needs Docker:

```bash
npm run e2e:docker:update   # refresh the committed Linux set (chromium-linux)
```

> **Subtle changes can slip the diff threshold.** `--update-snapshots` only
> rewrites a baseline when the new render differs beyond `maxDiffPixelRatio` /
> `threshold`. A low-contrast change (a soft shadow, a faint tint) can fall
> *under* that and leave the old baseline in place. When you make a global visual
> change, **delete the PNGs first** so every baseline is written fresh:
> `rm e2e/__screenshots__/chromium-linux/*.png && npm run e2e:docker:update`.

Always **review the regenerated PNGs** in the diff before committing — an
intended visual change and an accidental regression both show up as updated
baselines.

### Iterating locally on macOS / Windows

Native (non-Docker) runs render differently, so they keep their own
`chromium-<platform>/` set (e.g. `chromium-darwin`) which is **gitignored — never
committed**. It's purely a fast local feedback loop:

```bash
npm run e2e:update          # generate/refresh your local (gitignored) platform set
npm run e2e                 # compare against it
```

The authoritative check is always Docker/Linux. With no local baseline a native
run fails with "snapshot doesn't exist" by design — run `npm run e2e:docker`.

## How it stays deterministic

[`demos.spec.ts`](demos.spec.ts) intercepts the network so a snapshot never
depends on a flaky CDN:

- **Google Fonts** pass through (Inter drives layout; the test waits for
  `document.fonts.ready`).
- **lit `html`** CDN imports (jsdelivr / esm.sh) are served from a locally
  vendored bundle ([`vendor-lit-entry.js`](vendor-lit-entry.js), built by
  `e2e:vendor`) — a CDN hiccup can't break the demos that build templates.
- **Remote avatar images** are replaced with a fixed stub SVG.
- **Optional theme stylesheets** (igniteui via jsdelivr) are aborted; the demos
  fall back to the default `--ag-*` look, which is what we want to pin.

Animations/carets are disabled, the viewport/DPR/locale/timezone are fixed, and
`maxDiffPixelRatio` absorbs sub-pixel noise while a tightened per-pixel
`threshold` still flags subtle tint shifts.

## CI

[`.github/workflows/e2e.yml`](../.github/workflows/e2e.yml) runs the suite inside
`mcr.microsoft.com/playwright:v1.60.0-noble` — the same image used to generate
the Linux baselines, so rendering matches. On failure it uploads the Playwright
HTML report + diff images as a build artifact. Keep the image tag, the
`@playwright/test` version, and the `e2e:docker*` scripts in lockstep.
