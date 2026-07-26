import { getProjectArtifacts, type Project } from '~/lib/stores/projects';
import { parseArtifactContent } from '~/lib/projects/artifacts';
import { extractJsonPayload, looksTruncated } from '~/lib/projects/draftParsing';
import { generateRoleWithRecovery } from '~/lib/projects/roleGenerationRecovery';
import type { RequirementsDraft } from '~/lib/projects/prompts/requirements';
import type { DatabaseDraft } from '~/lib/projects/prompts/database';
import type { BackendDraft } from '~/lib/projects/prompts/backend';
import type { FrontendDraft } from '~/lib/projects/prompts/frontend';
import type { ProductAssemblySection, ProductPackage } from '~/lib/product-assembly/assemblyTypes';
import {
  buildBackendModulePrompt,
  buildPagePrompt,
  buildServicesPrompt,
  buildSharedComponentsPrompt,
  buildSharedTypesPrompt,
  BACKEND_GENERATION_SYSTEM_PROMPT,
  CODE_GENERATION_SYSTEM_PROMPT,
} from './prompts';
import { REACT_VITE_TS_TEMPLATE_ID, resolveTemplate } from './templateResolver';
import { scaffoldReactViteProject } from './projectScaffolder';
import { resolveRequiredDependencies } from './dependencyValidation';
import { validateBuildReadiness } from './generationValidator';
import { fnv1aHash } from '~/lib/checksum/fnv1a';
import { backendModuleFilePathList, backendModuleFilePaths } from '~/lib/backend-generation/backendModuleTypes';
import type { BackendModulePlan } from '~/lib/backend-generation/backendModuleTypes';
import type {
  GenerateFn,
  GeneratedFile,
  GeneratedProject,
  GenerationIssue,
  GenerationPlan,
  GenerationPlanPage,
  GenerationPlanScope,
  GenerationResult,
  GenerationStage,
  OnGenerationProgress,
} from './codeGenerationTypes';

/**
 * Generation Pipeline — Sprint 38.
 *
 *   Product Package (Sprint 37)
 *     -> Planning (deterministic — page list/route map/component list already exist as
 *        structured data in the Frontend/Requirements drafts; re-deriving them via a
 *        fresh AI call would risk drifting from what those roles actually specified)
 *       -> Generate shared types (AI call)
 *         -> Generate services (AI call)
 *           -> Generate each page (one AI call per page)
 *             -> Generate shared components (one batched AI call)
 *               -> Validate (deterministic)
 *                 -> Assemble (merge with projectScaffolder.ts's deterministic template
 *                    files into one GeneratedProject)
 *
 * "The Product Package should become the source of truth" (this sprint's own framing)
 * is honored by resolving each stage's input from the EXACT artifact version the
 * Product Package (Sprint 37) already decided was authoritative for that role
 * (`ProductPackageFile.sourceArtifactId` — itself following Sprint 36's
 * approved-else-latest-draft priority) — never by re-deriving from the raw project
 * description or a fresh, ungrounded prompt. The Product Package file's own `content`
 * is Markdown (already reformatted for human reading — see
 * app/lib/product-assembly/productAssembler.ts) rather than the original structured
 * JSON a planner/prompt builder needs, so this file reads the ORIGINAL artifact behind
 * that same `sourceArtifactId` instead of re-parsing prose.
 *
 * No AI call here ever writes to the filesystem or the WebContainer — this module
 * returns a `GenerationResult` (in-memory only); see webcontainerWriter.ts for the next
 * step. A failure at any stage before "assembling" therefore can't have touched
 * anything real yet, which is what keeps a failed generation from disturbing whatever
 * project was already running (see the sprint's "Error Handling" requirement).
 */

const CODE_GENERATION_MAX_OUTPUT_TOKENS = 8192;

interface ResolvedDrafts {
  requirements?: RequirementsDraft;
  database?: DatabaseDraft;
  backend?: BackendDraft;
  frontend?: FrontendDraft;
}

function dedupePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const trimmed = item.trim();

    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }

  return result;
}

/** Reads the structured draft behind one Product Package section's currently-authoritative artifact — see this file's header comment for why. */
function resolveDraftsFromPackage(project: Project, productPackage: ProductPackage): ResolvedDrafts {
  const artifacts = getProjectArtifacts(project);
  const bySection = new Map(productPackage.sections.map((section) => [section.id, section.files[0]]));

  function draftFor<T>(section: ProductAssemblySection): T | undefined {
    const artifactId = bySection.get(section)?.sourceArtifactId;

    if (!artifactId) {
      return undefined;
    }

    const artifact = artifacts.find((candidate) => candidate.id === artifactId);

    return artifact ? parseArtifactContent<T>(artifact.content) : undefined;
  }

  return {
    requirements: draftFor<RequirementsDraft>('requirements'),
    database: draftFor<DatabaseDraft>('database'),
    backend: draftFor<BackendDraft>('backend'),
    frontend: draftFor<FrontendDraft>('frontend'),
  };
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug.length > 0 ? slug : 'page';
}

