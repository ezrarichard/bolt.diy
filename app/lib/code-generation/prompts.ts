import { formatList } from '~/lib/projects/prompts/shared';

/**
 * Code Generation Prompts — Sprint 38.
 *
 * Every AI call in generationPipeline.ts asks for the SAME response contract — a single
 * JSON object `{ "files": [ { "path": string, "content": string } ] }` — parsed by
 * parseGeneratedFilesResponse() in generationPipeline.ts (reusing
 * app/lib/projects/draftParsing.ts's `extractJsonPayload` for fence/truncation
 * handling, same as every other AI role's draft parser). Kept in its own file, same
 * separation every other AI role already uses (prompts/*.ts vs *Engine.ts), so
 * generationPipeline.ts stays focused on orchestration rather than long template
 * literals.
 */

export const CODE_GENERATION_SYSTEM_PROMPT = `You are a Senior Software Engineer working inside Builders, an AI engineering platform. Your job is to write REAL, working React + TypeScript + Vite source files based on the engineering specification you are given — never placeholder or "TODO" code.

Rules:
- Respond with ONLY a single JSON object: { "files": [ { "path": string, "content": string } ] } — no markdown code fences, no commentary before or after it.
- Every "path" is relative to the project root and must start with "src/" (e.g. "src/pages/HomePage.tsx").
- Every "content" is complete, valid TypeScript/TSX — a real, runnable file, not a sketch. Use functional components and hooks only (no class components).
- Use only React, react-router-dom, and plain TypeScript/CSS — do not invent a dependency that isn't one of those.
- Base your output strictly on the specification given below. Do not invent features, pages, or endpoints that aren't implied by it.
- Import shared types from "../types" and API calls from "../services/api" (relative to the file's own location) rather than redefining them inline.
- Keep styling simple (plain CSS classes or inline styles) — do not assume a CSS framework is installed.`;

function specSection(label: string, value: string | undefined): string {
  return `${label}:\n${value && value.trim().length > 0 ? value : 'Not specified.'}`;
}

export interface SharedTypesPromptInput {
  projectName: string;
  entities: string[];
  coreFeatures: string[];
}

export function buildSharedTypesPrompt(input: SharedTypesPromptInput): string {
  return `Project: ${input.projectName}

${specSection('Core Features', formatList(input.coreFeatures))}
${specSection('Data Entities', formatList(input.entities))}

Generate exactly one file, "src/types/index.ts", exporting a TypeScript interface for each data entity listed above (reasonable fields inferred from the entity name and core features — id, timestamps, and obviously-implied fields). Keep every interface small and practical.`;
}

export interface ServicesPromptBackendModule {
  moduleSlug: string;
  apiEndpoints: string[];
}

export interface ServicesPromptInput {
  projectName: string;
  apiEndpoints: string[];
  apiArchitecture: string | undefined;

  /**
   * Sprint 86 (Part 2) — every Backend Module actually planned for this generation (see
   * `GenerationPlan.backendModules`). Sprint 85's assessment found `src/services/api.ts`
   * was UNCONDITIONALLY generated to return mock data, even for a project whose Backend
   * Module was reviewed, approved, and fully generated — the frontend simply never called
   * it. When this is non-empty, the prompt below asks for real calls into each module's
   * `service.ts` instead of a mock, for exactly the endpoints those modules cover; any
   * endpoint NOT covered by a Backend Module still gets realistic mock data, same as
   * before. Omitted/empty preserves the original all-mock behavior exactly — a project
   * with no Backend Module is unaffected by this change.
   */
  backendModules?: ServicesPromptBackendModule[];
}

