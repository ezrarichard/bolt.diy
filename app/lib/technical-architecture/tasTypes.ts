/**
 * Technical Architecture Specification (TAS) — Sprint 100B.
 *
 * The machine-readable counterpart to the Solution Architect's narrative
 * `ArchitectureDraft` (see app/lib/projects/prompts/architecture.ts). Produced by
 * the SAME single LLM call as the narrative draft, but persisted as its own
 * first-class artifact (`ARTIFACT_TYPES.TECHNICAL_ARCHITECTURE_SPEC` — see
 * app/lib/projects/artifacts.ts) rather than a field nested inside the narrative
 * one, so every future consumer (the Application Generator, and the downstream
 * engineering roles from Sprint 100C onward) reads exactly this shape
 * deterministically, without re-interpreting prose.
 *
 * Deliberately the exact schema approved in Sprint 100A — see
 * docs/architecture/TAS-Schema.md. No field here was invented by this sprint and
 * none was dropped; where implementation exposed a deficiency it is DOCUMENTED in
 * that sprint's report, not fixed here (Sprint 100B's brief: "If implementation
 * exposes deficiencies: document them. Do not redesign the schema.").
 *
 * NOTHING CONSUMES THIS YET. Sprint 100B produces and persists the artifact only;
 * no downstream role, prompt, or generator reads it. That wiring is Sprint 100C.
 *
 * Structured exactly like app/lib/database-activation/schemaTypes.ts (Sprint 75),
 * the pattern this sprint was told to follow: types + an EMPTY_ constant + a
 * tolerant `parse*` function that NEVER throws, so a malformed or old-shape LLM
 * response degrades to an empty spec instead of breaking the narrative draft's
 * approval flow.
 */

/** Schema version of the TAS document itself, distinct from the artifact's version number. */
export const TAS_VERSION = '1.0' as const;

/*
 * ---------------------------------------------------------------------------
 * Lifecycle — the core MVP-protection mechanism (TAS spec §3.2)
 * ---------------------------------------------------------------------------
 */

/**
 * `current`  — in this MVP.                    Generator: BUILD.
 * `future`   — planned for a named later MVP.  Generator: DO NOT BUILD; honour invariants only.
 * `deferred` — acknowledged, not planned.      Generator: DO NOT BUILD; no invariants owed.
 */
export type Lifecycle = 'current' | 'future' | 'deferred';

export const LIFECYCLE_VALUES: Lifecycle[] = ['current', 'future', 'deferred'];

export type V1Cost = 'zero' | 'low' | 'deferred';

export const V1_COST_VALUES: V1Cost[] = ['zero', 'low', 'deferred'];

/** Mixed into every lifecycle-tagged element. */
export interface LifecycleTagged {
  lifecycle: Lifecycle;
  targetMvpSequence?: number;

  /** What V1 must NEVER do, so this stays cheap later. These are the seam — NOT structures V1 builds. */
  invariants?: string[];
  v1Cost?: V1Cost;
  v1CostJustification?: string;
}

/** Invalidation blast radius of this TAS version versus the previous one. */
export type ChangeClass = 'additive' | 'binding' | 'structural';

export const CHANGE_CLASS_VALUES: ChangeClass[] = ['additive', 'binding', 'structural'];

/*
 * ---------------------------------------------------------------------------
 * 1. System Overview  /  2. Architecture Decisions
 * ---------------------------------------------------------------------------
 */

export interface ModuleBoundary {
  id: string;
  name: string;
  responsibility: string;

  /** Other module ids this one may call. Empty = leaf. */
  dependsOn: string[];

  /** Product Package feature ids this module serves, for traceability. */
  featureRefs?: string[];
}

export interface SystemOverview {
  summary: string;
  productType: string;

  /** Open string, deliberately not an enum — new topologies must not need a schema change. */
  topology: string;
  modules: ModuleBoundary[];

  /** Concerns explicitly OUT of this system's boundary (vs nonGoals, which are unbuilt features). */
  systemBoundaries: string[];
}

export interface RejectedAlternative {
  option: string;
  reason: string;
}

export interface ArchitectureDecision {
  id: string;
  title: string;
  decision: string;
  rationale: string;

  /** At least one. A decision with no rejected alternative was not a decision. */
  alternativesRejected: RejectedAlternative[];

  /** Product Package rule/NFR ids, e.g. ['BR-T-2', 'NFR-SEC-1']. Absent for projects with no package. */
  satisfies?: string[];

  /** Set when a later decision replaces this one. Decisions are append-only, never deleted. */
  supersededBy?: string;
  consequences?: string[];
}

/*
 * ---------------------------------------------------------------------------
 * 3/8/9/10/11/12. Capabilities — the unified provider model (TAS spec §3.1)
 * ---------------------------------------------------------------------------
 */

export type CapabilityKind =
  | 'payment'
  | 'notification'
  | 'storage'
  | 'ai'
  | 'auth'
  | 'search'
  | 'analytics'
  | 'external';

export const CAPABILITY_KIND_VALUES: CapabilityKind[] = [
  'payment',
  'notification',
  'storage',
  'ai',
  'auth',
  'search',
  'analytics',
  'external',
];

export type ProviderType = 'hosted-api' | 'self-hosted' | 'sdk' | 'webhook' | 'manual' | 'none';

export const PROVIDER_TYPE_VALUES: ProviderType[] = ['hosted-api', 'self-hosted', 'sdk', 'webhook', 'manual', 'none'];

export type FallbackKind = 'none' | 'queue' | 'degrade' | 'manual' | 'secondary-provider';

export const FALLBACK_KIND_VALUES: FallbackKind[] = ['none', 'queue', 'degrade', 'manual', 'secondary-provider'];

export type FailureMode = 'blocking' | 'degraded' | 'queued' | 'silent';

export const FAILURE_MODE_VALUES: FailureMode[] = ['blocking', 'degraded', 'queued', 'silent'];

export interface CapabilityBinding extends LifecycleTagged {
  id: string;

  /** A REAL provider name ('Razorpay'), never a category ('a payment gateway'). */
  provider: string;
  providerType: ProviderType;

  /** Required when lifecycle !== 'current'. Feeds doNotBuild derivation. */
  doNotBuild?: string[];

