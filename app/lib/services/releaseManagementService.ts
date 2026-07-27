import { getActiveApplicationManifest } from '~/lib/application-manifest/applicationManifestRepository';
import type { ApplicationManifest } from '~/lib/application-manifest/manifestTypes';
import { blueprintEngine } from '~/lib/blueprints';
import { fnv1aHash } from '~/lib/checksum/fnv1a';
import type { DeliveryPackageRecord } from '~/lib/deployment/deliveryPackageTypes';
import { deploymentRepository } from '~/lib/deployment/deploymentRepository';
import type { DeploymentHistoryEvent, DeploymentWithProviders } from '~/lib/deployment/deploymentTypes';
import { buildReleaseNotes } from '~/lib/deployment/releaseNotes';
import {
  RELEASE_MODEL_VERSION,
  type Release,
  type ReleaseBaseline,
  type ReleaseIntegrity,
  type ReleaseIntegrityCheck,
  type ReleaseRecord,
} from '~/lib/deployment/releaseTypes';
import { validateReleaseVersion, type ReleaseType } from '~/lib/deployment/semanticVersion';
import type { DeploymentVerification } from '~/lib/deployment/verificationTypes';
import type { Project } from '~/lib/stores/projects';

/**
 * Release Management Service — Sprint 94, Part 6.
 *
 * Turns a `delivery_ready` Deployment into an immutable Release baseline. Two halves, the same
 * split Sprints 92 and 93 established:
 *
 *  - `collectReleaseInputs` — READS the contributing domains. No writes, no mutations.
 *  - `buildRelease` — PURE and synchronous, returning a deeply frozen `Release`.
 *
 * Neither writes to BuildersDB. Persistence, the lifecycle transition and the history event belong
 * to `deploymentRepository.createRelease`; composition belongs to `releaseManagementRunner.ts`.
 *
 * WHAT "FREEZE" MEANS HERE. The manifest, the delivery package, the verification report and every
 * provider row keep changing after a release — that is normal and expected. A Release must not.
 * So `buildRelease` captures identity AND the few version/checksum facts a future comparison will
 * need (Part 8), computes a checksum over them, and never stores a second mutable copy of anything
 * else. The release notes are the one derived artifact, and they are a projection of the delivery
 * package that was current at release time (Part 4).
 *
 * NEVER A PARTIAL RELEASE (Part 14). `buildRelease` refuses — returning a rejection rather than a
 * half-built release — when the version is invalid or a REQUIRED integrity check fails. There is
 * no code path that produces a `Release` with a missing delivery package, verification or
 * deployment URL.
 */

export interface ReleaseInputs {
  project: Project;
  deployment: DeploymentWithProviders;
  history: DeploymentHistoryEvent[];
  deliveryPackage: DeliveryPackageRecord | null;
  verification: DeploymentVerification | null;
  manifest: ApplicationManifest | null;

  /** Existing releases for this deployment, newest first — for the release number, the previous version and duplicate rejection. */
  existingReleases: ReleaseRecord[];
}

/** Reads every contributing domain. Returns `null` only when the project has no Deployment at all. */
export async function collectReleaseInputs(project: Project): Promise<ReleaseInputs | null> {
  const deployment = await deploymentRepository.getDeploymentWithProviders(project.id);

  if (!deployment) {
    return null;
  }

  const [history, deliveryPackage, verification, manifest, existingReleases] = await Promise.all([
    deploymentRepository.getDeploymentHistory(deployment.id),
    deploymentRepository.getLatestDeliveryPackage(deployment.id),
    deploymentRepository.getLatestDeploymentVerification(deployment.id),
    getActiveApplicationManifest(project.id),
    deploymentRepository.listReleases(deployment.id),
  ]);

  return { project, deployment, history, deliveryPackage, verification, manifest, existingReleases };
}

export interface BuildReleaseParams {
  inputs: ReleaseInputs;

  /** The operator's explicit version. Never derived, never auto-incremented (Part 3). */
  semanticVersion: string;

  /** The operator's explicit intent. Recorded even when the typed version implies something else. */
  releaseType: ReleaseType;

  /** Optional human name, e.g. "Launch". Defaults to the version itself rather than an invented codename. */
  releaseName?: string;
  createdBy?: string;
  clock?: () => string;
}

export type BuildReleaseRejectionCode = 'invalid_version' | 'integrity';

