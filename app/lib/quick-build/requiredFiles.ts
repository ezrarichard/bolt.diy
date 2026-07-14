/**
 * Quick Build Generation Lifecycle — Sprint 43A (Part 4), made template-aware in the 43A
 * audit pass.
 *
 * The original version of this check required `main.tsx`/`App.tsx`/`vite.config.*` —
 * correct for exactly one of Quick Build's 14 selectable starter templates (see
 * app/utils/constants.ts's `STARTER_TEMPLATES`: Vite React/TS/Vanilla/Shadcn, Next.js,
 * Astro, SvelteKit, Vue, Angular, SolidJS, Qwik, Remix, Expo, Slidev). Astro has no
 * `App.tsx`; SvelteKit/Vue/Angular have no `main.tsx`; Next.js/Astro/SvelteKit/Angular/Expo
 * don't use `vite.config.*` at all — the old check would have failed a correct generation
 * from any of those templates. This version only requires what's actually universal
 * (`package.json`) plus evidence of a real framework scaffold, recognized across every
 * template family rather than assuming one.
 */

/** One recognized config/manifest filename per framework family Quick Build's starter templates cover. Matching ANY of these (not all) is sufficient — a project only ever uses one framework. */
const FRAMEWORK_CONFIG_FILES = [
  // Vite (React/TS/Vanilla/Shadcn, and also how Qwik/SolidJS/Vue-via-Vite scaffolds build)
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mjs',

  // Next.js
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',

  // Astro
  'astro.config.mjs',
  'astro.config.ts',
  'astro.config.js',

  // SvelteKit
  'svelte.config.js',
  'svelte.config.ts',

  // Angular
  'angular.json',

  // Remix
  'remix.config.js',
  'remix.config.ts',

  // Expo
  'app.json',
  'app.config.js',
  'app.config.ts',

  // Qwik (when not Vite-based)
  'qwik.config.ts',
];

export interface RequiredFilesResult {
  ok: boolean;

  /** Human-readable reasons, not raw filenames — the failure UI shouldn't need to explain the underlying heuristic. */
  missing: string[];
}

/**
 * `paths` are project-relative (no WORK_DIR prefix — see quickBuildOrchestrator.ts's
 * buildGeneratedProjectFromWorkbench()). Never throws.
 *
 * Two checks, both intentionally lenient:
 *  1. `package.json` must exist — true for every one of Quick Build's templates, no
 *     exceptions, so this alone is safe to enforce strictly.
 *  2. EITHER a recognized framework config file exists, OR the project has more than a
 *     trivial handful of files. The second branch exists so an unrecognized/future template
 *     (this list can't enumerate every framework Quick Build might ever support) never gets
 *     falsely failed just because its config filename isn't in FRAMEWORK_CONFIG_FILES — a
 *     real scaffold with real generated content passes either way; only a near-empty
 *     workspace (a handful of files, no recognizable framework marker) fails.
 */
export function verifyRequiredFiles(paths: string[]): RequiredFilesResult {
  const missing: string[] = [];

  const hasPackageJson = paths.some((path) => path.endsWith('package.json'));

  if (!hasPackageJson) {
    missing.push('package.json');
  }

  const hasRecognizedFrameworkConfig = paths.some((path) =>
    FRAMEWORK_CONFIG_FILES.some((filename) => path.endsWith(filename)),
  );
  const hasSubstantialScaffold = paths.length >= 4;

  if (!hasRecognizedFrameworkConfig && !hasSubstantialScaffold) {
    missing.push('a recognizable framework scaffold (only a handful of files were written)');
  }

  return { ok: missing.length === 0, missing };
}