  /** SDK/package name, when the binding implies one. Used by doNotBuild verifiables. */
  sdkPackage?: string;
  sandboxAvailable?: boolean;
  notes?: string;
}

export interface ConnectionTest {
  description: string;
  trigger: 'admin-screen' | 'cli' | 'startup-check';
  successCriteria: string;
}

export interface CapabilityFallback {
  kind: FallbackKind;
  description: string;
}

export interface Capability {
  id: string;
  kind: CapabilityKind;
  name: string;
  purpose: string;

  /** The abstraction name EVERY call site must go through, e.g. 'PaymentProvider'. */
  port: string;
  portSurface: string[];

  /**
   * All providers, current and future. AT MOST ONE may have lifecycle 'current'.
   * ZERO current bindings is legal and means "declared, nothing built".
   */
  bindings: CapabilityBinding[];
  runtimeConfigurable: boolean;

  /** Derived: true iff runtimeConfigurable && a setting has mutability 'runtime-admin'. */
  configScreenRequired: boolean;
  configScreenRef?: string;
  connectionTest?: ConnectionTest;

  /** Ids in configuration.secrets. */
  secretRefs: string[];

  /** What happens when the provider fails. `none` is valid and must be explicit. */
  fallback: CapabilityFallback;
  failureMode: FailureMode;

  /** ADR ids justifying the current binding. */
  decisionRefs: string[];
}

/*
 * ---------------------------------------------------------------------------
 * 4. Runtime  /  5,6,7. Configuration, Secrets, Screens
 * ---------------------------------------------------------------------------
 */

export interface RuntimeSpec {
  /** Concrete, e.g. 'Node.js 20 LTS'. Never a range. */
  target: string;
  framework: string;
  language: string;
  buildOutput: string;
  packageManager?: string;
  bootSettings: string[];
}

export type ConfigScope = 'build' | 'deployment' | 'system' | 'tenant' | 'user';

export const CONFIG_SCOPE_VALUES: ConfigScope[] = ['build', 'deployment', 'system', 'tenant', 'user'];

export type ConfigMutability = 'immutable' | 'deploy-time' | 'runtime-admin' | 'runtime-user';

export const CONFIG_MUTABILITY_VALUES: ConfigMutability[] = [
  'immutable',
  'deploy-time',
  'runtime-admin',
  'runtime-user',
];

/** Mutability values that require a configuration screen (TAS spec §4.4). */
export const SCREEN_REQUIRING_MUTABILITY: ConfigMutability[] = ['runtime-admin', 'runtime-user'];

export interface ConfigSetting extends LifecycleTagged {
  key: string;
  description: string;
  scope: ConfigScope;
  mutability: ConfigMutability;
  valueType: 'string' | 'number' | 'boolean' | 'enum' | 'json';
  allowedValues?: string[];
  defaultValue?: string;
  changeableBy?: string;

  /** Required iff mutability is 'runtime-admin' or 'runtime-user'. */
  screenRef?: string;

  /** Required iff scope === 'deployment'. */
  envVarRef?: string;
}

export interface EnvironmentVariable {
  name: string;
  description: string;
  owner: 'devops' | 'backend' | 'frontend';

  /** Where it is read. 'client' implies it is NOT a secret. */
  scope: 'build' | 'server' | 'client';
  requiredAt: 'build' | 'boot' | 'first-use';

  /** If false, absence is a hard failure — a startup check is owed. */
  hasSafeDefault: boolean;
  defaultValue?: string;

  /** True ⇒ must appear in `secrets` and must never have scope 'client'. */
  isSecret: boolean;
  exampleValue?: string;
}

export type SecretStorage = 'env-var' | 'platform-secret-store' | 'encrypted-at-rest-in-db' | 'external-vault';

export const SECRET_STORAGE_VALUES: SecretStorage[] = [
  'env-var',
  'platform-secret-store',
  'encrypted-at-rest-in-db',
  'external-vault',
];

export interface Secret {
  id: string;
  name: string;
  description: string;
  capabilityRef?: string;
  storage: SecretStorage;

  /** Non-overridable invariant. Always false. Present so consumers can assert it. */
  clientExposed: false;
  rotationExpectation?: 'never' | 'on-compromise' | 'periodic';
  scope: 'deployment' | 'tenant';
}

export interface ConfigScreen {
  id: string;
  name: string;
  accessRole: string;

  /** Setting keys this screen exposes. MUST be non-empty. */
  settingKeys: string[];
  hasConnectionTest: boolean;
  location: string;
}

export interface ConfigurationSpec {
  settings: ConfigSetting[];
  environmentVariables: EnvironmentVariable[];
  secrets: Secret[];

  /** DERIVED: one entry per group of runtime-mutable settings. Validated against `settings`. */
  screens: ConfigScreen[];
}

/*
 * ---------------------------------------------------------------------------
 * 13/14/25. Security
 * ---------------------------------------------------------------------------
 */

export interface AuthenticationSpec {
  method: string;
  identityField: string;
  sessionMechanism: string;
  sessionExpiry: string;
  revocation: string;
  credentialStorage: string;
  rateLimiting: string;
  mfa?: string;
}

export interface AuthorizationSpec {
  model: 'rbac' | 'abac' | 'acl' | 'ownership';

  /** MUST be a SINGLE named layer. Two enforcement points is a defect. */
  enforcementPoint: string;

  /** Mirrored from the Product Package permission matrix. The TAS does not invent them. */
  roles: string[];
  permissionSource: string;

  /** Always true. Client-side checks are presentation only, never control. */
  serverSideEnforced: true;
}

export interface TrustBoundary {
  id: string;
  name: string;
  zone: 'public' | 'authenticated' | 'privileged' | 'internal';
  entryPoints: string[];

  /** What this zone must NOT trust. The most important field here. */
  doesNotTrust: string[];
  validation: string;
}

export interface PublicSurface {
  id: string;
  description: string;
  exposes: string[];
  mustNotExpose: string[];
  protection: string;
}

export interface SecuritySpec {
  authentication: AuthenticationSpec;
  authorization: AuthorizationSpec;
  boundaries: TrustBoundary[];
  publicSurfaces: PublicSurface[];
}