export function buildServicesPrompt(input: ServicesPromptInput): string {
  const backendModules = input.backendModules ?? [];
  const hasBackend = backendModules.length > 0;

  const backendSection = hasBackend
    ? `\nGenerated Backend Module(s) — this project already has real backend code for these, in the same project (not a separate server):\n${backendModules
        .map(
          (module) =>
            `- Module "${module.moduleSlug}" (src/features/${module.moduleSlug}/service.ts) covers: ${formatList(module.apiEndpoints)}`,
        )
        .join('\n')}\n`
    : '';

  const behaviorInstruction = hasBackend
    ? `For each endpoint covered by a Backend Module above, import the module's exported function(s) directly from "../features/<moduleSlug>/service" and call them — do NOT return mock data for these, since real backend code already exists for them. For any endpoint listed above that is NOT covered by any Backend Module, still return realistic mock data (in-memory array, simulated setTimeout latency) so the app remains fully interactive for that part.`
    : `Generate one async function per endpoint above (or a small, sensible set if none were specified), each returning realistic mock data (no real network calls — use an in-memory array and simulated latency via a short setTimeout-based delay) so the app is fully interactive without a real backend.`;

  return `Project: ${input.projectName}

${specSection('API Architecture', input.apiArchitecture)}
${specSection('API Endpoints', formatList(input.apiEndpoints))}
${backendSection}
Generate exactly one file, "src/services/api.ts". ${behaviorInstruction} Import shared types from "../types".`;
}

export interface PagePromptInput {
  projectName: string;
  pageName: string;
  componentName: string;
  routePath: string;
  businessVision: string | undefined;
  coreFeatures: string[];
  uiuxNotes: string | undefined;
}

export function buildPagePrompt(input: PagePromptInput): string {
  return `Project: ${input.projectName}
${specSection('Business Vision', input.businessVision)}
${specSection('Core Features', formatList(input.coreFeatures))}
${specSection('UI/UX Notes', input.uiuxNotes)}

Generate exactly one file, "src/pages/${input.componentName}.tsx", exporting a default React component named "${input.componentName}" for the "${input.pageName}" page (route "${input.routePath}"). Use the shared types ("../types") and API services ("../services/api") where the page's content calls for real(-ish) data. This page should feel complete and usable, not a stub.`;
}

/**
 * Sprint 79 Phase 1 — a SEPARATE system prompt for the `'generating-backend'` stage only.
 * `CODE_GENERATION_SYSTEM_PROMPT` above hard-codes "React + TypeScript + Vite" and "only React,
 * react-router-dom, and plain TypeScript/CSS" — correct for every existing stage (all genuinely
 * frontend) but actively wrong instructions for repository/service/route code, which needs
 * `@supabase/supabase-js` and no React at all. Every existing call site is untouched; only the
 * new backend stage passes this instead. Encodes Backend Generation Architecture §4/§6/§8's
 * layering rules directly, since there's no separate lint/type boundary enforcing them yet
 * (Sprint 79/80 scope) — the prompt itself is the only thing holding the line for now.
 */
export const BACKEND_GENERATION_SYSTEM_PROMPT = `You are a Senior Backend Engineer working inside Builders, an AI engineering platform. Your job is to write REAL, working TypeScript backend source files for ONE Feature Slice/Module, based on the specification you are given — never placeholder or "TODO" code.

Rules:
- Respond with ONLY a single JSON object: { "files": [ { "path": string, "content": string } ] } — no markdown code fences, no commentary before or after it.
- Generate EXACTLY the file paths you are asked for below, no more, no fewer, no renamed/relocated files.
- Use TypeScript and "@supabase/supabase-js" only — no React, no JSX, no frontend framework code anywhere in these files.
- Layering is mandatory and must not be violated:
  - "repository.ts" is the ONLY file allowed to import "@supabase/supabase-js" or talk to the database. It exposes one small, typed method per query the service layer needs — never a generic "run any query" escape hatch.
  - "service.ts" contains business logic and calls "repository.ts" only. It must never import "@supabase/supabase-js" and must never know about HTTP requests/responses.
  - "validators.ts" exports one validation function per operation, derived from the database columns and acceptance criteria given below — used by both "routes.ts" and (in a real app) any UI form.
  - "routes.ts" contains thin HTTP handlers only: validate the request via "validators.ts", call exactly one "service.ts" method, map the result/error to a response. No business logic and no direct database access in this file.
  - "types.ts" exports the module's local TypeScript interfaces, matching the database tables given below.
  - The "api/" adapter file is a one-line passthrough that imports and re-exports "routes.ts" — it must contain no logic of its own.
- Base your output strictly on the specification given below. Do not invent endpoints, tables, or business rules that aren't implied by it.`;

