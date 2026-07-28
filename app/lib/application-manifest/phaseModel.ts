import type { BackendModulePlan } from '~/lib/backend-generation/backendModuleTypes';
import type { ManifestFileCategory, ManifestFileSourceKind, ManifestFileStatus } from './manifestTypes';

/**
 * Progressive Phase Model — Sprint 99B (Progressive Phase Runner).
 *
 * The whole of Sprint 99's phase concept, expressed as PURE FUNCTIONS over data the manifest
 * already holds. Deliberately dependency-free (types only — no repository, no BuildersDB, no AI
 * call, no store) for three reasons the sprint states outright:
 *
 *  1. **No new schema.** A file's phase is DERIVED from its `category`/`path`/`featureIds` plus the
 *     already-resolved `BackendModulePlan` list; nothing is stored, so there is no column to
 *     migrate, no phase table to keep consistent, and no backfill for existing manifests.
 *  2. **No AI call to compute structure.** Classification is keyword/path matching over data
 *     `resolveBackendModules`/`buildGenerationPlan` already produced.
 *  3. **One source of truth.** `generationPipeline.ts` orders its own generation units with the
 *     SAME `phaseForFile` the manifest side uses to decide which rows to activate — if the two
 *     had separate copies of this rule they would drift, which is exactly the failure mode this
 *     codebase's existing `backendModuleFilePaths` comment already guards against.
 *
 * Phase COMPLETION is derived too (`derivePhaseStates`) — from `ManifestFileStatus` alone. No
 * phase state is persisted anywhere.
 */

export type GenerationPhase = 1 | 2 | 3 | 4 | 5 | 6;

export interface GenerationPhaseDefinition {
  phase: GenerationPhase;
  id: string;
  name: string;
}

/** The approved six-phase model (see docs/03-Architecture/Sprint-99-Progressive-Application-Generation.md §3). */
export const GENERATION_PHASES: readonly GenerationPhaseDefinition[] = [
  { phase: 1, id: 'preview-foundation', name: 'Preview Foundation' },
  { phase: 2, id: 'public-journey', name: 'Public Journey' },
  { phase: 3, id: 'backend', name: 'Backend' },
  { phase: 4, id: 'payments', name: 'Payments' },
  { phase: 5, id: 'admin', name: 'Admin' },
  { phase: 6, id: 'integration', name: 'Integration' },
] as const;

export const GENERATION_PHASE_NUMBERS: readonly GenerationPhase[] = GENERATION_PHASES.map((entry) => entry.phase);

export function describePhase(phase: GenerationPhase): GenerationPhaseDefinition {
  return GENERATION_PHASES[phase - 1];
}

/**
 * The minimum a file has to expose to be classified — satisfied by `ApplicationManifestFile`,
 * `ApplicationManifestFileDraft`, and by a planned-but-not-yet-persisted path the pipeline knows
 * before any AI call (which is how `generationPipeline.ts` orders its units without ever reading
 * the manifest).
 */
export interface PhaseAssignableFile {
  path: string;
  category: ManifestFileCategory;
  componentName?: string;
  displayName?: string;
  featureIds?: string[];
  sourceKind?: ManifestFileSourceKind;
}

export interface PhaseAssignmentContext {
  /** Sprint 79's already-resolved module plans — the ONLY extra signal classification uses, and it is optional: an unmatched backend module defaults to Phase 3 (this sprint's explicit rule). */
  backendModules?: BackendModulePlan[];
}

/*
 * Matched as whole TOKENS, never substrings — "company" must not match "pay", and "administration"
 * must not be reached by matching "admin" inside an unrelated word. Tokens come from
 * `tokenize` below (lowercase, split on every non-alphanumeric run, camelCase boundaries split).
 */
const PAYMENT_TOKENS = new Set([
  'payment',
  'payments',
  'pay',
  'pays',
  'paid',
  'payout',
  'payouts',
  'checkout',
  'billing',
  'invoice',
  'invoices',
  'subscription',
  'subscriptions',
  'refund',
  'refunds',
  'stripe',
  'razorpay',
  'paypal',
]);

const ADMIN_TOKENS = new Set(['admin', 'admins', 'administrator', 'administrators', 'administration', 'backoffice']);

function tokenize(...values: (string | undefined)[]): Set<string> {
  const tokens = new Set<string>();

  for (const value of values) {
    if (!value) {
      continue;
    }

    for (const token of value
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)) {
      if (token.length > 0) {
        tokens.add(token);
      }
    }
  }

  return tokens;
}

