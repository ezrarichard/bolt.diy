import type {
  DeliveryAcceptanceChecklist,
  DeliveryAdminGuide,
  DeliveryApplicationSummary,
  DeliveryBlueprintSummary,
  DeliveryCompleteness,
  DeliveryCompletenessDimension,
  DeliveryCompletenessLevel,
  DeliveryDatabaseInformation,
  DeliveryDeploymentSummary,
  DeliveryDocumentationIndex,
  DeliveryEnvironmentSummary,
  DeliveryFeatureInventory,
  DeliveryGenerationMetadata,
  DeliveryRepositoryInformation,
  DeliveryVerificationSummary,
} from '~/lib/deployment/deliveryPackageTypes';

/**
 * Delivery Completeness — Sprint 93, Part 10.
 *
 * ADVISORY ONLY. This score never blocks package generation and never gates the
 * `verified -> delivery_ready` transition — it tells an operator how much of the handover story
 * Builders could actually evidence, so a thin package is visibly thin rather than quietly
 * presented as a full handover.
 *
 * Pure and total: every dimension scores from facts already in the assembled package, so the score
 * can be recomputed from a persisted package and will always agree with it.
 */

const WEIGHTS = {
  deployment: 20,
  verification: 20,
  repository: 10,
  database: 10,
  environment: 10,
  manifest: 10,
  features: 8,
  blueprint: 4,
  documentation: 4,
  adminGuide: 2,
  acceptanceChecklist: 2,
} as const;

export interface CompletenessInput {
  deploymentSummary: DeliveryDeploymentSummary;
  verificationSummary: DeliveryVerificationSummary;
  repositoryInformation: DeliveryRepositoryInformation;
  databaseInformation: DeliveryDatabaseInformation;
  environmentSummary: DeliveryEnvironmentSummary;
  applicationSummary: DeliveryApplicationSummary;
  generationMetadata: DeliveryGenerationMetadata;
  featureInventory: DeliveryFeatureInventory;
  blueprintSummary: DeliveryBlueprintSummary;
  documentation: DeliveryDocumentationIndex;
  adminGuide: DeliveryAdminGuide;
  acceptanceChecklist: DeliveryAcceptanceChecklist;

  /**
   * True when this project genuinely needs a database — a frontend-only application scoring 0 for
   * "database" would be misleading, so an inapplicable dimension scores full marks with a stated
   * reason instead of being silently dropped.
   */
  requiresDatabase: boolean;
}

function dimension(
  id: string,
  label: string,
  weight: number,
  score: number,
  detail: string,
): DeliveryCompletenessDimension {
  return { id, label, weight, score: Math.max(0, Math.min(1, score)), detail };
}

export function resolveCompletenessLevel(score: number): DeliveryCompletenessLevel {
  if (score >= 95) {
    return 'complete';
  }

  return score >= 75 ? 'almost_complete' : 'incomplete';
}

