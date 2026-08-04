/**
 * Custom Elements Manifest analyzer configuration.
 *
 * The `analyze` npm script keeps passing its CLI flags (`--litelement`, `--globs`,
 * `--exclude`); command-line options override this file, so this config only
 * *appends* a post-processing plugin. It does not restate the globs.
 *
 * Why the plugin exists:
 *
 *   `ApexGrid` extends the `EventEmitterBase` mixin (which itself extends
 *   `LitElement`) rather than `LitElement` directly. The analyzer detects the
 *   mixin's dynamic `new CustomEvent(type)` inside `emitEvent()` and records it
 *   as a single *nameless* event that is then inherited by every element built
 *   on the mixin. The element's real, named events come from the `@fires` JSDoc
 *   on the class itself. This plugin:
 *
 *     1. Drops the nameless event artifact from every declaration.
 *     2. Demotes the internal `EventEmitterBase` mixin so it is not reported as
 *        a custom element (the core `is-custom-element` heuristic flags it
 *        because it extends `LitElement`).
 *     3. Strips static members (`tagName`, `register`) from custom-element
 *        declarations so only instance-level props/attrs/events describe the
 *        authorable surface the React wrapper is generated from.
 *
 * The core `is-custom-element` feature runs before user plugins in
 * `packageLinkPhase`, so the demotion below is final.
 */
export default {
  plugins: [
    {
      name: 'apex-grid-cem-cleanup',
      packageLinkPhase({ customElementsManifest }) {
        for (const mod of customElementsManifest?.modules ?? []) {
          for (const decl of mod.declarations ?? []) {
            if (decl?.kind !== 'class') continue;

            // 1. Drop nameless events (the mixin's dynamic `new CustomEvent(type)`).
            if (Array.isArray(decl.events)) {
              decl.events = decl.events.filter((event) => event?.name);
              if (decl.events.length === 0) delete decl.events;
            }

            // 2. The event-emitter mixin base is internal plumbing, not an element.
            if (decl.name === 'EventEmitterBase') {
              delete decl.customElement;
              delete decl.tagName;
            }

            // 3. Static members are not part of the authorable custom-element surface.
            if ((decl.customElement || decl.tagName) && Array.isArray(decl.members)) {
              decl.members = decl.members.filter((member) => !member?.static);
            }
          }
        }
      },
    },
  ],
};