function hasAny(tokens: Set<string>, candidates: Set<string>): boolean {
  for (const token of tokens) {
    if (candidates.has(token)) {
      return true;
    }
  }

  return false;
}

/**
 * `src/features/<slug>/…` and `api/<slug>/…` are the only two shapes a Backend Module file ever
 * takes (`backendModuleFilePaths`) — this is the inverse of that function, so the two stay in step.
 */
export function backendModuleSlugForPath(path: string): string | undefined {
  const feature = /^src\/features\/([^/]+)\//.exec(path);

  if (feature) {
    return feature[1];
  }

  const api = /^api\/([^/]+)\//.exec(path);

  return api ? api[1] : undefined;
}

/**
 * Classifies ONE backend module.
 *
 * `apiEndpoints` on a `BackendModulePlan` is, by that type's own documented limitation, the WHOLE
 * project's endpoint list rather than the module's own — matching it unfiltered would classify
 * every module in a project that happens to sell anything as Payments. So only endpoints that
 * actually name this module contribute (`POST /api/orders/:id/pay` under slug `orders` → payments);
 * everything else is ignored. Nothing matched ⇒ Phase 3, the sprint's explicit default.
 */
function phaseForBackendModule(slug: string, featureIds: string[], plan?: BackendModulePlan): GenerationPhase {
  const relevantEndpoints = (plan?.apiEndpoints ?? []).filter((endpoint) => tokenize(endpoint).has(slug.toLowerCase()));
  const tokens = tokenize(slug, ...featureIds, ...(plan?.featureIds ?? []), ...relevantEndpoints);

  if (hasAny(tokens, PAYMENT_TOKENS)) {
    return 4;
  }

  if (hasAny(tokens, ADMIN_TOKENS)) {
    return 5;
  }

  return 3;
}

/**
 * The sprint's headline requirement: deterministic, pure, no AI call, no database lookup.
 *
 * | Phase | Rule |
 * |---|---|
 * | 1 Preview Foundation | `entry` / `config` / `styles` / `components` — the shell that has to exist before anything renders |
 * | 2 Public Journey | `pages` on a non-admin route, plus the shared `types`/`services` those pages import |
 * | 3 Backend | `backend` files whose module is neither payment- nor admin-owned (**the default**) |
 * | 4 Payments | `backend` files whose module matches a payment token |
 * | 5 Admin | `pages` on an admin route, and `backend` files whose module matches an admin token |
 * | 6 Integration | `documentation` and anything uncategorised (`other`) — the wiring/QA tail |
 */
export function phaseForFile(file: PhaseAssignableFile, context: PhaseAssignmentContext = {}): GenerationPhase {
  switch (file.category) {
    case 'entry':
    case 'config':
    case 'styles':
    case 'components':
      return 1;

    case 'types':
    case 'services':
      return 2;

    case 'pages': {
      const tokens = tokenize(file.path, file.componentName, file.displayName);
      return hasAny(tokens, ADMIN_TOKENS) ? 5 : 2;
    }

    case 'backend': {
      const slug = backendModuleSlugForPath(file.path);

      if (!slug) {
        // A backend file outside both module path shapes — unmatched, so the documented default.
        return 3;
      }

      const plan = (context.backendModules ?? []).find((module) => module.moduleSlug === slug);

      return phaseForBackendModule(slug, file.featureIds ?? [], plan);
    }

    case 'documentation':
    case 'other':
    default:
      return 6;
  }
}

/**
 * Sprint 99C — the category of a file known only by its PATH.
 *
 * Resume reconstructs a workspace from stored content (`reconstructFilesFromManifest`, or the
 * Sprint 38.5 whole-project snapshot for a project that predates the manifest), and neither carries
 * a category. Every path this returns a non-`'other'` answer for is a path THIS codebase itself
 * generates — `manifestBuilder.ts`'s `buildFileDrafts` and `projectScaffolder.ts` are the only two
 * producers — so this is a lookup of our own layout, not a guess about arbitrary code.
 */
export function categoryForPath(path: string): ManifestFileCategory {
  if (path === 'src/main.tsx' || path === 'src/App.tsx') {
    return 'entry';
  }

  if (path.startsWith('src/pages/')) {
    return 'pages';
  }

  if (path.startsWith('src/components/')) {
    return 'components';
  }

  if (path.startsWith('src/types/')) {
    return 'types';
  }

  if (path.startsWith('src/services/')) {
    return 'services';
  }

  if (path.startsWith('src/features/') || path.startsWith('api/')) {
    return 'backend';
  }

  if (path.endsWith('.css')) {
    return 'styles';
  }

  if (path.endsWith('.md')) {
    return 'documentation';
  }

  if (!path.includes('/')) {
    // Root-level files this scaffold produces: package.json, vite.config.ts, tsconfig*.json, index.html, .env.example.
    return 'config';
  }

  return 'other';
}