export type BuildReleaseResult =
  | { ok: true; release: Release }
  | { ok: false; code: BuildReleaseRejectionCode; message: string; integrity?: ReleaseIntegrity };

function latestEvent(history: DeploymentHistoryEvent[], eventTypes: string[]): DeploymentHistoryEvent | undefined {
  return history.find((event) => eventTypes.includes(event.eventType));
}

/** Part 8 — captured once, never updated. Everything here is either an id or a version/checksum a future diff needs. */
function buildBaseline(inputs: ReleaseInputs, capturedAt: string): ReleaseBaseline {
  const { deployment, manifest, deliveryPackage, verification, project, history } = inputs;
  const blueprint = blueprintEngine.getBlueprint(project.blueprintId);
  const push = latestEvent(history, ['push_successful']);
  const vercel = deployment.vercel;
  const deploymentUrl = (vercel?.metadata?.latestDeploymentUrl as string | undefined) ?? vercel?.productionUrl;

  return {
    capturedAt,
    deploymentId: deployment.id,
    projectId: deployment.projectId,

    manifestId: manifest?.id,
    manifestVersion: manifest?.version,
    manifestPlanChecksum: manifest?.planChecksum,
    manifestSourceContentChecksum: manifest?.sourceContentChecksum,

    deliveryPackageId: deliveryPackage?.id,
    deliveryPackageNumber: deliveryPackage?.packageNumber,
    deliveryPackageVersion: deliveryPackage?.packageVersion,

    verificationId: verification?.id,
    verificationNumber: verification?.verificationNumber,
    verificationStatus: verification?.status,
    verificationPolicyVersion: verification?.policyVersion,

    blueprintId: project.blueprintId,
    blueprintVersion: blueprint?.version,

    mvpId: manifest?.mvpId,
    mvpCode: manifest?.mvpCode,

    repositoryFullName: deployment.github?.repoFullName,
    repositoryUrl: deployment.github?.repoUrl,
    branch: deployment.github?.defaultBranch,
    gitCommit: push?.metadata?.commitSha as string | undefined,

    supabaseProjectRef: deployment.supabase?.supabaseProjectRef,
    supabaseProjectUrl: deployment.supabase?.supabaseProjectUrl,
    schemaVersion:
      (deployment.supabase?.metadata?.schemaVersion as number | undefined) ??
      project.databaseActivation?.schema?.schemaVersion,

    vercelProjectName: vercel?.vercelProjectName,
    vercelDeploymentId: vercel?.metadata?.latestDeploymentId as string | undefined,
    deploymentUrl: deploymentUrl
      ? /^https?:\/\//i.test(deploymentUrl)
        ? deploymentUrl
        : `https://${deploymentUrl}`
      : undefined,
  };
}

/**
 * Part 6 — "calculate release integrity". A release must reference a real, verified, delivered
 * application; the REQUIRED checks below are the conditions under which that sentence is true, and
 * an unsatisfied one refuses the release rather than producing a partial one.
 */
