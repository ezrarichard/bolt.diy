import type { DeploymentStatus } from '~/lib/deployment/deploymentTypes';

/**
 * Customer Delivery Package Model — Sprint 93.
 *
 * The official handover artifact between Builders (or CubicleTech) and the customer, assembled
 * from what the platform already knows. Part 1 audit — every field below is sourced from an
 * existing domain, never invented:
 *
 *   Project store            → project identity, blueprint id, package/regional selection,
 *                              database activation (schema version, region, project name)
 *   Blueprint registry       → blueprint name/category/product type/target users/stack
 *   Application Manifest     → manifest version, framework, build command, output directory,
 *                              environment requirements, required services, ROUTES (Sprint 92),
 *                              dependencies, file counts, MVP code + feature scope
 *   Feature registry         → the delivered feature list (`builders_features`)
 *   MVP registry             → MVP code/theme/target release/status
 *   Deployment domain        → GitHub/Supabase/Vercel provider rows, lifecycle status, history
 *   Verification domain      → the latest `builders_deployment_verifications` report (Sprint 92)
 *   Environment readiness    → per-variable resolved/missing report (Sprint 90)
 *   Product Package          → which engineering documents exist (index only, never content)
 *
 * Two rules shape the whole model:
 *
 *  1. **Sectioned, not a blob.** Each concern has its own interface so an exporter (Part 11) can
 *     render one section without parsing the rest, and so a future field lands in exactly one
 *     place.
 *  2. **Never fabricate.** Anything not actually known is `undefined`/empty with a stated reason
 *     (see `DeliverySupportInformation.contacts`, `DeliveryLimitation`), never a plausible-looking
 *     placeholder. A misleading handover document is worse than an incomplete one.
 *
 * NO SECRETS. Nothing here carries a token, key, password or connection string. Environment
 * variables appear as NAMES with a resolved/missing status only — the same discipline
 * `environmentReadinessService.ts` already enforces (it never returns a value for a sensitive
 * variable), plus `assertNoSecrets`-style filtering at assembly time.
 */

/** Bumped when the SHAPE of this model changes, so an old persisted package stays interpretable. */
export const DELIVERY_PACKAGE_MODEL_VERSION = '1.0.0';

/** The Builders build that assembled a package. Sourced from `package.json`'s own version — not a second version scheme. */
export const DELIVERY_GENERATOR_VERSION = '1.0.0';

// ── Project / application / business ────────────────────────────────────────

export interface DeliveryProjectInformation {
  projectId: string;
  projectName: string;
  description?: string;
  projectType?: string;
  createdAt?: string;
}

export interface DeliveryApplicationSummary {
  framework: string;
  packageManager: string;
  entryFile: string;
  buildCommand?: string;
  outputDirectory?: string;

  /** Runtime platforms the generated application needs, e.g. `["Node.js"]`. */
  runtimeRequirements: string[];

  /** External services it depends on to run, e.g. `["Supabase"]`. Names the SERVICE, not a variable. */
  requiredServices: string[];

  /** Declared client routes, from the Manifest's own route declarations (Sprint 92, Part 8). */
  routes: Array<{ path: string; name: string }>;
  totalFiles: number;
  completedFiles: number;

  /** Dependency NAMES only — the generated `package.json` remains the source of truth for versions. */
  dependencies: string[];
}

export interface DeliveryBusinessSummary {
  /** The MVP theme, when one is recorded — the closest thing to a business statement this platform actually stores. */
  theme?: string;
  targetUsers?: string;
  productType?: string;

  /** Present only when the customer's own project description exists. */
  description?: string;
}

export interface DeliveryBlueprintSummary {
  blueprintId?: string;
  name?: string;
  category?: string;
  productType?: string;
  recommendedStack: string[];
  recommendedIntegrations: string[];

  /** Package/regional intelligence selections, when the operator made them. */
  packageProfile?: string;
  regionalProfile?: string;
}

export interface DeliveryVersionSummary {
  /** `builders_application_manifests.version` for the manifest this application was generated from. */
  manifestVersion?: number;
  mvpCode?: string;
  mvpStatus?: string;
  targetRelease?: string;

  /** 1-based attempt number of THIS package for this deployment. */
  packageNumber: number;
}

// ── Deployment / verification ───────────────────────────────────────────────

export interface DeliveryRepositoryInformation {
  provider: 'github' | 'none';
  repositoryFullName?: string;
  repositoryUrl?: string;
  branch?: string;
  visibility?: string;

  /** The commit recorded by the last successful push, when the Deployment history captured one. */
  lastCommit?: string;
  lastPushAt?: string;
  connectionStatus?: string;
}

export interface DeliveryDatabaseInformation {
  provider: 'supabase' | 'none';
  projectRef?: string;
  projectName?: string;

