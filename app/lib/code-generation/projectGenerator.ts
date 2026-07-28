import type { Project } from '~/lib/stores/projects';
import type { ProductPackage } from '~/lib/product-assembly/assemblyTypes';
import {
  runGenerationPipeline,
  type FileLifecycleHooks,
  type GenerationPhaseHooks,
  type OnPlanReady,
  type ResumeHooks,
} from './generationPipeline';
import type { GenerateFn, GenerationPlanScope, GenerationResult, OnGenerationProgress } from './codeGenerationTypes';
import type { BackendModulePlan } from '~/lib/backend-generation/backendModuleTypes';

/**
 * Project Generator — Sprint 38.
 *
 * The single public entry point for turning a project's assembled Product Package into
 * a `GeneratedProject` — everything else in app/lib/code-generation/ is an
 * implementation detail of this one function. app/lib/hooks/useCodeGeneration.ts (the
 * only caller) never imports generationPipeline.ts/templateResolver.ts/
 * projectScaffolder.ts directly.
 */
export async function generateProject(
  project: Project,
  productPackage: ProductPackage,
  generate: GenerateFn,
  onProgress: OnGenerationProgress,
  onPlanReady?: OnPlanReady,
  fileHooks?: FileLifecycleHooks,
  resumeHooks?: ResumeHooks,
  mvpScope?: GenerationPlanScope,
  backendModules?: BackendModulePlan[],

  /** Sprint 98A, BUG-011 — operator cancellation, threaded straight through to the pipeline. */
  signal?: AbortSignal,

  /** Sprint 99B — the Progressive Phase Runner's lifecycle, threaded straight through exactly like `signal` above. */
  phaseHooks?: GenerationPhaseHooks,
): Promise<GenerationResult> {
  const hasAnySection = productPackage.sections.some(
    (section) => section.id !== 'documentation' && section.files.length > 0,
  );

  if (!hasAnySection) {
    return {
      ok: false,
      issues: [
        {
          severity: 'error',
          stage: 'planning',
          message: 'The Product Package has no assembled role output yet — assemble it first.',
        },
      ],
      failedStage: 'planning',
    };
  }

  return runGenerationPipeline(
    project,
    productPackage,
    generate,
    onProgress,
    onPlanReady,
    fileHooks,
    resumeHooks,
    mvpScope,
    backendModules,
    signal,
    phaseHooks,
  );
}

export const projectGenerator = {
  generateProject,
};