/*
 * ---------------------------------------------------------------------------
 * 15. Multi-Tenancy
 * ---------------------------------------------------------------------------
 */

export type TenancyModel = 'single-tenant' | 'shared-schema-row-scoped' | 'schema-per-tenant' | 'database-per-tenant';

export const TENANCY_MODEL_VALUES: TenancyModel[] = [
  'single-tenant',
  'shared-schema-row-scoped',
  'schema-per-tenant',
  'database-per-tenant',
];

export interface EnforcementLayer {
  layer: 'application' | 'database' | 'gateway';
  mechanism: string;

  /** What this layer alone guarantees if every other layer fails. */
  guaranteeIfOthersFail: string;
}

export interface TenancyLevel extends LifecycleTagged {
  name: string;
  description: string;
  dataShapeChange?: string;
  migrationSketch?: string;
}

export interface TenantState {
  state: string;
  access: 'full' | 'read-only' | 'none';
  description: string;
}

export interface TenancySpec {
  model: TenancyModel;
  scopeColumn?: string;

  /** Where tenant identity comes from. MUST NOT be a request parameter. */
  identitySource: string;
  enforcementLayers: EnforcementLayer[];

  /** MUST include the tenant prefix when model !== 'single-tenant'. */
  cacheKeyConvention: string;
  storagePathConvention: string;

  /** Ordered tenancy tiers with lifecycle tags. */
  levels: TenancyLevel[];
  tenantStates?: TenantState[];
}

/*
 * ---------------------------------------------------------------------------
 * 12/16-22. Cross-cutting strategies
 * ---------------------------------------------------------------------------
 */

export interface StorageBucket extends LifecycleTagged {
  name: string;
  purpose: string;
  retention?: string;
  publicRead: boolean;
}

export interface StorageSpec {
  provider: string;
  buckets: StorageBucket[];

  /** MUST be tenant-prefixed when multi-tenant. */
  pathConvention: string;
  accessModel: 'signed-url' | 'proxied' | 'public';
  maxFileSizeBytes?: number;
  allowedMimeTypes?: string[];
  virusScanning: boolean;
}

export interface FeatureToggle extends LifecycleTagged {
  key: string;
  description: string;
  defaultState: boolean;
  scope: ConfigScope;

  /** When this flag gets DELETED. A flag with no removal condition is permanent complexity. */
  removalCondition: string;
}

export interface FeatureToggleSpec {
  evaluationPoint: string;
  source: 'env-var' | 'tenant-config' | 'remote-service' | 'build-constant';
  flags: FeatureToggle[];
}

export interface BackgroundJob extends LifecycleTagged {
  id: string;
  name: string;
  trigger: string;

  /** How a duplicate run is made harmless. Required — retries make duplicates inevitable. */
  idempotencyKey: string;
  retryPolicy: string;
  maxAttempts: number;
  timeoutSeconds?: number;
  userVisibleFailure: string;
}

export interface BackgroundProcessingSpec {
  /** 'none' is valid and must be explicit. */
  mechanism: string;
  jobs: BackgroundJob[];
  deadLetterHandling: string;
}

export interface ScheduledJob extends LifecycleTagged {
  id: string;
  name: string;
  schedule: string;

  /** REQUIRED. A schedule without a timezone is a defect in any India-facing product. */
  timezone: string;
  overlapPolicy: 'skip' | 'queue' | 'allow';
  failureAlerting: string;
}

export interface ScheduledJobsSpec {
  scheduler: string;
  jobs: ScheduledJob[];
}

export interface CacheLayer extends LifecycleTagged {
  name: string;
  location: 'client' | 'cdn' | 'server-memory' | 'shared-store';
  cachedData: string[];
  ttlSeconds: number;
  invalidationTrigger: string;
}

export interface CachingSpec {
  layers: CacheLayer[];

  /** MUST include the tenant prefix when multi-tenant. */
  keyConvention: string;
  tenantPrefixed: boolean;
}

export interface AuditEvent extends LifecycleTagged {
  event: string;
  entityTypes: string[];
  capturesFieldChanges: boolean;
  reasonRequired: boolean;
}

export interface AuditSpec {
  events: AuditEvent[];
  sink: string;

  /** How immutability is guaranteed. Append-only is a claim that needs a mechanism. */
  immutabilityMechanism: string;
  retentionPeriod: string;
  requiredFields: string[];
}

export interface LoggingSpec {
  levels: string[];
  sink: string;
  format: 'structured-json' | 'plain-text';
  requiredContext: string[];

  /** MUST be non-empty. Prevents measurements and phone numbers reaching logs. */
  prohibitedContent: string[];
  retentionPeriod: string;
}

export interface MonitoringSignal extends LifecycleTagged {
  name: string;
  type: 'uptime' | 'latency' | 'error-rate' | 'business-metric' | 'resource';
  threshold?: string;
  severity: 'critical' | 'warning' | 'info';
}

export interface MonitoringSpec {
  signals: MonitoringSignal[];
  alertRouting: string;
  uptimeTarget?: string;
}

export interface CrossCuttingSpec {
  storage: StorageSpec;
  featureToggles: FeatureToggleSpec;
  backgroundProcessing: BackgroundProcessingSpec;
  scheduledJobs: ScheduledJobsSpec;
  caching: CachingSpec;
  audit: AuditSpec;
  logging: LoggingSpec;
  monitoring: MonitoringSpec;
}

/*
 * ---------------------------------------------------------------------------
 * 23/24. Deployment & Scalability
 * ---------------------------------------------------------------------------
 */

export interface Environment {
  name: string;
  purpose: string;

  /** Production data must never reach a lower environment. */
  dataPolicy: string;
}

export interface ScaleDimension {
  dimension: string;
  expected: string;
  designHeadroom: string;
}

export interface ScalabilitySpec {
  /** Concrete numbers, never adjectives. */
  envelope: ScaleDimension[];
  statelessTier: boolean;
  horizontalScaling: string;
  peakProfile?: string;

  /** What triggers a re-architecture, e.g. 'beyond 5,000 tenants'. */
  reviewTrigger?: string;
}