/** Convenience for callers that hold only a path — see `categoryForPath` for why that is a sound input. */
export function phaseForPath(path: string, context: PhaseAssignmentContext = {}): GenerationPhase {
  return phaseForFile({ path, category: categoryForPath(path) }, context);
}

export type PhaseStatus = 'completed' | 'active' | 'pending' | 'failed' | 'skipped';

export interface PhaseFileForState {
  id?: string;
  path: string;
  category: ManifestFileCategory;
  componentName?: string;
  displayName?: string;
  featureIds?: string[];
  sourceKind?: ManifestFileSourceKind;
  status: ManifestFileStatus;
}

export interface PhaseState extends GenerationPhaseDefinition {
  status: PhaseStatus;

  /** Every file assigned to this phase, scaffold included. */
  total: number;

  /** Files whose status this phase's completion is actually derived from — see `isPhaseBlocking`. */
  blocking: number;
  completed: number;
  failed: number;

  /** Blocking files still `queued` (not yet activated). */
  queued: number;

  /** Blocking files activated but not finished (`pending`/`generating`/`validating`/`repairing`). */
  inFlight: number;
}

/** `superseded` belongs to an older manifest version — never part of any phase's arithmetic. */
const EXCLUDED_STATUSES = new Set<ManifestFileStatus>(['superseded']);

/** Resume already trusts these three (`isReusableGeneratedStatus`); `skipped` means intentionally not generated. */
const DONE_STATUSES = new Set<ManifestFileStatus>(['generated', 'validated', 'complete', 'skipped']);

const IN_FLIGHT_STATUSES = new Set<ManifestFileStatus>(['pending', 'generating', 'validating', 'repairing']);

/**
 * A deterministic scaffold file (package.json, index.html, README.md …) is written by
 * `projectScaffolder.ts` during ASSEMBLY — after every AI phase has run — so it can never reach a
 * finished status while its own phase is executing. Letting one gate its phase would deadlock the
 * runner: Phase 1 could never complete, so Phase 2 could never activate. Scaffold files are still
 * assigned to (and activated with) their phase; they simply do not decide its completion.
 */
export function isPhaseBlocking(file: Pick<PhaseFileForState, 'sourceKind'>): boolean {
  return file.sourceKind !== 'scaffold';
}

/**
 * Derived phase completion — no phase table, no stored phase state (the sprint's explicit
 * constraint). Every value here is recomputed from `ManifestFileStatus`, which is why resume needs
 * to load nothing but the manifest's own file rows.
 *
 *  - `skipped`   — the phase contains zero files (a project with no payments simply has none).
 *  - `active`    — the lowest unfinished phase, and at least one of its files has been activated.
 *  - `pending`   — unfinished, but every file is still `queued` (or a later phase entirely).
 *  - `failed`    — nothing left to do and something failed.
 *  - `completed` — every blocking file reached a finished status.
 *
 * At most ONE phase is ever `active`: a later phase that somehow has in-flight files while an
 * earlier one is unfinished is reported `pending`, so the invariant holds by construction.
 */
export function derivePhaseStates(files: PhaseFileForState[], context: PhaseAssignmentContext = {}): PhaseState[] {
  const considered = files.filter((file) => !EXCLUDED_STATUSES.has(file.status));
  const byPhase = new Map<GenerationPhase, PhaseFileForState[]>();

  for (const phase of GENERATION_PHASE_NUMBERS) {
    byPhase.set(phase, []);
  }

  for (const file of considered) {
    byPhase.get(phaseForFile(file, context))?.push(file);
  }

  const states: PhaseState[] = GENERATION_PHASES.map((definition) => {
    const phaseFiles = byPhase.get(definition.phase) ?? [];
    const blockingFiles = phaseFiles.filter(isPhaseBlocking);
    const queued = blockingFiles.filter((file) => file.status === 'queued').length;
    const inFlight = blockingFiles.filter((file) => IN_FLIGHT_STATUSES.has(file.status)).length;
    const completed = blockingFiles.filter((file) => DONE_STATUSES.has(file.status)).length;
    const failed = blockingFiles.filter((file) => file.status === 'failed').length;

    let status: PhaseStatus;

    if (phaseFiles.length === 0) {
      status = 'skipped';
    } else if (queued + inFlight > 0) {
      status = inFlight > 0 ? 'active' : 'pending';
    } else if (failed > 0) {
      status = 'failed';
    } else {
      /*
       * Includes the "only scaffold files" case (no blocking files at all): those are deterministic
       * template output, so there is nothing for this phase to wait on.
       */
      status = 'completed';
    }

    return {
      ...definition,
      status,
      total: phaseFiles.length,
      blocking: blockingFiles.length,
      completed,
      failed,
      queued,
      inFlight,
    };
  });

  // Single-active invariant: only the LOWEST candidate keeps 'active'.
  let seenActive = false;

  for (const state of states) {
    if (state.status !== 'active') {
      continue;
    }

    if (seenActive) {
      state.status = 'pending';
    } else {
      seenActive = true;
    }
  }

  return states;
}