export function calculateDeliveryCompleteness(input: CompletenessInput): DeliveryCompleteness {
  const dimensions: DeliveryCompletenessDimension[] = [];

  const hasPreviewUrl = Boolean(input.deploymentSummary.previewUrl);
  dimensions.push(
    dimension(
      'deployment',
      'Deployment',
      WEIGHTS.deployment,
      hasPreviewUrl ? 1 : input.deploymentSummary.provider === 'vercel' ? 0.4 : 0,
      hasPreviewUrl
        ? `Deployed to ${input.deploymentSummary.vercelProjectName ?? 'Vercel'} with a live URL.`
        : input.deploymentSummary.provider === 'vercel'
          ? 'A Vercel project is connected but no deployment URL was recorded.'
          : 'No deployment provider is connected.',
    ),
  );

  const verification = input.verificationSummary;
  const verificationScore = !verification.verified
    ? 0
    : verification.status === 'passed'
      ? 1
      : verification.status === 'warning'
        ? 0.85
        : 0.3;
  dimensions.push(
    dimension(
      'verification',
      'Verification',
      WEIGHTS.verification,
      verificationScore,
      verification.verified
        ? `Verification ${verification.status} — ${verification.requiredPassed}/${verification.requiredTotal} required checks passed.`
        : 'This deployment has never been verified.',
    ),
  );

  const hasRepo = Boolean(input.repositoryInformation.repositoryFullName);
  dimensions.push(
    dimension(
      'repository',
      'Repository',
      WEIGHTS.repository,
      hasRepo ? 1 : 0,
      hasRepo
        ? `Linked to ${input.repositoryInformation.repositoryFullName} (${input.repositoryInformation.branch ?? 'default branch'}).`
        : 'No GitHub repository is connected.',
    ),
  );

  if (!input.requiresDatabase) {
    dimensions.push(
      dimension('database', 'Database', WEIGHTS.database, 1, 'This application declares no database dependency.'),
    );
  } else {
    const database = input.databaseInformation;
    const databaseScore = database.projectRef ? (database.schemaVersion !== undefined ? 1 : 0.6) : 0;
    dimensions.push(
      dimension(
        'database',
        'Database',
        WEIGHTS.database,
        databaseScore,
        database.projectRef
          ? database.schemaVersion !== undefined
            ? `Supabase project connected with schema v${database.schemaVersion}.`
            : 'Supabase project connected, but no applied schema version was recorded.'
          : 'This application requires a database, but no Supabase project is connected.',
      ),
    );
  }

  const environment = input.environmentSummary;
  const environmentScore =
    environment.variables.length === 0 ? 1 : environment.resolvedCount / environment.variables.length;
  dimensions.push(
    dimension(
      'environment',
      'Environment',
      WEIGHTS.environment,
      environmentScore,
      environment.variables.length === 0
        ? 'This application declares no environment variables.'
        : `${environment.resolvedCount}/${environment.variables.length} variables resolved automatically; ${environment.manualCount} need manual entry.`,
    ),
  );

  const manifestKnown = input.generationMetadata.manifestVersion !== undefined;
  dimensions.push(
    dimension(
      'manifest',
      'Application Manifest',
      WEIGHTS.manifest,
      manifestKnown ? (input.applicationSummary.routes.length > 0 ? 1 : 0.7) : 0,
      manifestKnown
        ? `Manifest v${input.generationMetadata.manifestVersion} with ${input.applicationSummary.totalFiles} planned files and ${input.applicationSummary.routes.length} declared routes.`
        : 'No Application Manifest was found for this project.',
    ),
  );

  const features = input.featureInventory;
  dimensions.push(
    dimension(
      'features',
      'Feature inventory',
      WEIGHTS.features,
      features.features.length === 0 ? 0 : features.implementedCount > 0 ? 1 : 0.5,
      features.features.length === 0
        ? 'No features could be sourced from the Feature registry or the Manifest scope.'
        : `${features.features.length} delivered items, ${features.implementedCount} implemented, ${features.verifiedCount} verified.`,
    ),
  );

  const hasBlueprint = Boolean(input.blueprintSummary.name);
  dimensions.push(
    dimension(
      'blueprint',
      'Blueprint',
      WEIGHTS.blueprint,
      hasBlueprint ? 1 : 0,
      hasBlueprint ? `Built from the ${input.blueprintSummary.name} blueprint.` : 'No blueprint is recorded.',
    ),
  );

  dimensions.push(
    dimension(
      'documentation',
      'Documentation',
      WEIGHTS.documentation,
      input.documentation.available ? (input.documentation.missingSections.length === 0 ? 1 : 0.6) : 0,
      input.documentation.available
        ? `${input.documentation.sections.length} engineering document sections assembled, ${input.documentation.missingSections.length} missing.`
        : 'No assembled Product Package was found for this project.',
    ),
  );

  const adminReady = Boolean(input.adminGuide.previewUrl && input.adminGuide.repositoryUrl);
  dimensions.push(
    dimension(
      'admin_guide',
      'Admin guide',
      WEIGHTS.adminGuide,
      adminReady ? 1 : input.adminGuide.procedures.length > 0 ? 0.5 : 0,
      adminReady
        ? 'Preview URL and repository are both available to the customer.'
        : 'The admin guide is missing the preview URL or repository link.',
    ),
  );

  const checklist = input.acceptanceChecklist;
  const gradeable = checklist.items.filter((item) => !item.customerAction && item.state !== 'not_applicable');
  const satisfied = gradeable.filter((item) => item.state === 'satisfied').length;
  dimensions.push(
    dimension(
      'acceptance_checklist',
      'Acceptance checklist',
      WEIGHTS.acceptanceChecklist,
      gradeable.length === 0 ? 0 : satisfied / gradeable.length,
      `${satisfied}/${gradeable.length} platform-side checklist items satisfied; ${checklist.customerActionCount} await the customer.`,
    ),
  );

  const totalWeight = dimensions.reduce((sum, entry) => sum + entry.weight, 0);
  const weighted = dimensions.reduce((sum, entry) => sum + entry.weight * entry.score, 0);
  const score = totalWeight === 0 ? 0 : Math.round((weighted / totalWeight) * 100);

  return { score, level: resolveCompletenessLevel(score), dimensions };
}