export interface DeploymentSpec {
  hostingModel: string;
  region: string;
  regionRationale?: string;
  environments: Environment[];
  migrationStrategy: string;
  zeroDowntimeRequired: boolean;
  rollbackStrategy: string;
  cicdGates: string[];
  scalability: ScalabilitySpec;
}

/*
 * ---------------------------------------------------------------------------
 * 26/27/28. Evolution, Non-Goals, Do-Not-Build
 * ---------------------------------------------------------------------------
 */

export interface EvolutionEntry {
  /** Pointer to the source element, e.g. 'capabilities.payments.bindings.stripe'. */
  sourceRef: string;
  capability: string;
  currentState: string;
  futureState: string;
  lifecycle: Exclude<Lifecycle, 'current'>;
  targetMvpSequence?: number;
  seamKind: 'interface' | 'data-shape' | 'config' | 'none';
  v1Cost: V1Cost;
  v1CostJustification: string;
  invariants: string[];
  migrationSketch: string;
}

export interface EvolutionSpec {
  entries: EvolutionEntry[];

  /** Architecture-wide statement of what this MVP deliberately does not prepare for. */
  deliberatelyUnprepared: string[];
}

export interface NonGoal {
  id: string;

  /** A capability the system deliberately will NOT have. */
  statement: string;
  reason: string;
  revisitAtMvpSequence?: number;
}

export interface DoNotBuildEntry {
  id: string;

  /** Specific and checkable. 'No Stripe SDK import', not 'do not over-engineer'. */
  statement: string;

  /** 'derived' entries come from non-current bindings and clear automatically on promotion. */
  origin: 'derived' | 'explicit';
  sourceRef?: string;
  verifiable: string;
}

/*
 * ---------------------------------------------------------------------------
 * Generator Directives
 * ---------------------------------------------------------------------------
 */

export type DirectiveTarget = 'database' | 'uiux' | 'backend' | 'frontend' | 'qa' | 'devops' | 'generator';

export const DIRECTIVE_TARGET_VALUES: DirectiveTarget[] = [
  'database',
  'uiux',
  'backend',
  'frontend',
  'qa',
  'devops',
  'generator',
];

export type DirectiveKind = 'structure' | 'boundary' | 'binding' | 'invariant' | 'prohibition' | 'configuration';

export const DIRECTIVE_KIND_VALUES: DirectiveKind[] = [
  'structure',
  'boundary',
  'binding',
  'invariant',
  'prohibition',
  'configuration',
];

export interface GeneratorDirective {
  id: string;
  appliesTo: DirectiveTarget[];
  kind: DirectiveKind;

  /** What MUST be true. Imperative, specific. */
  directive: string;

  /** What must NEVER be true. Often the more useful half. */
  mustNot?: string;

  /** How a script or reviewer checks it. A directive with no mechanical check is prose. */
  verifiable: string;
  sourceSection: string;
  decisionRefs?: string[];
  mvpSequence: number;
  severity: 'must' | 'should';
}

/*
 * ---------------------------------------------------------------------------
 * Root
 * ---------------------------------------------------------------------------
 */

export interface TechnicalArchitectureSpecification {
  tasVersion: typeof TAS_VERSION;
  projectId: string;
  projectName: string;

  /** Which MVP this TAS describes. */
  mvpSequence: number;
  changeClass: ChangeClass;

  systemOverview: SystemOverview;
  decisions: ArchitectureDecision[];
  capabilities: Capability[];
  runtime: RuntimeSpec;
  configuration: ConfigurationSpec;
  security: SecuritySpec;
  tenancy: TenancySpec;
  crossCutting: CrossCuttingSpec;
  deployment: DeploymentSpec;
  evolution: EvolutionSpec;
  nonGoals: NonGoal[];
  doNotBuild: DoNotBuildEntry[];
  directives: GeneratorDirective[];
}

/**
 * The shape a legacy or malformed response degrades to — every array empty, every
 * required scalar an empty string. Mirrors `EMPTY_STRUCTURED_SCHEMA`'s role in
 * schemaTypes.ts: callers can always read `tas.capabilities.length` without a
 * null check, and `isEmptyTas` distinguishes "no TAS content" from "a real TAS
 * that happens to be small".
 */
export const EMPTY_TAS: TechnicalArchitectureSpecification = {
  tasVersion: TAS_VERSION,
  projectId: '',
  projectName: '',
  mvpSequence: 1,
  changeClass: 'structural',
  systemOverview: { summary: '', productType: '', topology: '', modules: [], systemBoundaries: [] },
  decisions: [],
  capabilities: [],
  runtime: { target: '', framework: '', language: '', buildOutput: '', bootSettings: [] },
  configuration: { settings: [], environmentVariables: [], secrets: [], screens: [] },
  security: {
    authentication: {
      method: '',
      identityField: '',
      sessionMechanism: '',
      sessionExpiry: '',
      revocation: '',
      credentialStorage: '',
      rateLimiting: '',
    },
    authorization: {
      model: 'rbac',
      enforcementPoint: '',
      roles: [],
      permissionSource: '',
      serverSideEnforced: true,
    },
    boundaries: [],
    publicSurfaces: [],
  },
  tenancy: {
    model: 'single-tenant',
    identitySource: '',
    enforcementLayers: [],
    cacheKeyConvention: '',
    storagePathConvention: '',
    levels: [],
  },
  crossCutting: {
    storage: { provider: '', buckets: [], pathConvention: '', accessModel: 'signed-url', virusScanning: false },
    featureToggles: { evaluationPoint: '', source: 'env-var', flags: [] },
    backgroundProcessing: { mechanism: '', jobs: [], deadLetterHandling: '' },
    scheduledJobs: { scheduler: '', jobs: [] },
    caching: { layers: [], keyConvention: '', tenantPrefixed: false },
    audit: { events: [], sink: '', immutabilityMechanism: '', retentionPeriod: '', requiredFields: [] },
    logging: {
      levels: [],
      sink: '',
      format: 'structured-json',
      requiredContext: [],
      prohibitedContent: [],
      retentionPeriod: '',
    },
    monitoring: { signals: [], alertRouting: '' },
  },
  deployment: {
    hostingModel: '',
    region: '',
    environments: [],
    migrationStrategy: '',
    zeroDowntimeRequired: false,
    rollbackStrategy: '',
    cicdGates: [],
    scalability: { envelope: [], statelessTier: true, horizontalScaling: '' },
  },
  evolution: { entries: [], deliberatelyUnprepared: [] },
  nonGoals: [],
  doNotBuild: [],
  directives: [],
};

