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
  buildPagePrompt,
  buildServicesPrompt,
  buildSharedComponentsPrompt,
  buildSharedTypesPrompt,
  CODE_GENERATION_SYSTEM_PROMPT,
} from './prompts';
import { REACT_VITE_TS_TEMPLATE_ID, resolveTemplate } from './templateResolver';
import { scaffoldReactViteProject } from './projectScaffolder';
import type {
  GenerateFn,
  GeneratedFile,
  GeneratedProject,
  GenerationIssue,
  GenerationPlan,
  GenerationPlanPage,
  GenerationResult,
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
 */
export function buildGenerationPlan(drafts: ResolvedDrafts): GenerationPlan {
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

  return {
    pages,
    sharedComponents: sharedComponents.length > 0 ? sharedComponents : ['Navbar', 'Footer'],
    entities: dedupePreserveOrder(drafts.database?.entities ?? []),
    apiEndpoints: dedupePreserveOrder(drafts.backend?.apiEndpoints ?? []),
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
): Promise<{ ok: true; files: GeneratedFile[] } | { ok: false; error: string }> {
  const outcome = await generateRoleWithRecovery({
    projectId,
    roleKey,
    system: CODE_GENERATION_SYSTEM_PROMPT,
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
): Promise<GenerationResult> {
  const issues: GenerationIssue[] = [];

  onProgress({ stage: 'planning' });

  const drafts = resolveDraftsFromPackage(project, productPackage);
  const plan = buildGenerationPlan(drafts);

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

  onProgress({ stage: 'generating-types' });

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
    return {
      ok: false,
      issues: [...issues, { severity: 'error', stage: 'generating-types', message: typesResult.error }],
      failedStage: 'generating-types',
    };
  }

  generatedFiles.push(...typesResult.files);

  onProgress({ stage: 'generating-services' });

  const servicesResult = await callForFiles(
    buildServicesPrompt({
      projectName: project.name,
      apiEndpoints: plan.apiEndpoints,
      apiArchitecture: drafts.backend?.apiArchitecture,
    }),
    generate,
    project.id,
    'code-gen-services',
  );

  if (!servicesResult.ok) {
    return {
      ok: false,
      issues: [...issues, { severity: 'error', stage: 'generating-services', message: servicesResult.error }],
      failedStage: 'generating-services',
    };
  }

  generatedFiles.push(...servicesResult.files);

  for (const [index, page] of plan.pages.entries()) {
    onProgress({ stage: 'generating-pages', detail: `${page.name} (${index + 1}/${plan.pages.length})` });

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
      `code-gen-page:${page.componentName}`,
    );

    if (!pageResult.ok) {
      // One bad page doesn't abort the whole app — reported as an error issue, generation continues so a partial project is still usable.
      issues.push({
        severity: 'error',
        stage: 'generating-pages',
        message: `${page.name}: ${pageResult.error}`,
        filePath: page.fileName,
      });
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
    generatedFiles.push({ path: `src/pages/${page.fileName}`, content: primaryFile.content });
    generatedFiles.push(...prefixSrc(extraFiles, 'pages'));
  }

  if (plan.sharedComponents.length > 0) {
    onProgress({ stage: 'generating-components' });

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
      generatedFiles.push(...prefixSrc(componentsResult.files, 'components'));
    } else {
      issues.push({ severity: 'warning', stage: 'generating-components', message: componentsResult.error });
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
  const scaffoldFiles = scaffoldReactViteProject({
    projectName: project.name,
    description: project.description,
    template,
    pages: plan.pages,
  });

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

  return { ok: true, project: generatedProject, issues };
}