  /** Public project URL. Never a connection string, never a key. */
  projectUrl?: string;
  region?: string;
  schemaVersion?: number;
  tableCount?: number;
  schemaAppliedAt?: string;
  connectionStatus?: string;
}

export interface DeliveryEnvironmentVariableSummary {
  name: string;
  status: string;
  source: string;
  sensitive: boolean;

  /** Never a value — only where it comes from and whether it still needs a human. */
  detail: string;
}

export interface DeliveryEnvironmentSummary {
  ready: boolean;
  fullyResolved: boolean;
  variables: DeliveryEnvironmentVariableSummary[];
  resolvedCount: number;
  manualCount: number;
}

export interface DeliveryDeploymentSummary {
  lifecycleStatus: DeploymentStatus;
  environment: string;
  provider: 'vercel' | 'none';
  vercelProjectName?: string;

  /** The URL the customer opens. Always the LATEST deployment URL when one exists. */
  previewUrl?: string;
  latestDeploymentId?: string;
  latestDeploymentState?: string;
  deployedAt?: string;

  /** Wall-clock time from `deployment_started` to `deployment_succeeded`, when both events exist. */
  deploymentDurationMs?: number;
  productionBranch?: string;
}

export interface DeliveryVerificationCategorySummary {
  category: string;
  passed: number;
  failed: number;
  warnings: number;
  skipped: number;
  unavailable: number;
}

export interface DeliveryVerificationSummary {
  /** `false` when the Deployment has never been verified — the package is still produced, and says so. */
  verified: boolean;
  status?: string;
  verificationId?: string;
  verificationNumber?: number;
  policyVersion?: string;
  verifiedAt?: string;
  durationMs?: number;
  targetUrl?: string;
  checksPassed: number;
  checksFailed: number;
  warnings: number;
  requiredPassed: number;
  requiredTotal: number;
  categories: DeliveryVerificationCategorySummary[];

  /** Only the blocking failure's summary line — never the whole evidence dump. */
  blockingFailure?: string;
}

// ── Features ────────────────────────────────────────────────────────────────

/** Part 3 — what a delivered item's state actually is. Assigned from real signals only; see `deliveryFeatureInventory.ts`. */
export type DeliveryFeatureState = 'implemented' | 'configured' | 'connected' | 'verified' | 'future' | 'optional';

/** Whether live verification actually exercised this feature. `unavailable` means "no verification evidence exists for it", never "it failed". */
export type DeliveryFeatureVerificationState = 'verified' | 'not_verified' | 'unavailable';

/** Which grounded artifact this entry came from — nothing is ever derived from a project or page NAME. */
export type DeliveryFeatureSource = 'feature_registry' | 'manifest_scope' | 'manifest_routes' | 'provider';

export interface DeliveryFeature {
  /** `Feature.code` (e.g. "FEAT-001") where one exists; otherwise a stable derived key. */
  code: string;
  title: string;
  description?: string;
  priority?: string;
  state: DeliveryFeatureState;
  verificationState: DeliveryFeatureVerificationState;
  source: DeliveryFeatureSource;

  /** How this entry's state was decided — shown to the customer so nothing looks like a guess. */
  evidence: string;
}

export interface DeliveryFeatureInventory {
  features: DeliveryFeature[];
  implementedCount: number;
  verifiedCount: number;
  futureCount: number;
  optionalCount: number;
}

// ── Limitations / checklist / recommendations ───────────────────────────────

export type DeliveryLimitationSeverity = 'blocking' | 'attention' | 'informational';

export type DeliveryLimitationSource =
  | 'manifest_scope'
  | 'verification'
  | 'environment'
  | 'blueprint'
  | 'deployment'
  | 'documentation'
  | 'generation';

export interface DeliveryLimitation {
  id: string;
  title: string;
  detail: string;
  severity: DeliveryLimitationSeverity;

  /** Which real artifact produced this limitation. Nothing is listed without one (Part 5). */
  source: DeliveryLimitationSource;
}

export type DeliveryChecklistState = 'satisfied' | 'not_satisfied' | 'pending' | 'not_applicable';

export interface DeliveryChecklistItem {
  id: string;
  label: string;
  state: DeliveryChecklistState;

  /** The fact that decided this item — never "looks fine". */
  evidence: string;

  /** `true` for items only the customer can complete (review, acceptance) — always `pending` here, by design. */
  customerAction: boolean;
}

export interface DeliveryAcceptanceChecklist {
  items: DeliveryChecklistItem[];
  satisfiedCount: number;
  outstandingCount: number;
  customerActionCount: number;
}

export interface DeliveryRecommendation {
  id: string;
  title: string;
  detail: string;
}

// ── Admin guide / support ───────────────────────────────────────────────────

