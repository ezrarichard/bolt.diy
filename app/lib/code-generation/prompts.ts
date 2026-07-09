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

export interface ServicesPromptInput {
  projectName: string;
  apiEndpoints: string[];
  apiArchitecture: string | undefined;
}

export function buildServicesPrompt(input: ServicesPromptInput): string {
  return `Project: ${input.projectName}

${specSection('API Architecture', input.apiArchitecture)}
${specSection('API Endpoints', formatList(input.apiEndpoints))}

Generate exactly one file, "src/services/api.ts", exporting one async function per endpoint above (or a small, sensible set if none were specified), each returning realistic mock data (no real network calls — use an in-memory array and simulated latency via a short setTimeout-based delay) so the app is fully interactive without a real backend. Import shared types from "../types".`;
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
