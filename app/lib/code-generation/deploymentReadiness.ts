import type { GenerationResult } from './codeGenerationTypes';
import type { ApplicationManifestDraft } from '~/lib/application-manifest/manifestTypes';
import type { ProductPackage } from '~/lib/product-assembly/assemblyTypes';

/**
 * Deployment Readiness Score — Sprint 86 (Deployment Foundation, Part 7).
 *
 * Purely informational, per this sprint's own instruction ("No deployment yet") — this
 * NEVER blocks or alters generation itself; it only summarizes, in one place, whether the
 * other Part 1-6 checks this sprint added actually came out clean for one project's most
 * recent generation. A "not_ready" result changes nothing by itself; a future deployment
 * sprint (Sprint 87+, per Sprint 85's own recommended order) is what would actually act on
 * it.
 */

export type DeploymentReadinessCheckId =
  | 'generation-complete'
  | 'dependency-validation'
  | 'environment-template'
  | 'application-manifest'
  | 'product-package';

export interface DeploymentReadinessCheck {
  id: DeploymentReadinessCheckId;
  label: string;
  passed: boolean;
  detail?: string;
}

export interface DeploymentReadinessResult {
  checks: DeploymentReadinessCheck[];
  overall: 'ready' | 'not_ready';
}

export interface DeploymentReadinessInput {
  /** Whether `runGenerationPipeline` returned `ok: true` for this project's most recent run — see generationPipeline.ts. */
  generationOk: boolean;

  /** Whether `validateBuildReadiness` (generationValidator.ts) found no unresolved dependency or broken import for this run. */
  dependencyValidationOk: boolean;

  /** Whether a `.env.example` was generated (see projectScaffolder.ts's `envExampleFile`) — true unconditionally for any successful generation, since Part 3 always produces one. */
  hasEnvironmentTemplate: boolean;

  /** Whether the persisted Application Manifest (see manifestBuilder.ts) has its Sprint 86 deployment metadata populated (`buildCommand`/`dependencies`, both always set together — see `buildApplicationManifest`). */
  hasApplicationManifestMetadata: boolean;

  /** Whether a Product Package has actually been assembled for this project with at least one real (non-missing) section — an empty/never-assembled package can't meaningfully be "deployment ready". */
  hasProductPackage: boolean;
}

const CHECK_LABELS: Record<DeploymentReadinessCheckId, string> = {
  'generation-complete': 'Generation Complete',
  'dependency-validation': 'Dependency Validation',
  'environment-template': 'Environment Template',
  'application-manifest': 'Application Manifest',
  'product-package': 'Product Package',
};

/** Pure — every input is a boolean the caller already computed (or can read straight off a `GenerationResult`/`ApplicationManifest`/`ProductPackage`, see `calculateDeploymentReadinessFromArtifacts` below for that convenience path). "Ready" requires every single check to pass — a deployment pipeline built on this later should never treat a partial pass as good enough. */
export function calculateDeploymentReadiness(input: DeploymentReadinessInput): DeploymentReadinessResult {
  const checks: DeploymentReadinessCheck[] = [
    { id: 'generation-complete', label: CHECK_LABELS['generation-complete'], passed: input.generationOk },
    {
      id: 'dependency-validation',
      label: CHECK_LABELS['dependency-validation'],
      passed: input.dependencyValidationOk,
    },
    {
      id: 'environment-template',
      label: CHECK_LABELS['environment-template'],
      passed: input.hasEnvironmentTemplate,
    },
    {
      id: 'application-manifest',
      label: CHECK_LABELS['application-manifest'],
      passed: input.hasApplicationManifestMetadata,
    },
    { id: 'product-package', label: CHECK_LABELS['product-package'], passed: input.hasProductPackage },
  ];

  return {
    checks,
    overall: checks.every((check) => check.passed) ? 'ready' : 'not_ready',
  };
}

/**
 * Convenience wrapper — derives every `DeploymentReadinessInput` boolean straight from the
 * artifacts a caller (e.g. `ProductPackagePanel.tsx`) already has in hand after a
 * generation run, so nothing needs to re-run `validateBuildReadiness` itself just to get a
 * readiness score. `generationResult.issues` is scanned for the exact error messages
 * `generationValidator.ts` produces rather than re-importing/re-running that module, since
 * by this point generation has already finished and those issues are already attached to
 * the result.
 */
export function calculateDeploymentReadinessFromArtifacts(input: {
  generationResult: GenerationResult;
  manifest?: Pick<ApplicationManifestDraft, 'dependencies' | 'buildCommand'>;
  productPackage?: ProductPackage;
}): DeploymentReadinessResult {
  const hasDependencyIssue = input.generationResult.issues.some(
    (issue) =>
      issue.severity === 'error' &&
      (issue.message.includes('has no known version') || issue.message.includes('Broken import')),
  );

  const envFile = input.generationResult.project?.files.find((file) => file.path === '.env.example');

  return calculateDeploymentReadiness({
    generationOk: input.generationResult.ok,
    dependencyValidationOk: input.generationResult.ok && !hasDependencyIssue,
    hasEnvironmentTemplate: Boolean(envFile),
    hasApplicationManifestMetadata: Boolean(input.manifest?.buildCommand && input.manifest?.dependencies),
    hasProductPackage: Boolean(
      input.productPackage && input.productPackage.sections.some((section) => section.files.length > 0),
    ),
  });
}
