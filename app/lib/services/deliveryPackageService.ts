import { getActiveApplicationManifest } from '~/lib/application-manifest/applicationManifestRepository';
import type { ApplicationManifest } from '~/lib/application-manifest/manifestTypes';
import { blueprintEngine } from '~/lib/blueprints';
import { calculateDeliveryCompleteness } from '~/lib/deployment/deliveryCompleteness';
import {
  DELIVERY_GENERATOR_VERSION,
  DELIVERY_PACKAGE_MODEL_VERSION,
  type DeliveryAcceptanceChecklist,
  type DeliveryAdminGuide,
  type DeliveryApplicationSummary,
  type DeliveryBlueprintSummary,
  type DeliveryBusinessSummary,
  type DeliveryChecklistItem,
  type DeliveryDatabaseInformation,
  type DeliveryDeploymentSummary,
  type DeliveryDocumentationIndex,
  type DeliveryEnvironmentSummary,
  type DeliveryFeatureInventory,
  type DeliveryGenerationMetadata,
  type DeliveryLimitation,
  type DeliveryPackage,
  type DeliveryProjectInformation,
  type DeliveryRecommendation,
  type DeliveryRepositoryInformation,
  type DeliverySupportInformation,
  type DeliveryVerificationSummary,
} from '~/lib/deployment/deliveryPackageTypes';
import { buildFeatureInventory } from '~/lib/deployment/deliveryFeatureInventory';
import { deploymentRepository } from '~/lib/deployment/deploymentRepository';
import type { DeploymentHistoryEvent, DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import type { DeploymentVerification } from '~/lib/deployment/verificationTypes';
import type { Feature } from '~/lib/features/featureTypes';
import { resolveActiveMvpFeatures } from '~/lib/features/featureRepository';
import type { Mvp } from '~/lib/mvp/mvpTypes';
import { getMvpById } from '~/lib/mvp/mvpRepository';
import { getProductPackage } from '~/lib/product-assembly/assemblyRepository';
import type { ProductPackage } from '~/lib/product-assembly/assemblyTypes';
import type { Project } from '~/lib/stores/projects';
import {
  assessEnvironmentReadiness,
  type EnvironmentReadinessReport,
} from '~/lib/services/environmentReadinessService';

/**
 * Delivery Package Service — Sprint 93, Part 8.
 *
 * Assembles the customer handover artifact from what Builders already knows. Two halves, split the
 * way `deploymentVerificationService.ts` (Sprint 92) established:
 *
 *  - `collectDeliveryPackageInputs` — READS every contributing domain. No writes, no mutations.
 *  - `buildDeliveryPackage` — PURE and synchronous. Same inputs always produce the same package,
 *    which is what makes the whole thing unit-testable without a database.
 *
 * Neither writes to BuildersDB. Persistence and the lifecycle transition belong to
 * `deploymentRepository.recordDeliveryPackage`; composition belongs to `deliveryPackageRunner.ts`.
 *
 * NEVER FABRICATES. Every section is built from a real artifact, and where an artifact is absent
 * the package says so (a stated `reason`, an empty list with a `note`) rather than inventing a
 * plausible value. A handover document that overstates what was delivered is the one failure mode
 * this sprint most needs to avoid.
 *
 * NEVER LEAKS SECRETS. Environment variables appear as NAMES plus a resolved/missing status — the
 * report this consumes (`environmentReadinessService.ts`) already refuses to carry a value for a
 * sensitive variable, and `toEnvironmentSummary` drops `value` unconditionally regardless.
 */

export interface DeliveryPackageInputs {
  project: Project;
  deployment: DeploymentWithProviders;
  history: DeploymentHistoryEvent[];
  verification: DeploymentVerification | null;
  manifest: ApplicationManifest | null;
  features: Feature[];
  mvp: Mvp | null;
  productPackage: ProductPackage | null;
  environmentReport: EnvironmentReadinessReport;

  /** 1-based attempt number for this deployment — allocated by the repository, passed in so the pure builder stays pure. */
  packageNumber: number;
  generatedBy?: string;

  /** Injectable for deterministic tests. */
  clock?: () => string;
}

/** Reads every contributing domain for one project. Returns `null` only when there is no Deployment at all — everything else degrades to a stated absence. */
export async function collectDeliveryPackageInputs(
  project: Project,
  options: { packageNumber: number; generatedBy?: string } = { packageNumber: 1 },
): Promise<DeliveryPackageInputs | null> {
  const deployment = await deploymentRepository.getDeploymentWithProviders(project.id);

  if (!deployment) {
    return null;
  }

  const [history, verification, manifest, features, productPackage] = await Promise.all([
    deploymentRepository.getDeploymentHistory(deployment.id),
    deploymentRepository.getLatestDeploymentVerification(deployment.id),
    getActiveApplicationManifest(project.id),
    resolveActiveMvpFeatures(project.id),
    getProductPackage(project.id),
  ]);

  const mvp = manifest?.mvpId ? await getMvpById(manifest.mvpId) : null;

  const environmentReport = assessEnvironmentReadiness({
    environmentRequirements: manifest?.environmentRequirements ?? [],
    github: deployment.github,
    supabase: deployment.supabase,
  });

  return {
    project,
    deployment,
    history,
    verification,
    manifest,
    features,
    mvp,
    productPackage,
    environmentReport,
    packageNumber: options.packageNumber,
    generatedBy: options.generatedBy,
  };
}

function latestEvent(history: DeploymentHistoryEvent[], eventTypes: string[]): DeploymentHistoryEvent | undefined {
  return history.find((event) => eventTypes.includes(event.eventType));
}

function normaliseUrl(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function toProjectInformation(project: Project): DeliveryProjectInformation {
  return {
    projectId: project.id,
    projectName: project.name,
    description: project.description,
    projectType: project.projectType,
    createdAt: project.createdAt,
  };
}

function toApplicationSummary(manifest: ApplicationManifest | null): DeliveryApplicationSummary {
  return {
    framework: manifest?.framework ?? 'unknown',
    packageManager: manifest?.packageManager ?? 'unknown',
    entryFile: manifest?.entryFile ?? 'unknown',
    buildCommand: manifest?.buildCommand,
    outputDirectory: manifest?.outputDirectory,
    runtimeRequirements: manifest?.runtimeRequirements ?? [],
    requiredServices: manifest?.requiredServices ?? [],
    routes: (manifest?.routes ?? []).map((route) => ({ path: route.path, name: route.name })),
    totalFiles: manifest?.totalFiles ?? 0,
    completedFiles: manifest?.completedFiles ?? 0,
    dependencies: Object.keys(manifest?.dependencies ?? {}).sort(),
  };
}

function toBusinessSummary(
  project: Project,
  mvp: Mvp | null,
  blueprintProductType?: string,
  targetUsers?: string,
): DeliveryBusinessSummary {
  return {
    theme: mvp?.theme,
    targetUsers,
    productType: blueprintProductType,
    description: project.description,
  };
}

function toBlueprintSummary(project: Project): DeliveryBlueprintSummary {
  const blueprint = blueprintEngine.getBlueprint(project.blueprintId);

  return {
    blueprintId: project.blueprintId,
    name: blueprint?.name,
    category: blueprint?.category,
    productType: blueprint?.productType,
    recommendedStack: blueprint?.recommendedStack ?? [],
    recommendedIntegrations: blueprint?.recommendedIntegrations ?? [],
    packageProfile: project.packageSelection?.packageCode,
    regionalProfile: project.regionalSelection?.regionCode,
  };
}

function toRepositoryInformation(
  deployment: DeploymentWithProviders,
  history: DeploymentHistoryEvent[],
): DeliveryRepositoryInformation {
  const github = deployment.github;

  if (!github) {
    return { provider: 'none' };
  }

  const push = latestEvent(history, ['push_successful']);

  return {
    provider: 'github',
    repositoryFullName: github.repoFullName,
    repositoryUrl: github.repoUrl,
    branch: github.defaultBranch,
    visibility: github.visibility,
    lastCommit: push?.metadata?.commitSha as string | undefined,
    lastPushAt: push?.createdAt,
    connectionStatus: github.status,
  };
}

function toDatabaseInformation(project: Project, deployment: DeploymentWithProviders): DeliveryDatabaseInformation {
  const supabase = deployment.supabase;

  if (!supabase) {
    return { provider: 'none' };
  }

  const activation = project.databaseActivation;

  return {
    provider: 'supabase',
    projectRef: supabase.supabaseProjectRef,
    projectName: (supabase.metadata?.projectName as string | undefined) ?? activation?.connectionConfig?.projectName,
    projectUrl: supabase.supabaseProjectUrl,
    region: supabase.region ?? activation?.connectionConfig?.region,
    schemaVersion: (supabase.metadata?.schemaVersion as number | undefined) ?? activation?.schema?.schemaVersion,
    tableCount: activation?.schema?.tableCount,
    schemaAppliedAt: supabase.connectedAt,
    connectionStatus: supabase.status,
  };
}

/** Part 7's "never expose secrets": `value` is dropped unconditionally here, independent of whatever the upstream report chose to carry. */
function toEnvironmentSummary(report: EnvironmentReadinessReport): DeliveryEnvironmentSummary {
  return {
    ready: report.ready,
    fullyResolved: report.fullyResolved,
    variables: report.variables.map((variable) => ({
      name: variable.name,
      status: variable.status,
      source: variable.source,
      sensitive: variable.sensitive,
      detail: variable.detail,
    })),
    resolvedCount: report.resolvedVariables.length,
    manualCount: report.variables.filter((variable) => variable.status !== 'resolved').length,
  };
}

function toDeploymentSummary(
  deployment: DeploymentWithProviders,
  history: DeploymentHistoryEvent[],
): DeliveryDeploymentSummary {
  const vercel = deployment.vercel;

  if (!vercel) {
    return { lifecycleStatus: deployment.status, environment: deployment.environment, provider: 'none' };
  }

  const started = latestEvent(history, ['deployment_started']);
  const succeeded = latestEvent(history, ['deployment_succeeded']);
  const durationMs =
    started && succeeded && new Date(succeeded.createdAt) >= new Date(started.createdAt)
      ? new Date(succeeded.createdAt).getTime() - new Date(started.createdAt).getTime()
      : undefined;

  return {
    lifecycleStatus: deployment.status,
    environment: deployment.environment,
    provider: 'vercel',
    vercelProjectName: vercel.vercelProjectName,
    previewUrl: normaliseUrl((vercel.metadata?.latestDeploymentUrl as string | undefined) ?? vercel.productionUrl),
    latestDeploymentId: vercel.metadata?.latestDeploymentId as string | undefined,
    latestDeploymentState: vercel.metadata?.latestDeploymentState as string | undefined,
    deployedAt: (vercel.metadata?.latestDeploymentAt as string | undefined) ?? succeeded?.createdAt,
    deploymentDurationMs: durationMs,
    productionBranch: vercel.metadata?.productionBranch as string | undefined,
  };
}

function toVerificationSummary(verification: DeploymentVerification | null): DeliveryVerificationSummary {
  if (!verification) {
    return {
      verified: false,
      checksPassed: 0,
      checksFailed: 0,
      warnings: 0,
      requiredPassed: 0,
      requiredTotal: 0,
      categories: [],
    };
  }

  const categories = new Map<
    string,
    { passed: number; failed: number; warnings: number; skipped: number; unavailable: number }
  >();

  for (const check of verification.checks) {
    const entry = categories.get(check.category) ?? { passed: 0, failed: 0, warnings: 0, skipped: 0, unavailable: 0 };

    if (check.status === 'passed') {
      entry.passed += 1;
    } else if (check.status === 'failed') {
      entry.failed += 1;
    } else if (check.status === 'warning') {
      entry.warnings += 1;
    } else if (check.status === 'skipped') {
      entry.skipped += 1;
    } else if (check.status === 'unavailable') {
      entry.unavailable += 1;
    }

    categories.set(check.category, entry);
  }

  return {
    verified: true,
    status: verification.status,
    verificationId: verification.id,
    verificationNumber: verification.verificationNumber,
    policyVersion: verification.policyVersion,
    verifiedAt: verification.completedAt ?? verification.startedAt,
    durationMs: verification.durationMs,
    targetUrl: verification.targetUrl,
    checksPassed: verification.summary.passed,
    checksFailed: verification.summary.failed,
    warnings: verification.summary.warnings + verification.summary.unavailable,
    requiredPassed: verification.summary.requiredPassed,
    requiredTotal: verification.summary.requiredTotal,
    categories: [...categories.entries()].map(([category, counts]) => ({ category, ...counts })),
    blockingFailure: verification.summary.blockingFailure
      ? `${verification.summary.blockingFailure.name}: ${verification.summary.blockingFailure.errorMessage ?? 'required check failed'}`
      : undefined,
  };
}

function toDocumentationIndex(productPackage: ProductPackage | null): DeliveryDocumentationIndex {
  if (!productPackage) {
    return { available: false, sections: [], missingSections: [] };
  }

  return {
    available: true,
    sections: productPackage.sections.map((section) => ({
      id: section.id,
      label: section.label,
      fileCount: section.files.length,
    })),
    missingSections: productPackage.missingSections.map((missing) => ({
      id: missing.section,
      label: missing.label,
      reason: missing.reason,
    })),
  };
}

function toGenerationMetadata(manifest: ApplicationManifest | null): DeliveryGenerationMetadata {
  return {
    manifestId: manifest?.id,
    manifestVersion: manifest?.version,
    manifestStatus: manifest?.status,
    generatedAt: manifest?.completedAt ?? manifest?.persistedAt,
    totalFiles: manifest?.totalFiles ?? 0,
    completedFiles: manifest?.completedFiles ?? 0,
    failedFiles: manifest?.failedFiles ?? 0,
    planChecksum: manifest?.planChecksum,
  };
}

/**
 * Part 5 — every limitation traces to a real artifact. Nothing here is a generic caveat: if no
 * artifact reports a problem, the list is empty, and that is a legitimate outcome.
 */
function buildKnownLimitations(inputs: DeliveryPackageInputs): DeliveryLimitation[] {
  const limitations: DeliveryLimitation[] = [];
  const { manifest, verification, environmentReport, deployment, productPackage } = inputs;

  for (const description of manifest?.featureScope?.outOfScopeFeatureDescriptions ?? []) {
    limitations.push({
      id: `scope:${description.slice(0, 60)}`,
      title: 'Deferred to a future MVP',
      detail: description,
      severity: 'informational',
      source: 'manifest_scope',
    });
  }

  if ((manifest?.failedFiles ?? 0) > 0) {
    limitations.push({
      id: 'generation:failed_files',
      title: 'Some planned files were not generated',
      detail: `${manifest?.failedFiles} of ${manifest?.totalFiles} planned files failed generation and are absent from the delivered application.`,
      severity: 'attention',
      source: 'generation',
    });
  }

  for (const variable of environmentReport.variables.filter((entry) => entry.status !== 'resolved')) {
    limitations.push({
      id: `environment:${variable.name}`,
      title: `Manual configuration required: ${variable.name}`,
      detail: variable.detail,
      severity: variable.status === 'invalid' ? 'blocking' : 'attention',
      source: 'environment',
    });
  }

  if (verification) {
    for (const check of verification.checks) {
      if (check.status === 'failed') {
        limitations.push({
          id: `verification:${check.id}`,
          title: `Verification failure: ${check.name}`,
          detail: check.errorMessage ?? 'A required verification check failed.',
          severity: 'blocking',
          source: 'verification',
        });
      } else if (check.status === 'warning' || check.status === 'unavailable') {
        limitations.push({
          id: `verification:${check.id}`,
          title: `${check.status === 'warning' ? 'Verification warning' : 'Not verifiable'}: ${check.name}`,
          detail: check.errorMessage ?? 'This check did not pass cleanly, but it does not block delivery.',
          severity: 'informational',
          source: 'verification',
        });
      }
    }
  } else {
    limitations.push({
      id: 'verification:none',
      title: 'The live application has not been verified',
      detail:
        'No verification report exists for this deployment, so nothing confirms the live application is reachable.',
      severity: 'blocking',
      source: 'verification',
    });
  }

  if (!deployment.supabase && (manifest?.requiredServices ?? []).includes('Supabase')) {
    limitations.push({
      id: 'deployment:missing_supabase',
      title: 'Required database is not connected',
      detail:
        'The Application Manifest declares Supabase as a required service, but no Supabase project is connected to this Deployment.',
      severity: 'blocking',
      source: 'deployment',
    });
  }

  for (const missing of productPackage?.missingSections ?? []) {
    limitations.push({
      id: `documentation:${missing.section}`,
      title: `Missing documentation: ${missing.label}`,
      detail: missing.reason,
      severity: 'informational',
      source: 'documentation',
    });
  }

  return limitations;
}

/** Part 6 — every item is decided by a fact, and customer-side items stay `pending` because only the customer can complete them. */
function buildAcceptanceChecklist(
  inputs: DeliveryPackageInputs,
  deploymentSummary: DeliveryDeploymentSummary,
  verificationSummary: DeliveryVerificationSummary,
  environmentSummary: DeliveryEnvironmentSummary,
): DeliveryAcceptanceChecklist {
  const { deployment, manifest, verification, project } = inputs;
  const items: DeliveryChecklistItem[] = [];

  const push = (item: DeliveryChecklistItem) => items.push(item);

  push({
    id: 'application_reachable',
    label: 'Application reachable',
    state: verificationSummary.verified
      ? verification?.checks.find((check) => check.id === 'availability.http_response')?.status === 'passed'
        ? 'satisfied'
        : 'not_satisfied'
      : 'pending',
    evidence: verificationSummary.verified
      ? 'From the availability check in the latest verification report.'
      : 'No verification report exists yet.',
    customerAction: false,
  });

  push({
    id: 'deployment_verified',
    label: 'Deployment verified',
    state: !verificationSummary.verified
      ? 'pending'
      : verificationSummary.status === 'passed' || verificationSummary.status === 'warning'
        ? 'satisfied'
        : 'not_satisfied',
    evidence: verificationSummary.verified
      ? `Verification #${verificationSummary.verificationNumber} finished as "${verificationSummary.status}".`
      : 'No verification has been run.',
    customerAction: false,
  });

  push({
    id: 'preview_url',
    label: 'Preview URL working',
    state: deploymentSummary.previewUrl ? (verificationSummary.verified ? 'satisfied' : 'pending') : 'not_satisfied',
    evidence: deploymentSummary.previewUrl
      ? `Deployment URL recorded: ${deploymentSummary.previewUrl}`
      : 'No deployment URL is recorded on the Vercel provider.',
    customerAction: false,
  });

  push({
    id: 'repository_linked',
    label: 'Repository linked',
    state: deployment.github?.repoFullName ? 'satisfied' : 'not_satisfied',
    evidence: deployment.github?.repoFullName
      ? `Connected to ${deployment.github.repoFullName}.`
      : 'No GitHub repository is connected.',
    customerAction: false,
  });

  const requiresDatabase = (manifest?.requiredServices ?? []).includes('Supabase');
  push({
    id: 'database_connected',
    label: 'Database connected',
    state: !requiresDatabase ? 'not_applicable' : deployment.supabase ? 'satisfied' : 'not_satisfied',
    evidence: !requiresDatabase
      ? 'This application declares no database dependency.'
      : deployment.supabase
        ? `Connected to Supabase project ${deployment.supabase.supabaseProjectRef ?? '(ref not recorded)'}.`
        : 'A database is required but none is connected.',
    customerAction: false,
  });

  const schemaVersion = project.databaseActivation?.schema?.schemaVersion;
  push({
    id: 'database_schema_applied',
    label: 'Database schema applied',
    state: !requiresDatabase
      ? 'not_applicable'
      : project.databaseActivation?.connection?.verified
        ? 'satisfied'
        : schemaVersion !== undefined
          ? 'pending'
          : 'not_satisfied',
    evidence: !requiresDatabase
      ? 'This application declares no database dependency.'
      : project.databaseActivation?.connection?.verified
        ? 'The Database Activation connection check confirmed the schema.'
        : schemaVersion !== undefined
          ? `Schema v${schemaVersion} was generated but its application was not confirmed.`
          : 'No generated schema is recorded for this project.',
    customerAction: false,
  });

  push({
    id: 'environment_configured',
    label: 'Environment configured',
    state:
      environmentSummary.variables.length === 0
        ? 'not_applicable'
        : environmentSummary.fullyResolved
          ? 'satisfied'
          : 'pending',
    evidence:
      environmentSummary.variables.length === 0
        ? 'This application declares no environment variables.'
        : `${environmentSummary.resolvedCount}/${environmentSummary.variables.length} variables resolved; ${environmentSummary.manualCount} entered manually at deploy time.`,
    customerAction: false,
  });

  const authRoutes = (manifest?.routes ?? []).filter((route) =>
    /login|sign-?in|sign-?up|register|auth/i.test(route.path),
  );
  const authChecks = verification?.checks.filter((check) => check.category === 'authentication') ?? [];
  const authVerified = authChecks.some((check) => check.status === 'passed');
  push({
    id: 'authentication_configured',
    label: 'Authentication configured',
    state: authRoutes.length === 0 ? 'not_applicable' : authVerified ? 'satisfied' : 'pending',
    evidence:
      authRoutes.length === 0
        ? 'This application declares no authentication route.'
        : authVerified
          ? 'Authentication readiness was confirmed by the latest verification report.'
          : 'Authentication routes are declared but readiness has not been confirmed.',
    customerAction: false,
  });

  const routeChecks = verification?.checks.filter((check) => check.category === 'route') ?? [];
  const requiredRouteChecks = routeChecks.filter((check) => check.required);
  push({
    id: 'primary_routes_verified',
    label: 'Primary routes verified',
    state:
      requiredRouteChecks.length === 0
        ? verificationSummary.verified
          ? 'not_applicable'
          : 'pending'
        : requiredRouteChecks.every((check) => check.status === 'passed')
          ? 'satisfied'
          : 'not_satisfied',
    evidence:
      requiredRouteChecks.length === 0
        ? 'No additional application routes were declared, so only the root route was verified.'
        : `${requiredRouteChecks.filter((check) => check.status === 'passed').length}/${requiredRouteChecks.length} required route checks passed.`,
    customerAction: false,
  });

  const assetChecks = verification?.checks.filter((check) => check.category === 'asset' && check.required) ?? [];
  push({
    id: 'assets_verified',
    label: 'Assets verified',
    state:
      assetChecks.length === 0
        ? verificationSummary.verified
          ? 'not_applicable'
          : 'pending'
        : assetChecks.every((check) => check.status === 'passed')
          ? 'satisfied'
          : 'not_satisfied',
    evidence:
      assetChecks.length === 0
        ? 'No critical assets were discovered to verify.'
        : `${assetChecks.filter((check) => check.status === 'passed').length}/${assetChecks.length} critical assets loaded.`,
    customerAction: false,
  });

  push({
    id: 'customer_review',
    label: 'Customer review',
    state: 'pending',
    evidence: 'Awaiting the customer — Builders does not record customer review in this sprint.',
    customerAction: true,
  });

  push({
    id: 'customer_acceptance',
    label: 'Customer acceptance',
    state: 'pending',
    evidence: 'Awaiting the customer — formal acceptance is out of scope until Release Management.',
    customerAction: true,
  });

  return {
    items,
    satisfiedCount: items.filter((item) => item.state === 'satisfied').length,
    outstandingCount: items.filter((item) => item.state === 'not_satisfied' || item.state === 'pending').length,
    customerActionCount: items.filter((item) => item.customerAction).length,
  };
}

/** Part 7 — operational facts and procedures only. No token, key or password can reach this section: nothing upstream of it holds one. */
function buildAdminGuide(
  inputs: DeliveryPackageInputs,
  deploymentSummary: DeliveryDeploymentSummary,
  repositoryInformation: DeliveryRepositoryInformation,
  databaseInformation: DeliveryDatabaseInformation,
  environmentSummary: DeliveryEnvironmentSummary,
): DeliveryAdminGuide {
  const procedures: DeliveryAdminGuide['procedures'] = [
    {
      id: 'redeploy',
      title: 'How to redeploy',
      steps: [
        'Open the project in Builders and go to the Deployment card.',
        'Push the latest generated code to GitHub if it has changed.',
        'Use "Deploy to Vercel" — Builders reuses the existing Vercel project rather than creating a second one.',
        'Once the deployment finishes, run "Retry Verification" to confirm the new build is actually serving.',
      ],
    },
    {
      id: 'reconnect_providers',
      title: 'How to reconnect providers',
      steps: [
        'GitHub: reconnect from Deploy → GitHub. The existing repository is reused; the Deployment record is updated, not replaced.',
        'Supabase: reconnect from the Database card. The public project URL is re-recorded; no key is ever stored by Builders.',
        'Vercel: re-enter your Vercel access token in the deploy dialog. Builders holds it in memory for that operation only.',
      ],
    },
    {
      id: 'support',
      title: 'How to contact support',
      steps: [
        'Contact the team that delivered this project — Builders does not store support contact details, so they are not reproduced here.',
        'Provide the project name, the deployment URL and the verification number from this package when reporting an issue.',
      ],
    },
  ];

  return {
    previewUrl: deploymentSummary.previewUrl,
    repositoryUrl: repositoryInformation.repositoryUrl,
    branch: repositoryInformation.branch,
    supabaseProjectUrl: databaseInformation.projectUrl,
    vercelProjectName: deploymentSummary.vercelProjectName,
    deployedAt: deploymentSummary.deployedAt,
    buildVersion:
      inputs.manifest?.version !== undefined
        ? `Manifest v${inputs.manifest.version}${inputs.mvp?.code ? ` (${inputs.mvp.code})` : ''}`
        : undefined,
    environmentVariables: environmentSummary.variables.map((variable) => ({
      name: variable.name,
      status: variable.status,
      requiresManualEntry: variable.status !== 'resolved',
    })),
    procedures,
  };
}

function buildSupportInformation(
  repositoryInformation: DeliveryRepositoryInformation,
  databaseInformation: DeliveryDatabaseInformation,
): DeliverySupportInformation {
  const consoles: DeliverySupportInformation['consoles'] = [];

  if (repositoryInformation.repositoryUrl) {
    consoles.push({ label: 'GitHub repository', url: repositoryInformation.repositoryUrl });
  }

  if (databaseInformation.projectRef) {
    consoles.push({
      label: 'Supabase dashboard',
      url: `https://supabase.com/dashboard/project/${databaseInformation.projectRef}`,
    });
  }

  consoles.push({ label: 'Vercel dashboard', url: 'https://vercel.com/dashboard' });

  return {
    contacts: [],
    note: 'Builders does not maintain a contact registry, so no named technical contact is asserted here. The delivering team should add their own contact details before handover.',
    consoles,
  };
}

/** Recommendations are derived from what the artifacts actually show is absent — never generic best-practice filler. */
function buildFutureRecommendations(
  inputs: DeliveryPackageInputs,
  verificationSummary: DeliveryVerificationSummary,
  environmentSummary: DeliveryEnvironmentSummary,
): DeliveryRecommendation[] {
  const recommendations: DeliveryRecommendation[] = [];
  const deferred = inputs.manifest?.featureScope?.outOfScopeFeatureDescriptions ?? [];

  if (deferred.length > 0) {
    recommendations.push({
      id: 'deferred_scope',
      title: 'Plan the deferred scope into a following MVP',
      detail: `${deferred.length} feature(s) were explicitly deferred during scoping and are listed under Known Limitations.`,
    });
  }

  if (!environmentSummary.fullyResolved && environmentSummary.variables.length > 0) {
    recommendations.push({
      id: 'environment_automation',
      title: 'Record the manually-entered environment values with your own secret manager',
      detail: `${environmentSummary.manualCount} variable(s) are entered by hand at deploy time and are never stored by Builders.`,
    });
  }

  if (verificationSummary.verified && verificationSummary.warnings > 0) {
    recommendations.push({
      id: 'verification_warnings',
      title: 'Review the advisory verification warnings',
      detail: `${verificationSummary.warnings} advisory item(s) did not block delivery but are worth addressing — see the Verification section.`,
    });
  }

  if (!inputs.deployment.supabase) {
    recommendations.push({
      id: 'no_database',
      title: 'Confirm the data strategy before real customer use',
      detail: 'This delivery has no connected database, so any application data is not persisted by a managed service.',
    });
  }

  return recommendations;
}

/** Pure and synchronous — the same inputs always produce the same package. Returns a deeply frozen value (Part 8: "one immutable package"). */
export function buildDeliveryPackage(inputs: DeliveryPackageInputs): DeliveryPackage {
  const clock = inputs.clock ?? (() => new Date().toISOString());

  const projectInformation = toProjectInformation(inputs.project);
  const blueprintSummary = toBlueprintSummary(inputs.project);
  const blueprint = blueprintEngine.getBlueprint(inputs.project.blueprintId);
  const applicationSummary = toApplicationSummary(inputs.manifest);
  const businessSummary = toBusinessSummary(inputs.project, inputs.mvp, blueprint?.productType, blueprint?.targetUsers);
  const repositoryInformation = toRepositoryInformation(inputs.deployment, inputs.history);
  const databaseInformation = toDatabaseInformation(inputs.project, inputs.deployment);
  const environmentSummary = toEnvironmentSummary(inputs.environmentReport);
  const deploymentSummary = toDeploymentSummary(inputs.deployment, inputs.history);
  const verificationSummary = toVerificationSummary(inputs.verification);
  const documentation = toDocumentationIndex(inputs.productPackage);
  const generationMetadata = toGenerationMetadata(inputs.manifest);

  const featureInventory: DeliveryFeatureInventory = buildFeatureInventory({
    features: inputs.features,
    manifest: inputs.manifest,
    deployment: inputs.deployment,
    verification: inputs.verification,
  });

  const acceptanceChecklist = buildAcceptanceChecklist(
    inputs,
    deploymentSummary,
    verificationSummary,
    environmentSummary,
  );

  const adminGuide = buildAdminGuide(
    inputs,
    deploymentSummary,
    repositoryInformation,
    databaseInformation,
    environmentSummary,
  );

  const completeness = calculateDeliveryCompleteness({
    deploymentSummary,
    verificationSummary,
    repositoryInformation,
    databaseInformation,
    environmentSummary,
    applicationSummary,
    generationMetadata,
    featureInventory,
    blueprintSummary,
    documentation,
    adminGuide,
    acceptanceChecklist,
    requiresDatabase: (inputs.manifest?.requiredServices ?? []).includes('Supabase'),
  });

  const pkg: DeliveryPackage = {
    projectInformation,
    applicationSummary,
    businessSummary,
    blueprintSummary,
    versionSummary: {
      manifestVersion: inputs.manifest?.version,
      mvpCode: inputs.mvp?.code ?? inputs.manifest?.mvpCode,
      mvpStatus: inputs.mvp?.status,
      targetRelease: inputs.mvp?.targetRelease,
      packageNumber: inputs.packageNumber,
    },
    deploymentSummary,
    verificationSummary,
    featureInventory,
    knownLimitations: buildKnownLimitations(inputs),
    repositoryInformation,
    databaseInformation,
    environmentSummary,
    acceptanceChecklist,
    adminGuide,
    futureRecommendations: buildFutureRecommendations(inputs, verificationSummary, environmentSummary),
    documentation,
    support: buildSupportInformation(repositoryInformation, databaseInformation),
    generationMetadata,
    completeness,
    packageMetadata: {
      packageVersion: DELIVERY_PACKAGE_MODEL_VERSION,
      generatorVersion: DELIVERY_GENERATOR_VERSION,
      deliveredAt: clock(),
      generatedBy: inputs.generatedBy,
      sources: [
        { source: 'deployment', available: true, detail: `Deployment ${inputs.deployment.status}` },
        {
          source: 'verification',
          available: inputs.verification !== null,
          detail: inputs.verification ? `Verification #${inputs.verification.verificationNumber}` : 'No report',
        },
        {
          source: 'application_manifest',
          available: inputs.manifest !== null,
          detail: inputs.manifest ? `v${inputs.manifest.version}` : 'No active manifest',
        },
        {
          source: 'feature_registry',
          available: inputs.features.length > 0,
          detail: `${inputs.features.length} feature row(s)`,
        },
        { source: 'mvp', available: inputs.mvp !== null, detail: inputs.mvp?.code ?? 'No MVP recorded' },
        {
          source: 'product_package',
          available: inputs.productPackage !== null,
          detail: inputs.productPackage ? `${inputs.productPackage.sections.length} section(s)` : 'Not assembled',
        },
        {
          source: 'blueprint',
          available: Boolean(blueprint),
          detail: blueprint?.name ?? 'No blueprint recorded',
        },
      ],
    },
  };

  return deepFreeze(pkg);
}

/** One immutable package (Part 8) — a caller cannot mutate what was persisted, so a rendered export and the stored row can never diverge. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);

    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }

  return value;
}