export interface BackendModulePromptInput {
  projectName: string;
  moduleSlug: string;
  featureIds: string[];
  databaseTables: string[];
  apiEndpoints: string[];
  paths: { types: string; validators: string; repository: string; service: string; routes: string; apiAdapter: string };
}

export function buildBackendModulePrompt(input: BackendModulePromptInput): string {
  return `Project: ${input.projectName}
Module: ${input.moduleSlug} (implements Feature(s): ${formatList(input.featureIds)})

${specSection('Database Tables This Module May Access', formatList(input.databaseTables))}
${specSection('Planned API Endpoints', formatList(input.apiEndpoints))}

Generate exactly these six files for the "${input.moduleSlug}" module:
- "${input.paths.types}" — module-local TypeScript interfaces for the tables above.
- "${input.paths.validators}" — one validation function per endpoint/operation.
- "${input.paths.repository}" — the ONLY file that imports "@supabase/supabase-js"; one typed method per query the service needs.
- "${input.paths.service}" — business logic, calling "${input.paths.repository}" only.
- "${input.paths.routes}" — thin HTTP handlers calling "${input.paths.service}", validated via "${input.paths.validators}".
- "${input.paths.apiAdapter}" — a one-line passthrough that imports and re-exports "${input.paths.routes}".`;
}

/**
 * Sprint 99, Checkpoint A — the batched variant of `buildBackendModulePrompt` above.
 *
 * Asks for only the batch's 1–2 files instead of all six, because six provably do not fit the
 * pipeline's 8192-token output ceiling (see backendModuleBatches.ts). The full six-path contract is
 * still shown as context so the model writes files that import each other correctly — it is just
 * told, unambiguously, which subset to return THIS time.
 */
export function buildBackendModuleBatchPrompt(
  input: BackendModulePromptInput & { batchLabel: string; batchPaths: string[] },
): string {
  const descriptions: Record<string, string> = {
    [input.paths.types]: 'module-local TypeScript interfaces for the tables above.',
    [input.paths.validators]: 'one validation function per endpoint/operation.',
    [input.paths.repository]:
      'the ONLY file that imports "@supabase/supabase-js"; one typed method per query the service needs.',
    [input.paths.service]: `business logic, calling "${input.paths.repository}" only.`,
    [input.paths.routes]:
      `thin HTTP handlers calling "${input.paths.service}", validated via "${input.paths.validators}".`,
    [input.paths.apiAdapter]: `a one-line passthrough that imports and re-exports "${input.paths.routes}".`,
  };

  return `Project: ${input.projectName}
Module: ${input.moduleSlug} (implements Feature(s): ${formatList(input.featureIds)})

${specSection('Database Tables This Module May Access', formatList(input.databaseTables))}
${specSection('Planned API Endpoints', formatList(input.apiEndpoints))}

For context, the complete "${input.moduleSlug}" module consists of these six files:
${[input.paths.types, input.paths.validators, input.paths.repository, input.paths.service, input.paths.routes, input.paths.apiAdapter].map((path) => `- "${path}"`).join('\n')}

Right now, generate ONLY the ${input.batchPaths.length === 1 ? 'file' : 'files'} for this batch (${input.batchLabel}) — return no others:
${input.batchPaths.map((path) => `- "${path}" — ${descriptions[path] ?? 'as specified above.'}`).join('\n')}

Write complete, working implementations. Assume the other files listed above exist at exactly those paths and import from them normally.`;
}

export interface SharedComponentsPromptInput {
  projectName: string;
  componentNames: string[];
  designNotes: string | undefined;
}

export function buildSharedComponentsPrompt(input: SharedComponentsPromptInput): string {
  return `Project: ${input.projectName}
${specSection('Design Notes', input.designNotes)}

Generate one file per shared component below, each at "src/components/<ComponentName>.tsx" exporting a default React component of that exact name:
${formatList(input.componentNames)}

Keep each component focused and reusable (props-driven), matching a typical shared-UI-component library.`;
}