export function calculateReleaseIntegrity(inputs: ReleaseInputs, baseline: ReleaseBaseline): ReleaseIntegrity {
  const { deliveryPackage, verification } = inputs;

  const checks: ReleaseIntegrityCheck[] = [
    {
      id: 'delivery_package',
      label: 'Delivery package',
      required: true,
      satisfied: Boolean(deliveryPackage),
      detail: deliveryPackage
        ? `Delivery package #${deliveryPackage.packageNumber} (${deliveryPackage.completenessScore}% complete).`
        : 'No delivery package has been generated for this deployment.',
    },
    {
      id: 'verification',
      label: 'Live verification',
      required: true,
      satisfied: verification !== null && (verification.status === 'passed' || verification.status === 'warning'),
      detail: verification
        ? `Verification #${verification.verificationNumber} finished as "${verification.status}".`
        : 'This deployment has never been verified.',
    },
    {
      id: 'deployment_url',
      label: 'Deployment URL',
      required: true,
      satisfied: Boolean(baseline.deploymentUrl),
      detail: baseline.deploymentUrl
        ? `Released application is served at ${baseline.deploymentUrl}.`
        : 'No deployment URL is recorded on the Vercel provider.',
    },
    {
      id: 'repository',
      label: 'Source repository',
      required: true,
      satisfied: Boolean(baseline.repositoryFullName),
      detail: baseline.repositoryFullName
        ? `Baselined against ${baseline.repositoryFullName}${baseline.gitCommit ? ` @ ${baseline.gitCommit.slice(0, 10)}` : ''}.`
        : 'No GitHub repository is connected, so this release has no source baseline.',
    },
    {
      id: 'manifest',
      label: 'Application Manifest',
      required: true,
      satisfied: baseline.manifestVersion !== undefined,
      detail:
        baseline.manifestVersion !== undefined
          ? `Baselined against manifest v${baseline.manifestVersion}.`
          : 'No active Application Manifest was found, so there is nothing to baseline future changes against.',
    },
    {
      id: 'git_commit',
      label: 'Source commit',
      required: false,
      satisfied: Boolean(baseline.gitCommit),
      detail: baseline.gitCommit
        ? `Commit ${baseline.gitCommit} recorded from the last successful push.`
        : 'No commit was recorded in Deployment History for this deployment.',
    },
    {
      id: 'database',
      label: 'Database baseline',
      required: false,
      satisfied: Boolean(baseline.supabaseProjectRef),
      detail: baseline.supabaseProjectRef
        ? `Supabase project ${baseline.supabaseProjectRef}${baseline.schemaVersion !== undefined ? ` at schema v${baseline.schemaVersion}` : ''}.`
        : 'No database is connected to this deployment.',
    },
  ];

  /*
   * Deterministic over the baseline's own values — the same baseline always fingerprints the same,
   * and any later edit to a stored release's baseline no longer matches its checksum.
   */
  const checksum = fnv1aHash(
    JSON.stringify({
      deploymentId: baseline.deploymentId,
      manifestVersion: baseline.manifestVersion,
      manifestPlanChecksum: baseline.manifestPlanChecksum,
      deliveryPackageId: baseline.deliveryPackageId,
      verificationId: baseline.verificationId,
      gitCommit: baseline.gitCommit,
      deploymentUrl: baseline.deploymentUrl,
      schemaVersion: baseline.schemaVersion,
    }),
  );

  return { complete: checks.every((check) => !check.required || check.satisfied), checks, checksum };
}

/** Pure and synchronous. Refuses rather than half-building (Part 14). */
export function buildRelease(params: BuildReleaseParams): BuildReleaseResult {
  const { inputs } = params;
  const clock = params.clock ?? (() => new Date().toISOString());
  const releaseDate = clock();

  const previousVersion = inputs.existingReleases[0]?.semanticVersion;
  const versionCheck = validateReleaseVersion({
    version: params.semanticVersion,
    intendedType: params.releaseType,
    previousVersion,
    existingVersions: inputs.existingReleases.map((release) => release.semanticVersion),
  });

  if (!versionCheck.ok) {
    return { ok: false, code: 'invalid_version', message: versionCheck.message };
  }

  const baseline = buildBaseline(inputs, releaseDate);
  const integrity = calculateReleaseIntegrity(inputs, baseline);

  if (!integrity.complete) {
    const blocking = integrity.checks.filter((check) => check.required && !check.satisfied);

    return {
      ok: false,
      code: 'integrity',
      message: `This deployment cannot be released yet — ${blocking.map((check) => check.detail).join(' ')}`,
      integrity,
    };
  }

  const release: Release = {
    releaseNumber: (inputs.existingReleases[0]?.releaseNumber ?? 0) + 1,
    semanticVersion: versionCheck.version,
    releaseName: params.releaseName?.trim() || `v${versionCheck.version}`,

    /*
     * The operator's stated intent is what is stored — the version they typed may classify
     * differently (they might type 2.0.0 while selecting "minor"), which is recorded in
     * `metadata.intentMatchesVersion` rather than silently overridden.
     */
    releaseType: params.releaseType,
    releaseDate,
    releaseStatus: 'released',
    baseline,

    /*
     * Derived from the delivery package that was current at release time — a projection, not a
     * copy, and never re-collected from the underlying domains (Part 4).
     */
    releaseNotes: buildReleaseNotes(inputs.deliveryPackage?.deliverySummary ?? ({} as never), versionCheck.version),
    customerAcceptance: { state: 'pending', conditions: [] },
    integrity,
    metadata: {
      modelVersion: RELEASE_MODEL_VERSION,
      createdBy: params.createdBy,
      intendedType: params.releaseType,
      intentMatchesVersion: versionCheck.matchesIntent,
      previousVersion,
    },
  };

  return { ok: true, release: deepFreeze(release) };
}

/** An immutable Release (Part 6) — a caller cannot mutate what was persisted as a baseline. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);

    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }

  return value;
}
