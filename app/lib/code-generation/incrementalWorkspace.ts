import { fnv1aHash } from '~/lib/checksum/fnv1a';
import type { GeneratedFile, GenerationPlanPage } from './codeGenerationTypes';

/**
 * Incremental Workspace & Preview Lifecycle — Sprint 99C (Early Preview).
 *
 * The DECISIONS behind progressive workspace updates, kept as pure functions so they can be
 * unit-tested without a WebContainer: what to write, whether to reinstall, and what state the
 * preview is in. `webcontainerWriter.ts` keeps doing the actual I/O and owns the session state
 * these functions operate on; nothing here touches the WebContainer, a store, or the network.
 *
 * The single behavioural claim this sprint makes — "preview availability is decoupled from
 * generation completion" — is expressed here as a state machine (`nextPreviewState`) in which
 * NO event that can originate from a later phase's failure can take an available preview back to
 * unavailable.
 */

/** Path → checksum of the content most recently written to the workspace during this session. */
export type WorkspaceWriteLedger = Map<string, string>;

export interface IncrementalWritePlan {
  /** Files whose content differs from what this session last wrote (or that were never written). */
  toWrite: GeneratedFile[];

  /** Paths skipped because the identical content is already on disk — how "no duplicate writes" is enforced. */
  skipped: string[];
}

/**
 * A phase's write is a DELTA: only files whose content actually changed since this session last
 * wrote them reach the WebContainer. This is what keeps the whole-project write at the end of a
 * run from re-writing all ~130 files that the phase writes already placed, and what stops a
 * repair-loop retry from rewriting files its patch did not touch.
 *
 * Duplicate paths WITHIN one call are collapsed to the last occurrence (the same rule
 * `runGenerationPipeline`'s own `filesByPath` assembly map already applies), so a caller passing
 * both a placeholder and its real replacement in one batch writes only the replacement.
 */
export function planIncrementalWrite(ledger: WorkspaceWriteLedger, files: GeneratedFile[]): IncrementalWritePlan {
  const byPath = new Map<string, GeneratedFile>();

  for (const file of files) {
    byPath.set(file.path, file);
  }

  const toWrite: GeneratedFile[] = [];
  const skipped: string[] = [];

  for (const file of byPath.values()) {
    if (ledger.get(file.path) === fnv1aHash(file.content)) {
      skipped.push(file.path);
      continue;
    }

    toWrite.push(file);
  }

  return { toWrite, skipped };
}

export function recordWrites(ledger: WorkspaceWriteLedger, files: GeneratedFile[]): void {
  for (const file of files) {
    ledger.set(file.path, fnv1aHash(file.content));
  }
}

export type InstallDecisionReason = 'first-install' | 'package-json-changed' | 'unchanged' | 'no-package-json';

export interface InstallDecision {
  install: boolean;
  reason: InstallDecisionReason;
  checksum?: string;
}

/**
 * `npm install` runs ONCE per session — after Phase 1 — and again only if `package.json` genuinely
 * changed afterwards (a later phase introducing a new dependency, e.g. a backend module pulling in
 * `@supabase/supabase-js`). Compared by checksum, never by "a later phase ran", because the
 * scaffold is regenerated on every phase write and is usually byte-identical.
 *
 * This is not a micro-optimisation: Sprint 44's own install-hang investigation traced a five-minute
 * stall to a SECOND installer running against the same WebContainer. One install per changed
 * `package.json` is a correctness property here, not just a speed one.
 */
export function decideInstall(previousChecksum: string | undefined, packageJson: string | undefined): InstallDecision {
  if (packageJson === undefined) {
    /* Nothing to compare — the caller has no scaffold yet, so it cannot know whether an install is needed. */
    return {
      install: previousChecksum === undefined,
      reason: previousChecksum === undefined ? 'first-install' : 'no-package-json',
    };
  }

  const checksum = fnv1aHash(packageJson);

  if (previousChecksum === undefined) {
    return { install: true, reason: 'first-install', checksum };
  }

  if (previousChecksum !== checksum) {
    return { install: true, reason: 'package-json-changed', checksum };
  }

  return { install: false, reason: 'unchanged', checksum };
}

/**
 * The preview lifecycle from the design (§6), as an explicit machine rather than a set of scattered
 * booleans:
 *
 * ```
 * not-available → booting → preview-ready → updating → ready → generation-complete
 * ```
 *
 * `preview-ready` and `ready` are the same capability (the app is being served); they are kept
 * distinct only so the UI can say "Preview Ready" once and "Ready" on every subsequent settle.
 */
export type PreviewLifecycleState =
  | 'not-available'
  | 'booting'
  | 'preview-ready'
  | 'updating'
  | 'ready'
  | 'generation-complete';