/** The lowest phase that is neither `completed` nor `skipped` — where a resumed run picks up. Undefined when every phase is finished. */
export function resolveActivePhase(
  files: PhaseFileForState[],
  context: PhaseAssignmentContext = {},
): GenerationPhase | undefined {
  return derivePhaseStates(files, context).find((state) => state.status !== 'completed' && state.status !== 'skipped')
    ?.phase;
}

export function isPhaseComplete(
  files: PhaseFileForState[],
  phase: GenerationPhase,
  context: PhaseAssignmentContext = {},
): boolean {
  const state = derivePhaseStates(files, context)[phase - 1];
  return state.status === 'completed' || state.status === 'skipped';
}

export interface PhaseActivation {
  phase: GenerationPhase;

  /** Every file in the phase, whatever its status — the caller reports on these. */
  files: PhaseFileForState[];

  /** The subset to promote `queued` → `pending`. Empty for a legacy manifest (already `pending`) — which is exactly why legacy manifests need no migration. */
  activateFileIds: string[];

  /** True when the phase is already finished and must NOT be re-entered (the Round 2 regression: completed work regenerated). */
  alreadyComplete: boolean;
}

/**
 * What activating `phase` means in terms of rows: promote its `queued` files to `pending`, leave
 * everything else exactly as it is. A file already `pending` (every file of every pre-Sprint-99B
 * manifest) is untouched, so replaying this against a legacy manifest is a no-op.
 */
export function resolvePhaseActivation(
  files: PhaseFileForState[],
  phase: GenerationPhase,
  context: PhaseAssignmentContext = {},
): PhaseActivation {
  const phaseFiles = files.filter(
    (file) => !EXCLUDED_STATUSES.has(file.status) && phaseForFile(file, context) === phase,
  );

  return {
    phase,
    files: phaseFiles,
    activateFileIds: phaseFiles.filter((file) => file.status === 'queued' && file.id).map((file) => file.id as string),
    alreadyComplete: isPhaseComplete(files, phase, context),
  };
}

export interface PhaseResumePlan {
  /** Where generation resumes — undefined when nothing is left to do. */
  activePhase?: GenerationPhase;
  phases: PhaseState[];
  completedPhases: GenerationPhase[];
  skippedPhases: GenerationPhase[];

  /** Files in the active phase to (re)generate — `queued`/`pending`/`failed`, plus interrupted `generating`/`repairing` (what `classifyResumeAction` already calls 'generate'). */
  regeneratePaths: string[];

  /** Files anywhere in the manifest whose content the existing checksum/carry-forward path reuses without an AI call. */
  reusablePaths: string[];
}

/** Resume Rules for the phase runner: reuse `generated`/`validated`/`complete` everywhere, regenerate only the ACTIVE phase's unfinished files, never re-enter a completed phase. */
export function resolvePhaseResumePlan(
  files: PhaseFileForState[],
  context: PhaseAssignmentContext = {},
): PhaseResumePlan {
  const phases = derivePhaseStates(files, context);
  const activePhase = phases.find((state) => state.status !== 'completed' && state.status !== 'skipped')?.phase;
  const considered = files.filter((file) => !EXCLUDED_STATUSES.has(file.status));

  return {
    activePhase,
    phases,
    completedPhases: phases.filter((state) => state.status === 'completed').map((state) => state.phase),
    skippedPhases: phases.filter((state) => state.status === 'skipped').map((state) => state.phase),
    regeneratePaths:
      activePhase === undefined
        ? []
        : considered
            .filter(
              (file) =>
                phaseForFile(file, context) === activePhase && isPhaseBlocking(file) && !DONE_STATUSES.has(file.status),
            )
            .map((file) => file.path),
    reusablePaths: considered
      .filter((file) => file.status === 'generated' || file.status === 'validated' || file.status === 'complete')
      .map((file) => file.path),
  };
}
