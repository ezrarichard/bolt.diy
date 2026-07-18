/**
 * Code Generation Domain — Sprint 38 (Code Generation & Live Preview Pipeline).
 *
 * Types for turning an assembled Product Package (app/lib/product-assembly/) into a
 * real, runnable project: `GeneratedFile`/`GeneratedFolder` describe the output,
 * `GenerationStage` names each step of the pipeline (surfaced directly in the UI's
 * progress display), `GenerationIssue`/`GenerationResult` carry validation/failure
 * detail without ever throwing.
 *
 * Deliberately a separate, differently-scoped concept from
 * app/lib/projects/generationRunner.ts's own `GeneratedFile`/`GenerationRunResult`
 * (Sprint 29's "Prototype Generation Engine — Flow 1, Foundation Only", which sources
 * from a `GenerationSession`/execution-plan step and never writes files anywhere) —
 * that file and its "Prototype Generation Test" UI (GenerationPlanPanel.tsx) are
 * untouched by this sprint. This module's `GeneratedFile` is sourced from the Product
 * Package instead (see generationPipeline.ts) and IS written to the real WebContainer
 * filesystem (see webcontainerWriter.ts).
 */

/** One file in the generated project, path relative to the project root (e.g. "src/App.tsx", "package.json") — never includes WORK_DIR; see webcontainerWriter.ts for where that's applied. */
export interface GeneratedFile {
  path: string;
  content: string;
}

/** A folder the project needs even if nothing (yet) fills it — most folders are implied by file paths, so this is mainly for structurally-expected-but-currently-empty folders. */
export interface GeneratedFolder {
  path: string;
}

export interface GeneratedProject {
  projectId: string;
  templateId: string;
  files: GeneratedFile[];
  folders: GeneratedFolder[];
  generatedAt: string;
}

/**
 * Every step of the pipeline, in order — the UI (ProductPackagePanel.tsx) renders
 * whichever one is current as its progress label. Deliberately more granular than the
 * sprint brief's 5 example labels (Planning/Generating/Writing Files/Installing/
 * Launching Preview) — those map to groups of these stages (see
 * app/lib/hooks/useCodeGeneration.ts's STAGE_GROUP_LABELS) so the user sees a simple
 * label while the underlying result still records exactly which fine-grained step ran.
 */
export type GenerationStage =
  | 'planning'
  | 'generating-types'
  | 'generating-services'
  | 'generating-pages'
  | 'generating-components'
  | 'validating'
  | 'assembling'
  | 'writing-files'
  | 'installing'
  | 'launching-preview'
  | 'complete';

export interface GenerationIssue {
  severity: 'error' | 'warning';
  message: string;
  stage: GenerationStage;
  filePath?: string;
}

/**
 * Never throws its way out of the pipeline — a failure is `ok: false` plus
 * `failedStage`/`issues`, so the UI can report exactly what happened and let the user
 * retry (see the sprint's "Error Handling" requirement). `project` is present only when
 * `ok` is true.
 */
export interface GenerationResult {
  ok: boolean;
  project?: GeneratedProject;
  issues: GenerationIssue[];
  failedStage?: GenerationStage;
}

/**
 * Same shape as useGenerateText().generate — every function in this domain accepts a
 * `generate` callback rather than calling fetch/an LLM provider directly, matching the
 * "engine never calls the LLM provider directly" convention every AI role engine in
 * this codebase already follows (see e.g. businessAnalystEngine.ts's file header).
 */
export type GenerateFn = (
  system: string | undefined,
  prompt: string,
  options?: { maxTokens?: number; model?: string; provider?: string; temperature?: number },
) => Promise<
  | {
      ok: true;
      text: string;

      /** Acceptance-test-verified addition — needed so generationPipeline.ts's callForFiles() can use the same truncation-recovery mechanism (roleGenerationRecovery.ts) every AI-role engine uses, rather than a single-shot call with no retry. useGenerateText().generate already returns this; every existing GenerateFn implementation passes it through unchanged. */
      finishReason?: string;
    }
  | { ok: false; error: string }
>;

/** Reported once per stage as it starts, so the UI can show "Generating page 2 of 4: About" style detail, not just the bare stage name. */
export interface GenerationProgress {
  stage: GenerationStage;
  detail?: string;
}

export type OnGenerationProgress = (progress: GenerationProgress) => void;

/**
 * One planned page — the deterministic output of generationPipeline.ts's planning
 * stage (derived from the Frontend/Requirements drafts' own page lists, never a fresh
 * AI call; see that file's header comment). Shared between the pipeline (which plans
 * pages and asks the AI to fill each one in) and projectScaffolder.ts (which wires
 * `routePath` -> `componentName` into App.tsx's routing, deterministically).
 */
export interface GenerationPlanPage {
  name: string;
  componentName: string;
  routePath: string;
  fileName: string;
}

/** The full deterministic plan — every AI call stage after "planning" reads from this rather than re-deriving it. */
export interface GenerationPlan {
  pages: GenerationPlanPage[];
  sharedComponents: string[];
  entities: string[];
  apiEndpoints: string[];
}