/**
 * Acceptance-test-verified fix: a legitimate page name is a short title ("Home", "Product
 * Details"), but an AI-produced `pageHierarchy`/`pages` entry can occasionally be a full,
 * comma-heavy DESCRIPTION instead (e.g. "Search Results: Query display, filter controls,
 * product grid, no-results state") — every word of which used to get PascalCased into one
 * giant, unwieldy component/file name (observed live: a 74-character name). That alone isn't
 * fatal, but if the SAME description also appears as (or overlaps with) another page's name,
 * the two can resolve to component names divergent from what a later validation/review pass
 * expects, surfacing as "src/App.tsx imports X but no matching generated file exists." Capping
 * both word count and character length keeps every generated name short and bounded,
 * regardless of how verbose the upstream AI role's page name turns out to be.
 */
const MAX_COMPONENT_NAME_WORDS = 6;
const MAX_COMPONENT_NAME_LENGTH = 60;

/**
 * Assembly Auto-Repair — the previous version capped word count first (max 6), then took a
 * raw character slice of the joined PascalCase string (max 60 chars) as a second pass. That
 * character slice cuts mid-word whenever 6 words' worth of PascalCase text exceeds 60
 * characters — this is exactly how a real generation produced "...ProductGPage" (truncated
 * out of "...ProductGridPage"): a syntactically valid but unreadable, collision-prone
 * identifier fragment. Building the name word-by-word and stopping BEFORE the word that would
 * cross the character budget guarantees every generated name ends on a whole word.
 */
function toComponentName(name: string): string {
  const words = name
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_COMPONENT_NAME_WORDS)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));

  const suffixBudget = MAX_COMPONENT_NAME_LENGTH - 'Page'.length;
  let pascal = '';

  for (const word of words) {
    if (pascal.length + word.length > suffixBudget) {
      /*
       * A whole extra word won't fit — for the very first word (nothing accumulated yet),
       * still take as much of it as fits rather than falling all the way back to "Home",
       * which would otherwise collapse every over-long single-word name to the same fallback.
       */
      if (pascal.length === 0) {
        pascal = word.slice(0, suffixBudget);
      }

      break;
    }

    pascal += word;
  }

  return `${pascal || 'Home'}Page`;
}

/**
 * The deterministic planning stage: builds the page list, route map, and component
 * list directly from the Frontend Engineer's own `pageHierarchy`/`sharedComponents`
 * (falling back to the Business Analyst's `pages` list, then a single "Home" page if
 * neither role has produced anything yet) — never a fresh AI call. The first page
 * always becomes the "/" route; every other route is a slug of its name, deduplicated
 * with a numeric suffix on collision (reported as a validation warning — see
 * validateGeneratedFiles below — even though planning itself never produces a
 * collision, per the sprint's explicit "duplicate routes" check).
 *
 * Sprint 48 — `scope` (optional) attaches the active MVP's identity and Engineering
 * Handoff boundary to the resulting plan (see `GenerationPlanScope`'s own comment). This
 * does NOT filter `pageHierarchy`/`entities`/`apiEndpoints` themselves — those already
 * come from drafts the Sprint 47 prompt-level scoping asked each engineering role to keep
 * in-scope, and there is no per-page/per-entity Feature ID tag in those drafts to filter
 * by structurally (a real limitation, not an oversight — see
 * docs/05-AI-Product-Owner/11-sprint-48-mvp-scoped-generation.md). What `scope` DOES do is
 * give every downstream consumer (the manifest, the resume orchestrator, activity
 * logging) a reliable, structural answer to "which MVP is this generation for" — see
 * manifestBuilder.ts's `buildApplicationManifest`.
 *
 * Sprint 79 Phase 1 — `backendModules` (optional, third param) is threaded straight onto the
 * returned plan's `backendModules`, exactly like `scope` above: resolved ASYNCHRONOUSLY by the
 * caller (useCodeGeneration.ts, via `deriveBackendModulePlans` against a live Feature-repository
 * query) before this synchronous function ever runs, never computed in here.
 */
