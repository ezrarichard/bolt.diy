import type { Project } from '~/lib/stores/projects';
import type { ProductPackage } from '~/lib/product-assembly/assemblyTypes';
import { runGenerationPipeline } from './generationPipeline';
import type { GenerateFn, GenerationResult, OnGenerationProgress } from './codeGenerationTypes';

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

  return runGenerationPipeline(project, productPackage, generate, onProgress);
}

export const projectGenerator = {
  generateProject,
};
