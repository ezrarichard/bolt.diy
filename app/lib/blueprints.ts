/**
 * Compatibility shim — NOT part of the Sprint 5 architecture.
 *
 * All blueprint logic now lives in app/lib/blueprints/ (types.ts,
 * registry.ts, engine.ts, index.ts), per Sprint 5. This flat file only
 * still exists because file deletion wasn't available in the environment
 * this refactor was done in, and for the import specifier `~/lib/blueprints`,
 * module resolution checks this file (`blueprints.ts`) before it checks
 * `blueprints/index.ts` — so this file has to exist and simply forward to
 * the real module, rather than being removed.
 *
 * ACTION NEEDED: delete this file (`app/lib/blueprints.ts`). Once it's
 * gone, `~/lib/blueprints` will resolve straight to `app/lib/blueprints/index.ts`
 * with no change in behavior — every export below is already just a
 * pass-through.
 */
export * from './blueprints/index';