export function buildGenerationPlan(
  drafts: ResolvedDrafts,
  scope?: GenerationPlanScope,
  backendModules?: BackendModulePlan[],
): GenerationPlan {
  const rawPageNames = dedupePreserveOrder([
    ...(drafts.frontend?.pageHierarchy ?? []),
    ...(drafts.requirements?.pages ?? []),
  ]);
  const pageNames = rawPageNames.length > 0 ? rawPageNames : ['Home'];

  const usedRoutes = new Set<string>();

  /*
   * Acceptance-test-verified fix: truncating long/verbose page names in toComponentName()
   * above means two DIFFERENT page names can now legitimately collapse to the same
   * (truncated) component name — the exact same class of collision `usedRoutes` below
   * already guards against for routes, so component names get the identical numeric-suffix
   * treatment, keeping every generated file path unique regardless of how the plan's page
   * names were derived.
   */
  const usedComponentNames = new Set<string>();
  const pages: GenerationPlanPage[] = pageNames.map((name, index) => {
    let componentName = toComponentName(name);
    let componentSuffix = 2;

    while (usedComponentNames.has(componentName)) {
      componentName = `${toComponentName(name).replace(/Page$/, '')}${componentSuffix}Page`;
      componentSuffix += 1;
    }

    usedComponentNames.add(componentName);

    let routePath = index === 0 ? '/' : `/${slugify(name)}`;
    let suffix = 2;

    while (usedRoutes.has(routePath)) {
      routePath = `/${slugify(name)}-${suffix}`;
      suffix += 1;
    }

    usedRoutes.add(routePath);

    return { name, componentName, routePath, fileName: `${componentName}.tsx` };
  });

  const sharedComponents = dedupePreserveOrder(drafts.frontend?.sharedComponents ?? []).slice(0, 6);
  const entities = dedupePreserveOrder(drafts.database?.entities ?? []);
  const apiEndpoints = dedupePreserveOrder(drafts.backend?.apiEndpoints ?? []);
  const resolvedSharedComponents = sharedComponents.length > 0 ? sharedComponents : ['Navbar', 'Footer'];

  return {
    pages,
    sharedComponents: resolvedSharedComponents,
    entities,
    apiEndpoints,
    backendModules,
    scope: {
      mvpId: scope?.mvpId,
      mvpCode: scope?.mvpCode,
      inScopeFeatureIds: scope?.inScopeFeatureIds ?? [],
      outOfScopeFeatureDescriptions: scope?.outOfScopeFeatureDescriptions ?? [],
    },
    fingerprints: {
      types: fnv1aHash(JSON.stringify({ entities: [...entities].sort() })),
      services: fnv1aHash(
        JSON.stringify({
          apiEndpoints: [...apiEndpoints].sort(),
          apiArchitecture: drafts.backend?.apiArchitecture ?? '',
        }),
      ),
      pages: fnv1aHash(
        JSON.stringify({
          businessVision: drafts.requirements?.businessVision ?? '',
          coreFeatures: [...(drafts.requirements?.coreFeatures ?? [])].sort(),
          uiuxNotes: drafts.frontend?.frontendOverview ?? '',
          pageNames: pageNames.slice().sort(),
        }),
      ),
      components: fnv1aHash(
        JSON.stringify({
          sharedComponents: [...resolvedSharedComponents].sort(),
          layoutStrategy: drafts.frontend?.layoutStrategy ?? '',
        }),
      ),
    },
  };
}

function parseGeneratedFilesResponse(
  rawText: string,
): { ok: true; files: GeneratedFile[] } | { ok: false; error: string } {
  const payload = extractJsonPayload(rawText);
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    /*
     * Acceptance-test-verified fix: distinguish a truncated response (hit the output-token
     * ceiling mid-JSON) from a genuinely malformed one, using the exact phrasing
     * generateRoleWithRecovery's isTruncationError() checks for (see
     * roleGenerationRecovery.ts) — so callForFiles() below can retry with a raised budget
     * instead of failing the whole generation on the very first truncated page/section.
     */
    if (looksTruncated(payload)) {
      return { ok: false, error: 'The AI response was cut off before completing valid JSON. Please regenerate.' };
    }

    return { ok: false, error: 'The AI response was not valid JSON.' };
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { files?: unknown }).files)) {
    return { ok: false, error: 'The AI response was missing a "files" array.' };
  }

  const files = ((parsed as { files: unknown[] }).files ?? [])
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({
      path: typeof entry.path === 'string' ? entry.path.trim() : '',
      content: typeof entry.content === 'string' ? entry.content : '',
    }))
    .filter((file) => file.path.length > 0);

  if (files.length === 0) {
    return { ok: false, error: 'The AI response contained no usable files.' };
  }

  return { ok: true, files };
}

/**
 * Acceptance-test-verified fix — this used to be a single-shot `generate()` call with no
 * retry, so any one stage's response landing on the wrong side of an 8192-token ceiling
 * (easy for a full page component with real UI/UX detail) failed the ENTIRE generation with
 * "The AI response was not valid JSON.", discarding every already-generated file. Now uses
 * the same bounded-retry mechanism (roleGenerationRecovery.ts) every AI-role engine already
 * uses: on a truncated/empty/invalid response it retries with a raised budget (up to 16000)
 * and a JSON-only + be-concise instruction, up to 2 additional attempts.
 */