export interface DeliveryAdminGuideStep {
  id: string;
  title: string;
  steps: string[];
}

export interface DeliveryAdminGuide {
  previewUrl?: string;
  repositoryUrl?: string;
  branch?: string;
  supabaseProjectUrl?: string;
  vercelProjectName?: string;
  deployedAt?: string;
  buildVersion?: string;

  /** Variable NAMES and whether each still needs a human. Never a value (Part 7). */
  environmentVariables: Array<{ name: string; status: string; requiresManualEntry: boolean }>;
  procedures: DeliveryAdminGuideStep[];
}

export interface DeliverySupportInformation {
  /**
   * Empty in this sprint, and deliberately so: Builders has no contact registry, so there is no
   * grounded source for a named technical contact. `note` says that explicitly rather than the
   * package implying support that was never arranged.
   */
  contacts: Array<{ role: string; name?: string; detail?: string }>;
  note: string;

  /** Provider consoles the operator already has access to — links only, never credentials. */
  consoles: Array<{ label: string; url: string }>;
}

// ── Documentation index / generation + package metadata ─────────────────────

export interface DeliveryDocumentationIndex {
  /** Whether an assembled Product Package exists at all. */
  available: boolean;

  /** Section id/label/file count/status — an INDEX, never the document content itself. */
  sections: Array<{ id: string; label: string; fileCount: number }>;
  missingSections: Array<{ id: string; label: string; reason: string }>;
}

export interface DeliveryGenerationMetadata {
  manifestId?: string;
  manifestVersion?: number;
  manifestStatus?: string;
  generatedAt?: string;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  planChecksum?: string;
}

export interface DeliveryPackageMetadata {
  /** Shape version of this model (`DELIVERY_PACKAGE_MODEL_VERSION`). */
  packageVersion: string;

  /** The Builders build that assembled it (`DELIVERY_GENERATOR_VERSION`). */
  generatorVersion: string;
  deliveredAt: string;
  generatedBy?: string;

  /** Which domains actually contributed, so a reader can see what a thin package was missing. */
  sources: Array<{ source: string; available: boolean; detail?: string }>;
}

// ── Completeness ────────────────────────────────────────────────────────────

export type DeliveryCompletenessLevel = 'complete' | 'almost_complete' | 'incomplete';

export interface DeliveryCompletenessDimension {
  id: string;
  label: string;
  weight: number;

  /** 0..1. Partial credit is allowed where the underlying signal is genuinely partial. */
  score: number;
  detail: string;
}

export interface DeliveryCompleteness {
  /** 0..100, rounded. ADVISORY (Part 10) — it never blocks packaging or the lifecycle transition. */
  score: number;
  level: DeliveryCompletenessLevel;
  dimensions: DeliveryCompletenessDimension[];
}

// ── The package ─────────────────────────────────────────────────────────────

/** One assembled handover package. Immutable once built — the service returns a frozen value. */
export interface DeliveryPackage {
  projectInformation: DeliveryProjectInformation;
  applicationSummary: DeliveryApplicationSummary;
  businessSummary: DeliveryBusinessSummary;
  blueprintSummary: DeliveryBlueprintSummary;
  versionSummary: DeliveryVersionSummary;
  deploymentSummary: DeliveryDeploymentSummary;
  verificationSummary: DeliveryVerificationSummary;
  featureInventory: DeliveryFeatureInventory;
  knownLimitations: DeliveryLimitation[];
  repositoryInformation: DeliveryRepositoryInformation;
  databaseInformation: DeliveryDatabaseInformation;
  environmentSummary: DeliveryEnvironmentSummary;
  acceptanceChecklist: DeliveryAcceptanceChecklist;
  adminGuide: DeliveryAdminGuide;
  futureRecommendations: DeliveryRecommendation[];
  documentation: DeliveryDocumentationIndex;
  support: DeliverySupportInformation;
  generationMetadata: DeliveryGenerationMetadata;
  completeness: DeliveryCompleteness;
  packageMetadata: DeliveryPackageMetadata;
}

/** A persisted package — a `builders_delivery_packages` row in application shape. */
export interface DeliveryPackageRecord {
  id: string;
  deploymentId: string;
  projectId: string;

  /** 1-based per deployment. A regeneration never overwrites an earlier package (Part 9). */
  packageNumber: number;
  packageVersion: string;
  generatorVersion: string;

  /** `'generated'` — the only status this sprint writes. Reserved for Sprint 94's release states. */
  status: string;
  manifestVersion?: number;

  /** The verification report this package attests to, when one exists. */
  verificationId?: string;
  completenessScore: number;
  completenessLevel: DeliveryCompletenessLevel;
  deliverySummary: DeliveryPackage;
  generatedAt: string;
  generatedBy?: string;
  createdAt: string;
}
