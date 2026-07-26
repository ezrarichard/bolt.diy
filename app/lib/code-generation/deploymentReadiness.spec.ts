import { describe, expect, it } from 'vitest';
import type { GenerationResult } from './codeGenerationTypes';
import { calculateDeploymentReadiness, calculateDeploymentReadinessFromArtifacts } from './deploymentReadiness';

describe('calculateDeploymentReadiness', () => {
  it('is ready only when every check passes', () => {
    const result = calculateDeploymentReadiness({
      generationOk: true,
      dependencyValidationOk: true,
      hasEnvironmentTemplate: true,
      hasApplicationManifestMetadata: true,
      hasProductPackage: true,
    });

    expect(result.overall).toBe('ready');
    expect(result.checks).toHaveLength(5);
    expect(result.checks.every((check) => check.passed)).toBe(true);
  });

  it('is not_ready when even one check fails', () => {
    const result = calculateDeploymentReadiness({
      generationOk: true,
      dependencyValidationOk: false,
      hasEnvironmentTemplate: true,
      hasApplicationManifestMetadata: true,
      hasProductPackage: true,
    });

    expect(result.overall).toBe('not_ready');
    expect(result.checks.find((check) => check.id === 'dependency-validation')?.passed).toBe(false);
  });

  it('reports every check by its documented id', () => {
    const result = calculateDeploymentReadiness({
      generationOk: false,
      dependencyValidationOk: false,
      hasEnvironmentTemplate: false,
      hasApplicationManifestMetadata: false,
      hasProductPackage: false,
    });

    expect(result.checks.map((check) => check.id)).toEqual([
      'generation-complete',
      'dependency-validation',
      'environment-template',
      'application-manifest',
      'product-package',
    ]);
  });
});

function makeGenerationResult(overrides: Partial<GenerationResult> = {}): GenerationResult {
  return {
    ok: true,
    project: {
      projectId: 'proj-1',
      templateId: 'react-vite-ts',
      files: [{ path: '.env.example', content: 'VITE_ENV=development\n' }],
      folders: [],
      generatedAt: new Date().toISOString(),
    },
    issues: [],
    ...overrides,
  };
}

describe('calculateDeploymentReadinessFromArtifacts', () => {
  it('derives "ready" from a clean generation result plus a fully-populated manifest and package', () => {
    const result = calculateDeploymentReadinessFromArtifacts({
      generationResult: makeGenerationResult(),
      manifest: { buildCommand: 'npm run build', dependencies: { react: '^18.3.1' } },
      productPackage: {
        projectId: 'proj-1',
        projectName: 'Test',
        assembledAt: '',
        sections: [{ id: 'requirements', label: 'Requirements', files: [{ id: 'f1' } as never] }],
        missingSections: [],
      },
    });

    expect(result.overall).toBe('ready');
  });

  it('derives "not_ready" when the generation result itself failed', () => {
    const result = calculateDeploymentReadinessFromArtifacts({
      generationResult: makeGenerationResult({ ok: false, project: undefined, failedStage: 'validating' }),
    });

    expect(result.overall).toBe('not_ready');
    expect(result.checks.find((check) => check.id === 'generation-complete')?.passed).toBe(false);
  });

  it('derives "not_ready" when the generation issues include an unresolved-dependency error, even if ok is somehow true', () => {
    const result = calculateDeploymentReadinessFromArtifacts({
      generationResult: makeGenerationResult({
        issues: [
          {
            severity: 'error',
            stage: 'validating',
            message: 'Generated code imports "left-pad", which has no known version and is not in package.json.',
          },
        ],
      }),
    });

    expect(result.checks.find((check) => check.id === 'dependency-validation')?.passed).toBe(false);
    expect(result.overall).toBe('not_ready');
  });

  it('treats a missing .env.example as failing the environment-template check', () => {
    const result = calculateDeploymentReadinessFromArtifacts({
      generationResult: makeGenerationResult({
        project: { projectId: 'proj-1', templateId: 'react-vite-ts', files: [], folders: [], generatedAt: '' },
      }),
    });

    expect(result.checks.find((check) => check.id === 'environment-template')?.passed).toBe(false);
  });

  it('treats an unassembled/empty Product Package as failing the product-package check', () => {
    const result = calculateDeploymentReadinessFromArtifacts({
      generationResult: makeGenerationResult(),
      productPackage: { projectId: 'proj-1', projectName: 'Test', assembledAt: '', sections: [], missingSections: [] },
    });

    expect(result.checks.find((check) => check.id === 'product-package')?.passed).toBe(false);
  });
});