async function callForFiles(
  prompt: string,
  generate: GenerateFn,
  projectId: string,
  roleKey: string,

  /** Sprint 79 Phase 1 — every existing call site omits this and keeps getting `CODE_GENERATION_SYSTEM_PROMPT` unchanged; only the new `'generating-backend'` stage passes `BACKEND_GENERATION_SYSTEM_PROMPT` (see that constant's own comment on why the frontend-only system prompt is actively wrong for backend code). */
  systemPrompt: string = CODE_GENERATION_SYSTEM_PROMPT,
): Promise<{ ok: true; files: GeneratedFile[] } | { ok: false; error: string }> {
  const outcome = await generateRoleWithRecovery({
    projectId,
    roleKey,
    system: systemPrompt,
    prompt,
    contextBlock: '',
    maxOutputTokens: CODE_GENERATION_MAX_OUTPUT_TOKENS,
    parseDraft: (rawText) => {
      const result = parseGeneratedFilesResponse(rawText);
      return result.ok ? { ok: true, draft: result.files } : { ok: false, error: result.error };
    },
    generate,
    baseOptions: {},
  });

  if (!outcome.ok) {
    return { ok: false, error: outcome.message };
  }

  return { ok: true, files: outcome.draft };
}

/**
 * Basic validation (requirement: "No need for a full compiler") — drops empty/
 * duplicate-path files rather than writing broken output, and reports missing pages,
 * duplicate routes, and a best-effort "possibly missing import" heuristic as warnings
 * that never block generation.
 */
function validateGeneratedFiles(
  files: GeneratedFile[],
  plan: GenerationPlan,
): { files: GeneratedFile[]; issues: GenerationIssue[] } {
  const issues: GenerationIssue[] = [];
  const seenPaths = new Set<string>();
  const deduped: GeneratedFile[] = [];

  for (const file of files) {
    if (file.content.trim().length === 0) {
      issues.push({
        severity: 'warning',
        stage: 'validating',
        message: `Empty file was dropped: ${file.path}`,
        filePath: file.path,
      });
      continue;
    }

    if (seenPaths.has(file.path)) {
      issues.push({
        severity: 'warning',
        stage: 'validating',
        message: `Duplicate file path was dropped: ${file.path}`,
        filePath: file.path,
      });
      continue;
    }

    seenPaths.add(file.path);
    deduped.push(file);
  }

  if (plan.pages.length === 0) {
    issues.push({ severity: 'error', stage: 'validating', message: 'No pages were planned.' });
  }

  const routeCounts = new Map<string, number>();

  for (const page of plan.pages) {
    routeCounts.set(page.routePath, (routeCounts.get(page.routePath) ?? 0) + 1);
  }

  for (const [route, count] of routeCounts) {
    if (count > 1) {
      issues.push({ severity: 'warning', stage: 'validating', message: `Duplicate route detected: ${route}` });
    }
  }

  for (const file of deduped) {
    if (!file.path.endsWith('.tsx')) {
      continue;
    }

    const importedNames = new Set(
      Array.from(file.content.matchAll(/import\s+(?:\{[^}]*\}|[A-Za-z0-9_]+)\s+from/g)).flatMap((match) =>
        Array.from(match[0].matchAll(/[A-Z][A-Za-z0-9_]*/g)).map((inner) => inner[0]),
      ),
    );
    const jsxTags = new Set(Array.from(file.content.matchAll(/<([A-Z][A-Za-z0-9]*)/g)).map((match) => match[1]));

    for (const tag of jsxTags) {
      const isLocallyDeclared = file.content.includes(`function ${tag}`) || file.content.includes(`const ${tag}`);

      if (!importedNames.has(tag) && !isLocallyDeclared) {
        issues.push({
          severity: 'warning',
          stage: 'validating',
          message: `Possible missing import for <${tag}> in ${file.path}`,
          filePath: file.path,
        });
      }
    }
  }

  return { files: deduped, issues };
}

function prefixSrc(files: GeneratedFile[], folder: string): GeneratedFile[] {
  return files.map((file) => ({
    ...file,
    path: file.path.startsWith('src/') ? file.path : `src/${folder}/${file.path.replace(/^\/+/, '')}`,
  }));
}

/**
 * Fired once, right after the deterministic plan is built and validated but BEFORE any
 * AI file-generation call runs (see this file's own header — planning is deterministic,
 * every stage after it is not) — Sprint 44.2's hook point for persisting the Application
 * Manifest (app/lib/application-manifest/) ahead of generation. Awaited: a caller that
 * needs the manifest durably persisted before any file's status can become "generating"
 * (Phase 1's own requirement) can rely on this resolving first. A thrown/rejected
 * callback is caught below and recorded as a warning issue, never as a pipeline
 * failure — Phase 1 is purely observational, so manifest persistence failing must not
 * stop generation the user is watching (see manifestBuilder.ts's own header comment).
 */
export type OnPlanReady = (plan: GenerationPlan) => Promise<void> | void;