/**
 * True when a TAS carries no real architectural content — used to distinguish a
 * legacy project (no TAS at all, or one that degraded to EMPTY_TAS) from a real
 * one. Checks the sections that any genuine architecture must populate rather
 * than deep-comparing against EMPTY_TAS, so a spec with only a summary still
 * counts as non-empty.
 */
export function isEmptyTas(tas: TechnicalArchitectureSpecification | undefined): boolean {
  if (!tas) {
    return true;
  }

  return (
    tas.systemOverview.summary.trim() === '' &&
    tas.capabilities.length === 0 &&
    tas.decisions.length === 0 &&
    tas.directives.length === 0
  );
}

/*
 * ---------------------------------------------------------------------------
 * Tolerant parsing — NEVER throws (mirrors parseStructuredDatabaseSchema)
 * ---------------------------------------------------------------------------
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function optionalStrList(value: unknown): string[] | undefined {
  const list = strList(value);
  return list.length > 0 ? list : undefined;
}

/** Coerces to one of `allowed`, falling back when the model emits something off-vocabulary. */
function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

function optionalNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalStr(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Maps an array of unknowns through a per-entry coercer, dropping entries that fail. */
function mapList<T>(value: unknown, toEntry: (raw: Record<string, unknown>) => T | undefined): T[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map(toEntry)
    .filter((entry): entry is T => entry !== undefined);
}

function toLifecycleTagged(raw: Record<string, unknown>): LifecycleTagged {
  return {
    lifecycle: oneOf(raw.lifecycle, LIFECYCLE_VALUES, 'current'),
    targetMvpSequence: optionalNum(raw.targetMvpSequence),
    invariants: optionalStrList(raw.invariants),
    v1Cost: typeof raw.v1Cost === 'string' ? oneOf(raw.v1Cost, V1_COST_VALUES, 'low') : undefined,
    v1CostJustification: optionalStr(raw.v1CostJustification),
  };
}

function toModule(raw: Record<string, unknown>): ModuleBoundary | undefined {
  const id = str(raw.id);
  const name = str(raw.name);

  if (!id && !name) {
    return undefined;
  }

  return {
    id: id || name,
    name: name || id,
    responsibility: str(raw.responsibility),
    dependsOn: strList(raw.dependsOn),
    featureRefs: optionalStrList(raw.featureRefs),
  };
}

function toDecision(raw: Record<string, unknown>): ArchitectureDecision | undefined {
  const id = str(raw.id);

  if (!id) {
    return undefined;
  }

  return {
    id,
    title: str(raw.title),
    decision: str(raw.decision),
    rationale: str(raw.rationale),
    alternativesRejected: mapList(raw.alternativesRejected, (entry) => {
      const option = str(entry.option);
      return option ? { option, reason: str(entry.reason) } : undefined;
    }),
    satisfies: optionalStrList(raw.satisfies),
    supersededBy: optionalStr(raw.supersededBy),
    consequences: optionalStrList(raw.consequences),
  };
}

function toBinding(raw: Record<string, unknown>): CapabilityBinding | undefined {
  const provider = str(raw.provider);

  if (!provider) {
    return undefined;
  }

  return {
    ...toLifecycleTagged(raw),
    id: str(raw.id) || provider,
    provider,
    providerType: oneOf(raw.providerType, PROVIDER_TYPE_VALUES, 'hosted-api'),
    doNotBuild: optionalStrList(raw.doNotBuild),
    sdkPackage: optionalStr(raw.sdkPackage),
    sandboxAvailable: typeof raw.sandboxAvailable === 'boolean' ? raw.sandboxAvailable : undefined,
    notes: optionalStr(raw.notes),
  };
}

function toCapability(raw: Record<string, unknown>): Capability | undefined {
  const id = str(raw.id);
  const name = str(raw.name);

  if (!id && !name) {
    return undefined;
  }

  const fallbackRaw = isRecord(raw.fallback) ? raw.fallback : {};

  return {
    id: id || name,
    kind: oneOf(raw.kind, CAPABILITY_KIND_VALUES, 'external'),
    name: name || id,
    purpose: str(raw.purpose),
    port: str(raw.port),
    portSurface: strList(raw.portSurface),
    bindings: mapList(raw.bindings, toBinding),
    runtimeConfigurable: bool(raw.runtimeConfigurable, false),
    configScreenRequired: bool(raw.configScreenRequired, false),
    configScreenRef: optionalStr(raw.configScreenRef),
    connectionTest: isRecord(raw.connectionTest)
      ? {
          description: str(raw.connectionTest.description),
          trigger: oneOf(raw.connectionTest.trigger, ['admin-screen', 'cli', 'startup-check'], 'admin-screen'),
          successCriteria: str(raw.connectionTest.successCriteria),
        }
      : undefined,
    secretRefs: strList(raw.secretRefs),
    fallback: {
      kind: oneOf(fallbackRaw.kind, FALLBACK_KIND_VALUES, 'none'),
      description: str(fallbackRaw.description),
    },
    failureMode: oneOf(raw.failureMode, FAILURE_MODE_VALUES, 'blocking'),
    decisionRefs: strList(raw.decisionRefs),
  };
}

function toSetting(raw: Record<string, unknown>): ConfigSetting | undefined {
  const key = str(raw.key);

  if (!key) {
    return undefined;
  }

  return {
    ...toLifecycleTagged(raw),
    key,
    description: str(raw.description),
    scope: oneOf(raw.scope, CONFIG_SCOPE_VALUES, 'system'),
    mutability: oneOf(raw.mutability, CONFIG_MUTABILITY_VALUES, 'deploy-time'),
    valueType: oneOf(raw.valueType, ['string', 'number', 'boolean', 'enum', 'json'], 'string'),
    allowedValues: optionalStrList(raw.allowedValues),
    defaultValue: optionalStr(raw.defaultValue),
    changeableBy: optionalStr(raw.changeableBy),
    screenRef: optionalStr(raw.screenRef),
    envVarRef: optionalStr(raw.envVarRef),
  };
}

function toEnvVar(raw: Record<string, unknown>): EnvironmentVariable | undefined {
  const name = str(raw.name);

  if (!name) {
    return undefined;
  }

  return {
    name,
    description: str(raw.description),
    owner: oneOf(raw.owner, ['devops', 'backend', 'frontend'], 'devops'),
    scope: oneOf(raw.scope, ['build', 'server', 'client'], 'server'),
    requiredAt: oneOf(raw.requiredAt, ['build', 'boot', 'first-use'], 'boot'),
    hasSafeDefault: bool(raw.hasSafeDefault, false),
    defaultValue: optionalStr(raw.defaultValue),
    isSecret: bool(raw.isSecret, false),
    exampleValue: optionalStr(raw.exampleValue),
  };
}

function toSecret(raw: Record<string, unknown>): Secret | undefined {
  const name = str(raw.name);

  if (!name) {
    return undefined;
  }

  return {
    id: str(raw.id) || name,
    name,
    description: str(raw.description),
    capabilityRef: optionalStr(raw.capabilityRef),
    storage: oneOf(raw.storage, SECRET_STORAGE_VALUES, 'platform-secret-store'),

    /* Never read from the model — the schema fixes this to false and the validator asserts it. */
    clientExposed: false,
    rotationExpectation:
      typeof raw.rotationExpectation === 'string'
        ? oneOf<'never' | 'on-compromise' | 'periodic'>(
            raw.rotationExpectation,
            ['never', 'on-compromise', 'periodic'],
            'on-compromise',
          )
        : undefined,
    scope: oneOf(raw.scope, ['deployment', 'tenant'], 'deployment'),
  };
}

function toScreen(raw: Record<string, unknown>): ConfigScreen | undefined {
  const id = str(raw.id);
  const name = str(raw.name);

  if (!id && !name) {
    return undefined;
  }

  return {
    id: id || name,
    name: name || id,
    accessRole: str(raw.accessRole),
    settingKeys: strList(raw.settingKeys),
    hasConnectionTest: bool(raw.hasConnectionTest, false),
    location: str(raw.location),
  };
}

function toConfiguration(value: unknown): ConfigurationSpec {
  if (!isRecord(value)) {
    return EMPTY_TAS.configuration;
  }

  return {
    settings: mapList(value.settings, toSetting),
    environmentVariables: mapList(value.environmentVariables, toEnvVar),
    secrets: mapList(value.secrets, toSecret),
    screens: mapList(value.screens, toScreen),
  };
}

function toSecurity(value: unknown): SecuritySpec {
  if (!isRecord(value)) {
    return EMPTY_TAS.security;
  }

  const auth = isRecord(value.authentication) ? value.authentication : {};
  const authz = isRecord(value.authorization) ? value.authorization : {};

  return {
    authentication: {
      method: str(auth.method),
      identityField: str(auth.identityField),
      sessionMechanism: str(auth.sessionMechanism),
      sessionExpiry: str(auth.sessionExpiry),
      revocation: str(auth.revocation),
      credentialStorage: str(auth.credentialStorage),
      rateLimiting: str(auth.rateLimiting),
      mfa: optionalStr(auth.mfa),
    },
    authorization: {
      model: oneOf(authz.model, ['rbac', 'abac', 'acl', 'ownership'], 'rbac'),
      enforcementPoint: str(authz.enforcementPoint),
      roles: strList(authz.roles),
      permissionSource: str(authz.permissionSource),

      /* Fixed by the schema — a model claiming client-side enforcement is overridden, not obeyed. */
      serverSideEnforced: true,
    },
    boundaries: mapList(value.boundaries, (raw) => {
      const id = str(raw.id);
      const name = str(raw.name);

      if (!id && !name) {
        return undefined;
      }

      return {
        id: id || name,
        name: name || id,
        zone: oneOf(raw.zone, ['public', 'authenticated', 'privileged', 'internal'], 'authenticated'),
        entryPoints: strList(raw.entryPoints),
        doesNotTrust: strList(raw.doesNotTrust),
        validation: str(raw.validation),
      };
    }),
    publicSurfaces: mapList(value.publicSurfaces, (raw) => {
      const id = str(raw.id);

      if (!id) {
        return undefined;
      }

      return {
        id,
        description: str(raw.description),
        exposes: strList(raw.exposes),
        mustNotExpose: strList(raw.mustNotExpose),
        protection: str(raw.protection),
      };
    }),
  };
}

function toTenancy(value: unknown): TenancySpec {
  if (!isRecord(value)) {
    return EMPTY_TAS.tenancy;
  }

  return {
    model: oneOf(value.model, TENANCY_MODEL_VALUES, 'single-tenant'),
    scopeColumn: optionalStr(value.scopeColumn),
    identitySource: str(value.identitySource),
    enforcementLayers: mapList(value.enforcementLayers, (raw) => {
      const mechanism = str(raw.mechanism);

      if (!mechanism) {
        return undefined;
      }

      return {
        layer: oneOf(raw.layer, ['application', 'database', 'gateway'], 'application'),
        mechanism,
        guaranteeIfOthersFail: str(raw.guaranteeIfOthersFail),
      };
    }),
    cacheKeyConvention: str(value.cacheKeyConvention),
    storagePathConvention: str(value.storagePathConvention),
    levels: mapList(value.levels, (raw) => {
      const name = str(raw.name);

      if (!name) {
        return undefined;
      }

      return {
        ...toLifecycleTagged(raw),
        name,
        description: str(raw.description),
        dataShapeChange: optionalStr(raw.dataShapeChange),
        migrationSketch: optionalStr(raw.migrationSketch),
      };
    }),
    tenantStates: (() => {
      const states = mapList(value.tenantStates, (raw) => {
        const state = str(raw.state);

        if (!state) {
          return undefined;
        }

        return {
          state,
          access: oneOf(raw.access, ['full', 'read-only', 'none'], 'full'),
          description: str(raw.description),
        };
      });

      return states.length > 0 ? states : undefined;
    })(),
  };
}

function toCrossCutting(value: unknown): CrossCuttingSpec {
  if (!isRecord(value)) {
    return EMPTY_TAS.crossCutting;
  }

  const storage = isRecord(value.storage) ? value.storage : {};
  const toggles = isRecord(value.featureToggles) ? value.featureToggles : {};
  const background = isRecord(value.backgroundProcessing) ? value.backgroundProcessing : {};
  const scheduled = isRecord(value.scheduledJobs) ? value.scheduledJobs : {};
  const caching = isRecord(value.caching) ? value.caching : {};
  const audit = isRecord(value.audit) ? value.audit : {};
  const logging = isRecord(value.logging) ? value.logging : {};
  const monitoring = isRecord(value.monitoring) ? value.monitoring : {};

  return {
    storage: {
      provider: str(storage.provider),
      buckets: mapList(storage.buckets, (raw) => {
        const name = str(raw.name);

        if (!name) {
          return undefined;
        }

        return {
          ...toLifecycleTagged(raw),
          name,
          purpose: str(raw.purpose),
          retention: optionalStr(raw.retention),
          publicRead: bool(raw.publicRead, false),
        };
      }),
      pathConvention: str(storage.pathConvention),
      accessModel: oneOf(storage.accessModel, ['signed-url', 'proxied', 'public'], 'signed-url'),
      maxFileSizeBytes: optionalNum(storage.maxFileSizeBytes),
      allowedMimeTypes: optionalStrList(storage.allowedMimeTypes),
      virusScanning: bool(storage.virusScanning, false),
    },
    featureToggles: {
      evaluationPoint: str(toggles.evaluationPoint),
      source: oneOf(toggles.source, ['env-var', 'tenant-config', 'remote-service', 'build-constant'], 'env-var'),
      flags: mapList(toggles.flags, (raw) => {
        const key = str(raw.key);

        if (!key) {
          return undefined;
        }

        return {
          ...toLifecycleTagged(raw),
          key,
          description: str(raw.description),
          defaultState: bool(raw.defaultState, false),
          scope: oneOf(raw.scope, CONFIG_SCOPE_VALUES, 'system'),
          removalCondition: str(raw.removalCondition),
        };
      }),
    },
    backgroundProcessing: {
      mechanism: str(background.mechanism),
      jobs: mapList(background.jobs, (raw) => {
        const name = str(raw.name);

        if (!name) {
          return undefined;
        }

        return {
          ...toLifecycleTagged(raw),
          id: str(raw.id) || name,
          name,
          trigger: str(raw.trigger),
          idempotencyKey: str(raw.idempotencyKey),
          retryPolicy: str(raw.retryPolicy),
          maxAttempts: num(raw.maxAttempts, 1),
          timeoutSeconds: optionalNum(raw.timeoutSeconds),
          userVisibleFailure: str(raw.userVisibleFailure),
        };
      }),
      deadLetterHandling: str(background.deadLetterHandling),
    },
    scheduledJobs: {
      scheduler: str(scheduled.scheduler),
      jobs: mapList(scheduled.jobs, (raw) => {
        const name = str(raw.name);

        if (!name) {
          return undefined;
        }

        return {
          ...toLifecycleTagged(raw),
          id: str(raw.id) || name,
          name,
          schedule: str(raw.schedule),
          timezone: str(raw.timezone),
          overlapPolicy: oneOf(raw.overlapPolicy, ['skip', 'queue', 'allow'], 'skip'),
          failureAlerting: str(raw.failureAlerting),
        };
      }),
    },
    caching: {
      layers: mapList(caching.layers, (raw) => {
        const name = str(raw.name);

        if (!name) {
          return undefined;
        }

        return {
          ...toLifecycleTagged(raw),
          name,
          location: oneOf(raw.location, ['client', 'cdn', 'server-memory', 'shared-store'], 'server-memory'),
          cachedData: strList(raw.cachedData),
          ttlSeconds: num(raw.ttlSeconds, 0),
          invalidationTrigger: str(raw.invalidationTrigger),
        };
      }),
      keyConvention: str(caching.keyConvention),
      tenantPrefixed: bool(caching.tenantPrefixed, false),
    },
    audit: {
      events: mapList(audit.events, (raw) => {
        const event = str(raw.event);

        if (!event) {
          return undefined;
        }

        return {
          ...toLifecycleTagged(raw),
          event,
          entityTypes: strList(raw.entityTypes),
          capturesFieldChanges: bool(raw.capturesFieldChanges, false),
          reasonRequired: bool(raw.reasonRequired, false),
        };
      }),
      sink: str(audit.sink),
      immutabilityMechanism: str(audit.immutabilityMechanism),
      retentionPeriod: str(audit.retentionPeriod),
      requiredFields: strList(audit.requiredFields),
    },
    logging: {
      levels: strList(logging.levels),
      sink: str(logging.sink),
      format: oneOf(logging.format, ['structured-json', 'plain-text'], 'structured-json'),
      requiredContext: strList(logging.requiredContext),
      prohibitedContent: strList(logging.prohibitedContent),
      retentionPeriod: str(logging.retentionPeriod),
    },
    monitoring: {
      signals: mapList(monitoring.signals, (raw) => {
        const name = str(raw.name);

        if (!name) {
          return undefined;
        }

        return {
          ...toLifecycleTagged(raw),
          name,
          type: oneOf(raw.type, ['uptime', 'latency', 'error-rate', 'business-metric', 'resource'], 'uptime'),
          threshold: optionalStr(raw.threshold),
          severity: oneOf(raw.severity, ['critical', 'warning', 'info'], 'warning'),
        };
      }),
      alertRouting: str(monitoring.alertRouting),
      uptimeTarget: optionalStr(monitoring.uptimeTarget),
    },
  };
}

function toDeployment(value: unknown): DeploymentSpec {
  if (!isRecord(value)) {
    return EMPTY_TAS.deployment;
  }

  const scalability = isRecord(value.scalability) ? value.scalability : {};

  return {
    hostingModel: str(value.hostingModel),
    region: str(value.region),
    regionRationale: optionalStr(value.regionRationale),
    environments: mapList(value.environments, (raw) => {
      const name = str(raw.name);

      if (!name) {
        return undefined;
      }

      return { name, purpose: str(raw.purpose), dataPolicy: str(raw.dataPolicy) };
    }),
    migrationStrategy: str(value.migrationStrategy),
    zeroDowntimeRequired: bool(value.zeroDowntimeRequired, false),
    rollbackStrategy: str(value.rollbackStrategy),
    cicdGates: strList(value.cicdGates),
    scalability: {
      envelope: mapList(scalability.envelope, (raw) => {
        const dimension = str(raw.dimension);

        if (!dimension) {
          return undefined;
        }

        return { dimension, expected: str(raw.expected), designHeadroom: str(raw.designHeadroom) };
      }),
      statelessTier: bool(scalability.statelessTier, true),
      horizontalScaling: str(scalability.horizontalScaling),
      peakProfile: optionalStr(scalability.peakProfile),
      reviewTrigger: optionalStr(scalability.reviewTrigger),
    },
  };
}

function toEvolution(value: unknown): EvolutionSpec {
  if (!isRecord(value)) {
    return EMPTY_TAS.evolution;
  }

  return {
    entries: mapList(value.entries, (raw) => {
      const capability = str(raw.capability);

      if (!capability) {
        return undefined;
      }

      return {
        sourceRef: str(raw.sourceRef),
        capability,
        currentState: str(raw.currentState),
        futureState: str(raw.futureState),
        lifecycle: oneOf(raw.lifecycle, ['future', 'deferred'] as Exclude<Lifecycle, 'current'>[], 'future'),
        targetMvpSequence: optionalNum(raw.targetMvpSequence),
        seamKind: oneOf(raw.seamKind, ['interface', 'data-shape', 'config', 'none'], 'none'),
        v1Cost: oneOf(raw.v1Cost, V1_COST_VALUES, 'deferred'),
        v1CostJustification: str(raw.v1CostJustification),
        invariants: strList(raw.invariants),
        migrationSketch: str(raw.migrationSketch),
      };
    }),
    deliberatelyUnprepared: strList(value.deliberatelyUnprepared),
  };
}

/**
 * Parses an unknown `technicalArchitecture` block from the Solution Architect's
 * JSON response into a `TechnicalArchitectureSpecification`.
 *
 * NEVER throws and never returns undefined: a missing, malformed, or old-shape
 * block degrades to `EMPTY_TAS`, and individual malformed array entries are
 * dropped rather than failing the whole parse. This is deliberate — it is what
 * guarantees Sprint 100B cannot break the narrative Architecture Draft's existing
 * approval flow, exactly as `parseStructuredDatabaseSchema` guarantees for the
 * Database Engineer.
 *
 * Correctness is NOT this function's job — `validateTechnicalArchitecture` in
 * tasValidation.ts reports whether the parsed result is actually complete and
 * self-consistent. Parsing is tolerant; validation is strict.
 */
export function parseTechnicalArchitectureSpec(value: unknown): TechnicalArchitectureSpecification {
  if (!isRecord(value)) {
    return EMPTY_TAS;
  }

  const overviewRaw = isRecord(value.systemOverview) ? value.systemOverview : {};
  const runtimeRaw = isRecord(value.runtime) ? value.runtime : {};

  return {
    tasVersion: TAS_VERSION,
    projectId: str(value.projectId),
    projectName: str(value.projectName),
    mvpSequence: num(value.mvpSequence, 1),
    changeClass: oneOf(value.changeClass, CHANGE_CLASS_VALUES, 'structural'),
    systemOverview: {
      summary: str(overviewRaw.summary),
      productType: str(overviewRaw.productType),
      topology: str(overviewRaw.topology),
      modules: mapList(overviewRaw.modules, toModule),
      systemBoundaries: strList(overviewRaw.systemBoundaries),
    },
    decisions: mapList(value.decisions, toDecision),
    capabilities: mapList(value.capabilities, toCapability),
    runtime: {
      target: str(runtimeRaw.target),
      framework: str(runtimeRaw.framework),
      language: str(runtimeRaw.language),
      buildOutput: str(runtimeRaw.buildOutput),
      packageManager: optionalStr(runtimeRaw.packageManager),
      bootSettings: strList(runtimeRaw.bootSettings),
    },
    configuration: toConfiguration(value.configuration),
    security: toSecurity(value.security),
    tenancy: toTenancy(value.tenancy),
    crossCutting: toCrossCutting(value.crossCutting),
    deployment: toDeployment(value.deployment),
    evolution: toEvolution(value.evolution),
    nonGoals: mapList(value.nonGoals, (raw) => {
      const statement = str(raw.statement);

      if (!statement) {
        return undefined;
      }

      return {
        id: str(raw.id) || statement.slice(0, 32),
        statement,
        reason: str(raw.reason),
        revisitAtMvpSequence: optionalNum(raw.revisitAtMvpSequence),
      };
    }),
    doNotBuild: mapList(value.doNotBuild, (raw) => {
      const statement = str(raw.statement);

      if (!statement) {
        return undefined;
      }

      return {
        id: str(raw.id) || statement.slice(0, 32),
        statement,
        origin: oneOf(raw.origin, ['derived', 'explicit'], 'explicit'),
        sourceRef: optionalStr(raw.sourceRef),
        verifiable: str(raw.verifiable),
      };
    }),
    directives: mapList(value.directives, (raw) => {
      const directive = str(raw.directive);

      if (!directive) {
        return undefined;
      }

      const appliesTo = strList(raw.appliesTo).filter((target): target is DirectiveTarget =>
        (DIRECTIVE_TARGET_VALUES as string[]).includes(target),
      );

      return {
        id: str(raw.id) || directive.slice(0, 32),
        appliesTo: appliesTo.length > 0 ? appliesTo : ['generator'],
        kind: oneOf(raw.kind, DIRECTIVE_KIND_VALUES, 'invariant'),
        directive,
        mustNot: optionalStr(raw.mustNot),
        verifiable: str(raw.verifiable),
        sourceSection: str(raw.sourceSection),
        decisionRefs: optionalStrList(raw.decisionRefs),
        mvpSequence: num(raw.mvpSequence, 1),
        severity: oneOf(raw.severity, ['must', 'should'], 'must'),
      };
    }),
  };
}
