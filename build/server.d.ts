/**
 * Type declaration for the generated Remix server build.
 *
 * `functions/[[path]].ts` — the Cloudflare Pages entry point — does
 * `await import('../build/server')`. That module is a BUILD ARTIFACT: `remix vite:build` emits it
 * as `build/server/index.js`, and `/build` is gitignored, so it does not exist in a fresh clone or
 * on CI before a build runs. Without a declaration, `tsc` cannot resolve the import and fails with
 * TS2307 — which is exactly what broke the Husky pre-commit hook.
 *
 * This file is the standard Remix answer: a checked-in declaration that describes the shape of the
 * generated module, so type-checking never depends on having built first. `.gitignore` already
 * anticipates it — the `/build` rule is immediately followed by `!build/server.d.ts` — the file was
 * simply never committed to this repository.
 *
 * `@remix-run/dev/server-build` declares the exact named exports a Remix `ServerBuild` module
 * provides (mode, assets, entry, routes, future, publicPath, …), so re-exporting it keeps this
 * declaration correct automatically as Remix evolves, instead of hand-maintaining a copy that can
 * drift from the real build output.
 *
 * At runtime nothing here applies: Cloudflare Pages resolves `../build/server` to the real emitted
 * JavaScript. This file only ever informs the type checker.
 */

export * from '@remix-run/dev/server-build';