/**
 * What can happen to a preview during a run:
 *
 *  - `phase-one-written`    — Phase 1's files (generated + scaffold + shells) reached the workspace.
 *  - `dev-server-ready`     — the WebContainer reported a served port; this is the moment preview
 *                             availability stops depending on generation completion.
 *  - `boot-failed`          — install or boot failed before a preview ever existed.
 *  - `phase-written`        — a later phase's files were written into a running workspace.
 *  - `phase-settled`        — HMR (or the reload fallback) settled after that write.
 *  - `phase-failed`         — a later phase failed. Deliberately NOT destructive.
 *  - `generation-complete`  — the run finished.
 */
export type PreviewLifecycleEvent =
  | 'phase-one-written'
  | 'dev-server-ready'
  | 'boot-failed'
  | 'phase-written'
  | 'phase-settled'
  | 'phase-failed'
  | 'generation-complete';

/** States in which the application is actually being served, so the Preview tab is usable. */
const AVAILABLE_STATES = new Set<PreviewLifecycleState>(['preview-ready', 'updating', 'ready', 'generation-complete']);

export function isPreviewAvailable(state: PreviewLifecycleState): boolean {
  return AVAILABLE_STATES.has(state);
}

/**
 * The transition table. One guarantee matters above all the others and is asserted by its own test:
 * **no event reachable from a later phase — `phase-failed` included — moves an available preview
 * back to an unavailable state.** A failure in Phase 3 degrades that feature; it does not take the
 * customer's working preview away.
 */
export function nextPreviewState(current: PreviewLifecycleState, event: PreviewLifecycleEvent): PreviewLifecycleState {
  switch (event) {
    case 'phase-one-written':
      return isPreviewAvailable(current) ? current : 'booting';

    case 'dev-server-ready':
      return isPreviewAvailable(current) ? 'ready' : 'preview-ready';

    case 'boot-failed':
      // Only meaningful before a preview exists; a running preview is never torn down by a late boot error.
      return isPreviewAvailable(current) ? current : 'not-available';

    case 'phase-written':
      return isPreviewAvailable(current) ? 'updating' : current;

    case 'phase-settled':
      return isPreviewAvailable(current) ? 'ready' : current;

    case 'phase-failed':
      /* The whole point of the sprint: a later phase failing leaves the preview exactly as it was. */
      return current;

    case 'generation-complete':
      return isPreviewAvailable(current) ? 'generation-complete' : current;

    default:
      return current;
  }
}

/** The banner the design specifies for the window between Phase 1 and the end of the run. */
export const PREVIEW_READY_BANNER = 'Preview Ready — Builders is continuing generation.';

export function describePreviewState(state: PreviewLifecycleState): string {
  switch (state) {
    case 'booting':
      return 'Starting the preview…';
    case 'preview-ready':
    case 'ready':
      return PREVIEW_READY_BANNER;
    case 'updating':
      return 'Preview updating — Builders is continuing generation.';
    case 'generation-complete':
      return 'Preview ready — generation complete.';
    case 'not-available':
    default:
      return 'Preview is not available yet.';
  }
}

/**
 * Phase 1 boots a workspace whose `App.tsx` already routes to EVERY planned page — including the
 * pages Phases 2 and 5 have not generated yet. Vite cannot resolve those imports, so without this
 * the "early" preview would be a module-resolution error screen, which is worse than no preview
 * (design risk R3).
 *
 * A shell is a real, valid module at the planned path that renders a placeholder. It is
 * workspace-only: it is never persisted to the manifest, never versioned, never counted as a
 * generated file, and is overwritten by the real page the moment its phase produces it (the
 * incremental write sees different content, so the overwrite always happens).
 *
 * `existingPaths` is what has genuinely been generated already — a shell is never written over
 * real content.
 */
export function buildPreviewShellFiles(pages: GenerationPlanPage[], existingPaths: Iterable<string>): GeneratedFile[] {
  const existing = new Set(existingPaths);

  return pages
    .map((page) => ({ page, path: `src/pages/${page.fileName}` }))
    .filter((entry) => !existing.has(entry.path))
    .map(({ page, path }) => ({
      path,
      content: [
        `/* Placeholder for ${page.name} — Builders is still generating this page. */`,
        `export default function ${page.componentName}() {`,
        '  return (',
        '    <main style={{ padding: "3rem 1.5rem", textAlign: "center", fontFamily: "system-ui, sans-serif" }}>',
        `      <h1 style={{ fontSize: "1.25rem", margin: 0 }}>${page.name}</h1>`,
        '      <p style={{ opacity: 0.7, marginTop: "0.5rem" }}>This page is still being generated.</p>',
        '    </main>',
        '  );',
        '}',
        '',
      ].join('\n'),
    }));
}