/**
 * Sprint 44.2, Phase 2 — the pipeline's cue for incremental persistence, deliberately
 * role/path-scoped rather than manifest-aware: this module stays ignorant of
 * app/lib/application-manifest/ entirely (same decoupling `OnPlanReady` already
 * established), the CALLER (useCodeGeneration.ts) is the one that resolves a `role`/
 * `path` back to a `manifest_file_id` using the manifest it already built via
 * `OnPlanReady`.
 *
 *  - `onFilesStarting`: fired once right before the AI call for a stage begins — for
 *    types/services/one page, `path` is the single exact planned path; for the shared
 *    components batch, `path` is omitted (the caller marks every planned component still
 *    pending as 'generating' by role/category instead, since which of N possible names
 *    the AI will actually return isn't known yet).
 *  - `onFileReady`: fired once per file the AI ACTUALLY returned, immediately after that
 *    file passes the stage's existing basic checks — may be a path the caller doesn't
 *    recognize as planned (an extra file beyond what a prompt asked for), which is
 *    exactly requirement G's "unplanned file" case; the caller reconciles it rather than
 *    silently discarding it.
 *  - `onStageFailed`: fired when an entire stage's AI call fails outright (not
 *    per-file) — the caller marks every path that stage's own `onFilesStarting` covered
 *    as 'failed'.
 *
 * All three are optional and every call is wrapped the same way `onPlanReady` already
 * is: a thrown/rejected hook becomes a warning issue, never a pipeline failure — Phase 2
 * stays purely additive to the existing "never throws" contract.
 */
export interface FileLifecycleHooks {
  onFilesStarting?: (role: string, path?: string) => Promise<void> | void;
  onFileReady?: (file: GeneratedFile, role: string) => Promise<void> | void;
  onStageFailed?: (role: string, error: string, path?: string) => Promise<void> | void;
}

/**
 * Sprint 44.2, Phase 3 — resumable generation's actual AI-call-skipping mechanism.
 * Checked for `src/types/index.ts`, `src/services/api.ts`, and each page's canonical
 * `src/pages/<Component>.tsx` path (every one of these is a FIXED, deterministic path
 * the pipeline already knows before calling the AI — see prompts.ts's own "Generate
 * exactly one file, ..." instructions) — if it returns content, that stage's AI call is
 * skipped entirely and the returned content is used as-is via `onFileReady` (tagged with
 * a `-reused` role suffix so the caller can log/count it distinctly from a fresh
 * generation). Deliberately NOT applied to the shared-components batch: that stage's
 * planned paths are only fully known via manifestBuilder.ts's own PascalCase/collision
 * logic, which this module intentionally stays decoupled from (see `OnPlanReady`'s own
 * comment) — skipping only a SUBSET of one batched AI call isn't meaningfully cheaper
 * than making it, so Phase 3 keeps the components call atomic and always-regenerated.
 */
export interface ResumeHooks {
  getReusableContent?: (path: string) => Promise<string | undefined> | string | undefined;
}

/**
 * Runs the full pipeline for one project against its already-assembled Product
 * Package, reporting progress via `onProgress` as each stage starts. Always resolves
 * (never throws) — a stage failure becomes `{ ok: false, failedStage, issues }` rather
 * than an exception, so the caller (useCodeGeneration.ts) never needs its own top-level
 * try/catch around this call.
 */
