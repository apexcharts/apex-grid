// Entry point for the vendored lit ESM bundle used by the e2e suite.
//
// Several demos build cell/header templates with lit's `html` tag, importing it
// from a CDN (`https://cdn.jsdelivr.net/npm/lit@3/+esm`, `https://esm.sh/lit@3/
// html.js`). To keep snapshots hermetic (and not break a demo just because a
// CDN hiccups), the spec intercepts those module requests and fulfills them
// from the bundle esbuild produces from this file. Re-exporting all of lit
// means any lit named import the demos use resolves.
export * from 'lit';
