# apex-grid demos

Standalone HTML demos for the apexcharts.com website. **This repo owns these
demos**; the website's `npm run samples` (gulp) task copies them out into
`website/nextjs/public/samples-apexgrid/`, exactly like apexgantt / apextree /
apexsankey.

## Local bundle vs CDN

Each demo loads the library from a **local** relative path:

```html
<script src="../apex-grid.min.js"></script>
```

`apex-grid.min.js` is a self-contained **classic (IIFE)** build of the `/define`
entry — lit and the virtualizer are inlined, no bare imports, no `type="module"`.
Because it's a classic script, demos open directly via `file://` (just
double-click), same as apexgantt. Build it at the repo root with:

```bash
npm run demo:bundle      # re-bundles packages/core/dist; run `npm run build:core` first if you changed source
```

It is **git-ignored** — a local-testing convenience only. The website never reads
the file: the gulp task string-replaces the path with the CDN URL on copy.

### Test locally

```bash
npm run build:core && npm run demo:bundle
```

Then either **open `demo/<name>.html` directly** (`file://` works), or serve the
repo root (`python3 -m http.server 8080` → `http://localhost:8080/demo/...`) if
you prefer http.

> Note: this local build is a **classic** script so `file://` works. The CDN
> build the website swaps in is an **ES module** (`esm.sh`), which is why the
> gulp rewrite below *adds* `type="module"`.

## What the website's gulp task does on copy

- rewrites `<script src="../apex-grid.min.js"></script>` →
  `<script type="module" src="https://esm.sh/apex-grid@<version>/define"></script>`
  (note: it adds `type="module"`), with `<version>` read from
  `packages/core/package.json`;
- injects its `iframe-resize.js` script before `</body>`.

So **do not** reference the CDN here, and **do not** add the iframe-resize script
here — both are the website's job.

## Enterprise demos (convention)

Demos that need the pro package use the `-enterprise.html` suffix and the
enterprise bundle (also a classic local script):

```html
<script src="../apex-grid-enterprise.min.js"></script>
<apex-grid-enterprise ...></apex-grid-enterprise>
```

The gulp task maps `<script src="../apex-grid-enterprise.min.js"></script>` →
`<script type="module" src="https://esm.sh/apex-grid-enterprise@<version>/define"></script>`
(version from `packages/enterprise/package.json`) and injects a license-key
script. Using distinct filenames (`apex-grid.min.js` vs
`apex-grid-enterprise.min.js`) keeps the two rewrites from colliding.