export async function runGenerationPipeline(
  project: Project,
  productPackage: ProductPackage,
  generate: GenerateFn,
  onProgress: OnGenerationProgress,
  onPlanReady?: OnPlanReady,
  fileHooks?: FileLifecycleHooks,
  resumeHooks?: ResumeHooks,

  /** Sprint 48 — resolved by the caller (useCodeGeneration.ts) before this runs, since resolving it requires a BuildersDB call this pipeline deliberately never makes itself (see this file's header on staying provider/DB-agnostic). Omitted entirely for a legacy project — `buildGenerationPlan` degrades to an all-undefined/empty scope, matching pre-Sprint-48 behavior exactly. */
  mvpScope?: GenerationPlanScope,

  /** Sprint 79 Phase 1 — same "caller resolves async data, pipeline stays DB-agnostic" discipline as `mvpScope` immediately above. Omitted entirely for a project with no Backend Modules planned yet — the `'generating-backend'` stage below is then simply never reached. */
  backendModules?: BackendModulePlan[],
): Promise<GenerationResult> {
  const issues: GenerationIssue[] = [];

  async function safeInvoke<T extends unknown[]>(
    hook: ((...args: T) => Promise<void> | void) | undefined,
    stage: GenerationStage,
    ...args: T
  ): Promise<void> {
    if (!hook) {
      return;
    }

    try {
      await hook(...args);
    } catch (error) {
      issues.push({
        severity: 'warning',
        stage,
        message: `File lifecycle hook failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  onProgress({ stage: 'planning' });

  const drafts = resolveDraftsFromPackage(project, productPackage);
  const plan = buildGenerationPlan(drafts, mvpScope, backendModules);

  if (plan.pages.length === 0) {
    return {
      ok: false,
      issues: [
        {
          severity: 'error',
          stage: 'planning',
          message: 'No pages could be planned from the Product Package — nothing to generate.',
        },
      ],
      failedStage: 'planning',
    };
  }

  if (onPlanReady) {
    try {
      await onPlanReady(plan);
    } catch (error) {
      issues.push({
        severity: 'warning',
        stage: 'planning',
        message: `onPlanReady callback failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const generatedFiles: GeneratedFile[] = [];

  async function getReusable(path: string): Promise<string | undefined> {
    return resumeHooks?.getReusableContent ? await resumeHooks.getReusableContent(path) : undefined;
  }

  onProgress({ stage: 'generating-types' });

  const reusableTypes = await getReusable('src/types/index.ts');

  if (reusableTypes !== undefined) {
    const reusedFile = { path: 'src/types/index.ts', content: reusableTypes };
    generatedFiles.push(reusedFile);
    await safeInvoke(fileHooks?.onFileReady, 'generating-types', reusedFile, 'code-gen-types-reused');
  } else {
    await safeInvoke(fileHooks?.onFilesStarting, 'generating-types', 'code-gen-types', 'src/types/index.ts');

    const typesResult = await callForFiles(
      buildSharedTypesPrompt({
        projectName: project.name,
        entities: plan.entities,
        coreFeatures: drafts.requirements?.coreFeatures ?? [],
      }),
      generate,
      project.id,
      'code-gen-types',
    );

    if (!typesResult.ok) {
      await safeInvoke(
        fileHooks?.onStageFailed,
        'generating-types',
        'code-gen-types',
        typesResult.error,
        'src/types/index.ts',
      );

      return {
        ok: false,
        issues: [...issues, { severity: 'error', stage: 'generating-types', message: typesResult.error }],
        failedStage: 'generating-types',
      };
    }

    generatedFiles.push(...typesResult.files);

    for (const file of typesResult.files) {
      await safeInvoke(fileHooks?.onFileReady, 'generating-types', file, 'code-gen-types');
    }
  }

  onProgress({ stage: 'generating-services' });

  const reusableServices = await getReusable('src/services/api.ts');

  if (reusableServices !== undefined) {
    const reusedFile = { path: 'src/services/api.ts', content: reusableServices };
    generatedFiles.push(reusedFile);
    await safeInvoke(fileHooks?.onFileReady, 'generating-services', reusedFile, 'code-gen-services-reused');
  } else {
    await safeInvoke(fileHooks?.onFilesStarting, 'generating-services', 'code-gen-services', 'src/services/api.ts');

    const servicesResult = await callForFiles(
      buildServicesPrompt({
        projectName: project.name,
        apiEndpoints: plan.apiEndpoints,
        apiArchitecture: drafts.backend?.apiArchitecture,
        backendModules: (plan.backendModules ?? []).map((module) => ({
          moduleSlug: module.moduleSlug,
          apiEndpoints: module.apiEndpoints,
        })),
      }),
      generate,
      project.id,
      'code-gen-services',
    );

    if (!servicesResult.ok) {
      await safeInvoke(
        fileHooks?.onStageFailed,
        'generating-services',
        'code-gen-services',
        servicesResult.error,
        'src/services/api.ts',
      );

      return {
        ok: false,
        issues: [...issues, { severity: 'error', stage: 'generating-services', message: servicesResult.error }],
        failedStage: 'generating-services',
      };
    }

    generatedFiles.push(...servicesResult.files);

    for (const file of servicesResult.files) {
      await safeInvoke(fileHooks?.onFileReady, 'generating-services', file, 'code-gen-services');
    }
  }

  for (const [index, page] of plan.pages.entries()) {
    onProgress({ stage: 'generating-pages', detail: `${page.name} (${index + 1}/${plan.pages.length})` });

    const pageRole = `code-gen-page:${page.componentName}`;
    const pagePath = `src/pages/${page.fileName}`;
    const reusablePage = await getReusable(pagePath);

    if (reusablePage !== undefined) {
      const reusedFile = { path: pagePath, content: reusablePage };
      generatedFiles.push(reusedFile);
      await safeInvoke(fileHooks?.onFileReady, 'generating-pages', reusedFile, `${pageRole}-reused`);
      continue;
    }

    await safeInvoke(fileHooks?.onFilesStarting, 'generating-pages', pageRole, pagePath);

    const pageResult = await callForFiles(
      buildPagePrompt({
        projectName: project.name,
        pageName: page.name,
        componentName: page.componentName,
        routePath: page.routePath,
        businessVision: drafts.requirements?.businessVision,
        coreFeatures: drafts.requirements?.coreFeatures ?? [],
        uiuxNotes: drafts.frontend?.frontendOverview,
      }),
      generate,
      project.id,
      pageRole,
    );

    if (!pageResult.ok) {
      // One bad page doesn't abort the whole app — reported as an error issue, generation continues so a partial project is still usable.
      issues.push({
        severity: 'error',
        stage: 'generating-pages',
        message: `${page.name}: ${pageResult.error}`,
        filePath: page.fileName,
      });
      await safeInvoke(fileHooks?.onStageFailed, 'generating-pages', pageRole, pageResult.error, pagePath);
      continue;
    }

    /*
     * App.tsx (see projectScaffolder.ts) imports each page from a fixed, deterministic
     * path (`./pages/${page.componentName}`) — the AI's own choice of filename for its
     * FIRST returned file is overridden to match exactly, rather than trusted, so a
     * model that names the file differently (or inconsistently across pages) can never
     * produce a broken import. Any additional files the same call happened to return
     * are kept as extra page-scoped files under their own (prefixed) path.
     */
    const [primaryFile, ...extraFiles] = pageResult.files;
    const primaryPageFile = { path: pagePath, content: primaryFile.content };
    const extraPageFiles = prefixSrc(extraFiles, 'pages');
    generatedFiles.push(primaryPageFile, ...extraPageFiles);

    await safeInvoke(fileHooks?.onFileReady, 'generating-pages', primaryPageFile, pageRole);

    // Extra files beyond the one planned page path are exactly requirement G's "unplanned file" case — the caller reconciles them, this pipeline just reports them.
    for (const extraFile of extraPageFiles) {
      await safeInvoke(fileHooks?.onFileReady, 'generating-pages', extraFile, pageRole);
    }
  }

  if (plan.sharedComponents.length > 0) {
    onProgress({ stage: 'generating-components' });
    await safeInvoke(fileHooks?.onFilesStarting, 'generating-components', 'code-gen-components');

    const componentsResult = await callForFiles(
      buildSharedComponentsPrompt({
        projectName: project.name,
        componentNames: plan.sharedComponents,
        designNotes: drafts.frontend?.layoutStrategy,
      }),
      generate,
      project.id,
      'code-gen-components',
    );

    if (componentsResult.ok) {
      const componentFiles = prefixSrc(componentsResult.files, 'components');
      generatedFiles.push(...componentFiles);

      for (const file of componentFiles) {
        await safeInvoke(fileHooks?.onFileReady, 'generating-components', file, 'code-gen-components');
      }
    } else {
      issues.push({ severity: 'warning', stage: 'generating-components', message: componentsResult.error });
      await safeInvoke(
        fileHooks?.onStageFailed,
        'generating-components',
        'code-gen-components',
        componentsResult.error,
      );
    }
  }

  /*
   * Sprint 79 Phase 1 — one AI call per planned Backend Module (see `GenerationPlan.backendModules`).
   * Module-atomic resume: unlike the shared-components batch (whose planned paths aren't fully
   * known until manifestBuilder.ts assigns PascalCase names), a Backend Module's six paths are
   * FIXED and known up front (`backendModuleFilePathList`) — so if EVERY one of them already has
   * reusable content, the whole module is skipped with no AI call at all, matching Backend
   * Generation Architecture §9's "a module is only ever touched by a run whose Selected Features
   * include a Feature owned by that module." Otherwise the whole module is (re)generated in one
   * batched call — never a partial regeneration of just one of its six files, since the six
   * files are one cohesive vertical slice, not independently meaningful on their own.
   */
  for (const module of plan.backendModules ?? []) {
    onProgress({ stage: 'generating-backend', detail: module.moduleSlug });

    const paths = backendModuleFilePaths(module.moduleSlug);
    const pathList = backendModuleFilePathList(module.moduleSlug);
    const reusableEntries = await Promise.all(pathList.map(async (path) => [path, await getReusable(path)] as const));
    const allReusable = reusableEntries.every(([, content]) => content !== undefined);

    if (allReusable) {
      for (const [path, content] of reusableEntries) {
        const reusedFile = { path, content: content as string };
        generatedFiles.push(reusedFile);
        await safeInvoke(
          fileHooks?.onFileReady,
          'generating-backend',
          reusedFile,
          `code-gen-backend:${module.moduleSlug}-reused`,
        );
      }
      continue;
    }

    const backendRole = `code-gen-backend:${module.moduleSlug}`;
    await safeInvoke(fileHooks?.onFilesStarting, 'generating-backend', backendRole);

    const backendResult = await callForFiles(
      buildBackendModulePrompt({
        projectName: project.name,
        moduleSlug: module.moduleSlug,
        featureIds: module.featureIds,
        databaseTables: module.databaseTables,
        apiEndpoints: module.apiEndpoints,
        paths,
      }),
      generate,
      project.id,
      backendRole,
      BACKEND_GENERATION_SYSTEM_PROMPT,
    );

    if (!backendResult.ok) {
      issues.push({
        severity: 'error',
        stage: 'generating-backend',
        message: `${module.moduleSlug}: ${backendResult.error}`,
      });
      await safeInvoke(fileHooks?.onStageFailed, 'generating-backend', backendRole, backendResult.error);
      continue;
    }

    /*
     * Conservative on purpose (unlike the pages/components stages, which trust extra AI-returned
     * files under a prefixed folder): a database Repository is high-stakes enough that only the
     * six explicitly-requested canonical paths for THIS module are accepted — anything else the
     * AI returned is dropped and reported, never silently written as an "unplanned" backend file.
     */
    const expectedPaths = new Set(pathList);
    const acceptedFiles = backendResult.files.filter((file) => expectedPaths.has(file.path));
    const unexpectedFiles = backendResult.files.filter((file) => !expectedPaths.has(file.path));

    for (const unexpected of unexpectedFiles) {
      issues.push({
        severity: 'warning',
        stage: 'generating-backend',
        message: `${module.moduleSlug}: unexpected file path outside this module's planned set was dropped: ${unexpected.path}`,
        filePath: unexpected.path,
      });
    }

    generatedFiles.push(...acceptedFiles);

    for (const file of acceptedFiles) {
      await safeInvoke(fileHooks?.onFileReady, 'generating-backend', file, backendRole);
    }
  }

  onProgress({ stage: 'validating' });

  const { files: validatedFiles, issues: validationIssues } = validateGeneratedFiles(generatedFiles, plan);
  issues.push(...validationIssues);

  const hasAnyPage = validatedFiles.some((file) => file.path.startsWith('src/pages/'));

  if (!hasAnyPage) {
    return { ok: false, issues, failedStage: 'validating' };
  }

  onProgress({ stage: 'assembling' });

  const template = resolveTemplate(REACT_VITE_TS_TEMPLATE_ID);

  /*
   * Sprint 86 (Part 1) — the single biggest blocker Sprint 85's assessment identified:
   * `template.dependencies` only ever covers the scaffold's own imports, so a generated
   * Backend Module's `@supabase/supabase-js` import (or any other known package a future
   * prompt starts allowing) was never added to `package.json`, guaranteeing a broken
   * `npm run build`. Resolved here, once, over every AI-generated + backend file, BEFORE
   * `package.json` is scaffolded, so it's correct on the very first write rather than
   * patched in afterward.
   */
  const resolvedDependencies = resolveRequiredDependencies(validatedFiles, template.dependencies);

  /*
   * Sprint 86 (Part 3) — a project needs its own Supabase credentials at runtime exactly
   * when it has a generated Backend Module (whose repository.ts calls
   * `@supabase/supabase-js`) or an already-generated real database schema (Database
   * Activation, `project.databaseActivation.schema` — see productAssembler.ts's own
   * `buildDatabaseActivationFiles`). Neither implies the other structurally, so both are
   * checked; a frontend-only project with neither gets a `.env.example` with no invented
   * Supabase entries.
   */
  const needsSupabaseEnv =
    Boolean(plan.backendModules && plan.backendModules.length > 0) || Boolean(project.databaseActivation?.schema);

  const scaffoldFiles = scaffoldReactViteProject({
    projectName: project.name,
    description: project.description,
    template,
    pages: plan.pages,
    resolvedDependencies,
    needsSupabaseEnv,
  });

  /*
   * Requirement F — deterministic scaffold files must be persisted too, not just
   * AI-generated ones. No `onFilesStarting` here: unlike the AI stages above, there's no
   * async gap where a 'generating' interim status would ever be observed — the content
   * already exists synchronously — so this goes straight to `onFileReady`.
   */
  for (const file of scaffoldFiles) {
    await safeInvoke(fileHooks?.onFileReady, 'assembling', file, 'scaffold');
  }

  const filesByPath = new Map<string, GeneratedFile>();

  for (const file of [...scaffoldFiles, ...validatedFiles]) {
    filesByPath.set(file.path, file);
  }

  const generatedProject: GeneratedProject = {
    projectId: project.id,
    templateId: template.id,
    files: Array.from(filesByPath.values()),
    folders: [],
    generatedAt: new Date().toISOString(),
  };

  /*
   * Sprint 86 (Part 4) — the new build-readiness pass, over the FULLY assembled project
   * (scaffold + AI-generated, dependencies already resolved above). `ok: false` here means
   * `validateBuildReadiness` found something it's confident would break `npm install`/`npm
   * run build` (an unresolvable import, a broken relative import, or an unparseable/missing
   * package.json) — see that module's own header for why every softer, heuristic check
   * stays a non-blocking warning instead of failing the whole run. This is the literal
   * "generation should stop" requirement: unlike a single bad page (which the pipeline
   * already tolerates and continues past), a build-breaking dependency/import problem is
   * something no amount of "partial project is still usable" tolerance can paper over.
   */
  const buildValidation = validateBuildReadiness({ project: generatedProject, needsSupabaseEnv });
  const allIssues = [...issues, ...buildValidation.issues];

  if (!buildValidation.ok) {
    return { ok: false, issues: allIssues, failedStage: 'validating' };
  }

  return { ok: true, project: generatedProject, issues: allIssues };
}
